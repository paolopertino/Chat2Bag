import io
from pathlib import Path

from PIL import Image


class RegionSearchService:
    def __init__(self, searcher):
        self._searcher = searcher

    def _require_bags(self, bag_paths):
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")

    def search_by_text(self, text: str, bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not text.strip():
            raise ValueError("Text query must not be empty.")
        return self._searcher.search_by_text(text=text, bag_paths=bag_paths, top_k=top_k)

    def search_by_frame(self, support_file_path: str, points: list[dict], bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not support_file_path.strip():
            raise ValueError("support_file_path must not be empty.")
        image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
        return self._searcher.search_by_points(
            image=image, points=points, bag_paths=bag_paths, top_k=top_k,
            exclude_file_path=support_file_path,
        )

    def search_by_image(self, image_bytes: bytes, points: list[dict], bag_paths: list[str], top_k: int) -> list[dict]:
        self._require_bags(bag_paths)
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self._searcher.search_by_points(
            image=image, points=points, bag_paths=bag_paths, top_k=top_k,
        )
