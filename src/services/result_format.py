"""Map library SearchResults to the webapp's response dicts."""

from pathlib import Path

from data_extraction_lib.index import SearchResult


def to_response(results: list[SearchResult], bag_path_by_dir: dict[str, str]) -> list[dict]:
    """Shape a list of :class:`SearchResult` objects into the API's result dicts.

    :param results: Ranked results from a :class:`GlobalSearch` or :class:`DenseSearch` call.
    :param bag_path_by_dir: Mapping from ``str(artifacts.dir)`` to the original ``.mcap`` bag
        path that was passed by the caller. Required because ``artifacts.dir`` does not preserve
        the original bag path and the frontend identifies bags by their ``.mcap`` path.
    :returns: List of dicts with keys ``timestamp_ns``, ``topic``, ``file_path`` (absolute
        thumbnail path), ``bag_path`` (resolved original bag path), ``source_bag`` (bag
        filename), and ``similarity_score``. When a frame has a coordinate, ``lat`` and ``lon``
        are also included.
    """
    out = []
    for r in results:
        original = bag_path_by_dir[str(r.artifacts.dir)]
        row: dict = {
            "timestamp_ns": r.frame.timestamp_ns,
            "topic": r.frame.topic,
            "file_path": str(r.artifacts.dir / r.frame.file_path),
            "bag_path": str(Path(original).resolve()),
            "source_bag": Path(original).name,
            "similarity_score": r.score,
        }
        if r.frame.coordinate is not None:
            row["lat"] = r.frame.coordinate.lat
            row["lon"] = r.frame.coordinate.lon
        out.append(row)
    return out
