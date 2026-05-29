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
