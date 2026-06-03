from src.embedding.base import FrameEmbedder
from src.embedding.registry import create_embedder, register_embedder

# Import backend modules so their @register_embedder decorators run on package import.
from src.embedding import siglip2 as _siglip2  # noqa: F401
from src.embedding import tipsv2 as _tipsv2  # noqa: F401

__all__ = ["FrameEmbedder", "create_embedder", "register_embedder"]
