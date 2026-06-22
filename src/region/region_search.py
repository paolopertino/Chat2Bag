import json
import logging

from collections import defaultdict
from pathlib import Path
from typing import List

import numpy as np

from PIL import Image

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import is_region_stamp_compatible, read_region_stamp
from src.core.storage import resolve_artifact_path
from data_extraction_lib.embedding import FrameEmbedder, create_embedder

from src.core.embedding_settings import embedding_settings_from_config
from src.geo.area_payload import parse_area_payload
from src.geo.locator import frames_in_area
from src.region.faiss_index import FaissPatchIndex
from src.region.query import build_query_from_points, build_query_from_text

logger = logging.getLogger(__name__)


class RegionSearcher:
    def __init__(self, config: AppConfig | None = None, embedder: FrameEmbedder | None = None):
        app_config = config or get_app_config()
        self._cfg = app_config.region_search
        self.temporal_dedup_window_ns = int(
            max(0.0, app_config.search.temporal_dedup_window_sec) * 1_000_000_000
        )
        self._embedder = (
            embedder
            if embedder is not None
            else create_embedder(embedding_settings_from_config(app_config))
        )
        self._index_cache: dict[str, FaissPatchIndex] = {}

    def invalidate_cache(self, region_dir: str) -> None:
        self._index_cache.pop(region_dir, None)

    @staticmethod
    def _sequence_key(result: dict) -> tuple[str, str]:
        return (str(result.get("bag_path", "")), str(result.get("topic", "")))

    def _apply_temporal_dedup(self, ranked_results: list[dict]) -> list[dict]:
        if self.temporal_dedup_window_ns <= 0:
            return ranked_results
        kept: list[dict] = []
        for candidate in ranked_results:
            candidate_key = self._sequence_key(candidate)
            candidate_ts = int(candidate.get("timestamp_ns", 0))
            is_redundant = False
            for selected in kept:
                if self._sequence_key(selected) != candidate_key:
                    continue
                if abs(candidate_ts - int(selected.get("timestamp_ns", 0))) <= self.temporal_dedup_window_ns // 2:
                    is_redundant = True
                    break
            if not is_redundant:
                kept.append(candidate)
        return kept

    def _compatible_region_bags(self, bag_paths: List[str]) -> list[tuple[str, Path, list[dict]]]:
        keep = []
        for bag_path in bag_paths:
            artifact = resolve_artifact_path(bag_path=Path(bag_path))
            meta_path = artifact / "metadata.json"
            stamp = read_region_stamp(meta_path)
            if not is_region_stamp_compatible(
                stamp, self._embedder.name, self._embedder.embedding_dim,
                "value-attention", int(self._embedder.encode_long_side or -1),
            ):
                logger.warning(
                    "Skipping %s: no/incompatible Region index — re-index to enable Region search",
                    Path(bag_path).name,
                )
                continue
            region_dir = artifact / "region"
            if not (region_dir / "patches.faiss").exists():
                logger.warning(
                    "Skipping %s: region stamp present but patches.faiss missing", Path(bag_path).name
                )
                continue
            with meta_path.open("r", encoding="utf-8") as handle:
                frames = json.load(handle).get("frames", [])
            keep.append((bag_path, artifact, frames))
        return keep

    def _get_index(self, region_dir: Path) -> FaissPatchIndex:
        key = str(region_dir)
        if key not in self._index_cache:
            self._index_cache[key] = FaissPatchIndex.load(region_dir, mmap=True)
        return self._index_cache[key]

    def search_by_q(
        self, q: np.ndarray, bag_paths: List[str], top_k: int = 5,
        exclude_file_path: str | None = None, area: dict | None = None,
    ) -> list[dict]:
        exclude_path = str(Path(exclude_file_path).expanduser().resolve()) if exclude_file_path else None
        top_k_patches = max(1, self._cfg.top_k_patches)
        area_obj = parse_area_payload(area)
        all_results: list[dict] = []

        for bag_path, artifact, frames in self._compatible_region_bags(bag_paths):
            index = self._get_index(artifact / "region")
            allowed_frame_ids = None
            if area_obj is not None:
                allowed_frame_ids = set(frames_in_area(area_obj, frames))
                if not allowed_frame_ids:
                    continue  # no in-area frames in this bag
            frame_ids, scores = index.search(q, self._cfg.patch_fetch_limit, allowed_frame_ids=allowed_frame_ids)
            if frame_ids.size == 0:
                continue

            per_frame: dict[int, list[float]] = defaultdict(list)
            for fid, sc in zip(frame_ids.tolist(), scores.tolist()):
                per_frame[int(fid)].append(float(sc))

            distinct = 0
            for fid, sclist in per_frame.items():
                if fid < 0 or fid >= len(frames):
                    continue
                frame = frames[fid]
                abs_path = str(artifact / frame["file_path"])
                if exclude_path and str(Path(abs_path).resolve()) == exclude_path:
                    continue
                sclist.sort(reverse=True)
                score = float(np.mean(sclist[:top_k_patches])) if top_k_patches > 1 else sclist[0]
                all_results.append({
                    "timestamp_ns": frame["timestamp_ns"],
                    "topic": frame["topic"],
                    "file_path": abs_path,
                    "bag_path": str(Path(bag_path).resolve()),
                    "source_bag": Path(bag_path).name,
                    "similarity_score": score,
                })
                distinct += 1

            if distinct < top_k:
                logger.warning(
                    "Region search on %s yielded %d distinct frames < top_k=%d; raise patch_fetch_limit.",
                    Path(bag_path).name, distinct, top_k,
                )

        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        if self._cfg.refine_enabled and all_results:
            head = self._refine(q, all_results[: self._cfg.refine_top_n])
            all_results = head + all_results[self._cfg.refine_top_n :]
            all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return self._apply_temporal_dedup(all_results)[:top_k]

    def _refine(self, q: np.ndarray, results: list[dict]) -> list[dict]:
        """Recompute exact MaxSim for each result from its thumbnail (compute, not storage)."""
        q = q.reshape(-1)
        for res in results:
            try:
                with Image.open(res["file_path"]) as im:
                    grid = self._embedder.embed_dense([im.convert("RGB")])[0]
            except (FileNotFoundError, OSError):
                continue
            sims = grid.reshape(-1, grid.shape[-1]) @ q
            res["similarity_score"] = float(np.max(sims))
        return results

    def search_by_points(self, image, points, bag_paths, top_k=5, exclude_file_path=None, area=None):
        q = build_query_from_points(image, points, self._embedder)
        return self.search_by_q(q, bag_paths, top_k, exclude_file_path, area=area)

    def search_by_text(self, text, bag_paths, top_k=5, area=None):
        q = build_query_from_text(text, self._embedder, self._cfg.text_templates)
        return self.search_by_q(q, bag_paths, top_k, area=area)

    def heatmap(self, q: np.ndarray, target_file_path: str) -> dict:
        """Recompute the target frame's value-attention patches and return the
        (H_p, W_p) cosine grid vs q. Independent of any index."""
        q = q.reshape(-1)
        with Image.open(target_file_path) as im:
            grid = self._embedder.embed_dense([im.convert("RGB")])[0]  # (H_p, W_p, dim)
        h_p, w_p, _ = grid.shape
        sims = (grid.reshape(-1, grid.shape[-1]) @ q).reshape(h_p, w_p)
        return {"height": int(h_p), "width": int(w_p), "grid": sims.astype(float).tolist()}

    def heatmap_for_text(self, text: str, target_file_path: str) -> dict:
        return self.heatmap(build_query_from_text(text, self._embedder, self._cfg.text_templates), target_file_path)

    def heatmap_for_points(self, image, points, target_file_path: str) -> dict:
        return self.heatmap(build_query_from_points(image, points, self._embedder), target_file_path)
