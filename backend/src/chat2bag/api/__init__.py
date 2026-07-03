from chat2bag.api.bags import router as bags_router
from chat2bag.api.datasets import router as datasets_router
from chat2bag.api.indexing import router as indexing_router
from chat2bag.api.image import router as image_router
from chat2bag.api.search_routes import router as search_router
from chat2bag.auth.router import router as auth_router

__all__ = [
    "auth_router",
    "bags_router",
    "datasets_router",
    "image_router",
    "indexing_router",
    "search_router",
]

