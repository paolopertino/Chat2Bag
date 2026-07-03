"""Tests for the dataset extraction backend.

Covers:
- Pure config helpers: ``_merge_config``, ``_deep_update``.
- ``_parse_extraction_config`` YAML parsing (incl. disabled / missing sections).
- ``ExtractionService._rewrite_path`` (path_strip_prefix behavior).
- ``ExtractionService.submit_extraction`` end-to-end with mocked httpx — verifies
  config merging, default output folder derivation, and bag-path rewriting.
- Router-level validation and auth-gating via FastAPI TestClient.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.api.datasets import router as datasets_router
from chat2bag.api.dependencies import get_extraction_service
from chat2bag.core.app_config import _parse_extraction_config
from chat2bag.core.extraction_config import ExtractionConfig
from chat2bag.services.extraction_service import (
    ExtractionService,
    _deep_update,
    _merge_config,
)


# ---------------------------------------------------------------------------
# Pure config-merge helpers
# ---------------------------------------------------------------------------


def test_deep_update_replaces_scalars():
    target = {"a": 1, "b": 2}
    _deep_update(target, {"a": 10})
    assert target == {"a": 10, "b": 2}


def test_deep_update_recurses_into_nested_dicts():
    target = {"outer": {"a": 1, "b": 2}, "untouched": True}
    _deep_update(target, {"outer": {"a": 10, "c": 3}})
    assert target == {"outer": {"a": 10, "b": 2, "c": 3}, "untouched": True}


def test_deep_update_replaces_dict_with_scalar():
    target = {"k": {"nested": True}}
    _deep_update(target, {"k": "scalar"})
    assert target == {"k": "scalar"}


def test_merge_config_user_overrides_base():
    base = {"sync_threshold": 0.02, "n_workers": 16}
    user = {"sync_threshold": 0.05}
    fixed: dict = {}
    result = _merge_config(base, user, fixed)
    assert result == {"sync_threshold": 0.05, "n_workers": 16}


def test_merge_config_fixed_overrides_user():
    base = {"bag_type": "rosbag", "debug": True}
    user = {"bag_type": "rosbag", "debug": True}
    fixed = {"bag_type": "mcap", "debug": False}
    result = _merge_config(base, user, fixed)
    assert result["bag_type"] == "mcap"
    assert result["debug"] is False


def test_merge_config_does_not_mutate_inputs():
    base = {"a": {"nested": 1}}
    user = {"a": {"nested": 2}}
    fixed = {"a": {"extra": 3}}
    base_snapshot = json.dumps(base)
    user_snapshot = json.dumps(user)
    fixed_snapshot = json.dumps(fixed)

    _merge_config(base, user, fixed)

    assert json.dumps(base) == base_snapshot
    assert json.dumps(user) == user_snapshot
    assert json.dumps(fixed) == fixed_snapshot


def test_merge_config_topics_inherited_from_base_when_user_omits():
    base = {"topics": [{"name": "LIDAR_CENTER", "is_sync_leader": True}]}
    user = {"calibration_path": "/x.urdf"}  # no `topics` override
    fixed: dict = {}
    result = _merge_config(base, user, fixed)
    assert result["topics"] == base["topics"]
    assert result["calibration_path"] == "/x.urdf"


# ---------------------------------------------------------------------------
# _parse_extraction_config
# ---------------------------------------------------------------------------


def test_parse_extraction_config_missing_section_returns_disabled():
    cfg = _parse_extraction_config(None)
    assert cfg.enabled is False
    assert cfg.service_url is None
    assert cfg.path_strip_prefix is None


def test_parse_extraction_config_null_service_url_returns_disabled():
    cfg = _parse_extraction_config({"service_url": None, "editable_fields": ["x"]})
    assert cfg.enabled is False


def test_parse_extraction_config_full_section():
    raw = yaml.safe_load(
        """
service_url: http://localhost:8765
request_timeout_sec: 5.0
default_output_subdir: my_extractions
path_strip_prefix: /adehome
editable_fields:
  - calibration_path
  - n_workers
fixed_overrides:
  bag_type: mcap
  append_dataset: false
"""
    )
    cfg = _parse_extraction_config(raw)
    assert cfg.enabled is True
    assert cfg.service_url == "http://localhost:8765"
    assert cfg.request_timeout_sec == 5.0
    assert cfg.default_output_subdir == "my_extractions"
    assert cfg.path_strip_prefix == "/adehome"
    assert cfg.editable_fields == ("calibration_path", "n_workers")
    assert cfg.fixed_overrides == {"bag_type": "mcap", "append_dataset": False}


def test_parse_extraction_config_path_strip_prefix_omitted_is_none():
    raw = {"service_url": "http://localhost:8765"}
    cfg = _parse_extraction_config(raw)
    assert cfg.path_strip_prefix is None


# ---------------------------------------------------------------------------
# ExtractionService — path rewriting + base URL handling
# ---------------------------------------------------------------------------


def _make_config(**overrides) -> ExtractionConfig:
    base = dict(
        enabled=True,
        service_url="http://localhost:8765",
        request_timeout_sec=10.0,
        default_output_subdir="nuscenes_extractions",
        editable_fields=("calibration_path", "n_workers"),
        fixed_overrides={"bag_type": "mcap"},
        path_strip_prefix=None,
    )
    base.update(overrides)
    return ExtractionConfig(**base)


def test_rewrite_path_strips_matching_prefix():
    svc = ExtractionService(_make_config(path_strip_prefix="/adehome"))
    assert svc._rewrite_path("/adehome/data/bags/foo") == "/data/bags/foo"


def test_rewrite_path_leaves_non_matching_path_unchanged():
    svc = ExtractionService(_make_config(path_strip_prefix="/adehome"))
    assert svc._rewrite_path("/srv/bags/foo") == "/srv/bags/foo"


def test_rewrite_path_no_op_when_prefix_is_none():
    svc = ExtractionService(_make_config(path_strip_prefix=None))
    assert svc._rewrite_path("/adehome/data/foo") == "/adehome/data/foo"


def test_rewrite_path_strips_exactly_matching_path():
    svc = ExtractionService(_make_config(path_strip_prefix="/adehome"))
    assert svc._rewrite_path("/adehome") == ""


def test_service_strips_trailing_slash_from_base_url():
    svc = ExtractionService(_make_config(service_url="http://localhost:8765/"))
    assert svc._base == "http://localhost:8765"


# ---------------------------------------------------------------------------
# submit_extraction with mocked httpx
# ---------------------------------------------------------------------------


def _install_mock_transport(monkeypatch, handler) -> list[httpx.Request]:
    """Inject an httpx.MockTransport into all AsyncClient instances created by the service.

    Returns a list that is appended to with each intercepted Request, so tests
    can inspect what was sent.
    """
    seen: list[httpx.Request] = []

    def wrapped_handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    transport = httpx.MockTransport(wrapped_handler)
    original = httpx.AsyncClient

    def patched(**kwargs):
        kwargs["transport"] = transport
        return original(**kwargs)

    monkeypatch.setattr(
        "chat2bag.services.extraction_service.httpx.AsyncClient", patched
    )
    return seen


def _default_handler(defaults: dict | None = None, job_id: str = "abc123"):
    """Build a handler that responds to /config/defaults and /extract."""
    defaults = defaults or {
        "bag_type": "rosbag",
        "sync_threshold": 0.02,
        "n_workers": 4,
        "calibration_path": None,
        "topics": [{"name": "LIDAR_CENTER", "is_sync_leader": True}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/config/defaults":
            return httpx.Response(200, json=defaults)
        if request.url.path == "/extract":
            return httpx.Response(202, json={"job_id": job_id})
        return httpx.Response(404, json={"detail": "not found"})

    return handler


@pytest.mark.asyncio
async def test_submit_extraction_merges_config_with_fixed_winning(monkeypatch):
    cfg = _make_config(
        editable_fields=("calibration_path", "n_workers"),
        fixed_overrides={"bag_type": "mcap", "debug": False},
    )
    seen = _install_mock_transport(monkeypatch, _default_handler())

    svc = ExtractionService(cfg)
    job_id = await svc.submit_extraction(
        bag_path="/srv/bags/test_bag",
        mode="window",
        user_config={"calibration_path": "/etc/calib.urdf", "n_workers": 8, "bag_type": "rosbag"},
        output_folder="/tmp/out",
        timestamp_ns=1_700_000_000_000_000_000,
        window_length_s=10.0,
    )

    assert job_id == "abc123"
    extract_request = next(r for r in seen if r.url.path == "/extract")
    payload = json.loads(extract_request.content)
    config = payload["config"]
    # Fixed overrides win
    assert config["bag_type"] == "mcap"
    assert config["debug"] is False
    # User editable fields applied
    assert config["calibration_path"] == "/etc/calib.urdf"
    assert config["n_workers"] == 8
    # Topics inherited from microservice defaults
    assert config["topics"] == [{"name": "LIDAR_CENTER", "is_sync_leader": True}]


@pytest.mark.asyncio
async def test_submit_extraction_translates_start_window_to_center_half_span(monkeypatch):
    """The app expresses a window as [start, start+length]; the microservice's
    extract_bag_window treats ``timestamp_ns`` as the window CENTER and
    ``window_length_s`` as seconds on EACH side. The service must translate."""
    cfg = _make_config()
    seen = _install_mock_transport(monkeypatch, _default_handler())
    svc = ExtractionService(cfg)

    start_ns = 2_000_000_000
    await svc.submit_extraction(
        bag_path="/srv/bags/test_bag",
        mode="window",
        user_config={},
        output_folder="/tmp/out",
        timestamp_ns=start_ns,
        window_length_s=10.0,
    )

    payload = json.loads(next(r for r in seen if r.url.path == "/extract").content)
    # center = start + length/2 ; half-span = length/2
    assert payload["timestamp_ns"] == start_ns + 5_000_000_000
    assert payload["window_length_s"] == 5.0


@pytest.mark.asyncio
async def test_submit_extraction_uses_provided_output_folder(monkeypatch):
    cfg = _make_config()
    seen = _install_mock_transport(monkeypatch, _default_handler())
    svc = ExtractionService(cfg)

    await svc.submit_extraction(
        bag_path="/srv/bags/test_bag",
        mode="window",
        user_config={},
        output_folder="/explicit/out/path",
        timestamp_ns=1, window_length_s=1.0,
    )

    extract_request = next(r for r in seen if r.url.path == "/extract")
    payload = json.loads(extract_request.content)
    assert payload["output_folder"] == "/explicit/out/path"


@pytest.mark.asyncio
async def test_submit_extraction_computes_default_output_under_artifact_dir(monkeypatch, tmp_path: Path):
    """When output_folder is omitted, the service should derive it under the bag's artifact dir."""
    bag_dir = tmp_path / "my_bag"
    bag_dir.mkdir()

    cfg = _make_config(default_output_subdir="nuscenes_extractions")
    seen = _install_mock_transport(monkeypatch, _default_handler())
    svc = ExtractionService(cfg)

    await svc.submit_extraction(
        bag_path=str(bag_dir),
        mode="window",
        user_config={},
        output_folder=None,
        timestamp_ns=1,
        window_length_s=1.0,
    )

    extract_request = next(r for r in seen if r.url.path == "/extract")
    payload = json.loads(extract_request.content)
    out = payload["output_folder"]
    # Path shape: <bag_dir>/<artifact_dir>/nuscenes_extractions/<uuid hex>
    assert out.startswith(str(bag_dir))
    assert "/nuscenes_extractions/" in out
    # UUID hex is 32 chars at the end
    suffix = out.rsplit("/", 1)[-1]
    assert len(suffix) == 32 and all(c in "0123456789abcdef" for c in suffix)


@pytest.mark.asyncio
async def test_submit_extraction_strips_path_prefix_before_send(monkeypatch):
    cfg = _make_config(path_strip_prefix="/adehome")
    seen = _install_mock_transport(monkeypatch, _default_handler())
    svc = ExtractionService(cfg)

    await svc.submit_extraction(
        bag_path="/adehome/srv/bags/test_bag",
        mode="window",
        user_config={},
        output_folder="/explicit/out",
        timestamp_ns=1,
        window_length_s=1.0,
    )

    extract_request = next(r for r in seen if r.url.path == "/extract")
    payload = json.loads(extract_request.content)
    assert payload["bag_path"] == "/srv/bags/test_bag"


@pytest.mark.asyncio
async def test_submit_extraction_does_not_strip_output_folder(monkeypatch, tmp_path: Path):
    """The strip applies to bag_path only — output_folder should keep host-side prefix."""
    bag_dir = tmp_path / "my_bag"
    bag_dir.mkdir()
    # Pretend the bag lives under /adehome
    bag_path_with_prefix = "/adehome" + str(bag_dir)
    cfg = _make_config(path_strip_prefix="/adehome")
    seen = _install_mock_transport(monkeypatch, _default_handler())
    svc = ExtractionService(cfg)

    await svc.submit_extraction(
        bag_path=bag_path_with_prefix,
        mode="window",
        user_config={},
        output_folder=None,  # let the service compute it
        timestamp_ns=1,
        window_length_s=1.0,
    )

    extract_request = next(r for r in seen if r.url.path == "/extract")
    payload = json.loads(extract_request.content)
    # Sent bag_path is stripped...
    assert payload["bag_path"] == str(bag_dir)
    # ...but output_folder is still computed from the *original* (with-prefix) path.
    assert payload["output_folder"].startswith(bag_path_with_prefix)


# ---------------------------------------------------------------------------
# Router-level tests
# ---------------------------------------------------------------------------


def _build_router_app(svc: ExtractionService, bypass_auth) -> FastAPI:
    app = FastAPI()
    app.include_router(datasets_router)
    bypass_auth(app)
    app.dependency_overrides[get_extraction_service] = lambda: svc
    return app


class _StubExtractionService:
    """Minimal stub matching the surface called by the router."""

    def __init__(self):
        self.submitted: list[dict[str, Any]] = []

    async def get_service_defaults(self) -> dict:
        return {"bag_type": "mcap"}

    async def get_config_schema(self) -> dict:
        return {
            "enabled": True,
            "editable_fields": ["calibration_path"],
            "defaults": {"calibration_path": None},
            "fixed_overrides_preview": {"bag_type": "mcap"},
        }

    async def submit_extraction(self, **kwargs):
        self.submitted.append(kwargs)
        return "fake-job-id"

    async def list_jobs(self):
        return []


def test_extract_endpoint_rejects_window_mode_without_timestamp(bypass_auth):
    stub = _StubExtractionService()
    client = TestClient(_build_router_app(stub, bypass_auth))

    resp = client.post(
        "/api/datasets/extract",
        json={"bag_path": "/x", "mode": "window"},  # missing timestamp_ns + window_length_s
    )
    assert resp.status_code == 422
    assert "timestamp_ns" in resp.json()["detail"]
    assert stub.submitted == []


def test_extract_endpoint_forwards_to_service(bypass_auth):
    stub = _StubExtractionService()
    client = TestClient(_build_router_app(stub, bypass_auth))

    resp = client.post(
        "/api/datasets/extract",
        json={
            "bag_path": "/srv/bags/test",
            "mode": "window",
            "timestamp_ns": 12345,
            "window_length_s": 10,
            "user_config": {"calibration_path": "/etc/x.urdf"},
        },
    )
    assert resp.status_code == 202
    assert resp.json() == {"job_id": "fake-job-id"}
    assert len(stub.submitted) == 1
    assert stub.submitted[0]["bag_path"] == "/srv/bags/test"
    assert stub.submitted[0]["timestamp_ns"] == 12345


def test_config_schema_endpoint_returns_filtered_defaults(bypass_auth):
    stub = _StubExtractionService()
    client = TestClient(_build_router_app(stub, bypass_auth))

    resp = client.get("/api/datasets/config/schema")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["editable_fields"] == ["calibration_path"]
    assert body["fixed_overrides_preview"] == {"bag_type": "mcap"}


def test_get_extraction_service_dependency_returns_404_when_disabled(bypass_auth):
    """When the feature is disabled, the dependency should raise 404 on every endpoint."""
    from fastapi import Request

    class _AppState:
        class _Config:
            extraction = ExtractionConfig.disabled()
        app_config = _Config()

    class _FakeApp:
        state = _AppState()

    class _FakeRequest:
        app = _FakeApp()

    with pytest.raises(Exception) as exc_info:
        get_extraction_service(_FakeRequest())  # type: ignore[arg-type]
    # FastAPI HTTPException carries .status_code
    assert getattr(exc_info.value, "status_code", None) == 404
