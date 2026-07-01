import dataclasses
from pathlib import Path

from data_extraction_lib.artifacts import Metadata
from src.core.app_config import get_app_config
from src.core.storage import artifacts_for_bag
from src.services.map_search_service import MapSearchService


def _frame(ts: int, topic: str, fp: str, lat: float, lon: float) -> dict:
    return {"timestamp_ns": ts, "topic": topic, "file_path": fp, "lat": lat, "lon": lon}


def _write_bag(tmp_path: Path, name: str, frames: list[dict]) -> str:
    bag = tmp_path / name
    artifacts = artifacts_for_bag(bag)
    meta = Metadata(bag_name=name, cameras=[], frames=frames)
    meta.save(artifacts)
    return str(bag)


def test_browse_returns_in_area_chronological_no_score(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _frame(1 * s, "/c", "f1.jpg", 45.0, 10.0),     # inside
        _frame(2 * s, "/c", "f2.jpg", 48.0, 12.0),     # outside
        _frame(3 * s, "/c", "f3.jpg", 45.0, 10.0001),  # inside
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100},
                       [bag])
    # Both inside frames are 2s apart, same (bag, topic) — dedup collapses to earliest.
    assert [r["timestamp_ns"] for r in rows] == [1 * s]
    assert "similarity_score" not in rows[0]
    assert rows[0]["lat"] == 45.0 and "distance_m" in rows[0]
    # file_path is ABSOLUTE so the browse tile preview is fetchable via /api/image.
    assert rows[0]["file_path"] == str(artifacts_for_bag(Path(bag)).dir / "f1.jpg")


def test_browse_keeps_separate_passes_and_all_cameras(tmp_path):
    s = 1_000_000_000
    bag = _write_bag(tmp_path, "b", [
        _frame(1 * s, "/cam/a", "a1.jpg", 45.0, 10.0),
        _frame(1 * s, "/cam/b", "b1.jpg", 45.0, 10.0),   # different camera, same time — kept
        _frame(100 * s, "/cam/a", "a2.jpg", 45.0, 10.0), # >20s later, same camera — kept
    ])
    svc = MapSearchService(config=get_app_config())
    rows = svc.browse({"kind": "circle", "center": {"lat": 45.0, "lon": 10.0}, "radius_m": 100}, [bag])
    assert len(rows) == 3


def test_browse_cap_truncates(tmp_path):
    s = 1_000_000_000
    frames = [_frame(i * 100 * s, "/c", f"f{i}.jpg", 45.0, 10.0) for i in range(10)]
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
