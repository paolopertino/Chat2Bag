import json

from src.api import bags as bags_mod
from data_extraction_lib.artifacts import BagArtifacts, EmbedderStamp, IndexManifest


def _raw_bag(root, name):
    bag = root / name
    bag.mkdir(parents=True)
    (bag / "rec.mcap").write_bytes(b"")
    return bag


def _indexed_only_bag(root, name, *, region=False):
    bag = root / name
    artifact = bag / ".bag_chat"
    artifact.mkdir(parents=True)
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=3, cameras=["/c"], region_index=region,
    ).write(BagArtifacts(artifact))
    return bag


def test_raw_bag_discovered(tmp_path):
    _raw_bag(tmp_path, "rawbag")
    found = {p.name for p in bags_mod._discover_bag_dirs(tmp_path)}
    assert found == {"rawbag"}


def test_index_only_bag_discovered(tmp_path):
    _indexed_only_bag(tmp_path, "idxbag")
    found = {p.name for p in bags_mod._discover_bag_dirs(tmp_path)}
    assert found == {"idxbag"}


def test_mcapless_without_manifest_not_discovered(tmp_path):
    art = tmp_path / "nope" / ".bag_chat"
    art.mkdir(parents=True)
    (art / "metadata.json").write_text("{}")  # no manifest, no embedder stamp
    found = {p.name for p in bags_mod._discover_bag_dirs(tmp_path)}
    assert found == set()


def test_raw_bag_with_failed_index_still_discovered(tmp_path):
    bag = _raw_bag(tmp_path, "failbag")
    (bag / ".bag_chat").mkdir()  # artifacts present but no manifest (failed index)
    found = {p.name for p in bags_mod._discover_bag_dirs(tmp_path)}
    assert found == {"failbag"}


def test_legacy_stamp_only_folder_discovered_and_healed(tmp_path):
    art = tmp_path / "legacy" / ".bag_chat"
    art.mkdir(parents=True)
    (art / "metadata.json").write_text(json.dumps({
        "schema_version": 5,
        "embedder": {"name": "x", "dim": 4},
        "frames": [{"timestamp_ns": 1, "topic": "/c"}],
    }))
    found = {p.name for p in bags_mod._discover_bag_dirs(tmp_path)}
    assert found == {"legacy"}
    # Lazy heal wrote the manifest during discovery.
    assert (art / "index_manifest.json").exists()


import pytest

import src.core.app_config as app_config_mod


def _storage_settings(storage_path):
    return {
        "ingestion": {
            "camera_topics": ["/c"], "sampling_fps": 1.0, "long_side": 840,
            "batch_size": 8, "gps_topic": None, "gps_max_gap_sec": 1.0,
        },
        "storage": {"artifact_dir": ".bag_chat", "storage_path": str(storage_path)},
        "embedding": {"backend": "siglip2", "model": "m"},
        "models": {"model_storage": "models"},
        "search": {},
        "api": {"scan_timeout_sec": 30.0},
        "extraction": {"service_url": None},
    }


@pytest.fixture
def storage_mode(monkeypatch):
    """Activate storage_path mode with a given root; clears the config cache."""
    def _apply(storage_path):
        monkeypatch.setattr(
            app_config_mod, "get_settings", lambda: _storage_settings(storage_path)
        )
        app_config_mod.get_app_config.cache_clear()
    yield _apply
    app_config_mod.get_app_config.cache_clear()


def test_storage_mode_index_only_bag_discovered(tmp_path, storage_mode):
    storage_root = tmp_path / "store"
    art = storage_root / "movedbag" / ".bag_chat"
    art.mkdir(parents=True)
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=3, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(art))
    storage_mode(storage_root)

    root = tmp_path / "raws"
    root.mkdir()
    found = {p.name for p in bags_mod._discover_bag_dirs(root)}
    assert "movedbag" in found


def test_storage_mode_dedups_preferring_raw(tmp_path, storage_mode):
    storage_root = tmp_path / "store"
    root = tmp_path / "raws"
    raw = root / "mybag"
    raw.mkdir(parents=True)
    (raw / "rec.mcap").write_bytes(b"")
    art = storage_root / "mybag" / ".bag_chat"
    art.mkdir(parents=True)
    IndexManifest(
        embedder=EmbedderStamp(name="x", dim=4), frame_count=3, cameras=["/c"], region_index=False,
    ).write(BagArtifacts(art))
    storage_mode(storage_root)

    found = bags_mod._discover_bag_dirs(root)
    mybag_entries = [p for p in found if p.name == "mybag"]
    assert len(mybag_entries) == 1          # deduped, not listed twice
    assert mybag_entries[0] == raw          # the raw folder wins over the synthetic path
