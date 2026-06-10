from src.core.app_config import AppConfig, get_app_config
from src.geo.area import Circle, area_from_payload, haversine
from src.geo.locator import resolve_area_to_frames


class MapSearchService:
    """Standalone Map browse: the in-area Frame set, deduped + chronological."""

    def __init__(self, config: AppConfig | None = None):
        cfg = config or get_app_config()
        self._dedup_window_ns = int(max(0.0, cfg.search.temporal_dedup_window_sec) * 1_000_000_000)
        self._cap = int(cfg.search.map_browse_cap)

    def browse(self, area_payload: dict, bag_paths: list[str], top_k: int | None = None) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        area = area_from_payload(area_payload)
        if area is None:
            raise ValueError("An area is required for map browse.")

        rows: list[dict] = []
        per_bag = resolve_area_to_frames(area, bag_paths)
        for bag_path, located in per_bag.items():
            for lf in located:
                row = {
                    "bag_path": bag_path,
                    "timestamp_ns": lf.timestamp_ns,
                    "file_path": lf.file_path,
                    "topic": lf.topic,
                    "source_bag": bag_path.rstrip("/").split("/")[-1],
                    "lat": lf.lat,
                    "lon": lf.lon,
                }
                if isinstance(area, Circle):
                    row["distance_m"] = haversine(area.lat, area.lon, lf.lat, lf.lon)
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
