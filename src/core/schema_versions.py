"""
Schema version constants for artifact files produced by the ingestion pipeline.

Bump METADATA_SCHEMA_VERSION whenever the format of metadata.json changes so that
readers can detect stale artifacts and warn the user to re-index.

Version history:
  1 — Initial format. file_path stored as absolute string.
  2 — file_path stored relative to the artifact directory (portability fix).
"""

METADATA_SCHEMA_VERSION = 2
