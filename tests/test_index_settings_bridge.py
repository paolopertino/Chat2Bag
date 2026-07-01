from data_extraction_lib.index import IndexSettings

from src.core.app_config import get_app_config
from src.core.index_settings import index_settings_from_config


def test_maps_region_config_to_index_settings():
    config = get_app_config()
    settings = index_settings_from_config(config)
    assert isinstance(settings, IndexSettings)
    assert settings.pq_m == config.region_search.pq_m
    assert settings.text_templates == config.region_search.text_templates
