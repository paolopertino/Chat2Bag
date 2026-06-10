import asyncio
import json
import math

from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.state import indexing_status
from src.auth.dependencies import require_current_user
from src.core.app_config import get_app_config
from src.core.index_stamp import gps_is_located, read_gps_stamp
from src.core.settings import get_settings
from src.core.storage import metadata_path_for_bag, resolve_artifact_path
from src.services.sample_service import FocusFrameNotFound, build_samples_response

router = APIRouter(
    prefix="/api/bags",
    tags=["bags"],
    dependencies=[Depends(require_current_user)],
)

_SETTINGS = get_settings()

_ARTIFACT_DIR_NAME = _SETTINGS["storage"]["artifact_dir"]


def _artifact_dir_for_bag(path: Path) -> Path:
    return resolve_artifact_path(bag_path=path)


_metadata_path_for_bag = metadata_path_for_bag


def _is_bag_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    return any(child.is_file() and child.suffix == ".mcap" for child in path.iterdir())


def _find_bag_dirs_recursive(root: Path, max_depth: int = 10) -> List[Path]:
    bag_dirs: List[Path] = []

    if max_depth < 0:
        return bag_dirs

    try:
        for item in root.iterdir():
            # Skip generated artifacts to avoid unnecessary traversal.
            if item.is_dir() and item.name == _ARTIFACT_DIR_NAME:
                continue

            try:
                if _is_bag_dir(item):
                    bag_dirs.append(item)
                elif item.is_dir():
                    bag_dirs.extend(
                        _find_bag_dirs_recursive(item, max_depth=max_depth - 1)
                    )
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError):
        return bag_dirs

    return bag_dirs


@router.get("/scan")
async def scan_bags(
    root_dir: str = Query(..., description="Root directory containing bag folders")
):
    root_path = Path(root_dir).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise HTTPException(
            status_code=400, detail="root_dir must be an existing directory"
        )

    scan_timeout = get_app_config().api.scan_timeout_sec
    loop = asyncio.get_event_loop()
    try:
        bag_dirs = await asyncio.wait_for(
            loop.run_in_executor(None, _find_bag_dirs_recursive, root_path),
            timeout=scan_timeout,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Scan timed out after {scan_timeout}s. Try a more specific root directory.",
        ) from exc

    bags: List[Dict[str, Any]] = []
    for candidate in sorted(bag_dirs, key=lambda p: str(p.resolve())):
        lancedb_dir = _artifact_dir_for_bag(candidate) / "lancedb"
        bag_path = str(candidate.resolve())
        stamp = read_gps_stamp(_metadata_path_for_bag(candidate))
        bags.append(
            {
                "bag_path": bag_path,
                "bag_name": candidate.name,
                "is_indexed": lancedb_dir.exists() and lancedb_dir.is_dir(),
                "status": indexing_status.get(bag_path, "idle"),
                "is_located": gps_is_located(stamp),
                "located_frame_count": int(stamp.get("located_frame_count", 0)) if stamp else 0,
            }
        )

    return {"root_dir": str(root_path), "bags": bags}


@router.get("/status")
async def bag_status(
    bag_path: str = Query(..., description="Absolute path of bag directory")
):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    resolved_path = str(path)
    lancedb_dir = _artifact_dir_for_bag(path) / "lancedb"
    status = indexing_status.get(resolved_path)

    if status is None:
        status = "done" if lancedb_dir.exists() and lancedb_dir.is_dir() else "idle"

    return {"bag_path": resolved_path, "status": status}


@router.get("/info")
async def bag_info(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
):
    """Aggregate metadata for a bag: frame_count + first/last timestamp."""
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    metadata_path = _metadata_path_for_bag(path)
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail="Bag metadata not found. Index the bag first."
        )

    with metadata_path.open("r", encoding="utf-8") as metadata_handle:
        metadata = json.load(metadata_handle)

    timestamps = [
        frame["timestamp_ns"]
        for frame in metadata.get("frames", [])
        if "timestamp_ns" in frame
    ]

    gps_stamp = metadata.get("gps")
    return {
        "bag_path": str(path),
        "frame_count": len(timestamps),
        "first_timestamp_ns": min(timestamps) if timestamps else None,
        "last_timestamp_ns": max(timestamps) if timestamps else None,
        "is_located": gps_is_located(gps_stamp),
        "located_frame_count": int(gps_stamp.get("located_frame_count", 0)) if gps_stamp else 0,
    }


@router.get("/track")
async def bag_track(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
    stride: int = Query(1, ge=1, description="Return every Nth located frame"),
):
    """The bag's trajectory: located frames as {lat, lon, timestamp_ns}, chronological."""
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    metadata_path = _metadata_path_for_bag(path)
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(status_code=404, detail="Bag metadata not found. Index the bag first.")

    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)

    located = [
        {"lat": f["lat"], "lon": f["lon"], "timestamp_ns": f["timestamp_ns"]}
        for f in metadata.get("frames", [])
        if "lat" in f and "lon" in f
    ]
    located.sort(key=lambda p: p["timestamp_ns"])
    return {"bag_path": str(path), "points": located[::stride]}


@router.get("/tracks")
async def bag_tracks(
    bag_paths: list[str] = Query(..., description="Bag directories to load Tracks for"),
    max_points: int = Query(500, ge=2, le=5000, description="Max points returned per Track"),
):
    """All requested bags' Tracks in one call, decimated for map rendering.

    Bags with no metadata or no located frames are silently omitted (a Bag
    without a Track is simply not drawable) — never a 404.
    """
    tracks = []
    for raw in bag_paths:
        path = Path(raw).expanduser().resolve()
        metadata_path = _metadata_path_for_bag(path)
        if not metadata_path.exists() or not metadata_path.is_file():
            continue
        with metadata_path.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
        located = [
            {"lat": f["lat"], "lon": f["lon"], "timestamp_ns": f["timestamp_ns"]}
            for f in metadata.get("frames", [])
            if "lat" in f and "lon" in f
        ]
        if not located:
            continue
        located.sort(key=lambda p: p["timestamp_ns"])
        stride = max(1, math.ceil(len(located) / max_points))
        tracks.append(
            {"bag_path": str(path), "bag_name": path.name, "points": located[::stride]}
        )
    return {"tracks": tracks}


@router.get("/frames")
async def bag_frames(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
    start_ns: int = Query(..., ge=0, description="Start timestamp in nanoseconds"),
    duration_sec: float = Query(
        10.0, ge=0.1, le=300.0, description="Window size in seconds"
    ),
):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    artifact_dir = _artifact_dir_for_bag(path)
    metadata_path = artifact_dir / "metadata.json"
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail="Bag metadata not found. Index the bag first."
        )

    with metadata_path.open("r", encoding="utf-8") as metadata_handle:
        metadata = json.load(metadata_handle)

    duration_ns = int(duration_sec * 1e9)
    end_ns = start_ns + duration_ns
    frames = [
        {
            "timestamp_ns": frame["timestamp_ns"],
            "file_path": str(artifact_dir / frame["file_path"]),
        }
        for frame in metadata.get("frames", [])
        if start_ns <= frame.get("timestamp_ns", -1) <= end_ns
    ]
    frames.sort(key=lambda frame: frame["timestamp_ns"])

    return {"bag_path": str(path), "frames": frames}


@router.get("/samples")
async def bag_samples(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
    start_ns: int = Query(..., ge=0, description="Start timestamp in nanoseconds"),
    duration_sec: float = Query(
        ..., ge=0.1, le=300.0, description="Window size in seconds"
    ),
    focus_file_path: str | None = Query(
        None,
        description="Absolute or artifact-relative frame path to force as the focused Sample Frame",
    ),
):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    artifact_dir = _artifact_dir_for_bag(path)
    metadata_path = artifact_dir / "metadata.json"
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail="Bag metadata not found. Index the bag first."
        )

    with metadata_path.open("r", encoding="utf-8") as metadata_handle:
        metadata = json.load(metadata_handle)

    try:
        return build_samples_response(
            bag_path=path,
            artifact_dir=artifact_dir,
            metadata=metadata,
            start_ns=start_ns,
            duration_sec=duration_sec,
            sampling_fps=get_app_config().ingestion.sampling_fps,
            focus_file_path=focus_file_path,
        )
    except FocusFrameNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
