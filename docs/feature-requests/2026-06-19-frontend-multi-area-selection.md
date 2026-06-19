# Feature Request: Multiple Area Selection (frontend)

- **Status:** TODO / backlog — not started
- **Created:** 2026-06-19
- **Scope:** Chat2Bag frontend (+ a small backend cleanup at the end)
- **Owner:** unassigned — pick this up in a dedicated Chat2Bag session

## Summary

Let the user select **multiple areas** on the map and have search/browse filter by
their **union** (a frame inside *any* area matches). The shared `data-extraction-lib`
already models an `Area` as a composition of 1..n `Geometry`, and its
`Area.from_payload` accepts only the **generic** wire shape:

```jsonc
{ "geometries": [ {"kind":"circle","center":{"lat":..,"lon":..},"radius_m":N},
                  {"kind":"polygon","vertices":[{"lat":..,"lon":..}, ...]} ] }
```

Today the frontend only lets the user draw a **single** shape and emits the legacy
single-shape payload; the backend temporarily **bridges** that to the generic shape
via an app-side normalizer. This feature finishes the migration on the frontend:
draw/emit multiple geometries, then remove the backend bridge.

## Background / why

- The geo capability moved into `data-extraction-lib`. See
  `docs/superpowers/specs/2026-06-18-data-extraction-lib-migration-design.md` and
  `docs/superpowers/plans/2026-06-19-geo-migration-to-data-extraction-lib.md`.
- The lib's `Area` is a union of geometries; `Area.from_payload` is **generic-only**
  (the wrapper-object shape above). It rejects bare single-shape payloads.
- **Backend (B1 decision):** an app-side normalizer wraps the current single-shape
  payload into `{"geometries":[shape]}` before calling the lib's generic parser, so
  the UI keeps working unchanged during the transition. **This bridge is temporary
  and exists only until this feature lands.**

## What to build (frontend)

1. **Multi-shape drawing** — allow keeping more than one drawn area (terra-draw already
   supports multiple features): `frontend/src/components/map/area-draw.tsx`,
   `area-display-layer.tsx`, hook `frontend/src/hooks/use-map-area.ts`.
2. **Emit the generic payload** — assemble `{"geometries":[...]}` from all active shapes
   in the search/browse requests: `frontend/src/hooks/use-omnibox-search.ts` (and
   wherever the area payload is currently built as a single shape).
3. **URL / area codec** — encode/decode *multiple* geometries: `frontend/src/lib/area-codec.ts`.
4. **Omnibox area chip UI** — reflect N areas (count, clear-all, per-shape remove):
   `frontend/src/components/omnibox/` + the area chip component(s).
5. **Backend cleanup (do last)** — once the frontend emits the generic shape, **remove**
   the temporary single-shape normalizer/bridge and update the webapp area tests + the
   API payload docs (spec §5.1) to the generic shape only.

## Acceptance criteria

- User can draw ≥2 areas; results are the **union** (a frame inside any area matches).
- Requests carry `{"geometries":[...]}`; no single-shape payloads remain anywhere.
- `area-codec` round-trips multiple geometries through the URL.
- Backend normalizer removed; webapp tests + spec §5.1 updated; `npm run lint` and
  `PYTHONPATH="" uv run pytest tests/` both green.

## Pointers

- Lib generic contract: `data_extraction_lib/geo/area.py` → `Area.from_payload`.
- Backend bridge to remove (grep for the area-payload normalizer in `src/geo/`) and its
  call sites: `src/services/map_search_service.py`, `src/retriever/global_search.py`,
  `src/region/region_search.py`.
- Area payload contract: spec `docs/superpowers/specs/2026-06-18-data-extraction-lib-migration-design.md` §5.1.
