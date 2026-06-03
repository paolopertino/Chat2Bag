# Region Search — Point/Text-Prompted Dense Patch Retrieval — Design Spec

**Date:** 2026-05-30
**Scope:** Add **Region search** — ranking Frames by whether they contain a specific entity the user marks on a **Support image** (one or more points) or describes in text, *even when that entity does not dominate the frame*. Builds on the `embed_dense` seam left by the model-invariant embedding effort. **Global search, ingestion, multi-camera, auth, chat — all unchanged.**

**Source decisions (read first):**
- `CONTEXT.md` — glossary: **Patch**, **Support image**, **Region search**, **Global search**, **Frame**, **Sample**.
- `docs/adr/0004-region-search-per-patch-pq-index.md` — the index strategy (per-patch, PQ-compressed, code-only, recompute-refine).
- `docs/adr/0002-model-boundary-and-index-lifecycle.md` — swap = re-index, never re-extract (Region search adds an index pass over existing thumbnails).
- `docs/superpowers/specs/2026-05-29-model-invariant-embedding-multicam.md` — the `FrameEmbedder` ABC + `embed_dense` seam this spec fills.

This spec consolidates the grilling session (2026-05-30) into an implementation-ready contract. Resolutions beyond the ADR are marked **[DECISION]**; unconfirmed/soft items **[FLAG]**.

---

## 1. Overview

Global search embeds each Frame to a single CLS vector and ranks by whole-frame cosine. That **dissolves small entities** into the whole-frame embedding (the recall paradox in `CONTEXT.md`). Region search fixes this by indexing **every Patch** of every Frame and ranking a Frame by its **single best-matching Patch** (MaxSim) against a query vector.

The query vector `q` (always one L2-normalized vector) comes from one of:
- **Points on a Support image** — the value-attention Patch tokens under the clicked points, averaged.
- **Text** — the (template-ensembled) text embedding, which lives in the *same* value-attention patch space (the open-vocab property TIPS exhibits).

The pipeline, end to end:

```
SUPPORT IMAGE + points  ─┐
                         ├─►  embed_dense (value-attention)  ─►  q (1 vec, full precision)
TEXT query  ─────────────┘                                          │
                                                                    ▼
              per-bag faiss IVF-PQ patch index  ──ADC search──►  top-N patch hits
                                                                    │ group by frame_id, MaxSim
                                                                    ▼
                          temporal dedup + self-exclude + federate  ─►  ranked Frames
                                                                    │ (lazy, per displayed Frame)
                                                                    ▼
                       recompute patches from thumbnail  ─►  exact MaxSim refine + heatmap overlay
```

**Why this shape (locked in grilling + ADR 0004):**
- **MaxSim (single best Patch), size-invariant** — "contains the thing" = "≥1 region matches", so a 1-Patch traffic light ranks equally to one filling the frame. Reduces ranking to a single-vector ANN over Patches → recall happens *at Patch level*, never through the CLS blind spot.
- **Family 1 (index every Patch), not pooled descriptors** — pooling averages Patches and re-dissolves small entities.
- **PQ-compressed, code-only, no stored full vectors, no PCA** — the only scheme that keeps the index negligible (~138 MB/bag ≈ today's thumbnail footprint) against 40 GB bags × 50–100 bags. Exact ranking, when needed, is recovered by **recomputing** the top-N Frames' Patches from thumbnails — compute, not storage.
- **Value-attention Patch feature** — keeps each Patch local; last-layer tokens re-mix global context (CLS blind spot at Patch scale). Empirically the more discriminative feature for both text→patch and patch→patch.

**Non-goals:** no change to Global search behavior, the CLS index, extraction, multi-camera ingestion, auth, chat, or the frontend routing scaffold. Frontend rendering of the result grid + heatmap overlay is adjacent (see §12).

---

## 2. The dense embedding seam (`src/embedding/`)

### 2.1 Revise the `embed_dense` contract (`base.py`) — [DECISION]

The seam today declares `embed_dense(self, images) -> np.ndarray`. Variable-resolution Frames produce **variable-size patch grids**, so a single stacked array can't represent a batch. Revise to return **one grid per image**:

```python
def embed_dense(self, images: list[Image.Image]) -> list[np.ndarray]:
    """Region-search seam. Returns one (H_p, W_p, dim) float32 array per image,
    L2-normalized along the last axis — value-attention Patch tokens. Grid dims
    vary per image (aspect-preserving ÷patch_size). Raises NotImplementedError
    on backends without the 'dense' capability."""
    raise NotImplementedError(f"{self.name} does not implement dense embeddings")
```

- Grid shape `(H_p, W_p, dim)` is preserved (not flattened) so the query path can map a click `(x, y)` → Patch `(i, j)`, and the heatmap path can reshape similarities back to the grid.
- `SigLIP2Embedder` does **not** implement it → its `capabilities` omit `'dense'` → Region search is auto-disabled under the SigLIP backend (see §8).

### 2.2 `TipsV2Embedder.embed_dense` + `'dense'` capability (`tipsv2.py`)

Port the **value-only last block** from the reference notebook `/home/paolopertino/Desktop/tips/features_inspection.ipynb` (cell 6, `encode_image_value_attention`) — the implementation source of truth — but **do not port its two-pass structure**. The notebook runs the full ViT trunk *twice* per image (`model.encode_image` for the CLS token, then `encode_image_value_attention`, which re-runs `prepare_tokens_with_masks` + every block). [DECISION] we **share the trunk**: register a `forward_pre_hook` on `vision_encoder.blocks[-1]` that captures its input, call `model.encode_image(pixel_values)` **once** (yielding the real `cls_token` through the model's own public API), then run only the value-only last block on the captured tensor — MaskCLIP-style: value path only, post final LayerNorm, strip the leading `1 + num_register_tokens` (CLS + register) tokens, reshape to `(H_p, W_p, dim)`, L2-normalize per Patch. **One trunk pass yields both CLS and value-attention patches** (enabled by the single shared `encode_long_side`, §2.2).

```python
@property
def capabilities(self) -> frozenset[str]:
    return frozenset({"global", "text", "dense"})   # was {"global", "text"}

@torch.no_grad()
def embed_global_and_dense(
    self, images: list[Image.Image]
) -> list[tuple[np.ndarray, np.ndarray]]:
    """One trunk pass per image → (cls (dim,), patch_grid (H_p, W_p, dim)),
    both L2-normalized. Drives the fused fresh-index loop (§4)."""
    out = []
    for image in images:
        pixel_values = self._preprocess(image.convert("RGB")).unsqueeze(0).to(
            device=self._device, dtype=self._image_dtype)
        cls, patches = self._encode_cls_and_value(pixel_values)  # forward_pre_hook on blocks[-1]
        cls = cls / cls.norm()
        patches = patches / patches.norm(dim=-1, keepdim=True)
        out.append((cls.float().cpu().numpy().astype(np.float32),
                    patches.float().cpu().numpy().astype(np.float32)))
    return out

@torch.no_grad()
def embed_dense(self, images: list[Image.Image]) -> list[np.ndarray]:
    # Dense-only path (lazy upgrade, queries): same single trunk pass, CLS discarded.
    return [grid for _, grid in self.embed_global_and_dense(images)]
```

**[DECISION] Encode resolution is one shared knob: `embedding.encode_long_side` (default 896)** — `settings.yaml`-tunable, single source of truth in config. The embedder (which already takes `config`) reads it at construction instead of the module constant, and exposes it as a read-only property; Region-search code never re-declares the number — it reads the live property and the value is stamped into `metadata.json` `region_index` (§7), so index and query/refine geometry match by construction. `_preprocess` is shared, so this one value governs **both** the CLS/global path (`embed_images`) and the dense path (`embed_dense`) — CLS and patches are encoded at the same geometry, which is precisely what lets indexing produce both from **one shared encoder trunk** (§4): the value-attention path only diverges at the last block. (÷14 → up to 64 Patches on the long edge; this bag's 840×542 → 60×38 = 2,280 Patches.)

**[DECISION] Changing `encode_long_side` re-indexes everything.** Because it is shared, raising it (e.g. for finer small-entity Patches) invalidates **both** the CLS and the region indexes — a re-index, never a re-extract (ADR 0002: thumbnails already store ~840px long side; raising encode resolution only re-runs the embedder). **[FLAG]** the CLS embedder stamp is `{name, dim}` and would *not* catch a resolution-only change; either add `encode_long_side` to the CLS stamp or document that tuning it requires a manual full re-index. The region stamp does record it.

**[FLAG] value-path forward fragility.** The value head + the `blocks[-1]` `forward_pre_hook` reach into `model.vision_encoder.blocks[-1]` internals (`norm1`, `attn.qkv`, `attn.proj`, `ls1/ls2`, `mlp`, `norm2`, `num_register_tokens`) via `trust_remote_code`. Confine entirely to `tipsv2.py`. The CLS path stays on the model's public `encode_image`, so a model revision degrades **only** dense, never Global search. Add a shape assertion (`H_p*W_p == n_tokens - 1 - num_register_tokens`) so a changed token layout fails loudly. **[FLAG] hook lifecycle:** the `forward_pre_hook` must fire exactly once per call and be removed immediately after (context manager / `try…finally`) so it can't leak onto later forwards or accumulate.

---

## 3. The patch index — engine, format, storage

### 3.1 Engine: faiss IVF-PQ behind a `PatchIndex` abstraction — [DECISION]

**faiss `IndexIVFPQ`** is the patch-index engine: code-only (originals discarded by design), ~`m + 8` B/patch, IVF pruning for federation latency. **LanceDB was rejected here** — its IVF_PQ keeps the full vector column on disk (7.3 GB/bag) and would force PCA→128 to fit budget, reintroducing the dimensionality loss ADR 0004 specifically avoids. The CLS/Global index **stays in LanceDB** (small, originals fine at 3.5 MB).

Quarantine faiss behind a thin abstraction (mirrors the `FrameEmbedder` pattern), so the engine is swappable (e.g. **turbovec** — code-only TurboQuant, no training, evaluated and shelved for now on footprint: scalar-quant ~0.5–1 GB/bag vs PQ ~138 MB):

```
src/region/
  __init__.py
  patch_index.py     # PatchIndex protocol (build/add/persist/load/search)
  faiss_index.py     # FaissPatchIndex(PatchIndex)   <- ships now
  query.py           # build q from points / text
  region_search.py   # RegionSearcher (federation, dedup, refine, heatmap)
```

```python
class PatchIndex(Protocol):
    def train_add(self, vectors: np.ndarray, frame_ids: np.ndarray) -> None: ...
    def persist(self, path: Path) -> None: ...
    @classmethod
    def load(cls, path: Path, *, mmap: bool = True) -> "PatchIndex": ...
    def search(self, q: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
        """Returns (frame_ids, scores) for the top-k matching Patches (cosine via
        inner product on L2-normalized vectors)."""
```

`FaissPatchIndex`: `IndexIVFPQ` with `METRIC_INNER_PRODUCT` (cosine, since vectors are L2-normalized), wrapped so Patch→Frame attribution survives search. Patch→Frame mapping is a side `int32` array (`patch_id → frame_id`, ~7.6 MB/bag) — `search` returns Patch ids, we gather frame_ids and let the caller group. Persist with `faiss.write_index`; load read-only + `IO_FLAG_MMAP` for federation (page cache, not hard RAM).

### 3.2 PQ / IVF parameters — [DECISION] defaults, all config-tunable

- `m = 64` sub-quantizers, `nbits = 8` → 64 B/patch codes (~138 MB/bag incl. ids; ADR 0004 budget).
- `nlist` (IVF partitions) auto = `max(1, n_patches // 4096)` (~470 for this bag) — keeps ~4096 Patches/cell regardless of bag size, so `nprobe = 16` scans a predictable ~65k candidates/bag (constant latency as bags grow). Both config-tunable.
- **[DECISION] tiny-bag fallback = exact `IndexFlatIP`, not `IndexPQ`.** When `n_patches < min_patches_for_pq` (default **10,000** ≈ faiss's ~39×256 PQ-training floor), build an exact `IndexFlatIP` (full vectors, **no training**) for that bag instead of IVF-PQ. `IndexPQ` would *not* help — it still trains 256-centroid PQ codebooks, which is the actual binding constraint for tiny bags. FlatIP is free here precisely because the bag is tiny: ≤10k patches ≈ ≤4 frames → ≤ ~41 MB uncompressed, bounded and negligible, and *exact*. Both tiers sit behind the same `PatchIndex.search()` interface, so the searcher is tier-agnostic.
- **[DECISION] train-sample:** train IVF-PQ on `min(n_patches, max(256 × nlist, 39 × 2^nbits), 262144)` Patches — the `256 × nlist` term is faiss's IVF `max_points_per_centroid` heuristic (~120k here), floored by `39 × 2^nbits` (≈9,984 at nbits=8) so a small-but-PQ-eligible bag still trains its 256-centroid PQ codebooks, and **capped at 262,144** so huge bags don't over-train; sample randomly across Frames. Add *all* Patches afterward in streamed batches (add needs no full residency). The FlatIP tier trains nothing.
- Training: per-bag, on the bag's own Patches (1.9M is ample). No global codebook — keeps per-bag artifacts self-contained and matches the per-bag federation model.
- **Acceptance criterion (planning):** validate IVF-PQ recall@k vs an `IndexFlatIP` brute-force baseline on the example bag (target recall@100 ≥ 0.95). Low recall → raise `nprobe` or enable `refine` (§6), not a redesign.

### 3.3 On-disk layout (per bag)

```
.bag_chat/
  thumbnails/…                  # unchanged (also the refine/heatmap source)
  metadata.json                 # schema v4: + region_index stamp (§7)
  lancedb/                      # unchanged CLS/Global index
  region/
    patches.faiss               # IndexIVFPQ, code-only  (~123 MB)
    patch_frames.npy            # int32 patch_id → frame_id  (~7.6 MB)
```

`frame_id → {file_path, topic, timestamp_ns}` is read from `metadata.json`'s flat `frames` list (index position = `frame_id`). No per-Patch strings, no `(i, j)` (ADR 0004 §schema). Total region artifact ≈ **131–138 MB/bag**.

---

## 4. Building the patch index (`src/region/` + `IndexingService`)

Gated on capability + config (§8). Reuses thumbnails — **no re-extraction** (ADR 0002). Two entry points, **both one trunk pass per Frame**:

**Fresh index — fused loop [DECISION].** When a bag is indexed from scratch with region enabled, a single loop drives both indexes off `embed_global_and_dense` (one trunk pass + one thumbnail read per Frame, §2.2):
1. Load `metadata.json` (v4) flat `frames`; `frame_id` = list index.
2. For each Frame, load its thumbnail **once**; `cls, grid = embed_global_and_dense([img])[0]`.
3. `cls` → the existing LanceDB CLS writer (Global-search index, **logic unchanged**).
4. `grid` (`(H_p, W_p, dim)`) → flatten to `(H_p*W_p, dim)`, append to the faiss buffer with a parallel `frame_id` array.

The two writers stay **separate components** (LanceDB CLS index + `FaissPatchIndex`); only the top-level loop is shared, so the working CLS write path is *orchestrated*, not rewritten.

**Lazy upgrade — dense-only pass.** An existing bag that already has a CLS index (v3, or indexed before region was enabled) gains a region index without recomputing CLS: iterate thumbnails, `embed_dense([img])[0]` (still one trunk pass, CLS discarded), feed only the faiss buffer. The CLS index is left untouched.

Either path, the faiss build (`DensePatchIndexer`) is the same:
- Stream Patches in chunks (≈1.9M × 1024 × 4 B ≈ 7.5 GB if fully materialized → **never materialize all at once**); train on a sample (`min(n_patches, 256 × nlist)`, capped at 262,144 — §3.2), add in batches.
- `FaissPatchIndex.train_add(...)` → `persist(.bag_chat/region/patches.faiss)` + write `patch_frames.npy`.
- Stamp `metadata.json` `region_index` (§7).

Wired from `IndexingService`: the fused loop replaces the back-to-back CLS-then-dense passes for fresh indexing; the dense-only pass is the upgrade entry point. Status reuses the existing `PersistentStatusStore` (`idle → indexing → done/error`). **[DECISION]** dense indexing shares the CLS index's status entry (one "indexing" lifecycle per bag), not a separate state machine.

---

## 5. Building the query vector (`src/region/query.py`)

One function per source, each returning a single L2-normalized `np.ndarray` of shape `(dim,)`:

- **Points → `q`:** given a Support image (PIL) + points as **normalized `(x, y)` in [0,1]** on the displayed image:
  `grid = embedder.embed_dense([img])[0]` → `(H_p, W_p, dim)`; for each point `i = min(int(y*H_p), H_p-1)`, `j = min(int(x*W_p), W_p-1)`; `q = normalize(mean(grid[i, j] for each point))`. Always recomputed live, full precision (never read from the lossy index).
- **Text → `q`:** `q = normalize(mean(embedder.embed_text(templates_for(text))))` — one batched `encode_text` of N templated strings per query, averaged then renormalized. **[DECISION] template list = a ~10-template dashcam-relevant ensemble** (config `region_search.text_templates`, §8), modelling the degradations that actually vary in vehicle-camera frames (blur, low light, compression, distance/occlusion). The notebook's full ~80-template ImageNet set (cell 8) is rejected as the default — it includes rendering-style templates (`origami`, `tattoo`, `video game`, `sculpture`, `doodle`) that are pure noise for real street imagery and cost ~8× the encodes/query; it and the single `"a photo of {}."` (cell 9) remain one config edit away for A/B. **[FLAG] unverified for patches:** template ensembling is validated for CLS-token zero-shot classification, *not* text→value-attention-**patch** similarity — TIPS's open-vocab patch space may differ. Treat the default as a starting point to validate, not settled.

**[DECISION] Provenance-agnostic.** The points path takes `image + points` and does not care whether the image is an indexed Frame or an upload — `embed_dense` only needs pixels. This is what makes uploaded Support images free (Q10).

---

## 6. Searching (`src/region/region_search.py`)

`RegionSearcher` mirrors `GlobalSearcher`'s federation + dedup machinery:

- `search_by_q(q, bag_paths, top_k, exclude_file_path=None)`:
  - For each **region-compatible** bag (stamp check, §7): `idx = FaissPatchIndex.load(bag/region/patches.faiss, mmap=True)`; cache loaded indices like `GlobalSearcher._db_cache`.
  - `frame_ids, scores = idx.search(q, patch_fetch_limit)`. **[DECISION] `patch_fetch_limit` ≫ `top_k`** (default 4096): a Frame surfaces only if ≥1 of its Patches is in the returned set, so over-pull then group. Log a warning when grouping yields < `top_k` distinct Frames (raise the limit).
  - Group hits by `frame_id` → Frame score = **max** patch score (MaxSim, k=1). **[DECISION] aggregation knob** `top_k_patches` (Q2): k=1 = MaxSim (default, size-invariant); k>1 = mean of top-k patch scores per Frame, computed over the returned set. Pure post-retrieval CPU; no index change.
  - Join `frame_id → {file_path, topic, timestamp_ns}` from `metadata.json`.
  - Self-exclude `exclude_file_path` (Support image that is an indexed Frame).
  - Merge across bags; **reuse `_apply_temporal_dedup`** verbatim (`(bag_path, topic)` sequence key — a persistent entity collapses to one hit per window); sort by score; take `top_k`.
- `search_by_points(image, points, …)` / `search_by_text(text, …)`: build `q` (§5) then call `search_by_q`.

**[DECISION] Optional exact refine** (`refine.enabled`, default off): after the federated `top_n` (default 100) are chosen, recompute each Frame's Patches from its thumbnail (`embed_dense`), exact MaxSim vs `q`, re-sort. Ship approximate (ADC) first; enable refine if quality demands (ADR 0004).

Stamp compatibility reuses `src/core/index_stamp.py` semantics, extended for the region stamp (§7).

---

## 7. Schema, stamp, capability, lifecycle

### 7.1 `metadata.json` v4 — add `region_index` stamp

```jsonc
{
  "schema_version": 4,
  "cameras": [ … ],
  "embedder": { "name": "tipsv2:…", "dim": 1024 },     // CLS stamp (v3, unchanged)
  "region_index": {                                     // null until dense-indexed
    "engine": "faiss",
    "embedder_name": "tipsv2:…",
    "dim": 1024,
    "feature": "value-attention",
    "encode_long_side": 896,
    "pq": { "m": 64, "nbits": 8 },
    "patch_count": 1919760
  },
  "frames": [ { "timestamp_ns": …, "topic": …, "file_path": … }, … ]
}
```

`METADATA_SCHEMA_VERSION = 4` (`schema_versions.py`), history entry:
```
  4 — Adds optional `region_index` stamp (Region search faiss patch index); CLS frame layout unchanged from v3.
```
Add `read_region_stamp` / `write_region_stamp` / `is_region_stamp_compatible` to `index_stamp.py` (compare `embedder_name`, `dim`, `feature`, `encode_long_side`). v3 bags (no `region_index`) → `RegionSearcher` skips them with *"Skipping <bag>: no Region index — re-index to enable Region search"* (mirrors the CLS stamp-skip).

### 7.2 Capability gate + lifecycle — [DECISION]

- `region_search.enabled` defaults **on when `'dense' in embedder.capabilities`** (true for TIPSv2, false for SigLIP-2 → feature dormant, no errors). Dense indexing runs as part of the normal index pass (Q9).
- **Existing bags upgraded lazily, not force-migrated**: they gain a Region index on their next re-index; until then `RegionSearcher` skips them with the actionable warning. Surface "N bags lack a Region index" the same way the CLS stamp mismatch is surfaced.

---

## 8. Configuration (`config/settings.yaml`, `app_config.py`)

New `region_search:` block:

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
  text_templates:               # ~10-template dashcam ensemble (full-80 / single are A/B alternatives)
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

`app_config.py`: add `@dataclass(frozen=True) class RegionSearchConfig(...)`; add `region_search: RegionSearchConfig` to `AppConfig`; parse in `get_app_config()`. **[DECISION] `encode_long_side` lives in `EmbeddingConfig`, not `region_search`** — it is the embedder's encode geometry, shared by CLS + dense (§2.2), so there is no second copy to drift. `TipsV2Embedder` reads `config.embedding.encode_long_side` (default 896, replacing the `_ENCODE_LONG_SIDE` module constant) and exposes it as a read-only property; Region search reads that property, never config.

```yaml
embedding:
  backend: tipsv2
  model: google/tips-oss-l14-hr-pt-distilled    # existing
  encode_long_side: 896                          # NEW: shared CLS + dense encode geometry
```

---

## 9. API & wiring

### 9.1 Endpoints (`src/api/search_routes.py`) — [DECISION]

All under the existing authed `/api` router:

| Endpoint | Body | Notes |
|---|---|---|
| `POST /api/search/region/by-frame` | `{support_file_path, points:[{x,y}], bag_paths, top_k}` | Support is an indexed Frame; self-excluded from results. |
| `POST /api/search/region/by-image` | multipart: `image`, `points` (JSON), `bag_paths`, `top_k` | Uploaded Support image. |
| `POST /api/search/region/by-text` | `{text, bag_paths, top_k}` | Text→region. |
| `POST /api/search/region/heatmap` | query spec (one of the above) + `target_file_path` | Recompute `q` + target Patches → returns the `(H_p, W_p)` cosine grid (JSON floats, ~2 KB) + dims; frontend upsamples + colormaps + overlays. Lazy, per displayed Frame. |

`points` are normalized `(x, y)` ∈ [0,1] on the displayed image. **[DECISION]** the backend returns the raw similarity grid (not a rendered PNG) — keeps the backend dumb, lets the frontend control colormap/opacity. If `region_search.enabled` is false or no bag is region-compatible → `400`/empty with the skip reason.

### 9.2 Service + DI

- `RegionSearchService` (mirrors `SearchService`): validates `bag_paths`/payloads, delegates to the shared `RegionSearcher`.
- `dependencies.py`: `get_region_search_service(request)` → `RegionSearchService(request.app.state.region_searcher_instance)`.
- `component_factory.py`: `create_region_searcher()` → `RegionSearcher(config, embedder=self._embedder)`; built only when `region_search.enabled and 'dense' in embedder.capabilities`.
- `app.py` lifespan: after the embedder is resident, build `region_searcher_instance` (or `None`) into `app.state`. Reuses the **same shared embedder** (dense + global from one resident model).

---

## 10. Dependencies

- Add **`faiss-cpu`** to `pyproject.toml`. **[DECISION] `faiss-gpu` rejected, not deferred:** (1) the build bottleneck is the embedder's ViT forwards (already on the auto-detected GPU via torch, `app.py:73`), not faiss training/add, which is CPU-seconds; (2) GPU faiss needs codes resident in VRAM — incompatible with the `mmap` page-cache federation model (§3.1), where 11 GB across 100 bags won't fit; (3) `faiss-gpu` ships CUDA-version-coupled wheels that fight `uv`/pip. CPU IVF-PQ ADC search is already sub-second.
- No other new deps (`numpy`, `torch`, `PIL` already present).

---

## 11. Error states & edge cases

| Scenario | Behaviour |
|---|---|
| Active embedder lacks `'dense'` (e.g. SigLIP-2) | `region_search` dormant: no dense pass, `RegionSearcher` not built, region endpoints return a clear "not available with active backend" `400`. |
| Bag has CLS index but no Region index (v3, or `enabled` was off at index time) | Skipped at query with "re-index to enable Region search" warning; never crashes, never mixes spaces. |
| Region stamp mismatch (different embedder/feature/dim) | Skipped with warning (region stamp check). |
| Click maps outside the grid / empty `points` | Validate: ≥1 point, each in [0,1]; else `400`. |
| `patch_fetch_limit` too small (< `top_k` distinct Frames) | Return what we have + log a warning to raise the limit. |
| Tiny bag (< `min_patches_for_pq`) | Build exact `IndexFlatIP` for that bag — no training, full vectors, bounded ≤ ~41 MB (§3.2). |
| Uploaded Support image unreadable | `400 "Invalid image file"` (mirror `/api/search/image`). |
| Dense pass OOM on a huge bag | Streamed chunked add (§4); train on a sample, never materialize all Patches at once. |
| Heatmap requested for a non-region-indexed Frame | Still works — heatmap recomputes from the thumbnail; independent of the index. |

---

## 12. Testing

Run: `PYTHONPATH="" uv run pytest tests/`.

- **`embed_dense` contract** (`tests/test_embedding.py`): fake embedder returning deterministic grids; `TipsV2Embedder` reports `'dense'`; shape `(H_p, W_p, dim)` + per-Patch unit norm + grid matches `÷patch_size` geometry. (Real TIPSv2 forward gated behind an opt-in marker — heavy model.)
- **`PatchIndex` round-trip** (`tests/test_region_index.py`): build `FaissPatchIndex` from synthetic unit vectors with known frame_ids; persist→load→search recovers the planted nearest Frame; code-only (no original-vector column on disk).
- **`RegionSearcher` with fakes**: inject a fake embedder + a small in-memory index; assert MaxSim grouping (k=1), top-k-mean (k=2), `patch_fetch_limit` starvation warning, self-exclusion, per-camera temporal dedup, region stamp-skip.
- **Query construction**: points → correct `(i, j)` averaging + unit norm; text → template-ensembled unit vector.
- **Schema v4**: `region_index` null after CLS index, populated after dense pass; v3 bag skipped by `RegionSearcher`.
- **API contracts**: each region endpoint's request/response shape; `400` when backend lacks `'dense'`; heatmap returns grid + dims.

---

## 13. Implementation slices (for `/plan`)

- **Slice 0 — dense embedding seam + shared-trunk forward.** Revise the seam to `list[(H_p,W_p,dim)]`; move `encode_long_side` into `EmbeddingConfig` + add an embedder property; implement the value-only last block + `blocks[-1]` `forward_pre_hook` so `embed_global_and_dense` returns `(cls, grid)` in **one trunk pass** and `embed_dense` delegates to it; add `'dense'`. Contract tests (shape, per-patch unit norm, hook fires once + is removed, fused CLS == standalone CLS within tolerance). (No product surface yet.)
- **Slice 1 — `PatchIndex` + faiss.** `src/region/patch_index.py` protocol + `FaissPatchIndex`; round-trip tests across **both tiers** (IVF-PQ above `min_patches_for_pq`, exact `IndexFlatIP` below). Add `faiss-cpu`.
- **Slice 2 — Index pass (fused + upgrade).** `DensePatchIndexer` (faiss build) + `region_search` config + schema v4 + region stamp; wire the **fused fresh-index loop** (one trunk pass, both sinks) and the **dense-only upgrade pass** into `IndexingService`; streamed build. Index this spec's example bag end-to-end; assert ~130 MB artifact **and** that the CLS index is byte-identical whether built fused or standalone (Global search must not regress).
- **Slice 3 — Query + search.** `query.py` (points/text) + `RegionSearcher` (federation, dedup, self-exclude, aggregation, `patch_fetch_limit`).
- **Slice 4 — API + wiring.** Endpoints, `RegionSearchService`, DI, `component_factory`/`app.py` (build searcher only when capable+enabled).
- **Slice 5 — Refine + heatmap.** Recompute-refine (top-N) and the heatmap endpoint (recomputed cosine grid).
- **Slice 6 (frontend, separate effort).** Support-image canvas (place points), ranked result grid, toggleable heatmap overlay. Out of scope for this backend spec.

---

## 14. Out of scope / deferred / open

- **Frontend** — the point-placement canvas, result grid, and heatmap overlay UI are a separate effort (Slice 6); this spec stops at the API.
- **turbovec / alternative engines** — evaluated; faiss chosen on footprint (PQ ~138 MB/bag vs scalar-quant ~0.5–1 GB/bag). Re-evaluable behind the `PatchIndex` abstraction if it matures or the budget loosens.
- **Stored `(i, j)` / approximate index-side heatmap** — rejected (ADR 0004); heatmaps recompute from thumbnails (exact, zero storage).
- **PCA / dimensionality reduction** — rejected (ADR 0004); faiss code-only keeps full 1024-d.
- **Global PQ codebook across bags** — rejected; per-bag training keeps artifacts self-contained.
- **[RESOLVED 2026-05-30] GPU faiss** — rejected (not deferred): build bottleneck is the embedder (already GPU via torch), and GPU faiss is incompatible with the mmap page-cache federation model. Ship `faiss-cpu`. See §10.
- **[OPEN] Encode resolution tuning** — 896 is the start; raising it for finer small-entity Patches is a re-index of **both** CLS and region (shared knob — §2.2), never a re-extract. Validate during testing.
- **[RESOLVED 2026-05-30] `encode_long_side` single-sourcing** — one shared `embedding.encode_long_side` (config-tunable, default 896), owned by the embedder, read by Region search via a property, stamped in `region_index`. No `region_search` copy. See §2.2 / §8.
- **[FLAG] CLS stamp blind to resolution** — the CLS embedder stamp `{name, dim}` does not record `encode_long_side`, so a resolution-only re-index isn't auto-detected on the CLS side. Decide in planning: add it to the CLS stamp, or document tuning as a manual full re-index.
```
