from pathlib import Path

from data_extraction_lib.artifacts import Metadata
from data_extraction_lib.geo import Circle, haversine
from data_extraction_lib.index import frames_in_area

from chat2bag.core.app_config import AppConfig, get_app_config
from chat2bag.core.storage import artifacts_for_bag
from chat2bag.geo.area_payload import parse_area_payload


class MapSearchService:
    """Standalone Map browse: the in-area Frame set, deduped + chronological."""

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_app_config()
        self._dedup_window_ns = int(max(0.0, cfg.search.temporal_dedup_window_sec) * 1_000_000_000)
        self._cap = int(cfg.search.map_browse_cap)

    def browse(self, area_payload: dict, bag_paths: list[str], top_k: int | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        area = parse_area_payload(area_payload)
        if area is None:
            raise ValueError("An area is required for map browse.")

        rows: list[dict] = []
        for bag_path in bag_paths:
            artifacts = artifacts_for_bag(Path(bag_path))
            meta = Metadata.try_load(artifacts)
            if meta is None:
                continue
            entries = meta.frame_entries()
            for pos in frames_in_area(area, entries):
                entry = entries[pos]
                row: dict = {
                    "bag_path": bag_path,
                    "timestamp_ns": entry.timestamp_ns,
                    "file_path": str(artifacts.dir / entry.file_path),
                    "topic": entry.topic,
                    "source_bag": bag_path.rstrip("/").split("/")[-1],
                    "lat": entry.coordinate.lat,
                    "lon": entry.coordinate.lon,
                }
                if len(area.geometries) == 1 and isinstance(area.geometries[0], Circle):
                    center = area.geometries[0].center
                    row["distance_m"] = haversine(center.lat, center.lon, entry.coordinate.lat, entry.coordinate.lon)
                rows.append(row)

        rows.sort(key=lambda r: (r["bag_path"], r["timestamp_ns"]))
        rows = self._dedup_keep_earliest(rows)
        cap = self._cap if top_k is None else min(self._cap, int(top_k))
        return rows[:cap]

    def _dedup_keep_earliest(self, rows: list[dict]) -> list[dict]:
        """Per (bag, topic) sequence, collapse rows within the window to the earliest.
        Assumes `rows` is already sorted chronologically per bag."""
        if self._dedup_window_ns <= 0:
            return rows
        kept: list[dict] = []
        half = self._dedup_window_ns // 2
        for cand in rows:
            key = (cand["bag_path"], cand["topic"])
            ts = cand["timestamp_ns"]
            redundant = any(
                (s["bag_path"], s["topic"]) == key and abs(ts - s["timestamp_ns"]) <= half
                for s in kept
            )
            if not redundant:
                kept.append(cand)
        return kept
