from src.embedding.base import FrameEmbedder

_REGISTRY: dict[str, type[FrameEmbedder]] = {}


def register_embedder(key: str):
    """Class decorator that registers a FrameEmbedder subclass under a string key."""

    def _decorator(cls: type[FrameEmbedder]) -> type[FrameEmbedder]:
        _REGISTRY[key] = cls
        return cls

    return _decorator


def create_embedder(config) -> FrameEmbedder:
    """Instantiate the embedder selected by config.embedding.backend.

    `config` is an AppConfig (or any object exposing `.embedding.backend`).
    """
    key = config.embedding.backend
    if key not in _REGISTRY:
        raise ValueError(
            f"Unknown embedding backend '{key}'. Registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[key](config)
