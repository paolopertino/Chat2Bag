import json

from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

from src.api.state import indexing_status
from src.core.settings import get_settings
from src.core.storage import resolve_artifact_path

router = APIRouter(prefix="/api/bags", tags=["bags"])

_SETTINGS = get_settings()

_ARTIFACT_DIR_NAME = _SETTINGS["storage"]["artifact_dir"]


def _artifact_dir_for_bag(path: Path) -> Path:
    return resolve_artifact_path(bag_path=path)


def _metadata_path_for_bag(path: Path) -> Path:
    return _artifact_dir_for_bag(path) / "metadata.json"


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

    bags: List[Dict[str, Any]] = []
    bag_dirs = sorted(
        _find_bag_dirs_recursive(root_path), key=lambda p: str(p.resolve())
    )
    for candidate in bag_dirs:

        lancedb_dir = _artifact_dir_for_bag(candidate) / "lancedb"
        bag_path = str(candidate.resolve())
        bags.append(
            {
                "bag_path": bag_path,
                "bag_name": candidate.name,
                "is_indexed": lancedb_dir.exists() and lancedb_dir.is_dir(),
                "status": indexing_status.get(bag_path, "idle"),
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

    metadata_path = _metadata_path_for_bag(path)
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
            "file_path": frame["file_path"],
        }
        for frame in metadata.get("frames", [])
        if start_ns <= frame.get("timestamp_ns", -1) <= end_ns
    ]
    frames.sort(key=lambda frame: frame["timestamp_ns"])

    return {"bag_path": str(path), "frames": frames}
