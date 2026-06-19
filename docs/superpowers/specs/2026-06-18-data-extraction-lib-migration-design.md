# Extracting Chat2Bag's backend capabilities into `data-extraction-lib`

Status: design for review

Last updated: 2026-06-18

## 1. Context and goal

Chat2Bag is a multimodal RAG backend over ROS2 `.mcap` bags. Several of its
backend concepts are about to be reused by other tools: the bag-cutter
(`../bag-splitter`), parts of dataset-generation (`../dataset-generation`), and
the planned automatic tagging pipeline (`docs/automatic_tagging_pipeline_overview.md`).
To avoid duplicating those concepts, they move into a shared library,
`data-extraction-lib` (`../data-extraction-lib`, currently an empty scaffold).

**This session's scope is deliberately narrow.** We untie *Chat2Bag's own
backend* from the concepts that will be shared — `embedding`, `geo`,
`ingestion`, `retriever`, `region`, and parts of `core` — move them into the
library in their final object shape, re-wire the webapp onto the library, and
prove the UI behaves identically. The tagging system, bag-cutter rework,
dataset-generation processors, and notification-log handling are **out of scope**
here; the library layout simply leaves room for them.

The primary concern is modelling the shared concepts as objects at the right
level of abstraction — not relocating functions.

## 2. Governing principle

One rule decides nearly every boundary question:

> **The application depends on the library. The library never depends on the
> application.**

In practice (the conventions this implies):

- **The library never reads the environment.** No YAML loaded from a fixed path,
  no `os.environ`, no process-global config singleton. The application reads
  config and *passes it in*. Chat2Bag's `get_app_config()` singleton therefore
  cannot cross the boundary.
- **Mechanism, not policy.** The library provides capabilities (read a bag,
  extract frames, embed images, build/search an index, geo containment). The
  application owns policy (which camera topic, where artifacts live, FastAPI
  wiring, keep/compress decisions).
- **Deep modules, narrow public API.** Each capability gets a small, stable,
  object-oriented interface; rich implementation hides behind it.

**Verdict on what moves:**

| Concept | Library? | Rationale |
|---|---|---|
| `embedding/` (ABC, registry, siglip2, tipsv2) | Yes | Reusable capability; de-config the constructors. |
| `geo/area.py` (Area, haversine, contains) | Yes | Pure geometry. |
| `ingestion/gps.py` (Fix, NavSat decode, locate) | Yes | Pure + a ROS decode adapter. |
| Bag read + frame extraction (guts of `BagParser`) | Yes | Named library capability. |
| Index build + search (`Indexer`/`GlobalSearcher`/`RegionSearcher`/faiss) | Yes | Named library capability. |
| `region/faiss_index.py`, `patch_index.py`, `query.py` | Yes | Pure faiss/numpy + embedder duck-type. |
| Artifact format (`schema_versions`, `index_stamp`, `index_manifest`, layout) | Yes | The tagging pipeline reuses these indexes → shared **format contract**. |
| `core/settings.py` (YAML at fixed path) | No | Each consumer loads its own config. |
| `core/app_config.py` (the `AppConfig` tree) | No | Knows `extraction.service_url`, `api.scan_timeout_sec`, FastAPI. |
| `core/extraction_config.py` | No | Microservice policy. |
| `get_app_config()` singleton | No (must not exist in lib) | The env-reading anti-pattern. |
| `api/`, `auth/`, `services/`, `app.py` | No | Pure wiring/policy. |

## 3. Library layout — a ROS2 adapter layer over an agnostic core

```
data_extraction_lib/
  # ── ROS2 adapter layer: the ONLY packages that may import rosbags / rosbag2_py / ROS msgs ──
  ros2/
    reader.py     # BagReader — iterate messages by topic+time (+ iter_raw for the cutter)
    convert.py    # MessageConverter (ABC) + ImageFrameConverter, NavSatFixConverter — per msg-type, emit-only
    select.py     # DecimationPolicy (FPS) now;  Synchronizer / SamplePlan (two-pass)  [design-only]
    sink.py       # Sink (ABC) + ThumbnailSink (synchronous);  async WriteManager-style sink  [design-only]
    extractor.py  # BagFrameExtractor — orchestrates reader → select → convert → assemble → sink → Metadata
    #  future:  cutter.py (BagCutter),  processors/ (from dataset-generation)
  # ── ROS-agnostic capability core: zero ROS dependency, usable with ROS uninstalled ──
  embedding/      # FrameEmbedder (ABC) + registry + Siglip2/TipsV2 + EmbeddingSettings
  geo/            # Area (Circle | Polygon), Fix, locator/join — pure
  index/          # EmbeddingIndex (build + search): GlobalIndex (lancedb), DenseIndex (faiss)
  artifacts/      # BagArtifacts (layout) + Metadata / stamps / manifest — the on-disk format
```

**The dependency invariant** (to be encoded and, ideally, linted):
`ros2/` may depend on the agnostic packages — it produces their types
(`Frame`, `geo.Fix`, PIL images). The agnostic packages must **never** import
`ros2/`. Consequence: the `embedding` / `geo` / `index` / `artifacts` core
installs and tests with no ROS present, and ROS becomes one swappable source of
frames (Ports & Adapters).

Config/param types live **next to their component** (`embedding.EmbeddingSettings`,
`index.IndexSettings`), never in a shared config hub — that hub is exactly the
`core` we are dissolving.

## 4. Object model

The remodel is done *as each module moves* (final shape on arrival). The
notable upgrades over today's function-on-dict style:

**`geo/`**
- `Coordinate` with lat, lon attributes.
- `Geometry` (ABC) with polymorphic `.contains(Coordinate) -> bool` and `.bbox() -> (min_lat, min_lon, max_lat, max_lon)`.
  Subclasses `Circle(center: Coordinate, radius_m)` and `Polygon(vertices)`. Classmethod
  `Geometry.from_payload(dict) -> Geometry` parses one shape. `haversine` and the pure
  batch filter `coordinates_in_area(area, coords) -> list[Coordinate]` are module
  functions. Constants (`EARTH_RADIUS_M`, `METERS_PER_DEGREE`) live in `geo/constants.py`.
- `Area` is a composition of 1:n `Geometry`. Public `.contains()` method. Static
  `Area.from_payload(dict | None) -> Area | None` accepts only the **generic**
  `{"geometries": [...]}` payload (wrapping a legacy single shape is the consumer's job).
- **NOT in `geo`** (decision — see lib `docs/adr/0001-geo-stays-pure-frame-location-deferred.md`):
  `LocatedFrame` and the frame-location functions. `topic`/`file_path`/`timestamp_ns` are
  ROS2/artifact/bag concepts, not geographic; they stay app-side, and the *shared* `Frame`
  + frame-locator is deferred to the `artifacts` step. `Fix` likewise moves with `ros2`/gps.

**`artifacts/`**
- `BagArtifacts(artifact_dir: Path)` — owns the layout: `.metadata_path`,
  `.thumbnails_dir`, `.lancedb_dir`, `.region_dir`, `.manifest_path`. Replaces
  the *layout* half of `core/storage.resolve_artifact_path`.
- `Metadata` aggregate — owns `schema_version`, `bag_name`, `cameras`, `frames`,
  and the `embedder` / `region_index` / `gps` stamps; `.load()` / `.save()` and
  compatibility checks (`embedder_compatible_with(name, dim)`,
  `region_compatible_with(...)`, `gps_is_located()`) as methods. Replaces the
  free functions in `index_stamp.py`.
- `IndexManifest` — `.read()` / `.write()` / `.is_indexed` / `.ensure()` (lazy
  migration from legacy stamp). `SCHEMA_VERSION` constant + history.

*Two layers, one word.* These are **bag-processing artifacts** — per-bag derived
data (frames, indexes, stamps) that the tagging pipeline *reuses*. They are
distinct from the tagging system's own **run/audit artifacts** (its run directory
+ manifest of candidates, windows, cuts, provenance), which live in the tagging
application and merely *reference* these. The library owns only the former.

**`embedding/`**
- `FrameEmbedder` (ABC) kept as-is (already a clean Strategy). `EmbeddingSettings`
  frozen dataclass (`model_id`, `model_storage`, `batch_size`, `encode_long_side`,
  `device`). `register_embedder` decorator + `create_embedder(settings) -> FrameEmbedder`.
  Constructors take `EmbeddingSettings`, not `config.embedding.*`.

**`index/`** (the largest remodel)
- `EmbeddingIndex` (ABC): `build(...)` and `search(...) -> list[SearchResult]`,
  with `GlobalIndex` (lancedb) and `DenseIndex` (faiss) implementations. Unifies
  today's split `retriever` (global) and `region` (dense) backends.
- `SearchResult` — frozen value object `(timestamp_ns, topic, file_path,
  bag_path, source_bag, similarity_score)` replacing the result dict.
- `IndexSettings` / `RegionParams` frozen dataclasses; temporal dedup as a method.
- **Note:** "search across many bags + area filter + dedup" is orchestration over
  per-bag indexes. Whether that lives in a lib `FrameSearch` composer or in the
  app is resolved at the `index` step (see §8 deferred cases).

**`ros2/`** (adapter — the extraction pipeline)

Five single-responsibility seams, wired by a library-owned orchestrator. **All
temporal logic lives in Selection + Assembly**; converters stay per-type and
topic-local (a converter cannot see other topics, so it cannot synchronise).

```
BagReader ──▶ Selection ──▶ Converter ──▶ Assembly ──▶ Sink
              (decimate /    (per msg-      (group /       (persist;
               synchronise)   type, emit)    associate)     async opt.)
                 └──────────── BagFrameExtractor orchestrates ──────────┘
```

- `BagReader` — encapsulates the rosbags `Reader` + typestore (incl. custom
  message-type registration for dataset-generation). `iter_messages(topics,
  time_range)` yields deserialised `BagMessage(topic, timestamp_ns, msg)`;
  `iter_raw(...)` yields bytes for the future cutter (no deserialise). Surfaces
  read errors (`describe_reader_error`).
- `MessageConverter` (ABC) — **one per message type, emit-only**: converts a raw
  ROS message into a domain record and `yield`s it; no persistence, no cross-topic
  state. Now: `ImageFrameConverter` (CompressedImage → resized frame),
  `NavSatFixConverter` (NavSatFix → `geo.Fix`).
- **Selection** — *which* messages to convert and how they group. `DecimationPolicy(fps)`
  (per-topic rate-limit) now; a `Synchronizer` that builds a two-pass `SamplePlan`
  (read timestamps → align a leader topic with others within a threshold → sample
  ids) is **design-only** for dataset-generation later.
- **Assembly** — cross-stream temporal relations on *converted* records. Nearest-join
  enrichment now (GPS `Fix` → frame, reusing `geo.locate_frames` — the minimal
  instance of synchronisation); sample-grouping by `SamplePlan` is **design-only**.
- `Sink` (ABC) — persists converted records, streaming (no buffering). `ThumbnailSink`
  (synchronous: write JPEG, return relative path) now; an async `WriteManager`-style
  sink is **design-only**.
- `BagFrameExtractor` — **library-owned** orchestrator composing the seams for frame
  extraction, writing `artifacts.Metadata`. The tagging pipeline reuses it directly;
  dataset-generation's synchronised multi-modal extractor is a sibling orchestrator
  added later against the same seams.

## 5. What stays in the webapp (policy/wiring)

- `core/settings.py`, `core/app_config.py`, `core/extraction_config.py`, and the
  `get_app_config()` singleton.
- The `AppConfig → library settings` mapping, performed once in
  `BackendComponentFactory`.
- The *policy* half of artifact-path resolution (`storage_path` vs. beside-the-bag),
  as a thin webapp wrapper that constructs a `BagArtifacts`.
- `resolve_area_to_frames` glue, until `artifacts` moves and it becomes a thin
  composition of `BagArtifacts` + `geo`.
- All of `api/`, `auth/`, `services/`, `app.py`.

## 6. Integration mechanism — two phases

**During migration (fast local iteration):** editable path source.

```toml
# Chat2Bag/pyproject.toml
dependencies = [ ..., "data-extraction-lib" ]
[tool.uv.sources]
data-extraction-lib = { path = "../data-extraction-lib", editable = true }
```

Editable means lib edits reflect immediately, and `uv run pytest` works
regardless of the `PYTHONPATH=""` quirk because the lib is installed into the venv.

**End state (committed / reproducible):** install from the repository URL, pinned
to a tag.

```toml
# Chat2Bag/pyproject.toml
dependencies = [
  "data-extraction-lib @ git+ssh://git@gitlab.com/niulinx/aida/aida-tools/data-extraction-lib.git@v0.1.0",
]
# (the [tool.uv.sources] editable entry is dropped, or kept only as a local dev override)
```

We cut the `v0.1.0` tag on `data-extraction-lib` once the migrated library is
stable, and switch Chat2Bag's source from path to the pinned git URL as the final
step. Pinning to a **tag** (not a branch) keeps builds reproducible.

## 7. Verification loop (per module)

1. Build the module in the library **in its final OOP shape**, and **move its unit
   tests** into the library, adapted to the new objects (the lib owns its tests).
2. Re-wire the webapp: `from src.<mod>… → from data_extraction_lib.<mod>…`; delete
   the moved `src/` code.
3. Green gate, all three required:
   - library tests pass;
   - full webapp suite passes — `PYTHONPATH="" uv run pytest tests/` (the
     `test_api*.py` / service tests are the UI-behaviour proxy);
   - manual UI smoke of the affected surface.

The webapp's existing per-module tests (`test_geo_area`, `test_index_stamp`,
`test_embedding`, `test_global_search_*`, `test_region_*`, …) plus the API
contract tests are the safety net that makes "remodel as we move" survivable.

## 8. Migration sequence (bottom-up the dependency DAG)

`geo` → `embedding` → `artifacts` (the leaves) → `ros2` extraction pipeline and
`index` (both build on the leaves) → final orchestration + app rewire (and the
path→git source switch). Pure leaves first, so every later step imports
already-migrated, already-green packages.

**Step 1 — `geo`** (this step gets its own implementation plan):
- Move to the library, in final object shape: the `Area` hierarchy
  (`Area`/`Circle`/`Polygon` with `.contains`/`.bbox`, generic `Area.from_payload`),
  `haversine`, the pure `coordinates_in_area` filter, and `geo/constants.py`.
  **Revised** (lib ADR-0001): `Fix`, `LocatedFrame`, and `frames_in_area` /
  `located_frames_in_area` do **not** move to `geo` — they are ROS2/artifact/bag
  shaped, not geographic.
- Stays in the webapp (for now): the whole frame-location glue — `LocatedFrame`,
  `frames_in_area`, `located_frames_in_area`, `resolve_area_to_frames` — refactored
  onto the lib's `Area`/`Coordinate`; plus `parse_area_payload`, the app-side bridge
  that wraps the legacy single-shape body into the generic payload (removed when the
  frontend emits arrays — see docs/feature-requests/2026-06-19-frontend-multi-area-selection.md).
  This glue absorbs into the shared `artifacts` `Frame`-locator at a later step.
- This step also sets up the editable path dependency and proves the full
  cross-repo loop (install → import rewrite → tests move → green webapp suite →
  UI smoke of the map Area filter) at the lowest possible risk.

**Deferred boundary cases** (resolved when we reach them, not now):
- *Artifact-path policy* — where the root lives (`storage_path` vs. beside-bag):
  resolved at the `artifacts` step; the layout object moves, the policy stays
  app-side.
- *Orchestrator ownership* — **resolved for extraction**: the library owns
  `BagFrameExtractor` (the tagging pipeline reuses it). Still open: whether
  cross-bag search orchestration (search many bags + area filter + dedup) lives in
  a library `FrameSearch` composer or stays app-side — resolved at the `index` step.

## 9. Out of scope (future work the layout leaves room for)

- Tagging pipeline (`ros2/`, `artifacts/`, registry of tag definitions).
- Bag-cutter rework → `ros2/cutter.py` (`BagCutter`).
- dataset-generation processors → `ros2/processors/`.
- Notification-log parsing (`notification_log_utils.py`) → a future `notifications/`.
