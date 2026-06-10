from src.api.search_routes import (
    RegionByFrameRequest,
    RegionByTextRequest,
    SearchRequest,
    SimilarSearchRequest,
)


def test_top_k_defaults_are_100():
    assert SearchRequest(query="x", bag_paths=[]).top_k == 100
    assert RegionByTextRequest(text="x", bag_paths=[]).top_k == 100
    assert RegionByFrameRequest(
        support_file_path="/f.jpg", points=[{"x": 0.5, "y": 0.5}], bag_paths=[]
    ).top_k == 100
    assert SimilarSearchRequest(file_path="/f.jpg", bag_paths=[]).top_k == 100


def test_top_k_allows_up_to_500():
    assert SearchRequest(query="x", bag_paths=[], top_k=500).top_k == 500
    assert RegionByTextRequest(text="x", bag_paths=[], top_k=500).top_k == 500
    assert RegionByFrameRequest(
        support_file_path="/f.jpg",
        points=[{"x": 0.5, "y": 0.5}],
        bag_paths=[],
        top_k=500,
    ).top_k == 500
    assert SimilarSearchRequest(file_path="/f.jpg", bag_paths=[], top_k=500).top_k == 500


def test_top_k_rejects_above_500():
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchRequest(query="x", bag_paths=[], top_k=501)
    with pytest.raises(ValidationError):
        RegionByTextRequest(text="x", bag_paths=[], top_k=501)
    with pytest.raises(ValidationError):
        RegionByFrameRequest(
            support_file_path="/f.jpg",
            points=[{"x": 0.5, "y": 0.5}],
            bag_paths=[],
            top_k=501,
        )
    with pytest.raises(ValidationError):
        SimilarSearchRequest(file_path="/f.jpg", bag_paths=[], top_k=501)
