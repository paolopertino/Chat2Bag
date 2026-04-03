from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.api.dependencies import get_indexing_service
from src.services.indexing_service import IndexingService

router = APIRouter(prefix="/api", tags=["indexing"])


class IndexRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)


@router.post("/index")
async def index_bag(
    req: IndexRequest,
    background_tasks: BackgroundTasks,
    indexing_service: Annotated[IndexingService, Depends(get_indexing_service)],
):
    """Triggers extraction and indexing in the background."""
    try:
        resolved_bag_path = indexing_service.resolve_and_validate_bag_path(req.bag_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        await indexing_service.queue_index_bag(background_tasks, resolved_bag_path)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return {"status": "Indexing started in the background", "bag": resolved_bag_path}


@router.delete("/index")
async def reset_index_status(
    bag_path: str = Query(..., description="Absolute path of bag directory to reset"),
    indexing_service: IndexingService = Depends(get_indexing_service),
):
    """Reset a bag's indexing status to 'idle', clearing any stuck state."""
    resolved = str(Path(bag_path).expanduser().resolve())
    indexing_service.reset_status(resolved)
    return {"bag_path": resolved, "status": "idle"}
