from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.api.image import router as image_router


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(image_router)
    bypass_auth(app)
    return TestClient(app, raise_server_exceptions=False)


def test_per_camera_frame_path_accepted_but_missing_file_404(tmp_path, bypass_auth):
    # Multi-camera layout: <artifact>/thumbnails/<camera>/frame_N.jpg.
    # Pattern must accept it (404 = accepted-but-missing, not 400 = rejected).
    p = tmp_path / ".bag_chat" / "thumbnails" / "cam_front" / "frame_123.jpg"
    resp = _client(bypass_auth).get("/api/image", params={"path": str(p)})
    assert resp.status_code == 404


def test_legacy_flat_frame_path_still_accepted(tmp_path, bypass_auth):
    p = tmp_path / ".bag_chat" / "thumbnails" / "frame_123.jpg"
    resp = _client(bypass_auth).get("/api/image", params={"path": str(p)})
    assert resp.status_code == 404


def test_non_frame_path_rejected_400(bypass_auth):
    resp = _client(bypass_auth).get("/api/image", params={"path": "/tmp/x.jpg"})
    assert resp.status_code == 400


def test_extra_nested_path_rejected_400(tmp_path, bypass_auth):
    # Only a single optional camera segment is allowed under thumbnails/.
    p = tmp_path / ".bag_chat" / "thumbnails" / "a" / "b" / "frame_1.jpg"
    resp = _client(bypass_auth).get("/api/image", params={"path": str(p)})
    assert resp.status_code == 400
