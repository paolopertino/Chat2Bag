from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.api.dependencies import get_indexing_service, get_search_service
from chat2bag.api.indexing import router as indexing_router
from chat2bag.api.search_routes import router as search_router
from chat2bag.auth.dependencies import require_current_user
from chat2bag.auth.models import User


class FakeIndexingService:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail
        self.queued_paths: list[str] = []

    def resolve_and_validate_bag_path(self, bag_path: str) -> str:
        if self.should_fail:
            raise FileNotFoundError("Bag path does not exist.")
        return f"/resolved{bag_path}"

    async def queue_index_bag(self, background_tasks, bag_path: str) -> None:
        _ = background_tasks
        self.queued_paths.append(bag_path)


class FakeSearchService:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    def search(self, query: str, bag_paths: list[str], top_k: int, area=None) -> list[dict]:
        _ = query
        if self.should_fail:
            raise ValueError("Must provide at least one bag path.")
        return [
            {
                "bag_path": bag_paths[0],
                "timestamp_ns": 1,
                "file_path": "/tmp/frame.jpg",
                "topic": "/camera",
                "similarity_score": 0.99,
                "source_bag": "test-bag",
            }
        ][:top_k]

    def search_by_image(
        self,
        image_bytes: bytes,
        bag_paths: list[str],
        top_k: int,
        area=None,
    ) -> list[dict]:
        _ = image_bytes
        if self.should_fail:
            raise ValueError("Must provide at least one bag path.")
        return self.search(query="image", bag_paths=bag_paths, top_k=top_k)

    def search_similar(self, file_path: str, bag_paths: list[str], top_k: int, area=None) -> list[dict]:
        if self.should_fail:
            raise ValueError("Must provide at least one bag path.")
        if file_path == "/missing.jpg":
            raise FileNotFoundError("Image not found")
        return self.search(query="similar", bag_paths=bag_paths, top_k=top_k)


def create_test_client(indexing_service, search_service) -> TestClient:
    app = FastAPI()
    app.include_router(indexing_router)
    app.include_router(search_router)
    app.dependency_overrides[get_indexing_service] = lambda: indexing_service
    app.dependency_overrides[get_search_service] = lambda: search_service
    app.dependency_overrides[require_current_user] = lambda: User(
        id=1, username="test-user", is_active=True
    )
    return TestClient(app)


def test_index_success_contract():
    indexing_service = FakeIndexingService()
    client = create_test_client(indexing_service, FakeSearchService())

    response = client.post("/api/index", json={"bag_path": "/bags/one"})

    assert response.status_code == 200
    assert response.json()["status"] == "Indexing started in the background"
    assert response.json()["bag"] == "/resolved/bags/one"


def test_index_not_found_contract():
    client = create_test_client(FakeIndexingService(should_fail=True), FakeSearchService())

    response = client.post("/api/index", json={"bag_path": "/missing"})

    assert response.status_code == 404
    assert "Bag path does not exist" in response.json()["detail"]


def test_search_success_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService())

    response = client.post(
        "/api/search",
        json={"query": "pedestrian", "bag_paths": ["/bags/one"], "top_k": 1},
    )

    assert response.status_code == 200
    assert response.json()["query"] == "pedestrian"
    assert len(response.json()["results"]) == 1


def test_search_validation_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService(should_fail=True))

    response = client.post(
        "/api/search",
        json={"query": "pedestrian", "bag_paths": [], "top_k": 1},
    )

    assert response.status_code == 400
    assert "Must provide at least one bag path" in response.json()["detail"]


def test_image_search_success_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService())

    response = client.post(
        "/api/search/image",
        data={"bag_paths": ["/bags/one"], "top_k": "1"},
        files={"image": ("query.jpg", b"fake-bytes", "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json()["query"] == "image"
    assert len(response.json()["results"]) == 1


def test_image_search_validation_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService(should_fail=True))

    response = client.post(
        "/api/search/image",
        data={"bag_paths": ["/bags/one"], "top_k": "1"},
        files={"image": ("query.jpg", b"fake-bytes", "image/jpeg")},
    )

    assert response.status_code == 400
    assert "Must provide at least one bag path" in response.json()["detail"]


def test_similar_search_success_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService())

    response = client.post(
        "/api/search/similar",
        json={"file_path": "/tmp/frame.jpg", "bag_paths": ["/bags/one"], "top_k": 1},
    )

    assert response.status_code == 200
    assert response.json()["query"] == "similar"
    assert len(response.json()["results"]) == 1


def test_similar_search_not_found_contract():
    client = create_test_client(FakeIndexingService(), FakeSearchService())

    response = client.post(
        "/api/search/similar",
        json={"file_path": "/missing.jpg", "bag_paths": ["/bags/one"], "top_k": 1},
    )

    assert response.status_code == 404
    assert "Image not found" in response.json()["detail"]
