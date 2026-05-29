import argparse
import json
import logging

from pathlib import Path

import lancedb

from PIL import Image
from tqdm import tqdm

from src.core.app_config import AppConfig, get_app_config
from src.core.index_stamp import write_embedder_stamp
from src.core.schema_versions import METADATA_SCHEMA_VERSION
from src.core.storage import resolve_artifact_path
from src.embedding import FrameEmbedder, create_embedder

logger = logging.getLogger(__name__)


class Indexer:
    def __init__(
        self,
        bag_path: str,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
    ):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.artifact_dir = resolve_artifact_path(bag_path=self.bag_path)
        self.metadata_path = self.artifact_dir / "metadata.json"
        self.db_path = self.artifact_dir / "lancedb"

        if not self.metadata_path.exists():
            raise FileNotFoundError(
                f"Metadata not found at {self.metadata_path}. Run extraction first."
            )

        self.batch_size = app_config.ingestion.batch_size
        # The embedder is normally injected (shared singleton). Fall back to building
        # one from config for standalone/CLI use.
        self.embedder = embedder if embedder is not None else create_embedder(app_config)

    def build_index(self):
        """Embeds frames via the active embedder, writes LanceDB, and stamps metadata."""
        logger.info("Loading metadata from %s...", self.metadata_path)
        with self.metadata_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)

        schema_version = metadata.get("schema_version", 1)
        if schema_version < METADATA_SCHEMA_VERSION:
            logger.warning(
                "Metadata schema v%d is older than current v%d; re-extract + re-index required.",
                schema_version,
                METADATA_SCHEMA_VERSION,
            )

        frames = metadata.get("frames", [])
        if not frames:
            logger.warning("No frames found to index.")
            return

        db = lancedb.connect(str(self.db_path))
        table_name = "frames"
        data_to_insert = []

        logger.info(
            "Generating embeddings for %s frames with %s...", len(frames), self.embedder.name
        )
        for i in tqdm(range(0, len(frames), self.batch_size)):
            batch_meta = frames[i : i + self.batch_size]
            valid_batch_meta = []
            images = []
            for meta in batch_meta:
                abs_path = str(self.artifact_dir / meta["file_path"])
                try:
                    with Image.open(abs_path) as image:
                        images.append(image.convert("RGB"))
                    valid_batch_meta.append({**meta, "_abs_path": abs_path})
                except (FileNotFoundError, OSError):
                    logger.warning(
                        "Skipping unreadable frame %s during indexing", abs_path, exc_info=True
                    )

            if not images:
                continue

            embeddings = self.embedder.embed_images(images)

            for meta, emb in zip(valid_batch_meta, embeddings):
                data_to_insert.append(
                    {
                        "timestamp_ns": meta["timestamp_ns"],
                        "file_path": meta["_abs_path"],
                        "topic": meta["topic"],
                        "vector": emb.tolist(),
                    }
                )

        if not data_to_insert:
            logger.warning("No valid frames were embedded; skipping LanceDB write.")
            return

        logger.info("Writing embeddings to LanceDB...")
        if table_name in db.list_tables():
            logger.info("Existing index found; overwriting table.")
        db.create_table(table_name, data=data_to_insert, mode="overwrite")

        # Stamp the index with the embedder identity so the searcher can detect mismatches.
        write_embedder_stamp(
            self.metadata_path, name=self.embedder.name, dim=self.embedder.embedding_dim
        )

        logger.info(
            "Index built! %d records, stamped %s (dim=%d).",
            len(data_to_insert),
            self.embedder.name,
            self.embedder.embedding_dim,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index frames from a bag into LanceDB.")
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    Indexer(args.bag_path).build_index()
