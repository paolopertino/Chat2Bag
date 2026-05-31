import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.dependencies import get_region_search_service
from src.api.search_routes import router as search_router
from src.services.region_search_service import RegionSearchService


def _client_with_stub(bypass_auth, stub):
    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    app.dependency_overrides[get_region_search_service] = lambda: stub
    return TestClient(app)


class _SvcStub:
    def search_by_text(self, text, bag_paths, top_k):
        return [{"timestamp_ns": 1, "topic": "/cam/a", "similarity_score": 0.9}]

    def search_by_frame(self, support_file_path, points, bag_paths, top_k):
        return [{"timestamp_ns": 2, "topic": "/cam/a", "similarity_score": 0.8}]

    def search_by_image(self, image_bytes, points, bag_paths, top_k):
        return [{"timestamp_ns": 3, "topic": "/cam/a", "similarity_score": 0.7}]


def test_region_by_text_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/by-text", json={"text": "car", "bag_paths": ["/b"], "top_k": 5})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["timestamp_ns"] == 1


def test_region_by_frame_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/by-frame", json={
        "support_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
        "points": [{"x": 0.5, "y": 0.5}], "bag_paths": ["/b"], "top_k": 5,
    })
    assert resp.status_code == 200
    assert resp.json()["results"][0]["timestamp_ns"] == 2


class _StubSearcher:
    def search_by_text(self, text, bag_paths, top_k):
        return [{"ok": True, "text": text, "n": len(bag_paths), "top_k": top_k}]

    def search_by_points(self, image, points, bag_paths, top_k, exclude_file_path=None):
        return [{"points": len(points), "exclude": exclude_file_path}]


def test_service_rejects_empty_bag_paths():
    svc = RegionSearchService(_StubSearcher())
    with pytest.raises(ValueError):
        svc.search_by_text(text="x", bag_paths=[], top_k=5)


def test_service_delegates_text():
    svc = RegionSearchService(_StubSearcher())
    out = svc.search_by_text(text="car", bag_paths=["/b"], top_k=3)
    assert out[0]["text"] == "car" and out[0]["top_k"] == 3
