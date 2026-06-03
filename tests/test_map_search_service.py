import dataclasses
import json

from src.core.app_config import get_app_config
from src.core.storage import resolve_artifact_path
from src.services.map_search_service import MapSearchService


def _write_bag(tmp_path, name, frames):
    bag = tmp_path / name
    artifact = resolve_artifact_path(bag_path=bag)
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(json.dumps({"schema_version": 5, "frames": frames}))
    return str(bag)


def _f(ts, topic, fp, lat, lon):
    return {"timestamp_ns": ts, "topic": topic, "file_path": fp, "lat": lat, "lon": lon}


def test_browse_returns_in_area_chronological_no_score(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _f(1 * s, "/c", "f1.jpg", 45.0, 10.0),     # inside
        _f(2 * s, "/c", "f2.jpg", 48.0, 12.0),     # outside
        _f(3 * s, "/c", "f3.jpg", 45.0, 10.0001),  # inside
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100},
                       [bag])
    # both inside frames are >20s? no — they are 2s apart, same (bag,topic) → dedup to earliest
    assert [r["timestamp_ns"] for r in rows] == [1 * s]
    assert "similarity_score" not in rows[0]
    assert rows[0]["lat"] == 45.0 and "distance_m" in rows[0]


def test_browse_keeps_separate_passes_and_all_cameras(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _f(1 * s, "/cam/a", "a1.jpg", 45.0, 10.0),
        _f(1 * s, "/cam/b", "b1.jpg", 45.0, 10.0),   # different camera, same time → kept
        _f(100 * s, "/cam/a", "a2.jpg", 45.0, 10.0), # >20s later, same camera → kept
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100}, [bag])
    assert len(rows) == 3


def test_browse_cap_truncates(tmp_path):
    s = 1_000_000_000
    frames = [_f(i * 100 * s, "/c", f"f{i}.jpg", 45.0, 10.0) for i in range(10)]
    bag = _write_bag(tmp_path, "b", frames)
    base = get_app_config()
    cfg = dataclasses.replace(base, search=dataclasses.replace(base.search, map_browse_cap=3))
    svc = MapSearchService(config=cfg)
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100}, [bag])
    assert len(rows) == 3


def test_browse_requires_bags():
    import pytest
    with pytest.raises(ValueError):
        MapSearchService(config=get_app_config()).browse(
            {"kind": "circle", "center": {"lat": 0, "lon": 0}, "radius_m": 1}, [])
