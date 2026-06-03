import json
from pathlib import Path

from src.core.index_stamp import (
    is_stamp_compatible,
    read_embedder_stamp,
    write_embedder_stamp,
)


def _write_meta(path: Path, embedder) -> None:
    path.write_text(json.dumps({"schema_version": 3, "frames": [], "embedder": embedder}))


def test_read_returns_none_for_missing_file(tmp_path):
    assert read_embedder_stamp(tmp_path / "nope.json") is None


def test_read_returns_none_when_unstamped(tmp_path):
    meta = tmp_path / "metadata.json"
    _write_meta(meta, None)
    assert read_embedder_stamp(meta) is None


def test_write_then_read_roundtrip_preserves_frames(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 3, "frames": [{"timestamp_ns": 1}], "embedder": None}))
    write_embedder_stamp(meta, name="siglip2:foo", dim=768)
    stamp = read_embedder_stamp(meta)
    assert stamp == {"name": "siglip2:foo", "dim": 768}
    # frames untouched
    assert json.loads(meta.read_text())["frames"] == [{"timestamp_ns": 1}]


def test_compatible_only_on_name_and_dim_match():
    assert is_stamp_compatible({"name": "a", "dim": 4}, "a", 4) is True
    assert is_stamp_compatible({"name": "a", "dim": 4}, "b", 4) is False
    assert is_stamp_compatible({"name": "a", "dim": 4}, "a", 8) is False
    assert is_stamp_compatible(None, "a", 4) is False


import json as _json

from src.core.index_stamp import build_gps_stamp, gps_is_located, read_gps_stamp


def test_build_gps_stamp_shape():
    stamp = build_gps_stamp(
        topic="/oxts/nav_sat_fix", max_gap_sec=1.0,
        fix_count=60112, located_frame_count=587, frame_count=642,
    )
    assert stamp == {
        "topic": "/oxts/nav_sat_fix", "max_gap_sec": 1.0,
        "fix_count": 60112, "located_frame_count": 587, "frame_count": 642,
    }


def test_read_gps_stamp_none_when_absent(tmp_path):
    p = tmp_path / "metadata.json"
    p.write_text(_json.dumps({"schema_version": 5, "frames": []}))
    assert read_gps_stamp(p) is None


def test_read_gps_stamp_returns_dict(tmp_path):
    p = tmp_path / "metadata.json"
    p.write_text(_json.dumps({"schema_version": 5, "gps": {"located_frame_count": 3}, "frames": []}))
    assert read_gps_stamp(p) == {"located_frame_count": 3}


def test_gps_is_located():
    assert gps_is_located({"located_frame_count": 1}) is True
    assert gps_is_located({"located_frame_count": 0}) is False
    assert gps_is_located(None) is False
