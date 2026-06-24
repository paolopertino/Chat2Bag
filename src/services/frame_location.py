"""Attach Frame locations (lat/lon) to search hits by joining bag metadata."""

from pathlib import Path
from typing import Any

from data_extraction_lib.artifacts import Metadata

from src.core.storage import artifacts_for_bag

LocationIndex = dict[tuple[str, int], tuple[float, float]]


def _location_index(bag_path: str) -> LocationIndex:
    index: LocationIndex = {}
    meta = Metadata.try_load(artifacts_for_bag(Path(bag_path)))
    if meta is None:
        return index
    for frame in meta.frames:
        if "lat" in frame and "lon" in frame:
            index[(frame["topic"], int(frame["timestamp_ns"]))] = (frame["lat"], frame["lon"])
    return index


def attach_locations(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill lat/lon in-place on hits that lack them; one metadata read per bag."""
    cache: dict[str, LocationIndex] = {}
    for hit in hits:
        if hit.get("lat") is not None and hit.get("lon") is not None:
            continue
        bag_path = hit.get("bag_path")
        if not bag_path:
            continue
        if bag_path not in cache:
            cache[bag_path] = _location_index(bag_path)
        ts = hit.get("timestamp_ns")
        if ts is None:
            continue
        location = cache[bag_path].get((hit.get("topic"), int(ts)))
        if location is not None:
            hit["lat"], hit["lon"] = location
    return hits
