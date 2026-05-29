import argparse
import json
import logging
import re

from pathlib import Path

import cv2

from rosbags.rosbag2 import Reader
from rosbags.typesys import get_typestore, Stores
from rosbags.image import message_to_cvimage

from src.core.app_config import AppConfig, get_app_config
from src.core.schema_versions import METADATA_SCHEMA_VERSION
from src.core.storage import resolve_artifact_path

logger = logging.getLogger(__name__)


def camera_slug(topic: str) -> str:
    """Filesystem-safe, stable slug for a ROS topic (used as a thumbnail subdir).

    Collisions are theoretically possible for topics differing only in punctuation;
    acceptable for ROS topic naming.
    """
    return re.sub(r"[^A-Za-z0-9]+", "_", topic).strip("_")


def resize_long_side(cv_img, long_side: int):
    """Aspect-preserving downscale so the longer edge == long_side. Never upscales."""
    height, width = cv_img.shape[:2]
    longest = max(height, width)
    if longest <= long_side:
        return cv_img
    scale = long_side / float(longest)
    new_w = max(1, int(round(width * scale)))
    new_h = max(1, int(round(height * scale)))
    return cv2.resize(cv_img, (new_w, new_h), interpolation=cv2.INTER_AREA)


class BagParser:
    def __init__(self, bag_path: str, config: AppConfig | None = None):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.topics = tuple(app_config.ingestion.camera_topics)
        self.fps = app_config.ingestion.sampling_fps
        self.long_side = app_config.ingestion.long_side

        # Set up the artifact directories
        self.artifact_dir = resolve_artifact_path(bag_path=self.bag_path)

        self.thumbnail_dir = self.artifact_dir / "thumbnails"
        self.thumbnail_dir.mkdir(parents=True, exist_ok=True)

        self.typestore = get_typestore(Stores.LATEST)

    def extract_frames(self):
        """Reads the bag and extracts aspect-preserving frames per camera topic."""
        logger.info("Opening bag: %s", self.bag_path.name)

        metadata = {
            "schema_version": METADATA_SCHEMA_VERSION,
            "bag_name": self.bag_path.name,
            "cameras": [],
            "embedder": None,
            "frames": [],
        }

        # Sampling interval, tracked independently per camera topic.
        interval_ns = int((1.0 / self.fps) * 1e9)
        last_saved_ns: dict[str, int] = {}
        saved_count = 0

        with Reader(self.bag_path) as reader:
            connections = [c for c in reader.connections if c.topic in self.topics]
            present_topics = sorted({c.topic for c in connections})
            if not present_topics:
                raise ValueError(
                    f"None of the configured camera topics {list(self.topics)} "
                    f"found in {self.bag_path.name}"
                )
            metadata["cameras"] = present_topics

            for topic in present_topics:
                (self.thumbnail_dir / camera_slug(topic)).mkdir(parents=True, exist_ok=True)

            logger.info(
                "Extracting frames at %s FPS from %d camera(s): %s",
                self.fps,
                len(present_topics),
                present_topics,
            )

            for connection, timestamp_ns, rawdata in reader.messages(connections=connections):
                topic = connection.topic
                prev = last_saved_ns.get(topic)
                if prev is not None and (timestamp_ns - prev) < interval_ns:
                    continue
                try:
                    msg = self.typestore.deserialize_cdr(rawdata, connection.msgtype)
                    cv_img = message_to_cvimage(msg, "bgr8")
                    cv_img_resized = resize_long_side(cv_img, self.long_side)

                    slug = camera_slug(topic)
                    frame_path = self.thumbnail_dir / slug / f"frame_{timestamp_ns}.jpg"
                    if not cv2.imwrite(str(frame_path), cv_img_resized):
                        raise ValueError(f"Failed to write frame to {frame_path}")

                    metadata["frames"].append(
                        {
                            "timestamp_ns": timestamp_ns,
                            "topic": topic,
                            "file_path": str(frame_path.relative_to(self.artifact_dir)),
                        }
                    )
                    last_saved_ns[topic] = timestamp_ns
                    saved_count += 1
                except (ValueError, OSError, RuntimeError, cv2.error):
                    logger.warning(
                        "Skipping frame at %s (%s) in %s due to extraction error",
                        timestamp_ns,
                        topic,
                        self.bag_path,
                        exc_info=True,
                    )
                    continue

        # Write the metadata mapping file
        metadata_path = self.artifact_dir / "metadata.json"
        with metadata_path.open("w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=4)

        logger.info(
            "Extraction complete! Saved %s frames across %d cameras to %s",
            saved_count,
            len(metadata["cameras"]),
            self.thumbnail_dir,
        )
        return metadata_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test extracting frames from a bag.")
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    parser = BagParser(args.bag_path)
    parser.extract_frames()
