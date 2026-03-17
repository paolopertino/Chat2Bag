from typing import List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


@router.post("/search")
async def search_bags(req: SearchRequest, request: Request):
    """Federated search across multiple bags using the shared Searcher object."""
    if not req.bag_paths:
        raise HTTPException(
            status_code=400, detail="Must provide at least one bag path."
        )

    results = request.app.state.searcher_instance.search(
        query=req.query,
        bag_paths=req.bag_paths,
        top_k=req.top_k,
    )

    return {"query": req.query, "results": results}
