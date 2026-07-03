from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.api import bags_router


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def test_status_returns_error_message(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "broken_bag"
    bag.mkdir()
    resolved = str(bag.resolve())
    monkeypatch.setattr("chat2bag.api.bags.indexing_status", {resolved: "error"})
    monkeypatch.setattr("chat2bag.api.bags.indexing_errors", {resolved: "boom while extracting"})

    resp = _client(bypass_auth).get("/api/bags/status", params={"bag_path": resolved})

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert body["error_message"] == "boom while extracting"


def test_status_error_message_is_null_when_clean(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "ok_bag"
    bag.mkdir()
    resolved = str(bag.resolve())
    monkeypatch.setattr("chat2bag.api.bags.indexing_status", {})
    monkeypatch.setattr("chat2bag.api.bags.indexing_errors", {})

    resp = _client(bypass_auth).get("/api/bags/status", params={"bag_path": resolved})

    assert resp.status_code == 200
    assert resp.json()["error_message"] is None


def test_scan_includes_error_message_per_bag(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "2025-10-23_15-42"
    bag.mkdir()
    (bag / "rec.mcap").write_bytes(b"")
    resolved = str(bag.resolve())
    monkeypatch.setattr("chat2bag.api.bags.indexing_status", {resolved: "error"})
    monkeypatch.setattr("chat2bag.api.bags.indexing_errors", {resolved: "kaput"})

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})

    assert resp.status_code == 200
    found = [b for b in resp.json()["bags"] if b["bag_path"] == resolved]
    assert len(found) == 1
    assert found[0]["error_message"] == "kaput"
    assert found[0]["status"] == "error"
