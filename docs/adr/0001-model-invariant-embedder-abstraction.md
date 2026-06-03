# Model-invariant embedder abstraction

The ingestion and retrieval code was hardcoded not just to a model *name* but to
an entire HuggingFace interface contract (`AutoModel`/`AutoProcessor`,
`get_image_features(...).pooler_output`). Migrating to TIPSv2 — which needs
`trust_remote_code`, uses `encode_image`/`encode_text`, hand-rolls its own
preprocessing, and emits a different embedding dim — breaks every one of those
assumptions. We introduce a `FrameEmbedder` ABC in `src/embedding/` with
**framework-neutral I/O** (PIL images in → L2-normalized `np.ndarray` out),
`embed_images`/`embed_text`, `name`/`embedding_dim`/`capabilities` metadata, and
`to()`/`offload()` lifecycle; a string-keyed registry + `create_embedder(config)`
selects a per-model subclass that quarantines all framework specifics. Scope is
deliberately minimal (`global` + `text`); `embed_dense` is a documented seam
left unimplemented until Region search is specced.

Adding a model becomes a three-step, type-checked change — write a subclass,
register it, flip `embedding.backend` in config — and a non-HuggingFace backend
(local TorchScript/ONNX checkpoint, remote embedding service) fits the same ABC.

## Considered alternatives

- **Auto-detect the interface from the HF config** — fragile magic that breaks
  on any model with a non-standard head; rejected.
- **Fully `importlib`-driven class path in config** — stringly-typed and
  undiscoverable; rejected in favour of an explicit registry.

## Consequences

- `Indexer` and `GlobalSearcher` lose all `transformers`/`torch` device code and
  call the embedder instead.
- A structured `embedding:` config block replaces the bare
  `models.embedding_model` string.
