import argparse
import json
import logging

from pathlib import Path

import ollama

from src.core.app_config import AppConfig, get_app_config
from src.core.storage import resolve_artifact_path

logger = logging.getLogger(__name__)


class VideoChat:
    def __init__(self, bag_path: str, config: AppConfig | None = None):
        self.bag_path = Path(bag_path)
        app_config = config or get_app_config()

        self.model_name = app_config.models.video_vlm
        self.artifact_dir = resolve_artifact_path(bag_path=self.bag_path)
        self.metadata_path = self.artifact_dir / "metadata.json"

        if not self.metadata_path.exists():
            raise FileNotFoundError("Metadata not found. Run indexer first.")

    def chat_with_clip(
        self,
        start_timestamp_ns: int,
        duration_sec: int,
        query: str,
        max_frames: int = 8,
    ):
        """Fetches a temporal window of frames and chats with them via Ollama."""
        logger.info("Loading metadata to find frames for a %ss window...", duration_sec)

        with self.metadata_path.open("r", encoding="utf-8") as f:
            metadata = json.load(f)

        duration_ns = int(duration_sec * 1e9)
        end_timestamp_ns = start_timestamp_ns + duration_ns

        # Filter frames within the time window
        window_frames = [
            f
            for f in metadata["frames"]
            if start_timestamp_ns <= f["timestamp_ns"] <= end_timestamp_ns
        ]

        if not window_frames:
            logger.warning("No frames found in that time window.")
            return

        # Subsampling if we have more frames than max_frames to avoid overloading GPU memory.
        # If we have 20 frames, and max_frames is 8, we take every ~2nd or 3rd frame
        step = max(1, len(window_frames) // max_frames)
        sampled_frames = window_frames[::step][:max_frames]

        image_paths = [f["file_path"] for f in sampled_frames]
        logger.info("Selected %s frames for the deep dive.", len(image_paths))

        logger.info(
            "Loading %s into VRAM via Ollama and analyzing sequence...", self.model_name
        )

        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[
                    {
                        "role": "user",
                        "content": f"These images represent a sequential video of a driving scene. {query}",
                        "images": image_paths,
                    }
                ],
                keep_alive=0,
            )
        except Exception as exc:
            logger.exception("Ollama request failed while analyzing %s", self.bag_path)
            raise RuntimeError(
                "Video chat service is unavailable. Check that Ollama is running."
            ) from exc

        logger.info("\n--- VLM Analysis ---")
        logger.info(response["message"]["content"])
        return response["message"]["content"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test VideoChat with a specific clip.")
    parser.add_argument(
        "--bag_path",
        type=str,
        required=True,
        help="Path to the bag directory containing the artifact/metadata.json",
    )
    parser.add_argument(
        "--start_ns",
        type=int,
        required=True,
        help="Start timestamp in nanoseconds for the clip to chat with.",
    )
    args = parser.parse_args()
    chat = VideoChat(args.bag_path)

    # Example: User selected a timestamp from the search results, wants to see the next 5 seconds
    # Set start_ns with a real timestamp from your test run
    print(
        chat.chat_with_clip(
            start_timestamp_ns=args.start_ns,
            duration_sec=5,
            query="Is there a red car in the sequence?",
            max_frames=20,
        )
    )
