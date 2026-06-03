import numpy as np
import pytest
from PIL import Image

from src.region.query import build_query_from_points, build_query_from_text
from tests.fakes import FakeDenseEmbedder


def test_points_query_is_unit_norm_and_averages_clicked_patches():
    emb = FakeDenseEmbedder(dim=4)
    img = Image.new("RGB", (60, 40))
    q = build_query_from_points(img, [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}], emb)
    assert q.shape == (4,)
    assert np.isclose(np.linalg.norm(q), 1.0, atol=1e-5)


def test_text_query_ensembles_templates_and_normalizes():
    emb = FakeDenseEmbedder(dim=4)
    q = build_query_from_text("traffic light", emb, templates=("a photo of a {}.", "a {} up close."))
    assert q.shape == (4,)
    assert np.isclose(np.linalg.norm(q), 1.0, atol=1e-5)


def test_points_validation_rejects_empty_and_out_of_range():
    emb = FakeDenseEmbedder(dim=4)
    img = Image.new("RGB", (60, 40))
    with pytest.raises(ValueError):
        build_query_from_points(img, [], emb)
    with pytest.raises(ValueError):
        build_query_from_points(img, [{"x": 1.5, "y": 0.2}], emb)
