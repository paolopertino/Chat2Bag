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