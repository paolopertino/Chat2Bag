import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.api import bags_router


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def _bag(tmp_path: Path, name: str, n_located: int, n_unlocated: int = 0) -> str:
    bag = tmp_path / name
    art = bag / ".bag_chat"  # match the artifact dir used in tests/test_bags_track.py::_bag
    art.mkdir(parents=True)
    frames = [
        {"timestamp_ns": i, "topic": "/cam", "file_path": f"f_{i}.jpg", "lat": 45.0 + i * 1e-4, "lon": 9.0}
        for i in range(n_located)
    ] + [
        {"timestamp_ns": 10_000 + i, "topic": "/cam", "file_path": f"u_{i}.jpg"}
        for i in range(n_unlocated)
    ]
    (art / "metadata.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    return str(bag)


def test_tracks_returns_one_entry_per_located_bag(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 3)
    b = _bag(tmp_path, "bag_b", 2)
    resp = _client(bypass_auth).get(
        "/api/bags/tracks", params=[("bag_paths", a), ("bag_paths", b), ("max_points", 500)]
    )
    assert resp.status_code == 200
    tracks = resp.json()["tracks"]
    assert {t["bag_path"] for t in tracks} == {a, b}
    assert [p["timestamp_ns"] for p in tracks[0]["points"]] == sorted(
        p["timestamp_ns"] for p in tracks[0]["points"]
    )


def test_tracks_skips_bags_without_metadata_or_fixes(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 3)
    unlocated = _bag(tmp_path, "bag_c", 0, n_unlocated=4)
    missing = str(tmp_path / "bag_missing")
    resp = _client(bypass_auth).get(
        "/api/bags/tracks",
        params=[("bag_paths", a), ("bag_paths", unlocated), ("bag_paths", missing)],
    )
    assert resp.status_code == 200
    assert [t["bag_path"] for t in resp.json()["tracks"]] == [a]


def test_tracks_decimates_to_max_points(tmp_path, bypass_auth):
    a = _bag(tmp_path, "bag_a", 100)
    resp = _client(bypass_auth).get(
        "/api/bags/tracks", params=[("bag_paths", a), ("max_points", 10)]
    )
    pts = resp.json()["tracks"][0]["points"]
    assert len(pts) <= 10
    assert pts[0]["timestamp_ns"] == 0  # first point kept
