import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import bags_router
from data_extraction_lib.artifacts import BagArtifacts, EmbedderStamp, IndexManifest


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def _clear_stores(monkeypatch):
    monkeypatch.setattr("src.api.bags.indexing_status", {})
    monkeypatch.setattr("src.api.bags.indexing_errors", {})


def test_scan_is_indexed_reflects_manifest_not_lancedb(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    # Bag A: stray empty lancedb dir, NO manifest -> NOT indexed.
    a = tmp_path / "bag_a"
    (a / ".bag_chat" / "lancedb").mkdir(parents=True)
    (a / "rec.mcap").write_bytes(b"")
    # Bag B: manifest present -> indexed.
    b = tmp_path / "bag_b"
    (b / ".bag_chat").mkdir(parents=True)
    (b / "rec.mcap").write_bytes(b"")
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=1, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(b / ".bag_chat"))

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})
    assert resp.status_code == 200
    by_name = {x["bag_name"]: x for x in resp.json()["bags"]}
    assert by_name["bag_a"]["is_indexed"] is False
    assert by_name["bag_b"]["is_indexed"] is True


def test_scan_reports_has_raw_data(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    raw = tmp_path / "raw_bag"
    raw.mkdir()
    (raw / "rec.mcap").write_bytes(b"")
    idx = tmp_path / "idx_bag"
    (idx / ".bag_chat").mkdir(parents=True)
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=1, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(idx / ".bag_chat"))

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})
    by_name = {x["bag_name"]: x for x in resp.json()["bags"]}
    assert by_name["raw_bag"]["has_raw_data"] is True
    assert by_name["idx_bag"]["has_raw_data"] is False


def test_scan_backfills_legacy_index_only(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    art = tmp_path / "legacy_bag" / ".bag_chat"
    art.mkdir(parents=True)
    (art / "metadata.json").write_text(json.dumps({
        "schema_version": 5,
        "embedder": {"name": "x", "dim": 4},
        "frames": [{"timestamp_ns": 1, "topic": "/c"}],
    }))

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})
    by_name = {x["bag_name"]: x for x in resp.json()["bags"]}
    assert by_name["legacy_bag"]["is_indexed"] is True
    assert (art / "index_manifest.json").exists()


def test_scan_backfills_legacy_raw_bag(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    raw = tmp_path / "legacy_raw"
    raw.mkdir()
    (raw / "rec.mcap").write_bytes(b"")
    art = raw / ".bag_chat"
    art.mkdir()
    (art / "metadata.json").write_text(json.dumps({
        "schema_version": 5,
        "embedder": {"name": "x", "dim": 4},
        "frames": [{"timestamp_ns": 1, "topic": "/c"}],
    }))

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})
    by_name = {x["bag_name"]: x for x in resp.json()["bags"]}
    assert by_name["legacy_raw"]["is_indexed"] is True
    assert (art / "index_manifest.json").exists()


def test_status_done_from_manifest(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    bag = tmp_path / "done_bag"
    (bag / ".bag_chat").mkdir(parents=True)
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=1, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(bag / ".bag_chat"))
    resp = _client(bypass_auth).get(
        "/api/bags/status", params={"bag_path": str(bag.resolve())}
    )
    assert resp.json()["status"] == "done"


def test_status_idle_with_stray_lancedb_but_no_manifest(tmp_path, bypass_auth, monkeypatch):
    _clear_stores(monkeypatch)
    bag = tmp_path / "stray_bag"
    (bag / ".bag_chat" / "lancedb").mkdir(parents=True)
    resp = _client(bypass_auth).get(
        "/api/bags/status", params={"bag_path": str(bag.resolve())}
    )
    assert resp.json()["status"] == "idle"
