import numpy as np
from PIL import Image

from data_extraction_lib.embedding import FrameEmbedder
from src.core.normalizing_embedder import NormalizingEmbedder


class _RawFake(FrameEmbedder):
    def __init__(self, dim=4):
        self._dim = dim
        self.offloaded = False

    @property
    def name(self):
        return "raw:test"

    @property
    def embedding_dim(self):
        return self._dim

    @property
    def capabilities(self):
        return frozenset({"global", "text", "dense"})

    @property
    def encode_long_side(self):
        return 56

    def embed_images(self, images):
        return np.full((len(images), self._dim), 3.0, dtype=np.float32)

    def embed_text(self, queries):
        return np.full((len(queries), self._dim), 2.0, dtype=np.float32)

    def embed_dense(self, images):
        out = []
        for _ in images:
            cls = np.full((self._dim,), 7.0, dtype=np.float32)
            grid = np.full((2, 3, self._dim), 6.0, dtype=np.float32)
            out.append((cls, grid))
        return out

    def embed_dense_value(self, images):
        out = []
        for _ in images:
            cls = np.full((self._dim,), 5.0, dtype=np.float32)
            grid = np.full((2, 3, self._dim), 4.0, dtype=np.float32)
            out.append((cls, grid))
        return out

    def to(self, device):
        return self

    def offload(self):
        self.offloaded = True


def test_normalizes_images_and_text():
    emb = NormalizingEmbedder(_RawFake())
    imgs = emb.embed_images([Image.new("RGB", (8, 8))])
    txt = emb.embed_text(["x"])
    assert np.allclose(np.linalg.norm(imgs, axis=1), 1.0, atol=1e-6)
    assert np.allclose(np.linalg.norm(txt, axis=1), 1.0, atol=1e-6)


def test_normalizes_dense_global_and_each_patch():
    emb = NormalizingEmbedder(_RawFake())
    ((cls, grid),) = emb.embed_dense_value([Image.new("RGB", (8, 8))])
    assert np.allclose(np.linalg.norm(cls), 1.0, atol=1e-6)
    norms = np.linalg.norm(grid.reshape(-1, grid.shape[-1]), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-6)


def test_normalizes_standard_dense_global_and_each_patch():
    emb = NormalizingEmbedder(_RawFake())
    ((cls, grid),) = emb.embed_dense([Image.new("RGB", (8, 8))])
    assert np.allclose(np.linalg.norm(cls), 1.0, atol=1e-6)
    norms = np.linalg.norm(grid.reshape(-1, grid.shape[-1]), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-6)


def test_delegates_identity_and_lifecycle():
    inner = _RawFake()
    emb = NormalizingEmbedder(inner)
    assert emb.name == "raw:test"
    assert emb.embedding_dim == 4
    assert "dense" in emb.capabilities
    assert emb.encode_long_side == 56
    assert emb.to("cuda") is emb
    emb.offload()
    assert inner.offloaded is True
