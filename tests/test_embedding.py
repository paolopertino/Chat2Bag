import os
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from src.embedding import FrameEmbedder, create_embedder, register_embedder


@register_embedder("fake-test-backend")
class _Fake(FrameEmbedder):
    def __init__(self, config):
        self._dim = 4

    @property
    def name(self) -> str:
        return "fake:test"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text"})

    def embed_images(self, images):
        return np.tile(np.eye(self._dim, dtype=np.float32)[0], (len(images), 1))

    def embed_text(self, queries):
        return np.tile(np.eye(self._dim, dtype=np.float32)[0], (len(queries), 1))

    def to(self, device):
        return self

    def offload(self):
        return None


def _cfg(backend: str):
    return SimpleNamespace(embedding=SimpleNamespace(backend=backend, model="x"))


def test_create_embedder_dispatches_by_backend_key():
    emb = create_embedder(_cfg("fake-test-backend"))
    assert emb.name == "fake:test"
    assert emb.embedding_dim == 4
    assert "global" in emb.capabilities and "text" in emb.capabilities


def test_create_embedder_unknown_backend_raises():
    with pytest.raises(ValueError, match="Unknown embedding backend"):
        create_embedder(_cfg("nope"))


def test_embed_dense_is_unimplemented_seam():
    emb = create_embedder(_cfg("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_dense([Image.new("RGB", (8, 8))])


def test_outputs_are_l2_normalized():
    emb = create_embedder(_cfg("fake-test-backend"))
    vecs = emb.embed_images([Image.new("RGB", (8, 8)), Image.new("RGB", (8, 8))])
    norms = np.linalg.norm(vecs, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-5)


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires SigLIP weights")
def test_siglip2_embedder_real_forward():
    from src.core.app_config import get_app_config

    emb = create_embedder(get_app_config())
    assert emb.name.startswith("siglip2:")
    img_vecs = emb.embed_images([Image.new("RGB", (64, 48))])
    txt_vecs = emb.embed_text(["a pedestrian"])
    assert img_vecs.shape[1] == emb.embedding_dim
    assert txt_vecs.shape[1] == emb.embedding_dim
    assert np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-4)
