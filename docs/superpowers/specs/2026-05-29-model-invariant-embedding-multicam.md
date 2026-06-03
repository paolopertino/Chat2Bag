# Model-Invariant Embedding + TIPSv2 + Multi-Camera Ingestion — Design Spec

**Date:** 2026-05-29
**Scope:** Make the embedding backend swappable behind an abstraction, drop in Google's TIPSv2-l14 as a second backend for Global search, and expand ingestion from one camera topic to many. Region search is explicitly **out of scope** (deferred to a future `/snapshot`).

**Source decisions (read first):**
- `CONTEXT.md` — shared glossary (Bag / Frame / Camera / Sample / Global search / Region search).
- `docs/adr/0001-model-invariant-embedder-abstraction.md`
- `docs/adr/0002-model-boundary-and-index-lifecycle.md`
- `docs/adr/0003-per-camera-frames-no-multiview-fusion.md`

This spec consolidates those locked ADRs into an implementation-ready contract. Where the ADRs left a detail open, this spec resolves it and marks the resolution **[DECISION]**; soft/unconfirmed items are marked **[FLAG]**.

---

## 1. Overview

Today the ingestion (`Indexer`) and retrieval (`GlobalSearcher`) code is hardcoded to one HuggingFace interface contract — `AutoModel` / `AutoProcessor`, `get_image_features(...).pooler_output`, `get_text_features(...).pooler_output`. TIPSv2 breaks every one of those assumptions (`trust_remote_code`, `encode_image()/encode_text()`, hand-rolled ÷14 preprocessing, no `AutoProcessor`, a different embedding dim). "Model invariant" is therefore a real abstraction, not a config-string swap.

Three coupled changes:

1. **Embedder abstraction** (`src/embedding/`) — a `FrameEmbedder` ABC with framework-neutral I/O (PIL in → L2-normalized `np.ndarray` out), a string-keyed registry, and `create_embedder(config)`. Two subclasses quarantine framework code: `siglip2.py` (the current model) and `tipsv2.py` (the new one).
2. **Model boundary & index lifecycle** — frame storage becomes model-agnostic (aspect-preserving JPGs at a `long_side` budget); each index stamps `{name, dim}` into its `metadata.json`; the searcher skips bags whose stamp ≠ the active embedder with a warning instead of returning garbage.
3. **Multi-camera ingestion** — extraction reads an arbitrary list of camera topics; the embedded/searched unit stays a **per-camera Frame** (no fused multi-view embedding); `metadata.json` becomes v3 (flat frames + per-frame `topic` + `cameras[]` + embedder stamp).

These three are designed as **stageable slices** (see §11) so they can be planned and merged incrementally, but they share one config rewrite and one schema bump, so they land in the same effort.

**Non-goal:** no behavior change to the chat/VLM path, the extraction microservice, auth, or the frontend routing scaffold.

---

## 2. The embedding package (`src/embedding/`)

New module:

```
src/embedding/
  __init__.py        # exports FrameEmbedder, create_embedder, register_embedder
  base.py            # FrameEmbedder ABC
  registry.py        # _REGISTRY, register_embedder decorator, create_embedder(config)
  siglip2.py         # SigLIP-2 subclass  (@register_embedder("siglip2"))
  tipsv2.py          # TIPSv2 subclass     (@register_embedder("tipsv2"))
```

### 2.1 `FrameEmbedder` ABC (`base.py`)

Framework-neutral contract. **Input:** `PIL.Image` (already RGB-convertible) or `str`. **Output:** `np.ndarray`, `float32`, **L2-normalized** along the last axis, shape `(N, embedding_dim)`. Normalization is the embedder's responsibility, not the caller's — callers feed the result straight to LanceDB cosine search.

```python
from abc import ABC, abstractmethod
import numpy as np
from PIL import Image

class FrameEmbedder(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Stable identity stamped into metadata.json, e.g. 'siglip2:google/siglip2-base-patch16-naflex'."""

    @property
    @abstractmethod
    def embedding_dim(self) -> int:
        """Vector dimension this embedder emits. Stamped into metadata.json."""

    @property
    @abstractmethod
    def capabilities(self) -> frozenset[str]:
        """Subset of {'global', 'text', 'dense'}. This effort ships {'global', 'text'}."""

    @abstractmethod
    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. The embedder owns its own resize/normalize and batching."""

    @abstractmethod
    def embed_text(self, queries: list[str]) -> np.ndarray:
        """(N, dim) float32, L2-normalized. Raw query text in; no caller-side templating."""

    def embed_dense(self, images: list[Image.Image]) -> np.ndarray:
        """Documented seam for Region search. Unimplemented until Region search is specced."""
        raise NotImplementedError(f"{self.name} does not implement dense/region embeddings")

    @abstractmethod
    def to(self, device: str) -> "FrameEmbedder":
        """Move underlying model(s) to a compute device. Returns self for chaining."""

    @abstractmethod
    def offload(self) -> None:
        """Move to CPU and release VRAM (torch.cuda.empty_cache() if applicable)."""
```

**Notes:**
- `capabilities` lets the searcher/indexer assert support before calling (e.g. `assert "text" in embedder.capabilities`). Both shipped backends report `frozenset({"global", "text"})`. `"dense"` is deliberately absent — it's the Region-search seam.
- `embed_dense` is concrete-but-raising (not `@abstractmethod`) so subclasses aren't forced to implement it now. The CONTEXT.md "recall paradox" lives behind this seam.
- **The embedder owns its own batching.** `embed_images` accepts any list length and internally chunks. The ingestion `batch_size` becomes a *hint* (see §3, §11 deferred). This is what lets TIPSv2's variable-resolution batching differ from SigLIP's fixed-size batching without leaking into ingestion.

### 2.2 Registry + `create_embedder` (`registry.py`)

Explicit string-keyed registry (ADR 0001 rejected both HF auto-detection and `importlib` class-paths):

```python
_REGISTRY: dict[str, type[FrameEmbedder]] = {}

def register_embedder(key: str):
    def _decorator(cls): _REGISTRY[key] = cls; return cls
    return _decorator

def create_embedder(config: AppConfig) -> FrameEmbedder:
    key = config.embedding.backend
    if key not in _REGISTRY:
        raise ValueError(f"Unknown embedding backend '{key}'. Registered: {sorted(_REGISTRY)}")
    return _REGISTRY[key](config)   # subclass __init__ loads its own model
```

`src/embedding/__init__.py` imports `siglip2` and `tipsv2` so their `@register_embedder` decorators run on package import (registration-on-import).

### 2.3 `siglip2.py` — current behavior, relocated

Wraps the existing SigLIP-2 code paths verbatim, just behind the ABC:
- `embed_images`: `AutoProcessor(images=...).to(device)` → `model.get_image_features(**inputs).pooler_output` → L2-normalize → `np.ndarray`. Internal chunking by `batch_size` hint.
- `embed_text`: `AutoProcessor(text=..., padding="max_length", truncation=True, max_length=64)` → `model.get_text_features(**inputs).pooler_output` → L2-normalize. (Preserves the current `max_length=64` exactly.)
- `name` → `f"siglip2:{model_id}"`; `embedding_dim` → read from the loaded model config (currently 768); `capabilities` → `{"global", "text"}`.
- **Owns model loading**, including the `model_storage` checkpoint cache + download-on-miss logic currently in `app.py` lifespan (lines 75–101). `to()/offload()` replace the ad-hoc `.to(device)/.cpu()/empty_cache()` scattered through `Indexer`/`GlobalSearcher`.

### 2.4 `tipsv2.py` — new backend

Wraps Google TIPSv2-l14 per the reference notebook `/home/paolopertino/Desktop/tips/features_inspection.ipynb` (the implementation source of truth for the exact API):
- Loads with `trust_remote_code=True`; **no `AutoProcessor`** — the subclass hand-rolls the ÷14 resize (resize so each side is a multiple of the patch size) and normalization the notebook documents.
- `embed_images`: `model.encode_image(...).cls_token` → L2-normalize. (Only the CLS/global token; patch/dense tokens are the Region-search seam, not used here.)
- `embed_text`: `model.encode_text(...)` → L2-normalize, raw query.
- `name` → `f"tipsv2:{model_id}"`; `embedding_dim` → from the loaded model; `capabilities` → `{"global", "text"}`.
- Owns its own `model_storage` caching + download.

---

## 3. Configuration changes

### 3.1 New `embedding:` block (replaces `models.embedding_model`)

```yaml
embedding:
  backend: siglip2                                  # registry key: siglip2 | tipsv2
  model: "google/siglip2-base-patch16-naflex"       # HF id or local checkpoint path
```

`models.embedding_model` is **removed**. The remaining `models:` keys (`orchestration_llm`, `video_vlm`, `model_storage`) stay.

**[DECISION] No back-compat alias for `models.embedding_model`.** Rationale: switching backends already forces a full re-extract + re-index (ADR 0002 consequences), `settings.yaml` is an internal operator-owned file (not a published API), and a silent alias would mask the structural change. The migration note in §8 tells operators to edit the one block. **[FLAG]** — recommended in the prior session, unobjected but not explicitly confirmed; trivial to add an alias later if an operator workflow needs it.

### 3.2 `ingestion:` block — `long_side` replaces `max_image_size`, `camera_topics` replaces `camera_topic`

```yaml
ingestion:
  camera_topics:                                    # list, was singular `camera_topic`
    - "/lucid_vision/lucid_cam_front_center/image_rect/compressed"
  sampling_fps: 1.0                                 # applied per-camera (each topic sampled at this rate)
  long_side: 840                                    # aspect-preserving long-edge budget (configurable; tune during testing), was max_image_size: [512,512]
  batch_size: 8                                     # now a *hint*; the embedder owns real batching
```

**[DECISION] `long_side` lives under `ingestion:`, not `embedding:`.** The handoff summary bundled it into the embedding block, but ADR 0002 explicitly decouples storage resolution from the active model ("swapping models is a re-index, never a re-extract"). Storage resolution is a single budget independent of which embedder is active — the embedder does its own ephemeral patch-grid resize. Placing it under `embedding:` would wrongly imply that changing the embedder changes stored resolution.

**`long_side` budget value [DECISION].** Set to `840` and kept configurable (`ingestion.long_side`) for tuning during testing. This budget is sized for **Global search**, not Region search — per ADR 0002, **Region search may require a re-extract at higher resolution**. Operators raise the value and re-extract if testing shows 840 is too coarse.

### 3.3 `app_config.py` dataclasses

- Add `@dataclass(frozen=True) class EmbeddingConfig: backend: str; model: str`.
- `IngestionConfig`: drop `max_image_size: tuple[int, int]`; add `long_side: int`. Change `camera_topic: str` → `camera_topics: tuple[str, ...]`.
- `ModelsConfig`: drop `embedding_model`.
- `AppConfig`: add `embedding: EmbeddingConfig`.
- `get_app_config()`: parse the new block; coerce `camera_topics` to a tuple; read `long_side` as int.

---

## 4. Storage & extraction changes (`bag_parser.py`, metadata v3)

### 4.1 Aspect-preserving resize at `long_side` (ADR 0002)

Replace the squaring `cv2.resize(cv_img, self.max_size)` (current line 75–77) with an aspect-ratio-preserving resize: scale so the longer edge equals `long_side`, never upscale (skip resize if already ≤ budget), `INTER_AREA` for downscale. No padding, no squaring. Model-specific resize/normalize is now **ephemeral inside the embedder**, never on disk.

### 4.2 Multi-camera extraction (ADR 0003)

`BagParser` reads `config.ingestion.camera_topics` (list). For each configured topic present in the bag:
- Sample independently at `sampling_fps` — **per-topic `last_saved_ns` tracker** (a dict keyed by topic), not one shared counter.
- Write frames to a **per-camera thumbnail subdirectory**: `thumbnails/<camera_slug>/frame_<timestamp_ns>.jpg`.
- `camera_slug`: a deterministic filesystem-safe slug of the topic (non-alphanumeric → `_`, strip leading `_`). **[FLAG]** theoretical slug collision between two topics differing only in punctuation; acceptable for ROS topic naming, note in code.

**Absent topics:** if a configured topic is **not** in the bag, log a warning and skip that camera — do **not** fail the whole bag (different bags carry different rigs). Only raise `ValueError` if **none** of the configured topics are present (preserves the current "topic not found" failure mode, but across the set).

Reader connection filtering changes from `x.topic == self.topic` to `x.topic in configured_topics`; iterate messages across all matching connections and route each message to its topic's sampler.

### 4.3 `metadata.json` v3 (ADR 0003)

```jsonc
{
  "schema_version": 3,
  "bag_name": "<dir name>",
  "cameras": ["/cam/front/.../compressed", "/cam/rear/.../compressed"],
  "embedder": null,                       // {name, dim} once indexed; null after extraction, before indexing
  "frames": [
    {
      "timestamp_ns": 1234567890,
      "topic": "/cam/front/.../compressed",
      "file_path": "thumbnails/cam_front_..._compressed/frame_1234567890.jpg"
    }
    // ... flat list across all cameras
  ]
}
```

Changes from v2:
- **Removed** top-level `topic` (was a single string).
- **Added** top-level `cameras[]` (the configured topics actually extracted for this bag).
- **Added** per-frame `topic`.
- **Added** top-level `embedder` stamp slot (written by the indexer, see §5; `null` immediately after extraction).
- `frames` stays a flat list; `file_path` stays relative to the artifact dir (the v2 portability fix), now nested one subdir deeper.

### 4.4 Schema bump (`schema_versions.py`)

`METADATA_SCHEMA_VERSION = 3`. Add the history entry:
```
  3 — Flat per-camera frames (per-frame `topic`, `cameras[]`), embedder stamp, aspect-preserving thumbnails.
```
The existing "schema older than current → warn, re-index recommended" path in `Indexer.build_index` (lines 65–71) already handles v2 bags gracefully; v2 bags are warned and (per §8) must be re-extracted + re-indexed.

---

## 5. `Indexer` refactor (`indexer.py`)

- **Remove** all `transformers`/`torch` imports and device code. Constructor takes an injected `embedder: FrameEmbedder` instead of `model`/`processor`/`device` (and `model_name`).
- Read the flat v3 `frames`; per-frame `topic` is written into the LanceDB row (replacing the old top-level `metadata["topic"]` at current line 124). This is what makes per-camera temporal dedup work in search.
- Embedding loop: collect a batch of PIL images, call `embedder.embed_images(images)` → `np.ndarray`, zip with metadata. The embedder handles normalization and batching internally; the indexer no longer calls `get_image_features` / `.pooler_output` / `.norm()`.
- VRAM lifecycle: `embedder.to(device)` before the loop (or rely on the shared already-resident embedder), `embedder.offload()` is **not** called here if the embedder is the shared singleton (see §7) — offload is owned by the app lifespan. **[DECISION]** the indexer does not own model lifecycle when given the shared embedder; it only embeds.
- **Stamp on success:** after a successful LanceDB write, update `metadata.json`'s `embedder` field to `{"name": embedder.name, "dim": embedder.embedding_dim}` and persist. This is the index-compatibility stamp the searcher reads. (Extraction wrote `embedder: null`; the indexer fills it because the embedder identity is only known at index time.)

LanceDB row schema becomes: `{timestamp_ns, file_path (abs), topic (per-frame), vector}` — same columns, but `topic` is now per-frame.

---

## 6. `GlobalSearcher` refactor (`global_search.py`)

- **Remove** `transformers`/`torch` imports and device code. Constructor takes injected `embedder: FrameEmbedder`.
- `search(query, ...)`: `vec = embedder.embed_text([query])[0]` (raw query, no max_length plumbing — the SigLIP subclass keeps `max_length=64` internally).
- `_embed_image` / `search_by_image_bytes` / `search_similar_by_file_path`: `vec = embedder.embed_images([image])[0]`.
- `_search_vector`: **add a per-bag stamp-compatibility check** (ADR 0002). Before querying a bag's LanceDB table, read its `metadata.json` `embedder` stamp:
  - If `stamp is None` (extracted but never indexed) or `stamp != {active name, dim}` → **skip the bag with a warning** (`"Skipping <bag>: indexed with <stamp>, active embedder is <active> — re-index to include it"`), continue to the next bag. Do **not** crash, do **not** return its rows.
  - Reuse the existing per-bag skip pattern already used for "no LanceDB index found" (lines 106–110).
- Temporal dedup (`_apply_temporal_dedup`) and `_sequence_key` (`(bag_path, topic)`) are unchanged — and now correctly dedup **per camera** because `topic` is per-frame in the LanceDB rows.
- `invalidate_cache` stays (used after re-indexing).

**[DECISION] Stamp comparison key.** Compare on `(name, dim)` from the stamp vs. the active embedder. `name` alone is sufficient in practice, but including `dim` guards against a backend whose dim changed across a model revision, and prevents a dimension-mismatch crash in LanceDB cosine search.

---

## 7. Wiring (`component_factory.py`, `app.py`)

### 7.1 `BackendComponentFactory`

- Constructor: replace `embedding_model` / `embedding_processor` with a single `embedder: FrameEmbedder` (keep `device` only if still needed for non-embedder components; the embedder owns its own device now, so `device` can likely be dropped). **[FLAG]** confirm no other component needs `device`.
- `create_indexer(bag_path)` → `Indexer(bag_path, config, embedder=self._embedder)`.
- `create_global_searcher()` → `GlobalSearcher(config, embedder=self._embedder)`.
- `create_bag_parser` / `create_video_chat` unchanged.

### 7.2 `app.py` lifespan

- **Remove** the `AutoModel`/`AutoProcessor` load + `model_storage` cache logic (lines 12, 75–101) — that moves into the embedder subclass.
- Replace with:
  ```python
  embedder = create_embedder(config)
  embedder.to(device)
  fastapi_app.state.embedder = embedder
  ```
- Factory construction passes `embedder=embedder`.
- Shutdown: `fastapi_app.state.embedder.offload()` then `del`. Remove the `embedding_model` / `embedding_model_processor` state and their deletes.
- The "resolve device once at startup" line stays; `device` is passed to `embedder.to(device)`.

---

## 8. Migration of existing artifacts

ADR 0002 accepts a hard cut: **existing SigLIP bags (768-d vectors + distorted 512² thumbnails) are fully re-extracted and re-indexed.** There is no in-place upgrade.

- Operator-facing migration is: edit `config/settings.yaml` (new `embedding:` block + `ingestion.camera_topics` / `long_side`), then re-run extraction + indexing per bag.
- The existing schema-version warning surfaces stale (v2) bags during indexing, and the new searcher stamp-skip surfaces them at query time with an actionable message — no silent garbage.
- **[FLAG]** decide during planning whether to ship a tiny convenience script (`scripts/reindex_bag.py`) or rely on the existing POST `/api/index` flow. Lean: rely on existing flow; no new script.

---

## 9. Error states & edge cases

| Scenario | Behaviour |
|---|---|
| Configured `embedding.backend` not in registry | `create_embedder` raises `ValueError` listing registered keys; app fails fast at startup. |
| A configured camera topic absent in a given bag | Warn + skip that camera; bag still indexed from its present cameras. |
| **No** configured camera topics present in a bag | `BagParser.extract_frames` raises `ValueError` (as today, but across the set). |
| Bag indexed by a different embedder than the active one | Searcher skips it with a warning; does not crash, does not mix vector spaces. |
| Bag extracted but never indexed (`embedder: null`) | Searcher skips with "re-index to include it" warning. |
| Dimension mismatch would reach LanceDB | Prevented upstream by the `(name, dim)` stamp check before querying. |
| TIPSv2 requires `trust_remote_code` | Confined to `tipsv2.py`; SigLIP path unaffected. |
| Unreadable frame during indexing | Existing per-frame skip-with-warning (indexer lines 98–104) preserved. |
| VLM/chat path | Untouched — `VideoChat` does not use the embedder. |

---

## 10. Testing

Existing backend tests: `tests/test_api.py`, `tests/test_api_contracts.py`, `tests/test_temporal_dedup.py`. Run with `PYTHONPATH="" uv run pytest tests/`.

- **Embedder ABC contract tests** (new `tests/test_embedding.py`): a fake `FrameEmbedder` returning deterministic unit vectors; assert `create_embedder` dispatch, registry errors on unknown backend, L2-norm invariant, `capabilities` membership, and `embed_dense` raises `NotImplementedError`.
- **Indexer/Searcher with injected fake embedder**: existing DI pattern (CLAUDE.md "Mocking: dependency injection with fake services") — inject a fake embedder, assert stamp is written to `metadata.json` on index, and that the searcher skips a bag whose stamp mismatches.
- **`metadata.json` v3 shape**: assert flat frames carry per-frame `topic`, `cameras[]` present, `embedder` null after extraction and populated after indexing.
- **Multi-camera extraction**: fake/synthetic bag with two topics → frames land in two `thumbnails/<slug>/` dirs, per-topic sampling counts independent.
- **Temporal dedup** (`test_temporal_dedup.py`): update fixtures to the per-frame `topic` row shape; assert dedup is now per-camera (two cameras at the same timestamp are **not** deduped against each other).
- **Existing API/contract tests**: update any fixture that constructs v2 metadata (top-level `topic`) or asserts the old row schema.

---

## 11. Implementation slices (for `/plan`)

Designed so each slice is independently reviewable; they share the config rewrite, so Slice 0 lands first.

- **Slice 0 — Config & schema scaffolding.** New `embedding:` block + `ingestion.long_side`/`camera_topics`; `app_config.py` dataclasses; `METADATA_SCHEMA_VERSION = 3`. No behavior change yet beyond config parsing.
- **Slice 1 — Embedder package.** `FrameEmbedder` ABC + registry + `create_embedder` + `siglip2.py` (relocate current behavior, incl. model loading). ABC contract tests. **Backend still behaves identically** (SigLIP via the new abstraction).
- **Slice 2 — Wiring.** Refactor `Indexer`, `GlobalSearcher`, `BackendComponentFactory`, `app.py` to use the injected embedder; gut transformers/torch from indexer/searcher. Add the stamp write + stamp-skip check. Re-run existing tests against the fake embedder.
- **Slice 3 — Storage + multi-camera.** Aspect-preserving `long_side` resize; multi-camera extraction; metadata v3 (flat frames, per-frame topic, cameras[], per-camera thumbnail subdirs, per-topic sampling).
- **Slice 4 — TIPSv2 backend.** `tipsv2.py` subclass wrapping the notebook API; register; flip config to validate the drop-in end-to-end.

---

## 12. Out of scope / deferred

- **Region search** (cross-frame entity retrieval) — its recall-index design is the hard, hard-to-reverse part. Start from the **recall paradox** recorded in `CONTEXT.md` (Global search dissolves small entities, yet the cheapest Region recall reuses Global search and inherits that blind spot) via a future `/snapshot`. `embed_dense` is the seam left for it.
- **Fused multi-view embedding** — rejected (ADR 0003 dilution argument). Frames stay per-camera; `Sample` is display-time nearest-timestamp grouping only.
- **Multi-model serving / per-bag query routing** — rejected (ADR 0002); single active embedder.
- **Variable-resolution batching as a first-class config knob** — the embedder owns its batching internally now; `ingestion.batch_size` is a hint. A richer per-embedder batching policy can come with the TIPSv2 perf pass.
- **Per-embedder text templating / prompt ensembling** — Global search uses the raw query. Template ensembling is a Region-search concern.
- **Rigorous multi-camera synchronizer** (`sync_threshold` / `target_lidar_frame`) — stays in the separate nuScenes extraction microservice; not duplicated in ingestion.
- **Frontend** — no routing/UI changes; bag scanning UI changes for surfacing multiple cameras are adjacent and not in this effort.
