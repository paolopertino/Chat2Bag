# Model-Invariant Embedding + TIPSv2 + Multi-Camera Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the embedding backend swappable behind a `FrameEmbedder` abstraction, drop in Google TIPSv2-l14 as a second Global-search backend, and expand ingestion from one camera topic to many — without re-extracting being required on a model swap.

**Architecture:** A new `src/embedding/` package defines a framework-neutral `FrameEmbedder` ABC (PIL in → L2-normalized `np.ndarray` out) plus a string-keyed registry and `create_embedder(config)`. `Indexer` and `GlobalSearcher` lose all `transformers`/`torch` code and call the injected embedder. Frame storage becomes model-agnostic (aspect-preserving JPGs at a `long_side` budget); each index stamps `{name, dim}` into `metadata.json`; the searcher skips bags whose stamp ≠ the active embedder. Ingestion reads a list of camera topics, keeping a **per-camera Frame** as the searched unit (no multi-view fusion).

**Tech Stack:** Python 3.10+, FastAPI, HuggingFace Transformers (SigLIP-2, TIPSv2 via `trust_remote_code`), PyTorch, LanceDB, Pillow, OpenCV, rosbags. Tests: pytest + dependency-injected fakes.

**Source spec:** `docs/superpowers/specs/2026-05-29-model-invariant-embedding-multicam.md` (and ADRs 0001–0003, `CONTEXT.md`).

---

## Pre-flight (read before Task 0)

- **Run tests with empty PYTHONPATH:** `PYTHONPATH="" uv run pytest tests/<file> -v`. The host ROS2 env leaks `/opt/ros/*` onto `sys.path` and breaks pytest plugin discovery.
- **Do NOT assume a green suite.** This is the `frontend-refactor-recovered` branch and two files are already broken independent of this work:
  - `tests/test_indexing_service.py` passes `error_store=` to `IndexingService`, which the current `__init__` does not accept — it fails today. Leave it alone.
  - `tests/test_api.py` is a live-server `requests` script, not a real pytest test — it errors under collection. Leave it alone.
  - **Therefore: always run the *specific* test file/node you are working on, never the whole suite as a pass/fail gate.**
- **`get_settings()` and `get_app_config()` are both `@lru_cache(maxsize=1)`.** Any test that changes config MUST monkeypatch `src.core.app_config.get_settings` AND call `src.core.app_config.get_app_config.cache_clear()` before and after.
- **No Prettier / no Python formatter** is configured. Match the surrounding style (full type annotations, snake_case, frozen dataclasses).
- **Commit style:** tag-prefixed, e.g. `[Config] ...`, `[Backend] ...`, `[API] ...` (matches existing history).
- **Branch:** work on `frontend-refactor-recovered` (current) unless an isolated worktree was created by `superpowers:using-git-worktrees` at execution time.

---

## File Structure

**New files:**
- `src/embedding/__init__.py` — exports `FrameEmbedder`, `create_embedder`, `register_embedder`; registers built-in backends on import.
- `src/embedding/base.py` — `FrameEmbedder` ABC.
- `src/embedding/registry.py` — `_REGISTRY`, `register_embedder` decorator, `create_embedder(config)`.
- `src/embedding/siglip2.py` — `Siglip2Embedder` (relocates current SigLIP code).
- `src/embedding/tipsv2.py` — `TipsV2Embedder` (new, Phase 4).
- `src/core/index_stamp.py` — pure `read_embedder_stamp` / `write_embedder_stamp` / `is_stamp_compatible`.
- `tests/fakes.py` — `FakeEmbedder` shared test double.
- `tests/test_embedding.py` — embedder ABC + registry tests.
- `tests/test_index_stamp.py` — stamp helper tests.
- `tests/test_app_config.py` — config-parsing tests.
- `tests/test_indexer_embedding.py` — Indexer-with-fake integration test.
- `tests/test_global_search_compat.py` — searcher stamp-skip test.
- `tests/test_bag_parser_helpers.py` — `resize_long_side` + `camera_slug` tests.

**Modified files:**
- `config/settings.yaml` — new `embedding:` block; `ingestion.long_side` + `camera_topics`; drop `models.embedding_model`, `ingestion.max_image_size`, `ingestion.camera_topic`.
- `src/core/app_config.py` — `EmbeddingConfig` dataclass; `IngestionConfig` + `ModelsConfig` + `AppConfig` changes; parsing.
- `src/core/schema_versions.py` — bump to 3.
- `src/ingestion/indexer.py` — embedder injection, per-frame topic, stamp on success; remove transformers/torch.
- `src/ingestion/bag_parser.py` — `long_side` resize, multi-camera, metadata v3, helpers.
- `src/retriever/global_search.py` — embedder injection, `_compatible_bags` stamp check; remove transformers/torch.
- `src/services/component_factory.py` — hold one `embedder` instead of model+processor.
- `app.py` — lifespan creates the embedder via `create_embedder`; remove `AutoModel`/`AutoProcessor` load.

---

# PHASE 0 — Config & schema scaffolding

Goal: introduce the new config shape and schema version with no behavior change yet. After this phase the app still runs on SigLIP (nothing reads the new structure until Phase 1+).

### Task 0.1: Bump metadata schema version to 3

**Files:**
- Modify: `src/core/schema_versions.py`

- [ ] **Step 1: Edit the constant and history**

Replace the version history block and constant in `src/core/schema_versions.py`:

```python
"""
Schema version constants for artifact files produced by the ingestion pipeline.

Bump METADATA_SCHEMA_VERSION whenever the format of metadata.json changes so that
readers can detect stale artifacts and warn the user to re-index.

Version history:
  1 — Initial format. file_path stored as absolute string.
  2 — file_path stored relative to the artifact directory (portability fix).
  3 — Flat per-camera frames (per-frame `topic`, top-level `cameras[]`), embedder
      stamp slot (`{name, dim}` | null), aspect-preserving thumbnails under
      per-camera subdirectories.
"""

METADATA_SCHEMA_VERSION = 3
```

- [ ] **Step 2: Sanity-import**

Run: `PYTHONPATH="" uv run python -c "from src.core.schema_versions import METADATA_SCHEMA_VERSION; print(METADATA_SCHEMA_VERSION)"`
Expected: `3`

- [ ] **Step 3: Commit**

```bash
git add src/core/schema_versions.py
git commit -m "[Config] Bump METADATA_SCHEMA_VERSION to 3 (per-camera flat frames + embedder stamp)"
```

---

### Task 0.2: New config shape — `embedding:` block, `ingestion.long_side`, `ingestion.camera_topics`

**Files:**
- Test: `tests/test_app_config.py`
- Modify: `src/core/app_config.py`
- Modify: `config/settings.yaml`

- [ ] **Step 1: Write the failing test**

Create `tests/test_app_config.py`:

```python
import src.core.app_config as app_config_mod


_FAKE_SETTINGS = {
    "ingestion": {
        "camera_topics": ["/cam/front/compressed", "/cam/rear/compressed"],
        "sampling_fps": 1.0,
        "long_side": 840,
        "batch_size": 8,
    },
    "storage": {"artifact_dir": ".bag_chat", "storage_path": None},
    "embedding": {"backend": "siglip2", "model": "google/siglip2-base-patch16-naflex"},
    "models": {
        "orchestration_llm": "gemma-2-9b",
        "video_vlm": "qwen3-vl:2b",
        "model_storage": "models",
    },
    "search": {"temporal_dedup_window_sec": 20.0},
    "api": {"scan_timeout_sec": 30.0},
    "extraction": {"service_url": None},
}


def test_embedding_block_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.embedding.backend == "siglip2"
        assert cfg.embedding.model == "google/siglip2-base-patch16-naflex"
    finally:
        app_config_mod.get_app_config.cache_clear()


def test_ingestion_long_side_and_camera_topics_parsed(monkeypatch):
    monkeypatch.setattr(app_config_mod, "get_settings", lambda: _FAKE_SETTINGS)
    app_config_mod.get_app_config.cache_clear()
    try:
        cfg = app_config_mod.get_app_config()
        assert cfg.ingestion.long_side == 840
        assert cfg.ingestion.camera_topics == (
            "/cam/front/compressed",
            "/cam/rear/compressed",
        )
        assert not hasattr(cfg.ingestion, "max_image_size")
        assert not hasattr(cfg.models, "embedding_model")
    finally:
        app_config_mod.get_app_config.cache_clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py -v`
Expected: FAIL — `AttributeError: 'AppConfig' object has no attribute 'embedding'` (and `IngestionConfig` has no `long_side`/`camera_topics`).

- [ ] **Step 3: Edit `src/core/app_config.py`**

Replace `IngestionConfig`, `ModelsConfig`, add `EmbeddingConfig`, extend `AppConfig`, and rewrite the relevant part of `get_app_config()`:

```python
@dataclass(frozen=True)
class IngestionConfig:
    camera_topics: tuple[str, ...]
    sampling_fps: float
    long_side: int
    batch_size: int


@dataclass(frozen=True)
class ModelsConfig:
    orchestration_llm: str
    video_vlm: str
    model_storage: str


@dataclass(frozen=True)
class EmbeddingConfig:
    backend: str
    model: str
```

Add `embedding: EmbeddingConfig` to `AppConfig`:

```python
@dataclass(frozen=True)
class AppConfig:
    ingestion: IngestionConfig
    storage: StorageConfig
    models: ModelsConfig
    embedding: EmbeddingConfig
    search: SearchConfig
    api: ApiConfig
    extraction: ExtractionConfig
```

In `get_app_config()`, replace the `ingestion=`, `models=` blocks and add `embedding=`:

```python
        ingestion=IngestionConfig(
            camera_topics=tuple(str(t) for t in settings["ingestion"]["camera_topics"]),
            sampling_fps=float(settings["ingestion"]["sampling_fps"]),
            long_side=int(settings["ingestion"]["long_side"]),
            batch_size=int(settings["ingestion"]["batch_size"]),
        ),
        storage=StorageConfig(
            artifact_dir=str(settings["storage"]["artifact_dir"]),
            storage_path=str(settings["storage"]["storage_path"]) if settings["storage"]["storage_path"] is not None else None
        ),
        models=ModelsConfig(
            orchestration_llm=str(settings["models"]["orchestration_llm"]),
            video_vlm=str(settings["models"]["video_vlm"]),
            model_storage=str(settings["models"]["model_storage"]),
        ),
        embedding=EmbeddingConfig(
            backend=str(settings["embedding"]["backend"]),
            model=str(settings["embedding"]["model"]),
        ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_app_config.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Update `config/settings.yaml`**

Edit the `ingestion:`, `models:` blocks and add `embedding:`:

```yaml
ingestion:
  camera_topics:                                                                             # List of ROS2 camera topics to extract frames from (per-camera Frames; no multi-view fusion).
    - "/lucid_vision/lucid_cam_front_center/image_rect/compressed"
  sampling_fps: 1.0                                                                           # Subsampling rate per camera: 1.0 means 1 frame per second per topic.
  long_side: 840                                                                              # Aspect-preserving long-edge budget for stored thumbnails (configurable; tune during testing). 840 = 60*14.
  batch_size: 8                                                                               # Hint for embedder batching (the embedder owns real batching).

embedding:
  backend: "siglip2"                                                                          # Registry key: siglip2 | tipsv2
  model: "google/siglip2-base-patch16-naflex"                                                 # HF id or local checkpoint path for the active backend.

models:
  orchestration_llm: "gemma-2-9b"
  video_vlm: "qwen3-vl:2b" # "qwen3-vl:4b"                                                    # Ollama video-capable model for video understanding.
  model_storage: "models"                                                                     # Directory where downloaded model checkpoints are cached.
```

(Remove the old `ingestion.camera_topic`, `ingestion.max_image_size`, and `models.embedding_model` lines. Leave `storage:`, `search:`, `api:`, `extraction:` untouched.)

- [ ] **Step 6: Verify the real config loads**

Run: `PYTHONPATH="" uv run python -c "from src.core.app_config import get_app_config; c=get_app_config(); print(c.embedding, c.ingestion.long_side, c.ingestion.camera_topics)"`
Expected: prints the `EmbeddingConfig(backend='siglip2', ...)`, `840`, and a 1-tuple with the front-center topic. No exception.

- [ ] **Step 7: Commit**

```bash
git add src/core/app_config.py config/settings.yaml tests/test_app_config.py
git commit -m "[Config] Add structured embedding block; ingestion.long_side and camera_topics"
```

---

# PHASE 1 — Embedder package (SigLIP behind the ABC)

Goal: the SigLIP model runs through the new abstraction, behaving identically. Nothing else changes yet.

### Task 1.1: `FrameEmbedder` ABC + registry + `create_embedder`

**Files:**
- Create: `src/embedding/base.py`
- Create: `src/embedding/registry.py`
- Create: `src/embedding/__init__.py`
- Create: `tests/fakes.py`
- Test: `tests/test_embedding.py`

- [ ] **Step 1: Write `src/embedding/base.py`**

```python
from abc import ABC, abstractmethod

import numpy as np
from PIL import Image


class FrameEmbedder(ABC):
    """Framework-neutral embedding contract.

    Inputs are PIL images / raw query strings. Outputs are float32 numpy arrays
    of shape (N, embedding_dim), L2-normalized along the last axis — callers feed
    them straight into LanceDB cosine search. Subclasses own all model-specific
    preprocessing, batching, and device placement.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Stable identity stamped into metadata.json, e.g. 'siglip2:google/...'."""

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        """Vector dimension this embedder emits."""

    @property
    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Subset of {'global', 'text', 'dense'}."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, L2-normalized."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. Raw query text in; no caller-side templating."""

    def embed_dense(self, images: list[Image.Image]) -> np.ndarray:
        """Documented seam for Region search; unimplemented until Region search is specced."""
        raise NotImplementedError(f"{self.name} does not implement dense/region embeddings")

    @abstractmethod
    def to(self, device: str) -> "FrameEmbedder":
        """Move underlying model(s) to a compute device. Returns self for chaining."""

    @abstractmethod
    def offload(self) -> None:
        """Move to CPU and release VRAM."""
```

- [ ] **Step 2: Write `src/embedding/registry.py`**

```python
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
```

- [ ] **Step 3: Write `src/embedding/__init__.py`**

Note: only `siglip2` is imported here in Phase 1. The `tipsv2` import line is added in Task 4.1.

```python
from src.embedding.base import FrameEmbedder
from src.embedding.registry import create_embedder, register_embedder

# Import backend modules so their @register_embedder decorators run on package import.
from src.embedding import siglip2 as _siglip2  # noqa: F401

__all__ = ["FrameEmbedder", "create_embedder", "register_embedder"]
```

- [ ] **Step 4: Write `tests/fakes.py`**

```python
import numpy as np
from PIL import Image

from src.embedding import FrameEmbedder


class FakeEmbedder(FrameEmbedder):
    """Deterministic test double: emits unit basis vectors of the configured dim."""

    def __init__(self, dim: int = 4, name: str = "fake:test"):
        self._dim = dim
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text"})

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        rows = [np.eye(self._dim, dtype=np.float32)[i % self._dim] for i in range(len(images))]
        return np.stack(rows, axis=0) if rows else np.zeros((0, self._dim), dtype=np.float32)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        rows = [np.eye(self._dim, dtype=np.float32)[0] for _ in queries]
        return np.stack(rows, axis=0) if rows else np.zeros((0, self._dim), dtype=np.float32)

    def to(self, device: str) -> "FakeEmbedder":
        return self

    def offload(self) -> None:
        return None
```

- [ ] **Step 5: Write the failing test `tests/test_embedding.py`**

Note: registering a backend inside the test requires importing the package (which imports `siglip2.py` — created in Task 1.3). To keep Task 1.1 runnable on its own, this test uses a locally-registered fake and does NOT import siglip2 symbols.

```python
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
```

- [ ] **Step 6: Make `__init__.py` importable without siglip2 yet**

Task 1.3 creates `siglip2.py`. To run THIS task's test before 1.3, temporarily comment the siglip2 import. **Cleaner: do Tasks 1.1 and 1.3 together in one sitting** (they're tightly coupled) and run the test after 1.3 exists. If executing strictly task-by-task, create an empty `src/embedding/siglip2.py` placeholder containing only `from src.embedding.registry import register_embedder` so the import resolves, then flesh it out in Task 1.3.

- [ ] **Step 7: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_embedding.py -v`
Expected: PASS (4 passed).

- [ ] **Step 8: Commit**

```bash
git add src/embedding/__init__.py src/embedding/base.py src/embedding/registry.py tests/fakes.py tests/test_embedding.py
git commit -m "[Backend] Add FrameEmbedder ABC, registry, and create_embedder"
```

---

### Task 1.3: `Siglip2Embedder` — relocate current SigLIP behavior behind the ABC

**Files:**
- Create/replace: `src/embedding/siglip2.py`
- Test: extend `tests/test_embedding.py`

Reference for exact behavior to preserve: `src/ingestion/indexer.py:108-117` (image path) and `src/retriever/global_search.py:134-164` (image + text path). Preserve `.pooler_output` access, `max_length=64` text padding, and L2 normalization exactly.

- [ ] **Step 1: Write `src/embedding/siglip2.py`**

```python
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
```

- [ ] **Step 2: Restore the real siglip2 import in `__init__.py`**

If you created a placeholder in Task 1.1 Step 6, the `from src.embedding import siglip2 as _siglip2` line in `__init__.py` is already correct — no change needed now that the file is real.

- [ ] **Step 3: Add a guarded real-model smoke test to `tests/test_embedding.py`**

This test downloads/loads the real SigLIP model, so it is opt-in (skipped unless `RUN_MODEL_TESTS=1`).

```python
import os


@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires SigLIP weights")
def test_siglip2_embedder_real_forward():
    from src.core.app_config import get_app_config
    from src.embedding import create_embedder

    emb = create_embedder(get_app_config())
    assert emb.name.startswith("siglip2:")
    img_vecs = emb.embed_images([Image.new("RGB", (64, 48))])
    txt_vecs = emb.embed_text(["a pedestrian"])
    assert img_vecs.shape[1] == emb.embedding_dim
    assert txt_vecs.shape[1] == emb.embedding_dim
    assert np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-4)
```

- [ ] **Step 4: Run the non-model tests**

Run: `PYTHONPATH="" uv run pytest tests/test_embedding.py -v`
Expected: PASS (4 passed, 1 skipped).

- [ ] **Step 5 (optional but recommended): Run the real-model smoke test**

Run: `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run pytest tests/test_embedding.py::test_siglip2_embedder_real_forward -v`
Expected: PASS (downloads weights on first run). If you cannot run models locally, note it as a deferred manual check.

- [ ] **Step 6: Commit**

```bash
git add src/embedding/siglip2.py src/embedding/__init__.py tests/test_embedding.py
git commit -m "[Backend] Add Siglip2Embedder behind FrameEmbedder ABC"
```

---

# PHASE 2 — Wiring, stamp, and compatibility

Goal: `Indexer` and `GlobalSearcher` use the injected embedder; the index stamps `{name, dim}`; the searcher skips incompatible bags. After this phase the app runs end-to-end on the embedder abstraction.

### Task 2.1: Index stamp helpers

**Files:**
- Create: `src/core/index_stamp.py`
- Test: `tests/test_index_stamp.py`

- [ ] **Step 1: Write the failing test `tests/test_index_stamp.py`**

```python
import json
from pathlib import Path

from src.core.index_stamp import (
    is_stamp_compatible,
    read_embedder_stamp,
    write_embedder_stamp,
)


def _write_meta(path: Path, embedder) -> None:
    path.write_text(json.dumps({"schema_version": 3, "frames": [], "embedder": embedder}))


def test_read_returns_none_for_missing_file(tmp_path):
    assert read_embedder_stamp(tmp_path / "nope.json") is None


def test_read_returns_none_when_unstamped(tmp_path):
    meta = tmp_path / "metadata.json"
    _write_meta(meta, None)
    assert read_embedder_stamp(meta) is None


def test_write_then_read_roundtrip_preserves_frames(tmp_path):
    meta = tmp_path / "metadata.json"
    meta.write_text(json.dumps({"schema_version": 3, "frames": [{"timestamp_ns": 1}], "embedder": None}))
    write_embedder_stamp(meta, name="siglip2:foo", dim=768)
    stamp = read_embedder_stamp(meta)
    assert stamp == {"name": "siglip2:foo", "dim": 768}
    # frames untouched
    assert json.loads(meta.read_text())["frames"] == [{"timestamp_ns": 1}]


def test_compatible_only_on_name_and_dim_match():
    assert is_stamp_compatible({"name": "a", "dim": 4}, "a", 4) is True
    assert is_stamp_compatible({"name": "a", "dim": 4}, "b", 4) is False
    assert is_stamp_compatible({"name": "a", "dim": 4}, "a", 8) is False
    assert is_stamp_compatible(None, "a", 4) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_index_stamp.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.core.index_stamp'`.

- [ ] **Step 3: Write `src/core/index_stamp.py`**

```python
import json
from pathlib import Path


def read_embedder_stamp(metadata_path) -> dict | None:
    """Return the `embedder` stamp from a metadata.json, or None if absent/unreadable."""
    try:
        with Path(metadata_path).open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    stamp = meta.get("embedder")
    return stamp if isinstance(stamp, dict) else None


def write_embedder_stamp(metadata_path, name: str, dim: int) -> None:
    """Set metadata.json's `embedder` to {name, dim}, preserving all other fields."""
    path = Path(metadata_path)
    with path.open("r", encoding="utf-8") as handle:
        meta = json.load(handle)
    meta["embedder"] = {"name": name, "dim": int(dim)}
    with path.open("w", encoding="utf-8") as handle:
        json.dump(meta, handle, indent=4)


def is_stamp_compatible(stamp: dict | None, name: str, dim: int) -> bool:
    """True iff a bag's stamp matches the active embedder's name AND dimension."""
    if not stamp:
        return False
    return stamp.get("name") == name and int(stamp.get("dim", -1)) == int(dim)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_index_stamp.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/core/index_stamp.py tests/test_index_stamp.py
git commit -m "[Backend] Add index embedder-stamp read/write/compat helpers"
```

---

### Task 2.2: Refactor `Indexer` to use the injected embedder + write the stamp

**Files:**
- Modify: `src/ingestion/indexer.py`
- Test: `tests/test_indexer_embedding.py`

- [ ] **Step 1: Write the failing integration test `tests/test_indexer_embedding.py`**

```python
import json

import lancedb
from PIL import Image

from src.core.app_config import get_app_config
from src.ingestion.indexer import Indexer
from tests.fakes import FakeEmbedder


def _make_bag(tmp_path):
    cfg = get_app_config()  # default settings: storage_path null -> artifact under bag dir
    bag = tmp_path / "mybag"
    bag.mkdir()
    artifact = bag / cfg.storage.artifact_dir
    (artifact / "thumbnails" / "cam_a").mkdir(parents=True)
    rel = "thumbnails/cam_a/frame_1.jpg"
    Image.new("RGB", (16, 16)).save(artifact / rel)
    meta = {
        "schema_version": 3,
        "bag_name": "mybag",
        "cameras": ["/cam/a"],
        "embedder": None,
        "frames": [{"timestamp_ns": 1, "topic": "/cam/a", "file_path": rel}],
    }
    (artifact / "metadata.json").write_text(json.dumps(meta))
    return cfg, bag, artifact


def test_indexer_embeds_writes_per_frame_topic_and_stamps(tmp_path):
    cfg, bag, artifact = _make_bag(tmp_path)
    embedder = FakeEmbedder(dim=4, name="fake:test")

    Indexer(str(bag), config=cfg, embedder=embedder).build_index()

    # 1. Stamp written into metadata.json
    new_meta = json.loads((artifact / "metadata.json").read_text())
    assert new_meta["embedder"] == {"name": "fake:test", "dim": 4}

    # 2. LanceDB row carries the per-frame topic and a 4-d vector
    rows = lancedb.connect(str(artifact / "lancedb")).open_table("frames").to_list()
    assert len(rows) == 1
    assert rows[0]["topic"] == "/cam/a"
    assert rows[0]["timestamp_ns"] == 1
    assert len(rows[0]["vector"]) == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py -v`
Expected: FAIL — `Indexer.__init__` does not accept `embedder` (it currently takes `model`/`processor`/`device`).

- [ ] **Step 3: Rewrite `src/ingestion/indexer.py`**

```python
import argparse
import json
import logging

from pathlib import Path

import lancedb

from PIL import Image
from tqdm import tqdm

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import write_embedder_stamp
from src.core.schema_versions import METADATA_SCHEMA_VERSION
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder, create_embedder

logger = logging.getLogger(__name__)


class Indexer:
    def __init__(
        self,
        bag_path: str,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
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
        # The embedder is normally injected (shared singleton). Fall back to building
        # one from config for standalone/CLI use.
        self.embedder = embedder if embedder is not None else create_embedder(app_config)

    def build_index(self):
        """Embeds frames via the active embedder, writes LanceDB, and stamps metadata."""
        logger.info("Loading metadata from %s...", self.metadata_path)
        with self.metadata_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)

        schema_version = metadata.get("schema_version", 1)
        if schema_version < METADATA_SCHEMA_VERSION:
            logger.warning(
                "Metadata schema v%d is older than current v%d; re-extract + re-index required.",
                schema_version,
                METADATA_SCHEMA_VERSION,
            )

        frames = metadata.get("frames", [])
        if not frames:
            logger.warning("No frames found to index.")
            return

        db = lancedb.connect(str(self.db_path))
        table_name = "frames"
        data_to_insert = []

        logger.info("Generating embeddings for %s frames with %s...", len(frames), self.embedder.name)
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
                data_to_insert.append(
                    {
                        "timestamp_ns": meta["timestamp_ns"],
                        "file_path": meta["_abs_path"],
                        "topic": meta["topic"],
                        "vector": emb.tolist(),
                    }
                )

        if not data_to_insert:
            logger.warning("No valid frames were embedded; skipping LanceDB write.")
            return

        logger.info("Writing embeddings to LanceDB...")
        if table_name in db.list_tables():
            logger.info("Existing index found; overwriting table.")
        db.create_table(table_name, data=data_to_insert, mode="overwrite")

        # Stamp the index with the embedder identity so the searcher can detect mismatches.
        write_embedder_stamp(self.metadata_path, name=self.embedder.name, dim=self.embedder.embedding_dim)

        logger.info(
            "Index built! %d records, stamped %s (dim=%d).",
            len(data_to_insert),
            self.embedder.name,
            self.embedder.embedding_dim,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index frames from a bag into LanceDB.")
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    Indexer(args.bag_path).build_index()
```

Note: `meta["topic"]` is now per-frame (v3). The standalone `__main__` path builds its own embedder via `create_embedder`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_indexer_embedding.py -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/indexer.py tests/test_indexer_embedding.py
git commit -m "[Backend] Indexer uses injected embedder, writes per-frame topic and stamp"
```

---

### Task 2.3: Refactor `GlobalSearcher` to use the embedder + skip incompatible bags

**Files:**
- Modify: `src/retriever/global_search.py`
- Test: `tests/test_global_search_compat.py`

- [ ] **Step 1: Write the failing test `tests/test_global_search_compat.py`**

```python
import json
from pathlib import Path

from src.retriever.global_search import GlobalSearcher
from tests.fakes import FakeEmbedder


def _bag_with_stamp(tmp_path, name, stamp):
    bag = tmp_path / name
    artifact = bag / ".bag_chat"
    artifact.mkdir(parents=True)
    (artifact / "metadata.json").write_text(
        json.dumps({"schema_version": 3, "frames": [], "embedder": stamp})
    )
    return str(bag)


def test_compatible_bags_filters_by_stamp(tmp_path, monkeypatch):
    # Default config uses storage_path=null -> artifact at <bag>/.bag_chat
    searcher = GlobalSearcher.__new__(GlobalSearcher)
    searcher._embedder = FakeEmbedder(dim=4, name="fake:test")

    match = _bag_with_stamp(tmp_path, "match", {"name": "fake:test", "dim": 4})
    wrong_name = _bag_with_stamp(tmp_path, "wrong_name", {"name": "other", "dim": 4})
    wrong_dim = _bag_with_stamp(tmp_path, "wrong_dim", {"name": "fake:test", "dim": 8})
    unstamped = _bag_with_stamp(tmp_path, "unstamped", None)

    keep = searcher._compatible_bags([match, wrong_name, wrong_dim, unstamped])

    assert keep == [match]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_global_search_compat.py -v`
Expected: FAIL — `GlobalSearcher` has no attribute/method `_compatible_bags`.

- [ ] **Step 3: Rewrite `src/retriever/global_search.py`**

```python
import io
import logging

from pathlib import Path
from typing import List

import lancedb

from PIL import Image

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import is_stamp_compatible, read_embedder_stamp
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder, create_embedder

logger = logging.getLogger(__name__)


class GlobalSearcher:
    def __init__(
        self,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
    ):
        app_config = config or get_app_config()

        self.temporal_dedup_window_ns = int(
            max(0.0, app_config.search.temporal_dedup_window_sec) * 1_000_000_000
        )
        self._embedder = embedder if embedder is not None else create_embedder(app_config)
        self._db_cache: dict[str, lancedb.DBConnection] = {}

    def _get_db(self, db_path: str) -> lancedb.DBConnection:
        if db_path not in self._db_cache:
            self._db_cache[db_path] = lancedb.connect(db_path)
        return self._db_cache[db_path]

    def invalidate_cache(self, db_path: str) -> None:
        """Remove a cached DB connection, e.g. after re-indexing a bag."""
        self._db_cache.pop(db_path, None)

    @staticmethod
    def _sequence_key(result: dict) -> tuple[str, str]:
        return (str(result.get("bag_path", "")), str(result.get("topic", "")))

    def _compatible_bags(self, bag_paths: List[str]) -> list[str]:
        """Keep only bags whose index stamp matches the active embedder."""
        keep: list[str] = []
        for bag_path in bag_paths:
            meta_path = resolve_artifact_path(bag_path=Path(bag_path)) / "metadata.json"
            stamp = read_embedder_stamp(meta_path)
            if is_stamp_compatible(stamp, self._embedder.name, self._embedder.embedding_dim):
                keep.append(bag_path)
            else:
                logger.warning(
                    "Skipping %s: indexed with %s, active embedder is %s (dim=%d) — re-index to include it.",
                    Path(bag_path).name,
                    stamp,
                    self._embedder.name,
                    self._embedder.embedding_dim,
                )
        return keep

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
                selected_ts = int(selected.get("timestamp_ns", 0))
                if abs(candidate_ts - selected_ts) <= self.temporal_dedup_window_ns // 2:
                    is_redundant = True
                    break

            if not is_redundant:
                kept.append(candidate)

        suppressed = len(ranked_results) - len(kept)
        if suppressed > 0:
            logger.info(
                "Temporal de-dup suppressed %d/%d nearby frames (window=%dns)",
                suppressed,
                len(ranked_results),
                self.temporal_dedup_window_ns,
            )
        return kept

    def _search_vector(
        self,
        query_vector: list[float],
        bag_paths: List[str],
        top_k: int,
        exclude_file_path: str | None = None,
    ) -> list[dict]:
        """Searches a query vector across one or more compatible bag indices."""
        exclude_path = None
        if exclude_file_path:
            exclude_path = str(Path(exclude_file_path).expanduser().resolve())

        all_results = []
        for bag_path in self._compatible_bags(bag_paths):
            db_path = resolve_artifact_path(bag_path=Path(bag_path)) / "lancedb"
            if not db_path.exists():
                logger.warning("Skipping %s: no LanceDB index found.", Path(bag_path).name)
                continue

            db = self._get_db(str(db_path))
            table = db.open_table("frames")

            fetch_limit = max(top_k * 3, top_k + 10)
            results = table.search(query_vector).metric("cosine").limit(fetch_limit).to_list()
            for res in results:
                if exclude_path and str(Path(res["file_path"]).resolve()) == exclude_path:
                    continue
                res["bag_path"] = str(Path(bag_path).resolve())
                res["source_bag"] = Path(bag_path).name
                res["similarity_score"] = 1.0 - res["_distance"]
                res.pop("_distance", None)
                res.pop("vector", None)
                all_results.append(res)

        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        deduped_results = self._apply_temporal_dedup(all_results)
        return deduped_results[:top_k]

    def search(self, query: str, bag_paths: List[str], top_k: int = 5):
        logger.info("Embedding query: '%s'", query)
        query_vector = self._embedder.embed_text([query])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k)

    def search_by_image_bytes(self, image_bytes: bytes, bag_paths: List[str], top_k: int = 5):
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k)

    def search_similar_by_file_path(self, file_path: str, bag_paths: List[str], top_k: int = 5):
        image_path = Path(file_path).expanduser().resolve()
        image = Image.open(image_path).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(
            query_vector=query_vector,
            bag_paths=bag_paths,
            top_k=top_k,
            exclude_file_path=str(image_path),
        )
```

- [ ] **Step 4: Run the new test AND the existing dedup test (which must still pass)**

Run: `PYTHONPATH="" uv run pytest tests/test_global_search_compat.py tests/test_temporal_dedup.py -v`
Expected: PASS — new compat test passes; all 3 temporal-dedup tests still pass (they construct the searcher via `__new__` and only set `temporal_dedup_window_ns`, so the embedder change doesn't affect them).

- [ ] **Step 5: Commit**

```bash
git add src/retriever/global_search.py tests/test_global_search_compat.py
git commit -m "[Backend] GlobalSearcher uses injected embedder; skips stamp-mismatched bags"
```

---

### Task 2.4: Wire the embedder through the factory and app lifespan

**Files:**
- Modify: `src/services/component_factory.py`
- Modify: `app.py`
- Test: `tests/test_api_contracts.py` (verify still green — no change expected)

- [ ] **Step 1: Rewrite `src/services/component_factory.py`**

```python
from src.core.app_config import AppConfig
from src.embedding import FrameEmbedder
from src.ingestion.bag_parser import BagParser
from src.ingestion.indexer import Indexer
from src.retriever.global_search import GlobalSearcher
from src.retriever.video_chat import VideoChat


class BackendComponentFactory:
    def __init__(self, config: AppConfig, embedder: FrameEmbedder):
        self._config = config
        self._embedder = embedder

    def create_bag_parser(self, bag_path: str) -> BagParser:
        return BagParser(bag_path=bag_path, config=self._config)

    def create_indexer(self, bag_path: str) -> Indexer:
        return Indexer(bag_path=bag_path, config=self._config, embedder=self._embedder)

    def create_global_searcher(self) -> GlobalSearcher:
        return GlobalSearcher(config=self._config, embedder=self._embedder)

    def create_video_chat(self, bag_path: str) -> VideoChat:
        return VideoChat(bag_path=bag_path, config=self._config)
```

- [ ] **Step 2: Edit `app.py` lifespan — replace model loading with the embedder**

Remove the `from transformers import AutoProcessor, AutoModel` import (line 12). In `lifespan`, replace the model/processor loading block (current lines ~75–116) with:

```python
    from src.embedding import create_embedder

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Using compute device: %s", device)

    model_checkpoints_path = config.models.model_storage
    if not os.path.exists(model_checkpoints_path):
        os.makedirs(model_checkpoints_path, exist_ok=True)

    embedder = create_embedder(config).to(device)
    logger.info("Active embedder: %s (dim=%d)", embedder.name, embedder.embedding_dim)

    fastapi_app.state.app_config = config
    fastapi_app.state.embedder = embedder
    fastapi_app.state.component_factory = BackendComponentFactory(
        config=config,
        embedder=embedder,
    )
    fastapi_app.state.searcher_instance = (
        fastapi_app.state.component_factory.create_global_searcher()
    )
```

Update the shutdown block (current lines ~125–131) to:

```python
    logger.info("Server shutting down: clearing model resources")
    fastapi_app.state.embedder.offload()
    del fastapi_app.state.searcher_instance
    del fastapi_app.state.component_factory
    del fastapi_app.state.embedder
    del fastapi_app.state.app_config
    gc.collect()
```

Keep `import torch` (used for the device check).

- [ ] **Step 3: Verify the app imports cleanly**

Run: `PYTHONPATH="" uv run python -c "import app; print('app import OK')"`
Expected: `app import OK` (no model download happens on import — only at lifespan startup).

- [ ] **Step 4: Verify the API contract tests still pass (they inject fakes, so no model loads)**

Run: `PYTHONPATH="" uv run pytest tests/test_api_contracts.py -v`
Expected: PASS (all contract tests green — they override `get_search_service`/`get_indexing_service`, so the factory/embedder changes don't affect them).

- [ ] **Step 5: Commit**

```bash
git add src/services/component_factory.py app.py
git commit -m "[Backend] Wire single FrameEmbedder through factory and app lifespan"
```

---

# PHASE 3 — Storage + multi-camera ingestion

Goal: extraction produces aspect-preserving thumbnails at `long_side`, reads multiple camera topics, and writes metadata v3.

### Task 3.1: Pure helpers — `resize_long_side` and `camera_slug`

**Files:**
- Modify: `src/ingestion/bag_parser.py` (add module-level helpers)
- Test: `tests/test_bag_parser_helpers.py`

- [ ] **Step 1: Write the failing test `tests/test_bag_parser_helpers.py`**

```python
import numpy as np

from src.ingestion.bag_parser import camera_slug, resize_long_side


def test_resize_downscales_to_long_side_preserving_aspect():
    img = np.zeros((600, 1200, 3), dtype=np.uint8)  # H=600, W=1200
    out = resize_long_side(img, long_side=840)
    assert max(out.shape[:2]) == 840           # long edge clamped
    assert out.shape[1] == 840 and out.shape[0] == 420  # aspect preserved (2:1)


def test_resize_does_not_upscale_smaller_images():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    out = resize_long_side(img, long_side=840)
    assert out.shape[:2] == (100, 200)          # unchanged


def test_camera_slug_is_filesystem_safe_and_stable():
    assert camera_slug("/lucid/cam_front/image_rect/compressed") == "lucid_cam_front_image_rect_compressed"
    assert camera_slug("/cam/rear") == "cam_rear"
    assert "/" not in camera_slug("/a/b/c")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH="" uv run pytest tests/test_bag_parser_helpers.py -v`
Expected: FAIL — `ImportError: cannot import name 'camera_slug'`.

- [ ] **Step 3: Add helpers to `src/ingestion/bag_parser.py`**

Add these module-level functions near the top (after imports, before `class BagParser`). Add `import re` to the imports.

```python
import re


def camera_slug(topic: str) -> str:
    """Filesystem-safe, stable slug for a ROS topic (used as a thumbnail subdir).

    Collisions are theoretically possible for topics differing only in punctuation;
    acceptable for ROS topic naming.
    """
    return re.sub(r"[^A-Za-z0-9]+", "_", topic).strip("_")


def resize_long_side(cv_img, long_side: int):
    """Aspect-preserving downscale so the longer edge == long_side. Never upscales."""
    height, width = cv_img.shape[:2]
    longest = max(height, width)
    if longest <= long_side:
        return cv_img
    scale = long_side / float(longest)
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    return cv2.resize(cv_img, (new_w, new_h), interpolation=cv2.INTER_AREA)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_bag_parser_helpers.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/bag_parser.py tests/test_bag_parser_helpers.py
git commit -m "[Backend] Add resize_long_side and camera_slug ingestion helpers"
```

---

### Task 3.2: Multi-camera extraction + metadata v3

**Files:**
- Modify: `src/ingestion/bag_parser.py` (`__init__` + `extract_frames`)

This task has no automated unit test — constructing a synthetic rosbag is out of scope and the repo has no bag fixtures. It is verified by the manual integration check in Step 4. (Helpers are already unit-tested in Task 3.1.)

- [ ] **Step 1: Rewrite `BagParser.__init__`**

Replace the config-reading lines in `__init__` (current lines ~25–27):

```python
        self.topics = tuple(app_config.ingestion.camera_topics)
        self.fps = app_config.ingestion.sampling_fps
        self.long_side = app_config.ingestion.long_side
```

(Keep the artifact/thumbnail dir setup and `self.typestore = get_typestore(Stores.LATEST)` lines.)

- [ ] **Step 2: Rewrite `BagParser.extract_frames`**

```python
    def extract_frames(self):
        """Reads the bag and extracts aspect-preserving frames per camera topic."""
        logger.info("Opening bag: %s", self.bag_path.name)

        metadata = {
            "schema_version": METADATA_SCHEMA_VERSION,
            "bag_name": self.bag_path.name,
            "cameras": [],
            "embedder": None,
            "frames": [],
        }

        interval_ns = int((1.0 / self.fps) * 1e9)
        last_saved_ns: dict[str, int] = {}
        saved_count = 0

        with Reader(self.bag_path) as reader:
            connections = [c for c in reader.connections if c.topic in self.topics]
            present_topics = sorted({c.topic for c in connections})
            if not present_topics:
                raise ValueError(
                    f"None of the configured camera topics {list(self.topics)} "
                    f"found in {self.bag_path.name}"
                )
            metadata["cameras"] = present_topics

            for topic in present_topics:
                (self.thumbnail_dir / camera_slug(topic)).mkdir(parents=True, exist_ok=True)

            logger.info(
                "Extracting frames at %s FPS from %d camera(s): %s",
                self.fps,
                len(present_topics),
                present_topics,
            )

            for connection, timestamp_ns, rawdata in reader.messages(connections=connections):
                topic = connection.topic
                prev = last_saved_ns.get(topic)
                if prev is not None and (timestamp_ns - prev) < interval_ns:
                    continue
                try:
                    msg = self.typestore.deserialize_cdr(rawdata, connection.msgtype)
                    cv_img = message_to_cvimage(msg, "bgr8")
                    cv_img_resized = resize_long_side(cv_img, self.long_side)

                    slug = camera_slug(topic)
                    frame_path = self.thumbnail_dir / slug / f"frame_{timestamp_ns}.jpg"
                    if not cv2.imwrite(str(frame_path), cv_img_resized):
                        raise ValueError(f"Failed to write frame to {frame_path}")

                    metadata["frames"].append(
                        {
                            "timestamp_ns": timestamp_ns,
                            "topic": topic,
                            "file_path": str(frame_path.relative_to(self.artifact_dir)),
                        }
                    )
                    last_saved_ns[topic] = timestamp_ns
                    saved_count += 1
                except (ValueError, OSError, RuntimeError, cv2.error):
                    logger.warning(
                        "Skipping frame at %s (%s) in %s due to extraction error",
                        timestamp_ns,
                        topic,
                        self.bag_path,
                        exc_info=True,
                    )
                    continue

        metadata_path = self.artifact_dir / "metadata.json"
        with metadata_path.open("w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=4)

        logger.info("Extraction complete! Saved %s frames across %d cameras.", saved_count, len(metadata["cameras"]))
        return metadata_path
```

- [ ] **Step 3: Verify import + a no-bag failure path**

Run: `PYTHONPATH="" uv run python -c "from src.ingestion.bag_parser import BagParser; print('import OK')"`
Expected: `import OK`.

- [ ] **Step 4: Manual integration check (requires a real .mcap bag)**

With a real bag at `~/bags/<bag>` containing the configured topic(s), and a valid `embedding.backend`:

```bash
JWT_SECRET=x REFRESH_SECRET=y PYTHONPATH="" uv run python -m src.ingestion.bag_parser ~/bags/<bag>
```

Verify:
- `~/bags/<bag>/.bag_chat/thumbnails/<camera_slug>/frame_*.jpg` exist, are aspect-preserving (NOT square), longest edge ≈ 840.
- `~/bags/<bag>/.bag_chat/metadata.json` has `schema_version: 3`, a `cameras` list, per-frame `topic`, and `embedder: null`.

If you cannot run a real bag locally, record this as a deferred manual verification.

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/bag_parser.py
git commit -m "[Backend] Multi-camera extraction with aspect-preserving thumbnails and metadata v3"
```

---

# PHASE 4 — TIPSv2 backend

Goal: a second, working Global-search backend. Flip a config key, re-index, search.

### Task 4.1: `TipsV2Embedder`

**Files:**
- Create: `src/embedding/tipsv2.py`
- Modify: `src/embedding/__init__.py` (add the import so the decorator runs)
- Test: extend `tests/test_embedding.py` with a guarded real-model test

Reference: `/home/paolopertino/Desktop/tips/features_inspection.ipynb`. Confirmed API: load via `AutoModel.from_pretrained(model_id, trust_remote_code=True)`; preprocess = aspect-preserving resize with each side floored to a multiple of 14, then plain `ToTensor` (pixels 0..1, **no** ImageNet mean/std normalization); `model.encode_image(px).cls_token` → shape `(1, 1, 1024)` global vector; `model.encode_text([...])` → text features. Model dim for `google/tipsv2-l14` is **1024**.

- [ ] **Step 1: Write `src/embedding/tipsv2.py`**

```python
import os

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


@register_embedder("tipsv2")
class TipsV2Embedder(FrameEmbedder):
    """Google TIPSv2 backend (CLS-token global embeddings)."""

    def __init__(self, config):
        self._model_id = config.embedding.model
        self._storage = config.models.model_storage
        self._device = "cpu"

        self._model = self._load()
        self._model.eval()

        with torch.no_grad():
            self._dim = int(self.embed_images([Image.new("RGB", (28, 28))]).shape[1])

    def _load(self):
        local = os.path.join(self._storage, self._model_id)
        try:
            return AutoModel.from_pretrained(local, trust_remote_code=True)
        except (OSError, ValueError):
            model = AutoModel.from_pretrained(self._model_id, trust_remote_code=True)
            model.save_pretrained(local)
            return model

    @property
    def name(self) -> str:
        return f"tipsv2:{self._model_id}"

    @property
    def embedding_dim(self) -> int:
        return self._dim

    @property
    def capabilities(self) -> frozenset[str]:
        return frozenset({"global", "text"})

    def _preprocess(self, image: Image.Image) -> torch.Tensor:
        """Aspect-preserving ÷14 resize + ToTensor (0..1)."""
        width, height = image.size
        long_side = min(_ENCODE_LONG_SIDE, max(width, height))  # don't upscale
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
            pixel_values = self._preprocess(image.convert("RGB")).unsqueeze(0).to(self._device)
            with torch.no_grad():
                cls = self._model.encode_image(pixel_values).cls_token.reshape(-1)
                cls = cls / cls.norm()
            vecs.append(cls.cpu().numpy().astype(np.float32))
        if not vecs:
            return np.zeros((0, self._dim), dtype=np.float32)
        return np.stack(vecs, axis=0)

    def embed_text(self, queries: list[str]) -> np.ndarray:
        with torch.no_grad():
            feats = self._model.encode_text(list(queries))
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.cpu().numpy().astype(np.float32)

    def to(self, device: str) -> "TipsV2Embedder":
        self._device = device
        self._model.to(device)
        return self

    def offload(self) -> None:
        self._model.cpu()
        self._device = "cpu"
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
```

**Verify against the notebook when running with real weights:** confirm `encode_text` accepts a raw list of strings (the notebook calls `model.encode_text(texts)` directly). If the installed TIPSv2 revision requires explicit tokenization, adapt `embed_text` accordingly and note it. Confirm no ImageNet normalization is expected (the notebook uses plain `ToTensor`).

- [ ] **Step 2: Register the backend in `src/embedding/__init__.py`**

Add the import line:

```python
from src.embedding import tipsv2 as _tipsv2  # noqa: F401
```

- [ ] **Step 3: Add a guarded real-model test to `tests/test_embedding.py`**

```python
@pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="requires TIPSv2 weights")
def test_tipsv2_embedder_real_forward():
    from types import SimpleNamespace

    from src.embedding import create_embedder

    cfg = SimpleNamespace(
        embedding=SimpleNamespace(backend="tipsv2", model="google/tipsv2-l14"),
        models=SimpleNamespace(model_storage="models"),
    )
    emb = create_embedder(cfg)
    assert emb.name == "tipsv2:google/tipsv2-l14"
    assert emb.embedding_dim == 1024
    img_vecs = emb.embed_images([Image.new("RGB", (640, 420))])
    txt_vecs = emb.embed_text(["a pedestrian on a crosswalk"])
    assert img_vecs.shape == (1, 1024)
    assert txt_vecs.shape[1] == 1024
    assert np.allclose(np.linalg.norm(img_vecs, axis=1), 1.0, atol=1e-4)
```

- [ ] **Step 4: Run the non-model embedding tests (registry must still load with tipsv2 imported)**

Run: `PYTHONPATH="" uv run pytest tests/test_embedding.py -v`
Expected: PASS (4 passed, 2 skipped). Importing `tipsv2.py` must not fail at import time (it only loads weights when instantiated).

- [ ] **Step 5 (recommended): Run the real TIPSv2 forward test**

Run: `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run pytest tests/test_embedding.py::test_tipsv2_embedder_real_forward -v`
Expected: PASS (downloads `google/tipsv2-l14` on first run; dim 1024, unit-norm vectors). If models can't run locally, record as deferred manual verification.

- [ ] **Step 6: Commit**

```bash
git add src/embedding/tipsv2.py src/embedding/__init__.py tests/test_embedding.py
git commit -m "[Backend] Add TipsV2Embedder (CLS-token Global search backend)"
```

---

### Task 4.2: Flip config to TIPSv2 and validate end-to-end

**Files:**
- Modify: `config/settings.yaml` (backend + model)

- [ ] **Step 1: Switch the active backend**

Edit `config/settings.yaml` `embedding:` block:

```yaml
embedding:
  backend: "tipsv2"
  model: "google/tipsv2-l14"
```

- [ ] **Step 2: Confirm config + embedder construct**

Run: `RUN_MODEL_TESTS=1 PYTHONPATH="" uv run python -c "from src.core.app_config import get_app_config; from src.embedding import create_embedder; e=create_embedder(get_app_config()); print(e.name, e.embedding_dim)"`
Expected: `tipsv2:google/tipsv2-l14 1024`.

- [ ] **Step 3: Full manual end-to-end (requires GPU/weights + a real bag)**

1. Start the server: `JWT_SECRET=x REFRESH_SECRET=y PYTHONPATH="" uv run uvicorn app:app` (log shows `Active embedder: tipsv2:google/tipsv2-l14 (dim=1024)`).
2. Re-extract + re-index a bag via `POST /api/index` (or the UI). Confirm `metadata.json` `embedder` stamp becomes `{"name": "tipsv2:google/tipsv2-l14", "dim": 1024}`.
3. Run a text search via `POST /api/search`. Confirm results return.
4. Point the searcher at a bag still stamped `siglip2:...` and confirm the server logs `Skipping <bag>: indexed with {...siglip2...} ...` and does NOT crash.

Record results. If no GPU/weights locally, mark this step deferred and note it in the handoff.

- [ ] **Step 4: Commit**

```bash
git add config/settings.yaml
git commit -m "[Config] Switch active embedding backend to tipsv2-l14"
```

Note: leaving `siglip2` as the committed default is also valid — decide with the user whether the repo default should ship as SigLIP or TIPSv2. If keeping SigLIP as default, revert this file change and treat Step 3 as a documented validation only.

---

## Self-Review (performed against the spec)

**1. Spec coverage:**
- §2 Embedding package → Tasks 1.1, 1.3, 4.1. ✅
- §3 Config changes → Task 0.2 (block, long_side, camera_topics, retire embedding_model). ✅
- §4 Storage + multi-camera + metadata v3 + schema bump → Tasks 0.1, 3.1, 3.2. ✅
- §5 Indexer refactor + stamp → Tasks 2.1, 2.2. ✅
- §6 GlobalSearcher refactor + stamp-skip → Task 2.3. ✅
- §7 Wiring (factory + app.py) → Task 2.4. ✅
- §8 Migration (re-extract + re-index) → covered by manual validation in 3.2/4.2; no new script (matches the spec's lean recommendation). ✅
- §9 Error states → covered: unknown backend (registry ValueError, 4.x), absent topic (3.2), no topics (3.2 ValueError), stamp mismatch (2.3), unstamped (2.3), dim guard (2.1/2.3). ✅
- §10 Testing → tests added per phase; existing `test_temporal_dedup` verified (already per-frame topic). ✅
- §11 Slices → phases map 1:1 to slices 0–4. ✅
- §12 Out of scope → `embed_dense` left as raising seam; no fusion; no templating; batch_size as hint. ✅

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". The two paths without automated tests (real-model forward, multi-camera extraction) are explicitly justified (external weights / no bag fixtures) with concrete manual verification steps — not silent gaps.

**3. Type consistency:** `FrameEmbedder` API (`name`, `embedding_dim`, `capabilities`, `embed_images`, `embed_text`, `embed_dense`, `to`, `offload`) used identically in `siglip2.py`, `tipsv2.py`, `FakeEmbedder`, `Indexer`, `GlobalSearcher`. Stamp dict shape `{"name", "dim"}` consistent across `index_stamp.py`, `Indexer.build_index`, `GlobalSearcher._compatible_bags`, and all tests. `create_embedder(config)` reads `config.embedding.backend` consistently. `Indexer(bag_path, config, embedder)` and `GlobalSearcher(config, embedder)` signatures match the factory calls.

**Known dependency on external reference:** `tipsv2.py`'s exact `encode_text` input form and absence of ImageNet normalization must be confirmed against the notebook when running with real weights (flagged inline in Task 4.1 Step 1).
