import json
from pathlib import Path

from src.services.frame_location import attach_locations


def _bag_with_metadata(tmp_path: Path) -> str:
    bag = tmp_path / "bag_a"
    art = bag / ".bag_chat"  # match tests/test_bags_track.py::_bag
    art.mkdir(parents=True)
    frames = [
        {"timestamp_ns": 1, "topic": "/cam", "file_path": "f1.jpg", "lat": 45.1, "lon": 9.1},
        {"timestamp_ns": 2, "topic": "/cam", "file_path": "f2.jpg"},  # unlocated
    ]
    (art / "metadata.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")
    return str(bag.resolve())


def test_attach_fills_missing_lat_lon(tmp_path):
    bag = _bag_with_metadata(tmp_path)
    hits = [{"bag_path": bag, "topic": "/cam", "timestamp_ns": 1, "similarity_score": 0.9}]
    attach_locations(hits)
    assert hits[0]["lat"] == 45.1 and hits[0]["lon"] == 9.1


def test_attach_leaves_unlocated_and_existing_untouched(tmp_path):
    bag = _bag_with_metadata(tmp_path)
    hits = [
        {"bag_path": bag, "topic": "/cam", "timestamp_ns": 2},          # frame has no Fix
        {"bag_path": bag, "topic": "/cam", "timestamp_ns": 1, "lat": 1.0, "lon": 2.0},
    ]
    attach_locations(hits)
    assert "lat" not in hits[0]
    assert hits[1]["lat"] == 1.0  # pre-existing value wins


def test_attach_survives_missing_metadata(tmp_path):
    hits = [{"bag_path": str(tmp_path / "nope"), "topic": "/cam", "timestamp_ns": 1}]
    attach_locations(hits)  # must not raise
    assert "lat" not in hits[0]
