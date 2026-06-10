import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.bags import router as bags_router
from src.api.chat_routes import router as chat_router
from src.api.datasets import router as datasets_router
from src.api.image import router as image_router
from src.api.indexing import router as indexing_router
from src.api.search_routes import router as search_router


@pytest.fixture
def unauthenticated_client_for():
    def _make(router):
        app = FastAPI()
        app.include_router(router)
        return TestClient(app, raise_server_exceptions=False)

    return _make


@pytest.mark.parametrize(
    "router, method, path",
    [
        (bags_router, "GET", "/api/bags/scan?root_dir=/tmp"),
        (bags_router, "GET", "/api/bags/track?bag_path=/tmp/x"),
        (chat_router, "POST", "/api/chat"),
        (datasets_router, "GET", "/api/datasets/jobs"),
        (image_router, "GET", "/api/image?path=/tmp/x.jpg"),
        (indexing_router, "POST", "/api/index"),
        (search_router, "POST", "/api/search"),
    ],
)
def test_router_requires_auth(unauthenticated_client_for, router, method, path):
    client = unauthenticated_client_for(router)
    response = client.request(method, path)
    assert response.status_code == 401

