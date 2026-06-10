# Map search: nearest-Fix Frame location, no spatial index

Bags carry a GPS topic (`/oxts/nav_sat_fix`); we want Frames searchable by *where
in the world* they were captured (click a point + radius, or draw a polygon —
an **Area**), across bags. GPS is a separate, faster topic than the cameras, so a
Frame has no location of its own. We decide that:

- Each Frame gets a **Frame location** by joining the bag's **Track** to the
  Frame's timestamp — **nearest valid Fix within ±1.0 s** (configurable), with
  `NO_FIX`/`NaN` Fixes dropped first. No interpolation (sub-meter gain is
  meaningless at Area scale); a Frame with no nearby valid Fix gets **no**
  location and is invisible to Map search rather than mislocated. The join runs
  **at extraction time** (folded into the existing bag-read) and persists one
  lat/lon per Frame in `metadata.json` — the high-frequency Track is **not**
  stored. `METADATA_SCHEMA_VERSION` bumps to **v5**.
- **There is no spatial index.** `metadata.json` is the single source of truth;
  Map search is a thin in-Python filter: one function resolves `Area → in-area
  Frame set` (cheap bounding-box pass + exact haversine/point-in-polygon test).
- **Map search is a filter, not a ranker.** Standalone it *is* the in-area Frame
  set (chronological, temporal-deduped per `(bag, topic)`, all cameras kept).
  Composed with Global/Region search it is a **pre-filter, not a post-filter**:
  the in-area set restricts the candidate Frames *before* ranking (LanceDB
  allowed-ids for Global; faiss `IDSelector` for Region), so a small Area still
  surfaces its best matches instead of being emptied by a city-wide top-k.

## Why this, right next to ADR 0004's PQ index

ADR 0004 built an IVF-PQ patch index because Region search ranks **millions of
Patches** (≈1.9 M per bag) — there, an index is mandatory and storage is the
binding constraint. Map search filters **thousands of Frame locations** per bag
(one per Frame, at 1 FPS). At that scale a brute-force in-Python scan is
sub-millisecond, an R-tree/geohash/LanceDB-column scheme is pure complexity for
no measurable speedup, and keeping locations in one place (`metadata.json`) avoids
a second store to keep consistent. The asymmetry is deliberate: **index millions,
brute-force thousands.**

## Considered alternatives

- **lat/lon columns in the LanceDB frames table** (native bbox pre-filter for
  Global). Rejected: the exact polygon/circle test is Python regardless, so geo
  logic would straddle SQL + Python, locations would live in two places to keep
  in sync, and backfill would touch the index — all for a non-measurable win at
  this scale. Documented as the escape hatch if per-bag Frame counts ever explode.
- **A real spatial index (R-tree / geohash / S2).** Rejected: overkill for
  thousands of points; adds a dependency and an index-lifecycle to maintain.
- **Interpolating Fixes / storing the full Track.** Rejected: precision gain is
  invisible at Area scale, and only the per-Frame location is ever queried.

## Consequences

- Enabling Map search on a bag requires a **bag re-read** (the Fixes live only in
  the `.mcap`), unlike Region search's thumbnail-only pass. At the current 2-bag
  scale this is folded into re-extraction; the GPS reader is kept as an isolated
  module so a lightweight "locate-only" backfill pass (GPS topic only, no
  thumbnail re-extraction, no re-embed) is a trivial future add if the corpus grows.
- A bag with no GPS topic has no Track; `is_located` / `located_frame_count` are
  exposed on bag scan/info so the UI greys it out and Map search skips it
  (mirrors the embedder/region stamp-compatibility pattern).
- The Area→Frame-set join happens **server-side in Python on integer
  `timestamp_ns`**, so it sidesteps the frontend ns-precision landmine entirely
  (JS numbers lose precision past 2^53; the browser never does this join).
- Composing leaves the existing rankers' score-based temporal dedup unchanged —
  the Area only narrows their candidate set.
- **The Global pre-filter (`file_path IN (…)`, `prefilter=True`) is exact and
  cheap** at this scale (spike 2026-06-03, lancedb 0.27.1): ~30 ms over a full
  1180-Frame `IN`-list, results identical to an exact cosine, and it correctly
  does **not** empty a small in-area set (a 3-Frame set returns 3 rows; the
  post-filter variant returns 0). The lat/lon-column escape hatch above is held
  in reserve for a tens-of-thousands-of-Frames-per-bag future.
- **The Region pre-filter requires raising `nprobe` while an Area is active**
  (spike 2026-06-03, faiss-cpu 1.14.2). The faiss `IDSelector`
  (`SearchParametersIVF(sel=…)`) correctly confines the search, but at the
  resident `nprobe` the in-area patches scatter into unprobed IVF cells and small
  Areas lose recall (≈0.80 recall@10 at ≤10 Frames). Since the `IDSelector`
  already bounds the work to allowed patches, the query path sets
  `nprobe = nlist` (exhaustive) when an Area is present — ~6–41 ms, full recall.
  The over-fetch-and-post-filter alternative was measured *worse* and is dropped.
