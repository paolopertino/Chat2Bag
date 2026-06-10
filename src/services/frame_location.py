"""Attach Frame locations (lat/lon) to search hits by joining bag metadata."""

import json
from pathlib import Path
from typing import Any

from src.core.storage import metadata_path_for_bag

LocationIndex = dict[tuple[str, int], tuple[float, float]]


def _location_index(bag_path: str) -> LocationIndex:
    index: LocationIndex = {}
    metadata_path = metadata_path_for_bag(Path(bag_path))
    if not metadata_path.exists() or not metadata_path.is_file():
        return index
    with metadata_path.open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    for frame in metadata.get("frames", []):
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
        location = cache[bag_path].get((hit.get("topic"), int(hit["timestamp_ns"])))
        if location is not None:
            hit["lat"], hit["lon"] = location
    return hits
