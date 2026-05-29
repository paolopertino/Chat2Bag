import src.core.app_config as app_config_mod


_FAKE_SETTINGS = {
    "ingestion": {
        "camera_topics": ["/cam/front/compressed", "/cam/rear/compressed"],
        "sampling_fps": 1.0,
        "long_side": 840,
        "batch_size": 8,
    },
    "storage": {"artifact_dir": ".bag_chat", "storage_path": None},
    "embedding": {"backend": "siglip2", "model": "google/siglip2-base-patch16-naflex"},
    "models": {
        "orchestration_llm": "gemma-2-9b",
        "video_vlm": "qwen3-vl:2b",
        "model_storage": "models",
    },
    "search": {"temporal_dedup_window_sec": 20.0},
    "api": {"scan_timeout_sec": 30.0},
    "extraction": {"service_url": None},
}


def test_embedding_block_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.embedding.backend == "siglip2"
        assert cfg.embedding.model == "google/siglip2-base-patch16-naflex"
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_ingestion_long_side_and_camera_topics_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.long_side == 840
        assert cfg.ingestion.camera_topics == (
            "/cam/front/compressed",
            "/cam/rear/compressed",
        )
        assert not hasattr(cfg.ingestion, "max_image_size")
        assert not hasattr(cfg.models, "embedding_model")
    finally:
        app_config_mod.get_app_config.cache_clear()
