import asyncio
import json
import math

from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.state import indexing_errors, indexing_status
from src.auth.dependencies import require_current_user
from src.core.app_config import get_app_config
from src.core.index_manifest import ensure_manifest, is_indexed as bag_is_indexed
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


def _has_raw_bag(path: Path) -> bool:
    """A folder holding raw .mcap data (the original bag definition)."""
    if not path.is_dir():
        return False
    try:
        return any(child.is_file() and child.suffix == ".mcap" for child in path.iterdir())
    except (PermissionError, OSError):
        return False


def _is_indexed_bag(path: Path) -> bool:
    """A folder whose resolved artifact dir carries a valid completion manifest.

    Heals legacy stamp-only indexes into a manifest on the spot (see
    index_manifest.ensure_manifest) so index-only bags become discoverable.
    """
    try:
        return ensure_manifest(resolve_artifact_path(bag_path=path))
    except (PermissionError, OSError):
        return False


def _is_discoverable(path: Path) -> bool:
    """A folder is a bag if it has raw .mcap data OR a completed index."""
    return _has_raw_bag(path) or _is_indexed_bag(path)


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
                if _is_discoverable(item):
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


def _find_indexed_dirs_in_storage(storage_root: Path) -> List[Path]:
    """Shallow one-level walk of a configured storage_path: each child folder
    whose synthetic bag path resolves to a completed index is an index-only bag.

    In storage_path mode resolve_artifact_path keys off the folder name, so the
    child path <storage_root>/<name> round-trips to its own artifact dir.
    """
    found: List[Path] = []
    try:
        for child in storage_root.iterdir():
            if not child.is_dir() or child.name == _ARTIFACT_DIR_NAME:
                continue
            try:
                if _is_indexed_bag(child):
                    found.append(child)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError):
        return found
    return found


def _dedup_by_artifact_dir(candidates: List[Path]) -> List[Path]:
    """Collapse candidates resolving to the same artifact dir, preferring the raw
    entry (the real bag folder) over a synthetic storage-path entry."""
    by_artifact: Dict[Path, Path] = {}
    for path in candidates:
        try:
            key = resolve_artifact_path(bag_path=path).resolve()
        except (PermissionError, OSError):
            continue
        existing = by_artifact.get(key)
        if existing is None or (_has_raw_bag(path) and not _has_raw_bag(existing)):
            by_artifact[key] = path
    return list(by_artifact.values())


def _discover_bag_dirs(root_path: Path) -> List[Path]:
    """All discoverable bag dirs: a recursive walk of root_path plus, when a
    storage_path is configured, a shallow walk of it for index-only bags whose
    original folder may be gone. Deduped by resolved artifact dir."""
    candidates = _find_bag_dirs_recursive(root_path)
    storage_path = get_app_config().storage.storage_path
    if storage_path is not None:
        candidates.extend(_find_indexed_dirs_in_storage(Path(storage_path).expanduser()))
    return _dedup_by_artifact_dir(candidates)


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
            loop.run_in_executor(None, _discover_bag_dirs, root_path),
            timeout=scan_timeout,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Scan timed out after {scan_timeout}s. Try a more specific root directory.",
        ) from exc

    bags: List[Dict[str, Any]] = []
    for candidate in sorted(bag_dirs, key=lambda p: str(p.resolve())):
        artifact_dir = _artifact_dir_for_bag(candidate)
        # Lazy heal legacy indexes (raw or index-only) into a manifest.
        ensure_manifest(artifact_dir)
        bag_path = str(candidate.resolve())
        stamp = read_gps_stamp(_metadata_path_for_bag(candidate))
        bags.append(
            {
                "bag_path": bag_path,
                "bag_name": candidate.name,
                "is_indexed": bag_is_indexed(artifact_dir),
                "has_raw_data": _has_raw_bag(candidate),
                "status": indexing_status.get(bag_path, "idle"),
                "is_located": gps_is_located(stamp),
                "located_frame_count": int(stamp.get("located_frame_count", 0)) if stamp else 0,
                "error_message": indexing_errors.get(bag_path),
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
    status = indexing_status.get(resolved_path)

    if status is None:
        status = "done" if bag_is_indexed(_artifact_dir_for_bag(path)) else "idle"

    return {
        "bag_path": resolved_path,
        "status": status,
        "error_message": indexing_errors.get(resolved_path),
    }


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
