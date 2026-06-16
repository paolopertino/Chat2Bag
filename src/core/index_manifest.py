import json

from datetime import datetime, timezone
from pathlib import Path

from src.core.index_stamp import read_embedder_stamp, read_region_stamp

MANIFEST_FILENAME = "index_manifest.json"
MANIFEST_VERSION = 1


def manifest_path(artifact_dir) -> Path:
    """Path to the completion manifest inside an artifact directory."""
    return Path(artifact_dir) / MANIFEST_FILENAME


def write_index_manifest(
    artifact_dir,
    *,
    embedder_name: str,
    embedder_dim: int,
    frame_count: int,
    cameras,
    region_index: bool,
) -> None:
    """Write the completion manifest (the final, dedicated marker of a successful index)."""
    path = manifest_path(artifact_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "manifest_version": MANIFEST_VERSION,
        "completed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "embedder": {"name": str(embedder_name), "dim": int(embedder_dim)},
        "frame_count": int(frame_count),
        "cameras": sorted({str(c) for c in cameras}),
        "region_index": bool(region_index),
    }
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=4)


def read_index_manifest(artifact_dir) -> dict | None:
    """Return the manifest dict, or None if missing/corrupt/version-less (fail-safe)."""
    try:
        with manifest_path(artifact_dir).open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    version = data.get("manifest_version")
    if not isinstance(version, int) or version < 1:
        return None
    return data


def is_indexed(artifact_dir) -> bool:
    """True iff the artifact dir holds a valid completion manifest."""
    return read_index_manifest(artifact_dir) is not None


def delete_index_manifest(artifact_dir) -> None:
    """Remove the manifest if present; tolerant no-op otherwise (never raises)."""
    try:
        manifest_path(artifact_dir).unlink()
    except (FileNotFoundError, OSError):
        pass


def ensure_manifest(artifact_dir) -> bool:
    """Lazy migration: if no manifest exists but a legacy embedder stamp does,
    synthesize a manifest from metadata.json. Returns True iff a valid manifest
    exists after the call. Tolerant of a missing/unreadable artifact dir."""
    artifact_dir = Path(artifact_dir)
    if is_indexed(artifact_dir):
        return True

    metadata_path = artifact_dir / "metadata.json"
    stamp = read_embedder_stamp(metadata_path)
    if not stamp or "name" not in stamp or "dim" not in stamp:
        return False

    try:
        with metadata_path.open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return False

    frames = meta.get("frames") or []
    cameras = sorted({f["topic"] for f in frames if "topic" in f})
    region_index = read_region_stamp(metadata_path) is not None

    try:
        write_index_manifest(
            artifact_dir,
            embedder_name=stamp["name"],
            embedder_dim=int(stamp.get("dim", 0)),
            frame_count=len(frames),
            cameras=cameras,
            region_index=region_index,
        )
    except OSError:
        return False
    return True
