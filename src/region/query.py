import numpy as np
from PIL import Image


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        raise ValueError("Query vector has zero norm")
    return (v / n).astype(np.float32)


def build_query_from_points(image: Image.Image, points: list[dict], embedder) -> np.ndarray:
    """points: list of {'x','y'} normalized to [0,1] on the displayed image.
    Returns a unit (dim,) vector = mean of the value-attention patches under each point."""
    if not points:
        raise ValueError("At least one point is required")
    for p in points:
        if not (0.0 <= float(p["x"]) <= 1.0 and 0.0 <= float(p["y"]) <= 1.0):
            raise ValueError("Each point's x and y must be in [0, 1]")

    grid = embedder.embed_dense([image.convert("RGB")])[0]  # (H_p, W_p, dim)
    h_p, w_p, _ = grid.shape
    picked = []
    for p in points:
        i = min(int(float(p["y"]) * h_p), h_p - 1)
        j = min(int(float(p["x"]) * w_p), w_p - 1)
        picked.append(grid[i, j])
    return _normalize(np.mean(np.stack(picked, axis=0), axis=0))


def build_query_from_text(text: str, embedder, templates: tuple[str, ...]) -> np.ndarray:
    if not text.strip():
        raise ValueError("Text query must not be empty")
    prompts = [t.format(text) for t in templates]
    feats = embedder.embed_text(prompts)  # (N, dim), each unit-norm
    return _normalize(np.mean(feats, axis=0))
