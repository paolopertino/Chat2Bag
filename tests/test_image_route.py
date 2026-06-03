from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.image import router as image_router


def _client():
    app = FastAPI()
    app.include_router(image_router)
    return TestClient(app, raise_server_exceptions=False)


def test_per_camera_frame_path_accepted_but_missing_file_404(tmp_path):
    # Multi-camera layout: <artifact>/thumbnails/<camera>/frame_N.jpg.
    # Pattern must accept it (404 = accepted-but-missing, not 400 = rejected).
    p = tmp_path / ".bag_chat" / "thumbnails" / "cam_front" / "frame_123.jpg"
    resp = _client().get("/api/image", params={"path": str(p)})
    assert resp.status_code == 404


def test_legacy_flat_frame_path_still_accepted(tmp_path):
    p = tmp_path / ".bag_chat" / "thumbnails" / "frame_123.jpg"
    resp = _client().get("/api/image", params={"path": str(p)})
    assert resp.status_code == 404


def test_non_frame_path_rejected_400():
    resp = _client().get("/api/image", params={"path": "/tmp/x.jpg"})
    assert resp.status_code == 400


def test_extra_nested_path_rejected_400(tmp_path):
    # Only a single optional camera segment is allowed under thumbnails/.
    p = tmp_path / ".bag_chat" / "thumbnails" / "a" / "b" / "frame_1.jpg"
    resp = _client().get("/api/image", params={"path": str(p)})
    assert resp.status_code == 400
