# Project Configuration

## Project Overview
- **Name**: Bag-GPT
- **Purpose**: Multimodal RAG backend for processing and searching ROS2 bag files (.mcap). Enables frame extraction and semantic visual search via embeddings.
- **Tech Stack**: Python 3.10+ (FastAPI, Transformers, LanceDB, PyTorch), TypeScript (React 19, Vite 8, TailwindCSS)

## Architecture

Entry point: `backend/src/chat2bag/main.py` as `chat2bag.main:app` (FastAPI with lifespan events for model loading/cleanup).

Source is organized under `backend/src/chat2bag/` with `api/` (routers), `auth/` (JWT auth + SQLite user store), `services/` (business logic), `ingestion/` (bag parsing + LanceDB index building), and `core/` (config, storage paths, schema versions). Built frontend assets live in `static/` (not committed; produced by `npm run build`).

**Key patterns**:
- Component Factory: `BackendComponentFactory` creates BagParser, Indexer, GlobalSearcher with shared models
- Dependency Injection: `Request.app.state` stores factory, models, searcher
- Background Tasks: FastAPI BackgroundTasks for async bag indexing
- Vector Search: LanceDB with SigLIP-2 embeddings, temporal deduplication
- Auth: `require_current_user` FastAPI dependency on every non-public router; JWT access token in React state + httpOnly refresh cookie scoped to `/auth`. Frontend attaches the Bearer token via `http()` wrapper in `frontend/src/api/client.ts`. Image thumbnails are fetched through `AuthImage` (blob URL) since `<img>` tags can't send headers.

## Frontend Structure

Two-surface map-first UI (shipped 2026-06-10):

- `AuthProvider` (silent refresh on mount) wraps `<RouterProvider>`
- `ProtectedRoute` redirects to `/login` when unauthenticated
- `FullBleedLayout` (TopBar only, no sidebar) wraps both surfaces
- Routes: `/login`, `/` (Map home), `/bags/:bagId` (Bag viewer), `*` → redirect `/`

**Map home (`/`):** MapLibre GL globe (OpenFreeMap tiles) + `FleetTracksLayer` (colored GPS tracks per indexed bag) + `AreaDraw`/`AreaDisplayLayer` (terra-draw polygon/circle filter) + `Omnibox` (centered pill bar: text/image/region/area/bag/top-k chips) + `MapSidePanel` (Bags tab + Jobs tab) + `ResultsRail` (horizontal thumbnail strip) + `ResultPinsLayer` (clustered orange dots) + `SampleResultLightbox` (full Sample view with heatmap, use-as-support, open-in-bag, extract actions)

**Bag viewer (`/bags/:bagId`):** `SampleGridViewer` (react-grid-layout snap-grid, 12-column, `editMode` drag/resize persisted to localStorage via `readCameraLayoutV2`/`saveCameraLayoutV2`) + `TimelineBar` (normalized axis, amber pins for search hits, ← / → load more) + scoped `Omnibox` (showAreaChip=false, showBagChip=false) + `ExtractDialog`

**Key components:**
- `frontend/src/components/map/` — MapLibre wrappers (`maplibre-map.tsx`, `fleet-tracks-layer.tsx`, `area-draw.tsx`, `area-display-layer.tsx`, `result-pins-layer.tsx`, `map-side-panel.tsx`, `jobs-tab.tsx`)
- `frontend/src/components/omnibox/` — `omnibox.tsx`, `support-chip.tsx`
- `frontend/src/components/search/` — `results-rail.tsx`, `sample-result-lightbox.tsx`, `region-support-dialog.tsx`, `heatmap-overlay.tsx`, and chip components
- `frontend/src/components/samples/` — `sample-grid-viewer.tsx`, `timeline-bar.tsx`
- `frontend/src/components/extract/` — `extract-dialog.tsx`
- `frontend/src/hooks/` — `use-omnibox-search.ts` (orchestrates url+region+area search), `use-fleet-tracks.ts`, `use-sample-browser.ts`, `use-url-search.ts`, `use-region-search.ts`, `use-map-area.ts`, `use-source-draft.ts`
- `frontend/src/lib/` — `sample-camera-layout.ts` (v2 snap-grid layout; v1 types kept for migration), `bag-id.ts` (URL-safe base64 for bag paths), `area-codec.ts`, `rgl-compat.ts` (react-grid-layout CJS shim)

**CSS variables:** `--surface` (panel/card backgrounds), `--line` (borders), `--ink` (text), `--ink-soft`, `--canvas` (page background). Use `--surface` not `--panel`.

**Layout persistence:** `readCameraLayoutV2(cameras)` / `saveCameraLayoutV2(layout)` — keyed by sorted camera list, localStorage; migrates v1 layouts; seeds from best-overlap saved layout for new camera sets.

## Status

Map-first redesign **shipped** on `feat/frontend-refactor` (2026-06-10). All 20 implementation tasks complete. Legacy pages (`/workspace`, dashboard, `/search`, bags list, detail page), `MainLayout`, Leaflet stack, and chat UI have been deleted.

Map-home UI improvements (2026-06-16, `feat/frontend-refactor`): a single grouped, nested bag tree in the sidebar (one shared `BagsProvider` instance) with per-bag visibility toggles that scope both search and fleet tracks, and surfaced indexing failures (backend `indexing_errors` store via `/scan` + `/status`) with a retry action. Similarity thresholds are now per-type (text 0.14 / visual 0.80, localStorage-persisted), image upload with no region points runs a global search, and the results rail insets to clear the sidebar and map controls.

## Development Standards

### Code Style

**Python (backend)**:
- Full type annotations on all functions
- Frozen dataclasses for config objects
- async/await for I/O-bound operations
- Thin routers, business logic in services

**TypeScript (frontend)**:
- Functional components with hooks
- Named exports preferred
- Type-safe fetch wrapper with generics

**Linting**: Frontend uses ESLint with `typescript-eslint`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`. No Prettier configured — do not introduce Prettier formatting. Python has no linter or formatter configured (no Ruff, Black, or isort).

### Naming Conventions
- **Python files**: snake_case (`bag_parser.py`)
- **Python functions/variables**: snake_case (`extract_frames`)
- **Python classes**: PascalCase (`IndexingService`)
- **Python constants**: UPPER_SNAKE_CASE (`CORS_ORIGINS`)
- **TS/React files**: kebab-case (`search-bar.tsx`)
- **TS functions/variables**: camelCase (`getUserById`)
- **React components**: PascalCase (`SearchBar`)

### Git Workflow
- Branch names: `feature/description` or `fix/description`
- Commit messages: Conventional commits with tags (`[Backend]`, `[Feat]`, `[UI]`, `[Config]`, `[API]`)
- PR required before merge
- Minimum 1 approval required

### Testing
- Framework: pytest + pytest-asyncio + httpx
- Mocking: Dependency injection with fake services
- Test files: `tests/test_*.py`
- Async mode: auto (auto-detect async tests)

### Configuration
- Settings: `config/settings.yaml` (ingestion, storage, models)
- Logging: `config/logging.yaml`
- Environment variables:
  - `CORS_ORIGINS` — comma-separated allowed origins
  - `JWT_SECRET`, `REFRESH_SECRET` — required for the auth module to issue tokens
  - `AUTH_DB_PATH` — user store location (default `data/users.db`)
  - `EXTRACTION_SERVICE_URL` — overrides `extraction.service_url`; empty string disables extraction. Use the Compose service name (e.g. `http://dataset-generation:8765`) inside containers.
  - `EXTRACTION_PATH_STRIP_PREFIX` — overrides `extraction.path_strip_prefix`; empty string disables stripping (for identical cross-container mounts)
  - `CHAT2BAG_STORAGE_PATH` — overrides `storage.storage_path`; empty string falls back to the indexed bag directory

## Common Commands

| Command | Purpose |
|---------|---------|
| `uv sync` | Install Python dependencies from lockfile |
| `source .venv/bin/activate` | Activate virtual environment |
| `uv run uvicorn chat2bag.main:app --reload` | Start backend + serve pre-built frontend from `static/` (port 8000) |
| `cd frontend && npm install` | Install frontend dependencies |
| `cd frontend && npm run dev` | Start Vite dev server (port 5173, proxies `/api` to 8000) — use for frontend hot-reload |
| `cd frontend && npm run build` | Build frontend to `../static/` (required before uvicorn serves the UI) |
| `cd frontend && npm run lint` | Run ESLint (typescript-eslint + react-hooks + react-refresh; no Prettier) |
| `PYTHONPATH="" uv run pytest tests/` | Run all backend tests (empty `PYTHONPATH` is required — the host's ROS2 env leaks `/opt/ros/*` onto `sys.path` and breaks pytest plugin discovery) |
| `JWT_SECRET=<s> REFRESH_SECRET=<r> uv run python backend/scripts/manage_users.py add-user <name>` | Admin-only CLI to create/list/delete/reset users (no self-signup endpoint) |

**Typical local workflow**: `npm run build` once, then `JWT_SECRET=<s> REFRESH_SECRET=<r> uv run uvicorn chat2bag.main:app --reload` to serve everything at http://localhost:8000. The two env vars are required — without them the auth module refuses to issue tokens. Default `AUTH_DB_PATH` is `data/users.db` (repo-relative). For active frontend development, run uvicorn + `npm run dev` concurrently and use http://localhost:5173 instead.

## Key Configuration (config/settings.yaml)

- **Camera topic**: `/lucid_vision/lucid_cam_front_center/image_rect/compressed`
- **Sampling**: 1.0 FPS
- **Image size**: 512x512 max
- **Batch size**: 8 frames
- **Embedding model**: `google/siglip2-base-patch16-naflex`
- **Temporal dedup window**: 20 seconds
- **Scan timeout**: 30 seconds

## Data Flows

**Indexing**: POST /api/index -> BagParser extracts frames -> Indexer builds LanceDB embeddings -> status: idle -> indexing -> done/error

**Search**: POST /api/search (text) or /api/search/image -> GlobalSearcher queries LanceDB -> temporal dedup -> ranked results

## Artifacts

Indexing produces per-bag artifacts stored alongside the bag or in a custom directory specified in the config file:
- `.bag_chat/thumbnails/` - extracted frames
- `.bag_chat/metadata.json` - bag metadata
- `.bag_chat/lancedb/` - vector index

---
**Last Updated**: 2026-06-10 (map-first redesign shipped)
