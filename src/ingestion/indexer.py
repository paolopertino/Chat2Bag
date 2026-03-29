import argparse
import json
import logging

from pathlib import Path

import torch
import lancedb

from PIL import Image
from transformers import AutoProcessor, AutoModel
from tqdm import tqdm

from src.core.app_config import AppConfig, get_app_config

logger = logging.getLogger(__name__)


class Indexer:
    def __init__(
        self,
        bag_path: str,
        config: AppConfig | None = None,
        model=None,
        processor=None,
    ):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.model_name = app_config.models.embedding_model
        self.artifact_dir = self.bag_path / app_config.storage.artifact_dir
        self.metadata_path = self.artifact_dir / "metadata.json"
        self.db_path = self.artifact_dir / "lancedb"

        if not self.metadata_path.exists():
            raise FileNotFoundError(
                f"Metadata not found at {self.metadata_path}. Run extraction first."
            )

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.batch_size = app_config.ingestion.batch_size

        self.model = (
            model.to(self.device)
            if model is not None
            else AutoModel.from_pretrained(self.model_name).to(self.device)
        )
        self.processor = (
            processor
            if processor is not None
            else AutoProcessor.from_pretrained(self.model_name)
        )

    def build_index(self):
        """Loads SigLIP 2, embeds frames, writes to LanceDB, and frees VRAM."""
        logger.info("Loading metadata from %s...", self.metadata_path)
        with self.metadata_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)

        frames = metadata["frames"]
        if not frames:
            logger.warning("No frames found to index.")
            return

        logger.info("Loading %s into GPU (%s)...", self.model_name, self.device)
        self.model.to(self.device)
        self.model.eval()

        db = lancedb.connect(str(self.db_path))
        table_name = "frames"

        data_to_insert = []

        logger.info("Generating embeddings for %s frames...", len(frames))
        for i in tqdm(range(0, len(frames), self.batch_size)):
            batch_meta = frames[i : i + self.batch_size]
            valid_batch_meta = []
            images = []
            for meta in batch_meta:
                try:
                    with Image.open(meta["file_path"]) as image:
                        images.append(image.convert("RGB"))
                    valid_batch_meta.append(meta)
                except (FileNotFoundError, OSError):
                    logger.warning(
                        "Skipping unreadable frame %s during indexing",
                        meta["file_path"],
                        exc_info=True,
                    )

            if not images:
                continue

            inputs = self.processor(images=images, return_tensors="pt").to(self.device)

            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                # L2 Normalize the embeddings for later cosine similarity search
                embeddings = (
                    image_features.pooler_output
                    / image_features.pooler_output.norm(dim=-1, keepdim=True)
                )
                embeddings = embeddings.cpu().numpy().tolist()

            for meta, emb in zip(valid_batch_meta, embeddings):
                data_to_insert.append(
                    {
                        "timestamp_ns": meta["timestamp_ns"],
                        "file_path": meta["file_path"],
                        "topic": metadata["topic"],
                        "vector": emb,
                    }
                )

        if not data_to_insert:
            logger.warning("No valid frames were embedded; skipping LanceDB write.")
            return

        logger.info("Writing embeddings to LanceDB...")
        if table_name in db.list_tables():
            table = db.open_table(table_name)
            table.add(data_to_insert)
        else:
            table = db.create_table(table_name, data=data_to_insert)

        logger.info(
            "Index successfully built! Total records in table: %s (Showing sample limit)",
            len(table.search().limit(10).to_list()),
        )

        self.model.cpu()
        if self.device == "cuda":
            torch.cuda.empty_cache()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test Index frames from a bag into LanceDB."
    )
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    indexer = Indexer(args.bag_path)
    indexer.build_index()
