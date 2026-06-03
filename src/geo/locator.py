"""Resolve an Area to the in-area Frame set per bag (reads metadata.json)."""
import json
from dataclasses import dataclass
from pathlib import Path

from src.core.storage import resolve_artifact_path
from src.geo.area import Area, contains


@dataclass(frozen=True)
class LocatedFrame:
    frame_id: int          # positional index into metadata["frames"]
    file_path: str         # relative to the artifact dir (matches LanceDB)
    topic: str
    timestamp_ns: int
    lat: float
    lon: float


def frames_in_area(area: Area, frames: list[dict]) -> list[int]:
    """Return frame_ids (list indices) of located frames inside `area`."""
    out: list[int] = []
    for frame_id, frame in enumerate(frames):
        lat, lon = frame.get("lat"), frame.get("lon")
        if lat is None or lon is None:
            continue
        if contains(area, float(lat), float(lon)):
            out.append(frame_id)
    return out


def located_frames_in_area(area: Area, frames: list[dict]) -> list[LocatedFrame]:
    """Return LocatedFrame rows for the in-area frames of one bag."""
    result: list[LocatedFrame] = []
    for frame_id in frames_in_area(area, frames):
        f = frames[frame_id]
        result.append(LocatedFrame(
            frame_id=frame_id,
            file_path=f["file_path"],
            topic=f["topic"],
            timestamp_ns=int(f["timestamp_ns"]),
            lat=float(f["lat"]),
            lon=float(f["lon"]),
        ))
    return result


def _load_frames(bag_path: str) -> list[dict]:
    meta_path = resolve_artifact_path(bag_path=Path(bag_path)) / "metadata.json"
    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            return json.load(handle).get("frames", [])
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return []


def resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]:
    """For each bag: read metadata.json and return its in-area LocatedFrames."""
    return {bag_path: located_frames_in_area(area, _load_frames(bag_path)) for bag_path in bag_paths}
