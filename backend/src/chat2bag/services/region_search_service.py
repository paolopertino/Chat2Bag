import io
from pathlib import Path

from PIL import Image

from data_extraction_lib.index import DenseSearch

from chat2bag.core.app_config import AppConfig
from chat2bag.core.storage import artifacts_for_bag
from chat2bag.geo.area_payload import parse_area_payload
from chat2bag.services.result_format import to_response


class RegionSearchService:
    def __init__(self, dense_search: DenseSearch, config: AppConfig) -> None:
        self._dense_search = dense_search
        self._config = config

    def _require_bags(self, bag_paths: list[str]) -> None:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")

    def _resolve(self, bag_paths: list[str]) -> tuple[list, dict[str, str]]:
        """Resolve bag paths to BagArtifacts and build the dir-to-path mapping."""
        artifacts = [artifacts_for_bag(Path(bp)) for bp in bag_paths]
        bag_path_by_dir = {str(a.dir): bp for a, bp in zip(artifacts, bag_paths)}
        return artifacts, bag_path_by_dir

    def _window_ns(self) -> int:
        return int(self._config.search.temporal_dedup_window_sec * 1_000_000_000)

    def search_by_text(
        self,
        text: str,
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        self._require_bags(bag_paths)
        if not text.strip():
            raise ValueError("Text query must not be empty.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        results = self._dense_search.search_text(
            text, artifacts, top_k=top_k, window_ns=self._window_ns(), area=area_obj
        )
        return to_response(results, bag_path_by_dir)

    def search_by_frame(
        self,
        support_file_path: str,
        points: list[dict],
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        self._require_bags(bag_paths)
        if not support_file_path.strip():
            raise ValueError("support_file_path must not be empty.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
        results = self._dense_search.search_points(
            image,
            points,
            artifacts,
            top_k=top_k,
            window_ns=self._window_ns(),
            area=area_obj,
            exclude_file_path=str(Path(support_file_path).expanduser().resolve()),
        )
        return to_response(results, bag_path_by_dir)

    def search_by_image(
        self,
        image_bytes: bytes,
        points: list[dict],
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        self._require_bags(bag_paths)
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        results = self._dense_search.search_points(
            image, points, artifacts, top_k=top_k, window_ns=self._window_ns(), area=area_obj
        )
        return to_response(results, bag_path_by_dir)

    def heatmap_by_text(self, text: str, target_file_path: str) -> dict:
        if not text.strip():
            raise ValueError("Text query must not be empty.")
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        return self._dense_search.heatmap_for_text(text, Image.open(target_file_path))

    def heatmap_by_frame(
        self, support_file_path: str, points: list[dict], target_file_path: str
    ) -> dict:
        if not support_file_path.strip():
            raise ValueError("support_file_path must not be empty.")
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        image = Image.open(Path(support_file_path).expanduser().resolve()).convert("RGB")
        return self._dense_search.heatmap_for_points(image, points, Image.open(target_file_path))

    def heatmap_by_image(
        self, image_bytes: bytes, points: list[dict], target_file_path: str
    ) -> dict:
        if not target_file_path.strip():
            raise ValueError("target_file_path must not be empty.")
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self._dense_search.heatmap_for_points(image, points, Image.open(target_file_path))
