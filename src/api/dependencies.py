from fastapi import Request

from src.api.state import indexing_status
from src.services.chat_service import ChatService
from src.services.indexing_service import IndexingService
from src.services.search_service import SearchService


def get_indexing_service(request: Request) -> IndexingService:
    return IndexingService(
        factory=request.app.state.component_factory,
        status_store=indexing_status,
    )


def get_search_service(request: Request) -> SearchService:
    return SearchService(searcher=request.app.state.searcher_instance)


def get_chat_service(request: Request) -> ChatService:
    return ChatService(factory=request.app.state.component_factory)