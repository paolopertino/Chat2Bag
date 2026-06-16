import json

from src.core.index_manifest import (
    delete_index_manifest,
    is_indexed,
    manifest_path,
    read_index_manifest,
    write_index_manifest,
)


def test_write_then_read_roundtrip(tmp_path):
    write_index_manifest(
        tmp_path,
        embedder_name="google/tipsv2-l14",
        embedder_dim=1024,
        frame_count=1234,
        cameras=["/cam/b", "/cam/a"],
        region_index=True,
    )
    data = read_index_manifest(tmp_path)
    assert data is not None
    assert data["manifest_version"] == 1
    assert data["embedder"] == {"name": "google/tipsv2-l14", "dim": 1024}
    assert data["frame_count"] == 1234
    assert data["cameras"] == ["/cam/a", "/cam/b"]  # de-duped + sorted
    assert data["region_index"] is True
    assert data["completed_at"].endswith("Z")


def test_write_creates_artifact_dir_if_missing(tmp_path):
    target = tmp_path / "fresh" / ".bag_chat"
    write_index_manifest(
        target, embedder_name="x", embedder_dim=4,
        frame_count=1, cameras=["/c"], region_index=False,
    )
    assert is_indexed(target) is True


def test_is_indexed_true_after_write(tmp_path):
    assert is_indexed(tmp_path) is False
    write_index_manifest(
        tmp_path, embedder_name="x", embedder_dim=4,
        frame_count=1, cameras=["/c"], region_index=False,
    )
    assert is_indexed(tmp_path) is True


def test_read_none_for_missing(tmp_path):
    assert read_index_manifest(tmp_path) is None
    assert is_indexed(tmp_path) is False


def test_read_none_for_corrupt(tmp_path):
    manifest_path(tmp_path).write_text("{not json")
    assert read_index_manifest(tmp_path) is None
    assert is_indexed(tmp_path) is False


def test_read_none_when_version_missing(tmp_path):
    manifest_path(tmp_path).write_text(json.dumps({"embedder": {"name": "x", "dim": 4}}))
    assert read_index_manifest(tmp_path) is None


def test_newer_version_still_indexed(tmp_path):
    # Forward-compatible: a newer manifest version still counts as indexed.
    manifest_path(tmp_path).write_text(json.dumps({"manifest_version": 99}))
    assert is_indexed(tmp_path) is True


def test_delete_is_idempotent(tmp_path):
    delete_index_manifest(tmp_path)  # no file yet -> no raise
    write_index_manifest(
        tmp_path, embedder_name="x", embedder_dim=4,
        frame_count=1, cameras=["/c"], region_index=False,
    )
    assert is_indexed(tmp_path) is True
    delete_index_manifest(tmp_path)
    assert is_indexed(tmp_path) is False
    delete_index_manifest(tmp_path)  # again -> still no raise


from src.core.index_manifest import ensure_manifest


def _write_metadata(artifact_dir, *, embedder=None, region=None, frames=None):
    artifact_dir.mkdir(parents=True, exist_ok=True)
    meta = {"schema_version": 5, "frames": frames or []}
    if embedder is not None:
        meta["embedder"] = embedder
    if region is not None:
        meta["region_index"] = region
    (artifact_dir / "metadata.json").write_text(json.dumps(meta))


def test_ensure_manifest_backfills_from_legacy_stamp(tmp_path):
    art = tmp_path / ".bag_chat"
    _write_metadata(
        art,
        embedder={"name": "siglip2:foo", "dim": 768},
        frames=[{"timestamp_ns": 1, "topic": "/cam/a"},
                {"timestamp_ns": 2, "topic": "/cam/a"}],
    )
    assert is_indexed(art) is False
    assert ensure_manifest(art) is True
    assert is_indexed(art) is True
    data = read_index_manifest(art)
    assert data["embedder"] == {"name": "siglip2:foo", "dim": 768}
    assert data["frame_count"] == 2
    assert data["cameras"] == ["/cam/a"]
    assert data["region_index"] is False


def test_ensure_manifest_marks_region_when_stamped(tmp_path):
    art = tmp_path / ".bag_chat"
    _write_metadata(
        art,
        embedder={"name": "x", "dim": 4},
        region={"engine": "faiss"},
        frames=[{"timestamp_ns": 1, "topic": "/c"}],
    )
    assert ensure_manifest(art) is True
    assert read_index_manifest(art)["region_index"] is True


def test_ensure_manifest_noop_without_stamp(tmp_path):
    art = tmp_path / ".bag_chat"
    _write_metadata(art, frames=[{"timestamp_ns": 1, "topic": "/c"}])  # no embedder stamp
    assert ensure_manifest(art) is False
    assert is_indexed(art) is False


def test_ensure_manifest_noop_without_artifact_dir(tmp_path):
    assert ensure_manifest(tmp_path / "missing" / ".bag_chat") is False


def test_ensure_manifest_keeps_existing_manifest(tmp_path):
    art = tmp_path / ".bag_chat"
    write_index_manifest(
        art, embedder_name="real", embedder_dim=4,
        frame_count=9, cameras=["/c"], region_index=False,
    )
    # A stale legacy stamp must NOT overwrite a real manifest.
    _write_metadata(art, embedder={"name": "legacy", "dim": 768},
                    frames=[{"timestamp_ns": 1, "topic": "/c"}])
    assert ensure_manifest(art) is True
    data = read_index_manifest(art)
    assert data["embedder"] == {"name": "real", "dim": 4}
    assert data["frame_count"] == 9
