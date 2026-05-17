# Phase 1: Auth + Routing Scaffold — Design Spec

**Date:** 2026-04-23
**Scope:** Authentication system and React Router scaffold. Foundation for all subsequent phases.

---

## 1. Overview

This phase introduces user authentication (username + password, JWT-based, local SQLite) and restructures the frontend from a single-page God component into a routed, multi-page shell. All subsequent phases (Bag Explorer, Search, Dataset Inspector) slot into the routing scaffold built here.

---

## 2. Backend — Auth API

### Dependencies
- `python-jose[cryptography]` — JWT encode/decode
- `passlib[bcrypt]` — password hashing
- `aiosqlite` — async SQLite access

### Module structure
New `src/auth/` module:
```
src/auth/
  __init__.py
  db.py          # SQLite connection, schema init
  models.py      # User dataclass / Pydantic models
  hashing.py     # bcrypt helpers
  tokens.py      # JWT encode/decode, secret loading
  dependencies.py # require_current_user FastAPI dependency
  router.py      # /auth/* routes
```

### SQLite schema
Single `users` table:
```sql
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Database file path: configurable via `AUTH_DB_PATH` env var, defaulting to `data/users.db` relative to the project root.

### Routes

| Method | Path | Auth required | Description |
|--------|------|---------------|-------------|
| POST | `/auth/login` | No | Validate credentials, return access token + set refresh cookie |
| POST | `/auth/refresh` | No (cookie) | Issue new access token from valid refresh cookie |
| POST | `/auth/logout` | No | Clear refresh cookie |

**`POST /auth/login`**
- Body: `{ "username": str, "password": str }`
- On success: returns `{ "access_token": str, "token_type": "bearer", "username": str }`; sets `refresh_token` httpOnly, SameSite=Strict cookie (30-day expiry)
- On failure: 401

**`POST /auth/refresh`**
- Reads `refresh_token` httpOnly cookie
- On success: returns `{ "access_token": str, "token_type": "bearer", "username": str }`
- On failure (missing/expired/invalid cookie): 401

**`POST /auth/logout`**
- Clears the `refresh_token` cookie (sets max-age=0)
- Always returns 200

### Token configuration
- `JWT_SECRET` — env var, required at startup (access token signing key)
- `REFRESH_SECRET` — env var, required at startup (refresh token signing key)
- Access token TTL: 30 minutes
- Refresh token TTL: 30 days
- App refuses to start if either secret is missing

### Protecting existing routes
A `require_current_user` FastAPI dependency is added to `src/auth/dependencies.py`. It:
1. Reads the `Authorization: Bearer <token>` header
2. Decodes and validates the JWT using `JWT_SECRET`
3. Loads the user from SQLite, checks `is_active`
4. Returns the user or raises 401

All existing routers (`bags`, `search`, `indexing`, `chat`, `datasets`, `image`) add `Depends(require_current_user)` to their route handlers. The dependency is applied at the router level via `router = APIRouter(..., dependencies=[Depends(require_current_user)])`.

### CLI user management
`scripts/manage_users.py` — standalone script using `argparse`:

```
python scripts/manage_users.py add-user <username>
python scripts/manage_users.py delete-user <username>    # sets is_active=0
python scripts/manage_users.py list-users
python scripts/manage_users.py reset-password <username>
```

`add-user` and `reset-password` prompt for the password interactively (no echo). Passwords are hashed with bcrypt before storage. Hard deletion is not supported; `delete-user` deactivates the account to preserve audit history.

**Behavior on conflicts:**
- `add-user` on an existing username: exits with non-zero status and prints an error. Use `reset-password` to change an existing user's password.
- `delete-user` on a non-existent or already-inactive username: exits with non-zero status and a clear message.
- `reset-password` on a non-existent or inactive user: exits with non-zero status.

### Database initialization
The `users.db` file and its parent directory are created on first need by a single `ensure_db_initialized()` function in `src/auth/db.py`. This function:
1. Calls `path.parent.mkdir(parents=True, exist_ok=True)` on the resolved DB path.
2. Opens a connection and runs `CREATE TABLE IF NOT EXISTS users ...`.

`ensure_db_initialized()` is called from two places:
- The FastAPI lifespan startup (before the `yield` in `app.py`)
- The CLI entrypoint (so the CLI works before the server has ever run)

Idempotent in both cases.

### Logout semantics
`POST /auth/logout` is a soft logout: it clears the refresh cookie on the client but does not revoke the refresh token server-side (stateless JWT — no blocklist). A stolen refresh token remains valid until its 30-day TTL expires. This is an intentional trade-off for an internal tool; a revocation list can be added later if needed (see Out of Scope).

---

## 3. Frontend — Auth Layer

### New files
- `src/context/auth-context.tsx` — `AuthContext` + `AuthProvider`
- `src/pages/login.tsx` — login page
- `src/components/layout/protected-route.tsx` — route guard

### `AuthContext`
```ts
interface AuthState {
  accessToken: string | null;
  username: string | null;
  isLoading: boolean;  // true while silent refresh is in-flight on mount
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

On mount, `AuthProvider` calls `POST /auth/refresh`. While the request is in-flight `isLoading = true`; the app renders a full-screen spinner. If the refresh succeeds the token is stored in state. If it fails (no cookie or expired) `isLoading` becomes false with `accessToken = null` and `ProtectedRoute` naturally redirects to `/login` on the next render.

Token is kept in React state only — never written to localStorage or sessionStorage. The silent-refresh flow and the auth-failure callback from the API client both update the same internal React state via `useState`, so no public `setToken` is needed.

### `ProtectedRoute`
Wraps `<Outlet>`. Reads `isLoading` and `accessToken` from `AuthContext`:
- `isLoading = true` → renders full-screen spinner
- `accessToken = null` → `<Navigate to="/login" replace />`
- otherwise → `<Outlet />`

### Login page
Centered card with username + password fields. On submit calls `login()` from context. On success React Router navigates to `/`. Error message rendered inline below the form.

### API client changes (`src/api/client.ts`)
Token injection uses a module-level setter to avoid refactoring all existing call sites:
```ts
let _token: string | null = null;
export function setClientToken(token: string | null): void { _token = token; }
```
`AuthContext` calls `setClientToken` whenever the token changes (login, refresh, logout). The existing `http<T>()` function reads `_token` internally and attaches `Authorization: Bearer <token>` on every request.

On a 401 response `http()`:
1. Calls the module-level `refreshToken()` helper once, guarded by a singleton `refreshPromise` to prevent concurrent refresh storms.
2. If refresh succeeds, updates `_token` via `setClientToken` and retries the original request.
3. If refresh fails, calls a module-level `onAuthFailure` callback and throws the original 401.

The `onAuthFailure` callback is registered by `AuthProvider` on mount via `setAuthFailureHandler(() => { setAccessToken(null); setUsername(null); })`. It does **not** imperatively navigate — clearing the token triggers a `ProtectedRoute` re-render, which redirects to `/login` via `<Navigate>`. This keeps all navigation inside React Router and avoids needing `useNavigate()` outside a component.

**Concurrent refresh guard:**
```ts
let refreshPromise: Promise<string> | null = null;

async function refreshToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
```

---

## 4. Routing Scaffold & Layout

### Library
React Router v6 (`react-router-dom`).

### Route tree
```
/login                           LoginPage           (public)
/                                ProtectedRoute
  /                              MainLayout          (layout route with <Outlet/>)
    index                        DashboardPage
    /workspace                   WorkspacePage       (legacy UI — replaced in Phases 2–4)
    /search                      redirect → /workspace  (transitional)
    /bags/*                      (Phase 2 — stub card)
    /datasets/*                  (Phase 4 — stub card)
```

`ProtectedRoute` is the auth guard; `MainLayout` is the visual shell. Separating them keeps responsibilities clean: one decides whether to render anything, the other decides how the page is framed.

### `MainLayout` refactor
The current `MainLayout` accepts `sidebar`, `header`, `children` as props and is constructed top-down from `App.tsx`. The refactor:

- `MainLayout` becomes a layout route component that renders a persistent top bar, a context-sensitive sidebar slot, and `<Outlet />` for the active page.
- The top bar is rendered inside `MainLayout` once (not per page). It shows the app name on the left and a user badge (username + Logout button calling `logout()` from `AuthContext`) on the right.
- The sidebar slot is page-owned: each page renders its own sidebar content via a small `SidebarSlot` context (or portal), so the sidebar stays visually anchored but its content matches the active route. Pages that don't need a sidebar (e.g., `DashboardPage`) render nothing into the slot and `MainLayout` collapses it.
- The existing `Sidebar` component (`components/layout/sidebar.tsx`) — with its Bags/Jobs tabs — becomes the sidebar content rendered by `WorkspacePage` in Phase 1. Phases 2–4 replace it with their own sidebar content.

### `DashboardPage`
Grid of section cards. Each card shows a title, short description, and a "coming soon" badge for unimplemented phases. Cards link to their respective routes. Implemented from day one so the shell is complete.

Sections:
| Card | Route | Status |
|------|-------|--------|
| Bag Explorer | `/bags` | Phase 2 |
| Workspace (legacy) | `/workspace` | Phase 1 (existing UI) |
| Datasets | `/datasets` | Phase 4 |

### `WorkspacePage` — legacy UI holder
The current single-page UI (bag scanner + bag list + search bar + results grid + sequence viewer + jobs panel + extract dialog) is moved verbatim from `App.tsx` into `src/pages/workspace.tsx`. All existing hooks (`use-bags`, `use-search`, `use-sequence-viewer`, `use-extraction-jobs`, `use-extraction-launcher`) move with it. This is a relocation, not a rewrite — no behavior change.

This page is explicitly temporary. Phases 2–4 carve features out into dedicated pages:
- Phase 2 pulls bag scanning, bag browsing, and the sequence viewer into `/bags`.
- Phase 3 pulls the search bar and results grid into `/search`.
- Phase 4 builds `/datasets`.

Once Phase 4 is complete, `/workspace` and its page file are deleted. Naming it `workspace` (rather than `search`) makes the temporary nature clear and avoids confusion with the real Phase 3 `/search` route. `/search` is wired as a redirect to `/workspace` during Phase 1 so existing bookmarks don't break.

### `App.tsx` refactor
`App.tsx` becomes a thin shell:
```tsx
export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
```

The `router` is defined in `src/router.tsx` using `createBrowserRouter`. All page-level state now lives inside the pages that own it.

---

## 5. Error States & Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Expired refresh token on page load | Silent refresh returns 401 → `isLoading = false`, `accessToken = null` → redirect to `/login`. No flash. |
| Two API calls 401 simultaneously | Both await the same `refreshPromise` singleton. Only one refresh request fires. |
| Deactivated user with valid token | `require_current_user` checks `is_active`; returns 401. Frontend treats as expired, triggers refresh → refresh also 401 → logout. |
| JWT secret missing at startup | FastAPI lifespan raises `RuntimeError` immediately; server does not start. |
| CORS during dev (port 5173 → 8000) | Vite proxy forwards `/api` and `/auth` to port 8000. Cookie is same-origin from browser perspective; no CORS cookie config changes needed. |

---

## 6. Testing & Migration of Existing Tests

### Existing test situation
Three test files exist: `tests/test_api.py`, `tests/test_api_contracts.py`, `tests/test_temporal_dedup.py`. They hit the FastAPI app via `httpx` without authentication. Adding `Depends(require_current_user)` at the router level will cause every one of them to 401 unless a bypass is in place.

### Bypass strategy
A shared pytest fixture in `tests/conftest.py` overrides the `require_current_user` dependency for the entire test suite:

```python
@pytest.fixture
def client(app):
    from src.auth.dependencies import require_current_user
    app.dependency_overrides[require_current_user] = lambda: FakeUser(username="test", is_active=True)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
```

This is the standard FastAPI pattern for test-time auth bypass. Existing tests switch to this `client` fixture instead of constructing their own — one-line change per test file.

### New auth tests
New test file `tests/test_auth.py` covers:
- Successful login with valid credentials issues access token + refresh cookie.
- Login with wrong password returns 401.
- Login with inactive user returns 401.
- `/auth/refresh` with a valid refresh cookie returns a new access token.
- `/auth/refresh` with no cookie returns 401.
- `/auth/refresh` with an expired refresh cookie returns 401 (use a short-TTL override for the test).
- `/auth/logout` clears the refresh cookie.
- A protected endpoint (e.g., `/api/bags/scan`) returns 401 without a token and 200 with one.
- `require_current_user` rejects tokens for deactivated users.

### CLI tests
Not required for Phase 1 — the CLI is a thin argparse wrapper around the same `src/auth` helpers that are exercised by the auth tests. A smoke test that `add-user` + `list-users` round-trip correctly is sufficient (`tests/test_manage_users.py`).

---

## 7. Out of Scope for This Phase

- Password change UI (admin CLI only)
- User roles / permissions beyond active/inactive
- Account lockout / rate limiting on login attempts
- Audit log UI
- Server-side refresh token revocation list (hard logout)
- Bag Explorer, Search page refactor, Dataset Inspector (Phases 2–4)
