import io
import logging

from pathlib import Path
from typing import List

import torch
import lancedb

from PIL import Image
from transformers import AutoProcessor, AutoModel

from src.core.app_config import AppConfig, get_app_config
from src.core.storage import resolve_artifact_path

logger = logging.getLogger(__name__)


class GlobalSearcher:
    def __init__(
        self,
        config: AppConfig | None = None,
        model=None,
        processor=None,
        device: str | None = None,
    ):
        app_config = config or get_app_config()

        self.model_name = app_config.models.embedding_model
        self.temporal_dedup_window_ns = int(
            max(0.0, app_config.search.temporal_dedup_window_sec) * 1_000_000_000
        )
        self.device = device if device is not None else (
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        logger.info("Loading %s into VRAM (%s)...", self.model_name, self.device)
        self.model: AutoModel = model.to(self.device)
        self.processor: AutoProcessor = processor
        self.model.eval()

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
                if abs(candidate_ts - selected_ts) <= self.temporal_dedup_window_ns // 2: # Window is centered around each result, so divide by 2 for comparison.
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
    ) -> list[dict]:
        """Searches a query vector across one or more bag indices."""

        exclude_path = None
        if exclude_file_path:
            exclude_path = str(Path(exclude_file_path).expanduser().resolve())

        all_results = []
        for bag_path in bag_paths:
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
            results = (
                table.search(query_vector).metric("cosine").limit(fetch_limit).to_list()
            )
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

    def _embed_image(self, image: Image.Image) -> list[float]:
        inputs = self.processor(images=[image], return_tensors="pt").to(self.device)

        with torch.no_grad():
            inputs = inputs.to(self.device)
            self.model.to(self.device)
            image_features = self.model.get_image_features(**inputs).pooler_output
            image_embeddings = image_features / image_features.norm(dim=-1, keepdim=True)
            return image_embeddings.cpu().numpy().tolist()[0]

    def search(self, query: str, bag_paths: List[str], top_k: int = 5):
        """Embeds text once and searches across multiple LanceDB indices."""

        logger.info("Embedding query: '%s'", query)
        inputs = self.processor(
            text=[query],
            padding="max_length",
            truncation=True,
            max_length=64,
            return_tensors="pt",
        ).to(self.device)

        with torch.no_grad():
            inputs = inputs.to(self.device)
            self.model.to(self.device)
            text_features = self.model.get_text_features(**inputs)
            text_embeddings = (
                text_features.pooler_output
                / text_features.pooler_output.norm(dim=-1, keepdim=True)
            )
            query_vector = text_embeddings.cpu().numpy().tolist()[0]

        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k)

    def search_by_image_bytes(self, image_bytes: bytes, bag_paths: List[str], top_k: int = 5):
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        query_vector = self._embed_image(image=image)
        return self._search_vector(query_vector=query_vector, bag_paths=bag_paths, top_k=top_k)

    def search_similar_by_file_path(
        self,
        file_path: str,
        bag_paths: List[str],
        top_k: int = 5,
    ):
        image_path = Path(file_path).expanduser().resolve()
        image = Image.open(image_path).convert("RGB")
        query_vector = self._embed_image(image=image)
        return self._search_vector(
            query_vector=query_vector,
            bag_paths=bag_paths,
            top_k=top_k,
            exclude_file_path=str(image_path),
        )
