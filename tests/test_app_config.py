import src.core.app_config as app_config_mod


_FAKE_SETTINGS = {
    "ingestion": {
        "camera_topics": ["/cam/front/compressed", "/cam/rear/compressed"],
        "sampling_fps": 1.0,
        "long_side": 840,
        "batch_size": 8,
        "gps_topic": "/oxts/nav_sat_fix",
        "gps_max_gap_sec": 1.0,
    },
    "storage": {"artifact_dir": ".bag_chat", "storage_path": None},
    "embedding": {"backend": "siglip2", "model": "google/siglip2-base-patch16-naflex"},
    "models": {
        "orchestration_llm": "gemma-2-9b",
        "video_vlm": "qwen3-vl:2b",
        "model_storage": "models",
    },
    "search": {"temporal_dedup_window_sec": 20.0, "map_browse_cap": 500},
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


def test_embedding_encode_long_side_defaults_to_896(monkeypatch):
    # _FAKE_SETTINGS has no encode_long_side → exercises the .get default.
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.embedding.encode_long_side == 896
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_region_search_config_defaults(monkeypatch):
    # _FAKE_SETTINGS has no region_search → exercises all parser defaults.
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        rc = app_config_mod.get_app_config().region_search
        assert rc.enabled is True
        assert rc.engine == "faiss"
        assert rc.pq_m == 64 and rc.pq_nbits == 8
        assert rc.ivf_nlist is None and rc.ivf_nprobe == 16
        assert rc.min_patches_for_pq == 10_000
        assert rc.train_sample_cap == 262_144
        assert rc.patch_fetch_limit == 4096
        assert rc.top_k_patches == 1
        assert rc.refine_enabled is False and rc.refine_top_n == 100
        assert "a photo of a {}." in rc.text_templates
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_ingestion_gps_fields_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.gps_topic == "/oxts/nav_sat_fix"
        assert cfg.ingestion.gps_max_gap_sec == 1.0
        assert cfg.search.map_browse_cap == 500
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_gps_fields_default_when_absent(monkeypatch):
    trimmed = {**_FAKE_SETTINGS, "ingestion": {
        k: v for k, v in _FAKE_SETTINGS["ingestion"].items()
        if k not in ("gps_topic", "gps_max_gap_sec")
    }, "search": {}}
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: trimmed)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.gps_topic is None
        assert cfg.ingestion.gps_max_gap_sec == 1.0
        assert cfg.search.map_browse_cap == 500
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
