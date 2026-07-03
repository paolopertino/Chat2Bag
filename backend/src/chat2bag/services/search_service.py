import io
from pathlib import Path

from PIL import Image

from data_extraction_lib.index import GlobalSearch

from chat2bag.core.app_config import AppConfig
from chat2bag.core.storage import artifacts_for_bag
from chat2bag.geo.area_payload import parse_area_payload
from chat2bag.services.result_format import to_response


class SearchService:
    def __init__(self, global_search: GlobalSearch, config: AppConfig) -> None:
        self._global_search = global_search
        self._config = config

    def _resolve(self, bag_paths: list[str]) -> tuple[list, dict[str, str]]:
        """Resolve bag paths to BagArtifacts and build the dir-to-path mapping."""
        artifacts = [artifacts_for_bag(Path(bp)) for bp in bag_paths]
        bag_path_by_dir = {str(a.dir): bp for a, bp in zip(artifacts, bag_paths)}
        return artifacts, bag_path_by_dir

    def _window_ns(self) -> int:
        return int(self._config.search.temporal_dedup_window_sec * 1_000_000_000)

    def search(
        self,
        query: str,
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        results = self._global_search.search_text(
            query, artifacts, top_k=top_k, window_ns=self._window_ns(), area=area_obj
        )
        return to_response(results, bag_path_by_dir)

    def search_by_image(
        self,
        image_bytes: bytes,
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not image_bytes:
            raise ValueError("Image payload is empty.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        image = Image.open(io.BytesIO(image_bytes))
        results = self._global_search.search_image(
            image, artifacts, top_k=top_k, window_ns=self._window_ns(), area=area_obj
        )
        return to_response(results, bag_path_by_dir)

    def search_similar(
        self,
        file_path: str,
        bag_paths: list[str],
        top_k: int,
        area: dict | None = None,
    ) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not file_path.strip():
            raise ValueError("file_path must not be empty.")
        artifacts, bag_path_by_dir = self._resolve(bag_paths)
        area_obj = parse_area_payload(area)
        image = Image.open(file_path)
        results = self._global_search.search_similar(
            image,
            artifacts,
            top_k=top_k,
            window_ns=self._window_ns(),
            area=area_obj,
            exclude_file_path=str(Path(file_path).expanduser().resolve()),
        )
        return to_response(results, bag_path_by_dir)
