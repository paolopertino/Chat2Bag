from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.api.dependencies import get_extraction_service
from src.services.extraction_service import ExtractionService, ExtractionServiceError

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


class ExtractRequest(BaseModel):
    bag_path: str = Field(..., min_length=1)
    mode: str = Field(default="window", pattern="^(window|full)$")
    timestamp_ns: Optional[int] = None
    window_length_s: Optional[float] = Field(default=None, gt=0)
    user_config: dict[str, Any] = Field(default_factory=dict)
    output_folder: Optional[str] = None


def _svc(
    svc: Annotated[ExtractionService, Depends(get_extraction_service)],
) -> ExtractionService:
    return svc


@router.get("/config/schema")
async def get_config_schema(svc: Annotated[ExtractionService, Depends(get_extraction_service)]):
    """Return editable fields, their defaults, and which fields are fixed."""
    try:
        return await svc.get_config_schema()
    except ExtractionServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/config/raw_defaults")
async def get_raw_defaults(svc: Annotated[ExtractionService, Depends(get_extraction_service)]):
    """Return the full default config from the extraction microservice."""
    try:
        return await svc.get_service_defaults()
    except ExtractionServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/extract", status_code=202)
async def extract_dataset(
    req: ExtractRequest,
    svc: Annotated[ExtractionService, Depends(get_extraction_service)],
):
    """Submit an extraction job to the dataset-generation microservice."""
    if req.mode == "window" and (req.timestamp_ns is None or req.window_length_s is None):
        raise HTTPException(
            status_code=422,
            detail="timestamp_ns and window_length_s are required for mode=window",
        )
    try:
        job_id = await svc.submit_extraction(
            bag_path=req.bag_path,
            mode=req.mode,
            user_config=req.user_config,
            output_folder=req.output_folder,
            timestamp_ns=req.timestamp_ns,
            window_length_s=req.window_length_s,
        )
    except ExtractionServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Extraction service error: {exc}") from exc
    return {"job_id": job_id}


@router.get("/jobs")
async def list_jobs(svc: Annotated[ExtractionService, Depends(get_extraction_service)]):
    try:
        return await svc.list_jobs()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    svc: Annotated[ExtractionService, Depends(get_extraction_service)],
):
    try:
        return await svc.get_job(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/logs")
async def get_job_logs(
    job_id: str,
    svc: Annotated[ExtractionService, Depends(get_extraction_service)],
    tail: int = Query(default=500, ge=1, le=5000),
):
    try:
        lines = await svc.get_logs(job_id, tail=tail)
        return {"lines": lines}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/jobs/{job_id}")
async def cancel_job(
    job_id: str,
    svc: Annotated[ExtractionService, Depends(get_extraction_service)],
):
    try:
        return await svc.cancel_job(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
