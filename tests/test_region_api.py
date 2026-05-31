import pytest

from src.services.region_search_service import RegionSearchService


class _StubSearcher:
    def search_by_text(self, text, bag_paths, top_k):
        return [{"ok": True, "text": text, "n": len(bag_paths), "top_k": top_k}]

    def search_by_points(self, image, points, bag_paths, top_k, exclude_file_path=None):
        return [{"points": len(points), "exclude": exclude_file_path}]


def test_service_rejects_empty_bag_paths():
    svc = RegionSearchService(_StubSearcher())
    with pytest.raises(ValueError):
        svc.search_by_text(text="x", bag_paths=[], top_k=5)


def test_service_delegates_text():
    svc = RegionSearchService(_StubSearcher())
    out = svc.search_by_text(text="car", bag_paths=["/b"], top_k=3)
    assert out[0]["text"] == "car" and out[0]["top_k"] == 3
