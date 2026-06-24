import argparse
import logging

from pathlib import Path

import lancedb

from PIL import Image
from tqdm import tqdm

from src.core.app_config import AppConfig, get_app_config
from src.core.storage import artifacts_for_bag
from data_extraction_lib.artifacts import (
    EmbedderStamp,
    IndexManifest,
    Metadata,
    PqParams,
    RegionStamp,
)
from data_extraction_lib.embedding import FrameEmbedder, create_embedder

from src.core.embedding_settings import embedding_settings_from_config

logger = logging.getLogger(__name__)


class Indexer:
    def __init__(
        self,
        bag_path: str,
        config: AppConfig | None = None,
        embedder: FrameEmbedder | None = None,
        region_indexer=None,
    ):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self._artifacts = artifacts_for_bag(self.bag_path)
        self.artifact_dir = self._artifacts.dir
        self.metadata_path = self._artifacts.metadata_path
        self.db_path = self._artifacts.lancedb_dir

        if not self.metadata_path.exists():
            raise FileNotFoundError(
                f"Metadata not found at {self.metadata_path}. Run extraction first."
            )

        self.batch_size = app_config.ingestion.batch_size
        # The embedder is normally injected (shared singleton). Fall back to building
        # one from config for standalone/CLI use.
        self.embedder = (
            embedder
            if embedder is not None
            else create_embedder(embedding_settings_from_config(app_config))
        )
        self._region_indexer = region_indexer

    def build_index(self):
        """Embeds frames via the active embedder, writes LanceDB, and stamps metadata."""
        # Clear any stale completion marker up-front so a failed/partial run can
        # never read as indexed; it is rewritten only on the success path below.
        IndexManifest.delete(self._artifacts)

        logger.info("Loading metadata from %s...", self.metadata_path)
        meta = Metadata.load(self._artifacts)

        if meta.schema_version < Metadata.SCHEMA_VERSION:
            logger.warning(
                "Metadata schema v%d is older than current v%d; re-extract + re-index required.",
                meta.schema_version,
                Metadata.SCHEMA_VERSION,
            )

        frames = meta.frames
        if not frames:
            logger.warning("No frames found to index.")
            return

        db = lancedb.connect(str(self.db_path))
        table_name = "frames"
        data_to_insert = []
        region_active = self._region_indexer is not None and "dense" in self.embedder.capabilities

        logger.info(
            "Generating embeddings for %s frames with %s (region=%s)...",
            len(frames), self.embedder.name, region_active,
        )

        if region_active:
            # Fused fresh-index loop: one trunk pass per frame → CLS to LanceDB,
            # value-attention grid to the region indexer.
            for frame_id, frame in enumerate(tqdm(frames)):
                abs_path = str(self.artifact_dir / frame["file_path"])
                try:
                    with Image.open(abs_path) as image:
                        img = image.convert("RGB")
                except (FileNotFoundError, OSError):
                    logger.warning(
                        "Skipping unreadable frame %s during indexing", abs_path, exc_info=True
                    )
                    continue
                (cls, grid), = self.embedder.embed_dense_value([img])
                data_to_insert.append(
                    {
                        "timestamp_ns": frame["timestamp_ns"],
                        "file_path": abs_path,
                        "topic": frame["topic"],
                        "vector": cls.tolist(),
                    }
                )
                self._region_indexer.add_frame(frame_id, grid)
        else:
            for i in tqdm(range(0, len(frames), self.batch_size)):
                batch_meta = frames[i : i + self.batch_size]
                valid_batch_meta = []
                images = []
                for frame in batch_meta:
                    abs_path = str(self.artifact_dir / frame["file_path"])
                    try:
                        with Image.open(abs_path) as image:
                            images.append(image.convert("RGB"))
                        valid_batch_meta.append({**frame, "_abs_path": abs_path})
                    except (FileNotFoundError, OSError):
                        logger.warning(
                            "Skipping unreadable frame %s during indexing", abs_path, exc_info=True
                        )

                if not images:
                    continue

                embeddings = self.embedder.embed_images(images)

                for frame, emb in zip(valid_batch_meta, embeddings):
                    data_to_insert.append(
                        {
                            "timestamp_ns": frame["timestamp_ns"],
                            "file_path": frame["_abs_path"],
                            "topic": frame["topic"],
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
        meta.embedder = EmbedderStamp(name=self.embedder.name, dim=self.embedder.embedding_dim)
        meta.save(self._artifacts)

        if region_active:
            patch_count = self._region_indexer.finalize()
            pq = self._region_indexer.pq_params
            meta.region_index = RegionStamp(
                embedder_name=self.embedder.name,
                dim=self.embedder.embedding_dim,
                feature="value-attention",
                encode_long_side=int(self.embedder.encode_long_side),
                pq=PqParams(m=int(pq["m"]), nbits=int(pq["nbits"])),
                patch_count=patch_count,
            )
            meta.save(self._artifacts)

        logger.info(
            "Index built! %d records, stamped %s (dim=%d).",
            len(data_to_insert),
            self.embedder.name,
            self.embedder.embedding_dim,
        )

        # Final step of a successful run: the dedicated completion marker.
        cameras = sorted({frame["topic"] for frame in frames if "topic" in frame})
        IndexManifest(
            embedder=EmbedderStamp(name=self.embedder.name, dim=self.embedder.embedding_dim),
            frame_count=len(data_to_insert),
            cameras=cameras,
            region_index=region_active,
        ).write(self._artifacts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Index frames from a bag into LanceDB.")
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    Indexer(args.bag_path).build_index()
