import io
import logging

from pathlib import Path
from typing import List

import lancedb

from PIL import Image

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import is_stamp_compatible, read_embedder_stamp
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder, create_embedder
from src.geo.area import area_from_payload
from src.geo.locator import resolve_area_to_frames

logger = logging.getLogger(__name__)


class GlobalSearcher:
    def __init__(
        self,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
    ):
        app_config = config or get_app_config()

        self.temporal_dedup_window_ns = int(
            max(0.0, app_config.search.temporal_dedup_window_sec) * 1_000_000_000
        )
        self._embedder = embedder if embedder is not None else create_embedder(app_config)
        self._db_cache: dict[str, lancedb.DBConnection] = {}

    def _get_db(self, db_path: str) -> lancedb.DBConnection:
        if db_path not in self._db_cache:
            self._db_cache[db_path] = lancedb.connect(db_path)
        return self._db_cache[db_path]

    def invalidate_cache(self, db_path: str) -> None:
        """Remove a cached DB connection, e.g. after re-indexing a bag."""
        self._db_cache.pop(db_path, None)

    @staticmethod
    def _sequence_key(result: dict) -> tuple[str, str]:
        return (str(result.get("bag_path", "")), str(result.get("topic", "")))

    def _compatible_bags(self, bag_paths: List[str]) -> list[str]:
        """Keep only bags whose index stamp matches the active embedder."""
        keep: list[str] = []
        for bag_path in bag_paths:
            meta_path = resolve_artifact_path(bag_path=Path(bag_path)) / "metadata.json"
            stamp = read_embedder_stamp(meta_path)
            if is_stamp_compatible(stamp, self._embedder.name, self._embedder.embedding_dim):
                keep.append(bag_path)
            else:
                logger.warning(
                    "Skipping %s: indexed with %s, active embedder is %s (dim=%d) — re-index to include it.",
                    Path(bag_path).name,
                    stamp,
                    self._embedder.name,
                    self._embedder.embedding_dim,
                )
        return keep

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

                selected_ts = int(selected.get("timestamp_ns", 0))
                if abs(candidate_ts - selected_ts) <= self.temporal_dedup_window_ns // 2:  # Window is centered around each result, so divide by 2 for comparison.
                    is_redundant = True
                    break

            if not is_redundant:
                kept.append(candidate)

        suppressed = len(ranked_results) - len(kept)
        if suppressed > 0:
            logger.info(
                "Temporal de-dup suppressed %d/%d nearby frames (window=%dns)",
                suppressed,
                len(ranked_results),
                self.temporal_dedup_window_ns,
            )

        return kept

    def _search_vector(
        self,
        query_vector: list[float],
        bag_paths: List[str],
        top_k: int,
        exclude_file_path: str | None = None,
        area: dict | None = None,
    ) -> list[dict]:
        """Searches a query vector across one or more compatible bag indices."""

        exclude_path = None
        if exclude_file_path:
            exclude_path = str(Path(exclude_file_path).expanduser().resolve())

        area_obj = area_from_payload(area)
        in_area: dict[str, set[str]] | None = None
        if area_obj is not None:
            in_area = {
                bp: {lf.file_path for lf in located}
                for bp, located in resolve_area_to_frames(area_obj, bag_paths).items()
            }

        all_results = []
        for bag_path in self._compatible_bags(bag_paths):
            db_path = resolve_artifact_path(bag_path=Path(bag_path)) / "lancedb"
            if not db_path.exists():
                logger.warning(
                    "Skipping %s: no LanceDB index found.", Path(bag_path).name
                )
                continue

            db = self._get_db(str(db_path))
            table = db.open_table("frames")

            # Pull extra rows to account for self-exclusion and temporal de-dup suppression.
            fetch_limit = max(top_k * 3, top_k + 10)
            query = table.search(query_vector).metric("cosine")
            if in_area is not None:
                allowed = in_area.get(bag_path, set())
                if not allowed:
                    continue  # bag has no in-area frames
                clause = "file_path IN (" + ", ".join("'" + fp + "'" for fp in allowed) + ")"
                query = query.where(clause, prefilter=True)
            results = query.limit(fetch_limit).to_list()
            for res in results:
                if exclude_path and str(Path(res["file_path"]).resolve()) == exclude_path:
                    continue
                res["bag_path"] = str(Path(bag_path).resolve())
                res["source_bag"] = Path(bag_path).name
                res["similarity_score"] = 1.0 - res["_distance"]
                res.pop("_distance", None)
                res.pop("vector", None)
                all_results.append(res)

        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        deduped_results = self._apply_temporal_dedup(all_results)
        return deduped_results[:top_k]

    def search(self, query: str, bag_paths: List[str], top_k: int = 5, area: dict | None = None):
        """Embeds text once and searches across multiple LanceDB indices."""
        logger.info("Embedding query: '%s'", query)
        query_vector = self._embedder.embed_text([query])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_by_image_bytes(self, image_bytes: bytes, bag_paths: List[str], top_k: int = 5, area: dict | None = None):
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k, area=area)

    def search_similar_by_file_path(
        self,
        file_path: str,
        bag_paths: List[str],
        top_k: int = 5,
        area: dict | None = None,
    ):
        image_path = Path(file_path).expanduser().resolve()
        image = Image.open(image_path).convert("RGB")
        query_vector = self._embedder.embed_images([image])[0].tolist()
        return self._search_vector(
            query_vector=query_vector,
            bag_paths=bag_paths,
            top_k=top_k,
            exclude_file_path=str(image_path),
            area=area,
        )
