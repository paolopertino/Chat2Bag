# Map-home UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the bag list into one grouped, nested sidebar with per-bag visibility and visible indexing failures; stop the results rail from obstructing controls; make similarity thresholds configurable per search type; and fix global image search.

**Architecture:** Backend gains a persisted indexing-error store surfaced via `/scan` and `/status` (pytest-TDD). The frontend collapses two duplicate bag-state instances into the single `BagsProvider` context, adds localStorage-backed visibility + per-type thresholds, derives a folder tree from bag paths, and routes image-upload through a global-or-region branch.

**Tech Stack:** Python 3.10 (FastAPI, pytest), TypeScript (React 19, Vite 8, Tailwind), MapLibre GL. Backend tests: `PYTHONPATH="" uv run pytest`. Frontend has **no test runner** — verify with `cd frontend && npm run lint` and `npm run build`, plus the manual checks each task lists.

**Conventions:** Commit messages use the repo's tag style (`[Backend]`, `[API]`, `[UI]`). Branch is `feat/frontend-refactor` (work continues here). Stage only the files each task names.

**Pre-flight (working-tree state):** At plan time the tree had coherent uncommitted WIP — an `AreaDrawChip` extraction touching `frontend/src/components/omnibox/omnibox.tsx` + `frontend/src/pages/map-home.tsx` plus the untracked `frontend/src/components/omnibox/area-draw-chip.tsx`. This plan's on-disk starting point already includes it. Task 0 commits that WIP first so subsequent task commits stay clean. If the tree is already clean when you start (someone committed it), skip Task 0.

---

## File Structure

**Backend (modify):**
- `src/utils/paths.py` — add `ERRORS_PATH`.
- `src/api/state.py` — add `indexing_errors` store.
- `src/services/indexing_service.py` — accept `error_store`, record/clear messages, catch-all.
- `src/api/dependencies.py` — inject `indexing_errors`.
- `src/api/bags.py` — return `error_message` from `/scan` and `/status`.
- `tests/test_bags_status_error.py` — new router tests for `error_message`.

**Frontend (create):**
- `frontend/src/lib/bag-tree.ts` — pure tree-building from bag paths.
- `frontend/src/components/map/bag-tree.tsx` — nested/collapsible sidebar list.
- `frontend/src/hooks/use-search-thresholds.ts` — per-type thresholds (localStorage).

**Frontend (modify):**
- `frontend/src/hooks/use-bags.ts` — capture scanned root, visibility state, retry; drop dead selection API.
- `frontend/src/hooks/use-url-search.ts` — scope from visible bags; drop `bags`/`minScore` URL params; return raw results.
- `frontend/src/hooks/use-omnibox-search.ts` — modality + threshold filter; image global/region branch; drop `urlBags`/`setBags`/`minScore`.
- `frontend/src/components/search/filter-chip.tsx` — two threshold sliders.
- `frontend/src/components/search/region-support-dialog.tsx` — enable Done at 0 points; adaptive label.
- `frontend/src/components/omnibox/omnibox.tsx` — remove bag chip + `showBagChip`; pass threshold props.
- `frontend/src/components/map/map-side-panel.tsx` — render `BagTree`; lift `open` state out.
- `frontend/src/pages/map-home.tsx` — single bag state; visibility-scoped tracks; lifted sidebar state; rail re-layout.
- `frontend/src/pages/bag-viewer.tsx` — drop the removed `showBagChip` prop.
- `frontend/src/api/client.ts` — add `resetIndex`.

**Frontend (delete):**
- `frontend/src/components/bags/bag-list.tsx` — dead code.

---

## Task 0: Pre-flight — commit the existing AreaDrawChip WIP

**Files:**
- Commit (pre-existing changes): `frontend/src/components/omnibox/omnibox.tsx`, `frontend/src/pages/map-home.tsx`, `frontend/src/components/omnibox/area-draw-chip.tsx`

- [ ] **Step 1: Confirm the working tree state**

Run: `git status --short`
Expected: `M frontend/src/components/omnibox/omnibox.tsx`, `M frontend/src/pages/map-home.tsx`, `?? frontend/src/components/omnibox/area-draw-chip.tsx` (plus untracked `docs/`). If none of these appear, the WIP is already committed — **skip to Task 1**.

- [ ] **Step 2: Sanity-check the build with the WIP in place**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors (the AreaDrawChip extraction is self-contained and compiles).

- [ ] **Step 3: Commit the WIP as its own change**

```bash
git add frontend/src/components/omnibox/omnibox.tsx frontend/src/pages/map-home.tsx frontend/src/components/omnibox/area-draw-chip.tsx
git commit -m "[UI] Extract AreaDrawChip from the omnibox area control"
```

- [ ] **Step 4: Confirm a clean tree (ignoring docs/)**

Run: `git status --short frontend src`
Expected: no `frontend/` or `src/` entries remain.

---

## Task 1: Backend — IndexingService records the failure reason

**Files:**
- Modify: `src/utils/paths.py`
- Modify: `src/api/state.py`
- Modify: `src/services/indexing_service.py:16-26,40-61`
- Test: `tests/test_indexing_service.py` (already committed and currently failing)

- [ ] **Step 1: Run the existing failing test to confirm the starting point**

Run: `PYTHONPATH="" uv run pytest tests/test_indexing_service.py -v`
Expected: FAIL — `TypeError: IndexingService.__init__() got an unexpected keyword argument 'error_store'`.

- [ ] **Step 2: Add the errors state file path**

In `src/utils/paths.py`, after the `STATE_PATH` line add:

```python
ERRORS_PATH = PROJECT_ROOT / ".bag_gpt_errors.json"
```

- [ ] **Step 3: Add the `indexing_errors` store**

In `src/api/state.py`, change the import and the singleton at the bottom:

```python
from src.utils.paths import ERRORS_PATH, STATE_PATH
```

```python
indexing_status = PersistentStatusStore(STATE_PATH)
indexing_errors = PersistentStatusStore(ERRORS_PATH)
```

- [ ] **Step 4: Accept and populate `error_store` in `IndexingService`**

In `src/services/indexing_service.py`, replace the constructor (lines 16-26) with:

```python
    def __init__(
        self,
        factory: BackendComponentFactory,
        status_store: MutableMapping[str, str],
        searcher: GlobalSearcher | None = None,
        region_searcher=None,
        error_store: MutableMapping[str, str] | None = None,
    ):
        self._factory = factory
        self._status_store = status_store
        self._searcher = searcher
        self._region_searcher = region_searcher
        self._error_store = error_store if error_store is not None else {}
```

Then replace the body of `index_bag` (lines 40-61) with:

```python
    def index_bag(self, bag_path: str) -> None:
        """Run extraction and indexing for a validated absolute bag path."""
        resolved_bag_path = str(Path(bag_path).expanduser().resolve())
        self._status_store[resolved_bag_path] = "indexing"
        self._error_store.pop(resolved_bag_path, None)
        try:
            parser = self._factory.create_bag_parser(resolved_bag_path)
            parser.extract_frames()
            indexer = self._factory.create_indexer(resolved_bag_path)
            indexer.build_index()
            self._status_store[resolved_bag_path] = "done"
            self._error_store.pop(resolved_bag_path, None)
            logger.info("Successfully indexed %s", resolved_bag_path)
            if self._searcher is not None:
                db_path = str(indexer.db_path)
                self._searcher.invalidate_cache(db_path)
                logger.debug("Invalidated LanceDB cache for %s", db_path)
            if self._region_searcher is not None:
                region_dir = str(indexer.artifact_dir / "region")
                self._region_searcher.invalidate_cache(region_dir)
                logger.debug("Invalidated region index cache for %s", region_dir)
        except Exception as exc:  # noqa: BLE001 - any failure marks the bag as errored
            self._status_store[resolved_bag_path] = "error"
            self._error_store[resolved_bag_path] = str(exc)
            logger.exception("Indexing failed for %s", resolved_bag_path)
```

Note: the `except` is broadened from the four specific types to `Exception` so *any* unexpected failure is recorded (matching the committed test's plain `Exception`). `Exception` does not catch `KeyboardInterrupt`/`SystemExit`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `PYTHONPATH="" uv run pytest tests/test_indexing_service.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add src/utils/paths.py src/api/state.py src/services/indexing_service.py
git commit -m "[Backend] Record indexing failure reason in an error store"
```

---

## Task 2: Backend — expose `error_message` from `/scan` and `/status`

**Files:**
- Modify: `src/api/dependencies.py:3,12-18`
- Modify: `src/api/bags.py:10,97-106,111-126`
- Test: `tests/test_bags_status_error.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_bags_status_error.py`:

```python
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import bags_router


def _client(bypass_auth):
    app = FastAPI()
    app.include_router(bags_router)
    bypass_auth(app)
    return TestClient(app)


def test_status_returns_error_message(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "broken_bag"
    bag.mkdir()
    resolved = str(bag.resolve())
    monkeypatch.setattr("src.api.bags.indexing_status", {resolved: "error"})
    monkeypatch.setattr("src.api.bags.indexing_errors", {resolved: "boom while extracting"})

    resp = _client(bypass_auth).get("/api/bags/status", params={"bag_path": resolved})

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert body["error_message"] == "boom while extracting"


def test_status_error_message_is_null_when_clean(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "ok_bag"
    bag.mkdir()
    resolved = str(bag.resolve())
    monkeypatch.setattr("src.api.bags.indexing_status", {})
    monkeypatch.setattr("src.api.bags.indexing_errors", {})

    resp = _client(bypass_auth).get("/api/bags/status", params={"bag_path": resolved})

    assert resp.status_code == 200
    assert resp.json()["error_message"] is None


def test_scan_includes_error_message_per_bag(tmp_path, bypass_auth, monkeypatch):
    bag = tmp_path / "2025-10-23_15-42"
    bag.mkdir()
    (bag / "rec.mcap").write_bytes(b"")
    resolved = str(bag.resolve())
    monkeypatch.setattr("src.api.bags.indexing_status", {resolved: "error"})
    monkeypatch.setattr("src.api.bags.indexing_errors", {resolved: "kaput"})

    resp = _client(bypass_auth).get("/api/bags/scan", params={"root_dir": str(tmp_path)})

    assert resp.status_code == 200
    found = [b for b in resp.json()["bags"] if b["bag_path"] == resolved]
    assert len(found) == 1
    assert found[0]["error_message"] == "kaput"
    assert found[0]["status"] == "error"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PYTHONPATH="" uv run pytest tests/test_bags_status_error.py -v`
Expected: FAIL — `AttributeError` on `src.api.bags.indexing_errors` (not imported yet) and/or `KeyError: 'error_message'`.

- [ ] **Step 3: Inject the error store into the service**

In `src/api/dependencies.py`, update the import (line 3) and `get_indexing_service` (lines 12-18):

```python
from src.api.state import indexing_errors, indexing_status
```

```python
def get_indexing_service(request: Request) -> IndexingService:
    return IndexingService(
        factory=request.app.state.component_factory,
        status_store=indexing_status,
        searcher=request.app.state.searcher_instance,
        region_searcher=getattr(request.app.state, "region_searcher_instance", None),
        error_store=indexing_errors,
    )
```

- [ ] **Step 4: Return `error_message` from the bag routes**

In `src/api/bags.py`, update the state import (line 10):

```python
from src.api.state import indexing_errors, indexing_status
```

In `scan_bags`, add `error_message` to the appended dict (the dict currently ending at line 106):

```python
        bags.append(
            {
                "bag_path": bag_path,
                "bag_name": candidate.name,
                "is_indexed": lancedb_dir.exists() and lancedb_dir.is_dir(),
                "status": indexing_status.get(bag_path, "idle"),
                "is_located": gps_is_located(stamp),
                "located_frame_count": int(stamp.get("located_frame_count", 0)) if stamp else 0,
                "error_message": indexing_errors.get(bag_path),
            }
        )
```

In `bag_status`, replace the final `return` (lines 124-126) with:

```python
    return {
        "bag_path": resolved_path,
        "status": status,
        "error_message": indexing_errors.get(resolved_path),
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PYTHONPATH="" uv run pytest tests/test_bags_status_error.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `PYTHONPATH="" uv run pytest tests/ -q`
Expected: all pass (the previously-red `test_indexing_service.py` is now green too).

- [ ] **Step 7: Commit**

```bash
git add src/api/dependencies.py src/api/bags.py tests/test_bags_status_error.py
git commit -m "[API] Surface indexing error_message from scan and status"
```

---

## Task 3: Frontend — collapse the duplicate bag state into one instance

**Files:**
- Modify: `frontend/src/hooks/use-bags.ts`
- Modify: `frontend/src/pages/map-home.tsx:18,25-27`
- Delete: `frontend/src/components/bags/bag-list.tsx`

- [ ] **Step 1: Capture the scanned root and drop the dead selection API in `use-bags.ts`**

In `frontend/src/hooks/use-bags.ts`:

Add a `scannedRoot` state next to the other `useState` declarations (after the `lastScannedRootDir` line):

```typescript
  const [scannedRoot, setScannedRoot] = useState<string | null>(null);
```

In `onScan`, record the resolved root from the response. Replace:

```typescript
      const data = await scanBags(trimmedRootDir);
      setLastScannedRootDir(trimmedRootDir);
      setBags(data.bags);
      setSelectedBagPaths((prev) =>
        prev.filter((bagPath) => data.bags.some((bag) => bag.bag_path === bagPath)),
      );
      toast.success(`Found ${data.bags.length} bag(s).`);
```

with:

```typescript
      const data = await scanBags(trimmedRootDir);
      setLastScannedRootDir(trimmedRootDir);
      setScannedRoot(data.root_dir);
      setBags(data.bags);
      toast.success(`Found ${data.bags.length} bag(s).`);
```

Delete the now-dead `selectedBagPaths` state and the `toggleBagSelection` / `toggleAllBags` callbacks. Remove this line:

```typescript
  const [selectedBagPaths, setSelectedBagPaths] = useState<string[]>([]);
```

Remove the whole `toggleBagSelection` callback (the `useCallback` block) and the whole `toggleAllBags` callback block.

In `unregisterBag`, remove the `setSelectedBagPaths(...)` line so it becomes:

```typescript
  const unregisterBag = useCallback((bagPath: string) => {
    setBags((prev) => prev.filter((b) => b.bag_path !== bagPath));
  }, []);
```

In the returned object, remove `selectedBagPaths`, `toggleBagSelection`, `toggleAllBags`, and add `scannedRoot`:

```typescript
  return {
    rootDir,
    setRootDir,
    scannedRoot,
    bags,
    isScanning,
    isPolling,
    lastScannedRootDir,
    onScan,
    onIndex,
    registerBag,
    unregisterBag,
  };
```

- [ ] **Step 2: Make `MapHomePage` use the shared context instead of its own instance**

In `frontend/src/pages/map-home.tsx`, replace the import (line 18):

```typescript
import { useBags } from "../context/bags-context";
```

Replace the hook call (line 25) and the inline indexed-paths line (lines 26-27):

```typescript
  const bagsState = useBags();
```

(The fleet-tracks line that referenced `indexedPaths` is rewritten in Task 5; for now leave `const { tracks } = useFleetTracks(indexedPaths);` compiling by replacing the deleted `indexedPaths` line with:)

```typescript
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
```

(Net change in this step: only the `useBagsState()` → `useBags()` import + call. `indexedPaths` stays until Task 5.)

- [ ] **Step 3: Delete the dead `BagList` component**

```bash
git rm frontend/src/components/bags/bag-list.tsx
```

If `frontend/src/components/bags/` is now empty, that's fine — leave it or let git drop it.

- [ ] **Step 4: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors. (If lint flags an unused `useBagsState` import anywhere, remove it.)

- [ ] **Step 5: Manual check**

Start the app, confirm the sidebar still lists bags after a scan and indexing status still polls. There should now be a single auto-scan on load (not two).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/use-bags.ts frontend/src/pages/map-home.tsx
git commit -m "[UI] Use one shared bag-state instance; capture scanned root"
```

---

## Task 4: Frontend — per-bag visibility state (localStorage)

**Files:**
- Modify: `frontend/src/hooks/use-bags.ts`

- [ ] **Step 1: Add the visibility state and helpers**

In `frontend/src/hooks/use-bags.ts`, add a storage key next to `ROOT_DIR_STORAGE_KEY`:

```typescript
const HIDDEN_BAGS_STORAGE_KEY = "bag_gpt_hidden_bags";

function loadHiddenBags(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_BAGS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}
```

Add the state + persistence inside `useBagsState` (near the other state hooks):

```typescript
  const [hiddenBagPaths, setHiddenBagPaths] = useState<Set<string>>(loadHiddenBags);

  useEffect(() => {
    window.localStorage.setItem(
      HIDDEN_BAGS_STORAGE_KEY,
      JSON.stringify([...hiddenBagPaths]),
    );
  }, [hiddenBagPaths]);

  const toggleBagVisibility = useCallback((bagPath: string) => {
    setHiddenBagPaths((prev) => {
      const next = new Set(prev);
      if (next.has(bagPath)) next.delete(bagPath);
      else next.add(bagPath);
      return next;
    });
  }, []);

  const setBagsHidden = useCallback((bagPaths: string[], hidden: boolean) => {
    setHiddenBagPaths((prev) => {
      const next = new Set(prev);
      for (const p of bagPaths) {
        if (hidden) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  }, []);

  const isBagHidden = useCallback(
    (bagPath: string) => hiddenBagPaths.has(bagPath),
    [hiddenBagPaths],
  );

  const visibleIndexedBagPaths = useMemo(
    () =>
      bags
        .filter((b) => b.is_indexed && !hiddenBagPaths.has(b.bag_path))
        .map((b) => b.bag_path),
    [bags, hiddenBagPaths],
  );
```

Add all of these to the returned object: `hiddenBagPaths`, `toggleBagVisibility`, `setBagsHidden`, `isBagHidden`, `visibleIndexedBagPaths`.

- [ ] **Step 2: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors. (`useMemo` is already imported in this file.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-bags.ts
git commit -m "[UI] Add persisted per-bag visibility state"
```

---

## Task 5: Frontend — search scope & tracks follow visibility; remove the omnibox bag chip

**Files:**
- Modify: `frontend/src/hooks/use-url-search.ts`
- Modify: `frontend/src/hooks/use-omnibox-search.ts`
- Modify: `frontend/src/components/omnibox/omnibox.tsx`
- Modify: `frontend/src/pages/bag-viewer.tsx:94-101`
- Modify: `frontend/src/pages/map-home.tsx:26-27`

- [ ] **Step 1: Drive `useUrlSearch` scope from visible bags; drop the `bags` URL param**

In `frontend/src/hooks/use-url-search.ts`:

Remove the now-unused imports `decodeBagId` and `toast` (keep `decodeArea`). Remove the `parseBags` and `decodeBagIds` helper functions entirely.

Change the bags source. Replace:

```typescript
  const { bags } = useBags();
```

with:

```typescript
  const { visibleIndexedBagPaths } = useBags();
```

Remove the `allIndexedBagPaths` memo, the `urlBags` memo, the `bagPathsFromUrl`/`malformedCount` memo, and the malformed-IDs `useEffect` (the whole toast block).

Replace the `effectiveBagPaths` memo with:

```typescript
  const effectiveBagPaths = useMemo(
    () => (options.scope ? options.scope.bagPaths : visibleIndexedBagPaths),
    [options.scope, visibleIndexedBagPaths],
  );
```

Remove the `setBags` callback. In the returned object remove `urlBags` and `setBags`.

- [ ] **Step 2: Drop `urlBags`/`setBags` from the omnibox search interface**

In `frontend/src/hooks/use-omnibox-search.ts`:

In the `OmniboxSearch` interface remove the `urlBags: string[];` and `setBags: (ids: string[]) => void;` lines.

In the returned object remove `urlBags: url.urlBags,` and `setBags: url.setBags,` (keep `bagPaths: url.bagPaths,`).

- [ ] **Step 3: Remove the bag chip from the omnibox**

In `frontend/src/components/omnibox/omnibox.tsx`:

Remove the import `import { BagPickerChip } from "../search/bag-picker-chip";`.

Remove the `showBagChip?: boolean;` line from `OmniboxProps`, and remove `showBagChip = true,` from the destructured params.

Delete the entire `showBagChip ? (...) : null` block (the `<BagPickerChip ... />` wrapper, lines 103-108).

- [ ] **Step 4: Stop passing the removed prop from the bag viewer**

In `frontend/src/pages/bag-viewer.tsx`, remove the `showBagChip={false}` line from the `<Omnibox>` usage (keep `showAreaChip={false}`).

- [ ] **Step 5: Point fleet tracks at visible bags**

In `frontend/src/pages/map-home.tsx`, replace:

```typescript
  const indexedPaths = bagsState.bags.filter((b) => b.is_indexed).map((b) => b.bag_path);
  const { tracks } = useFleetTracks(indexedPaths);
```

with:

```typescript
  const { tracks } = useFleetTracks(bagsState.visibleIndexedBagPaths);
```

- [ ] **Step 6: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors. (`bag-picker-chip.tsx` is now unreferenced — leave the file; it can be deleted in a later cleanup if desired. The build must not import it.)

- [ ] **Step 7: Manual check**

Search runs across all indexed bags (nothing hidden yet). The omnibox no longer shows a bag chip. The bag viewer still searches its single bag.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/use-url-search.ts frontend/src/hooks/use-omnibox-search.ts frontend/src/components/omnibox/omnibox.tsx frontend/src/pages/bag-viewer.tsx frontend/src/pages/map-home.tsx
git commit -m "[UI] Scope search and tracks to visible bags; drop omnibox bag chip"
```

---

## Task 6: Frontend — pure bag-tree builder

**Files:**
- Create: `frontend/src/lib/bag-tree.ts`

- [ ] **Step 1: Write the tree builder**

Create `frontend/src/lib/bag-tree.ts`:

```typescript
import type { BagInfo } from "../api/types";

export interface BagTreeLeaf {
  kind: "bag";
  bag: BagInfo;
}

export interface BagTreeGroup {
  kind: "group";
  /** Folder segment name shown in the UI. */
  name: string;
  /** Root-relative path of the group; stable key + collapse id. */
  path: string;
  children: BagTreeNode[];
  /** Every descendant bag_path (for group-level visibility toggles). */
  bagPaths: string[];
}

export type BagTreeNode = BagTreeGroup | BagTreeLeaf;

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, "");
}

/** Path of `bagPath` relative to `root`, or just the leaf name when `root`
 * is null or is not a prefix (defensive fallback → flat list). */
function relativeToRoot(bagPath: string, root: string | null): string {
  const bp = stripTrailingSlash(bagPath);
  if (root) {
    const r = stripTrailingSlash(root);
    if (bp === r) return bp.split("/").pop() ?? bp;
    if (bp.startsWith(r + "/")) return bp.slice(r.length + 1);
  }
  return bp.split("/").pop() ?? bp;
}

/**
 * Build a nested tree mirroring the on-disk layout. Intermediate folder
 * segments become collapsible groups; the final segment is a bag leaf.
 * `bags` is assumed pre-sorted by path (the scan endpoint sorts it).
 */
export function buildBagTree(bags: BagInfo[], root: string | null): BagTreeNode[] {
  const rootNodes: BagTreeNode[] = [];
  const groupByPath = new Map<string, BagTreeGroup>();

  for (const bag of bags) {
    const rel = relativeToRoot(bag.bag_path, root);
    const segments = rel.split("/").filter(Boolean);
    const groupSegs = segments.slice(0, -1);

    if (groupSegs.length === 0) {
      rootNodes.push({ kind: "bag", bag });
      continue;
    }

    let siblings = rootNodes;
    let accPath = "";
    for (const seg of groupSegs) {
      accPath = accPath ? `${accPath}/${seg}` : seg;
      let group = groupByPath.get(accPath);
      if (!group) {
        group = { kind: "group", name: seg, path: accPath, children: [], bagPaths: [] };
        groupByPath.set(accPath, group);
        siblings.push(group);
      }
      group.bagPaths.push(bag.bag_path);
      siblings = group.children;
    }
    siblings.push({ kind: "bag", bag });
  }

  return rootNodes;
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual reasoning check (no test runner)**

Confirm by inspection against the real layout:
- `…/bags/2025-10-23_15-42` (root = `…/bags`) → `rel = "2025-10-23_15-42"` → top-level leaf.
- `…/bags/2026-05-19/2026-05-19_17-19_normal` → `rel = "2026-05-19/2026-05-19_17-19_normal"` → group `2026-05-19` (its `bagPaths` includes both nested bags) containing two leaves.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/bag-tree.ts
git commit -m "[UI] Add pure bag-tree builder from bag paths"
```

---

## Task 7: Frontend — `resetIndex` client helper + retry action

**Files:**
- Modify: `frontend/src/api/client.ts:193-198`
- Modify: `frontend/src/hooks/use-bags.ts`

- [ ] **Step 1: Add `resetIndex` to the API client**

In `frontend/src/api/client.ts`, after the `indexBag` function (ends line 198) add:

```typescript
export async function resetIndex(bagPath: string): Promise<void> {
  await http<{ bag_path: string; status: string }>(
    `/api/index?bag_path=${encodeURIComponent(bagPath)}`,
    { method: "DELETE" },
  );
}
```

- [ ] **Step 2: Add `onRetry` and clear stale error on (re)index**

In `frontend/src/hooks/use-bags.ts`, update the import:

```typescript
import { getBagStatus, indexBag, resetIndex, scanBags } from "../api/client";
```

In `onIndex`, clear the optimistic state so the failed badge disappears immediately. Replace the `setBags(...)` call inside `onIndex` with:

```typescript
      setBags((prev) =>
        prev.map((bag) =>
          bag.bag_path === bagPath
            ? { ...bag, status: "indexing", error_message: null }
            : bag,
        ),
      );
```

Add an `onRetry` callback after `onIndex`:

```typescript
  const onRetry = useCallback(
    async (bagPath: string) => {
      try {
        await resetIndex(bagPath);
      } catch {
        // Reset is best-effort; re-indexing will overwrite the status anyway.
      }
      await onIndex(bagPath);
    },
    [onIndex],
  );
```

Add `onRetry` to the returned object.

- [ ] **Step 3: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/use-bags.ts
git commit -m "[UI] Add reset-index client helper and bag retry action"
```

---

## Task 8: Frontend — nested, collapsible `BagTree` with visibility & failures

**Files:**
- Create: `frontend/src/components/map/bag-tree.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/map/bag-tree.tsx`:

```typescript
import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { buildBagTree, type BagTreeNode } from "../../lib/bag-tree";
import { trackColor } from "./fleet-tracks-layer";

interface BagTreeProps {
  bags: BagInfo[];
  root: string | null;
  /** bag_paths in track-draw order, for matching the color dot. */
  locatedOrder: string[];
  isBagHidden: (bagPath: string) => boolean;
  onToggleBagVisibility: (bagPath: string) => void;
  onSetGroupHidden: (bagPaths: string[], hidden: boolean) => void;
  onIndex: (bagPath: string) => void;
  onRetry: (bagPath: string) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
}

function statusBadge(bag: BagInfo): string {
  if (bag.status === "indexing") return "⏳ indexing";
  if (bag.status === "error") return "⚠ failed";
  if (!bag.is_indexed) return "not indexed";
  if (!bag.is_located) return "⚠ no GPS";
  return "✓";
}

export function BagTree(props: BagTreeProps) {
  const tree = useMemo(() => buildBagTree(props.bags, props.root), [props.bags, props.root]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: BagTreeNode, depth: number): ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 8}px` };

    if (node.kind === "group") {
      const isOpen = !collapsed.has(node.path);
      const allHidden = node.bagPaths.every((p) => props.isBagHidden(p));
      return (
        <li key={`g:${node.path}`}>
          <div
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-white/5"
            style={pad}
          >
            <button
              onClick={() => toggleCollapse(node.path)}
              aria-label={isOpen ? "Collapse group" : "Expand group"}
              className="flex-none"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
            <span className="flex-none text-xs opacity-50">({node.bagPaths.length})</span>
            <button
              onClick={() => props.onSetGroupHidden(node.bagPaths, !allHidden)}
              aria-label={allHidden ? "Show all in group" : "Hide all in group"}
              title={allHidden ? "Show all in group" : "Hide all in group"}
              className="flex-none opacity-70 hover:opacity-100"
            >
              {allHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {isOpen ? (
            <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
          ) : null}
        </li>
      );
    }

    const bag = node.bag;
    const colorIdx = props.locatedOrder.indexOf(bag.bag_path);
    const hidden = props.isBagHidden(bag.bag_path);
    return (
      <li key={`b:${bag.bag_path}`}>
        <div
          className={
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5 " +
            (hidden ? "opacity-40" : "")
          }
          style={pad}
          onMouseEnter={() => props.onHoverBag(bag.bag_path)}
          onMouseLeave={() => props.onHoverBag(null)}
        >
          <span
            className="h-2 w-2 flex-none rounded-full"
            style={{ background: colorIdx >= 0 ? trackColor(colorIdx) : "#777" }}
          />
          <button
            className="min-w-0 flex-1 truncate text-left"
            onClick={() => bag.is_indexed && props.onOpenBag(bag.bag_path)}
            disabled={!bag.is_indexed}
            title={bag.is_indexed ? "Open in bag viewer" : undefined}
          >
            {bag.bag_name}
          </button>

          {bag.status === "error" ? (
            <span
              className="flex flex-none items-center gap-1 text-xs text-red-400"
              title={bag.error_message ?? "Indexing failed"}
            >
              <AlertTriangle className="h-3 w-3" /> failed
            </span>
          ) : (
            <span className="flex-none text-xs opacity-70">{statusBadge(bag)}</span>
          )}

          {bag.status === "error" ? (
            <button
              className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
              onClick={() => props.onRetry(bag.bag_path)}
              title="Reset and re-index"
            >
              retry
            </button>
          ) : !bag.is_indexed && bag.status !== "indexing" ? (
            <button
              className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
              onClick={() => props.onIndex(bag.bag_path)}
            >
              index
            </button>
          ) : null}

          <button
            onClick={() => props.onToggleBagVisibility(bag.bag_path)}
            aria-label={hidden ? "Show bag" : "Hide bag"}
            title={hidden ? "Show on map & include in search" : "Hide from map & search"}
            className="flex-none opacity-70 hover:opacity-100"
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </li>
    );
  };

  if (props.bags.length === 0) {
    return (
      <p className="p-3 text-center text-xs opacity-60">
        No bags. Set a root directory and scan.
      </p>
    );
  }

  return <ul className="min-h-0 flex-1 overflow-y-auto p-1">{tree.map((n) => renderNode(n, 0))}</ul>;
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/map/bag-tree.tsx
git commit -m "[UI] Add nested BagTree with visibility toggles and failure display"
```

---

## Task 9: Frontend — wire `BagTree` into the side panel and lift sidebar open state

**Files:**
- Modify: `frontend/src/components/map/map-side-panel.tsx`
- Modify: `frontend/src/pages/map-home.tsx:28-31,109-120`

- [ ] **Step 1: Rewrite `MapSidePanel` to render `BagTree` and take `open` from props**

Replace the entire contents of `frontend/src/components/map/map-side-panel.tsx` with:

```typescript
import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { BagTree } from "./bag-tree";

interface MapSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bags: BagInfo[];
  root: string | null;
  locatedOrder: string[];
  rootDir: string;
  setRootDir: (dir: string) => void;
  isScanning: boolean;
  onScan: () => void;
  onIndex: (bagPath: string) => void;
  onRetry: (bagPath: string) => void;
  isBagHidden: (bagPath: string) => boolean;
  onToggleBagVisibility: (bagPath: string) => void;
  onSetGroupHidden: (bagPaths: string[], hidden: boolean) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
  jobsTab: ReactNode;
}

export function MapSidePanel(props: MapSidePanelProps) {
  const [tab, setTab] = useState<"bags" | "jobs">("bags");

  if (!props.open) {
    return (
      <button
        className="absolute left-4 top-20 z-10 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2"
        onClick={() => props.onOpenChange(true)}
        aria-label="Open bag panel"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute bottom-28 left-4 top-20 z-10 flex w-72 flex-col rounded-lg border border-[var(--line)] bg-[var(--glass)] shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-1 text-sm">
          <button
            className={tab === "bags" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("bags")}
          >
            Bags
          </button>
          <span className="opacity-30">·</span>
          <button
            className={tab === "jobs" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("jobs")}
          >
            Jobs
          </button>
        </div>
        <button onClick={() => props.onOpenChange(false)} aria-label="Collapse panel">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {tab === "bags" ? (
        <>
          <div className="flex gap-2 border-b border-[var(--line)] p-2">
            <input
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              value={props.rootDir}
              placeholder="bags root directory"
              onChange={(e) => props.setRootDir(e.target.value)}
            />
            <button
              className="rounded border border-[var(--line)] px-2"
              onClick={props.onScan}
              disabled={props.isScanning}
              aria-label="Scan root"
            >
              <RefreshCw className={"h-4 w-4" + (props.isScanning ? " animate-spin" : "")} />
            </button>
          </div>
          <BagTree
            bags={props.bags}
            root={props.root}
            locatedOrder={props.locatedOrder}
            isBagHidden={props.isBagHidden}
            onToggleBagVisibility={props.onToggleBagVisibility}
            onSetGroupHidden={props.onSetGroupHidden}
            onIndex={props.onIndex}
            onRetry={props.onRetry}
            onHoverBag={props.onHoverBag}
            onOpenBag={props.onOpenBag}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{props.jobsTab}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lift sidebar open state and pass the new props from `MapHomePage`**

In `frontend/src/pages/map-home.tsx`, add the open state alongside the other `useState` hooks (after the `trackPreview` state line):

```typescript
  const [sidebarOpen, setSidebarOpen] = useState(true);
```

Replace the `<MapSidePanel ... />` usage (lines 109-120) with:

```typescript
      <MapSidePanel
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        bags={bagsState.bags}
        root={bagsState.scannedRoot}
        locatedOrder={tracks.map((t) => t.bag_path)}
        rootDir={bagsState.rootDir}
        setRootDir={bagsState.setRootDir}
        isScanning={bagsState.isScanning}
        onScan={bagsState.onScan}
        onIndex={bagsState.onIndex}
        onRetry={bagsState.onRetry}
        isBagHidden={bagsState.isBagHidden}
        onToggleBagVisibility={bagsState.toggleBagVisibility}
        onSetGroupHidden={bagsState.setBagsHidden}
        onHoverBag={setHoveredBagPath}
        onOpenBag={openBag}
        jobsTab={<JobsTab />}
      />
```

- [ ] **Step 3: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual check**

Scan the real `bags/` directory. Confirm:
- `2026-05-19` shows as a collapsible group with two child bags; `2025-10-23_15-42` shows at top level.
- Toggling a bag's eye dims it, removes its track from the map, and excludes it from search results.
- A failed bag shows a red "failed" badge (hover shows the reason) with a "retry" button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/map-side-panel.tsx frontend/src/pages/map-home.tsx
git commit -m "[UI] Render grouped BagTree in the side panel; lift its open state"
```

---

## Task 10: Frontend — re-layout the results rail to clear the sidebar and map controls

**Files:**
- Modify: `frontend/src/pages/map-home.tsx:101-108`

- [ ] **Step 1: Make the rail inset depend on the sidebar state**

In `frontend/src/pages/map-home.tsx`, replace the `<ResultsRail ... className="absolute inset-x-4 bottom-4 z-10" />` usage with:

```typescript
      <ResultsRail
        results={search.results}
        selectedIndex={lightboxIndex}
        onSelect={setLightboxIndex}
        onLoadMore={search.loadMore}
        isSearching={search.isSearching}
        className={
          "absolute bottom-4 right-14 z-10 " + (sidebarOpen ? "left-[20rem]" : "left-4")
        }
      />
```

Rationale: `right-14` (3.5rem) clears MapLibre's bottom-right `NavigationControl` and the compact attribution; `left-[20rem]` clears the open sidebar (`left-4` + `w-72` = 19rem) with a gap, and `left-4` reclaims the width when the sidebar is collapsed.

- [ ] **Step 2: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual check**

Run a search. The rail no longer covers the zoom buttons (bottom-right) and no longer hugs the sidebar; collapsing the sidebar widens the rail.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/map-home.tsx
git commit -m "[UI] Inset results rail to clear sidebar and map controls"
```

---

## Task 11: Frontend — per-type similarity thresholds

**Files:**
- Create: `frontend/src/hooks/use-search-thresholds.ts`
- Modify: `frontend/src/hooks/use-url-search.ts`
- Modify: `frontend/src/hooks/use-omnibox-search.ts`
- Modify: `frontend/src/components/search/filter-chip.tsx`
- Modify: `frontend/src/components/omnibox/omnibox.tsx:110-117`

- [ ] **Step 1: Create the thresholds hook**

Create `frontend/src/hooks/use-search-thresholds.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";

const TEXT_KEY = "bag_gpt_threshold_text";
const VISUAL_KEY = "bag_gpt_threshold_visual";
const TEXT_DEFAULT = 0.14;
const VISUAL_DEFAULT = 0.8;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function load(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clamp01(n) : fallback;
}

export interface SearchThresholds {
  text: number;
  visual: number;
  setText: (v: number) => void;
  setVisual: (v: number) => void;
}

export function useSearchThresholds(): SearchThresholds {
  const [text, setTextState] = useState(() => load(TEXT_KEY, TEXT_DEFAULT));
  const [visual, setVisualState] = useState(() => load(VISUAL_KEY, VISUAL_DEFAULT));

  useEffect(() => {
    window.localStorage.setItem(TEXT_KEY, String(text));
  }, [text]);
  useEffect(() => {
    window.localStorage.setItem(VISUAL_KEY, String(visual));
  }, [visual]);

  const setText = useCallback((v: number) => setTextState(clamp01(v)), []);
  const setVisual = useCallback((v: number) => setVisualState(clamp01(v)), []);

  return { text, visual, setText, setVisual };
}
```

- [ ] **Step 2: Strip the single `minScore` out of `useUrlSearch`**

In `frontend/src/hooks/use-url-search.ts`:

Remove the `MIN_SCORE_DEFAULT` constant. Remove `rawMinScoreStr`, `rawMinScore`, and the `minScore` line. In the clamp-writeback `useEffect`, remove the `minScore`/`rawMinScoreStr` branch and its dependency, keeping only the `topK` handling:

```typescript
  useEffect(() => {
    if (!rawTopKStr || String(topK) === rawTopKStr) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("topK", String(topK));
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTopKStr]);
```

Remove the `setMinScore` callback and the `filteredResults` memo. Change the return so `results` is the **raw** results:

```typescript
    results: search.results,
    rawResultCount: search.results.length,
```

Remove `minScore` and `setMinScore` from the returned object.

- [ ] **Step 3: Add modality + threshold filtering to `useOmniboxSearch`**

In `frontend/src/hooks/use-omnibox-search.ts`:

Add the import:

```typescript
import { useSearchThresholds } from "./use-search-thresholds";
```

In the `OmniboxSearch` interface, remove `minScore: number;` and `setMinScore: (s: number) => void;`, and add:

```typescript
  textThreshold: number;
  visualThreshold: number;
  setTextThreshold: (v: number) => void;
  setVisualThreshold: (v: number) => void;
  activeThreshold: number;
  modality: "text" | "visual" | null;
```

Inside the hook, add state and the thresholds hook (near the other `useState` calls):

```typescript
  const thresholds = useSearchThresholds();
  const [modality, setModality] = useState<"text" | "visual" | null>(null);
  const activeThreshold = modality === "visual" ? thresholds.visual : thresholds.text;
```

Replace the results-derivation block (the `regionActive ? ... : url.results` lines and `rawResultCount`) with:

```typescript
  const regionActive = region.query !== null;
  const rawResults = regionActive ? region.results : url.results;
  const results = rawResults.filter((r) => (r.similarity_score ?? 1) >= activeThreshold);
  const rawResultCount = regionActive ? region.results.length : url.rawResultCount;
```

Set the modality at each submit branch. In `submit()`:

```typescript
  function submit() {
    if (support && points.length > 0) {
      url.clear();
      setModality("visual");
      runRegion(url.topK);
      return;
    }
    if (support?.kind === "upload") {
      region.clear();
      setModality("visual");
      void url.submitImage(support.file); // Global image search
      return;
    }
    if (text.trim()) {
      if (regionMode) {
        url.clear();
        setModality("text");
        region.runText(text.trim(), url.bagPaths, url.topK, area ?? undefined);
      } else {
        region.clear();
        setModality("text");
        url.submitText(text.trim());
      }
      return;
    }
    region.clear();
    setModality(null);
    url.submitText("");
  }
```

Replace `submitSupportRegion` with the global-or-region branch:

```typescript
  function submitSupportRegion(nextPoints: Point[], chosenFilePath?: string) {
    let effective = support;
    if (chosenFilePath && support?.kind === "frame" && chosenFilePath !== support.filePath) {
      effective = { ...support, filePath: chosenFilePath };
      setSupport(effective, nextPoints);
    } else {
      setPoints(nextPoints);
    }
    if (!effective) return;

    setModality("visual");
    if (nextPoints.length === 0) {
      // No region points placed → run a whole-frame (global) search.
      region.clear();
      if (effective.kind === "upload") void url.submitImage(effective.file);
      else url.submitSimilar(effective.filePath);
      return;
    }
    url.clear();
    runRegionWith(effective, url.topK, nextPoints);
  }
```

In `clear()`, add `setModality(null);`.

In the returned object, remove `minScore`/`setMinScore` and add:

```typescript
    textThreshold: thresholds.text,
    visualThreshold: thresholds.visual,
    setTextThreshold: thresholds.setText,
    setVisualThreshold: thresholds.setVisual,
    activeThreshold,
    modality,
```

- [ ] **Step 4: Give `FilterChip` two threshold sliders**

Replace the contents of `frontend/src/components/search/filter-chip.tsx` with:

```typescript
import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FilterChipProps {
  topK: number;
  /** The threshold in effect for the current search modality (display only). */
  activeThreshold: number;
  textThreshold: number;
  visualThreshold: number;
  /** Total raw hits returned from backend (before client-side filter). */
  rawResultCount: number;
  /** How many bags were searched (display only). */
  bagCount: number;
  /** Whether to show the topK slider (false on per-bag search). */
  showTopK?: boolean;
  onTopKChange: (k: number) => void;
  onTextThresholdChange: (s: number) => void;
  onVisualThresholdChange: (s: number) => void;
}

export function FilterChip({
  topK,
  activeThreshold,
  textThreshold,
  visualThreshold,
  rawResultCount,
  bagCount,
  showTopK = true,
  onTopKChange,
  onTextThresholdChange,
  onVisualThresholdChange,
}: FilterChipProps) {
  const [expanded, setExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [expanded]);

  return (
    <div
      ref={wrapRef}
      className="rounded-md border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {showTopK ? (
            <span>
              K=<strong>{topK}</strong>
            </span>
          ) : null}
          <span>
            ≥<strong>{activeThreshold.toFixed(2)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[var(--teal)] hover:underline"
          >
            <Settings2 className="h-3 w-3" />
            {expanded ? "Hide" : "Adjust"}
          </button>
        </div>
        <div className="text-[var(--ink-soft)]">
          {rawResultCount} hit{rawResultCount === 1 ? "" : "s"} · {bagCount} bag
          {bagCount === 1 ? "" : "s"}
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {showTopK ? (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[var(--ink-soft)]">Top K: {topK}</span>
              <input
                type="range"
                min={1}
                max={100}
                value={topK}
                onChange={(e) => onTopKChange(Number(e.target.value))}
                className="w-full accent-[var(--teal)]"
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-[var(--ink-soft)]">
              Text min: {textThreshold.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={textThreshold}
              onChange={(e) => onTextThresholdChange(Number(e.target.value))}
              className="w-full accent-[var(--teal)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[var(--ink-soft)]">
              Visual min: {visualThreshold.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={visualThreshold}
              onChange={(e) => onVisualThresholdChange(Number(e.target.value))}
              className="w-full accent-[var(--teal)]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Update the `FilterChip` usage in the omnibox**

In `frontend/src/components/omnibox/omnibox.tsx`, replace the `<FilterChip ... />` block with:

```typescript
        <FilterChip
          topK={search.topK}
          activeThreshold={search.activeThreshold}
          textThreshold={search.textThreshold}
          visualThreshold={search.visualThreshold}
          rawResultCount={search.rawResultCount}
          bagCount={search.bagPaths.length}
          onTopKChange={search.setTopK}
          onTextThresholdChange={search.setTextThreshold}
          onVisualThresholdChange={search.setVisualThreshold}
        />
```

- [ ] **Step 6: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual check**

- Text search: results filter at ≥0.14 by default; the chip shows `≥0.14`.
- Image/region search: filters at ≥0.80; the chip shows `≥0.80`.
- Adjusting either slider updates the filter live and persists across a reload.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/use-search-thresholds.ts frontend/src/hooks/use-url-search.ts frontend/src/hooks/use-omnibox-search.ts frontend/src/components/search/filter-chip.tsx frontend/src/components/omnibox/omnibox.tsx
git commit -m "[UI] Configurable per-type similarity thresholds (text/visual)"
```

---

## Task 12: Frontend — image upload runs global *or* region search

**Files:**
- Modify: `frontend/src/components/search/region-support-dialog.tsx:151-158`

- [ ] **Step 1: Enable Done at zero points and adapt its label**

In `frontend/src/components/search/region-support-dialog.tsx`, replace the Done `<Button>` (the one currently `disabled={points.length === 0}`) with:

```typescript
            <Button
              type="button"
              size="sm"
              onClick={() => onConfirm(points, selected ?? undefined)}
            >
              {points.length === 0 ? "Global search" : "Region search"}
            </Button>
```

(The "Clear" button keeps its `disabled={points.length === 0}`.)

- [ ] **Step 2: Verify lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual check**

- Upload an image → the point dialog opens. Press **Global search** (no points) → a whole-frame image search runs and returns results.
- Re-open the support chip, place ≥1 point, press **Region search** → region results + heatmap behave as before.
- From a bag frame ("Use as region support"): zero points → similar-image (global) search; ≥1 point → region search.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/search/region-support-dialog.tsx
git commit -m "[UI] Image upload: Done with no points runs global search"
```

(The zero-point routing logic in `useOmniboxSearch.submitSupportRegion` was added in Task 11; this task only flips the dialog gate.)

---

## Task 13: Full verification pass

- [ ] **Step 1: Backend suite**

Run: `PYTHONPATH="" uv run pytest tests/ -q`
Expected: all pass.

- [ ] **Step 2: Frontend lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: End-to-end manual checklist**

With `npm run build` then `JWT_SECRET=… REFRESH_SECRET=… uv run uvicorn app:app --reload`, log in and verify against the real `bags/` directory:
- [ ] Bag list appears only in the sidebar (no omnibox bag chip); grouped folders are collapsible; deeply-nested bags nest correctly.
- [ ] A failed index shows "failed" + reason tooltip + working retry.
- [ ] Hiding a bag removes its GPS track and excludes it from search; state survives a reload.
- [ ] The results rail clears the zoom controls and the sidebar; collapsing the sidebar widens it.
- [ ] Text searches default to ≥0.14, visual to ≥0.80; both sliders persist.
- [ ] Uploading an image and pressing Done with no points runs a global image search.

- [ ] **Step 4: Update the project changelog note**

In `CLAUDE.md`, under **Status**, append a dated line noting the map-home UI improvements (single bag tree with visibility, per-type thresholds, image-search fix, error surfacing). Keep it to one or two sentences.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "[Docs] Note map-home UI improvements in project status"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** §0 unify state → Task 3; §1 nested tree + failures → Tasks 6, 8, 9 (+ backend Tasks 1–2 for the reason); §2 visibility → Tasks 4, 8, 9; §3 search scope → Task 5; §4 rail → Task 10; §5 thresholds → Task 11; §6 image upload → Tasks 11 (routing) + 12 (gate); §7 backend → Tasks 1, 2. Dead-code removal (`BagList`, selection API) → Task 3.
- **Type consistency:** the bag-state additions (`scannedRoot`, `visibleIndexedBagPaths`, `isBagHidden`, `toggleBagVisibility`, `setBagsHidden`, `onRetry`) are produced in Tasks 3/4/7 and consumed in Tasks 5/8/9. `OmniboxSearch` loses `urlBags`/`setBags`/`minScore`/`setMinScore` (Tasks 5, 11) and gains `textThreshold`/`visualThreshold`/`setTextThreshold`/`setVisualThreshold`/`activeThreshold`/`modality` (Task 11) — `FilterChip` and `Omnibox` are updated in the same task.
- **Ordering guard:** `useOmniboxSearch.submitSupportRegion`'s zero-point branch (Task 11) lands before the dialog gate is opened (Task 12), so the global path exists when the button is enabled.
