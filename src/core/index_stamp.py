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


def build_gps_stamp(
    *, topic: str, max_gap_sec: float, fix_count: int,
    located_frame_count: int, frame_count: int,
) -> dict:
    """The top-level `gps` stamp recorded in metadata.json (Map search)."""
    return {
        "topic": topic,
        "max_gap_sec": float(max_gap_sec),
        "fix_count": int(fix_count),
        "located_frame_count": int(located_frame_count),
        "frame_count": int(frame_count),
    }


def read_gps_stamp(metadata_path) -> dict | None:
    """Return the `gps` stamp from a metadata.json, or None if absent/unreadable."""
    try:
        with Path(metadata_path).open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    stamp = meta.get("gps")
    return stamp if isinstance(stamp, dict) else None


def gps_is_located(stamp: dict | None) -> bool:
    """True iff a bag has a GPS stamp with at least one located Frame."""
    return bool(stamp) and int(stamp.get("located_frame_count", 0)) > 0


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
