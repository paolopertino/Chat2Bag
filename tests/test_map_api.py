from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.dependencies import get_map_search_service, get_search_service
from src.api.search_routes import router as search_router


class _MapStub:
    def __init__(self):
        self.calls = []

    def browse(self, area_payload, bag_paths, top_k=None):
        self.calls.append((area_payload, bag_paths, top_k))
        return [{"bag_path": bag_paths[0], "timestamp_ns": 1, "file_path": "f.jpg",
                 "topic": "/c", "source_bag": "b", "lat": 45.0, "lon": 10.0, "distance_m": 12.0}]


class _SearchStub:
    def __init__(self):
        self.area = "UNSET"

    def search(self, query, bag_paths, top_k, area=None):
        self.area = area
        return [{"bag_path": bag_paths[0], "timestamp_ns": 1, "file_path": "f.jpg",
                 "topic": "/c", "similarity_score": 0.9, "source_bag": "b"}]


def _client(bypass_auth, *, map_stub=None, search_stub=None):
    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    if map_stub is not None:
        app.dependency_overrides[get_map_search_service] = lambda: map_stub
    if search_stub is not None:
        app.dependency_overrides[get_search_service] = lambda: search_stub
    return TestClient(app)


CIRCLE = {"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 120}


def test_map_browse_endpoint(bypass_auth):
    stub = _MapStub()
    resp = _client(bypass_auth, map_stub=stub).post(
        "/api/search/map", json={"area": CIRCLE, "bag_paths": ["/b"], "top_k": 50})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["distance_m"] == 12.0
    assert stub.calls[0][1] == ["/b"]


def test_map_browse_rejects_bad_polygon(bypass_auth):
    resp = _client(bypass_auth, map_stub=_MapStub()).post(
        "/api/search/map",
        json={"area": {"kind": "polygon", "vertices": [{"lat": 0, "lon": 0}]}, "bag_paths": ["/b"]})
    assert resp.status_code == 422  # < 3 vertices


def test_area_forwarded_on_global_search(bypass_auth):
    stub = _SearchStub()
    resp = _client(bypass_auth, search_stub=stub).post(
        "/api/search", json={"query": "car", "bag_paths": ["/b"], "top_k": 5, "area": CIRCLE})
    assert resp.status_code == 200
    assert stub.area == CIRCLE


def test_area_absent_is_none(bypass_auth):
    stub = _SearchStub()
    _client(bypass_auth, search_stub=stub).post(
        "/api/search", json={"query": "car", "bag_paths": ["/b"], "top_k": 5})
    assert stub.area is None
