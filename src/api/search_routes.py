from typing import List
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from src.api.dependencies import get_search_service
from src.services.search_service import SearchService

router = APIRouter(prefix="/api", tags=["search"])


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class SimilarSearchRequest(BaseModel):
    file_path: str = Field(..., min_length=1)
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


@router.post("/search/image")
async def search_bags_by_image(
    search_service: Annotated[SearchService, Depends(get_search_service)],
    image: UploadFile = File(...),
    bag_paths: List[str] = Form(...),
    top_k: int = Form(default=5, ge=1, le=100),
):
    """Federated image search across multiple bags using uploaded image content."""
    try:
        image_bytes = await image.read()
        results = search_service.search_by_image(
            image_bytes=image_bytes,
            bag_paths=bag_paths,
            top_k=top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc

    return {"query": "image", "results": results}


@router.post("/search/similar")
async def search_similar_images(
    req: SimilarSearchRequest,
    search_service: Annotated[SearchService, Depends(get_search_service)],
):
    """Finds similar frames to a known frame path across selected bags."""
    try:
        results = search_service.search_similar(
            file_path=req.file_path,
            bag_paths=req.bag_paths,
            top_k=req.top_k,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc

    return {"query": "similar", "results": results}
