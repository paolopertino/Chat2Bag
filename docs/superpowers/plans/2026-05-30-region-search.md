# Region Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Region search — rank Frames by their single best-matching Patch (MaxSim) against a query vector built from points on a Support image or from text — without changing Global search, ingestion, auth, or chat.

**Architecture:** A `forward_pre_hook` on the TIPSv2 vision encoder's last block lets one `encode_image` pass yield both the CLS vector (Global) and value-attention Patch grids (Region). Patch grids are indexed per-bag with faiss IVF-PQ (exact `IndexFlatIP` for tiny bags), code-only, ~138 MB/bag. A `RegionSearcher` mirrors `GlobalSearcher`'s federation/dedup, grouping patch hits by `frame_id` (MaxSim) and joining `metadata.json` for display fields. Fresh indexing fuses CLS + dense into one trunk pass; existing bags upgrade lazily via a dense-only pass.

**Tech Stack:** Python 3.10+, PyTorch, transformers (TIPSv2 via `trust_remote_code`), faiss-cpu, numpy, FastAPI, LanceDB (unchanged), pytest.

**Source spec:** `docs/superpowers/specs/2026-05-30-region-search-design.md`. **Index ADR:** `docs/adr/0004-region-search-per-patch-pq-index.md`.

**Test command (always):** `PYTHONPATH="" uv run pytest tests/` (empty `PYTHONPATH` is mandatory — the host ROS2 env otherwise leaks `/opt/ros/*` onto `sys.path`).

**Pre-existing issue (do NOT fix here):** `tests/test_indexing_service.py` constructs `IndexingService(..., error_store=...)`, a param that does not exist in the committed source — that test already fails on `master`. Leave it alone; it is unrelated to Region search.

**Property/field naming locked across tasks** (use these exact spellings everywhere):
- Embedder method: `embed_global_and_dense(images) -> list[tuple[np.ndarray, np.ndarray]]` (returns `(cls (dim,), grid (H_p,W_p,dim))`).
- Embedder method: `embed_dense(images) -> list[np.ndarray]` (returns `grid` per image).
- Embedder property: `encode_long_side -> int | None`.
- Config: `EmbeddingConfig.encode_long_side: int`; `RegionSearchConfig` (fields enumerated in Task 2.3); `AppConfig.region_search`.
- Index class: `FaissPatchIndex`; protocol `PatchIndex`; builder `DensePatchIndexer`; searcher `RegionSearcher`; service `RegionSearchService`.
- Stamp fns: `read_region_stamp` / `write_region_stamp` / `is_region_stamp_compatible`.
- App state: `request.app.state.region_searcher_instance` (`RegionSearcher | None`).

---

## File Structure

**Created:**
- `src/region/__init__.py` — empty package marker.
- `src/region/patch_index.py` — `PatchIndex` Protocol.
- `src/region/faiss_index.py` — `FaissPatchIndex` (IVF-PQ + FlatIP tiers).
- `src/region/dense_indexer.py` — `DensePatchIndexer` (spill-to-disk build).
- `src/region/query.py` — `build_query_from_points` / `build_query_from_text`.
- `src/region/region_search.py` — `RegionSearcher`.
- `src/services/region_search_service.py` — `RegionSearchService`.
- `tests/test_region_index.py`, `tests/test_region_query.py`, `tests/test_region_search.py`, `tests/test_region_stamp.py`, `tests/test_region_api.py`.

**Modified:**
- `src/embedding/base.py` — `embed_dense` signature, `embed_global_and_dense` default, `encode_long_side` property.
- `src/embedding/tipsv2.py` — config-driven encode size, value-attention hook, fused/dense methods, `'dense'` capability.
- `src/core/app_config.py` — `EmbeddingConfig.encode_long_side`, `RegionSearchConfig`, `AppConfig.region_search`.
- `config/settings.yaml` — `embedding.encode_long_side`, `region_search:` block.
- `src/core/schema_versions.py` — bump to 4.
- `src/core/index_stamp.py` — region stamp functions.
- `src/ingestion/indexer.py` — fused loop + dense-only upgrade.
- `src/services/component_factory.py` — `create_region_searcher`, region-aware `create_indexer`.
- `src/services/indexing_service.py` — invalidate region cache after index.
- `src/api/dependencies.py` — `get_region_search_service`.
- `src/api/search_routes.py` — region endpoints.
- `app.py` — `region_searcher_instance` in lifespan.
- `tests/fakes.py` — `FakeDenseEmbedder`.
- `pyproject.toml` — `faiss-cpu`.

---

# Slice 0 — Dense embedding seam + shared-trunk forward

Goal: one shared `encode_long_side` config, a revised `embed_dense` returning per-image grids, and a `embed_global_and_dense` that produces CLS + value-attention patches in one trunk pass. No product surface yet.

## Task 0.1: `encode_long_side` in config

**Files:**
- Modify: `src/core/app_config.py:30-33` (EmbeddingConfig), `:91-94` (construction)
- Modify: `config/settings.yaml:14-16` (embedding block)
- Test: `tests/test_app_config.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_app_config.py`:

```python
def test_embedding_config_has_encode_long_side_default():
    from src.core.app_config import get_app_config
    cfg = get_app_config()
    assert isinstance(cfg.embedding.encode_long_side, int)
    assert cfg.embedding.encode_long_side == 896
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py::test_embedding_config_has_encode_long_side_default -v`
Expected: FAIL — `AttributeError: 'EmbeddingConfig' object has no attribute 'encode_long_side'`.

- [ ] **Step 3: Add the field + parsing**

In `src/core/app_config.py`, change `EmbeddingConfig`:

```python
@dataclass(frozen=True)
class EmbeddingConfig:
    backend: str
    model: str
    encode_long_side: int
```

In `get_app_config()`, change the `embedding=` construction:

```python
        embedding=EmbeddingConfig(
            backend=str(settings["embedding"]["backend"]),
            model=str(settings["embedding"]["model"]),
            encode_long_side=int(settings["embedding"].get("encode_long_side", 896)),
        ),
```

- [ ] **Step 4: Add the key to settings.yaml**

In `config/settings.yaml`, under `embedding:`:

```yaml
embedding:
  backend: "tipsv2"                                                                         # Registry key: siglip2 | tipsv2
  model: "google/tipsv2-l14"                                                                # HF id or local checkpoint path for the active backend.
  encode_long_side: 896                                                                     # Shared CLS + dense encode geometry (long edge, floored to /14). Tunable; changing it re-indexes both CLS and Region.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/app_config.py config/settings.yaml tests/test_app_config.py
git commit -m "[Config] Add shared embedding.encode_long_side (default 896)"
```

## Task 0.2: Revise the `embed_dense` ABC seam + add fused seam + property

**Files:**
- Modify: `src/embedding/base.py:28-41`
- Test: `tests/test_embedding.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_embedding.py`:

```python
def test_embed_global_and_dense_is_unimplemented_seam():
    emb = create_embedder(_cfg("fake-test-backend"))
    with pytest.raises(NotImplementedError):
        emb.embed_global_and_dense([Image.new("RGB", (8, 8))])


def test_encode_long_side_default_is_none():
    emb = create_embedder(_cfg("fake-test-backend"))
    assert emb.encode_long_side is None
```

Note: `_cfg` builds `SimpleNamespace(embedding=SimpleNamespace(backend=backend, model="x"))`. The `_Fake` here does not set `encode_long_side`, so it must inherit the ABC default `None`.

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_embedding.py::test_embed_global_and_dense_is_unimplemented_seam tests/test_embedding.py::test_encode_long_side_default_is_none -v`
Expected: FAIL — `AttributeError: 'embed_global_and_dense'` / `'encode_long_side'`.

- [ ] **Step 3: Update the ABC**

In `src/embedding/base.py`, update the `capabilities` docstring and the dense seams (replace lines 26-41):

```python
    @property
    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Subset of {'global', 'text', 'dense'}. 'dense' enables Region search."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, L2-normalized."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. Raw query text in; no caller-side templating."""

    @property
    def encode_long_side(self) -> int | None:
        """Dense encode geometry (long edge, ÷patch). None if the backend has no
        manual encode resolution. Region search reads this to stamp/validate."""
        return None

    def embed_dense(self, images: list[Image.Image]) -> list[np.ndarray]:
        """Region-search seam. One (H_p, W_p, dim) float32 array per image,
        L2-normalized per Patch. Grids vary per image (aspect-preserving ÷patch)."""
        raise NotImplementedError(f"{self.name} does not implement dense/region embeddings")

    def embed_global_and_dense(
        self, images: list[Image.Image]
    ) -> list[tuple[np.ndarray, np.ndarray]]:
        """One trunk pass per image → (cls (dim,), grid (H_p, W_p, dim)), both
        L2-normalized. Used by the fused fresh-index loop."""
        raise NotImplementedError(f"{self.name} does not implement fused dense embeddings")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_embedding.py -v`
Expected: PASS (including the existing `test_embed_dense_is_unimplemented_seam`, which still raises).

- [ ] **Step 5: Commit**

```bash
git add src/embedding/base.py tests/test_embedding.py
git commit -m "[Backend] Revise embed_dense seam; add embed_global_and_dense + encode_long_side"
```

## Task 0.3: TipsV2 value-attention via shared-trunk hook

**Files:**
- Modify: `src/embedding/tipsv2.py`
- Reference: `/home/paolopertino/Desktop/tips/features_inspection.ipynb` cell 6 (`encode_image_value_attention`)
- Test: `tests/test_embedding.py`

- [ ] **Step 1: Write the failing contract test (real model, opt-in)**

Add to `tests/test_embedding.py`:

```python
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
    # Aspect-preserving long-side 840 (already <= 896) → /14 geometry.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run pytest tests/test_embedding.py::test_tipsv2_dense_capability_and_grid_contract -v`
Expected: FAIL — `'dense' not in capabilities` (or `AttributeError` on `embed_dense` returning the ABC raise). If TIPSv2 weights are unavailable on this box, this test is skipped; rely on Step 6's review and run it on a GPU box before merging Slice 0.

- [ ] **Step 3: Implement the config-driven encode size + property**

In `src/embedding/tipsv2.py`, replace the module constant usage. Keep `_PATCH = 14`. Change `__init__` to read the encode size from config and store it, and remove reliance on the module-level `_ENCODE_LONG_SIDE` inside `_preprocess`:

```python
    def __init__(self, config, device: str = "cpu"):
        self._model_id = config.embedding.model
        self._encode_long_side = int(getattr(config.embedding, "encode_long_side", 896))
        self._device = device
        self._image_dtype = _image_dtype_for_device(device)

        self._model = self._load()
        self._move_model(device)
        self._model.eval()

        with torch.no_grad():
            self._dim = int(self.embed_images([Image.new("RGB", (28, 28))]).shape[1])
```

Add the property (next to `embedding_dim`):

```python
    @property
    def encode_long_side(self) -> int | None:
        return self._encode_long_side
```

Change `capabilities`:

```python
    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text", "dense"})
```

In `_preprocess`, replace `_ENCODE_LONG_SIDE` with the instance value:

```python
        long_side = min(self._encode_long_side, max(width, height))  # don't upscale
```

(You may delete the module-level `_ENCODE_LONG_SIDE = 896` constant, or keep it as the default fallback — referencing it nowhere else.)

- [ ] **Step 4: Implement the value-attention head + shared-trunk fused forward**

Add `import math` at the top of `src/embedding/tipsv2.py` if not present. Add these methods to `TipsV2Embedder` (ported from notebook cell 6, but sharing the trunk via a `forward_pre_hook` so CLS comes from the model's own `encode_image`):

```python
    def _value_attention_from_block_input(self, x: torch.Tensor) -> torch.Tensor:
        """Run ONLY the last block's value-path on its captured input tensor `x`,
        then final LayerNorm; strip CLS + register tokens. Returns (n_patches, dim)."""
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
        """One trunk pass: capture last-block input via a pre-hook, get CLS from
        the model's public encode_image, then run the value head on the capture."""
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

        # Reconstruct grid geometry from the preprocessed pixel tensor.
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
            cls = cls / cls.norm()
            grid = grid / grid.norm(dim=-1, keepdim=True)
            out.append(
                (
                    cls.float().cpu().numpy().astype(np.float32),
                    grid.float().cpu().numpy().astype(np.float32),
                )
            )
        return out

    @torch.no_grad()
    def embed_dense(self, images):
        return [grid for _, grid in self.embed_global_and_dense(images)]
```

- [ ] **Step 5: Run the gated test to verify it passes**

Run (on a box with TIPSv2 weights): `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run pytest tests/test_embedding.py -k tipsv2 -v`
Expected: PASS for `test_tipsv2_dense_capability_and_grid_contract` and `test_tipsv2_fused_cls_matches_embed_images_and_removes_hook`. The existing float32/bfloat16 CUDA tests and `test_tipsv2_embedder_real_forward` must still pass.

Also run the full non-gated suite to confirm no regressions: `PYTHONPATH="" uv run pytest tests/ -v`. Expected: PASS (except the pre-existing `test_indexing_service.py` drift noted at top).

- [ ] **Step 6: Commit**

```bash
git add src/embedding/tipsv2.py tests/test_embedding.py
git commit -m "[Backend] TipsV2: value-attention dense embeddings via shared-trunk hook"
```

---

# Slice 1 — PatchIndex protocol + faiss engine

Goal: a swappable `PatchIndex` with a faiss implementation that uses IVF-PQ above a patch-count threshold and exact `IndexFlatIP` below, persists code-only, and resolves patch hits to `frame_id`s.

## Task 1.1: Add faiss-cpu dependency

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add the dependency**

Run: `uv add faiss-cpu`
This adds `faiss-cpu` to `[project].dependencies` and updates the lockfile.

- [ ] **Step 2: Verify import works**

Run: `PYTHONPATH="" uv run python -c "import faiss; print(faiss.__version__)"`
Expected: prints a version (e.g. `1.8.0`), no ImportError.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "[Backend] Add faiss-cpu dependency for Region search patch index"
```

## Task 1.2: `PatchIndex` protocol + package

**Files:**
- Create: `src/region/__init__.py`
- Create: `src/region/patch_index.py`

- [ ] **Step 1: Create the package marker**

Create `src/region/__init__.py`:

```python
```
(empty file).

- [ ] **Step 2: Write the protocol**

Create `src/region/patch_index.py`:

```python
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class PatchIndex(Protocol):
    """Per-bag patch vector index. Stores patch codes + a patch_id→frame_id map.

    Vectors are L2-normalized; similarity is cosine via inner product.
    """

    def train_add(self, vectors: np.ndarray, frame_ids: np.ndarray) -> None:
        """Build from (N, dim) float32 vectors and a parallel (N,) int32 frame_ids."""
        ...

    def persist(self, path: Path) -> None:
        """Write index + side arrays into directory `path`."""
        ...

    @classmethod
    def load(cls, path: Path, *, mmap: bool = True) -> "PatchIndex":
        ...

    def search(self, q: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
        """For a single (dim,) query, return (frame_ids (k,), scores (k,)) for the
        top-k matching Patches (cosine). frame_ids may repeat across patches."""
        ...
```

- [ ] **Step 3: Commit**

```bash
git add src/region/__init__.py src/region/patch_index.py
git commit -m "[Backend] Add PatchIndex protocol + region package"
```

## Task 1.3: `FaissPatchIndex` (IVF-PQ + FlatIP tiers)

**Files:**
- Create: `src/region/faiss_index.py`
- Test: `tests/test_region_index.py`

- [ ] **Step 1: Write the failing round-trip tests (both tiers)**

Create `tests/test_region_index.py`:

```python
import numpy as np

from src.region.faiss_index import FaissPatchIndex


def _planted_vectors(n_frames: int, patches_per_frame: int, dim: int, seed: int = 0):
    rng = np.random.default_rng(seed)
    vecs = rng.standard_normal((n_frames * patches_per_frame, dim)).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    frame_ids = np.repeat(np.arange(n_frames, dtype=np.int32), patches_per_frame)
    return vecs, frame_ids


def test_flatip_tier_recovers_planted_nearest_frame(tmp_path):
    # Below min_patches_for_pq → exact IndexFlatIP.
    vecs, frame_ids = _planted_vectors(n_frames=5, patches_per_frame=10, dim=16)
    idx = FaissPatchIndex(dim=16, min_patches_for_pq=10_000)
    idx.train_add(vecs, frame_ids)

    q = vecs[37]  # belongs to frame 3
    got_frames, scores = idx.search(q, k=1)
    assert got_frames[0] == frame_ids[37]
    assert scores[0] > 0.99  # exact self-match cosine ~1


def test_ivfpq_tier_persist_load_search(tmp_path):
    vecs, frame_ids = _planted_vectors(n_frames=60, patches_per_frame=400, dim=32)  # 24k patches
    idx = FaissPatchIndex(dim=32, min_patches_for_pq=10_000, pq_m=8, pq_nbits=8, ivf_nprobe=16)
    idx.train_add(vecs, frame_ids)
    idx.persist(tmp_path)

    loaded = FaissPatchIndex.load(tmp_path, mmap=True)
    q = vecs[5000]
    got_frames, scores = loaded.search(q, k=5)
    assert frame_ids[5000] in got_frames  # planted frame in top-5 patches


def test_persisted_files_exist(tmp_path):
    vecs, frame_ids = _planted_vectors(n_frames=5, patches_per_frame=10, dim=16)
    idx = FaissPatchIndex(dim=16, min_patches_for_pq=10_000)
    idx.train_add(vecs, frame_ids)
    idx.persist(tmp_path)
    assert (tmp_path / "patches.faiss").exists()
    assert (tmp_path / "patch_frames.npy").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_index.py -v`
Expected: FAIL — `ModuleNotFoundError: src.region.faiss_index`.

- [ ] **Step 3: Implement `FaissPatchIndex`**

Create `src/region/faiss_index.py`:

```python
import logging
from pathlib import Path

import faiss
import numpy as np

logger = logging.getLogger(__name__)

_ADD_BATCH = 100_000


class FaissPatchIndex:
    """faiss patch index. IVF-PQ above `min_patches_for_pq`, exact IndexFlatIP below.

    Patch rows are added in order; row i's frame id is `_patch_frames[i]`. faiss
    returns row indices, which we map back to frame ids.
    """

    def __init__(
        self,
        dim: int,
        *,
        min_patches_for_pq: int = 10_000,
        pq_m: int = 64,
        pq_nbits: int = 8,
        ivf_nlist: int | None = None,
        ivf_nprobe: int = 16,
        train_sample_cap: int = 262_144,
    ):
        self._dim = int(dim)
        self._min_patches_for_pq = int(min_patches_for_pq)
        self._pq_m = int(pq_m)
        self._pq_nbits = int(pq_nbits)
        self._ivf_nlist = ivf_nlist
        self._ivf_nprobe = int(ivf_nprobe)
        self._train_sample_cap = int(train_sample_cap)
        self._index: faiss.Index | None = None
        self._patch_frames: np.ndarray | None = None

    def train_add(self, vectors: np.ndarray, frame_ids: np.ndarray) -> None:
        vectors = np.ascontiguousarray(vectors, dtype=np.float32)
        n = vectors.shape[0]
        assert vectors.shape[1] == self._dim, "dim mismatch"
        assert frame_ids.shape[0] == n, "frame_ids length mismatch"
        self._patch_frames = np.ascontiguousarray(frame_ids, dtype=np.int32)

        if n < self._min_patches_for_pq:
            logger.info("Patch index: %d patches < %d → exact IndexFlatIP", n, self._min_patches_for_pq)
            index = faiss.IndexFlatIP(self._dim)
            index.add(vectors)
            self._index = index
            return

        nlist = self._ivf_nlist if self._ivf_nlist else max(1, n // 4096)
        logger.info("Patch index: IVF-PQ nlist=%d m=%d nbits=%d on %d patches", nlist, self._pq_m, self._pq_nbits, n)
        quantizer = faiss.IndexFlatIP(self._dim)
        index = faiss.IndexIVFPQ(quantizer, self._dim, nlist, self._pq_m, self._pq_nbits, faiss.METRIC_INNER_PRODUCT)
        index.nprobe = self._ivf_nprobe

        # PQ training needs ~39*2^nbits points for its 256-centroid codebooks; floor the
        # sample there so small-but-PQ-eligible bags (≥ min_patches_for_pq but with small
        # nlist) don't undertrain the codebooks. Cap for huge bags. Refines spec §3.2.
        train_floor = max(256 * nlist, 39 * (2 ** self._pq_nbits))
        train_size = min(n, train_floor, self._train_sample_cap)
        if train_size < n:
            rng = np.random.default_rng(0)
            sample_idx = rng.choice(n, size=train_size, replace=False)
            train_vecs = np.ascontiguousarray(vectors[sample_idx], dtype=np.float32)
        else:
            train_vecs = vectors
        index.train(train_vecs)

        for start in range(0, n, _ADD_BATCH):
            index.add(np.ascontiguousarray(vectors[start:start + _ADD_BATCH], dtype=np.float32))
        self._index = index

    def persist(self, path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        assert self._index is not None and self._patch_frames is not None, "nothing to persist"
        faiss.write_index(self._index, str(path / "patches.faiss"))
        np.save(path / "patch_frames.npy", self._patch_frames)

    @classmethod
    def load(cls, path: Path, *, mmap: bool = True) -> "FaissPatchIndex":
        path = Path(path)
        flags = faiss.IO_FLAG_MMAP if mmap else 0
        index = faiss.read_index(str(path / "patches.faiss"), flags)
        patch_frames = np.load(path / "patch_frames.npy", mmap_mode="r" if mmap else None)
        obj = cls(dim=index.d)
        obj._index = index
        obj._patch_frames = patch_frames
        return obj

    def search(self, q: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
        assert self._index is not None and self._patch_frames is not None, "index not built/loaded"
        q = np.ascontiguousarray(q.reshape(1, -1), dtype=np.float32)
        k = min(int(k), self._index.ntotal)
        scores, rows = self._index.search(q, k)  # (1, k)
        rows = rows[0]
        scores = scores[0]
        valid = rows >= 0
        rows = rows[valid]
        scores = scores[valid]
        frame_ids = np.asarray(self._patch_frames)[rows].astype(np.int32)
        return frame_ids, scores.astype(np.float32)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_index.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/region/faiss_index.py tests/test_region_index.py
git commit -m "[Backend] FaissPatchIndex: IVF-PQ + exact FlatIP tiers, code-only persist"
```

---

# Slice 2 — Index pass (fused fresh + dense-only upgrade)

Goal: schema v4, region stamp, `RegionSearchConfig`, the `DensePatchIndexer` build, and the fused fresh-index loop wired into the `Indexer`, with a dense-only upgrade path. CLS index must be byte-identical whether built fused or standalone.

## Task 2.1: Bump schema to v4

**Files:**
- Modify: `src/core/schema_versions.py:7-15`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_index_stamp.py` (or a new `tests/test_region_stamp.py` — use the latter to keep region tests together; create it):

```python
def test_metadata_schema_version_is_4():
    from src.core.schema_versions import METADATA_SCHEMA_VERSION
    assert METADATA_SCHEMA_VERSION == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_region_stamp.py::test_metadata_schema_version_is_4 -v`
Expected: FAIL — `assert 3 == 4`.

- [ ] **Step 3: Bump the constant + history**

In `src/core/schema_versions.py`, add a history line and change the constant:

```python
Version history:
  1 — Initial format. file_path stored as absolute string.
  2 — file_path stored relative to the artifact directory (portability fix).
  3 — Flat per-camera frames (per-frame `topic`, top-level `cameras[]`), embedder
      stamp slot (`{name, dim}` | null), aspect-preserving thumbnails under
      per-camera subdirectories.
  4 — Adds optional `region_index` stamp (Region search faiss patch index);
      CLS frame layout unchanged from v3.
"""

METADATA_SCHEMA_VERSION = 4
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_region_stamp.py::test_metadata_schema_version_is_4 -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/schema_versions.py tests/test_region_stamp.py
git commit -m "[Backend] Bump metadata schema to v4 (region_index stamp slot)"
```

## Task 2.2: Region stamp functions

**Files:**
- Modify: `src/core/index_stamp.py`
- Test: `tests/test_region_stamp.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_region_stamp.py`:

```python
import json

from src.core.index_stamp import (
    is_region_stamp_compatible,
    read_region_stamp,
    write_region_stamp,
)


def test_read_region_returns_none_when_unstamped(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 4, "frames": [], "region_index": None}))
    assert read_region_stamp(meta) is None


def test_write_then_read_region_roundtrip(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 4, "frames": [{"timestamp_ns": 1}], "embedder": {"name": "x", "dim": 4}}))
    write_region_stamp(meta, name="tipsv2:m", dim=1024, feature="value-attention", encode_long_side=896, pq={"m": 64, "nbits": 8}, patch_count=123)
    stamp = read_region_stamp(meta)
    assert stamp["embedder_name"] == "tipsv2:m"
    assert stamp["dim"] == 1024
    assert stamp["feature"] == "value-attention"
    assert stamp["encode_long_side"] == 896
    assert stamp["patch_count"] == 123
    # Other fields preserved.
    assert json.loads(meta.read_text())["frames"] == [{"timestamp_ns": 1}]
    assert json.loads(meta.read_text())["embedder"] == {"name": "x", "dim": 4}


def test_region_compatible_matches_identity_fields():
    stamp = {"embedder_name": "a", "dim": 4, "feature": "value-attention", "encode_long_side": 896}
    assert is_region_stamp_compatible(stamp, "a", 4, "value-attention", 896) is True
    assert is_region_stamp_compatible(stamp, "b", 4, "value-attention", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 8, "value-attention", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 4, "last-layer", 896) is False
    assert is_region_stamp_compatible(stamp, "a", 4, "value-attention", 1120) is False
    assert is_region_stamp_compatible(None, "a", 4, "value-attention", 896) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_stamp.py -v`
Expected: FAIL — `ImportError: cannot import name 'read_region_stamp'`.

- [ ] **Step 3: Implement the functions**

Append to `src/core/index_stamp.py`:

```python
def read_region_stamp(metadata_path) -> dict | None:
    """Return the `region_index` stamp from metadata.json, or None if absent."""
    try:
        with Path(metadata_path).open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    stamp = meta.get("region_index")
    return stamp if isinstance(stamp, dict) else None


def write_region_stamp(
    metadata_path,
    *,
    name: str,
    dim: int,
    feature: str,
    encode_long_side: int,
    pq: dict,
    patch_count: int,
) -> None:
    """Set metadata.json's `region_index`, preserving all other fields."""
    path = Path(metadata_path)
    with path.open("r", encoding="utf-8") as handle:
        meta = json.load(handle)
    meta["region_index"] = {
        "engine": "faiss",
        "embedder_name": name,
        "dim": int(dim),
        "feature": feature,
        "encode_long_side": int(encode_long_side),
        "pq": {"m": int(pq["m"]), "nbits": int(pq["nbits"])},
        "patch_count": int(patch_count),
    }
    with path.open("w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=4)


def is_region_stamp_compatible(
    stamp: dict | None, name: str, dim: int, feature: str, encode_long_side: int
) -> bool:
    """True iff a bag's region stamp matches the active embedder + feature + geometry."""
    if not stamp:
        return False
    return (
        stamp.get("embedder_name") == name
        and int(stamp.get("dim", -1)) == int(dim)
        and stamp.get("feature") == feature
        and int(stamp.get("encode_long_side", -1)) == int(encode_long_side)
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_stamp.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/index_stamp.py tests/test_region_stamp.py
git commit -m "[Backend] Add region_index stamp read/write/compat helpers"
```

## Task 2.3: `RegionSearchConfig`

**Files:**
- Modify: `src/core/app_config.py`
- Modify: `config/settings.yaml`
- Test: `tests/test_app_config.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_app_config.py`:

```python
def test_region_search_config_defaults():
    from src.core.app_config import get_app_config
    rc = get_app_config().region_search
    assert rc.enabled is True
    assert rc.engine == "faiss"
    assert rc.pq_m == 64 and rc.pq_nbits == 8
    assert rc.ivf_nlist is None and rc.ivf_nprobe == 16
    assert rc.min_patches_for_pq == 10_000
    assert rc.train_sample_cap == 262_144
    assert rc.patch_fetch_limit == 4096
    assert rc.top_k_patches == 1
    assert rc.refine_enabled is False and rc.refine_top_n == 100
    assert "a photo of a {}." in rc.text_templates
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py::test_region_search_config_defaults -v`
Expected: FAIL — `AttributeError: 'AppConfig' object has no attribute 'region_search'`.

- [ ] **Step 3: Add the dataclass + AppConfig field + parsing**

In `src/core/app_config.py`, add the dataclass (after `ApiConfig`):

```python
@dataclass(frozen=True)
class RegionSearchConfig:
    enabled: bool
    engine: str
    pq_m: int
    pq_nbits: int
    ivf_nlist: Optional[int]
    ivf_nprobe: int
    min_patches_for_pq: int
    train_sample_cap: int
    patch_fetch_limit: int
    top_k_patches: int
    refine_enabled: bool
    refine_top_n: int
    text_templates: tuple[str, ...]
```

Add the field to `AppConfig`:

```python
@dataclass(frozen=True)
class AppConfig:
    ingestion: IngestionConfig
    storage: StorageConfig
    models: ModelsConfig
    embedding: EmbeddingConfig
    search: SearchConfig
    api: ApiConfig
    region_search: "RegionSearchConfig"
    extraction: ExtractionConfig
```

Add a parser function (before `get_app_config`):

```python
_DEFAULT_TEMPLATES = (
    "a photo of a {}.",
    "a photo of the {}.",
    "a cropped photo of a {}.",
    "a close-up photo of a {}.",
    "a bright photo of a {}.",
    "a dark photo of a {}.",
    "a blurry photo of a {}.",
    "a low resolution photo of a {}.",
    "a jpeg corrupted photo of a {}.",
    "a photo of a hard to see {}.",
)


def _parse_region_search_config(raw: Optional[dict]) -> RegionSearchConfig:
    raw = raw or {}
    pq = raw.get("pq") or {}
    ivf = raw.get("ivf") or {}
    agg = raw.get("aggregation") or {}
    refine = raw.get("refine") or {}
    templates = raw.get("text_templates")
    return RegionSearchConfig(
        enabled=bool(raw.get("enabled", True)),
        engine=str(raw.get("engine", "faiss")),
        pq_m=int(pq.get("m", 64)),
        pq_nbits=int(pq.get("nbits", 8)),
        ivf_nlist=(int(ivf["nlist"]) if ivf.get("nlist") is not None else None),
        ivf_nprobe=int(ivf.get("nprobe", 16)),
        min_patches_for_pq=int(raw.get("min_patches_for_pq", 10_000)),
        train_sample_cap=int(raw.get("train_sample_cap", 262_144)),
        patch_fetch_limit=int(raw.get("patch_fetch_limit", 4096)),
        top_k_patches=int(agg.get("top_k_patches", 1)),
        refine_enabled=bool(refine.get("enabled", False)),
        refine_top_n=int(refine.get("top_n", 100)),
        text_templates=tuple(templates) if templates else _DEFAULT_TEMPLATES,
    )
```

In `get_app_config()`, add to the `AppConfig(...)` call (before `extraction=`):

```python
        region_search=_parse_region_search_config(settings.get("region_search")),
```

- [ ] **Step 4: Add the config block to settings.yaml**

In `config/settings.yaml`, after the `search:` block:

```yaml
region_search:
  enabled: true                 # gated by embedder 'dense' capability; off ⇒ no dense pass, no RegionSearcher
  engine: faiss                 # faiss | (future) turbovec
  pq: { m: 64, nbits: 8 }
  ivf: { nlist: null, nprobe: 16 }   # nlist null ⇒ auto = n_patches // 4096
  min_patches_for_pq: 10000     # below ⇒ exact IndexFlatIP fallback (no training)
  train_sample_cap: 262144      # max Patches used to train IVF-PQ
  patch_fetch_limit: 4096       # patches pulled per bag before group→max
  aggregation: { top_k_patches: 1 }  # 1 == MaxSim; >1 == top-k mean
  refine: { enabled: false, top_n: 100 }
  text_templates:
    - "a photo of a {}."
    - "a photo of the {}."
    - "a cropped photo of a {}."
    - "a close-up photo of a {}."
    - "a bright photo of a {}."
    - "a dark photo of a {}."
    - "a blurry photo of a {}."
    - "a low resolution photo of a {}."
    - "a jpeg corrupted photo of a {}."
    - "a photo of a hard to see {}."
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/app_config.py config/settings.yaml tests/test_app_config.py
git commit -m "[Config] Add region_search config block + RegionSearchConfig"
```

## Task 2.4: `DensePatchIndexer` (spill-to-disk build)

**Files:**
- Create: `src/region/dense_indexer.py`
- Test: `tests/test_region_index.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_region_index.py`:

```python
from pathlib import Path

from src.region.dense_indexer import DensePatchIndexer
from src.core.app_config import get_app_config


def test_dense_indexer_builds_and_loads(tmp_path):
    region_dir = tmp_path / "region"
    rc = get_app_config().region_search
    indexer = DensePatchIndexer(region_dir=region_dir, dim=16, region_config=rc)

    rng = np.random.default_rng(1)
    total = 0
    for frame_id in range(6):
        grid = rng.standard_normal((4, 5, 16)).astype(np.float32)  # 20 patches/frame
        grid /= np.linalg.norm(grid, axis=-1, keepdims=True)
        indexer.add_frame(frame_id, grid)
        total += 20
    patch_count = indexer.finalize()

    assert patch_count == total
    assert (region_dir / "patches.faiss").exists()
    assert (region_dir / "patch_frames.npy").exists()

    from src.region.faiss_index import FaissPatchIndex
    loaded = FaissPatchIndex.load(region_dir, mmap=True)
    probe = np.zeros(16, dtype=np.float32)
    probe[0] = 1.0  # any valid unit query; assertion only checks a valid frame id comes back
    got, _ = loaded.search(probe, k=1)
    assert 0 <= int(got[0]) <= 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_region_index.py::test_dense_indexer_builds_and_loads -v`
Expected: FAIL — `ModuleNotFoundError: src.region.dense_indexer`.

- [ ] **Step 3: Implement `DensePatchIndexer`**

Create `src/region/dense_indexer.py`:

```python
import logging
from pathlib import Path

import numpy as np

from src.core.app_config import RegionSearchConfig
from src.region.faiss_index import FaissPatchIndex

logger = logging.getLogger(__name__)


class DensePatchIndexer:
    """Accumulates per-frame patch grids to a disk spill file, then builds a
    FaissPatchIndex. Never holds all patches in RAM (the spill is mmap-read)."""

    def __init__(self, region_dir: Path, dim: int, region_config: RegionSearchConfig):
        self._region_dir = Path(region_dir)
        self._region_dir.mkdir(parents=True, exist_ok=True)
        self._dim = int(dim)
        self._cfg = region_config
        self._spill_path = self._region_dir / ".patches_spill.f32"
        self._spill = open(self._spill_path, "wb")
        self._frame_ids: list[int] = []
        self._count = 0

    def add_frame(self, frame_id: int, grid: np.ndarray) -> None:
        """grid: (H_p, W_p, dim) float32, L2-normalized per patch."""
        flat = np.ascontiguousarray(grid.reshape(-1, self._dim), dtype=np.float32)
        flat.tofile(self._spill)
        self._frame_ids.extend([int(frame_id)] * flat.shape[0])
        self._count += flat.shape[0]

    def finalize(self) -> int:
        """Build + persist the faiss index. Returns total patch_count."""
        self._spill.close()
        if self._count == 0:
            logger.warning("DensePatchIndexer: no patches accumulated; nothing built.")
            return 0

        vectors = np.memmap(self._spill_path, dtype=np.float32, mode="r", shape=(self._count, self._dim))
        frame_ids = np.asarray(self._frame_ids, dtype=np.int32)

        index = FaissPatchIndex(
            dim=self._dim,
            min_patches_for_pq=self._cfg.min_patches_for_pq,
            pq_m=self._cfg.pq_m,
            pq_nbits=self._cfg.pq_nbits,
            ivf_nlist=self._cfg.ivf_nlist,
            ivf_nprobe=self._cfg.ivf_nprobe,
            train_sample_cap=self._cfg.train_sample_cap,
        )
        index.train_add(vectors, frame_ids)
        index.persist(self._region_dir)

        del vectors  # release the memmap before deleting the spill
        self._spill_path.unlink(missing_ok=True)
        return self._count
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_region_index.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/region/dense_indexer.py tests/test_region_index.py
git commit -m "[Backend] DensePatchIndexer: spill-to-disk faiss build over patch grids"
```

## Task 2.5: Fused fresh-index loop + dense-only upgrade in `Indexer`

**Files:**
- Modify: `src/ingestion/indexer.py`
- Modify: `src/services/component_factory.py:17-18` (create_indexer)
- Test: `tests/test_indexer_embedding.py`, `tests/fakes.py`

- [ ] **Step 1: Add a region-capable fake embedder**

Append to `tests/fakes.py`:

```python
class FakeDenseEmbedder(FakeEmbedder):
    """Region-capable fake: deterministic CLS + a small patch grid per image."""

    def __init__(self, dim: int = 4, name: str = "fake-dense:test", encode_long_side: int = 56):
        super().__init__(dim=dim, name=name)
        self._encode_long_side = encode_long_side

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text", "dense"})

    @property
    def encode_long_side(self) -> int | None:
        return self._encode_long_side

    def embed_global_and_dense(self, images):
        out = []
        for i, _ in enumerate(images):
            cls = np.eye(self._dim, dtype=np.float32)[i % self._dim]
            grid = np.zeros((2, 3, self._dim), dtype=np.float32)  # 6 patches
            grid[..., (i % self._dim)] = 1.0
            out.append((cls, grid))
        return out

    def embed_dense(self, images):
        return [grid for _, grid in self.embed_global_and_dense(images)]
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/test_indexer_embedding.py` (it already has `_make_bag`; reuse it). These assert (a) the fused path builds the region index and stamps `region_index`, and (b) the CLS LanceDB rows are identical to the standalone path:

```python
import lancedb

from tests.fakes import FakeDenseEmbedder
from src.core.index_stamp import read_region_stamp


def _cls_rows(db_path):
    # NB: vectors compared too. Valid because _make_bag is single-frame, so both the
    # fused (one-image-per-call) and batched paths see image-index 0 from FakeDenseEmbedder.
    # Per-image CLS == fused CLS for the REAL embedder is covered by Slice 0 Task 0.3.
    db = lancedb.connect(str(db_path))
    rows = db.open_table("frames").to_list()
    return sorted(rows, key=lambda r: (r["topic"], r["timestamp_ns"]))


def test_fused_index_builds_region_index_and_stamps(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    from src.ingestion.indexer import Indexer
    from src.region.dense_indexer import DensePatchIndexer

    emb = FakeDenseEmbedder(dim=4)
    region_indexer = DensePatchIndexer(
        region_dir=artifact / "region", dim=4, region_config=cfg.region_search
    )
    indexer = Indexer(bag_path=str(bag), config=cfg, embedder=emb, region_indexer=region_indexer)
    indexer.build_index()

    assert (artifact / "region" / "patches.faiss").exists()
    stamp = read_region_stamp(artifact / "metadata.json")
    assert stamp is not None
    assert stamp["embedder_name"] == "fake-dense:test"
    assert stamp["feature"] == "value-attention"
    assert stamp["encode_long_side"] == 56
    assert stamp["patch_count"] == 6  # 1 frame × 6 patches


def test_fused_cls_rows_match_standalone(tmp_path):
    from src.ingestion.indexer import Indexer
    from src.region.dense_indexer import DensePatchIndexer

    cfg_a, bag_a, art_a = _make_bag(tmp_path / "a")
    cfg_b, bag_b, art_b = _make_bag(tmp_path / "b")

    # Standalone CLS-only (no region indexer).
    Indexer(bag_path=str(bag_a), config=cfg_a, embedder=FakeDenseEmbedder(dim=4)).build_index()

    # Fused (with region indexer).
    Indexer(
        bag_path=str(bag_b), config=cfg_b, embedder=FakeDenseEmbedder(dim=4),
        region_indexer=DensePatchIndexer(region_dir=art_b / "region", dim=4, region_config=cfg_b.region_search),
    ).build_index()

    assert _cls_rows(art_a / "lancedb") == _cls_rows(art_b / "lancedb")
```

Note: `_make_bag` currently writes `"schema_version": 3`. Update its dict to `4` (the bump from Task 2.1) so it's a valid v4 bag — change the one literal in `tests/test_indexer_embedding.py`'s `_make_bag`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py -k fused -v`
Expected: FAIL — `Indexer.__init__() got an unexpected keyword argument 'region_indexer'`.

- [ ] **Step 4: Implement the fused loop in `Indexer`**

In `src/ingestion/indexer.py`, add imports at top:

```python
from src.core.index_stamp import write_embedder_stamp, write_region_stamp
```

(keep the existing `write_embedder_stamp` import — merge into one line.)

Extend `__init__` to accept an optional `region_indexer`:

```python
    def __init__(
        self,
        bag_path: str,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
        region_indexer=None,
    ):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.artifact_dir = resolve_artifact_path(bag_path=self.bag_path)
        self.metadata_path = self.artifact_dir / "metadata.json"
        self.db_path = self.artifact_dir / "lancedb"

        if not self.metadata_path.exists():
            raise FileNotFoundError(
                f"Metadata not found at {self.metadata_path}. Run extraction first."
            )

        self.batch_size = app_config.ingestion.batch_size
        self.embedder = embedder if embedder is not None else create_embedder(app_config)
        self._region_indexer = region_indexer
```

Replace everything from the `db = lancedb.connect(str(self.db_path))` line through the **end of `build_index`** (i.e. the existing `data_to_insert`, `for i in tqdm(...)` loop, the `if not data_to_insert` guard, the `create_table`, the `write_embedder_stamp`, and the final logging) with the block below. The fused path runs one image at a time through `embed_global_and_dense` (CLS → LanceDB, grid → region indexer); the non-region path keeps the existing batched `embed_images`:

```python
        db = lancedb.connect(str(self.db_path))
        table_name = "frames"
        data_to_insert = []
        region_active = self._region_indexer is not None and "dense" in self.embedder.capabilities

        logger.info(
            "Generating embeddings for %s frames with %s (region=%s)...",
            len(frames), self.embedder.name, region_active,
        )

        if region_active:
            for frame_id, meta in enumerate(tqdm(frames)):
                abs_path = str(self.artifact_dir / meta["file_path"])
                try:
                    with Image.open(abs_path) as image:
                        img = image.convert("RGB")
                except (FileNotFoundError, OSError):
                    logger.warning("Skipping unreadable frame %s during indexing", abs_path, exc_info=True)
                    continue
                (cls, grid), = self.embedder.embed_global_and_dense([img])
                data_to_insert.append({
                    "timestamp_ns": meta["timestamp_ns"],
                    "file_path": abs_path,
                    "topic": meta["topic"],
                    "vector": cls.tolist(),
                })
                self._region_indexer.add_frame(frame_id, grid)
        else:
            for i in tqdm(range(0, len(frames), self.batch_size)):
                batch_meta = frames[i : i + self.batch_size]
                valid_batch_meta = []
                images = []
                for meta in batch_meta:
                    abs_path = str(self.artifact_dir / meta["file_path"])
                    try:
                        with Image.open(abs_path) as image:
                            images.append(image.convert("RGB"))
                        valid_batch_meta.append({**meta, "_abs_path": abs_path})
                    except (FileNotFoundError, OSError):
                        logger.warning("Skipping unreadable frame %s during indexing", abs_path, exc_info=True)
                if not images:
                    continue
                embeddings = self.embedder.embed_images(images)
                for meta, emb in zip(valid_batch_meta, embeddings):
                    data_to_insert.append({
                        "timestamp_ns": meta["timestamp_ns"],
                        "file_path": meta["_abs_path"],
                        "topic": meta["topic"],
                        "vector": emb.tolist(),
                    })

        if not data_to_insert:
            logger.warning("No valid frames were embedded; skipping LanceDB write.")
            return

        logger.info("Writing embeddings to LanceDB...")
        db.create_table(table_name, data=data_to_insert, mode="overwrite")

        write_embedder_stamp(
            self.metadata_path, name=self.embedder.name, dim=self.embedder.embedding_dim
        )

        if region_active:
            patch_count = self._region_indexer.finalize()
            write_region_stamp(
                self.metadata_path,
                name=self.embedder.name,
                dim=self.embedder.embedding_dim,
                feature="value-attention",
                encode_long_side=int(self.embedder.encode_long_side),
                pq=self._region_indexer.pq_params,
                patch_count=patch_count,
            )
```

The `pq=self._region_indexer.pq_params` above reads the PQ params from the region indexer's config (the Indexer does not hold `RegionSearchConfig` directly). Add that accessor to `DensePatchIndexer` in `src/region/dense_indexer.py`:

```python
    @property
    def pq_params(self) -> dict:
        return {"m": self._cfg.pq_m, "nbits": self._cfg.pq_nbits}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py -v`
Expected: PASS (existing CLS test + the two new fused tests).

- [ ] **Step 6: Wire `create_indexer` to inject the region indexer when enabled**

In `src/services/component_factory.py`, change `create_indexer`:

```python
    def create_indexer(self, bag_path: str) -> Indexer:
        region_indexer = None
        rc = self._config.region_search
        if rc.enabled and "dense" in self._embedder.capabilities:
            from pathlib import Path
            from src.core.storage import resolve_artifact_path
            from src.region.dense_indexer import DensePatchIndexer
            region_dir = resolve_artifact_path(bag_path=Path(bag_path)) / "region"
            region_indexer = DensePatchIndexer(
                region_dir=region_dir,
                dim=self._embedder.embedding_dim,
                region_config=rc,
            )
        return Indexer(
            bag_path=bag_path,
            config=self._config,
            embedder=self._embedder,
            region_indexer=region_indexer,
        )
```

- [ ] **Step 7: Run the full suite**

Run: `PYTHONPATH="" uv run pytest tests/ -v`
Expected: PASS except the pre-existing `test_indexing_service.py` drift. No new failures.

- [ ] **Step 8: Commit**

```bash
git add src/ingestion/indexer.py src/services/component_factory.py src/region/dense_indexer.py tests/fakes.py tests/test_indexer_embedding.py
git commit -m "[Backend] Fused fresh-index loop builds CLS + Region in one trunk pass"
```

---

# Slice 3 — Query construction + RegionSearcher

Goal: build a query vector from points or text, then federate patch search across bags grouping by `frame_id` (MaxSim), joining `metadata.json` for display fields, reusing temporal dedup.

## Task 3.1: `query.py`

**Files:**
- Create: `src/region/query.py`
- Test: `tests/test_region_query.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_region_query.py`:

```python
import numpy as np
from PIL import Image

from src.region.query import build_query_from_points, build_query_from_text
from tests.fakes import FakeDenseEmbedder


def test_points_query_is_unit_norm_and_averages_clicked_patches():
    emb = FakeDenseEmbedder(dim=4)  # grid is (2,3,4), all mass on channel (i%dim); single image → channel 0
    img = Image.new("RGB", (60, 40))
    q = build_query_from_points(img, [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}], emb)
    assert q.shape == (4,)
    assert np.isclose(np.linalg.norm(q), 1.0, atol=1e-5)


def test_text_query_ensembles_templates_and_normalizes():
    emb = FakeDenseEmbedder(dim=4)
    q = build_query_from_text("traffic light", emb, templates=("a photo of a {}.", "a {} up close."))
    assert q.shape == (4,)
    assert np.isclose(np.linalg.norm(q), 1.0, atol=1e-5)


def test_points_validation_rejects_empty_and_out_of_range():
    emb = FakeDenseEmbedder(dim=4)
    img = Image.new("RGB", (60, 40))
    import pytest
    with pytest.raises(ValueError):
        build_query_from_points(img, [], emb)
    with pytest.raises(ValueError):
        build_query_from_points(img, [{"x": 1.5, "y": 0.2}], emb)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_query.py -v`
Expected: FAIL — `ModuleNotFoundError: src.region.query`.

- [ ] **Step 3: Implement `query.py`**

Create `src/region/query.py`:

```python
import numpy as np
from PIL import Image


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError("Query vector has zero norm")
    return (v / n).astype(np.float32)


def build_query_from_points(image: Image.Image, points: list[dict], embedder) -> np.ndarray:
    """points: list of {'x','y'} normalized to [0,1] on the displayed image.
    Returns a unit (dim,) vector = mean of the value-attention patches under each point."""
    if not points:
        raise ValueError("At least one point is required")
    for p in points:
        if not (0.0 <= float(p["x"]) <= 1.0 and 0.0 <= float(p["y"]) <= 1.0):
            raise ValueError("Each point's x and y must be in [0, 1]")

    grid = embedder.embed_dense([image.convert("RGB")])[0]  # (H_p, W_p, dim)
    h_p, w_p, _ = grid.shape
    picked = []
    for p in points:
        i = min(int(float(p["y"]) * h_p), h_p - 1)
        j = min(int(float(p["x"]) * w_p), w_p - 1)
        picked.append(grid[i, j])
    return _normalize(np.mean(np.stack(picked, axis=0), axis=0))


def build_query_from_text(text: str, embedder, templates: tuple[str, ...]) -> np.ndarray:
    if not text.strip():
        raise ValueError("Text query must not be empty")
    prompts = [t.format(text) for t in templates]
    feats = embedder.embed_text(prompts)  # (N, dim), each unit-norm
    return _normalize(np.mean(feats, axis=0))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_query.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/region/query.py tests/test_region_query.py
git commit -m "[Backend] Region query construction from points + text templates"
```

## Task 3.2: `RegionSearcher`

**Files:**
- Create: `src/region/region_search.py`
- Test: `tests/test_region_search.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_region_search.py`. These build a real (tiny) faiss index on disk + a v4 metadata.json, then exercise federation/grouping/self-exclusion/dedup with a `FakeDenseEmbedder`:

```python
import json
import numpy as np

from src.region.faiss_index import FaissPatchIndex
from src.region.region_search import RegionSearcher
from src.core.app_config import get_app_config
from tests.fakes import FakeDenseEmbedder


def _make_region_bag(bag_dir, frames, patch_vecs_per_frame, dim, artifact_name=".bag_chat"):
    """frames: list of {timestamp_ns, topic, file_path}. patch_vecs_per_frame: list of (P,dim) arrays."""
    artifact = bag_dir / artifact_name
    region = artifact / "region"
    region.mkdir(parents=True)
    vecs, frame_ids = [], []
    for fid, pv in enumerate(patch_vecs_per_frame):
        vecs.append(pv.astype(np.float32))
        frame_ids.extend([fid] * pv.shape[0])
    vecs = np.concatenate(vecs, axis=0)
    idx = FaissPatchIndex(dim=dim, min_patches_for_pq=10_000)  # tiny → FlatIP
    idx.train_add(vecs, np.asarray(frame_ids, dtype=np.int32))
    idx.persist(region)
    meta = {
        "schema_version": 4,
        "cameras": sorted({f["topic"] for f in frames}),
        "embedder": {"name": "fake-dense:test", "dim": dim},
        "region_index": {
            "engine": "faiss", "embedder_name": "fake-dense:test", "dim": dim,
            "feature": "value-attention", "encode_long_side": 56,
            "pq": {"m": 64, "nbits": 8}, "patch_count": int(vecs.shape[0]),
        },
        "frames": frames,
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return str(bag_dir)


def _unit(dim, axis):
    v = np.zeros(dim, dtype=np.float32)
    v[axis] = 1.0
    return v


def test_maxsim_groups_patches_by_frame(tmp_path):
    dim = 8
    bag = tmp_path / "bag1"
    bag.mkdir()
    # frame 0: a patch aligned with axis 2; frame 1: patches on axis 5.
    f0 = np.stack([_unit(dim, 2), _unit(dim, 7)])
    f1 = np.stack([_unit(dim, 5), _unit(dim, 5)])
    frames = [
        {"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"},
        {"timestamp_ns": 20, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_20.jpg"},
    ]
    bag_path = _make_region_bag(bag, frames, [f0, f1], dim)

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    results = searcher.search_by_q(_unit(dim, 2), [bag_path], top_k=5)
    assert results[0]["timestamp_ns"] == 10  # frame 0 (axis 2) ranks first
    assert results[0]["topic"] == "/cam/a"
    assert "similarity_score" in results[0]
    assert "bag_path" in results[0] and "source_bag" in results[0]


def test_self_exclude_drops_support_frame(tmp_path):
    dim = 8
    bag = tmp_path / "bag2"
    bag.mkdir()
    f0 = np.stack([_unit(dim, 2)])
    frames = [{"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"}]
    bag_path = _make_region_bag(bag, frames, [f0], dim)
    abs_support = str(tmp_path / "bag2" / ".bag_chat" / "thumbnails/cam_a/frame_10.jpg")

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    results = searcher.search_by_q(_unit(dim, 2), [bag_path], top_k=5, exclude_file_path=abs_support)
    assert results == []


def test_skips_bag_without_region_index(tmp_path):
    bag = tmp_path / "bag3"
    artifact = bag / ".bag_chat"
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(json.dumps({
        "schema_version": 4, "cameras": ["/cam/a"],
        "embedder": {"name": "fake-dense:test", "dim": 8},
        "region_index": None,
        "frames": [{"timestamp_ns": 1, "topic": "/cam/a", "file_path": "x.jpg"}],
    }))
    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=8))
    assert searcher.search_by_q(_unit(8, 0), [str(bag)], top_k=5) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py -v`
Expected: FAIL — `ModuleNotFoundError: src.region.region_search`.

- [ ] **Step 3: Implement `RegionSearcher`**

Create `src/region/region_search.py`:

```python
import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import List

import numpy as np

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import is_region_stamp_compatible, read_region_stamp
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder, create_embedder
from src.region.faiss_index import FaissPatchIndex
from src.region.query import build_query_from_points, build_query_from_text

logger = logging.getLogger(__name__)


class RegionSearcher:
    def __init__(self, config: AppConfig | None = None, embedder: FrameEmbedder | None = None):
        app_config = config or get_app_config()
        self._cfg = app_config.region_search
        self.temporal_dedup_window_ns = int(
            max(0.0, app_config.search.temporal_dedup_window_sec) * 1_000_000_000
        )
        self._embedder = embedder if embedder is not None else create_embedder(app_config)
        self._index_cache: dict[str, FaissPatchIndex] = {}

    def invalidate_cache(self, region_dir: str) -> None:
        self._index_cache.pop(region_dir, None)

    @staticmethod
    def _sequence_key(result: dict) -> tuple[str, str]:
        return (str(result.get("bag_path", "")), str(result.get("topic", "")))

    def _apply_temporal_dedup(self, ranked_results: list[dict]) -> list[dict]:
        if self.temporal_dedup_window_ns <= 0:
            return ranked_results
        kept: list[dict] = []
        for candidate in ranked_results:
            candidate_key = self._sequence_key(candidate)
            candidate_ts = int(candidate.get("timestamp_ns", 0))
            is_redundant = False
            for selected in kept:
                if self._sequence_key(selected) != candidate_key:
                    continue
                if abs(candidate_ts - int(selected.get("timestamp_ns", 0))) <= self.temporal_dedup_window_ns // 2:
                    is_redundant = True
                    break
            if not is_redundant:
                kept.append(candidate)
        return kept

    def _compatible_region_bags(self, bag_paths: List[str]) -> list[tuple[str, Path, list[dict]]]:
        keep = []
        for bag_path in bag_paths:
            artifact = resolve_artifact_path(bag_path=Path(bag_path))
            meta_path = artifact / "metadata.json"
            stamp = read_region_stamp(meta_path)
            if not is_region_stamp_compatible(
                stamp, self._embedder.name, self._embedder.embedding_dim,
                "value-attention", int(self._embedder.encode_long_side or -1),
            ):
                logger.warning("Skipping %s: no/incompatible Region index — re-index to enable Region search", Path(bag_path).name)
                continue
            region_dir = artifact / "region"
            if not (region_dir / "patches.faiss").exists():
                logger.warning("Skipping %s: region stamp present but patches.faiss missing", Path(bag_path).name)
                continue
            with meta_path.open("r", encoding="utf-8") as handle:
                frames = json.load(handle).get("frames", [])
            keep.append((bag_path, artifact, frames))
        return keep

    def _get_index(self, region_dir: Path) -> FaissPatchIndex:
        key = str(region_dir)
        if key not in self._index_cache:
            self._index_cache[key] = FaissPatchIndex.load(region_dir, mmap=True)
        return self._index_cache[key]

    def search_by_q(
        self, q: np.ndarray, bag_paths: List[str], top_k: int = 5, exclude_file_path: str | None = None
    ) -> list[dict]:
        exclude_path = str(Path(exclude_file_path).expanduser().resolve()) if exclude_file_path else None
        top_k_patches = max(1, self._cfg.top_k_patches)
        all_results: list[dict] = []

        for bag_path, artifact, frames in self._compatible_region_bags(bag_paths):
            index = self._get_index(artifact / "region")
            frame_ids, scores = index.search(q, self._cfg.patch_fetch_limit)
            if frame_ids.size == 0:
                continue

            per_frame: dict[int, list[float]] = defaultdict(list)
            for fid, sc in zip(frame_ids.tolist(), scores.tolist()):
                per_frame[int(fid)].append(float(sc))

            distinct = 0
            for fid, sclist in per_frame.items():
                if fid < 0 or fid >= len(frames):
                    continue
                frame = frames[fid]
                abs_path = str(artifact / frame["file_path"])
                if exclude_path and str(Path(abs_path).resolve()) == exclude_path:
                    continue
                sclist.sort(reverse=True)
                score = float(np.mean(sclist[:top_k_patches])) if top_k_patches > 1 else sclist[0]
                all_results.append({
                    "timestamp_ns": frame["timestamp_ns"],
                    "topic": frame["topic"],
                    "file_path": abs_path,
                    "bag_path": str(Path(bag_path).resolve()),
                    "source_bag": Path(bag_path).name,
                    "similarity_score": score,
                })
                distinct += 1

            if distinct < top_k:
                logger.warning(
                    "Region search on %s yielded %d distinct frames < top_k=%d; raise patch_fetch_limit.",
                    Path(bag_path).name, distinct, top_k,
                )

        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return self._apply_temporal_dedup(all_results)[:top_k]

    def search_by_points(self, image, points, bag_paths, top_k=5, exclude_file_path=None):
        q = build_query_from_points(image, points, self._embedder)
        return self.search_by_q(q, bag_paths, top_k, exclude_file_path)

    def search_by_text(self, text, bag_paths, top_k=5):
        q = build_query_from_text(text, self._embedder, self._cfg.text_templates)
        return self.search_by_q(q, bag_paths, top_k)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/region/region_search.py tests/test_region_search.py
git commit -m "[Backend] RegionSearcher: federation, MaxSim grouping, metadata join, dedup"
```

---

# Slice 4 — API + wiring

Goal: expose region endpoints behind the authed `/api` router, build the searcher in lifespan (only when capable + enabled), invalidate its cache on re-index.

## Task 4.1: `RegionSearchService`

**Files:**
- Create: `src/services/region_search_service.py`
- Test: covered via API tests in Task 4.4 (service is a thin validator; unit-test inline here)

- [ ] **Step 1: Write the failing test**

Create `tests/test_region_api.py` (start with the service):

```python
import pytest

from src.services.region_search_service import RegionSearchService


class _StubSearcher:
    def search_by_text(self, text, bag_paths, top_k):
        return [{"ok": True, "text": text, "n": len(bag_paths), "top_k": top_k}]
    def search_by_points(self, image, points, bag_paths, top_k, exclude_file_path=None):
        return [{"points": len(points), "exclude": exclude_file_path}]


def test_service_rejects_empty_bag_paths():
    svc = RegionSearchService(_StubSearcher())
    with pytest.raises(ValueError):
        svc.search_by_text(text="x", bag_paths=[], top_k=5)


def test_service_delegates_text():
    svc = RegionSearchService(_StubSearcher())
    out = svc.search_by_text(text="car", bag_paths=["/b"], top_k=3)
    assert out[0]["text"] == "car" and out[0]["top_k"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -v`
Expected: FAIL — `ModuleNotFoundError: src.services.region_search_service`.

- [ ] **Step 3: Implement the service**

Create `src/services/region_search_service.py`:

```python
import io

from PIL import Image


class RegionSearchService:
    def __init__(self, searcher):
        self._searcher = searcher

    def _require_bags(self, bag_paths):
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")

    def search_by_text(self, text: str, bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not text.strip():
            raise ValueError("Text query must not be empty.")
        return self._searcher.search_by_text(text=text, bag_paths=bag_paths, top_k=top_k)

    def search_by_frame(self, support_file_path: str, points: list[dict], bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not support_file_path.strip():
            raise ValueError("support_file_path must not be empty.")
        from pathlib import Path
        image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
        return self._searcher.search_by_points(
            image=image, points=points, bag_paths=bag_paths, top_k=top_k,
            exclude_file_path=support_file_path,
        )

    def search_by_image(self, image_bytes: bytes, points: list[dict], bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self._searcher.search_by_points(
            image=image, points=points, bag_paths=bag_paths, top_k=top_k,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/region_search_service.py tests/test_region_api.py
git commit -m "[Backend] RegionSearchService: validation + delegation to RegionSearcher"
```

## Task 4.2: Build the searcher in lifespan + factory

**Files:**
- Modify: `src/services/component_factory.py`
- Modify: `app.py` (lifespan)

- [ ] **Step 1: Add `create_region_searcher` to the factory**

In `src/services/component_factory.py`, add an import and method:

```python
from src.region.region_search import RegionSearcher
```

```python
    def create_region_searcher(self) -> RegionSearcher | None:
        rc = self._config.region_search
        if not (rc.enabled and "dense" in self._embedder.capabilities):
            return None
        return RegionSearcher(config=self._config, embedder=self._embedder)
```

- [ ] **Step 2: Build it into app.state in lifespan**

In `app.py`, after the `searcher_instance` assignment (lines ~91-93), add:

```python
    fastapi_app.state.region_searcher_instance = (
        fastapi_app.state.component_factory.create_region_searcher()
    )
```

And in teardown (after `del fastapi_app.state.searcher_instance`), add:

```python
    if getattr(fastapi_app.state, "region_searcher_instance", None) is not None:
        del fastapi_app.state.region_searcher_instance
```

- [ ] **Step 3: Verify the app imports + starts**

Run: `PYTHONPATH="" uv run python -c "import app; print('ok')"`
Expected: prints `ok` (module imports without error). Full startup needs `JWT_SECRET`/`REFRESH_SECRET`; the import check is sufficient here.

- [ ] **Step 4: Commit**

```bash
git add src/services/component_factory.py app.py
git commit -m "[Backend] Build region_searcher_instance in lifespan (gated on capability)"
```

## Task 4.3: DI provider

**Files:**
- Modify: `src/api/dependencies.py`

- [ ] **Step 1: Add the provider**

In `src/api/dependencies.py`, add import + function:

```python
from fastapi import HTTPException, Request

from src.services.region_search_service import RegionSearchService
```

```python
def get_region_search_service(request: Request) -> RegionSearchService:
    searcher = getattr(request.app.state, "region_searcher_instance", None)
    if searcher is None:
        raise HTTPException(
            status_code=400,
            detail="Region search is not available with the active embedding backend.",
        )
    return RegionSearchService(searcher=searcher)
```

- [ ] **Step 2: Verify import**

Run: `PYTHONPATH="" uv run python -c "from src.api.dependencies import get_region_search_service; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/api/dependencies.py
git commit -m "[API] Add get_region_search_service dependency (400 when backend lacks dense)"
```

## Task 4.4: Region endpoints

**Files:**
- Modify: `src/api/search_routes.py`
- Test: `tests/test_region_api.py`

- [ ] **Step 1: Write the failing API tests**

Add to `tests/test_region_api.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.search_routes import router as search_router
from src.api.dependencies import get_region_search_service


def _client_with_stub(bypass_auth, stub):
    app = FastAPI()
    app.include_router(search_router)
    bypass_auth(app)
    app.dependency_overrides[get_region_search_service] = lambda: stub
    return TestClient(app)


class _SvcStub:
    def search_by_text(self, text, bag_paths, top_k):
        return [{"timestamp_ns": 1, "topic": "/cam/a", "similarity_score": 0.9}]
    def search_by_frame(self, support_file_path, points, bag_paths, top_k):
        return [{"timestamp_ns": 2, "topic": "/cam/a", "similarity_score": 0.8}]
    def search_by_image(self, image_bytes, points, bag_paths, top_k):
        return [{"timestamp_ns": 3, "topic": "/cam/a", "similarity_score": 0.7}]


def test_region_by_text_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/by-text", json={"text": "car", "bag_paths": ["/b"], "top_k": 5})
    assert resp.status_code == 200
    assert resp.json()["results"][0]["timestamp_ns"] == 1


def test_region_by_frame_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/by-frame", json={
        "support_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
        "points": [{"x": 0.5, "y": 0.5}], "bag_paths": ["/b"], "top_k": 5,
    })
    assert resp.status_code == 200
    assert resp.json()["results"][0]["timestamp_ns"] == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -k endpoint -v`
Expected: FAIL — 404 (routes don't exist yet).

- [ ] **Step 3: Implement the endpoints**

In `src/api/search_routes.py`, add imports and models + routes. Add to the imports:

```python
from src.api.dependencies import get_region_search_service
from src.services.region_search_service import RegionSearchService
```

Add request models (after `SimilarSearchRequest`):

```python
class Point(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class RegionByFrameRequest(BaseModel):
    support_file_path: str = Field(..., min_length=1)
    points: List[Point] = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)


class RegionByTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    bag_paths: List[str]
    top_k: int = Field(default=5, ge=1, le=100)
```

Add routes:

```python
@router.post("/search/region/by-text")
async def region_search_by_text(
    req: RegionByTextRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    try:
        results = service.search_by_text(text=req.text, bag_paths=req.bag_paths, top_k=req.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"query": req.text, "results": results}


@router.post("/search/region/by-frame")
async def region_search_by_frame(
    req: RegionByFrameRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    try:
        results = service.search_by_frame(
            support_file_path=req.support_file_path,
            points=[p.model_dump() for p in req.points],
            bag_paths=req.bag_paths,
            top_k=req.top_k,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return {"query": "region:frame", "results": results}


@router.post("/search/region/by-image")
async def region_search_by_image(
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
    image: UploadFile = File(...),
    points: str = Form(...),
    bag_paths: List[str] = Form(...),
    top_k: int = Form(default=5, ge=1, le=100),
):
    import json as _json
    try:
        parsed_points = _json.loads(points)
        image_bytes = await image.read()
        results = service.search_by_image(
            image_bytes=image_bytes, points=parsed_points, bag_paths=bag_paths, top_k=top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return {"query": "region:image", "results": results}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_region_api.py -v`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `PYTHONPATH="" uv run pytest tests/ -v`
Expected: PASS except the pre-existing `test_indexing_service.py` drift.

- [ ] **Step 6: Commit**

```bash
git add src/api/search_routes.py tests/test_region_api.py
git commit -m "[API] Region search endpoints: by-text, by-frame, by-image"
```

## Task 4.5: Invalidate region cache after re-index

**Files:**
- Modify: `src/services/indexing_service.py:38-55`
- Modify: `src/api/dependencies.py` (pass region searcher to IndexingService)

- [ ] **Step 1: Pass the region searcher into IndexingService**

In `src/services/indexing_service.py`, extend `__init__`:

```python
    def __init__(
        self,
        factory: BackendComponentFactory,
        status_store: MutableMapping[str, str],
        searcher: GlobalSearcher | None = None,
        region_searcher=None,
    ):
        self._factory = factory
        self._status_store = status_store
        self._searcher = searcher
        self._region_searcher = region_searcher
```

In `index_bag`, after the existing `self._searcher.invalidate_cache(db_path)` block, add:

```python
            if self._region_searcher is not None:
                region_dir = str(indexer.artifact_dir / "region")
                self._region_searcher.invalidate_cache(region_dir)
                logger.debug("Invalidated region index cache for %s", region_dir)
```

- [ ] **Step 2: Wire it in the DI provider**

In `src/api/dependencies.py`, update `get_indexing_service`:

```python
def get_indexing_service(request: Request) -> IndexingService:
    return IndexingService(
        factory=request.app.state.component_factory,
        status_store=indexing_status,
        searcher=request.app.state.searcher_instance,
        region_searcher=getattr(request.app.state, "region_searcher_instance", None),
    )
```

- [ ] **Step 3: Verify imports + run suite**

Run: `PYTHONPATH="" uv run pytest tests/ -v`
Expected: PASS except the pre-existing `test_indexing_service.py` drift (note: that test constructs `IndexingService` positionally + with `error_store`; our new optional kw-arg does not change its failure mode).

- [ ] **Step 4: Commit**

```bash
git add src/services/indexing_service.py src/api/dependencies.py
git commit -m "[Backend] Invalidate region index cache after re-indexing a bag"
```

---

# Slice 5 — Refine + heatmap

Goal: optional exact recompute-refine of the top-N, and a heatmap endpoint returning the recomputed cosine grid for a target frame.

## Task 5.1: Exact recompute-refine in `RegionSearcher`

**Files:**
- Modify: `src/region/region_search.py`
- Test: `tests/test_region_search.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_region_search.py`. Refine recomputes patches from the thumbnail; with `FakeDenseEmbedder`, `embed_dense` returns a deterministic grid independent of pixels, so refine must (a) not crash, (b) keep results sorted. Build a bag whose on-disk thumbnail exists:

```python
from PIL import Image


def test_refine_recomputes_without_crashing(tmp_path, monkeypatch):
    dim = 4
    bag = tmp_path / "bagR"
    bag.mkdir()
    artifact = bag / ".bag_chat"
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    Image.new("RGB", (60, 40)).save(artifact / "thumbnails/cam_a/frame_10.jpg")
    f0 = np.stack([_unit(dim, 0)])
    frames = [{"timestamp_ns": 10, "topic": "/cam/a", "file_path": "thumbnails/cam_a/frame_10.jpg"}]
    bag_path = _make_region_bag(bag, frames, [f0], dim)

    import dataclasses
    base = get_app_config()
    # Fresh config with refine on — do NOT mutate the lru-cached AppConfig in place.
    cfg = dataclasses.replace(
        base, region_search=dataclasses.replace(base.region_search, refine_enabled=True)
    )
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    results = searcher.search_by_q(_unit(dim, 0), [bag_path], top_k=5)
    assert len(results) == 1
    assert results[0]["timestamp_ns"] == 10
```

Note: `get_app_config()` is `lru_cache`d and returns a shared frozen `AppConfig`; mutating it in place would leak `refine_enabled=True` into every other test. `dataclasses.replace` builds an independent copy. In production the flag comes from `settings.yaml`.

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py::test_refine_recomputes_without_crashing -v`
Expected: FAIL only if refine logic is wrong; initially it PASSES the assertions because refine is a no-op. To make it a real failing-first test, first add an assertion that refine actually ran. Instead, drive refine via a spy: assert `embed_dense` is called during refine. Replace the test body's tail with:

```python
    calls = {"n": 0}
    orig = searcher._embedder.embed_dense
    def _spy(imgs):
        calls["n"] += 1
        return orig(imgs)
    searcher._embedder.embed_dense = _spy
    results = searcher.search_by_q(_unit(dim, 0), [bag_path], top_k=5)
    assert calls["n"] >= 1  # refine recomputed the top frame
    assert results[0]["timestamp_ns"] == 10
```

Expected first run: FAIL — `embed_dense` not called (refine not implemented).

- [ ] **Step 3: Implement refine**

In `src/region/region_search.py`, add a refine step at the end of `search_by_q`, before the final dedup/slice. Refactor the tail:

```python
        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        if self._cfg.refine_enabled and all_results:
            all_results = self._refine(q, all_results[: self._cfg.refine_top_n]) + all_results[self._cfg.refine_top_n :]
            all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return self._apply_temporal_dedup(all_results)[:top_k]
```

Add the method:

```python
    def _refine(self, q: np.ndarray, results: list[dict]) -> list[dict]:
        """Recompute exact MaxSim for each result from its thumbnail (compute, not storage)."""
        from PIL import Image
        q = q.reshape(-1)
        for res in results:
            try:
                with Image.open(res["file_path"]) as im:
                    grid = self._embedder.embed_dense([im.convert("RGB")])[0]
            except (FileNotFoundError, OSError):
                continue
            sims = grid.reshape(-1, grid.shape[-1]) @ q
            res["similarity_score"] = float(np.max(sims))
        return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/region/region_search.py tests/test_region_search.py
git commit -m "[Backend] Region search optional exact recompute-refine (top-N)"
```

## Task 5.2: Heatmap endpoint

**Files:**
- Modify: `src/region/region_search.py` (add `heatmap`)
- Modify: `src/services/region_search_service.py` (add `heatmap`)
- Modify: `src/api/search_routes.py` (add route)
- Test: `tests/test_region_search.py`, `tests/test_region_api.py`

- [ ] **Step 1: Write the failing searcher test**

Add to `tests/test_region_search.py`:

```python
def test_heatmap_returns_grid_and_dims(tmp_path):
    dim = 4
    bag = tmp_path / "bagH"
    artifact = bag / ".bag_chat"
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    Image.new("RGB", (60, 40)).save(artifact / "thumbnails/cam_a/frame_10.jpg")
    target = str(artifact / "thumbnails/cam_a/frame_10.jpg")

    cfg = get_app_config()
    searcher = RegionSearcher(config=cfg, embedder=FakeDenseEmbedder(dim=dim))
    out = searcher.heatmap(_unit(dim, 0), target)
    assert out["height"] == 2 and out["width"] == 3  # FakeDenseEmbedder grid is (2,3,dim)
    assert len(out["grid"]) == 2 and len(out["grid"][0]) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py::test_heatmap_returns_grid_and_dims -v`
Expected: FAIL — `RegionSearcher has no attribute 'heatmap'`.

- [ ] **Step 3: Implement `heatmap` on the searcher**

Add to `RegionSearcher`:

```python
    def heatmap(self, q: np.ndarray, target_file_path: str) -> dict:
        """Recompute the target frame's value-attention patches and return the
        (H_p, W_p) cosine grid vs q. Independent of any index."""
        from PIL import Image
        q = q.reshape(-1)
        with Image.open(target_file_path) as im:
            grid = self._embedder.embed_dense([im.convert("RGB")])[0]  # (H_p, W_p, dim)
        h_p, w_p, _ = grid.shape
        sims = (grid.reshape(-1, grid.shape[-1]) @ q).reshape(h_p, w_p)
        return {"height": int(h_p), "width": int(w_p), "grid": sims.astype(float).tolist()}

    def heatmap_for_text(self, text: str, target_file_path: str) -> dict:
        return self.heatmap(build_query_from_text(text, self._embedder, self._cfg.text_templates), target_file_path)

    def heatmap_for_points(self, image, points, target_file_path: str) -> dict:
        return self.heatmap(build_query_from_points(image, points, self._embedder), target_file_path)
```

- [ ] **Step 4: Run searcher test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_region_search.py::test_heatmap_returns_grid_and_dims -v`
Expected: PASS.

- [ ] **Step 5: Add service + route + API test**

In `src/services/region_search_service.py`, add:

```python
    def heatmap_by_text(self, text: str, target_file_path: str) -> dict:
        if not text.strip():
            raise ValueError("Text query must not be empty.")
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        return self._searcher.heatmap_for_text(text=text, target_file_path=target_file_path)
```

In `src/api/search_routes.py`, add a request model + route:

```python
class RegionHeatmapTextRequest(BaseModel):
    text: str = Field(..., min_length=1)
    target_file_path: str = Field(..., min_length=1)


@router.post("/search/region/heatmap")
async def region_heatmap(
    req: RegionHeatmapTextRequest,
    service: Annotated[RegionSearchService, Depends(get_region_search_service)],
):
    try:
        grid = service.heatmap_by_text(text=req.text, target_file_path=req.target_file_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid image file") from exc
    return grid
```

Add to `tests/test_region_api.py` (`_SvcStub` gains a method):

```python
    def heatmap_by_text(self, text, target_file_path):
        return {"height": 2, "width": 3, "grid": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]}


def test_region_heatmap_endpoint(bypass_auth):
    client = _client_with_stub(bypass_auth, _SvcStub())
    resp = client.post("/api/search/region/heatmap", json={
        "text": "car", "target_file_path": "/b/.bag_chat/thumbnails/cam_a/frame_1.jpg",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["height"] == 2 and body["width"] == 3
```

(Add the `heatmap_by_text` method to the existing `_SvcStub` class definition.)

- [ ] **Step 6: Run the full suite**

Run: `PYTHONPATH="" uv run pytest tests/ -v`
Expected: PASS except the pre-existing `test_indexing_service.py` drift.

- [ ] **Step 7: Commit**

```bash
git add src/region/region_search.py src/services/region_search_service.py src/api/search_routes.py tests/test_region_search.py tests/test_region_api.py
git commit -m "[API] Region heatmap endpoint (recomputed cosine grid, by text)"
```

---

# Slice 6 (frontend) — OUT OF SCOPE

The Support-image point-placement canvas, ranked result grid, and toggleable heatmap overlay are a separate effort. This plan stops at the API (spec §12, §14).

---

# Final Verification

- [ ] Run the full suite once more: `PYTHONPATH="" uv run pytest tests/ -v`. Expected: all pass except the documented pre-existing `test_indexing_service.py` drift.
- [ ] On a GPU/TIPSv2 box, run the model-gated tests: `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run pytest tests/test_embedding.py -k tipsv2 -v`. Expected: dense capability, grid geometry/norm, fused-CLS-matches-standalone, and hook-removal all pass.
- [ ] Manual end-to-end on the example bag (840×542 frames): re-index it (region enabled), confirm `.bag_chat/region/patches.faiss` + `patch_frames.npy` exist and the region artifact is ~130 MB; confirm `metadata.json` has a populated `region_index` stamp; run a `by-text` query ("traffic light") and a `by-frame` query, confirm ranked frames return.
- [ ] **Recall acceptance (spec §3.2):** on the example bag, compare IVF-PQ top-100 frames vs an `IndexFlatIP` brute-force baseline; recall@100 ≥ 0.95. If below, raise `region_search.ivf.nprobe` or set `region_search.refine.enabled: true` — do not redesign.

---

# Deliberate scope reductions vs spec (call these out at review)

- **Dense-only "lazy upgrade" pass (spec §4) is folded into full re-index.** The plan's fused loop builds CLS + Region together; an existing CLS-only bag gains a Region index by a normal re-index (which already re-runs `parser.extract_frames()` first, so the dense-only CLS-skipping optimization saves little). No separate "upgrade region only" trigger exists in the current indexing API. If a CLS-preserving upgrade becomes worthwhile, add a `build_region_only()` method on `Indexer` that iterates thumbnails with `embed_dense` and feeds only the region indexer — straightforward, but not built here.
- **Heatmap endpoint ships text-only (spec §9.1 lists text/points/image).** `RegionSearcher.heatmap_for_points` exists (Task 5.2) but the `/api/search/region/heatmap` route only wires the text variant; points/image heatmap needs the Support image plumbed through (multipart or support_file_path) and is deferred with the frontend (Slice 6), which is the only consumer of overlay heatmaps.
- **`by-image` region endpoint has a route but no dedicated API test** (by-text and by-frame are tested). The route mirrors `by-frame`; add a multipart test when the frontend exercises it.

# Open items deferred to execution / testing (from spec)

- **[FLAG] CLS stamp blind to resolution** (spec §14): the CLS embedder stamp `{name, dim}` does not record `encode_long_side`, so a resolution-only re-index isn't auto-detected on the CLS side. Decision for execution: document that tuning `encode_long_side` requires a manual full re-index (both CLS and region), OR extend `write_embedder_stamp`/`is_stamp_compatible` to include it. Not blocking Region search; revisit if it bites.
- **[OPEN] Encode resolution tuning** (spec §14): 896 is the start; raising it is a re-index of both CLS and region. Validate small-entity recall during the manual E2E.
- **[FLAG] templates unverified for patches** (spec §5): the ~10-template default is validated for CLS classification, not text→value-attention-patch. Sanity-check `by-text` recall against `by-frame` on a known entity; adjust `text_templates` in config if poor.
