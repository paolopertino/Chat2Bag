class SearchService:
    def __init__(self, searcher):
        self._searcher = searcher

    def search(self, query: str, bag_paths: list[str], top_k: int) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")

        return self._searcher.search(
            query=query,
            bag_paths=bag_paths,
            top_k=top_k,
        )

    def search_by_image(self, image_bytes: bytes, bag_paths: list[str], top_k: int) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not image_bytes:
            raise ValueError("Image payload is empty.")

        return self._searcher.search_by_image_bytes(
            image_bytes=image_bytes,
            bag_paths=bag_paths,
            top_k=top_k,
        )

    def search_similar(self, file_path: str, bag_paths: list[str], top_k: int) -> list[dict]:
        if not bag_paths:
            raise ValueError("Must provide at least one bag path.")
        if not file_path.strip():
            raise ValueError("file_path must not be empty.")

        return self._searcher.search_similar_by_file_path(
            file_path=file_path,
            bag_paths=bag_paths,
            top_k=top_k,
        )