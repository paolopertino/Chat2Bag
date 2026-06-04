import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.bags import router as bags_router
from src.core.storage import resolve_artifact_path


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def _write_bag(tmp_path, metadata):
    bag = tmp_path / "bag"
    bag.mkdir()
    (bag / "sample.mcap").write_bytes(b"")
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True, exist_ok=True)
    for frame in metadata["frames"]:
        path = artifact / frame["file_path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"jpg")
    (artifact / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return bag, artifact


def test_samples_use_metadata_cameras_order_and_anchor_timeline(
    tmp_path, bypass_auth
):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front", "/cam/left", "/cam/right"],
        "frames": [
            {
                "timestamp_ns": 1_000_000_000,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_1000000000.jpg",
            },
            {
                "timestamp_ns": 1_050_000_000,
                "topic": "/cam/left",
                "file_path": "thumbnails/left/frame_1050000000.jpg",
            },
            {
                "timestamp_ns": 1_500_000_001,
                "topic": "/cam/right",
                "file_path": "thumbnails/right/frame_1500000001.jpg",
            },
            {
                "timestamp_ns": 2_000_000_000,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_2000000000.jpg",
            },
            {
                "timestamp_ns": 2_060_000_000,
                "topic": "/cam/left",
                "file_path": "thumbnails/left/frame_2060000000.jpg",
            },
            {
                "timestamp_ns": 2_100_000_000,
                "topic": "/cam/right",
                "file_path": "thumbnails/right/frame_2100000000.jpg",
            },
        ],
    }
    bag, artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={"bag_path": str(bag), "start_ns": 0, "duration_sec": 3},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["cameras"] == ["/cam/front", "/cam/left", "/cam/right"]
    assert body["anchor_camera"] == "/cam/front"
    assert body["sample_tolerance_ns"] == 500_000_000
    assert [s["timestamp_ns"] for s in body["samples"]] == [
        1_000_000_000,
        2_000_000_000,
    ]
    first = body["samples"][0]
    assert first["anchor_frame"]["topic"] == "/cam/front"
    assert set(first["frames_by_camera"]) == {"/cam/front", "/cam/left"}
    assert first["frames_by_camera"]["/cam/left"]["delta_ns"] == 50_000_000
    assert first["frames_by_camera"]["/cam/front"]["file_path"] == str(
        artifact / "thumbnails/front/frame_1000000000.jpg"
    )


def test_samples_fallback_cameras_first_seen_and_missing_anchorless_camera(
    tmp_path, bypass_auth
):
    metadata = {
        "schema_version": 5,
        "frames": [
            {
                "timestamp_ns": 10_000_000_000,
                "topic": "/cam/b",
                "file_path": "thumbnails/b/frame_10.jpg",
            },
            {
                "timestamp_ns": 10_200_000_000,
                "topic": "/cam/a",
                "file_path": "thumbnails/a/frame_10.jpg",
            },
            {
                "timestamp_ns": 11_000_000_000,
                "topic": "/cam/b",
                "file_path": "thumbnails/b/frame_11.jpg",
            },
            {
                "timestamp_ns": 11_800_000_001,
                "topic": "/cam/a",
                "file_path": "thumbnails/a/frame_11.jpg",
            },
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 10_000_000_000,
            "duration_sec": 2,
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["cameras"] == ["/cam/b", "/cam/a"]
    assert body["anchor_camera"] == "/cam/b"
    assert set(body["samples"][1]["frames_by_camera"]) == {"/cam/b"}


def test_samples_focus_path_forces_exact_frame_and_marks_focus(
    tmp_path, bypass_auth
):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {
                "timestamp_ns": 1_000_000_000,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_a.jpg",
            },
            {
                "timestamp_ns": 1_000_000_000,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_b.jpg",
            },
        ],
    }
    bag, artifact = _write_bag(tmp_path, metadata)
    focus_abs = artifact / "thumbnails/front/frame_b.jpg"

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": str(focus_abs),
        },
    )

    assert resp.status_code == 200
    sample = resp.json()["samples"][0]
    frame = sample["frames_by_camera"]["/cam/front"]
    assert frame["file_path"] == str(focus_abs)
    assert frame["is_focus"] is True


def test_samples_focus_path_accepts_artifact_relative_path(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {
                "timestamp_ns": 1,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_1.jpg",
            },
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": "thumbnails/front/frame_1.jpg",
        },
    )

    assert resp.status_code == 200
    assert (
        resp.json()["samples"][0]["frames_by_camera"]["/cam/front"]["is_focus"]
        is True
    )


def test_samples_focus_path_not_found_returns_404(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {
                "timestamp_ns": 1,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_1.jpg",
            },
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={
            "bag_path": str(bag),
            "start_ns": 0,
            "duration_sec": 1,
            "focus_file_path": "thumbnails/front/missing.jpg",
        },
    )

    assert resp.status_code == 404
    assert "focus_file_path" in resp.json()["detail"]


def test_samples_requires_duration_sec(tmp_path, bypass_auth):
    metadata = {
        "schema_version": 5,
        "cameras": ["/cam/front"],
        "frames": [
            {
                "timestamp_ns": 1,
                "topic": "/cam/front",
                "file_path": "thumbnails/front/frame_1.jpg",
            },
        ],
    }
    bag, _artifact = _write_bag(tmp_path, metadata)

    resp = _client(bypass_auth).get(
        "/api/bags/samples",
        params={"bag_path": str(bag), "start_ns": 0},
    )

    assert resp.status_code == 422
