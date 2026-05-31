from typing import List
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from src.api.dependencies import get_region_search_service, get_search_service
from src.auth.dependencies import require_current_user
from src.services.region_search_service import RegionSearchService
from src.services.search_service import SearchService

router = APIRouter(
    prefix="/api",
    tags=["search"],
    dependencies=[Depends(require_current_user)],
)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class SimilarSearchRequest(BaseModel):
    file_path: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class Point(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class RegionByFrameRequest(BaseModel):
    support_file_path: str = Field(..., min_length=1)
    points: List[Point] = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class RegionByTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class RegionHeatmapTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    target_file_path: str = Field(..., min_length=1)


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


@router.post("/search/region/by-text")
async def region_search_by_text(
    req: RegionByTextRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    """Region search across bags using a text query (template-ensembled)."""
    try:
        results = service.search_by_text(text=req.text, bag_paths=req.bag_paths, top_k=req.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"query": req.text, "results": results}


@router.post("/search/region/by-frame")
async def region_search_by_frame(
    req: RegionByFrameRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    """Region search from points on an already-indexed Support Frame (self-excluded)."""
    try:
        results = service.search_by_frame(
            support_file_path=req.support_file_path,
            points=[p.model_dump() for p in req.points],
            bag_paths=req.bag_paths,
            top_k=req.top_k,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return {"query": "region:frame", "results": results}


@router.post("/search/region/by-image")
async def region_search_by_image(
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    image: UploadFile = File(...),
    points: str = Form(...),
    bag_paths: List[str] = Form(...),
    top_k: int = Form(default=5, ge=1, le=100),
):
    """Region search from points on an uploaded Support image. `points` is a JSON array."""
    import json as _json

    try:
        parsed_points = _json.loads(points)
        image_bytes = await image.read()
        results = service.search_by_image(
            image_bytes=image_bytes, points=parsed_points, bag_paths=bag_paths, top_k=top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return {"query": "region:image", "results": results}


@router.post("/search/region/heatmap")
async def region_heatmap(
    req: RegionHeatmapTextRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    """Recomputed value-attention cosine grid for a target frame vs a text query."""
    try:
        grid = service.heatmap_by_text(text=req.text, target_file_path=req.target_file_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid
