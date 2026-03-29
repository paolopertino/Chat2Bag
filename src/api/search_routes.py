from typing import List
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.api.dependencies import get_search_service
from src.services.search_service import SearchService

router = APIRouter(prefix="/api", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


@router.post("/search")
async def search_bags(
    req: SearchRequest,
    search_service: Annotated[SearchService, Depends(get_search_service)],
):
    """Federated search across multiple bags using the shared Searcher object."""
    try:
        results = search_service.search(
            query=req.query,
            bag_paths=req.bag_paths,
            top_k=req.top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"query": req.query, "results": results}
