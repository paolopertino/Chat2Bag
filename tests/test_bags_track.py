import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.bags import router as bags_router
from src.core.app_config import get_app_config
from src.core.storage import artifacts_for_bag


def _bag(tmp_path):
    bag = tmp_path / "bag"
    artifact = artifacts_for_bag(bag).dir
    (artifact / "lancedb").mkdir(parents=True)
    frames = [
        {"timestamp_ns": 1, "topic": "/c", "file_path": "f1.jpg", "lat": 45.0, "lon": 10.0},
        {"timestamp_ns": 2, "topic": "/c", "file_path": "f2.jpg"},  # unlocated
        {"timestamp_ns": 3, "topic": "/c", "file_path": "f3.jpg", "lat": 45.1, "lon": 10.1},
    ]
    meta = {"schema_version": 5, "frames": frames,
            "gps": {"topic": "/oxts/nav_sat_fix", "max_gap_sec": 1.0,
                    "fix_count": 9, "located_frame_count": 2, "frame_count": 3}}
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag)


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def test_track_returns_located_points_only(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/track?bag_path={bag}")
    assert resp.status_code == 200
    pts = resp.json()["points"]
    assert len(pts) == 2
    assert pts[0] == {"lat": 45.0, "lon": 10.0, "timestamp_ns": 1}


def test_track_stride(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/track?bag_path={bag}&stride=2")
    assert [p["timestamp_ns"] for p in resp.json()["points"]] == [1]


def test_info_reports_is_located(tmp_path, bypass_auth):
    bag = _bag(tmp_path)
    resp = _client(bypass_auth).get(f"/api/bags/info?bag_path={bag}")
    body = resp.json()
    assert body["is_located"] is True
    assert body["located_frame_count"] == 2
