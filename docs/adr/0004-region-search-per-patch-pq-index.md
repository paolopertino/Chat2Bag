# Region search index: per-patch, PQ-compressed, no stored full vectors

Region search ranks **Frames** by their single best-matching **Patch** (MaxSim)
against a query vector built from one or more user-clicked patch tokens (averaged
when several points mark the same object). We index **every Patch** (Family 1),
not pooled region descriptors, and store Patches **PQ-compressed at full 1024-d
with no PCA and no stored full-precision vectors**. Recall uses faiss `IndexIVFPQ`
with asymmetric distance (ADC — the query patch stays full-precision); when exact
ranking is needed, the top-N candidate Frames are re-encoded on the fly from
their already-stored thumbnails for an exact MaxSim re-rank — fidelity is
recovered by query-time compute, not by storage.

## Why

The whole point of Region search is finding small entities the whole-frame CLS
embedding dissolves. That rules out anything that averages patches together, and
it sets a hard storage budget: the index must stay negligible against multi-GB
bags (target ≈ 0.3% of bag size, i.e. on the order of the existing thumbnail
footprint), across a corpus of 50–100 bags.

Measured on a representative bag (842 frames, 2,280 patches/frame, 1.92M
patches):

| scheme | /bag | ×100 bags | vs 40 GB bag |
|---|---|---|---|
| full 1024-d f32 | 7.3 GB | 732 GB | 18.3% |
| full 1024-d f16 | 3.7 GB | 366 GB | 9.2% |
| PCA 256-d f16 | 937 MB | 92 GB | 2.3% |
| **PQ m=64, no full vecs** | **117 MB** | 11.4 GB | **0.29%** |

## Considered options

- **Store full 1024-d patch vectors (f32/f16) for exact MaxSim.** Rejected:
  3.7–7.3 GB/bag (370–730 GB across 100 bags) blows the negligible-footprint
  budget — the explosion the recall paradox warned about.
- **PCA dimensionality reduction (1024→128/256).** Rejected: still 0.5–1.8 GB/bag
  (not negligible), and it *discards* dimensions irrecoverably — lossy in exactly
  the way that erodes the small-entity fidelity Region search exists to protect.
  PQ keeps all 1024 dims (compressed, not truncated) and hits budget by itself.
- **Family 2 — pooled region descriptors (K vectors/Frame).** Rejected: tiny, but
  pooling averages patches and re-dissolves small entities — the CLS blind spot
  returning at smaller scale.

## Consequences

- The PQ/ADC ranking is **approximate**; recompute-refine (re-encoding the top-N
  candidate Frames' thumbnails) is the exact-ranking escape hatch — query-time
  compute for zero storage. Ship PQ/ADC first; add refine only if quality demands.
  The same recompute produces the **heatmap overlay**, so refine and visualization
  share one forward pass per displayed Frame.
- Enabling Region search on an existing bag needs only a **new dense-embedding
  pass over existing thumbnails — no re-extraction** (consistent with ADR 0002:
  swap = re-index, never re-extract).
- A federated query across 100 bags touches ~11 GB of PQ codes (m=64);
  memory-mapped (page cache, not hard RAM) and tunable via `m`.
- **Normalized, position-free schema.** A `patches` table
  `{frame_id: int32, vector: PQ}` joins to a `frames` table
  `{file_path, topic, timestamp_ns}`. Storing `file_path`/`topic` strings on
  every patch row would add ~250 MB/bag — *more than the PQ codes* — so
  normalization is a footprint requirement. Patch position `(i, j)` is **not**
  stored: ranking needs only `frame_id` (group → max), and the only requested
  visualization is a heatmap overlay, which is **recomputed on demand** from the
  result Frame's thumbnail (value-attention cosine map vs the query) — the *same*
  computation as recompute-refine, so the exact score and the heatmap fall out
  together, lazily, for displayed Frames only. Row ≈ 68 B/patch → ~131 MB/bag.
- metadata.json bumps to **schema v4**; the active embedder gains a **`'dense'`
  capability**; the patch index is stamped `{name, dim, feature, pq_params}` so a
  searcher skips incompatible patch indices (mirrors the existing CLS stamp check).
- **Patch feature = value-attention tokens** (MaskCLIP-style value-only path,
  post final LayerNorm), not last-layer tokens. Value-attention keeps each Patch
  *local*; last-layer's full self-attention re-mixes global scene context into
  every Patch — the CLS blind spot at patch scale. Confirmed empirically on the
  reference notebook: value-attention was the more discriminative feature for
  both text→patch and (less expectedly) patch→patch similarity. The same feature
  must be produced at index, query, and refine time. Baked into the index —
  changing it means re-indexing every bag.
