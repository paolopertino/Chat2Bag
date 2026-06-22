# Embedding Contract Policy-Free Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `data-extraction-lib` embedding contract policy-free (raw model outputs, two explicit dense extraction methods, mandatory batched encoding), and re-introduce Chat2Bag's normalization through a single consumer-side decorator, all without invalidating existing indexes.

**Architecture:** The library's `FrameEmbedder` returns raw, un-normalized vectors everywhere. Dense extraction is exposed as two methods (`embed_dense` = standard patch tokens, `embed_dense_value` = MaskCLIP-style value-attention patches), each returning `(global, grid)` per image; the old fused `embed_global_and_dense` is removed. TIPSv2 gains real device batching. Chat2Bag wraps the library embedder in a `NormalizingEmbedder` decorator that L2-normalizes every output, so all existing call sites keep today's behavior and the value-based indexes stay valid.

**Tech Stack:** Python 3.10+, PyTorch, Hugging Face `transformers` (`trust_remote_code` TIPSv2), NumPy, Pillow, pytest. Two repos consumed via editable path: `data-extraction-lib` (the library) and `Chat2Bag` (the consumer).

## Global Constraints

- **No re-index.** Existing LanceDB global indexes and dense patch indexes must stay valid. The embedder identity stamp must remain `tipsv2:google/tipsv2-l14` (dim `1024`); the value-attention dense grids and the stored global vectors must be numerically unchanged after normalization is reapplied consumer-side.
- **Raw outputs in the library.** No method on any `FrameEmbedder` backend applies L2-normalization. Normalization is the consumer's policy.
- **Batched encoding is the contract.** Every encode method accepts a batch and returns per-item results; `batch_size` is the single universal hint, honored by both backends where architecture permits.
- **Decisions are recorded** in `data-extraction-lib/src/data_extraction_lib/embedding/CONTEXT.md` (glossary, already updated) and `docs/adr/0003-embedding-stays-image-shaped-video-deferred.md` (already written). No further ADR.
- **Documentation rule:** docstrings describe the stable contract, not implementation history. No notebook/cell references, no temporal "now/legacy" language.
- **Library tests:** `cd data-extraction-lib && uv run pytest -q` (add `RUN_MODEL_TESTS=1` on a CUDA host with cached TIPSv2/SigLIP weights for the real-forward tests). Lint: `uv run ruff check && uv run ruff format --check`.
- **Chat2Bag tests:** `cd Chat2Bag && PYTHONPATH="" uv run pytest tests/ -q` (empty `PYTHONPATH` is required; the host ROS2 env otherwise leaks onto `sys.path`).
- Repo roots: `/home/paolopertino/adehome/aida_code/data-extraction-lib` and `/home/paolopertino/adehome/aida_code/Chat2Bag`.

---

## File Structure

**Phase A — `data-extraction-lib`:**
- `src/data_extraction_lib/embedding/base.py` — rewrite the `FrameEmbedder` ABC.
- `src/data_extraction_lib/embedding/siglip2.py` — strip normalization.
- `src/data_extraction_lib/embedding/tipsv2.py` — strip normalization, add standard `embed_dense`, rework value path into `embed_dense_value`, add batching, remove fused method.
- `src/data_extraction_lib/embedding/settings.py` — docstring: `batch_size` honored by both backends.
- `tests/test_embedding.py` — update seams, raw expectations, dense contract, batching.

**Phase B — `Chat2Bag`:**
- `src/core/normalizing_embedder.py` — new `NormalizingEmbedder` decorator (lives beside the `embedding_settings.py` bridge; `src/embedding/` stays deleted).
- `app.py` — wrap the constructed embedder in `NormalizingEmbedder`.
- `src/ingestion/indexer.py` — `embed_global_and_dense` → `embed_dense_value`.
- `src/region/query.py` — `embed_dense` → `embed_dense_value`, extract grid.
- `src/region/region_search.py` — `embed_dense` → `embed_dense_value` in `_refine` and `heatmap`.
- `tests/fakes.py` — `FakeDenseEmbedder`: `embed_dense_value` + standard `embed_dense` returning `(global, grid)`; drop `embed_global_and_dense`.
- `tests/test_normalizing_embedder.py` — new, decorator behavior.

---

## Phase A — data-extraction-lib

### Task A1: Rewrite the `FrameEmbedder` ABC

**Files:**
- Modify: `src/data_extraction_lib/embedding/base.py`
- Test: `tests/test_embedding.py`

**Interfaces:**
- Produces: `FrameEmbedder` ABC with abstract `name -> str`, `embedding_dim -> int`, `capabilities -> frozenset[str]`, `embed_images(list[Image.Image]) -> np.ndarray` `(N, dim)` raw, `embed_text(list[str]) -> np.ndarray` `(N, dim)` raw, `to(str) -> FrameEmbedder`, `offload() -> None`; optional `encode_long_side -> int | None` (default `None`); optional seams `embed_dense(list[Image.Image]) -> list[tuple[np.ndarray, np.ndarray]]` and `embed_dense_value(list[Image.Image]) -> list[tuple[np.ndarray, np.ndarray]]`, each `(global (dim,), grid (H_p, W_p, dim))` per image, default `NotImplementedError`. No `embed_global_and_dense`.

- [ ] **Step 1: Update the two ABC seam tests in `tests/test_embedding.py`**

Replace `test_embed_global_and_dense_is_unimplemented_seam` with the value-dense seam test, and keep the standard-dense seam test:

```python
def test_embed_dense_is_unimplemented_seam():
    emb = create_embedder(_settings("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_dense([Image.new("RGB", (8, 8))])


def test_embed_dense_value_is_unimplemented_seam():
    emb = create_embedder(_settings("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_dense_value([Image.new("RGB", (8, 8))])
```

Delete `test_outputs_are_l2_normalized` (the contract no longer normalizes; raw behavior is verified on the real backends in A2/A3).

- [ ] **Step 2: Run the seam tests to verify they fail**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_embedding.py::test_embed_dense_value_is_unimplemented_seam -q`
Expected: FAIL with `AttributeError` (`embed_dense_value` not defined on the ABC yet).

- [ ] **Step 3: Rewrite `base.py`**

```python
from abc import ABC, abstractmethod

import numpy as np
from PIL import Image


class FrameEmbedder(ABC):
    """Framework-neutral embedding contract.

    Subclasses own all model-specific preprocessing, batching, and device
    placement. Every method returns **raw** model outputs: no L2-normalization is
    applied anywhere. Normalization and the choice of similarity metric are the
    consumer's policy. Every encode method operates on a batch and returns one
    result per input item.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable identity stamped into metadata.json, e.g. 'tipsv2:google/...'."""

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        """Vector dimension this embedder emits."""

    @property
    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Subset of {'global', 'text', 'dense'}. 'dense' enables Region search and
        implies 'global' (a dense call also returns the global vector)."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, raw (un-normalized) global vectors."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, raw. Raw query text in; no caller-side templating."""

    @property
    def encode_long_side(self) -> int | None:
        """Dense encode geometry (long edge, divisible by patch). None if the
        backend has no manual encode resolution."""
        return None

    def embed_dense(
        self, images: list[Image.Image]
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        """Standard dense features. One (global (dim,), grid (H_p, W_p, dim)) pair
        per image, raw. The grid holds the ordinary last-block patch tokens; the
        global is the same image's pooled vector from that forward pass. Grids vary
        per image (aspect-preserving, divisible by patch)."""
        raise NotImplementedError(f"{self.name} does not implement standard dense embeddings")

    def embed_dense_value(
        self, images: list[Image.Image]
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        """Value-attention dense features. One (global (dim,), grid (H_p, W_p, dim))
        pair per image, raw. The grid holds MaskCLIP-style patch features taken from
        the last transformer block's attention value projection (post final
        LayerNorm, CLS and register tokens stripped); the global is the same image's
        pooled vector from that forward pass."""
        raise NotImplementedError(f"{self.name} does not implement value dense embeddings")

    @abstractmethod
    def to(self, device: str) -> "FrameEmbedder":
        """Move underlying model(s) to a compute device. Returns self for chaining."""

    @abstractmethod
    def offload(self) -> None:
        """Move to CPU and release VRAM."""
```

- [ ] **Step 4: Run the seam tests to verify they pass**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_embedding.py::test_embed_dense_is_unimplemented_seam tests/test_embedding.py::test_embed_dense_value_is_unimplemented_seam tests/test_embedding.py::test_create_embedder_dispatches_by_backend_key -q`
Expected: PASS (the unrelated TIPSv2 real-forward tests that still reference `embed_global_and_dense` are fixed in A3; they are `RUN_MODEL_TESTS`-gated and skip here).

- [ ] **Step 5: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/embedding/base.py tests/test_embedding.py
git commit -m "[Embedding] Raw policy-free ABC: two dense methods returning (global, grid), drop fused"
```

---

### Task A2: SigLIP2 returns raw vectors

**Files:**
- Modify: `src/data_extraction_lib/embedding/siglip2.py:53-77`
- Test: `tests/test_embedding.py`

**Interfaces:**
- Consumes: the A1 ABC.
- Produces: `Siglip2Embedder.embed_images` / `embed_text` return raw `(N, dim)` (no per-row normalization). Capabilities unchanged (`{'global', 'text'}`); no dense methods.

- [ ] **Step 1: Update the SigLIP2 real-forward test to assert raw output**

In `tests/test_embedding.py`, replace the normalization assertion in `test_siglip2_embedder_real_forward`:

```python
    assert img_vecs.shape[1] == emb.embedding_dim
    assert txt_vecs.shape[1] == emb.embedding_dim
    assert np.all(np.isfinite(img_vecs)) and np.all(np.isfinite(txt_vecs))
    assert not np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-3)
```

- [ ] **Step 2: Run to verify it fails (CUDA host with weights)**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && RUN_MODEL_TESTS=1 uv run pytest tests/test_embedding.py::test_siglip2_embedder_real_forward -q`
Expected: FAIL on the `not np.allclose(..., 1.0)` assertion (output is still normalized).
(If no GPU/weights, this test skips; the change is still verified by the source diff and re-run later on a capable host.)

- [ ] **Step 3: Strip normalization in `siglip2.py`**

In `embed_images`, delete the normalization line so the batch forward keeps raw pooled output:

```python
            with torch.no_grad():
                feats = self._model.get_image_features(**inputs).pooler_output
            chunks.append(feats.cpu().numpy().astype(np.float32))
```

In `embed_text`, likewise:

```python
        with torch.no_grad():
            feats = self._model.get_text_features(**inputs).pooler_output
        return feats.cpu().numpy().astype(np.float32)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && RUN_MODEL_TESTS=1 uv run pytest tests/test_embedding.py::test_siglip2_embedder_real_forward -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/embedding/siglip2.py tests/test_embedding.py
git commit -m "[Embedding] SigLIP2 returns raw pooled vectors"
```

---

### Task A3: TIPSv2 raw outputs, standard `embed_dense`, value `embed_dense_value`

**Files:**
- Modify: `src/data_extraction_lib/embedding/tipsv2.py`
- Test: `tests/test_embedding.py`

**Interfaces:**
- Consumes: the A1 ABC. The cached TIPSv2 model exposes `encode_image(pixel_values) -> TIPSv2ImageOutput` with `.cls_token (B, 1, D)`, `.register_tokens (B, R, D)`, `.patch_tokens (B, N, D)`.
- Produces: `TipsV2Embedder` with raw `embed_images`/`embed_text`; `embed_dense(images) -> list[(cls (dim,), standard_grid (H_p, W_p, dim))]`; `embed_dense_value(images) -> list[(cls (dim,), value_grid (H_p, W_p, dim))]`; no `embed_global_and_dense`. `_value_patches_from_block_input(x) -> (b, n_patches, dim)`. `capabilities == {'global','text','dense'}`. (Batching is added in A4; A3 may encode one image per forward.)

- [ ] **Step 1: Extend the fake TIPSv2 model so the standard dense path is unit-testable, and add the standard-dense fast test**

In `tests/test_embedding.py`, give `_FakeTipsImageOutput` patch and register tokens sized from the input, so `encode_image` yields a real `patch_tokens` grid:

```python
class _FakeTipsImageOutput:
    def __init__(self, pixel_values):
        b, _, h, w = pixel_values.shape
        n = (h // 14) * (w // 14)
        self.cls_token = torch.ones(b, 1, 1024, device=pixel_values.device, dtype=pixel_values.dtype)
        self.register_tokens = torch.zeros(b, 4, 1024, device=pixel_values.device, dtype=pixel_values.dtype)
        self.patch_tokens = torch.arange(
            b * n * 1024, device=pixel_values.device, dtype=pixel_values.dtype
        ).reshape(b, n, 1024)
```

Add a fast test (no real weights) for the standard grid shape and rawness:

```python
def test_tipsv2_embed_dense_standard_shape_and_raw(monkeypatch):
    from data_extraction_lib.embedding.tipsv2 import TipsV2Embedder

    fake_model = _FakeTipsModel()
    monkeypatch.setattr(TipsV2Embedder, "_load", lambda self: fake_model)
    monkeypatch.setattr(
        "data_extraction_lib.embedding.tipsv2._supports_xformers_float32_attention",
        lambda device: True,
    )
    emb = TipsV2Embedder(
        EmbeddingSettings(backend="tipsv2", model_id="google/tipsv2-l14", encode_long_side=56),
        device="cpu",
    )
    (cls, grid), = emb.embed_dense([Image.new("RGB", (56, 56))])
    assert cls.shape == (1024,)
    assert grid.shape == (4, 4, 1024)  # 56//14 == 4 per side
    assert not np.allclose(np.linalg.norm(grid.reshape(-1, 1024), axis=1), 1.0)
```

(`_FakeTipsModel.encode_image` already stores `image_input_dtype` and returns `_FakeTipsImageOutput(pixel_values)`; the new output fields make `embed_dense` work without the real vision encoder. The value path still needs real weights and is covered by the `RUN_MODEL_TESTS` tests below.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_embedding.py::test_tipsv2_embed_dense_standard_shape_and_raw -q`
Expected: FAIL (`embed_dense` not implemented on `TipsV2Embedder`, or returns the old grid-only shape).

- [ ] **Step 3: Rewrite the encode methods in `tipsv2.py`**

Add `batch_size` to `__init__` (before the dim probe) and replace the encode/dense methods. Keep `_preprocess`, `_load`, `_move_model`, `to`, `offload`, and the device/dtype helpers as-is.

In `__init__`, after `self._encode_long_side = ...`:

```python
        self._batch_size = max(1, int(settings.batch_size))
```

Replace `embed_images`, `embed_text`, `_value_attention_from_block_input`, `_encode_cls_and_value`, `embed_global_and_dense`, and `embed_dense` with:

```python
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        rows = self._batched(images, self._encode_global_batch)
        if not rows:
            return np.zeros((0, self._dim), dtype=np.float32)
        return np.stack(rows, axis=0)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        chunks: list[np.ndarray] = []
        for start in range(0, len(queries), self._batch_size):
            batch = list(queries[start : start + self._batch_size])
            with torch.no_grad():
                feats = self._model.encode_text(batch)
            chunks.append(feats.float().cpu().numpy().astype(np.float32))
        if not chunks:
            return np.zeros((0, self._dim), dtype=np.float32)
        return np.concatenate(chunks, axis=0)

    def embed_dense(self, images):
        return self._batched(images, self._encode_standard_batch)

    def embed_dense_value(self, images):
        return self._batched(images, self._encode_value_batch)

    def _encode_global_batch(self, pixel_values: torch.Tensor) -> list[np.ndarray]:
        pv = pixel_values.to(device=self._device, dtype=self._image_dtype)
        with torch.no_grad():
            cls = self._model.encode_image(pv).cls_token
        cls = cls.reshape(cls.shape[0], -1).float().cpu().numpy().astype(np.float32)
        return [row for row in cls]

    def _encode_standard_batch(self, pixel_values: torch.Tensor):
        pv = pixel_values.to(device=self._device, dtype=self._image_dtype)
        _, _, h_i, w_i = pv.shape
        h_p, w_p = h_i // _PATCH, w_i // _PATCH
        with torch.no_grad():
            out = self._model.encode_image(pv)
            cls = out.cls_token.reshape(out.cls_token.shape[0], -1)
            patches = out.patch_tokens  # (b, n_patches, dim)
        return self._assemble(cls, patches, h_p, w_p)

    def _encode_value_batch(self, pixel_values: torch.Tensor):
        pv = pixel_values.to(device=self._device, dtype=self._image_dtype)
        _, _, h_i, w_i = pv.shape
        h_p, w_p = h_i // _PATCH, w_i // _PATCH
        ve = self._model.vision_encoder
        captured = {}

        def _pre_hook(module, args):
            captured["x"] = args[0]

        handle = ve.blocks[-1].register_forward_pre_hook(_pre_hook)
        try:
            with torch.no_grad():
                cls = self._model.encode_image(pv).cls_token.reshape(pv.shape[0], -1)
        finally:
            handle.remove()
        patches = self._value_patches_from_block_input(captured["x"])  # (b, n_patches, dim)
        return self._assemble(cls, patches, h_p, w_p)

    def _assemble(self, cls: torch.Tensor, patches: torch.Tensor, h_p: int, w_p: int):
        n = patches.shape[1]
        assert n == h_p * w_p, (
            f"patch-count mismatch: {n} != {h_p}*{w_p}; model token layout changed"
        )
        cls_np = cls.float().cpu().numpy().astype(np.float32)
        grids = patches.float().cpu().numpy().astype(np.float32).reshape(-1, h_p, w_p, self._dim)
        return [(cls_np[i], grids[i]) for i in range(cls_np.shape[0])]

    def _value_patches_from_block_input(self, x: torch.Tensor) -> torch.Tensor:
        """MaskCLIP-style value-attention patch features. Runs only the last block's
        value path on its captured input ``x`` (b, n, c), applies the final
        LayerNorm, and strips the CLS + register tokens. Returns (b, n_patches, dim)."""
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
        return x_val[:, 1 + ve.num_register_tokens :, :]
```

Add the batching helper used above (its per-image fallback is exercised in A4; defined here so A3 runs):

```python
    def _batched(self, images, encode_batch):
        """Preprocess ``images`` and run them through ``encode_batch`` in device
        batches. Chunks by batch_size and stacks each chunk into one forward when the
        preprocessed tensors share a shape, falling back to per-image only when a
        chunk holds mixed shapes. ``encode_batch`` maps a (b, 3, H, W) tensor to a
        list of b per-image results."""
        tensors = [self._preprocess(im.convert("RGB")) for im in images]
        out = []
        for start in range(0, len(tensors), self._batch_size):
            chunk = tensors[start : start + self._batch_size]
            try:
                stacked = torch.stack(chunk, dim=0)
            except RuntimeError:
                for t in chunk:
                    out.extend(encode_batch(t.unsqueeze(0)))
                continue
            out.extend(encode_batch(stacked))
        return out
```

Also update the class docstring to drop the CLS-only description and notebook reference:

```python
@register_embedder("tipsv2")
class TipsV2Embedder(FrameEmbedder):
    """Google TIPSv2 backend. Raw CLS global vectors, raw text, and two raw dense
    grids: standard patch tokens (embed_dense) and value-attention patches
    (embed_dense_value)."""
```

- [ ] **Step 4: Run the fast standard-dense test to verify it passes**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_embedding.py::test_tipsv2_embed_dense_standard_shape_and_raw -q`
Expected: PASS.

- [ ] **Step 5: Update the TIPSv2 real-forward tests for the new contract**

Replace the three `RUN_MODEL_TESTS` TIPSv2 tests' contract assertions:

In `test_tipsv2_embedder_real_forward`, replace the norm assertion:

```python
    assert img_vecs.shape == (1, 1024)
    assert txt_vecs.shape[1] == 1024
    assert np.all(np.isfinite(img_vecs))
    assert not np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-3)
```

Replace `test_tipsv2_dense_capability_and_grid_contract` body to cover both dense methods and rawness:

```python
@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_dense_capability_and_grid_contract():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(
        EmbeddingSettings(backend="tipsv2", model_id="google/tipsv2-l14"),
        device=device,
    )
    assert "dense" in emb.capabilities
    assert emb.encode_long_side == 896

    for method in (emb.embed_dense, emb.embed_dense_value):
        ((cls, grid),) = method([Image.new("RGB", (840, 560))])
        assert cls.shape == (1024,)
        assert grid.ndim == 3 and grid.shape[2] == emb.embedding_dim
        h_p, w_p, _ = grid.shape
        assert w_p == 840 // 14 and h_p == 560 // 14
        assert np.all(np.isfinite(grid))
        assert not np.allclose(np.linalg.norm(grid.reshape(-1, 1024), axis=1), 1.0, atol=1e-3)
```

Replace `test_tipsv2_fused_cls_matches_embed_images_and_removes_hook` to target `embed_dense_value`:

```python
@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_value_cls_matches_embed_images_and_removes_hook():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(
        EmbeddingSettings(backend="tipsv2", model_id="google/tipsv2-l14"),
        device=device,
    )
    img = Image.new("RGB", (840, 560))

    ((cls_value, grid),) = emb.embed_dense_value([img])
    cls_standalone = emb.embed_images([img])[0]
    assert np.allclose(cls_value, cls_standalone, atol=1e-4)
    assert grid.shape[2] == emb.embedding_dim
    assert len(emb._model.vision_encoder.blocks[-1]._forward_pre_hooks) == 0
```

- [ ] **Step 6: Run the TIPSv2 real-forward tests (CUDA host with weights)**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && RUN_MODEL_TESTS=1 uv run pytest tests/test_embedding.py -k tipsv2 -q`
Expected: PASS (device/dtype tests + the three contract tests). If no GPU, the `RUN_MODEL_TESTS` tests skip; the fast test from Step 4 and the device/dtype tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/embedding/tipsv2.py tests/test_embedding.py
git commit -m "[Embedding] TIPSv2 raw outputs; standard embed_dense + value embed_dense_value returning (global, grid)"
```

---

### Task A4: TIPSv2 real batching + `batch_size` universal

**Files:**
- Modify: `src/data_extraction_lib/embedding/tipsv2.py` (already has `_batched`; this task verifies batching and the mixed-size fallback), `src/data_extraction_lib/embedding/settings.py:10-19`
- Test: `tests/test_embedding.py`

**Interfaces:**
- Consumes: A3's `_batched`, `_encode_*_batch`.
- Produces: verified numerical equivalence between batched and per-image encoding (no re-index), and graceful per-image fallback on mixed-size chunks. `EmbeddingSettings.batch_size` documented as honored by both backends.

- [ ] **Step 1: Add a fast mixed-size fallback test (no real weights)**

The fake model's `encode_image` returns shape-correct `patch_tokens`, so `embed_dense` exercises `_batched` including the mixed-shape fallback. Add:

```python
def test_tipsv2_batched_mixed_sizes_fall_back_per_image(monkeypatch):
    from data_extraction_lib.embedding.tipsv2 import TipsV2Embedder

    fake_model = _FakeTipsModel()
    monkeypatch.setattr(TipsV2Embedder, "_load", lambda self: fake_model)
    monkeypatch.setattr(
        "data_extraction_lib.embedding.tipsv2._supports_xformers_float32_attention",
        lambda device: True,
    )
    emb = TipsV2Embedder(
        EmbeddingSettings(backend="tipsv2", model_id="google/tipsv2-l14",
                          encode_long_side=84, batch_size=8),
        device="cpu",
    )
    # Different aspect ratios -> different preprocessed shapes -> one chunk, mixed.
    results = emb.embed_dense([Image.new("RGB", (84, 84)), Image.new("RGB", (84, 42))])
    assert len(results) == 2
    (_, g0), (_, g1) = results
    assert g0.shape == (6, 6, 1024)   # 84//14
    assert g1.shape == (3, 6, 1024)   # 42//14 x 84//14
```

- [ ] **Step 2: Run to verify behavior**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest tests/test_embedding.py::test_tipsv2_batched_mixed_sizes_fall_back_per_image -q`
Expected: PASS (the `_batched` try/stack catches the ragged stack and falls back to per-image). If it fails because the stack error is not a `RuntimeError`, widen the catch in `_batched` to `(RuntimeError, ValueError)` and re-run.

- [ ] **Step 3: Add the real-model batched-equals-per-image test (CUDA host with weights)**

This is the no-re-index guarantee: batched encoding must equal per-image.

```python
@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_batched_equals_per_image():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    emb = create_embedder(
        EmbeddingSettings(backend="tipsv2", model_id="google/tipsv2-l14", batch_size=4),
        device=device,
    )
    imgs = [Image.new("RGB", (560, 560), color=(c, c, c)) for c in (10, 120, 240)]

    batched = emb.embed_images(imgs)
    one_by_one = np.stack([emb.embed_images([im])[0] for im in imgs], axis=0)
    assert np.allclose(batched, one_by_one, atol=1e-4)

    batched_dense = emb.embed_dense_value(imgs)
    for i, im in enumerate(imgs):
        ((cls_i, grid_i),) = emb.embed_dense_value([im])
        assert np.allclose(batched_dense[i][0], cls_i, atol=1e-4)
        assert np.allclose(batched_dense[i][1], grid_i, atol=1e-4)
```

- [ ] **Step 4: Update the `batch_size` docstring in `settings.py`**

```python
    :param batch_size: image batch hint, honored by both backends. SigLIP-2 chunks a
        fixed-resolution batch; TIPSv2 chunks then stacks same-shape frames into one
        forward, falling back to per-image only for mixed-size chunks.
    :param encode_long_side: dense/global encode resolution, long edge in pixels. Used by
        TIPSv2; SigLIP-2 uses a fixed-resolution processor and ignores it.
```

- [ ] **Step 5: Run the batching tests**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && RUN_MODEL_TESTS=1 uv run pytest tests/test_embedding.py -k "batched" -q`
Expected: PASS (real test runs on a CUDA host; fast fallback test always runs).

- [ ] **Step 6: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/data-extraction-lib
git add src/data_extraction_lib/embedding/tipsv2.py src/data_extraction_lib/embedding/settings.py tests/test_embedding.py
git commit -m "[Embedding] TIPSv2 device batching with per-image fallback; batch_size honored by both backends"
```

---

### Task A5: Phase A gate (full suite + lint)

**Files:** none (verification only).

- [ ] **Step 1: Run the full library suite**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run pytest -q`
Expected: all non-`RUN_MODEL_TESTS` tests pass; model tests skip without a GPU. On the CUDA host, also run `RUN_MODEL_TESTS=1 uv run pytest -q` and confirm green.

- [ ] **Step 2: Lint**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && uv run ruff check && uv run ruff format --check`
Expected: clean. Fix any reported issues and re-run.

- [ ] **Step 3: Confirm no stale references to the removed method**

Run: `cd /home/paolopertino/adehome/aida_code/data-extraction-lib && grep -rn "embed_global_and_dense" src/ tests/`
Expected: no matches.

---

## Phase B — Chat2Bag

### Task B1: `NormalizingEmbedder` decorator

**Files:**
- Create: `src/core/normalizing_embedder.py`
- Test: `tests/test_normalizing_embedder.py`

**Interfaces:**
- Consumes: a library `FrameEmbedder` (raw outputs, the A1 contract).
- Produces: `NormalizingEmbedder(inner: FrameEmbedder)` that L2-normalizes `embed_images`/`embed_text` rows and the `(global, grid)` pairs from `embed_dense`/`embed_dense_value` (global unit-norm; each patch unit-norm), and delegates `name`, `embedding_dim`, `capabilities`, `encode_long_side`, `to`, `offload`. `to` returns the `NormalizingEmbedder` (so chaining keeps the wrapper).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_normalizing_embedder.py
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/test_normalizing_embedder.py -q`
Expected: FAIL with `ModuleNotFoundError: src.core.normalizing_embedder`.

- [ ] **Step 3: Implement the decorator**

```python
# src/core/normalizing_embedder.py
"""Consumer-side embedding policy: L2-normalize the library's raw outputs.

The library's :class:`FrameEmbedder` returns raw model vectors (normalization is
the consumer's policy). Chat2Bag works in cosine space: stored vectors and queries
are unit-norm, and Region search treats raw inner products as cosine. This decorator
wraps any library embedder and L2-normalizes every output at a single seam, so all
call sites keep that invariant and existing indexes stay valid.
"""

import numpy as np
from PIL import Image

from data_extraction_lib.embedding import FrameEmbedder


def _l2(rows: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(rows, axis=-1, keepdims=True)
    return (rows / np.where(norms == 0, 1.0, norms)).astype(np.float32)


class NormalizingEmbedder(FrameEmbedder):
    """Wraps a :class:`FrameEmbedder` and L2-normalizes all of its outputs."""

    def __init__(self, inner: FrameEmbedder):
        self._inner = inner

    @property
    def name(self) -> str:
        return self._inner.name

    @property
    def embedding_dim(self) -> int:
        return self._inner.embedding_dim

    @property
    def capabilities(self) -> frozenset[str]:
        return self._inner.capabilities

    @property
    def encode_long_side(self) -> int | None:
        return self._inner.encode_long_side

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        return _l2(self._inner.embed_images(images))

    def embed_text(self, queries: list[str]) -> np.ndarray:
        return _l2(self._inner.embed_text(queries))

    def embed_dense(self, images):
        return [(_l2(cls), _l2(grid)) for cls, grid in self._inner.embed_dense(images)]

    def embed_dense_value(self, images):
        return [(_l2(cls), _l2(grid)) for cls, grid in self._inner.embed_dense_value(images)]

    def to(self, device: str) -> "NormalizingEmbedder":
        self._inner.to(device)
        return self

    def offload(self) -> None:
        self._inner.offload()
```

(`_l2` normalizes along the last axis, so it handles `(N, dim)` rows, a `(dim,)` global, and an `(H_p, W_p, dim)` grid uniformly.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/test_normalizing_embedder.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
git add src/core/normalizing_embedder.py tests/test_normalizing_embedder.py
git commit -m "[Backend] Add NormalizingEmbedder: consumer-side L2-norm over the library's raw embeddings"
```

---

### Task B2: Wire the decorator + rewire dense call sites

**Files:**
- Modify: `app.py:81`, `src/ingestion/indexer.py:100`, `src/region/query.py:21`, `src/region/region_search.py:160` and the `heatmap` site (~`:180`)
- Modify: `tests/fakes.py`
- Test: existing `tests/test_indexer_embedding.py`, `tests/test_region_search.py`, `tests/test_region_search_area.py`, `tests/test_region_query.py`

**Interfaces:**
- Consumes: `NormalizingEmbedder` (B1); the library `embed_dense_value(images) -> list[(global, grid)]`.
- Produces: production embedder is `NormalizingEmbedder`-wrapped; all dense call sites use `embed_dense_value` and read the grid from the `(global, grid)` pair; `FakeDenseEmbedder` matches the new contract.

- [ ] **Step 1: Update `FakeDenseEmbedder` in `tests/fakes.py`**

Replace `embed_global_and_dense` and `embed_dense` with the new contract (drop the fused method; both dense methods return `(cls, grid)` per image, value and standard yielding the same deterministic grid for the fake):

```python
    def embed_dense_value(self, images):
        out = []
        for i, _ in enumerate(images):
            cls = np.eye(self._dim, dtype=np.float32)[i % self._dim]
            grid = np.zeros((2, 3, self._dim), dtype=np.float32)  # 6 patches
            grid[..., (i % self._dim)] = 1.0
            out.append((cls, grid))
        return out

    def embed_dense(self, images):
        return self.embed_dense_value(images)
```

- [ ] **Step 2: Run the dense consumer tests to verify they fail**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py tests/test_region_query.py tests/test_region_search.py -q`
Expected: FAIL (`indexer`/`query`/`region_search` still call `embed_global_and_dense`/`embed_dense` with the old shape).

- [ ] **Step 3: Rewire `indexer.py:100`**

```python
                (cls, grid), = self.embedder.embed_dense_value([img])
```

- [ ] **Step 4: Rewire `query.py:21`**

```python
    grid = embedder.embed_dense_value([image.convert("RGB")])[0][1]  # (H_p, W_p, dim)
```

- [ ] **Step 5: Rewire the two `region_search.py` sites**

In `_refine`:

```python
                with Image.open(res["file_path"]) as im:
                    grid = self._embedder.embed_dense_value([im.convert("RGB")])[0][1]
```

In `heatmap`:

```python
        with Image.open(target_file_path) as im:
            grid = self._embedder.embed_dense_value([im.convert("RGB")])[0][1]  # (H_p, W_p, dim)
```

- [ ] **Step 6: Wire the decorator in `app.py:81`**

```python
from src.core.normalizing_embedder import NormalizingEmbedder
```

```python
    embedder = NormalizingEmbedder(
        create_embedder(embedding_settings_from_config(config), device=device)
    )
```

(Match the existing `device=...` argument name on line 81; only the wrapping changes.)

- [ ] **Step 7: Run the dense consumer tests to verify they pass**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py tests/test_region_query.py tests/test_region_search.py tests/test_region_search_area.py -q`
Expected: PASS (behavior identical to before; only the method name and tuple unpacking changed).

- [ ] **Step 8: Commit**

```bash
cd /home/paolopertino/adehome/aida_code/Chat2Bag
git add app.py src/ingestion/indexer.py src/region/query.py src/region/region_search.py tests/fakes.py
git commit -m "[Backend] Wire NormalizingEmbedder; rewire dense call sites to embed_dense_value"
```

---

### Task B3: Phase B gate (full suite + import smoke)

**Files:** none (verification only).

- [ ] **Step 1: Confirm no stale references**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && grep -rn "embed_global_and_dense" src/ tests/ app.py`
Expected: no matches.

- [ ] **Step 2: Full Chat2Bag suite**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && PYTHONPATH="" uv run pytest tests/ -q`
Expected: all pass (baseline was 220 passed, 2 skipped; this adds the `NormalizingEmbedder` tests).

- [ ] **Step 3: Import smoke**

Run: `cd /home/paolopertino/adehome/aida_code/Chat2Bag && JWT_SECRET=dev REFRESH_SECRET=dev PYTHONPATH="" uv run python -c "import app; print('import app: ok')"`
Expected: `import app: ok`.

---

## Owner-driven verification (after the plan lands)

These need the real model, real weights, and an existing index; run on the CUDA host. They are not automated steps.

- [ ] Boot uvicorn against an existing index and confirm a text search and an image search return results, with no re-index triggered (the embedder logs `tipsv2:google/tipsv2-l14 (dim=1024)` and indexing does not start).
- [ ] Open a Region search on an already-indexed bag and confirm the heatmap renders and similarity scores match pre-change behavior (the value grids are unchanged because batched value encoding is numerically equivalent and the decorator reapplies the same unit-norm).
- [ ] Index one small fresh bag and confirm the new `embed_dense_value` path writes both the global vector and the dense grid, and that the dense grid is unit-norm in the patch index.

---

## Self-Review

**Spec coverage:**
- Concern #1/#5 (raw outputs): A1 (ABC), A2 (SigLIP2), A3 (TIPSv2), B1 (decorator re-normalizes). Covered.
- Concern #2 (two dense methods, returns `(global, grid)`, drop fused, names + docs): A1 (contract + docstrings), A3 (TIPSv2 both methods). Covered.
- Concern #3 (batch mandatory, `batch_size` universal, SigLIP2-style + fallback, no re-index): A3 (`_batched`), A4 (equivalence + fallback + settings doc). Covered.
- Concern #4 (image-shaped, video deferred): ADR `0003`, already written; no code. Covered.
- No-re-index invariant: A4 Step 3 (batched == per-image), B1/B2 (decorator reapplies unit-norm at the same points), owner verification. Covered.

**Placeholder scan:** Every code and test step contains concrete code; every run step has an exact command and expected result. No TBD/TODO/"handle edge cases".

**Type consistency:** `embed_dense`/`embed_dense_value` return `list[tuple[np.ndarray, np.ndarray]]` everywhere (ABC, TIPSv2, fakes, decorator, consumers). Consumers read `[0][1]` for the grid (indexer reads the full `(cls, grid)` pair). `embed_global_and_dense` removed in A1/A3 and grep-gated in A5/B3. `_l2` normalizes the last axis, used uniformly for rows, global, and grid.
