from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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

    indexing_service.queue_index_bag(background_tasks, resolved_bag_path)
    return {"status": "Indexing started in the background", "bag": resolved_bag_path}
