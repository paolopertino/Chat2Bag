# Phase 2 Bag Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/bags` Bag Explorer route (list + detail) + global top-bar jobs dropdown, without touching `/workspace`'s behaviour.

**Architecture:** Frontend-only refactor with one tiny read-only backend addition (`GET /api/bags/info`). New `BagsLayout` route owns `useBags()` and exposes it via `<Outlet context>`. `BagsListPage` shows a hero-state root-dir input that promotes to a top strip once a scan returns bags; the main area holds a collapsing folder tree. `BagDetailPage` renders a page-native sequence viewer with the tree in the sidebar. Extraction-job state lifts into a `JobsProvider` mounted inside `ProtectedRoute` so the new top-bar dropdown, the detail page's extract launcher, and the legacy `/workspace` Jobs tab share one polling loop.

**Tech Stack:** React 19 + React Router v6 + TypeScript + TailwindCSS + Vite + FastAPI (backend touch limited to one new endpoint).

**Design spec:** `docs/superpowers/specs/2026-04-24-bag-explorer-design.md`

**Deliberate deviation from spec:** The spec claims "no backend changes", but the detail page needs the bag's first-frame timestamp to open the viewer when no `?t=<ns>` is supplied (bag timestamps are Unix-epoch nanoseconds, so the frames endpoint's `start_ns=0` returns nothing). Task 1 adds one read-only endpoint `GET /api/bags/info` that reads metadata.json server-side. The design contract is otherwise unchanged.

---

## Verification Commands

**Environment prerequisites** (run once per shell):

```bash
cd /home/paolopertino/adehome/aida_code/bag_gpt
source .venv/bin/activate || uv sync
export JWT_SECRET="dev-jwt-secret-for-plan"
export REFRESH_SECRET="dev-refresh-secret-for-plan"
```

**Per-task verification** (use the steps that apply):

| Goal | Command | Expected |
|---|---|---|
| TypeScript + bundle | `cd frontend && npm run build` | Exits 0; produces `../static/` |
| Lint | `cd frontend && npm run lint` | Exits 0 |
| Backend tests | `PYTHONPATH="" uv run pytest tests/` | All green |
| Dev servers (frontend HMR) | `cd frontend && npm run dev` *(port 5173)*; separately `uv run uvicorn app:app --reload` *(port 8000)* | Open http://localhost:5173 |
| Production-style | `cd frontend && npm run build && cd .. && uv run uvicorn app:app --reload` | Open http://localhost:8000 |

Tests are a manual-QA + type-checker safety net (spec explicitly keeps Vitest out of Phase 2). Each UI task includes a concrete browser check.

**Commit style** matches the repo: `[UI]`, `[Backend]`, `[Docs]`, `[API]`.

---

## File Structure

### New files (17)

```
src/api/bags.py                                  # +1 new endpoint (/api/bags/info)

frontend/src/
├── lib/
│   └── bag-id.ts                                # base64url encode/decode helpers
├── context/
│   └── jobs-context.tsx                         # JobsProvider + useJobs()
├── pages/bags/
│   ├── bags-layout.tsx                          # owns useBags, <Outlet context>
│   ├── bags-list-page.tsx                       # /bags index — hero input + tree
│   └── bag-detail-page.tsx                      # /bags/:bagId — viewer + sidebar
└── components/
    ├── bags/
    │   ├── bag-tree.tsx                         # recursive folder tree
    │   ├── bag-root-input.tsx                   # hero + strip variants of path input
    │   ├── bag-root-chip.tsx                    # collapsed chip for detail sidebar
    │   └── bag-sequence-viewer.tsx              # page-native viewer
    └── layout/
        └── jobs-dropdown.tsx                    # top-bar popover wrapping JobsPanel
```

### Modified files (7)

```
src/api/bags.py                                  # new endpoint
frontend/src/api/client.ts                       # getBagInfo() method
frontend/src/api/types.ts                        # BagInfoResponse type
frontend/src/hooks/use-bags.ts                   # registerBag() action
frontend/src/hooks/use-sequence-viewer.ts        # openViewerForBag() entry
frontend/src/components/layout/protected-route.tsx   # mount <JobsProvider>
frontend/src/components/layout/top-bar.tsx       # render <JobsDropdown/>
frontend/src/pages/workspace.tsx                 # swap useExtractionJobs → useJobs
frontend/src/pages/dashboard.tsx                 # Bag Explorer card → "available"
frontend/src/router.tsx                          # replace /bags/* stub
CLAUDE.md                                        # mark Phase 2 ✅
```

---

## Task 1 — Add `/api/bags/info` endpoint

**Files:**
- Modify: `src/api/bags.py`

- [ ] **Step 1: Add the endpoint**

Open `src/api/bags.py` and append this handler after `bag_frames` (around line 158):

```python
@router.get("/info")
async def bag_info(
    bag_path: str = Query(..., description="Absolute path of bag directory"),
):
    path = Path(bag_path).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Bag path does not exist")

    artifact_dir = _artifact_dir_for_bag(path)
    metadata_path = artifact_dir / "metadata.json"
    if not metadata_path.exists() or not metadata_path.is_file():
        raise HTTPException(
            status_code=404, detail="Bag metadata not found. Index the bag first."
        )

    with metadata_path.open("r", encoding="utf-8") as metadata_handle:
        metadata = json.load(metadata_handle)

    frames = metadata.get("frames", [])
    if not frames:
        return {
            "bag_path": str(path),
            "frame_count": 0,
            "first_timestamp_ns": None,
            "last_timestamp_ns": None,
        }

    timestamps = sorted(
        frame["timestamp_ns"] for frame in frames if "timestamp_ns" in frame
    )
    return {
        "bag_path": str(path),
        "frame_count": len(timestamps),
        "first_timestamp_ns": timestamps[0] if timestamps else None,
        "last_timestamp_ns": timestamps[-1] if timestamps else None,
    }
```

- [ ] **Step 2: Verify tests still pass**

```bash
PYTHONPATH="" uv run pytest tests/ -q
```

Expected: no failures (no new tests; existing suite still green).

- [ ] **Step 3: Smoke-test the endpoint**

Start the server and hit the route with a known-indexed bag path. Replace `<PATH>` with a real indexed bag on your machine. (If no indexed bag exists, skip this step — the frontend integration in later tasks will cover it.)

```bash
JWT_SECRET=dev JWT=$(curl -s -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" -d '{"username":"<u>","password":"<p>"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "http://localhost:8000/api/bags/info?bag_path=<PATH>" -H "Authorization: Bearer $JWT"
```

Expected JSON: `{"bag_path": "<PATH>", "frame_count": N, "first_timestamp_ns": <int>, "last_timestamp_ns": <int>}`.

- [ ] **Step 4: Commit**

```bash
git add src/api/bags.py
git commit -m "[Backend] add /api/bags/info endpoint for bag metadata summary"
```

---

## Task 2 — Wire `getBagInfo` into the frontend client

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add the response type**

In `frontend/src/api/types.ts`, add the following after `BagStatusResponse` (around line 18):

```ts
export interface BagInfoResponse {
  bag_path: string;
  frame_count: number;
  first_timestamp_ns: number | null;
  last_timestamp_ns: number | null;
}
```

Also add the import symbol in `client.ts` below.

- [ ] **Step 2: Add the client method**

In `frontend/src/api/client.ts`, add `BagInfoResponse` to the top-of-file type import block, then add this export after `getBagStatus` (around line 201):

```ts
export async function getBagInfo(bagPath: string): Promise<BagInfoResponse> {
  return http<BagInfoResponse>(
    `/api/bags/info?bag_path=${encodeURIComponent(bagPath)}`,
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "[UI] add getBagInfo client method and BagInfoResponse type"
```

---

## Task 3 — Add bag ID encode/decode helpers

**Files:**
- Create: `frontend/src/lib/bag-id.ts`

- [ ] **Step 1: Write the helpers**

Create `frontend/src/lib/bag-id.ts`:

```ts
/**
 * URL-safe, reversible encoding of a bag's absolute filesystem path.
 * Used to put bag paths in route params without percent-encoding slashes.
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function encodeBagId(bagPath: string): string {
  return toBase64Url(new TextEncoder().encode(bagPath));
}

export function decodeBagId(bagId: string): string {
  return new TextDecoder().decode(fromBase64Url(bagId));
}
```

- [ ] **Step 2: Verify with a quick round-trip**

Add a temporary console check to validate the helpers (do NOT commit this — it's just for local confidence). Paste into a browser console after `npm run dev`:

```js
const { encodeBagId, decodeBagId } = await import("/src/lib/bag-id.ts");
const path = "/home/user/bags/project-x/run_001";
const id = encodeBagId(path);
console.assert(decodeBagId(id) === path, "round-trip mismatch");
console.log("ok:", id);
```

Or skip this step — later tasks exercise the helpers end-to-end. The TypeScript type check is the minimum safety bar:

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/bag-id.ts
git commit -m "[UI] add bag-id base64url encode/decode helpers"
```

---

## Task 4 — Add `JobsProvider` + `useJobs` context

**Files:**
- Create: `frontend/src/context/jobs-context.tsx`

- [ ] **Step 1: Write the context**

Create `frontend/src/context/jobs-context.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";

import { useExtractionJobs } from "../hooks/use-extraction-jobs";

type JobsState = ReturnType<typeof useExtractionJobs>;

const JobsContext = createContext<JobsState | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const state = useExtractionJobs();
  return <JobsContext.Provider value={state}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsState {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used inside <JobsProvider>");
  return ctx;
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0. (No consumers yet — purely additive.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/jobs-context.tsx
git commit -m "[UI] add JobsProvider and useJobs context"
```

---

## Task 5 — Mount `JobsProvider` and migrate `WorkspacePage` to `useJobs`

This is one commit because the two changes must land together: `ProtectedRoute` mounts the provider; `WorkspacePage` stops calling `useExtractionJobs` directly and reads from context. Without doing both at once, either `/workspace` breaks (no provider in the tree) or we have two competing polling loops.

**Files:**
- Modify: `frontend/src/components/layout/protected-route.tsx`
- Modify: `frontend/src/pages/workspace.tsx`

- [ ] **Step 1: Mount `JobsProvider` in `ProtectedRoute`**

Replace the existing `return <Outlet />` at the bottom of `frontend/src/components/layout/protected-route.tsx` (line 22) with:

```tsx
import { JobsProvider } from "../../context/jobs-context";

// ...existing code above...

  return (
    <JobsProvider>
      <Outlet />
    </JobsProvider>
  );
}
```

Place the `JobsProvider` import at the top of the file alongside the existing imports.

- [ ] **Step 2: Migrate `WorkspacePage`**

In `frontend/src/pages/workspace.tsx`:

1. Replace the `useExtractionJobs` import with `useJobs`:

```tsx
// Remove:
// import { useExtractionJobs } from "../hooks/use-extraction-jobs";

// Add:
import { useJobs } from "../context/jobs-context";
```

2. Replace the destructuring call on line 76-83:

```tsx
const {
  jobs,
  schema,
  extractionEnabled,
  isPolling: isExtractionPolling,
  refresh: refreshJobs,
  cancelJob,
  fetchLogs,
} = useJobs();
```

(Property names and shape are identical to `useExtractionJobs`, so nothing else in the file changes.)

- [ ] **Step 3: Verify build + lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Manual browser check**

1. Build and serve: `cd frontend && npm run build && cd .. && uv run uvicorn app:app --reload`.
2. Log in, go to `/workspace`.
3. Scan a bag directory, select a bag, click Index on any unindexed bag (or trigger an extraction if you have one ready).
4. Open the sidebar Jobs tab; confirm the existing behaviour (list rows, status badges, cancel, logs) is unchanged.
5. Open the browser devtools Network tab; confirm there is exactly **one** recurring `GET /api/datasets/jobs` request every 2 s while a job is active (not two — if two, the provider isn't wrapping correctly or a second `useExtractionJobs` caller lingers).

Expected: Jobs tab works identically to before. Single polling loop.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/protected-route.tsx frontend/src/pages/workspace.tsx
git commit -m "[UI] lift extraction jobs state into JobsProvider"
```

---

## Task 6 — Add `JobsDropdown` top-bar component

**Files:**
- Create: `frontend/src/components/layout/jobs-dropdown.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/layout/jobs-dropdown.tsx`:

```tsx
import { Briefcase } from "lucide-react";
import { useState } from "react";

import { useJobs } from "../../context/jobs-context";
import { JobsPanel } from "../extraction/jobs-panel";
import { Button } from "../ui/button";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function JobsDropdown() {
  const { extractionEnabled, jobs, cancelJob, fetchLogs } = useJobs();
  const [open, setOpen] = useState(false);

  if (!extractionEnabled) return null;

  const activeCount = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Briefcase className="mr-1.5 h-3.5 w-3.5" />
        Jobs
        {activeCount > 0 ? (
          <span className="ml-1.5 rounded-full bg-[var(--teal)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {activeCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-20 mt-2 w-[420px] max-h-[70vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
            {jobs.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--ink-soft)]">
                No extraction jobs yet.
              </p>
            ) : (
              <JobsPanel jobs={jobs} onCancel={cancelJob} onFetchLogs={fetchLogs} />
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/jobs-dropdown.tsx
git commit -m "[UI] add JobsDropdown top-bar component"
```

---

## Task 7 — Render `JobsDropdown` in the top bar

**Files:**
- Modify: `frontend/src/components/layout/top-bar.tsx`

- [ ] **Step 1: Add the import and render**

Edit `frontend/src/components/layout/top-bar.tsx`:

```tsx
import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { Button } from "../ui/button";
import { JobsDropdown } from "./jobs-dropdown";

export function TopBar() {
  const { username, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
      <Link to="/" className="text-base font-semibold tracking-tight text-[var(--ink)]">
        Bag-GPT
      </Link>
      <div className="flex items-center gap-3">
        <JobsDropdown />
        {username ? (
          <span className="text-sm text-[var(--ink-soft)]">{username}</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify build + lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Manual browser check**

1. Serve the app (as in Task 5).
2. On any authenticated page, confirm the `Jobs` button appears in the top bar next to the username — only if `extractionEnabled` is true. If your dev config disables extraction, it should render nothing (no button).
3. With extraction enabled, click the button; the popover should open with either "No extraction jobs yet." or the same list content as the `/workspace` Jobs tab.
4. Submit a new extraction from `/workspace`. Confirm the dropdown's pill badge increments from nothing to `Jobs 1` and the new row appears in both the dropdown and the `/workspace` sidebar.
5. Click outside the popover — it closes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/top-bar.tsx
git commit -m "[UI] render JobsDropdown in top bar"
```

---

## Task 8 — Extend `useBags` with `registerBag` / `unregisterBag`

**Files:**
- Modify: `frontend/src/hooks/use-bags.ts`

- [ ] **Step 1: Add the actions**

In `frontend/src/hooks/use-bags.ts`:

1. Add two callbacks inside the `useBags()` function body (after `onIndex`, before the polling `useEffect` on line 75):

```ts
const registerBag = useCallback((bag: BagInfo) => {
  setBags((prev) => {
    if (prev.some((b) => b.bag_path === bag.bag_path)) return prev;
    return [...prev, bag];
  });
}, []);

const unregisterBag = useCallback((bagPath: string) => {
  setBags((prev) => prev.filter((b) => b.bag_path !== bagPath));
  setSelectedBagPaths((prev) => prev.filter((p) => p !== bagPath));
}, []);
```

2. Add them to the returned object (after `toggleAllBags` on line 121):

```ts
return {
  rootDir,
  setRootDir,
  bags,
  selectedBagPaths,
  isScanning,
  isPolling,
  onScan,
  onIndex,
  toggleBagSelection,
  toggleAllBags,
  registerBag,
  unregisterBag,
};
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0. (TypeScript picks up the new return shape immediately; no consumer has to be updated because all existing callers destructure only a subset.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-bags.ts
git commit -m "[UI] add registerBag/unregisterBag actions to useBags"
```

---

## Task 9 — Add `BagTree` component

**Files:**
- Create: `frontend/src/components/bags/bag-tree.tsx`

- [ ] **Step 1: Write the tree**

Create `frontend/src/components/bags/bag-tree.tsx`:

```tsx
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { BagInfo } from "../../api/types";
import { encodeBagId } from "../../lib/bag-id";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type TreeNode =
  | { kind: "folder"; label: string; path: string; children: TreeNode[] }
  | { kind: "bag"; bag: BagInfo; label: string };

interface BagTreeProps {
  bags: BagInfo[];
  selectedBagPath: string | null;
  onIndex: (bagPath: string) => void;
  compact?: boolean;
}

function commonPrefixLength(paths: string[]): number {
  if (paths.length === 0) return 0;
  const parts0 = paths[0].split("/");
  let i = 0;
  outer: for (; i < parts0.length; i += 1) {
    for (let j = 1; j < paths.length; j += 1) {
      const partsJ = paths[j].split("/");
      if (partsJ[i] !== parts0[i]) break outer;
    }
  }
  return i;
}

function buildTree(bags: BagInfo[]): TreeNode[] {
  if (bags.length === 0) return [];

  const paths = bags.map((b) => b.bag_path);
  const skip = commonPrefixLength(paths);

  interface FolderAcc {
    kind: "folder";
    label: string;
    path: string;
    children: Map<string, FolderAcc | BagInfo>;
  }
  const root: FolderAcc = { kind: "folder", label: "", path: "", children: new Map() };

  for (const bag of bags) {
    const parts = bag.bag_path.split("/").filter(Boolean).slice(skip);
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      const existing = cursor.children.get(part);
      if (existing && "children" in existing) {
        cursor = existing;
      } else {
        const next: FolderAcc = {
          kind: "folder",
          label: part,
          path: `${cursor.path}/${part}`,
          children: new Map(),
        };
        cursor.children.set(part, next);
        cursor = next;
      }
    }
    const leafLabel = parts[parts.length - 1];
    cursor.children.set(leafLabel, bag);
  }

  function toNodes(folder: FolderAcc): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const [label, child] of folder.children.entries()) {
      if ("children" in child) {
        let collapsed = child;
        const collapsedLabels: string[] = [label];
        while (collapsed.children.size === 1) {
          const only = Array.from(collapsed.children.values())[0];
          if (!("children" in only)) break;
          collapsedLabels.push(only.label);
          collapsed = only;
        }
        nodes.push({
          kind: "folder",
          label: collapsedLabels.join("/"),
          path: collapsed.path,
          children: toNodes(collapsed),
        });
      } else {
        nodes.push({ kind: "bag", bag: child, label });
      }
    }
    return nodes;
  }

  return toNodes(root);
}

function FolderRow({
  node,
  selectedBagPath,
  onIndex,
  compact,
  defaultOpen,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  selectedBagPath: string | null;
  onIndex: (p: string) => void;
  compact: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--line)]/40"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
        <span className="truncate text-xs font-medium text-[var(--ink)]">{node.label}</span>
      </button>
      {open ? (
        <div className="ml-4 border-l border-[var(--line)] pl-2">
          {node.children.map((child) =>
            child.kind === "folder" ? (
              <FolderRow
                key={child.path}
                node={child}
                selectedBagPath={selectedBagPath}
                onIndex={onIndex}
                compact={compact}
                defaultOpen={defaultOpen}
              />
            ) : (
              <BagRow
                key={child.bag.bag_path}
                bag={child.bag}
                selected={child.bag.bag_path === selectedBagPath}
                onIndex={onIndex}
                compact={compact}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function BagRow({
  bag,
  selected,
  onIndex,
  compact,
}: {
  bag: BagInfo;
  selected: boolean;
  onIndex: (p: string) => void;
  compact: boolean;
}) {
  const isIndexing = bag.status === "indexing";
  return (
    <div
      className={`flex items-center gap-2 rounded px-1 py-1 ${
        selected ? "bg-[var(--teal)]/10" : "hover:bg-[var(--line)]/40"
      }`}
    >
      <Link
        to={`/bags/${encodeBagId(bag.bag_path)}`}
        className="min-w-0 flex-1 truncate text-xs"
      >
        <span
          className={`truncate ${
            selected ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]"
          }`}
        >
          {bag.bag_name}
        </span>
      </Link>
      <Badge variant={bag.status}>{bag.status}</Badge>
      {compact ? null : (
        <Button
          size="sm"
          variant="secondary"
          disabled={isIndexing}
          onClick={(e) => {
            e.preventDefault();
            onIndex(bag.bag_path);
          }}
        >
          {isIndexing ? <LoaderCircle className="mr-2 h-3 w-3 animate-spin" /> : null}
          {isIndexing ? "Indexing" : bag.is_indexed ? "Re-index" : "Index"}
        </Button>
      )}
    </div>
  );
}

export function BagTree({
  bags,
  selectedBagPath,
  onIndex,
  compact = false,
}: BagTreeProps) {
  const tree = useMemo(() => buildTree(bags), [bags]);

  if (bags.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--line)] p-3 text-xs text-[var(--ink-soft)]">
        Scan a root directory to list bags.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) =>
        node.kind === "folder" ? (
          <FolderRow
            key={node.path}
            node={node}
            selectedBagPath={selectedBagPath}
            onIndex={onIndex}
            compact={compact}
            defaultOpen
          />
        ) : (
          <BagRow
            key={node.bag.bag_path}
            bag={node.bag}
            selected={node.bag.bag_path === selectedBagPath}
            onIndex={onIndex}
            compact={compact}
          />
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bags/bag-tree.tsx
git commit -m "[UI] add BagTree component with collapsing single-child folders"
```

---

## Task 10 — Add `BagRootInput` (hero + strip) and `BagRootChip`

**Files:**
- Create: `frontend/src/components/bags/bag-root-input.tsx`
- Create: `frontend/src/components/bags/bag-root-chip.tsx`

- [ ] **Step 1: Write `BagRootInput`**

Create `frontend/src/components/bags/bag-root-input.tsx`:

```tsx
import { Search } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface BagRootInputProps {
  rootDir: string;
  onRootDirChange: (value: string) => void;
  onScan: () => void;
  isScanning: boolean;
  variant: "hero" | "strip";
  emptyMessage?: string | null;
}

export function BagRootInput({
  rootDir,
  onRootDirChange,
  onScan,
  isScanning,
  variant,
  emptyMessage,
}: BagRootInputProps) {
  const isHero = variant === "hero";

  return (
    <div
      className={
        isHero
          ? "mx-auto flex w-full max-w-2xl flex-col items-stretch gap-3 py-24 text-center transition-all"
          : "flex w-full items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3 transition-all"
      }
    >
      {isHero ? (
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bag Explorer</h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Enter a directory to scan for ROS2 bag folders.
          </p>
        </div>
      ) : null}
      <form
        className={isHero ? "flex w-full gap-2" : "flex flex-1 gap-2"}
        onSubmit={(e) => {
          e.preventDefault();
          onScan();
        }}
      >
        <Input
          id="root-dir"
          value={rootDir}
          onChange={(event) => onRootDirChange(event.target.value)}
          placeholder="/home/user/bags"
          className={isHero ? "h-11 text-base" : undefined}
          autoFocus={isHero}
        />
        <Button type="submit" disabled={isScanning} className="min-w-24">
          <Search className="mr-2 h-4 w-4" />
          {isScanning ? "Scanning" : "Scan"}
        </Button>
      </form>
      {isHero && emptyMessage ? (
        <p className="text-sm text-[var(--ink-soft)]">{emptyMessage}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write `BagRootChip`**

Create `frontend/src/components/bags/bag-root-chip.tsx`:

```tsx
import { FolderSearch, Pencil } from "lucide-react";
import { useState } from "react";

import { BagRootInput } from "./bag-root-input";

interface BagRootChipProps {
  rootDir: string;
  onRootDirChange: (value: string) => void;
  onScan: () => void;
  isScanning: boolean;
}

export function BagRootChip(props: BagRootChipProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded-md border border-[var(--line)] bg-white p-2">
        <BagRootInput
          {...props}
          variant="strip"
          onScan={() => {
            props.onScan();
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex w-full items-center gap-2 rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-left hover:bg-[var(--line)]/30"
      title={props.rootDir || "No root directory set"}
    >
      <FolderSearch className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink)]">
        {props.rootDir || "Set root directory"}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-[var(--ink-soft)]" />
    </button>
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/bags/bag-root-input.tsx frontend/src/components/bags/bag-root-chip.tsx
git commit -m "[UI] add BagRootInput (hero/strip) and BagRootChip components"
```

---

## Task 11 — Add `BagsLayout` route component

**Files:**
- Create: `frontend/src/pages/bags/bags-layout.tsx`

- [ ] **Step 1: Write the layout**

Create `frontend/src/pages/bags/bags-layout.tsx`:

```tsx
import { Outlet } from "react-router-dom";

import { useBags } from "../../hooks/use-bags";

export type BagsOutletContext = ReturnType<typeof useBags>;

export function BagsLayout() {
  const bagsState = useBags();
  return <Outlet context={bagsState} />;
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0. (No router wiring yet — Task 13.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/bags/bags-layout.tsx
git commit -m "[UI] add BagsLayout route component"
```

---

## Task 12 — Add `BagsListPage`

**Files:**
- Create: `frontend/src/pages/bags/bags-list-page.tsx`

- [ ] **Step 1: Write the page**

Create `frontend/src/pages/bags/bags-list-page.tsx`:

```tsx
import { useOutletContext } from "react-router-dom";

import { BagRootInput } from "../../components/bags/bag-root-input";
import { BagTree } from "../../components/bags/bag-tree";
import type { BagsOutletContext } from "./bags-layout";

export function BagsListPage() {
  const ctx = useOutletContext<BagsOutletContext>();
  const { rootDir, setRootDir, bags, isScanning, onScan, onIndex } = ctx;

  const hasBags = bags.length > 0;
  const emptyMessage =
    !hasBags && rootDir.trim() && !isScanning
      ? "No bags found in this directory."
      : null;

  if (!hasBags) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <BagRootInput
          rootDir={rootDir}
          onRootDirChange={setRootDir}
          onScan={onScan}
          isScanning={isScanning}
          variant="hero"
          emptyMessage={emptyMessage}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <BagRootInput
        rootDir={rootDir}
        onRootDirChange={setRootDir}
        onScan={onScan}
        isScanning={isScanning}
        variant="strip"
      />
      <div className="p-6">
        <BagTree bags={bags} selectedBagPath={null} onIndex={onIndex} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/bags/bags-list-page.tsx
git commit -m "[UI] add BagsListPage with hero-state input and folder tree"
```

---

## Task 13 — Wire `/bags` + `/bags/:bagId` routes (list-page path first)

We wire both routes at once, with `/bags/:bagId` pointing to a temporary stub. The stub is replaced in Task 17 by the real detail page, but wiring the route now lets us verify navigation links from the tree in the browser.

**Files:**
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Replace the stub routes**

Edit `frontend/src/router.tsx`:

```tsx
import { createBrowserRouter, Navigate } from "react-router-dom";

import { MainLayout } from "./components/layout/main-layout";
import { ProtectedRoute } from "./components/layout/protected-route";
import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { WorkspacePage } from "./pages/workspace";
import { BagsLayout } from "./pages/bags/bags-layout";
import { BagsListPage } from "./pages/bags/bags-list-page";

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        This section isn't available yet.
      </p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "workspace", element: <WorkspacePage /> },
          { path: "search", element: <Navigate to="/workspace" replace /> },
          {
            path: "bags",
            element: <BagsLayout />,
            children: [
              { index: true, element: <BagsListPage /> },
              { path: ":bagId", element: <ComingSoon title="Bag Detail (WIP)" /> },
            ],
          },
          { path: "datasets/*", element: <ComingSoon title="Datasets" /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
```

- [ ] **Step 2: Verify build + lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Manual browser check**

1. Build + serve (see Verification Commands).
2. Navigate to `/bags`. Expected: hero-state root-dir input centered, no tree visible.
3. Type an invalid path (e.g., `/nonexistent`) and click Scan. Expected: toast error; hero state retained.
4. Type a valid path containing at least one bag folder and click Scan. Expected:
   - Input animates to the top strip.
   - Folder tree renders below it, with single-child folders collapsed.
5. Click a bag leaf. Expected: URL changes to `/bags/<base64url>`, and the "Bag Detail (WIP)" stub renders. Use the browser back button — returns to `/bags` with the tree still populated.
6. Cmd/Ctrl-click a bag. Expected: new tab with the detail URL.
7. Scan a directory with zero bags. Expected: "No bags found in this directory." under the hero input.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router.tsx
git commit -m "[UI] wire /bags and /bags/:bagId routes (detail still stubbed)"
```

---

## Task 14 — Extend `useSequenceViewer` with `openViewerForBag`

**Files:**
- Modify: `frontend/src/hooks/use-sequence-viewer.ts`

- [ ] **Step 1: Add the new entry point**

In `frontend/src/hooks/use-sequence-viewer.ts`:

1. At the top, where `DEFAULT_WINDOW_SECONDS` and `HALF_WINDOW_NS` are defined (line 7-8), no change.
2. Add a new callback inside `useSequenceViewer` after `openViewer` (around line 163). This factors the shared frame-loading logic out of `openViewer` so both entry points can reuse it:

```ts
const openViewerForBag = useCallback(
  async ({
    bagPath,
    bagName,
    startNs,
    durationSec = DEFAULT_WINDOW_SECONDS,
  }: {
    bagPath: string;
    bagName: string;
    startNs: number;
    durationSec?: number;
  }) => {
    const synthetic: SearchResult = {
      bag_path: bagPath,
      timestamp_ns: startNs,
      file_path: "",
      topic: "",
      similarity_score: 0,
      source_bag: bagName,
    };

    setSelectedResult(synthetic);
    setSelectedTimestampNs(startNs);
    setFrames([]);
    setLoadedRangeStartNs(null);
    setLoadedRangeEndNs(null);
    setCanLoadMoreLeft(true);
    setCanLoadMoreRight(true);
    setChatQuery("");
    setChatResponse(null);
    setChatDuration(DEFAULT_WINDOW_SECONDS);
    setIsLoadingFrames(true);

    try {
      const response = await getFrames(bagPath, startNs, durationSec);
      const sortedFrames = response.frames.sort(
        (a, b) => a.timestamp_ns - b.timestamp_ns,
      );
      setFrames(sortedFrames);
      const defaultEndNs = startNs + durationSec * 1_000_000_000;
      if (sortedFrames.length > 0) {
        setLoadedRangeStartNs(sortedFrames[0].timestamp_ns);
        setLoadedRangeEndNs(sortedFrames[sortedFrames.length - 1].timestamp_ns);
        if (sortedFrames[0].timestamp_ns > startNs) {
          setSelectedTimestampNs(sortedFrames[0].timestamp_ns);
        }
      } else {
        setLoadedRangeStartNs(startNs);
        setLoadedRangeEndNs(defaultEndNs);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load sequence frames.";
      toast.error(message);
    } finally {
      setIsLoadingFrames(false);
    }
  },
  [],
);
```

3. Export it from the returned object (at line 338):

```ts
return {
  activeFrame,
  canLoadMoreLeft,
  canLoadMoreRight,
  chatDuration,
  chatQuery,
  chatResponse,
  closeViewer,
  frames,
  isExtendingLeft,
  isExtendingRight,
  isChatting,
  isFrameInVlmWindow,
  isLoadingFrames,
  isOpen,
  loadMoreLeft,
  loadMoreRight,
  openViewer,
  openViewerForBag,   // ← new
  runChat,
  selectNextFrame,
  selectPreviousFrame,
  selectedFrameIndex,
  selectedResult,
  selectedTimestampNs,
  setChatDuration,
  setChatQuery,
  setSelectedTimestampNs,
  vlmWindowEndNs: vlmWindow?.endNs ?? null,
  vlmWindowStartNs: vlmWindow?.startNs ?? null,
};
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0. `/workspace` behaviour is unchanged because `openViewer` is untouched.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-sequence-viewer.ts
git commit -m "[UI] add openViewerForBag entry point to useSequenceViewer"
```

---

## Task 15 — Add `BagSequenceViewer` component

The legacy `SequenceViewer` at `frontend/src/components/search/sequence-viewer.tsx` is a modal-style overlay. We write a new page-native component that reuses the same props surface (`useSequenceViewer` return value) but renders inline, with the chat panel as a collapsible right sidebar instead of an overlay footer.

**Files:**
- Create: `frontend/src/components/bags/bag-sequence-viewer.tsx`

- [ ] **Step 1: Read the legacy component for reference**

```bash
sed -n '1,60p' frontend/src/components/search/sequence-viewer.tsx
```

Skim its prop list and layout blocks; the new component reuses the same prop shape so `BagDetailPage` can pass `useSequenceViewer` outputs through almost verbatim.

- [ ] **Step 2: Write the new component**

Create `frontend/src/components/bags/bag-sequence-viewer.tsx`:

```tsx
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  MessageSquare,
  MessageSquareOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { FrameInfo, SearchResult } from "../../api/types";
import { AuthImage } from "../ui/auth-image";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface BagSequenceViewerProps {
  result: SearchResult | null;
  activeFrame: FrameInfo | null;
  frames: FrameInfo[];
  selectedTimestampNs: number | null;
  selectedFrameIndex: number;
  isLoadingFrames: boolean;
  canLoadMoreLeft: boolean;
  canLoadMoreRight: boolean;
  isExtendingLeft: boolean;
  isExtendingRight: boolean;
  chatDuration: number;
  chatQuery: string;
  chatResponse: string | null;
  isChatting: boolean;
  extractionEnabled: boolean;
  vlmWindowStartNs: number | null;
  vlmWindowEndNs: number | null;
  isFrameInVlmWindow: (timestampNs: number) => boolean;
  onSelectTimestamp: (ns: number) => void;
  onSelectNextFrame: () => void;
  onSelectPreviousFrame: () => void;
  onLoadMoreLeft: () => void;
  onLoadMoreRight: () => void;
  onChatQueryChange: (value: string) => void;
  onChatDurationChange: (value: number) => void;
  onChat: () => void;
  onExtractDataset: () => void;
}

function formatTimestamp(ns: number | null): string {
  if (ns === null) return "—";
  const seconds = ns / 1_000_000_000;
  return `${seconds.toFixed(3)} s (${ns})`;
}

export function BagSequenceViewer({
  result,
  activeFrame,
  frames,
  selectedTimestampNs,
  selectedFrameIndex,
  isLoadingFrames,
  canLoadMoreLeft,
  canLoadMoreRight,
  isExtendingLeft,
  isExtendingRight,
  chatDuration,
  chatQuery,
  chatResponse,
  isChatting,
  extractionEnabled,
  isFrameInVlmWindow,
  onSelectTimestamp,
  onSelectNextFrame,
  onSelectPreviousFrame,
  onLoadMoreLeft,
  onLoadMoreRight,
  onChatQueryChange,
  onChatDurationChange,
  onChat,
  onExtractDataset,
}: BagSequenceViewerProps) {
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onSelectPreviousFrame();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onSelectNextFrame();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSelectPreviousFrame, onSelectNextFrame]);

  if (!result) return null;

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[520px] flex-col">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/bags">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Bags
            </Link>
          </Button>
          <span className="truncate text-sm font-semibold">{result.source_bag}</span>
          <span className="text-xs text-[var(--ink-soft)]">
            {formatTimestamp(selectedTimestampNs)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {extractionEnabled ? (
            <Button variant="outline" size="sm" onClick={onExtractDataset}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Extract dataset
            </Button>
          ) : null}
          <Button
            variant={chatOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setChatOpen((v) => !v)}
          >
            {chatOpen ? (
              <MessageSquareOff className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            )}
            Chat
          </Button>
        </div>
      </div>

      {/* Main split: canvas + chat */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Frame canvas */}
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-3">
            {isLoadingFrames ? (
              <LoaderCircle className="h-8 w-8 animate-spin text-white/70" />
            ) : activeFrame ? (
              <AuthImage
                key={activeFrame.file_path}
                filePath={activeFrame.file_path}
                alt={`Frame ${activeFrame.timestamp_ns}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-sm text-white/70">No frame available.</p>
            )}
          </div>

          {/* Thumbnail strip */}
          <div className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreLeft || isExtendingLeft}
              onClick={onLoadMoreLeft}
            >
              {isExtendingLeft ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSelectPreviousFrame}
              disabled={selectedFrameIndex <= 0 && !canLoadMoreLeft}
              title="Previous frame (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex flex-1 gap-1 overflow-x-auto">
              {frames.map((frame) => {
                const selected = frame.timestamp_ns === selectedTimestampNs;
                const inWindow = isFrameInVlmWindow(frame.timestamp_ns);
                return (
                  <button
                    key={frame.timestamp_ns}
                    type="button"
                    onClick={() => onSelectTimestamp(frame.timestamp_ns)}
                    className={`shrink-0 overflow-hidden rounded border-2 ${
                      selected
                        ? "border-[var(--teal)]"
                        : inWindow
                          ? "border-[var(--teal)]/40"
                          : "border-transparent"
                    }`}
                    title={String(frame.timestamp_ns)}
                  >
                    <AuthImage
                      filePath={frame.file_path}
                      alt=""
                      className="h-14 w-24 object-cover"
                    />
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSelectNextFrame}
              disabled={selectedFrameIndex === frames.length - 1 && !canLoadMoreRight}
              title="Next frame (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canLoadMoreRight || isExtendingRight}
              onClick={onLoadMoreRight}
            >
              {isExtendingRight ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Chat panel */}
        {chatOpen ? (
          <aside className="flex w-[360px] shrink-0 flex-col gap-3 border-l border-[var(--line)] bg-[var(--surface)] p-3">
            <h2 className="text-sm font-semibold">Ask the VLM</h2>
            <label className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-soft)]">
              Window (seconds)
            </label>
            <Input
              type="number"
              min={1}
              max={60}
              value={chatDuration}
              onChange={(e) => onChatDurationChange(Number(e.target.value) || 10)}
            />
            <label className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-soft)]">
              Question
            </label>
            <Textarea
              rows={4}
              value={chatQuery}
              onChange={(e) => onChatQueryChange(e.target.value)}
              placeholder="What does the camera see around this timestamp?"
            />
            <Button onClick={onChat} disabled={isChatting}>
              {isChatting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isChatting ? "Asking" : "Ask"}
            </Button>
            {chatResponse ? (
              <div className="flex-1 overflow-auto rounded border border-[var(--line)] bg-white p-2 text-xs">
                {chatResponse}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/bags/bag-sequence-viewer.tsx
git commit -m "[UI] add page-native BagSequenceViewer"
```

---

## Task 16 — Add `BagDetailPage` and wire the detail route

**Files:**
- Create: `frontend/src/pages/bags/bag-detail-page.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Write `BagDetailPage`**

Create `frontend/src/pages/bags/bag-detail-page.tsx`:

```tsx
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { getBagInfo, getBagStatus } from "../../api/client";
import type { BagInfo, BagInfoResponse } from "../../api/types";
import { BagRootChip } from "../../components/bags/bag-root-chip";
import { BagSequenceViewer } from "../../components/bags/bag-sequence-viewer";
import { BagTree } from "../../components/bags/bag-tree";
import { ExtractDatasetDialog } from "../../components/extraction/extract-dataset-dialog";
import { useSidebar } from "../../components/layout/sidebar-slot";
import { Button } from "../../components/ui/button";
import { useJobs } from "../../context/jobs-context";
import { useExtractionLauncher } from "../../hooks/use-extraction-launcher";
import { useSequenceViewer } from "../../hooks/use-sequence-viewer";
import { decodeBagId } from "../../lib/bag-id";
import type { BagsOutletContext } from "./bags-layout";

function useDecodedBagPath(): { bagPath: string | null; error: string | null } {
  const { bagId } = useParams<{ bagId: string }>();
  return useMemo(() => {
    if (!bagId) return { bagPath: null, error: "Missing bag id" };
    try {
      return { bagPath: decodeBagId(bagId), error: null };
    } catch {
      return { bagPath: null, error: "Invalid bag id" };
    }
  }, [bagId]);
}

export function BagDetailPage() {
  const ctx = useOutletContext<BagsOutletContext>();
  const {
    rootDir,
    setRootDir,
    bags,
    isScanning,
    onScan,
    onIndex,
    registerBag,
    unregisterBag,
  } = ctx;
  const [searchParams] = useSearchParams();
  const { bagPath, error: decodeError } = useDecodedBagPath();
  const { schema, extractionEnabled, refresh } = useJobs();

  const [resolvedBag, setResolvedBag] = useState<BagInfo | null>(null);
  const [bagInfo, setBagInfo] = useState<BagInfoResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const viewerOpenedRef = useRef<string | null>(null);

  const viewerState = useSequenceViewer();
  const launcher = useExtractionLauncher(schema, refresh);

  // Resolve bag record (from scan state, or via /api/bags/status).
  useEffect(() => {
    if (!bagPath) return;
    const fromState = bags.find((b) => b.bag_path === bagPath);
    if (fromState) {
      setResolvedBag(fromState);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    getBagStatus(bagPath)
      .then((resp) => {
        if (cancelled) return;
        const bag: BagInfo = {
          bag_path: resp.bag_path,
          bag_name: resp.bag_path.split("/").filter(Boolean).pop() ?? resp.bag_path,
          is_indexed: resp.status === "done",
          status: resp.status,
        };
        setResolvedBag(bag);
        registerBag(bag);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load bag.");
      });
    return () => {
      cancelled = true;
    };
  }, [bagPath, bags, registerBag]);

  // Clean up synthetic bag registration on unmount.
  useEffect(() => {
    if (!bagPath) return;
    return () => {
      const fromState = bags.find((b) => b.bag_path === bagPath);
      if (!fromState) unregisterBag(bagPath);
    };
  }, [bagPath, bags, unregisterBag]);

  // Sync resolvedBag with the up-to-date record from shared state (tracks indexing
  // status transitions driven by useBags polling).
  useEffect(() => {
    if (!bagPath) return;
    const fromState = bags.find((b) => b.bag_path === bagPath);
    if (fromState) setResolvedBag(fromState);
  }, [bags, bagPath]);

  // Fetch bag info once the bag is indexed.
  useEffect(() => {
    if (!bagPath || !resolvedBag || !resolvedBag.is_indexed) return;
    let cancelled = false;
    getBagInfo(bagPath)
      .then((info) => {
        if (!cancelled) setBagInfo(info);
      })
      .catch(() => {
        if (!cancelled) setBagInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bagPath, resolvedBag]);

  // Open the viewer once per bag, at ?t=<ns> or at the first-frame timestamp.
  useEffect(() => {
    if (!bagPath || !resolvedBag || !resolvedBag.is_indexed) return;
    if (!bagInfo || bagInfo.frame_count === 0 || bagInfo.first_timestamp_ns === null) return;
    if (viewerOpenedRef.current === bagPath) return;

    const tParam = searchParams.get("t");
    const requestedTs = tParam ? Number(tParam) : NaN;
    const withinRange =
      Number.isFinite(requestedTs) &&
      bagInfo.first_timestamp_ns !== null &&
      bagInfo.last_timestamp_ns !== null &&
      requestedTs >= bagInfo.first_timestamp_ns &&
      requestedTs <= bagInfo.last_timestamp_ns;
    const startNs = withinRange ? requestedTs : bagInfo.first_timestamp_ns;

    if (tParam && !withinRange) {
      toast.error("Requested timestamp is out of range; showing bag start.");
    }

    viewerOpenedRef.current = bagPath;
    void viewerState.openViewerForBag({
      bagPath,
      bagName: resolvedBag.bag_name,
      startNs,
    });
  }, [bagPath, resolvedBag, bagInfo, searchParams, viewerState]);

  // Sidebar slot.
  useSidebar(
    () => (
      <div className="space-y-3">
        <BagRootChip
          rootDir={rootDir}
          onRootDirChange={setRootDir}
          onScan={onScan}
          isScanning={isScanning}
        />
        <BagTree
          bags={bags}
          selectedBagPath={bagPath}
          onIndex={onIndex}
          compact
        />
      </div>
    ),
    [rootDir, setRootDir, onScan, isScanning, bags, bagPath, onIndex],
  );

  const handleExtractDataset = () => {
    if (!resolvedBag || viewerState.selectedTimestampNs === null) return;
    launcher.open({
      bagPath: resolvedBag.bag_path,
      centerNs: viewerState.selectedTimestampNs,
      defaultWindowS: viewerState.chatDuration,
    });
  };

  if (decodeError) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">Bag not found</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">{decodeError}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/bags">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to bags
          </Link>
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">Bag not found</h2>
        <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">{bagPath}</p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{loadError}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/bags">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back to bags
          </Link>
        </Button>
      </div>
    );
  }

  if (!resolvedBag) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-[var(--ink-soft)]" />
      </div>
    );
  }

  if (!resolvedBag.is_indexed) {
    const isIndexing = resolvedBag.status === "indexing";
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <h2 className="text-base font-semibold">This bag isn't indexed yet.</h2>
        <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">{resolvedBag.bag_path}</p>
        <Button
          onClick={() => onIndex(resolvedBag.bag_path)}
          disabled={isIndexing}
          className="mt-4"
        >
          {isIndexing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isIndexing ? "Indexing" : "Index"}
        </Button>
      </div>
    );
  }

  return (
    <>
      <BagSequenceViewer
        result={viewerState.selectedResult}
        activeFrame={viewerState.activeFrame}
        frames={viewerState.frames}
        selectedTimestampNs={viewerState.selectedTimestampNs}
        selectedFrameIndex={viewerState.selectedFrameIndex}
        isLoadingFrames={viewerState.isLoadingFrames}
        canLoadMoreLeft={viewerState.canLoadMoreLeft}
        canLoadMoreRight={viewerState.canLoadMoreRight}
        isExtendingLeft={viewerState.isExtendingLeft}
        isExtendingRight={viewerState.isExtendingRight}
        chatDuration={viewerState.chatDuration}
        chatQuery={viewerState.chatQuery}
        chatResponse={viewerState.chatResponse}
        isChatting={viewerState.isChatting}
        extractionEnabled={extractionEnabled}
        vlmWindowStartNs={viewerState.vlmWindowStartNs}
        vlmWindowEndNs={viewerState.vlmWindowEndNs}
        isFrameInVlmWindow={viewerState.isFrameInVlmWindow}
        onSelectTimestamp={viewerState.setSelectedTimestampNs}
        onSelectNextFrame={viewerState.selectNextFrame}
        onSelectPreviousFrame={viewerState.selectPreviousFrame}
        onLoadMoreLeft={() => void viewerState.loadMoreLeft()}
        onLoadMoreRight={() => void viewerState.loadMoreRight()}
        onChatQueryChange={viewerState.setChatQuery}
        onChatDurationChange={viewerState.setChatDuration}
        onChat={() => void viewerState.runChat()}
        onExtractDataset={handleExtractDataset}
      />
      {extractionEnabled ? (
        <ExtractDatasetDialog
          isOpen={launcher.isOpen}
          isSubmitting={launcher.isSubmitting}
          schema={schema}
          bagName={resolvedBag.bag_name}
          bagPath={launcher.bagPath}
          centerTimestampMs={
            viewerState.selectedTimestampNs !== null
              ? Math.floor(viewerState.selectedTimestampNs / 1_000_000)
              : 0
          }
          windowS={launcher.windowS}
          outputFolder={launcher.outputFolder}
          userConfig={launcher.userConfig}
          onClose={launcher.close}
          onSubmit={() => void launcher.submit()}
          onBagPathChange={launcher.setBagPath}
          onWindowChange={launcher.setWindowS}
          onOutputFolderChange={launcher.setOutputFolder}
          onFieldChange={launcher.setFieldValue}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Swap the detail-route stub for the real page**

Edit `frontend/src/router.tsx` — add the import and replace the `:bagId` element:

```tsx
import { BagDetailPage } from "./pages/bags/bag-detail-page";

// ...inside the bags children...
{ path: ":bagId", element: <BagDetailPage /> },
```

- [ ] **Step 3: Verify build + lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Manual browser check**

(Requires at least one indexed bag on disk. If none exists, run the scan → index flow first via `/workspace` or `/bags`.)

1. Navigate to `/bags` and click an indexed bag in the tree. URL becomes `/bags/<base64url>`.
2. Expected: sidebar shows the collapsed root chip + compact tree (current bag highlighted); main area loads the first frame.
3. Click a neighboring bag in the sidebar. Expected: URL changes, viewer reloads at the new bag's first frame, no scan re-runs.
4. Click an unindexed bag from the tree. Expected: the unindexed empty state appears with an Index button. Click Index; when polling transitions status to `done` and info loads, the viewer appears.
5. Manually append `?t=1700000000000000000` (or any number inside the bag's range) to a detail URL. Expected: viewer opens at a frame near that timestamp.
6. Append a `t` value out of range. Expected: a toast fires ("Requested timestamp is out of range; showing bag start.") and the viewer opens at the bag's first frame.
7. Open chat panel, ask a question. Expected: response renders in the aside panel.
8. Click Extract dataset. Expected: dialog opens pre-populated; submit → job appears in the top-bar dropdown pill.
9. Press Enter in the Cmd/Ctrl-hit a bag in a new tab: `/bags/:bagId` loads fresh (no prior scan) — expected: sidebar tree shows the "Scan a root directory" hint (empty) plus the synthetic bag entry with its status; main loads the viewer. Navigate back to the first tab's `/bags` — the synthetic bag is *not* present (it was registered only while the detail page was mounted).
10. Paste a malformed bagId (e.g., `/bags/@@@`). Expected: "Bag not found" card with back link. No crash.
11. Navigate back to `/workspace`; verify nothing there broke.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/bags/bag-detail-page.tsx frontend/src/router.tsx
git commit -m "[UI] add BagDetailPage with sequence viewer and extract dialog"
```

---

## Task 17 — Flip dashboard card to "available"

**Files:**
- Modify: `frontend/src/pages/dashboard.tsx`

- [ ] **Step 1: Flip the Bag Explorer card status**

Edit `frontend/src/pages/dashboard.tsx`, in the `SECTIONS` array (around line 22-28):

```tsx
  {
    title: "Bag Explorer",
    description: "Browse indexed bags, inspect frames, and trigger dataset extraction.",
    href: "/bags",
    status: "available",
  },
```

- [ ] **Step 2: Verify build + lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Manual browser check**

1. Go to `/`. Bag Explorer card now shows `Open →` button instead of "Not available yet".
2. Click it → lands on `/bags`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/dashboard.tsx
git commit -m "[UI] flip Bag Explorer dashboard card to available"
```

---

## Task 18 — Update `CLAUDE.md` roadmap

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Mark Phase 2 as done**

In `CLAUDE.md`, update the Refactoring Roadmap table row for Phase 2:

```
| 2 | `/bags` — carve bag scanning, bag list, sequence viewer out of WorkspacePage | ✅ Done on branch `frontend-refactor` |
```

- [ ] **Step 2: Update the "Next Step" section**

Replace the "Next Step (Phase 2)" section with "Next Step (Phase 3)":

```markdown
## Next Step (Phase 3)

Carve the semantic search bar + results grid out of `WorkspacePage` into a dedicated `/search` page. Replace the Phase 1 transitional redirect `/search → /workspace` with the real page. Suggested flow:
1. `/brainstorm` — explore layout, how `/search` links into `/bags/:bagId?t=<ns>` for sequence viewing, what parts of the existing `SearchBar`/`ResultsGrid`/`SequenceViewer` components should be shared vs. copied.
2. Save spec to `docs/superpowers/specs/YYYY-MM-DD-search-page-design.md`.
3. `/plan` — write step-by-step plan to `docs/superpowers/plans/YYYY-MM-DD-search-page.md`.
4. Execute.

Phase 3 MUST preserve `/workspace` as a working fallback until Phase 4.
```

- [ ] **Step 3: Update the "Last Updated" footer**

```markdown
**Last Updated**: <today's date> (Phase 2 shipped on `frontend-refactor`; Phase 3 pending spec)
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "[Docs] mark Phase 2 complete and set Phase 3 as next step"
```

---

## Task 19 — Final manual QA sweep

No file changes. This task is the spec's manual QA checklist, run end-to-end on a fresh build. Check each item, check off the box, fix regressions by opening a new focused task if needed.

- [ ] Build succeeds: `cd frontend && npm run build`.
- [ ] Lint clean: `cd frontend && npm run lint`.
- [ ] Backend tests green: `PYTHONPATH="" uv run pytest tests/ -q`.
- [ ] Serve: `uv run uvicorn app:app --reload` on http://localhost:8000.
- [ ] `/bags` hero → top-strip transition works when a scan returns bags.
- [ ] Zero-result scan stays in hero with "No bags found in this directory." inline.
- [ ] Tree collapses single-child chains correctly; expand/collapse is stable after a re-scan.
- [ ] Click bag → `/bags/:bagId`; Cmd/Ctrl-click opens new tab.
- [ ] List ↔ detail navigation preserves `useBags` polling (no flicker; indexing status on the sidebar tree keeps updating).
- [ ] Direct load of `/bags/:bagId` (URL paste / page refresh) reconstructs state via `/api/bags/status`.
- [ ] `?t=<ns>` inside range positions the viewer at that timestamp.
- [ ] `?t=<ns>` out of range fires the toast and opens at bag start.
- [ ] Unindexed-detail empty state's Index button works; viewer appears after polling transitions status to `done`.
- [ ] Extract dialog opens with correct prefill; submit shows the new job in the top-bar dropdown.
- [ ] Top-bar jobs dropdown badge count updates in real time.
- [ ] `/workspace` still scans, indexes, opens its modal sequence viewer, and its sidebar Jobs tab lists the same jobs as the top-bar dropdown.
- [ ] Dashboard Bag Explorer card is clickable and routes to `/bags`.

Once every box is checked:

```bash
git log --oneline -20
```

Confirm the commit history shows all 17 incremental commits from this plan.

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| §1 Overview | Tasks 11–16 |
| §2 Route tree | Task 13 (list), Task 16 (detail) |
| §2 Bag ID helpers | Task 3 |
| §3 Top-Bar Jobs Dropdown | Tasks 4, 5, 6, 7 |
| §4 `BagsListPage` (hero/strip + tree) | Tasks 9, 10, 12 |
| §5.1 Detail mount behaviour | Task 16 |
| §5.2 Detail sidebar slot | Task 16 (`useSidebar` call) |
| §5.3 `BagSequenceViewer` layout | Task 15 |
| §5.4 Extract dataset | Task 16 |
| §6.1 `useBags` via `BagsLayout` outlet | Tasks 8, 11 |
| §6.2 `JobsProvider` | Tasks 4, 5 |
| §6.3 `openViewerForBag` entry | Task 14 |
| §7 `/workspace` impact (swap hook) | Task 5 |
| §8 Error/edge states | Task 16 (decode errors, 404, unindexed, out-of-range `t`) |
| §9 File inventory | All tasks map to listed files |
| §10 Manual QA | Task 19 |

**Deviations from spec (intentional):**

- Added `GET /api/bags/info` endpoint (Task 1). Spec said "no backend changes"; without this the detail page can't open the viewer at the bag's first frame. Single-file, read-only addition.
- `BagRootChip` wraps `BagRootInput` with an editing state (click chip → expands to the strip variant). Spec described "collapsed chip with change-root affordance" — this is an acceptable concrete realization.
- `BagSequenceViewer` uses a collapsible right-side chat panel rather than an always-visible one. Spec described a "right side, collapsible" chat panel; the default-collapsed choice is a small UX call made to give the frame canvas more room by default.
- Optional sub-component extraction (`frame-canvas`, `thumbnail-strip`, `chat-panel`) from today's `sequence-viewer.tsx` is NOT done — spec explicitly marked this as optional. The new `BagSequenceViewer` duplicates the relevant layout JSX directly.

**Placeholder scan:** No TBDs, no "implement later", no hand-waved error handling — every task shows the code.

**Type-name consistency check:** `BagInfoResponse`, `registerBag`/`unregisterBag`, `openViewerForBag`, `BagsOutletContext`, `BagTree`, `BagRootInput`, `BagRootChip`, `BagSequenceViewer`, `BagsLayout`, `BagsListPage`, `BagDetailPage`, `JobsProvider`, `useJobs`, `JobsDropdown`, `encodeBagId`, `decodeBagId` — all used consistently across tasks.
