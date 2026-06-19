"""Parse an incoming `area` request body into a library `Area`.

Transitional bridge: the frontend currently POSTs a single shape
(`{"kind": "circle", ...}`), while `data_extraction_lib.geo.Area.from_payload`
accepts only the generic `{"geometries": [...]}` form. This wraps a lone shape
before delegating. Wire-format adaptation is an application concern, so it lives
here rather than in the (pure) library.

Delete this module once the frontend emits geometry arrays — see
`docs/feature-requests/2026-06-19-frontend-multi-area-selection.md`.
"""
from data_extraction_lib.geo import Area


def parse_area_payload(payload: dict | None) -> Area | None:
    """Parse an `area` request body into a library `Area`.

    Accepts either the generic `{"geometries": [...]}` payload or a legacy single
    shape (`{"kind": ...}`), which is wrapped into a one-geometry payload before
    parsing. Returns ``None`` when ``payload`` is ``None``.
    """
    if payload is None:
        return None
    if "geometries" not in payload:
        payload = {"geometries": [payload]}
    return Area.from_payload(payload)
