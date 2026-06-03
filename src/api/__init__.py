from src.api.bags import router as bags_router
from src.api.chat_routes import router as chat_router
from src.api.datasets import router as datasets_router
from src.api.indexing import router as indexing_router
from src.api.image import router as image_router
from src.api.search_routes import router as search_router
from src.auth.router import router as auth_router

__all__ = [
    "auth_router",
    "bags_router",
    "chat_router",
    "datasets_router",
    "image_router",
    "indexing_router",
    "search_router",
]

