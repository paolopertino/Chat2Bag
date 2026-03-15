import gc
import json
import logging
import yaml

from pathlib import Path

import torch
import lancedb
import pyarrow as pa

from PIL import Image
from transformers import AutoProcessor, AutoModel
from tqdm import tqdm

logger = logging.getLogger(__name__)


class Indexer:
    def __init__(
        self,
        bag_path: str,
        config_path: str = "config/settings.yaml",
        model=None,
        processor=None,
    ):
        self.bag_path = Path(bag_path)

        with open(config_path, "r") as f:
            self.config = yaml.safe_load(f)

        self.model_name = self.config["models"]["embedding_model"]
        self.artifact_dir = self.bag_path / self.config["storage"]["artifact_dir"]
        self.metadata_path = self.artifact_dir / "metadata.json"
        self.db_path = self.artifact_dir / "lancedb"

        if not self.metadata_path.exists():
            raise FileNotFoundError(
                f"Metadata not found at {self.metadata_path}. Run extraction first."
            )

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.batch_size = self.config["ingestion"]["batch_size"]

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
        with open(self.metadata_path, "r") as f:
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
            images = [
                Image.open(meta["file_path"]).convert("RGB") for meta in batch_meta
            ]
            inputs = self.processor(images=images, return_tensors="pt").to(self.device)

            with torch.no_grad():
                image_features = self.model.get_image_features(**inputs)
                # L2 Normalize the embeddings for later cosine similarity search
                embeddings = (
                    image_features.pooler_output
                    / image_features.pooler_output.norm(dim=-1, keepdim=True)
                )
                embeddings = embeddings.cpu().numpy().tolist()

            for meta, emb in zip(batch_meta, embeddings):
                data_to_insert.append(
                    {
                        "timestamp_ns": meta["timestamp_ns"],
                        "file_path": meta["file_path"],
                        "topic": metadata["topic"],
                        "vector": emb,
                    }
                )

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
    example_path = "/home/paolopertino/adehome/aida_code/bags/2025-11-05_19-00_normal"  # "/home/paolopertino/adehome/aida_code/bags/2025-02-28_10-17_sensors_raw"
    indexer = Indexer(example_path)
    indexer.build_index()
