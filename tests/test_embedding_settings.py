from data_extraction_lib.embedding import EmbeddingSettings

from chat2bag.core.app_config import get_app_config
from chat2bag.core.embedding_settings import embedding_settings_from_config


def test_bridge_maps_all_appconfig_fields():
    cfg = get_app_config()
    settings = embedding_settings_from_config(cfg)
    assert isinstance(settings, EmbeddingSettings)
    assert settings.backend == cfg.embedding.backend
    assert settings.model_id == cfg.embedding.model
    assert settings.model_storage == cfg.models.model_storage
    assert settings.batch_size == cfg.ingestion.batch_size
    assert settings.encode_long_side == cfg.embedding.encode_long_side
