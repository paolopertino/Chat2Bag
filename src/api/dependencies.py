from fastapi import HTTPException, Request

from src.api.state import indexing_status
from src.services.chat_service import ChatService
from src.services.extraction_service import ExtractionService
from src.services.indexing_service import IndexingService
from src.services.region_search_service import RegionSearchService
from src.services.search_service import SearchService


def get_indexing_service(request: Request) -> IndexingService:
    return IndexingService(
        factory=request.app.state.component_factory,
        status_store=indexing_status,
        searcher=request.app.state.searcher_instance,
    )


def get_search_service(request: Request) -> SearchService:
    return SearchService(searcher=request.app.state.searcher_instance)


def get_region_search_service(request: Request) -> RegionSearchService:
    searcher = getattr(request.app.state, "region_searcher_instance", None)
    if searcher is None:
        raise HTTPException(
            status_code=400,
            detail="Region search is not available with the active embedding backend.",
        )
    return RegionSearchService(searcher=searcher)


def get_chat_service(request: Request) -> ChatService:
    return ChatService(factory=request.app.state.component_factory)


def get_extraction_service(request: Request) -> ExtractionService:
    cfg = request.app.state.app_config.extraction
    if not cfg.enabled:
        raise HTTPException(
            status_code=404,
            detail="Dataset extraction is not configured. Set extraction.service_url in settings.yaml.",
        )
    return ExtractionService(config=cfg)