import logging

from pathlib import Path
from typing import List

import torch
import lancedb

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
    ):
        app_config = config or get_app_config()

        self.model_name = app_config.models.embedding_model
        self.device = "cpu"  # "cuda" if torch.cuda.is_available() else "cpu"

        logger.info("Loading %s into VRAM (%s)...", self.model_name, self.device)
        self.model: AutoModel = model.to(self.device)
        self.processor: AutoProcessor = processor
        self.model.eval()

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

        all_results = []
        for bag_path in bag_paths:
            db_path = resolve_artifact_path(bag_path=Path(bag_path)) / "lancedb"
            if not db_path.exists():
                logger.warning(
                    "Skipping %s: no LanceDB index found.", Path(bag_path).name
                )
                continue

            db = lancedb.connect(str(db_path))
            table = db.open_table("frames")

            results = table.search(query_vector).metric("cosine").limit(top_k).to_list()
            for res in results:
                res["bag_path"] = str(Path(bag_path).resolve())
                res["source_bag"] = Path(bag_path).name
                res["similarity_score"] = 1.0 - res["_distance"]
                res.pop("_distance", None)
                res.pop("vector", None)
                all_results.append(res)

        all_results.sort(key=lambda x: x["similarity_score"], reverse=True)
        return all_results[:top_k]
