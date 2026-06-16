# TopBar → floating chip + glass login redesign — Design

**Date:** 2026-06-16
**Branch:** `feat/frontend-refactor`

## Goal

Remove the global `TopBar` and surface its still-needed controls in a compact frosted-glass chip floating over the map/bag surfaces; redesign the login page from a white-page-with-card into a full-bleed blurred satellite map with a centered glass sign-in card. No backend or auth-logic changes.

## Part A — Floating utility chip (replaces the TopBar)

**New component: `frontend/src/components/layout/utility-chip.tsx`**
- A single frosted-glass pill: `bg-[var(--glass)] backdrop-blur border border-[var(--line)] rounded-full`, matching the omnibox/side-panel treatment.
- Contents, left → right:
  - **Bag-GPT** wordmark — `<Link to="/">`, the "back to map / home" affordance (replaces the TopBar brand link).
  - **username** — `text-[var(--ink-soft)]`, hidden when null.
  - **logout** — icon button (`LogOut`), `onClick={() => void logout()}`.
- Consumes `useAuth()` for `username` + `logout`. No other state.

**`frontend/src/components/layout/full-bleed-layout.tsx`**
- Drop `<TopBar/>`. The layout becomes the full-height `<main className="relative ..."><Outlet/></main>` plus the chip rendered as a `fixed top-3 right-3 z-40` overlay sibling, so it appears on **both** the map home and the bag viewer with no per-page wiring.

**Deletions (now dead code):**
- `frontend/src/components/layout/top-bar.tsx` — removed.
- `frontend/src/components/layout/jobs-dropdown.tsx` — removed. It was imported only by the TopBar; the map side panel uses a separate `JobsTab`.

**Jobs (per user decision):** Jobs stay only in the map-home left side panel (`MapSidePanel`'s Jobs tab). The chip does **not** carry Jobs.
- **Accepted consequence:** the bag viewer has no side panel, so after this change it has no Jobs affordance. Extraction jobs are launched from search results and monitored from the map home. (Revisit only if a bag-viewer Jobs control is later wanted.)

**Collision handling:**
- Map home: top-right is free (zoom + basemap controls live bottom-right), so the chip overlays cleanly.
- Bag viewer (`frontend/src/pages/bag-viewer.tsx`): its top control row is right-aligned (Region support, etc.). Add right padding (`pr-44`, ~11rem) to that row so its rightmost button stops before the chip. The `{bagName}` title stays; "back to map" is the chip's wordmark.

## Part B — Login page redesign

**`frontend/src/components/map/maplibre-map.tsx` (targeted enhancement)**
- Add an optional prop `interactive?: boolean` (default `true`). When `false`:
  - pass `interactive: false` to the `maplibregl.Map` constructor (disables all interaction handlers in one shot), and
  - skip `addControl(new NavigationControl(...))` so no zoom buttons render.
- Existing callers are unaffected (default keeps current behavior).

**New: force satellite on the login backdrop**
- A small child component `frontend/src/pages/login-satellite.tsx` that, via `useMap()` + `whenStyleReady(map, ...)`, sets `setLayoutProperty(SATELLITE_LAYER_ID, "visibility", "visible")` regardless of the saved basemap pref. Ordering is safe: `MapLibreMap` adds the satellite layer in its own `style.load` handler (registered first), and `whenStyleReady` runs after, so the layer exists when the child fires.

**`frontend/src/pages/login.tsx`**
- Replace the white `bg-[var(--canvas)]` page with a full-bleed (`fixed inset-0`) backdrop: a wrapper containing `<MapLibreMap interactive={false}><LoginSatellite/></MapLibreMap>`, CSS-blurred (`filter: blur(...)`) with `pointer-events-none`, plus a dark dim overlay (`bg-black/30`) for contrast.
- The form moves into a **centered frosted-glass card** (`bg-[var(--glass)] backdrop-blur border-[var(--line)]`, replacing the solid shadcn `Card`), keeping the existing Username/Password `Input`s, submit `Button`, error display, and **all auth logic unchanged** (`login`, `isLoading`/`accessToken` redirect, error handling). Tiles are public, so the map renders pre-auth.

## Reuse / unchanged
- Reuses: `MapLibreMap`, `lib/basemap.ts` (`SATELLITE_LAYER_ID`, `whenStyleReady`), `--glass`/`--line`/`--ink`/`--ink-soft` tokens, `ui/button`, `ui/input`, `useAuth`.
- Unchanged: auth backend + endpoints, `AuthProvider`, routing structure, all other components.

## Files
- Create: `frontend/src/components/layout/utility-chip.tsx`, `frontend/src/pages/login-satellite.tsx`.
- Modify: `frontend/src/components/layout/full-bleed-layout.tsx`, `frontend/src/components/map/maplibre-map.tsx`, `frontend/src/pages/login.tsx`, `frontend/src/pages/bag-viewer.tsx` (top-row padding).
- Delete: `frontend/src/components/layout/top-bar.tsx`, `frontend/src/components/layout/jobs-dropdown.tsx`.

## Testing & verification
- `cd frontend && npm run lint && npm run build` — no errors (frontend has no test runner).
- Backend pytest suite is untouched (no backend change) and remains green.
- Manual: chip appears top-right on both map home and bag viewer; wordmark returns to `/`; logout works; no overlap with bag-viewer controls. Login shows the blurred satellite globe with a centered glass card and still authenticates and redirects.
