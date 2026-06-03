# Model boundary & index lifecycle

Each index embeds frames into a model-specific vector space at a model-specific
dimension, and federated Global search runs one query vector across many bag
indexes at once — so mixing indexes built by different models either crashes on
a dimension mismatch or, worse, returns silently garbage cosine scores. Frames
were also stored squared at 512×512, coupling the on-disk artifact to a model's
input size and distorting aspect ratio. We decide that:

- **Frame storage is model-agnostic** — aspect-ratio-preserving JPGs at a single
  config-driven `long_side` budget — default **~840**, kept configurable for
  tuning — with all model-specific resize/normalize happening
  *ephemerally inside the embedder*. **Swapping models is a re-index, never a
  re-extract.**
- **A single active embedder** runs at a time; its `{name, dim}` is **stamped
  into each index's `metadata.json`**, and the searcher **skips any bag whose
  stamp ≠ the active embedder, with a warning** rather than crashing.

This keeps extraction decoupled from the model and turns the silent cross-model
corruption into a visible, actionable "re-index this bag" signal (reusing the
existing `METADATA_SCHEMA_VERSION` re-index-warning pattern).

## Considered alternatives

- **Store frames at the model's input size** — forces a full re-extract on every
  model swap; rejected (defeats the abstraction's payoff).
- **Serve multiple models simultaneously, routing each bag's query to the model
  that indexed it** — loads several models into VRAM and adds per-bag routing;
  rejected as over-engineering for a transition done once.

## Consequences

- Existing SigLIP bags (768-d vectors + distorted 512² thumbnails) must be fully
  **re-extracted and re-indexed**; this is accepted.
- `METADATA_SCHEMA_VERSION` bumps, and the searcher gains a stamp-compatibility
  check before querying each bag.
- The `long_side` budget (~840, configurable) is sized for **Global search**, not
  Region search. **Region search may require a re-extract at higher resolution** —
  accepted, since its recall-index design is unspecced (see the recall paradox in
  `CONTEXT.md`). The budget is configurable so it can be raised before that effort.
