import io as _io
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image as PILImage

from data_extraction_lib.artifacts import BagArtifacts
from data_extraction_lib.artifacts.frame_entry import Coordinate, MetadataFrameEntry
from data_extraction_lib.index import SearchResult

from src.api.dependencies import get_region_search_service
from src.api.search_routes import router as search_router
from src.core.app_config import get_app_config
from src.services.region_search_service import RegionSearchService


def _client_with_stub(bypass_auth, stub):
    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    app.dependency_overrides[get_region_search_service] = lambda: stub
    return TestClient(app)


class _SvcStub:
    def search_by_text(self, text, bag_paths, top_k, area=None):
        return [{"timestamp_ns": 1, "topic": "/cam/a", "similarity_score": 0.9}]

    def search_by_frame(self, support_file_path, points, bag_paths, top_k, area=None):
        return [{"timestamp_ns": 2, "topic": "/cam/a", "similarity_score": 0.8}]

    def search_by_image(self, image_bytes, points, bag_paths, top_k, area=None):
        return [{"timestamp_ns": 3, "topic": "/cam/a", "similarity_score": 0.7}]

    def heatmap_by_text(self, text, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}

    def heatmap_by_frame(self, support_file_path, points, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}

    def heatmap_by_image(self, image_bytes, points, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}


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


def test_region_heatmap_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/heatmap", json={
        "text": "car", "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["height"] == 2 and body["width"] == 3


def test_region_heatmap_by_frame_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/heatmap/by-frame", json={
        "support_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
        "points": [{"x": 0.5, "y": 0.5}],
        "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_9.jpg",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["height"] == 2 and body["width"] == 3


def test_region_heatmap_by_image_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post(
        "/api/search/region/heatmap/by-image",
        data={"points": json.dumps([{"x": 0.5, "y": 0.5}]),
              "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_9.jpg"},
        files={"image": ("s.png", b"fake-image-bytes", "image/png")},
    )
    assert resp.status_code == 200
    assert resp.json()["width"] == 3


# ---------------------------------------------------------------------------
# Service unit tests — build fake DenseSearch facades that return SearchResult
# ---------------------------------------------------------------------------

def _make_result(artifact_dir, rel_path, topic, ts, score, lat=None, lon=None):
    """Construct a SearchResult for testing to_response mapping."""
    from pathlib import Path
    coord = Coordinate(lat=lat, lon=lon) if lat is not None else None
    frame = MetadataFrameEntry(timestamp_ns=ts, topic=topic, file_path=rel_path, coordinate=coord)
    artifacts = BagArtifacts(Path(artifact_dir))
    return SearchResult(artifacts=artifacts, frame=frame, score=score)


class _FakeDenseSearch:
    """Minimal DenseSearch stub that returns controlled SearchResult lists."""

    def __init__(self, results):
        self._results = results
        self.last_call = {}

    def search_text(self, text, bags, *, top_k, window_ns, area=None):
        self.last_call = {"text": text, "top_k": top_k}
        return self._results

    def search_points(self, image, points, bags, *, top_k, window_ns, area=None, exclude_file_path=None):
        self.last_call = {"points": len(points), "exclude": exclude_file_path, "top_k": top_k}
        return self._results

    def heatmap_for_text(self, text, image):
        return {"height": 2, "width": 3, "grid": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]}

    def heatmap_for_points(self, image, points, target_image):
        return {"height": 2, "width": 3, "grid": [[0.0] * 3] * 2,
                "n_points": len(points)}


def test_service_rejects_empty_bag_paths():
    cfg = get_app_config()
    svc = RegionSearchService(_FakeDenseSearch([]), cfg)
    with pytest.raises(ValueError):
        svc.search_by_text(text="x", bag_paths=[], top_k=5)


def test_service_delegates_text(tmp_path):
    artifact_dir = tmp_path / "bag" / ".bag_chat"
    artifact_dir.mkdir(parents=True)
    bag_path = str(tmp_path / "bag")
    result = _make_result(str(artifact_dir), "thumbnails/cam_a/f.jpg", "/cam/a", 42, 0.9)
    fake = _FakeDenseSearch([result])
    cfg = get_app_config()
    svc = RegionSearchService(fake, cfg)
    out = svc.search_by_text(text="car", bag_paths=[bag_path], top_k=3)
    assert fake.last_call["text"] == "car"
    assert fake.last_call["top_k"] == 3
    assert out[0]["timestamp_ns"] == 42
    assert out[0]["similarity_score"] == 0.9
    assert out[0]["source_bag"] == "bag"


class _HeatFakeDenseSearch:
    """DenseSearch stub for heatmap delegation tests."""

    def heatmap_for_text(self, text, image):
        return {"height": 2, "width": 3, "grid": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]}

    def heatmap_for_points(self, image, points, target_image):
        return {"height": 2, "width": 3, "grid": [[0.0] * 3] * 2,
                "n_points": len(points)}


def test_service_heatmap_by_frame_delegates(tmp_path):
    support = tmp_path / "support.png"
    PILImage.new("RGB", (8, 8), (123, 50, 200)).save(support)
    target = tmp_path / "target.jpg"
    PILImage.new("RGB", (8, 8)).save(target)
    cfg = get_app_config()
    svc = RegionSearchService(_HeatFakeDenseSearch(), cfg)
    out = svc.heatmap_by_frame(
        support_file_path=str(support), points=[{"x": 0.5, "y": 0.5}],
        target_file_path=str(target),
    )
    assert out["height"] == 2 and out["width"] == 3
    assert out["n_points"] == 1


def test_service_heatmap_by_image_delegates(tmp_path):
    buf = _io.BytesIO()
    PILImage.new("RGB", (8, 8), (10, 20, 30)).save(buf, format="PNG")
    target = tmp_path / "target.jpg"
    PILImage.new("RGB", (8, 8)).save(target)
    cfg = get_app_config()
    svc = RegionSearchService(_HeatFakeDenseSearch(), cfg)
    out = svc.heatmap_by_image(
        image_bytes=buf.getvalue(), points=[{"x": 0.1, "y": 0.2}],
        target_file_path=str(target),
    )
    assert out["n_points"] == 1


def test_service_heatmap_rejects_empty_target():
    cfg = get_app_config()
    svc = RegionSearchService(_HeatFakeDenseSearch(), cfg)
    with pytest.raises(ValueError):
        svc.heatmap_by_image(image_bytes=b"x", points=[], target_file_path="  ")
