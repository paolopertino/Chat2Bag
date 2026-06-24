"""Resolve an Area to the in-area Frame set per bag (reads metadata.json).

Geometry + containment live in `data_extraction_lib.geo`; this module is the thin
webapp glue that reads metadata.json off disk (via the app's storage policy) and
maps each frame's GPS to a library `Coordinate` to test `Area` membership.

`LocatedFrame` stays app-side on purpose: `topic` (ROS2), `file_path` (artifact
storage) and `timestamp_ns` (bag) are not geographic. The shared, first-class
`Frame` + frame-locator is deferred to the library's `artifacts` step — see
data-extraction-lib `docs/adr/0001-geo-stays-pure-frame-location-deferred.md`.
"""
from dataclasses import dataclass
from pathlib import Path

from data_extraction_lib.geo import Area, Coordinate
from data_extraction_lib.artifacts import Metadata

from src.core.storage import artifacts_for_bag


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
        if area.contains(Coordinate(float(lat), float(lon))):
            out.append(frame_id)
    return out


def located_frames_in_area(
    area: Area, frames: list[dict], artifact_dir: Path | None = None,
) -> list[LocatedFrame]:
    """Return LocatedFrame rows for the in-area frames of one bag.

    When `artifact_dir` is given, `file_path` is resolved to the ABSOLUTE on-disk
    path (`<artifact_dir>/<relative>`) — matching the LanceDB `file_path` column the
    Global compose IN-list filters on and the absolute path `/api/image` serves for
    browse previews. Without it the relative metadata path is kept (unit-test use).
    """
    result: list[LocatedFrame] = []
    for frame_id in frames_in_area(area, frames):
        f = frames[frame_id]
        file_path = str(artifact_dir / f["file_path"]) if artifact_dir is not None else f["file_path"]
        result.append(LocatedFrame(
            frame_id=frame_id,
            file_path=file_path,
            topic=f["topic"],
            timestamp_ns=int(f["timestamp_ns"]),
            lat=float(f["lat"]),
            lon=float(f["lon"]),
        ))
    return result


def _artifact_and_frames(bag_path: str) -> tuple[Path, list[dict]]:
    artifacts = artifacts_for_bag(Path(bag_path))
    meta = Metadata.try_load(artifacts)
    return artifacts.dir, (meta.frames if meta is not None else [])


def resolve_area_to_frames(area: Area, bag_paths: list[str]) -> dict[str, list[LocatedFrame]]:
    """For each bag: read metadata.json and return its in-area LocatedFrames.

    `file_path` is the ABSOLUTE on-disk path so it matches the LanceDB `file_path`
    column (Global compose IN-list) and is directly fetchable via `/api/image`
    (browse tile previews).
    """
    out: dict[str, list[LocatedFrame]] = {}
    for bag_path in bag_paths:
        artifact, frames = _artifact_and_frames(bag_path)
        out[bag_path] = located_frames_in_area(area, frames, artifact_dir=artifact)
    return out
