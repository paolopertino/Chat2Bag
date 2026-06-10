# Project Configuration

## Project Overview
- **Name**: Bag-GPT
- **Purpose**: Multimodal RAG backend for processing and searching ROS2 bag files (.mcap). Enables frame extraction, semantic visual search via embeddings, and video understanding via VLMs.
- **Tech Stack**: Python 3.10+ (FastAPI, Transformers, LanceDB, PyTorch), TypeScript (React 19, Vite 8, TailwindCSS), Ollama (qwen3-vl)

## Architecture

Entry point: `app.py` (FastAPI with lifespan events for model loading/cleanup).

Source is organized under `src/` with `api/` (routers), `auth/` (JWT auth + SQLite user store), `services/` (business logic), `ingestion/` (bag parsing + LanceDB index building), `retriever/` (vector search, Ollama VLM chat), and `core/` (config, storage paths, schema versions). Built frontend assets live in `static/` (not committed; produced by `npm run build`).

**Key patterns**:
- Component Factory: `BackendComponentFactory` creates BagParser, Indexer, VideoChat, GlobalSearcher with shared models
- Dependency Injection: `Request.app.state` stores factory, models, searcher
- Background Tasks: FastAPI BackgroundTasks for async bag indexing
- Vector Search: LanceDB with SigLIP-2 embeddings, temporal deduplication
- Auth: `require_current_user` FastAPI dependency on every non-public router; JWT access token in React state + httpOnly refresh cookie scoped to `/auth`. Frontend attaches the Bearer token via `http()` wrapper in `frontend/src/api/client.ts`. Image thumbnails are fetched through `AuthImage` (blob URL) since `<img>` tags can't send headers.

## Frontend Structure

React Router v6 shell built during the Phase 1 refactor:
- `AuthProvider` (silent refresh on mount) wraps `<RouterProvider>`
- `ProtectedRoute` redirects to `/login` when unauthenticated
- `MainLayout` (top bar + optional sidebar slot) wraps the dashboard and feature pages
- Routes: `/login`, `/` (Dashboard), `/workspace` (legacy all-in-one UI, temporary), `/bags/*` and `/datasets/*` stubs
- `useSidebar(render, deps)` hook: pages inject their sidebar via a render factory + explicit deps (NOT inline JSX — that triggered React #185)

## Refactoring Roadmap

The phased WorkspacePage carve-out (old Phases 2–4) is **superseded** by the
map-first frontend redesign: two surfaces only — `/` (Map home: MapLibre map +
Omnibox + side panel + Results rail) and `/bags/:bagId` (Bag viewer: free
snap-grid Camera layout + timeline). VLM chat gets no UI. Design spec:
`docs/superpowers/specs/2026-06-10-frontend-redesign-design.md`; build order is
sketched at the bottom of that spec. Legacy pages (`/workspace`, dashboard,
`/search`, `/bags` list, `/datasets` stub) are deleted as part of that effort.
Surface vocabulary (Map home, Omnibox, Results rail, Pin, Lightbox, Extraction)
is canonicalized in `CONTEXT.md`.

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
- Environment variable: `CORS_ORIGINS` (comma-separated allowed origins)

## Common Commands

| Command | Purpose |
|---------|---------|
| `uv sync` | Install Python dependencies from lockfile |
| `source .venv/bin/activate` | Activate virtual environment |
| `uv run uvicorn app:app --reload` | Start backend + serve pre-built frontend from `static/` (port 8000) |
| `cd frontend && npm install` | Install frontend dependencies |
| `cd frontend && npm run dev` | Start Vite dev server (port 5173, proxies `/api` to 8000) — use for frontend hot-reload |
| `cd frontend && npm run build` | Build frontend to `../static/` (required before uvicorn serves the UI) |
| `cd frontend && npm run lint` | Run ESLint (typescript-eslint + react-hooks + react-refresh; no Prettier) |
| `PYTHONPATH="" uv run pytest tests/` | Run all backend tests (empty `PYTHONPATH` is required — the host's ROS2 env leaks `/opt/ros/*` onto `sys.path` and breaks pytest plugin discovery) |
| `JWT_SECRET=<s> REFRESH_SECRET=<r> uv run python scripts/manage_users.py add-user <name>` | Admin-only CLI to create/list/delete/reset users (no self-signup endpoint) |

**Typical local workflow**: `npm run build` once, then `JWT_SECRET=<s> REFRESH_SECRET=<r> uv run uvicorn app:app --reload` to serve everything at http://localhost:8000. The two env vars are required — without them the auth module refuses to issue tokens. Default `AUTH_DB_PATH` is `data/users.db` (repo-relative). For active frontend development, run uvicorn + `npm run dev` concurrently and use http://localhost:5173 instead.

## Key Configuration (config/settings.yaml)

- **Camera topic**: `/lucid_vision/lucid_cam_front_center/image_rect/compressed`
- **Sampling**: 1.0 FPS
- **Image size**: 512x512 max
- **Batch size**: 8 frames
- **Embedding model**: `google/siglip2-base-patch16-naflex`
- **Video VLM**: `qwen3-vl:2b` (via Ollama)
- **Temporal dedup window**: 20 seconds
- **Scan timeout**: 30 seconds

## Data Flows

**Indexing**: POST /api/index -> BagParser extracts frames -> Indexer builds LanceDB embeddings -> status: idle -> indexing -> done/error

**Search**: POST /api/search (text) or /api/search/image -> GlobalSearcher queries LanceDB -> temporal dedup -> ranked results

**Chat**: POST /api/chat with timestamp window -> VideoChat loads frames -> Ollama (qwen3-vl) processes frames + query -> response

## Artifacts

Indexing produces per-bag artifacts stored alongside the bag or in a custom directory specified in the config file:
- `.bag_chat/thumbnails/` - extracted frames
- `.bag_chat/metadata.json` - bag metadata
- `.bag_chat/lancedb/` - vector index

## Next Step

Implement the map-first redesign. Spec is approved at
`docs/superpowers/specs/2026-06-10-frontend-redesign-design.md`; next action is
a step-by-step implementation plan in
`docs/superpowers/plans/2026-06-10-frontend-redesign.md` following the spec's
build-order sketch (backend first: batch tracks endpoint, Frame location in
search responses, top_k default, `/api/image` auth). Unlike the old roadmap,
legacy pages are deleted in this effort — no `/workspace` fallback is kept.

---
**Last Updated**: 2026-06-10 (map-first redesign spec approved; implementation pending)
