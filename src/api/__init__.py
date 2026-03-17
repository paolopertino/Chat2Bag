from src.api.bags import router as bags_router
from src.api.chat_routes import router as chat_router
from src.api.indexing import router as indexing_router
from src.api.image import router as image_router
from src.api.search_routes import router as search_router

__all__ = [
    "bags_router",
    "chat_router",
    "image_router",
    "indexing_router",
    "search_router",
]
