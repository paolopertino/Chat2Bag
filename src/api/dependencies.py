from fastapi import HTTPException, Request

from src.api.state import indexing_errors, indexing_status
from src.services.extraction_service import ExtractionService
from src.services.indexing_service import IndexingService
from src.services.map_search_service import MapSearchService
from src.services.region_search_service import RegionSearchService
from src.services.search_service import SearchService


def get_indexing_service(request: Request) -> IndexingService:
    return IndexingService(
        factory=request.app.state.component_factory,
        status_store=indexing_status,
        global_search=request.app.state.global_search_instance,
        dense_search=getattr(request.app.state, "dense_search_instance", None),
        error_store=indexing_errors,
    )


def get_search_service(request: Request) -> SearchService:
    return SearchService(
        global_search=request.app.state.global_search_instance,
        config=request.app.state.app_config,
    )


def get_region_search_service(request: Request) -> RegionSearchService:
    dense = getattr(request.app.state, "dense_search_instance", None)
    if dense is None:
        raise HTTPException(
            status_code=400,
            detail="Region search is not available with the active embedding backend.",
        )
    return RegionSearchService(dense_search=dense, config=request.app.state.app_config)


def get_map_search_service(request: Request) -> MapSearchService:
    return request.app.state.component_factory.create_map_search_service()


def get_extraction_service(request: Request) -> ExtractionService:
    cfg = request.app.state.app_config.extraction
    if not cfg.enabled:
        raise HTTPException(
            status_code=404,
            detail="Dataset extraction is not configured. Set extraction.service_url in settings.yaml.",
        )
    return ExtractionService(config=cfg)