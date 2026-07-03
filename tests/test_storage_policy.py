from dataclasses import replace
from pathlib import Path

from chat2bag.core.app_config import get_app_config
from chat2bag.core.storage import artifacts_for_bag


def test_beside_bag_when_no_storage_path(monkeypatch):
    cfg = get_app_config()
    storage = replace(cfg.storage, storage_path=None, artifact_dir=".bag_chat")
    monkeypatch.setattr("chat2bag.core.storage.get_app_config", lambda: replace(cfg, storage=storage))
    a = artifacts_for_bag(Path("/data/mybag"))
    assert a.dir == Path("/data/mybag/.bag_chat")
    assert a.metadata_path == Path("/data/mybag/.bag_chat/metadata.json")


def test_under_storage_path_keys_off_bag_name(monkeypatch):
    cfg = get_app_config()
    storage = replace(cfg.storage, storage_path="/store", artifact_dir=".bag_chat")
    monkeypatch.setattr("chat2bag.core.storage.get_app_config", lambda: replace(cfg, storage=storage))
    a = artifacts_for_bag(Path("/anywhere/mybag"))
    assert a.dir == Path("/store/mybag/.bag_chat")
