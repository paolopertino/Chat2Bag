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
