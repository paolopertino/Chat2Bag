import json

from src.core.index_stamp import (
    is_region_stamp_compatible,
    read_region_stamp,
    write_region_stamp,
)


def test_metadata_schema_version_is_4():
    from src.core.schema_versions import METADATA_SCHEMA_VERSION
    assert METADATA_SCHEMA_VERSION == 4


def test_read_region_returns_none_when_unstamped(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 4, "frames": [], "region_index": None}))
    assert read_region_stamp(meta) is None


def test_write_then_read_region_roundtrip(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 4, "frames": [{"timestamp_ns": 1}], "embedder": {"name": "x", "dim": 4}}))
    write_region_stamp(meta, name="tipsv2:m", dim=1024, feature="value-attention", encode_long_side=896, pq={"m": 64, "nbits": 8}, patch_count=123)
    stamp = read_region_stamp(meta)
    assert stamp["embedder_name"] == "tipsv2:m"
    assert stamp["dim"] == 1024
    assert stamp["feature"] == "value-attention"
    assert stamp["encode_long_side"] == 896
    assert stamp["patch_count"] == 123
    # Other fields preserved.
    assert json.loads(meta.read_text())["frames"] == [{"timestamp_ns": 1}]
    assert json.loads(meta.read_text())["embedder"] == {"name": "x", "dim": 4}


def test_region_compatible_matches_identity_fields():
    stamp = {"embedder_name": "a", "dim": 4, "feature": "value-attention", "encode_long_side": 896}
    assert is_region_stamp_compatible(stamp, "a", 4, "value-attention", 896) is True
    assert is_region_stamp_compatible(stamp, "b", 4, "value-attention", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 8, "value-attention", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 4, "last-layer", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 4, "value-attention", 1120) is False
    assert is_region_stamp_compatible(None, "a", 4, "value-attention", 896) is False
