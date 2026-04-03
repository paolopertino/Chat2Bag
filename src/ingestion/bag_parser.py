import argparse
import json
import logging

from pathlib import Path

import cv2

from rosbags.rosbag2 import Reader
from rosbags.typesys import get_typestore, Stores
from rosbags.image import message_to_cvimage

from src.core.app_config import AppConfig, get_app_config
from src.core.schema_versions import METADATA_SCHEMA_VERSION
from src.core.storage import resolve_artifact_path

logger = logging.getLogger(__name__)


class BagParser:
    def __init__(self, bag_path: str, config: AppConfig | None = None):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.topic = app_config.ingestion.camera_topic
        self.fps = app_config.ingestion.sampling_fps
        self.max_size = app_config.ingestion.max_image_size

        # Set up the artifact directories
        self.artifact_dir = resolve_artifact_path(bag_path=self.bag_path)

        self.thumbnail_dir = self.artifact_dir / "thumbnails"
        self.thumbnail_dir.mkdir(parents=True, exist_ok=True)

        self.typestore = get_typestore(Stores.LATEST)

    def extract_frames(self):
        """Reads the bag and extracts downsampled frames to the artifact folder."""
        logger.info("Opening bag: %s", self.bag_path.name)

        metadata = {
            "schema_version": METADATA_SCHEMA_VERSION,
            "bag_name": self.bag_path.name,
            "topic": self.topic,
            "frames": [],
        }

        # Calculate the nanosecond interval based on desired FPS
        interval_ns = int((1.0 / self.fps) * 1e9)
        last_saved_ns = 0
        saved_count = 0

        with Reader(self.bag_path) as reader:
            connections = [x for x in reader.connections if x.topic == self.topic]
            if not connections:
                raise ValueError(
                    f"Topic {self.topic} not found in {self.bag_path.name}"
                )

            logger.info(
                "Extracting frames at %s FPS. This might take a moment...", self.fps
            )

            for connection, timestamp_ns, rawdata in reader.messages(
                connections=connections
            ):
                if (timestamp_ns - last_saved_ns) >= interval_ns:
                    try:
                        msg = self.typestore.deserialize_cdr(
                            rawdata, connection.msgtype
                        )
                        cv_img = message_to_cvimage(msg, "bgr8")

                        # Resize to save space and VRAM
                        cv_img_resized = cv2.resize(
                            cv_img, self.max_size, interpolation=cv2.INTER_AREA
                        )

                        frame_filename = f"frame_{timestamp_ns}.jpg"
                        frame_path = self.thumbnail_dir / frame_filename
                        if not cv2.imwrite(str(frame_path), cv_img_resized):
                            raise ValueError(f"Failed to write frame to {frame_path}")

                        metadata["frames"].append(
                            {
                                "timestamp_ns": timestamp_ns,
                                "file_path": str(frame_path.relative_to(self.artifact_dir)),
                            }
                        )

                        last_saved_ns = timestamp_ns
                        saved_count += 1
                    except (ValueError, OSError, RuntimeError, cv2.error):
                        logger.warning(
                            "Skipping frame at %s in %s due to extraction error",
                            timestamp_ns,
                            self.bag_path,
                            exc_info=True,
                        )
                        continue

        # Write the metadata mapping file
        metadata_path = self.artifact_dir / "metadata.json"
        with metadata_path.open("w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=4)

        logger.info(
            "Extraction complete! Saved %s frames to %s",
            saved_count,
            self.thumbnail_dir,
        )
        return metadata_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test extracting frames from a bag.")
    parser.add_argument("bag_path", type=str, help="Path to the bag directory.")
    args = parser.parse_args()
    parser = BagParser(args.bag_path)
    parser.extract_frames()
