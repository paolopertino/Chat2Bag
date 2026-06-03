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
  4 — Adds optional `region_index` stamp (Region search faiss patch index);
      CLS frame layout unchanged from v3.
"""

METADATA_SCHEMA_VERSION = 4
