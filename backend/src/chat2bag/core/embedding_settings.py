"""App-side bridge: AppConfig → data_extraction_lib EmbeddingSettings.

The library's embedder takes an explicit EmbeddingSettings (mechanism, not policy);
this thin adapter packs the four scattered AppConfig fields the webapp loads from
settings.yaml into that object. It is the embedding analogue of the geo step's
area_payload bridge. Device is intentionally absent — it is passed to create_embedder
separately, as runtime placement.
"""

from data_extraction_lib.embedding import EmbeddingSettings

from chat2bag.core.app_config import AppConfig


def embedding_settings_from_config(config: AppConfig) -> EmbeddingSettings:
    """Map the webapp's AppConfig onto the library's EmbeddingSettings."""
    return EmbeddingSettings(
        backend=config.embedding.backend,
        model_id=config.embedding.model,
        model_storage=config.models.model_storage,
        batch_size=config.ingestion.batch_size,
        encode_long_side=config.embedding.encode_long_side,
    )
