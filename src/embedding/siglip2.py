import os

import numpy as np
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

from src.embedding.base import FrameEmbedder
from src.embedding.registry import register_embedder


@register_embedder("siglip2")
class Siglip2Embedder(FrameEmbedder):
    """SigLIP-2 backend. Wraps the original AutoModel/AutoProcessor code paths."""

    def __init__(self, config):
        self._model_id = config.embedding.model
        self._storage = config.models.model_storage
        self._batch_hint = max(1, int(config.ingestion.batch_size))
        self._device = "cpu"

        self._model = self._load(AutoModel)
        self._processor = self._load(AutoProcessor)
        self._model.eval()

        # Derive embedding_dim from a real forward pass — model-agnostic, never wrong.
        with torch.no_grad():
            self._dim = int(self.embed_images([Image.new("RGB", (16, 16))]).shape[1])

    def _load(self, loader):
        local = os.path.join(self._storage, self._model_id)
        try:
            return loader.from_pretrained(local)
        except (OSError, ValueError):
            obj = loader.from_pretrained(self._model_id)
            obj.save_pretrained(local)
            return obj

    @property
    def name(self) -> str:
        return f"siglip2:{self._model_id}"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text"})

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        chunks: list[np.ndarray] = []
        for start in range(0, len(images), self._batch_hint):
            batch = [im.convert("RGB") for im in images[start : start + self._batch_hint]]
            inputs = self._processor(images=batch, return_tensors="pt").to(self._device)
            with torch.no_grad():
                feats = self._model.get_image_features(**inputs).pooler_output
                feats = feats / feats.norm(dim=-1, keepdim=True)
            chunks.append(feats.cpu().numpy().astype(np.float32))
        if not chunks:
            return np.zeros((0, self._dim), dtype=np.float32)
        return np.concatenate(chunks, axis=0)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        inputs = self._processor(
            text=list(queries),
            padding="max_length",
            truncation=True,
            max_length=64,
            return_tensors="pt",
        ).to(self._device)
        with torch.no_grad():
            feats = self._model.get_text_features(**inputs).pooler_output
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.cpu().numpy().astype(np.float32)

    def to(self, device: str) -> "Siglip2Embedder":
        self._device = device
        self._model.to(device)
        return self

    def offload(self) -> None:
        self._model.cpu()
        self._device = "cpu"
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
