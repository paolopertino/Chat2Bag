from typing import Annotated, List, Literal, Optional, Union

import anyio
from anyio import CapacityLimiter
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from src.api.dependencies import (
    get_map_search_service,
    get_region_search_service,
    get_search_limiter,
    get_search_service,
)
from src.auth.dependencies import require_current_user
from src.services.map_search_service import MapSearchService
from src.services.region_search_service import RegionSearchService
from src.services.search_service import SearchService

router = APIRouter(
    prefix="/api",
    tags=["search"],
    dependencies=[Depends(require_current_user)],
)

# Blocking, embedding/GPU-bound search work is offloaded to a worker thread so it
# never blocks the event loop, and is bounded by the app-wide search limiter so a
# burst of requests cannot oversubscribe the GPU. The facades are stateless per
# call, so one shared instance is safe across these concurrent threads.
Limiter = Annotated[Optional[CapacityLimiter], Depends(get_search_limiter)]


class LatLon(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)


class CircleArea(BaseModel):
    kind: Literal["circle"]
    center: LatLon
    radius_m: float = Field(..., gt=0.0)


class PolygonArea(BaseModel):
    kind: Literal["polygon"]
    vertices: List[LatLon] = Field(..., min_length=3)


Area = Annotated[Union[CircleArea, PolygonArea], Field(discriminator="kind")]


class MapSearchRequest(BaseModel):
    area: Area
    bag_paths: List[str]
    top_k: Optional[int] = Field(default=None, ge=1, le=2000)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=100, ge=1, le=500)
    area: Optional[Area] = None


class SimilarSearchRequest(BaseModel):
    file_path: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=100, ge=1, le=500)
    area: Optional[Area] = None


class Point(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class RegionByFrameRequest(BaseModel):
    support_file_path: str = Field(..., min_length=1)
    points: List[Point] = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=100, ge=1, le=500)
    area: Optional[Area] = None


class RegionByTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=100, ge=1, le=500)
    area: Optional[Area] = None


class RegionHeatmapTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    target_file_path: str = Field(..., min_length=1)


class RegionHeatmapByFrameRequest(BaseModel):
    support_file_path: str = Field(..., min_length=1)
    points: List[Point] = Field(..., min_length=1)
    target_file_path: str = Field(..., min_length=1)


@router.post("/search")
async def search_bags(
    req: SearchRequest,
    search_service: Annotated[SearchService, Depends(get_search_service)],
    limiter: Limiter = None,
):
    """Federated search across multiple bags using the shared Searcher object."""
    try:
        results = await anyio.to_thread.run_sync(
            lambda: search_service.search(
                query=req.query,
                bag_paths=req.bag_paths,
                top_k=req.top_k,
                area=req.area.model_dump() if req.area else None,
            ),
            limiter=limiter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"query": req.query, "results": results}


@router.post("/search/map")
async def search_map(
    req: MapSearchRequest,
    service: Annotated[MapSearchService, Depends(get_map_search_service)],
):
    """Standalone Map browse: chronological, temporal-deduped in-area Frames."""
    try:
        results = await anyio.to_thread.run_sync(
            lambda: service.browse(
                area_payload=req.area.model_dump(),
                bag_paths=req.bag_paths,
                top_k=req.top_k,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"query": "map", "results": results}


@router.post("/search/image")
async def search_bags_by_image(
    search_service: Annotated[SearchService, Depends(get_search_service)],
    image: UploadFile = File(...),
    bag_paths: List[str] = Form(...),
    top_k: int = Form(default=100, ge=1, le=500),
    area: Optional[str] = Form(default=None),
    limiter: Limiter = None,
):
    """Federated image search across multiple bags using uploaded image content."""
    import json as _json
    try:
        image_bytes = await image.read()
        parsed_area = _json.loads(area) if area else None
        results = await anyio.to_thread.run_sync(
            lambda: search_service.search_by_image(
                image_bytes=image_bytes,
                bag_paths=bag_paths,
                top_k=top_k,
                area=parsed_area,
            ),
            limiter=limiter,
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
    limiter: Limiter = None,
):
    """Finds similar frames to a known frame path across selected bags."""
    try:
        results = await anyio.to_thread.run_sync(
            lambda: search_service.search_similar(
                file_path=req.file_path,
                bag_paths=req.bag_paths,
                top_k=req.top_k,
                area=req.area.model_dump() if req.area else None,
            ),
            limiter=limiter,
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
    limiter: Limiter = None,
):
    """Region search across bags using a text query (template-ensembled)."""
    try:
        results = await anyio.to_thread.run_sync(
            lambda: service.search_by_text(
                text=req.text,
                bag_paths=req.bag_paths,
                top_k=req.top_k,
                area=req.area.model_dump() if req.area else None,
            ),
            limiter=limiter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"query": req.text, "results": results}


@router.post("/search/region/by-frame")
async def region_search_by_frame(
    req: RegionByFrameRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    limiter: Limiter = None,
):
    """Region search from points on an already-indexed Support Frame (self-excluded)."""
    try:
        results = await anyio.to_thread.run_sync(
            lambda: service.search_by_frame(
                support_file_path=req.support_file_path,
                points=[p.model_dump() for p in req.points],
                bag_paths=req.bag_paths,
                top_k=req.top_k,
                area=req.area.model_dump() if req.area else None,
            ),
            limiter=limiter,
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
    top_k: int = Form(default=100, ge=1, le=500),
    area: Optional[str] = Form(default=None),
    limiter: Limiter = None,
):
    """Region search from points on an uploaded Support image. `points` is a JSON array."""
    import json as _json

    try:
        parsed_points = _json.loads(points)
        parsed_area = _json.loads(area) if area else None
        image_bytes = await image.read()
        results = await anyio.to_thread.run_sync(
            lambda: service.search_by_image(
                image_bytes=image_bytes,
                points=parsed_points,
                bag_paths=bag_paths,
                top_k=top_k,
                area=parsed_area,
            ),
            limiter=limiter,
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
    limiter: Limiter = None,
):
    """Recomputed value-attention cosine grid for a target frame vs a text query."""
    try:
        grid = await anyio.to_thread.run_sync(
            lambda: service.heatmap_by_text(
                text=req.text, target_file_path=req.target_file_path
            ),
            limiter=limiter,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid


@router.post("/search/region/heatmap/by-frame")
async def region_heatmap_by_frame(
    req: RegionHeatmapByFrameRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    limiter: Limiter = None,
):
    """Recomputed value-attention cosine grid for a target frame vs points on a Support Frame."""
    try:
        grid = await anyio.to_thread.run_sync(
            lambda: service.heatmap_by_frame(
                support_file_path=req.support_file_path,
                points=[p.model_dump() for p in req.points],
                target_file_path=req.target_file_path,
            ),
            limiter=limiter,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid


@router.post("/search/region/heatmap/by-image")
async def region_heatmap_by_image(
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    image: UploadFile = File(...),
    points: str = Form(...),
    target_file_path: str = Form(...),
    limiter: Limiter = None,
):
    """Recomputed cosine grid for a target frame vs points on an uploaded Support image."""
    import json as _json

    try:
        parsed_points = _json.loads(points)
        image_bytes = await image.read()
        grid = await anyio.to_thread.run_sync(
            lambda: service.heatmap_by_image(
                image_bytes=image_bytes,
                points=parsed_points,
                target_file_path=target_file_path,
            ),
            limiter=limiter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid
