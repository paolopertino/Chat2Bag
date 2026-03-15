from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

from src.api.state import indexing_status

router = APIRouter(prefix="/api/bags", tags=["bags"])


def _is_bag_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    return any(child.is_file() and child.suffix == ".mcap" for child in path.iterdir())


@router.get("/scan")
async def scan_bags(root_dir: str = Query(..., description="Root directory containing bag folders")):
    root_path = Path(root_dir).expanduser().resolve()
    if not root_path.exists() or not root_path.is_dir():
        raise HTTPException(status_code=400, detail="root_dir must be an existing directory")

    bags: List[Dict[str, Any]] = []
    for candidate in sorted(root_path.iterdir()):
        if not _is_bag_dir(candidate):
            continue

        lancedb_dir = candidate / ".bag_chat" / "lancedb"
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
async def bag_status(bag_path: str = Query(..., description="Absolute path of bag directory")):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    resolved_path = str(path)
    lancedb_dir = path / ".bag_chat" / "lancedb"
    status = indexing_status.get(resolved_path)

    if status is None:
        status = "done" if lancedb_dir.exists() and lancedb_dir.is_dir() else "idle"

    return {"bag_path": resolved_path, "status": status}
