import os
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from PIL import Image

from src.embedding import FrameEmbedder, create_embedder, register_embedder


@register_embedder("fake-test-backend")
class _Fake(FrameEmbedder):
    def __init__(self, config, device="cpu"):
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


@register_embedder("device-recording-backend")
class _DeviceRecordingFake(_Fake):
    def __init__(self, config, device="cpu"):
        super().__init__(config)
        self.created_on_device = device


def _cfg(backend: str):
    return SimpleNamespace(embedding=SimpleNamespace(backend=backend, model="x"))


def test_create_embedder_dispatches_by_backend_key():
    emb = create_embedder(_cfg("fake-test-backend"))
    assert emb.name == "fake:test"
    assert emb.embedding_dim == 4
    assert "global" in emb.capabilities and "text" in emb.capabilities


def test_create_embedder_passes_device_to_backend_constructor():
    emb = create_embedder(_cfg("device-recording-backend"), device="cuda")
    assert emb.created_on_device == "cuda"


def test_create_embedder_unknown_backend_raises():
    with pytest.raises(ValueError, match="Unknown embedding backend"):
        create_embedder(_cfg("nope"))


def test_embed_dense_is_unimplemented_seam():
    emb = create_embedder(_cfg("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_dense([Image.new("RGB", (8, 8))])


def test_embed_global_and_dense_is_unimplemented_seam():
    emb = create_embedder(_cfg("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_global_and_dense([Image.new("RGB", (8, 8))])


def test_encode_long_side_default_is_none():
    emb = create_embedder(_cfg("fake-test-backend"))
    assert emb.encode_long_side is None


def test_outputs_are_l2_normalized():
    emb = create_embedder(_cfg("fake-test-backend"))
    vecs = emb.embed_images([Image.new("RGB", (8, 8)), Image.new("RGB", (8, 8))])
    norms = np.linalg.norm(vecs, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-5)


class _FakeTipsImageOutput:
    def __init__(self, pixel_values):
        self.cls_token = torch.ones(
            1,
            1024,
            device=pixel_values.device,
            dtype=pixel_values.dtype,
        )


class _FakeTipsVisionEncoder:
    def __init__(self):
        self.to_args = None
        self.to_kwargs = None

    def to(self, *args, **kwargs):
        self.to_args = args
        self.to_kwargs = kwargs
        return self


class _FakeTipsModel:
    def __init__(self):
        self.vision_encoder = _FakeTipsVisionEncoder()
        self.to_args = None
        self.to_kwargs = None
        self.image_input_dtype = None

    def to(self, *args, **kwargs):
        self.to_args = args
        self.to_kwargs = kwargs
        return self

    def eval(self):
        return self

    def encode_image(self, pixel_values):
        self.image_input_dtype = pixel_values.dtype
        return _FakeTipsImageOutput(pixel_values)


def _construct_fake_tipsv2(monkeypatch, *, supports_float32: bool) -> _FakeTipsModel:
    from src.embedding.tipsv2 import TipsV2Embedder

    fake_model = _FakeTipsModel()
    monkeypatch.setattr(TipsV2Embedder, "_load", lambda self: fake_model)
    monkeypatch.setattr(
        "src.embedding.tipsv2._supports_xformers_float32_attention",
        lambda device: supports_float32,
    )

    TipsV2Embedder(
        SimpleNamespace(embedding=SimpleNamespace(model="google/tipsv2-l14")),
        device="cuda",
    )
    return fake_model


@pytest.mark.skipif(not torch.cuda.is_available(), reason="requires CUDA tensor move")
def test_tipsv2_keeps_float32_on_cuda_when_xformers_supports_it(monkeypatch):
    fake_model = _construct_fake_tipsv2(monkeypatch, supports_float32=True)

    assert fake_model.to_args == ()
    assert fake_model.to_kwargs == {"device": "cuda", "dtype": torch.float32}
    assert fake_model.vision_encoder.to_args is None
    assert fake_model.vision_encoder.to_kwargs is None
    assert fake_model.image_input_dtype is torch.float32


@pytest.mark.skipif(not torch.cuda.is_available(), reason="requires CUDA tensor move")
def test_tipsv2_uses_bfloat16_on_cuda_when_xformers_rejects_float32(monkeypatch):
    fake_model = _construct_fake_tipsv2(monkeypatch, supports_float32=False)

    assert fake_model.to_args == ()
    assert fake_model.to_kwargs == {"device": "cuda"}
    assert fake_model.vision_encoder.to_args == ()
    assert fake_model.vision_encoder.to_kwargs == {
        "device": "cuda",
        "dtype": torch.bfloat16,
    }
    assert fake_model.image_input_dtype is torch.bfloat16


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires SigLIP weights")
def test_siglip2_embedder_real_forward():
    from src.core.app_config import get_app_config

    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(get_app_config(), device=device)
    assert emb.name.startswith("siglip2:")
    img_vecs = emb.embed_images([Image.new("RGB", (64, 48))])
    txt_vecs = emb.embed_text(["a pedestrian"])
    assert img_vecs.shape[1] == emb.embedding_dim
    assert txt_vecs.shape[1] == emb.embedding_dim
    assert np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-4)


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_embedder_real_forward():
    cfg = SimpleNamespace(
        embedding=SimpleNamespace(backend="tipsv2", model="google/tipsv2-l14"),
        models=SimpleNamespace(model_storage="models"),
    )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(cfg, device=device)
    assert emb.name == "tipsv2:google/tipsv2-l14"
    assert emb.embedding_dim == 1024
    img_vecs = emb.embed_images([Image.new("RGB", (640, 420))])
    txt_vecs = emb.embed_text(["a pedestrian on a crosswalk"])
    assert img_vecs.shape == (1, 1024)
    assert txt_vecs.shape[1] == 1024
    assert np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-4)


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_dense_capability_and_grid_contract():
    from src.core.app_config import get_app_config
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(get_app_config(), device=device)
    assert "dense" in emb.capabilities
    assert emb.encode_long_side == 896

    grids = emb.embed_dense([Image.new("RGB", (840, 560))])
    assert len(grids) == 1
    grid = grids[0]
    assert grid.ndim == 3 and grid.shape[2] == emb.embedding_dim
    h_p, w_p, _ = grid.shape
    # Aspect-preserving long-side 840 (<= 896) → /14 geometry.
    assert w_p == 840 // 14 and h_p == 560 // 14
    norms = np.linalg.norm(grid.reshape(-1, grid.shape[2]), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-4)


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_fused_cls_matches_embed_images_and_removes_hook():
    from src.core.app_config import get_app_config
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(get_app_config(), device=device)
    img = Image.new("RGB", (840, 560))

    (cls_fused, grid), = emb.embed_global_and_dense([img])
    cls_standalone = emb.embed_images([img])[0]
    assert np.allclose(cls_fused, cls_standalone, atol=1e-4)
    assert grid.shape[2] == emb.embedding_dim
    # Hook must not leak onto the encoder after the call.
    assert len(emb._model.vision_encoder.blocks[-1]._forward_pre_hooks) == 0
