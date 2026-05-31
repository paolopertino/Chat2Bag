import os
from functools import lru_cache

import numpy as np
import torch
from PIL import Image
from transformers import AutoModel

from src.embedding.base import FrameEmbedder
from src.embedding.registry import register_embedder

_PATCH = 14
# Ephemeral encode resolution (long edge), floored to a multiple of the patch size.
# Decoupled from storage long_side (ADR 0002). Never upscales beyond the input.
_ENCODE_LONG_SIDE = 896  # 64 * 14


@lru_cache(maxsize=None)
def _supports_xformers_float32_attention(device: str) -> bool:
    device_name = str(device)
    if not device_name.startswith("cuda"):
        return True
    if os.environ.get("XFORMERS_DISABLED") is not None:
        return True

    try:
        from xformers.ops import memory_efficient_attention
    except ImportError:
        return True

    try:
        q = torch.zeros((1, 6, 16, 64), device=device_name, dtype=torch.float32)
        memory_efficient_attention(q, q, q)
    except (NotImplementedError, RuntimeError):
        return False

    return True


def _image_dtype_for_device(device: str) -> torch.dtype:
    if _supports_xformers_float32_attention(str(device)):
        return torch.float32
    return torch.bfloat16


@register_embedder("tipsv2")
class TipsV2Embedder(FrameEmbedder):
    """Google TIPSv2 backend (CLS-token global embeddings)."""

    def __init__(self, config, device: str = "cpu"):
        self._model_id = config.embedding.model
        self._encode_long_side = int(getattr(config.embedding, "encode_long_side", _ENCODE_LONG_SIDE))
        self._device = device
        self._image_dtype = _image_dtype_for_device(device)

        self._model = self._load()
        self._move_model(device)
        self._model.eval()

        with torch.no_grad():
            self._dim = int(self.embed_images([Image.new("RGB", (28, 28))]).shape[1])

    def _load(self):
        # Load straight from the HF hub cache (~/.cache/huggingface), which persists
        # the download outside the repo. Do NOT save_pretrained into model_storage:
        # TIPSv2 ships trust_remote_code modeling *.py files, and writing them into the
        # project tree makes `uvicorn --reload` watch them and reload-loop forever.
        return AutoModel.from_pretrained(self._model_id, trust_remote_code=True)

    def _move_model(self, device: str) -> None:
        if self._image_dtype is torch.float32:
            self._model.to(device=device, dtype=torch.float32)
            return

        self._model.to(device=device)
        self._model.vision_encoder.to(device=device, dtype=self._image_dtype)

    @property
    def name(self) -> str:
        return f"tipsv2:{self._model_id}"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def encode_long_side(self) -> int | None:
        return self._encode_long_side

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text", "dense"})

    def _preprocess(self, image: Image.Image) -> torch.Tensor:
        """Aspect-preserving ÷14 resize + ToTensor (0..1). Mirrors the reference notebook."""
        width, height = image.size
        long_side = min(self._encode_long_side, max(width, height))  # don't upscale
        if width >= height:
            new_w = long_side
            new_h = int(height * long_side / width)
        else:
            new_h = long_side
            new_w = int(width * long_side / height)
        new_w = max(_PATCH, (new_w // _PATCH) * _PATCH)
        new_h = max(_PATCH, (new_h // _PATCH) * _PATCH)

        resized = image.resize((new_w, new_h), Image.BICUBIC)
        arr = np.asarray(resized, dtype=np.float32) / 255.0  # (H, W, 3)
        return torch.from_numpy(arr).permute(2, 0, 1)  # (3, H, W)

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        # Variable-resolution: encode one image at a time (the embedder owns batching).
        vecs: list[np.ndarray] = []
        for image in images:
            pixel_values = self._preprocess(image.convert("RGB")).unsqueeze(0).to(
                device=self._device,
                dtype=self._image_dtype,
            )
            with torch.no_grad():
                cls = self._model.encode_image(pixel_values).cls_token.reshape(-1)
                cls = cls / cls.norm()
            vecs.append(cls.float().cpu().numpy().astype(np.float32))
        if not vecs:
            return np.zeros((0, self._dim), dtype=np.float32)
        return np.stack(vecs, axis=0)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        with torch.no_grad():
            feats = self._model.encode_text(list(queries))
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.float().cpu().numpy().astype(np.float32)

    def _value_attention_from_block_input(self, x: torch.Tensor) -> torch.Tensor:
        """Run ONLY the last block's value-path on its captured input tensor `x`,
        then final LayerNorm; strip CLS + register tokens. Returns (n_patches, dim).
        Ported from features_inspection.ipynb cell 6 (encode_image_value_attention)."""
        ve = self._model.vision_encoder
        blk = ve.blocks[-1]
        xn = blk.norm1(x)
        b, n, c = xn.shape
        qkv = (
            blk.attn.qkv(xn)
            .reshape(b, n, 3, blk.attn.num_heads, c // blk.attn.num_heads)
            .permute(2, 0, 3, 1, 4)
        )
        v = qkv[2]
        v_out = blk.attn.proj(v.transpose(1, 2).reshape(b, n, c))
        x_val = blk.ls1(v_out) + x
        x_val = x_val + blk.ls2(blk.mlp(blk.norm2(x_val)))
        x_val = ve.norm(x_val)
        patches = x_val[:, 1 + ve.num_register_tokens:, :]  # (b, n_patches, dim)
        return patches[0]

    def _encode_cls_and_value(self, pixel_values: torch.Tensor):
        """One trunk pass: capture last-block input via a pre-hook, get CLS from the
        model's public encode_image, then run the value head on the capture."""
        ve = self._model.vision_encoder
        captured = {}

        def _pre_hook(module, args):
            captured["x"] = args[0]

        handle = ve.blocks[-1].register_forward_pre_hook(_pre_hook)
        try:
            cls = self._model.encode_image(pixel_values).cls_token.reshape(-1)
        finally:
            handle.remove()

        x = captured["x"]
        patches_flat = self._value_attention_from_block_input(x)  # (n_patches, dim)

        _, _, h_i, w_i = pixel_values.shape
        h_p, w_p = h_i // _PATCH, w_i // _PATCH
        n_patches = patches_flat.shape[0]
        assert n_patches == h_p * w_p, (
            f"patch-count mismatch: {n_patches} != {h_p}*{w_p}; model token layout changed"
        )
        grid = patches_flat.reshape(h_p, w_p, -1)
        return cls, grid

    @torch.no_grad()
    def embed_global_and_dense(self, images):
        out = []
        for image in images:
            pixel_values = self._preprocess(image.convert("RGB")).unsqueeze(0).to(
                device=self._device, dtype=self._image_dtype
            )
            cls, grid = self._encode_cls_and_value(pixel_values)
            cls = cls / cls.norm()          # model dtype: keeps fused CLS == embed_images CLS
            grid = grid.float()             # upcast before norm so patches are unit-norm in fp32
            grid = grid / grid.norm(dim=-1, keepdim=True)
            out.append(
                (
                    cls.float().cpu().numpy().astype(np.float32),
                    grid.cpu().numpy().astype(np.float32),
                )
            )
        return out

    @torch.no_grad()
    def embed_dense(self, images):
        return [grid for _, grid in self.embed_global_and_dense(images)]

    def to(self, device: str) -> "TipsV2Embedder":
        self._device = device
        self._image_dtype = _image_dtype_for_device(device)
        self._move_model(device)
        return self

    def offload(self) -> None:
        self._device = "cpu"
        self._image_dtype = torch.float32
        self._move_model("cpu")
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
