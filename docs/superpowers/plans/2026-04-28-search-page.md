# Phase 3: `/search` Page + Per-Bag Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve cross-bag search into a dedicated `/search` route with URL-driven state, and add per-bag search to `/bags/:bagId` via a generic timeline pin overlay extensible to non-search pin sources (fault logs, annotations).

**Architecture:** Pure frontend refactor. The existing `useSearch` hook and backend API stay unchanged. A thin `useUrlSearch` wrapper makes the URL the single source of truth for search state. A new `BagsProvider` (mirroring the existing `JobsProvider` pattern) lifts the bag list out of `BagsLayout` so `/search` can read it without re-scanning. A generic `Pin` model + `usePins` hook fuels a new `PinRail` component above the existing thumbnail strip on the bag detail page.

**Tech Stack:** React 19, React Router v6, TypeScript, TailwindCSS, shadcn/ui (Radix). No test runner is introduced — verification is `tsc --noEmit`, `npm run lint`, and the manual QA pass in Task 13.

**Spec:** `docs/superpowers/specs/2026-04-28-search-page-design.md`

---

## File Structure

### New files

```
frontend/src/
├── types/pin.ts                                    # Pin, PinProvider types
├── context/bags-context.tsx                        # BagsProvider, useBags consumer hook
├── hooks/
│   ├── use-url-search.ts                           # useUrlSearch wrapper around useSearch
│   └── use-pins.ts                                 # usePins(bagPath, results, minScore, providers?)
├── pages/search.tsx                                # SearchPage
└── components/
    ├── search/
    │   ├── search-input.tsx                        # SearchInput (text + 📷 + ✕ + Enter)
    │   ├── bag-picker-chip.tsx                     # BagPickerChip (closed chip + popover)
    │   └── filter-chip.tsx                         # FilterChip (collapsed summary + expanded sliders)
    └── bags/pin-rail.tsx                           # PinRail (proportional timeline + viewport band)
```

### Modified files

```
frontend/src/
├── hooks/use-bags.ts                               # rename export `useBags` → `useBagsState`
├── components/layout/protected-route.tsx           # mount <BagsProvider>
├── pages/bags/bags-layout.tsx                      # read bags from context instead of owning them
├── pages/workspace.tsx                             # read bags from context (transparent change)
├── pages/bags/bag-detail-page.tsx                  # add per-bag search header + pin rail wiring
├── components/bags/bag-sequence-viewer.tsx        # accept pinRail + highlightedTimestamps props
├── pages/dashboard.tsx                             # add Search card (new) and verify others
└── router.tsx                                      # replace /search redirect with <SearchPage />
```

### Untouched

- All `src/api/*.py` (backend).
- All `src/auth/*.py`.
- `useSearch` (`hooks/use-search.ts`) — wrapped, not modified.
- Legacy `SearchBar`, `SequenceViewer` (modal), `BagList` — retained for `/workspace`.
- `JobsProvider` and extraction-related code.

---

### Task 0: Verify clean baseline

**Files:** none

- [ ] **Step 1: Confirm clean working tree on `frontend-refactor`**

```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: empty status, branch is `frontend-refactor`. If untracked changes exist, stash or commit them before starting.

- [ ] **Step 2: Verify baseline lint + typecheck pass**

```bash
cd frontend && npm run lint
```

Expected: only the two pre-existing `react-refresh/only-export-components` errors in `components/ui/badge.tsx` and `components/ui/button.tsx`. No others.

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

If anything fails here, fix before proceeding — Phase 3 must not introduce confounding regressions.

---

### Task 1: Pin types

**Files:**
- Create: `frontend/src/types/pin.ts`

- [ ] **Step 1: Write the type file**

`frontend/src/types/pin.ts`:

```ts
export interface Pin {
  timestamp_ns: number;
  source: string;
  score?: number;
  label?: string;
  color?: string;
}

export interface PinProvider {
  source: string;
  getPins(bagPath: string): Pin[] | Promise<Pin[]>;
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/pin.ts
git commit -m "[Feat] add generic Pin + PinProvider types for timeline overlays"
```

---

### Task 2: Lift `useBags` into a `BagsProvider` context

**Files:**
- Modify: `frontend/src/hooks/use-bags.ts` (rename export)
- Create: `frontend/src/context/bags-context.tsx`
- Modify: `frontend/src/components/layout/protected-route.tsx`
- Modify: `frontend/src/pages/bags/bags-layout.tsx`
- Modify: `frontend/src/pages/workspace.tsx`

- [ ] **Step 1: Rename `useBags` → `useBagsState` in the hook file**

In `frontend/src/hooks/use-bags.ts`:

```ts
// Was: export function useBags() { … }
export function useBagsState() {
  // …entire body unchanged…
}
```

Only the function name changes. All internals stay.

- [ ] **Step 2: Create `BagsProvider` and a new `useBags` consumer hook**

`frontend/src/context/bags-context.tsx`:

```tsx
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { useBagsState } from "../hooks/use-bags";

type BagsState = ReturnType<typeof useBagsState>;

const BagsContext = createContext<BagsState | null>(null);

export function BagsProvider({ children }: { children: ReactNode }) {
  const value = useBagsState();
  return <BagsContext.Provider value={value}>{children}</BagsContext.Provider>;
}

export function useBags(): BagsState {
  const ctx = useContext(BagsContext);
  if (ctx === null) {
    throw new Error("useBags must be used inside <BagsProvider>");
  }
  return ctx;
}
```

- [ ] **Step 3: Mount `BagsProvider` in `ProtectedRoute`**

`frontend/src/components/layout/protected-route.tsx` — wrap the existing `JobsProvider`:

```tsx
import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { BagsProvider } from "../../context/bags-context";
import { JobsProvider } from "../../context/jobs-context";

export function ProtectedRoute() {
  const { accessToken, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-[var(--ink-soft)]" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <BagsProvider>
      <JobsProvider>
        <Outlet />
      </JobsProvider>
    </BagsProvider>
  );
}
```

- [ ] **Step 4: Update `BagsLayout` to read from context**

`frontend/src/pages/bags/bags-layout.tsx`:

```tsx
import { Outlet } from "react-router-dom";

import { useBags } from "../../context/bags-context";

export type BagsOutletContext = ReturnType<typeof useBags>;

export function BagsLayout() {
  const bagsState = useBags();
  return <Outlet context={bagsState} />;
}
```

The outlet-context shape is preserved; `BagDetailPage` and `BagsListPage` need no changes.

- [ ] **Step 5: Update `WorkspacePage` to read from context**

In `frontend/src/pages/workspace.tsx`, change the import line:

```ts
// Was: import { useBags } from "../hooks/use-bags";
import { useBags } from "../context/bags-context";
```

No other changes — `useBags()` returns the same shape.

- [ ] **Step 6: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 type errors. Only the pre-existing 2 lint errors.

- [ ] **Step 7: Manual smoke test**

```bash
cd frontend && npm run build
cd .. && JWT_SECRET=devsecret REFRESH_SECRET=devrefresh uv run uvicorn app:app --reload &
```

Open http://localhost:8000:
1. Log in.
2. Open `/workspace` — scan a directory, confirm bags load.
3. Open `/bags` — confirm the same bags appear (no second scan).
4. Stop the server.

If both pages share the same bag list without re-scan, the lift worked.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/use-bags.ts frontend/src/context/bags-context.tsx frontend/src/components/layout/protected-route.tsx frontend/src/pages/bags/bags-layout.tsx frontend/src/pages/workspace.tsx
git commit -m "[Refactor] lift useBags into BagsProvider context"
```

---

### Task 3: `usePins` hook

**Files:**
- Create: `frontend/src/hooks/use-pins.ts`

- [ ] **Step 1: Write the hook**

`frontend/src/hooks/use-pins.ts`:

```ts
import { useEffect, useMemo, useState } from "react";

import type { Pin, PinProvider } from "../types/pin";
import type { SearchResult } from "../api/types";

/**
 * Synthesizes Pin[] from search results matching the current bag,
 * filters by minScore, and merges any additional async PinProviders.
 * Result is sorted by timestamp_ns.
 */
export function usePins(
  bagPath: string | null,
  results: SearchResult[],
  minScore: number,
  additionalProviders: PinProvider[] = [],
): Pin[] {
  const searchPins = useMemo<Pin[]>(() => {
    if (!bagPath) return [];
    return results
      .filter((r) => r.bag_path === bagPath && r.similarity_score >= minScore)
      .map<Pin>((r) => ({
        timestamp_ns: r.timestamp_ns,
        source: "search",
        score: r.similarity_score,
        label: `${r.similarity_score.toFixed(2)} · ${r.topic}`,
      }));
  }, [bagPath, results, minScore]);

  const [providerPins, setProviderPins] = useState<Pin[]>([]);

  useEffect(() => {
    if (!bagPath || additionalProviders.length === 0) {
      setProviderPins([]);
      return;
    }
    let cancelled = false;
    Promise.all(additionalProviders.map((p) => Promise.resolve(p.getPins(bagPath))))
      .then((perProvider) => {
        if (cancelled) return;
        setProviderPins(perProvider.flat());
      })
      .catch(() => {
        if (!cancelled) setProviderPins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bagPath, additionalProviders]);

  return useMemo<Pin[]>(() => {
    const merged = [...searchPins, ...providerPins];
    merged.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
    return merged;
  }, [searchPins, providerPins]);
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-pins.ts
git commit -m "[Feat] add usePins hook synthesizing Pin[] from search + providers"
```

---

### Task 4: `useUrlSearch` hook

**Files:**
- Create: `frontend/src/hooks/use-url-search.ts`

This hook reads `q`, `bags`, `topK`, `minScore`, `similar` from `useSearchParams`, normalizes them with clamping, and triggers `useSearch` calls when relevant URL params change.

- [ ] **Step 1: Write the hook**

`frontend/src/hooks/use-url-search.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { useSearch } from "./use-search";
import { decodeBagId } from "../lib/bag-id";

const TOP_K_DEFAULT = 25;
const MIN_SCORE_DEFAULT = 0;
const TOP_K_MIN = 1;
const TOP_K_MAX = 100;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function parseBags(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function decodeBagIds(ids: string[]): string[] {
  // Decode base64url IDs → bag paths. Skip malformed IDs silently
  // (the consumer may want to surface a toast separately).
  const out: string[] = [];
  for (const id of ids) {
    try {
      out.push(decodeBagId(id));
    } catch {
      // skip malformed id
    }
  }
  return out;
}

interface UseUrlSearchOptions {
  /** When provided, these bag PATHS override the URL `bags` param (used by per-bag search). */
  scope?: { bagPaths: string[] };
}

export function useUrlSearch(options: UseUrlSearchOptions = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = useSearch();
  const lastFetchKeyRef = useRef<string>("");

  // Read URL state, with normalization
  const q = searchParams.get("q") ?? "";
  const similar = searchParams.get("similar") ?? "";
  const topK = clamp(
    Number(searchParams.get("topK")) || TOP_K_DEFAULT,
    TOP_K_MIN,
    TOP_K_MAX,
  );
  const minScore = clamp(
    Number(searchParams.get("minScore")) || MIN_SCORE_DEFAULT,
    0,
    1,
  );

  // urlBags = raw encoded IDs (used by the chip for selection state).
  const urlBags = useMemo(() => parseBags(searchParams.get("bags")), [searchParams]);

  // bagPaths from URL = decoded paths (used by the API).
  const bagPathsFromUrl = useMemo(() => decodeBagIds(urlBags), [urlBags]);

  // Effective bag paths sent to the search backend.
  const effectiveBagPaths = options.scope ? options.scope.bagPaths : bagPathsFromUrl;

  const writeUrl = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") {
          next.delete(k);
        } else {
          next.set(k, v);
        }
      }
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  // Trigger backend fetch whenever the relevant param tuple changes.
  useEffect(() => {
    const key = JSON.stringify({ q, similar, topK, bags: effectiveBagPaths });
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;

    if (similar) {
      void search.runSimilarSearch({ file_path: similar }, effectiveBagPaths, topK);
    } else if (q) {
      void search.runSearch(effectiveBagPaths, q, topK);
    } else {
      // Empty state — clear results without firing a request
      search.clearResults?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, similar, topK, effectiveBagPaths.join(",")]);

  // Public actions
  const submitText = useCallback(
    (text: string) => {
      writeUrl({ q: text || null, similar: null });
    },
    [writeUrl],
  );

  const submitImage = useCallback(
    async (file: File) => {
      // Image search does not change the URL; results live in useSearch state only.
      await search.runImageSearch(file, effectiveBagPaths, topK);
    },
    [search, effectiveBagPaths, topK],
  );

  const submitSimilar = useCallback(
    (filePath: string) => {
      writeUrl({ similar: filePath, q: null });
    },
    [writeUrl],
  );

  const clear = useCallback(() => {
    writeUrl({ q: null, similar: null });
  }, [writeUrl]);

  const setTopK = useCallback(
    (k: number) => {
      const clamped = clamp(k, TOP_K_MIN, TOP_K_MAX);
      writeUrl({ topK: String(clamped) });
    },
    [writeUrl],
  );

  const setMinScore = useCallback(
    (s: number) => {
      const clamped = clamp(s, 0, 1);
      writeUrl({ minScore: String(clamped) });
    },
    [writeUrl],
  );

  /** Update URL bags param. Pass an empty array to clear → "all indexed" semantics. */
  const setBags = useCallback(
    (bagIds: string[]) => {
      writeUrl({ bags: bagIds.length === 0 ? null : bagIds.join(",") });
    },
    [writeUrl],
  );

  // Client-side score filter
  const filteredResults = useMemo(
    () => search.results.filter((r) => r.similarity_score >= minScore),
    [search.results, minScore],
  );

  return {
    q,
    similar,
    topK,
    minScore,
    /** Effective bag PATHS for the fetch (decoded; or scope override). */
    bagPaths: effectiveBagPaths,
    /** Raw encoded bag IDs from the URL (for the chip's selection state). */
    urlBags,
    results: filteredResults,
    rawResultCount: search.results.length,
    isSearching: search.isSearching,
    submitText,
    submitImage,
    submitSimilar,
    clear,
    setTopK,
    setMinScore,
    setBags,
  };
}
```

- [ ] **Step 2: Confirm `useSearch` exposes `clearResults`**

```bash
grep -n "clearResults\|setResults" frontend/src/hooks/use-search.ts
```

Expected: a `clearResults` (or equivalent setter to wipe results). If absent, add it to `useSearch` in this same task:

```ts
// In hooks/use-search.ts, add to the returned object
const clearResults = useCallback(() => setResults([]), []);
return {
  // …existing fields…
  clearResults,
};
```

If you have to add it, drop the optional chaining (`search.clearResults?.()`) in the hook above to a plain call.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/use-url-search.ts frontend/src/hooks/use-search.ts
git commit -m "[Feat] add useUrlSearch wrapping useSearch with URL state sync"
```

---

### Task 5: `SearchInput` component

**Files:**
- Create: `frontend/src/components/search/search-input.tsx`

- [ ] **Step 1: Write the component**

`frontend/src/components/search/search-input.tsx`:

```tsx
import { ImagePlus, Search, X } from "lucide-react";
import { useRef, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SearchInputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onClear: () => void;
  onImageUpload: (file: File) => void;
}

export function SearchInput({
  value,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onClear,
  onImageUpload,
}: SearchInputProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSubmit(value.trim());
  };

  const handleClearClick = () => {
    onChange("");
    onClear();
  };

  const handleImageButtonClick = () => {
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImageUpload(file);
    e.target.value = "";
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)]" />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Search…"}
          disabled={disabled}
          className="h-9 pl-9 pr-8"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClearClick}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--ink-soft)] hover:bg-[var(--bg-sand)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleImageButtonClick}
        disabled={disabled}
        title="Search by image"
      >
        <ImagePlus className="h-4 w-4" />
      </Button>
      <Button type="submit" disabled={disabled || !value.trim()}>
        Search
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 type errors. Lint output unchanged (only the 2 pre-existing).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/search/search-input.tsx
git commit -m "[UI] add SearchInput component (text + image upload + clear)"
```

---

### Task 6: `BagPickerChip` component

**Files:**
- Create: `frontend/src/components/search/bag-picker-chip.tsx`

This component displays a closed chip showing the count of selected bags and opens a popover with a checkbox list. It reads the bag list from the `BagsProvider` context.

- [ ] **Step 1: Write the component**

`frontend/src/components/search/bag-picker-chip.tsx`:

```tsx
import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { BagInfo } from "../../api/types";
import { useBags } from "../../context/bags-context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { encodeBagId } from "../../lib/bag-id";

interface BagPickerChipProps {
  /** Bag IDs (encoded) currently selected. Empty array = "all indexed". */
  selectedBagIds: string[];
  onChange: (bagIds: string[]) => void;
}

export function BagPickerChip({ selectedBagIds, onChange }: BagPickerChipProps) {
  const { bags } = useBags();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const indexedBags = useMemo(() => bags.filter((b) => b.is_indexed), [bags]);

  const indexedBagIds = useMemo(
    () => indexedBags.map((b) => encodeBagId(b.bag_path)),
    [indexedBags],
  );

  // "Empty selectedBagIds" means "all indexed" by convention.
  const effectiveSelection = useMemo<Set<string>>(() => {
    if (selectedBagIds.length === 0) return new Set(indexedBagIds);
    return new Set(selectedBagIds);
  }, [selectedBagIds, indexedBagIds]);

  const filteredBags = useMemo(() => {
    if (!filter) return bags;
    const f = filter.toLowerCase();
    return bags.filter((b) => b.bag_name.toLowerCase().includes(f));
  }, [bags, filter]);

  const toggleBag = (bag: BagInfo) => {
    if (!bag.is_indexed) return;
    const id = encodeBagId(bag.bag_path);
    const next = new Set(effectiveSelection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // If selection equals "all indexed", normalize back to [] so the URL stays clean.
    if (next.size === indexedBagIds.length && indexedBagIds.every((x) => next.has(x))) {
      onChange([]);
    } else {
      onChange(Array.from(next));
    }
  };

  /**
   * "Use all indexed" → empty array (the URL convention for "all").
   * No "Clear" button: clearing all checkboxes manually is equivalent and
   * adding a Clear button that produces the same URL state would be confusing.
   */
  const selectAll = () => onChange([]);

  const selectedCount = effectiveSelection.size;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="gap-1.5"
      >
        <Folder className="h-3.5 w-3.5" />
        {`${selectedCount} bag${selectedCount === 1 ? "" : "s"}`}
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {open ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-[320px] rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Search in</span>
            <span className="text-[11px] text-[var(--ink-soft)]">
              {selectedCount} / {indexedBagIds.length} selected
            </span>
          </div>

          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter bags…"
            className="mb-2 h-7 text-xs"
          />

          <div className="mb-2 flex gap-3 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              className="text-[var(--teal)] hover:underline"
            >
              Use all indexed
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto border-t border-[var(--line)] pt-2">
            {filteredBags.length === 0 ? (
              <p className="py-2 text-center text-xs text-[var(--ink-soft)]">No bags match.</p>
            ) : (
              filteredBags.map((bag) => {
                const id = encodeBagId(bag.bag_path);
                const checked = effectiveSelection.has(id);
                const disabled = !bag.is_indexed;
                return (
                  <label
                    key={bag.bag_path}
                    className={`flex items-center gap-2 py-1 text-xs ${
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--bg-sand)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked && !disabled}
                      disabled={disabled}
                      onChange={() => toggleBag(bag)}
                      className="accent-[var(--teal)]"
                    />
                    <span className="flex-1 truncate font-mono">{bag.bag_name}</span>
                    <Badge variant={bag.is_indexed ? "default" : "outline"} className="text-[10px]">
                      {bag.status}
                    </Badge>
                  </label>
                );
              })
            )}
          </div>

          <div className="mt-2 border-t border-[var(--line)] pt-2 text-[11px]">
            <Link to="/bags" className="text-[var(--teal)] hover:underline">
              → Manage bags &amp; scan more
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/search/bag-picker-chip.tsx
git commit -m "[UI] add BagPickerChip popover for /search bag scope"
```

---

### Task 7: `FilterChip` component

**Files:**
- Create: `frontend/src/components/search/filter-chip.tsx`

- [ ] **Step 1: Write the component**

`frontend/src/components/search/filter-chip.tsx`:

```tsx
import { Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FilterChipProps {
  topK: number;
  minScore: number;
  /** Total raw hits returned from backend (before client-side filter). */
  rawResultCount: number;
  /** How many bags were searched (display only). */
  bagCount: number;
  /** Whether to show the topK slider (false on per-bag search). */
  showTopK?: boolean;
  onTopKChange: (k: number) => void;
  onMinScoreChange: (s: number) => void;
}

export function FilterChip({
  topK,
  minScore,
  rawResultCount,
  bagCount,
  showTopK = true,
  onTopKChange,
  onMinScoreChange,
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
          {showTopK ? <span>K=<strong>{topK}</strong></span> : null}
          <span>≥<strong>{minScore.toFixed(2)}</strong></span>
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
            <label className="block">
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
              Min similarity: {minScore.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value))}
              className="w-full accent-[var(--teal)]"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/search/filter-chip.tsx
git commit -m "[UI] add FilterChip with collapsible topK + minScore sliders"
```

---

### Task 8: `SearchPage`

**Files:**
- Create: `frontend/src/pages/search.tsx`

- [ ] **Step 1: Write the page**

`frontend/src/pages/search.tsx`:

```tsx
import { LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { SearchResult } from "../api/types";
import { ResultsGrid } from "../components/search/results-grid";
import { BagPickerChip } from "../components/search/bag-picker-chip";
import { FilterChip } from "../components/search/filter-chip";
import { SearchInput } from "../components/search/search-input";
import { Button } from "../components/ui/button";
import { useBags } from "../context/bags-context";
import { useUrlSearch } from "../hooks/use-url-search";
import { encodeBagId } from "../lib/bag-id";

const EXAMPLES = ["pedestrian on the crosswalk", "parked car", "traffic light"];

export function SearchPage() {
  const navigate = useNavigate();
  const { bags } = useBags();
  const indexedCount = bags.filter((b) => b.is_indexed).length;
  const search = useUrlSearch();
  const [draft, setDraft] = useState(search.q);

  // Keep input in sync if URL changes via Back / example click.
  if (draft === "" && search.q !== "" && draft !== search.q) {
    setDraft(search.q);
  }

  const handleResultClick = (result: SearchResult) => {
    const id = encodeBagId(result.bag_path);
    navigate(`/bags/${id}?t=${result.timestamp_ns}`);
  };

  const handleSimilar = (result: SearchResult) => {
    search.submitSimilar(result.file_path);
  };

  // Empty state when no indexed bags
  if (indexedCount === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
        <h2 className="text-base font-semibold">No indexed bags yet</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Scan a directory and index at least one bag before searching.
        </p>
        <Button asChild className="mt-4">
          <Link to="/bags">Go to Bag Explorer</Link>
        </Button>
      </div>
    );
  }

  const hasQuery = search.q !== "" || search.similar !== "";
  const hidden = search.rawResultCount - search.results.length;

  return (
    <div className="space-y-3">
      {/* Header row: search input + bag picker */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchInput
            value={draft}
            placeholder={`Search across ${indexedCount} indexed bag${indexedCount === 1 ? "" : "s"}`}
            onChange={setDraft}
            onSubmit={(text) => search.submitText(text)}
            onClear={() => {
              setDraft("");
              search.clear();
            }}
            onImageUpload={(file) => void search.submitImage(file)}
          />
        </div>
        <BagPickerChip
          selectedBagIds={search.urlBags}
          onChange={(ids) => search.setBags(ids)}
        />
      </div>

      {/* Filter chip — only when we have a query */}
      {hasQuery ? (
        <FilterChip
          topK={search.topK}
          minScore={search.minScore}
          rawResultCount={search.rawResultCount}
          bagCount={search.bagPaths.length || indexedCount}
          onTopKChange={search.setTopK}
          onMinScoreChange={search.setMinScore}
        />
      ) : null}

      {/* Results */}
      {!hasQuery ? (
        <EmptyState
          indexedCount={indexedCount}
          onPick={(text) => {
            setDraft(text);
            search.submitText(text);
          }}
        />
      ) : search.isSearching ? (
        <div className="flex items-center justify-center py-12">
          <LoaderCircle className="h-5 w-5 animate-spin text-[var(--ink-soft)]" />
        </div>
      ) : search.results.length === 0 && hidden > 0 ? (
        <ZeroAboveThreshold hidden={hidden} onLowerThreshold={() => search.setMinScore(0)} />
      ) : search.results.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
          No matches found.
        </p>
      ) : (
        <ResultsGrid
          results={search.results}
          isSearching={false}
          onResultClick={handleResultClick}
          onSimilarSearch={handleSimilar}
        />
      )}
    </div>
  );
}

function EmptyState({
  indexedCount,
  onPick,
}: {
  indexedCount: number;
  onPick: (text: string) => void;
}) {
  return (
    <div className="py-16 text-center">
      <Search className="mx-auto mb-3 h-8 w-8 text-[var(--ink-soft)]" />
      <h2 className="text-base font-semibold">
        Search across {indexedCount} indexed bag{indexedCount === 1 ? "" : "s"}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">Try one of these examples:</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-1 text-xs hover:bg-[var(--bg-sand)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function ZeroAboveThreshold({
  hidden,
  onLowerThreshold,
}: {
  hidden: number;
  onLowerThreshold: () => void;
}) {
  return (
    <div className="py-12 text-center text-sm">
      <p className="text-[var(--ink-soft)]">
        No matches above the current threshold ({hidden} hit{hidden === 1 ? "" : "s"} hidden).
      </p>
      <button
        type="button"
        onClick={onLowerThreshold}
        className="mt-2 text-[var(--teal)] hover:underline"
      >
        Lower the threshold
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/search.tsx
git commit -m "[Feat] add SearchPage with URL-driven state and result navigation"
```

---

### Task 9: Wire `SearchPage` into the router + dashboard

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/pages/dashboard.tsx`

- [ ] **Step 1: Replace the `/search` redirect with `<SearchPage />`**

In `frontend/src/router.tsx`, replace:

```tsx
{ path: "search", element: <Navigate to="/workspace" replace /> },
```

with:

```tsx
{ path: "search", element: <SearchPage /> },
```

And add the import at the top:

```tsx
import { SearchPage } from "./pages/search";
```

If the `Navigate` import is no longer used elsewhere in `router.tsx`, remove it from the import line — `tsc --noEmit` will flag it.

- [ ] **Step 2: Add a Search card to the dashboard**

In `frontend/src/pages/dashboard.tsx`, prepend a new entry to the `SECTIONS` array:

```tsx
const SECTIONS: SectionCard[] = [
  {
    title: "Search",
    description: "Find frames across indexed bags by text or by image.",
    href: "/search",
    status: "available",
  },
  {
    title: "Bag Explorer",
    description: "Browse indexed bags, inspect frames, and trigger dataset extraction.",
    href: "/bags",
    status: "available",
  },
  // …rest unchanged
];
```

- [ ] **Step 3: Type-check + lint + manual smoke**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd .. && JWT_SECRET=devsecret REFRESH_SECRET=devrefresh uv run uvicorn app:app --reload &
```

Open http://localhost:8000:
1. Log in.
2. Dashboard now shows a "Search" card. Click it.
3. `/search` loads. Empty state with "Search across N indexed bags" + example chips.
4. Click "pedestrian on the crosswalk". URL gains `?q=…`, results appear.
5. Drag the FilterChip's minScore slider — results filter live; URL gains `?minScore=…`.
6. Click 📂 chip — popover opens; toggle a bag — URL gains `?bags=…`.
7. Click a result thumbnail — navigates to `/bags/<id>?t=<ns>`. Browser back returns to results instantly (no refetch flicker).

Stop the server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router.tsx frontend/src/pages/dashboard.tsx
git commit -m "[Routing] wire SearchPage into /search and add dashboard card"
```

---

### Task 10: `PinRail` component

**Files:**
- Create: `frontend/src/components/bags/pin-rail.tsx`

The rail is a thin proportional bar showing the entire bag's time range. Pins are positioned linearly. An orange viewport band shows what slice of time is currently visible in the thumbnail strip below.

- [ ] **Step 1: Write the component**

`frontend/src/components/bags/pin-rail.tsx`:

```tsx
import { useMemo } from "react";

import type { Pin } from "../../types/pin";

interface PinRailProps {
  pins: Pin[];
  /** Bag's full time range. Determines x-position mapping. */
  bagStartNs: number | null;
  bagEndNs: number | null;
  /** Slice of time currently visible in the thumbnail strip (orange band). */
  viewportStartNs?: number | null;
  viewportEndNs?: number | null;
  /** The currently-selected pin timestamp (for emphasis). */
  selectedTimestampNs: number | null;
  onPinClick: (timestampNs: number) => void;
}

function pctOf(ts: number, start: number, end: number): number {
  if (end <= start) return 0;
  return ((ts - start) / (end - start)) * 100;
}

function pinColor(pin: Pin): string {
  if (pin.color) return pin.color;
  if (pin.source === "search") {
    const score = pin.score ?? 0;
    // map 0..1 score to teal opacity 0.4..1.0
    const opacity = 0.4 + score * 0.6;
    return `rgba(22, 160, 133, ${opacity.toFixed(2)})`;
  }
  return "var(--ink-soft)";
}

export function PinRail({
  pins,
  bagStartNs,
  bagEndNs,
  viewportStartNs,
  viewportEndNs,
  selectedTimestampNs,
  onPinClick,
}: PinRailProps) {
  const ready = bagStartNs !== null && bagEndNs !== null && bagEndNs > bagStartNs;

  const positionedPins = useMemo(() => {
    if (!ready) return [];
    return pins.map((pin) => ({
      pin,
      leftPct: pctOf(pin.timestamp_ns, bagStartNs!, bagEndNs!),
    }));
  }, [pins, ready, bagStartNs, bagEndNs]);

  const viewportLeftPct =
    ready && viewportStartNs != null
      ? pctOf(Math.max(viewportStartNs, bagStartNs!), bagStartNs!, bagEndNs!)
      : null;
  const viewportRightPct =
    ready && viewportEndNs != null
      ? pctOf(Math.min(viewportEndNs, bagEndNs!), bagStartNs!, bagEndNs!)
      : null;

  if (!ready) {
    return (
      <div className="rounded-md border border-dashed border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--ink-soft)]">
        Loading bag time range…
      </div>
    );
  }

  return (
    <div
      className="relative rounded-md border border-[var(--line)] bg-[var(--bg-paper)] px-2 py-2"
      role="group"
      aria-label="Pin rail"
    >
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--ink-soft)]">
        <span>{pins.length} pin{pins.length === 1 ? "" : "s"}</span>
        {pins.length > 0 ? <span>↑↓ jump · click to focus</span> : null}
      </div>
      <div className="relative h-3 rounded-full bg-[var(--bg-sand)]">
        {/* Viewport band */}
        {viewportLeftPct !== null && viewportRightPct !== null ? (
          <div
            className="absolute top-0 h-full rounded-full bg-[#f59e0b]/25 ring-1 ring-[#f59e0b]/60"
            style={{
              left: `${viewportLeftPct}%`,
              width: `${Math.max(0.5, viewportRightPct - viewportLeftPct)}%`,
            }}
            aria-label="Visible thumbnail range"
          />
        ) : null}

        {/* Pins */}
        {positionedPins.map(({ pin, leftPct }, idx) => {
          const selected = selectedTimestampNs === pin.timestamp_ns;
          return (
            <button
              key={`${pin.source}-${pin.timestamp_ns}-${idx}`}
              type="button"
              onClick={() => onPinClick(pin.timestamp_ns)}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm transition ${
                selected ? "z-10 ring-2 ring-white" : ""
              }`}
              style={{
                left: `${leftPct}%`,
                width: 4,
                height: selected ? 18 : 14,
                backgroundColor: pinColor(pin),
              }}
              aria-label={pin.label ?? `Pin at ${pin.timestamp_ns}`}
              title={pin.label ?? `${pin.source} @ ${pin.timestamp_ns}`}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/bags/pin-rail.tsx
git commit -m "[UI] add PinRail component with proportional pins + viewport band"
```

---

### Task 11: Extend `BagSequenceViewer` with pin overlay support

**Files:**
- Modify: `frontend/src/components/bags/bag-sequence-viewer.tsx`

The viewer currently renders header → frame canvas → thumbnail strip → chat panel. We add two new optional props: `pinRail` (rendered above the strip) and `highlightedTimestamps` (a Map fed into the strip's frame rendering loop). We also expose an optional `headerSlot` so `BagDetailPage` can replace the bag-name header with the search header without forking the file.

- [ ] **Step 1: Read the existing thumbnail-strip JSX**

```bash
sed -n '90,200p' frontend/src/components/bags/bag-sequence-viewer.tsx
```

Identify the loop that renders frame thumbnails (look for `frames.map((frame, …) => …)`). You'll need to wrap each thumbnail's outer element with conditional classes / an extra badge when its timestamp is in `highlightedTimestamps`.

- [ ] **Step 2: Add the new props to the interface**

In the `BagSequenceViewerProps` interface (lines 19–47 of the existing file), add three optional props:

```ts
import type { ReactNode } from "react";
// …existing imports…

interface BagSequenceViewerProps {
  // …all existing props…
  /** Optional override for the page header. When provided, replaces the default bag-name header. */
  headerSlot?: ReactNode;
  /** Optional rail rendered between header and frame canvas (or above the thumbnail strip — choose one consistent location). */
  pinRail?: ReactNode;
  /** Map of timestamps → score; matching thumbnails render with an orange outline + score badge. */
  highlightedTimestamps?: Map<number, number>;
}
```

- [ ] **Step 3: Destructure them in the component signature**

Add `headerSlot`, `pinRail`, and `highlightedTimestamps` to the destructuring at lines 55–82:

```tsx
export function BagSequenceViewer({
  // …existing destructured props…
  headerSlot,
  pinRail,
  highlightedTimestamps,
}: BagSequenceViewerProps) {
  // …
}
```

- [ ] **Step 4: Render `headerSlot` in place of the existing header (when provided)**

Find the JSX that renders the bag-name header (likely a `<div>` with the bag's display name + status badge near the top of the return statement). Wrap it:

```tsx
{headerSlot ?? (
  <div className="…existing header classes…">
    {/* existing header content */}
  </div>
)}
```

- [ ] **Step 5: Render `pinRail` immediately above the thumbnail strip**

Find the JSX block that renders the thumbnail strip (the `frames.map(…)` container). Insert `pinRail` directly before it:

```tsx
{pinRail ? <div className="mb-2">{pinRail}</div> : null}
<div className="…existing strip container classes…">
  {frames.map((frame, idx) => {
    const isHighlighted = highlightedTimestamps?.has(frame.timestamp_ns) ?? false;
    const score = highlightedTimestamps?.get(frame.timestamp_ns);
    // existing rendering, with the conditional outline + badge:
    return (
      <button
        key={frame.timestamp_ns}
        // …existing handlers…
        className={`…existing classes… ${
          isHighlighted ? "ring-2 ring-[#f59e0b] ring-offset-1" : ""
        }`}
      >
        {/* existing thumbnail content */}
        {isHighlighted && score !== undefined ? (
          <span className="absolute right-1 top-1 rounded-sm bg-[#16a085] px-1 text-[9px] font-semibold leading-none text-white">
            {score.toFixed(2)}
          </span>
        ) : null}
      </button>
    );
  })}
</div>
```

You may need to add `relative` to the button's existing className (so the absolute-positioned badge anchors correctly).

- [ ] **Step 6: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors. (`headerSlot`, `pinRail`, `highlightedTimestamps` are all optional — existing call sites in `BagDetailPage` keep working without supplying them.)

- [ ] **Step 7: Manual smoke (existing functionality intact)**

Build + run + browse to a `/bags/:bagId` page. Confirm the viewer renders identically to before this change (since none of the new props are passed yet).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/bags/bag-sequence-viewer.tsx
git commit -m "[UI] add pinRail / highlightedTimestamps / headerSlot props to BagSequenceViewer"
```

---

### Task 12: Per-bag search on `BagDetailPage`

**Files:**
- Modify: `frontend/src/pages/bags/bag-detail-page.tsx`

Wire `useUrlSearch({ scope: { bags: [bagPath] } })`, derive pins via `usePins`, build a search header (replacing the default), pass `pinRail` + `highlightedTimestamps` to the viewer, and add Up/Down keyboard navigation for pins.

- [ ] **Step 1: Add imports and helpers near the top of the file**

After the existing imports in `bag-detail-page.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
// …existing imports…

import { FilterChip } from "../../components/search/filter-chip";
import { SearchInput } from "../../components/search/search-input";
import { PinRail } from "../../components/bags/pin-rail";
import { Badge } from "../../components/ui/badge";
import { usePins } from "../../hooks/use-pins";
import { useUrlSearch } from "../../hooks/use-url-search";
```

- [ ] **Step 2: Wire search + pins inside the component**

After the existing `viewerState` and `launcher` declarations (around line 60–62), add:

```tsx
const search = useUrlSearch({
  scope: { bagPaths: bagPath ? [bagPath] : [] },
});
const [searchDraft, setSearchDraft] = useState(search.q);
useEffect(() => {
  setSearchDraft(search.q);
}, [search.q]);

const pins = usePins(bagPath, search.results, search.minScore);

const highlightedTimestamps = useMemo(() => {
  const map = new Map<number, number>();
  for (const p of pins) {
    if (p.score !== undefined) map.set(p.timestamp_ns, p.score);
  }
  return map;
}, [pins]);
```

- [ ] **Step 3: Compute viewport range from currently-loaded frames**

The PinRail's orange band should track which slice of the bag is currently displayed in the thumbnail strip. The simplest source: the first and last loaded frames.

```tsx
const viewportRange = useMemo(() => {
  const frames = viewerState.frames;
  if (frames.length === 0) return { start: null as number | null, end: null as number | null };
  return {
    start: frames[0].timestamp_ns,
    end: frames[frames.length - 1].timestamp_ns,
  };
}, [viewerState.frames]);
```

- [ ] **Step 4: Build the search header slot**

Just before the `return` block that renders `<BagSequenceViewer />`, build a `headerSlot` JSX:

```tsx
const headerSlot = (
  <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
    <div className="flex flex-shrink-0 items-center gap-2">
      <Link
        to="/bags"
        className="text-[var(--ink-soft)] hover:text-[var(--ink)]"
        aria-label="Back to bags"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <span className="font-mono text-xs">{resolvedBag.bag_name}</span>
      <Badge variant={resolvedBag.is_indexed ? "default" : "outline"} className="text-[10px]">
        {resolvedBag.status}
      </Badge>
    </div>
    <div className="flex-1">
      <SearchInput
        value={searchDraft}
        placeholder="Find in this bag…"
        disabled={!resolvedBag.is_indexed}
        onChange={setSearchDraft}
        onSubmit={(text) => search.submitText(text)}
        onClear={() => {
          setSearchDraft("");
          search.clear();
        }}
        onImageUpload={(file) => void search.submitImage(file)}
      />
    </div>
  </div>
);
```

(The `ArrowLeft` import is already present.)

- [ ] **Step 5: Build the pinRail JSX**

Right after `headerSlot`:

```tsx
const pinRail = search.q || search.similar ? (
  <div className="space-y-2">
    <FilterChip
      topK={search.topK}
      minScore={search.minScore}
      rawResultCount={search.rawResultCount}
      bagCount={1}
      showTopK={false}
      onTopKChange={search.setTopK}
      onMinScoreChange={search.setMinScore}
    />
    <PinRail
      pins={pins}
      bagStartNs={bagInfo?.first_timestamp_ns ?? null}
      bagEndNs={bagInfo?.last_timestamp_ns ?? null}
      viewportStartNs={viewportRange.start}
      viewportEndNs={viewportRange.end}
      selectedTimestampNs={viewerState.selectedTimestampNs}
      onPinClick={(ns) => viewerState.setSelectedTimestampNs(ns)}
    />
  </div>
) : null;
```

- [ ] **Step 6: Add Up/Down + Esc keyboard handlers**

Add this `useEffect` near the other effects in the component. It handles ↑/↓ for pin navigation and Esc for clearing the search (preserving `?t=`).

```tsx
useEffect(() => {
  if (!resolvedBag) return;
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const isEditing = tag === "INPUT" || tag === "TEXTAREA";

    // Esc clears the search; the SearchInput's input is allowed to handle it
    // first via its own behavior, but if the focus is elsewhere, we still want
    // Esc to clear pins. Skip while typing (the input has its own clear button).
    if (e.key === "Escape" && !isEditing && (search.q || search.similar)) {
      e.preventDefault();
      setSearchDraft("");
      search.clear();
      return;
    }

    if (isEditing) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (pins.length === 0) return;
    e.preventDefault();

    const currentTs = viewerState.selectedTimestampNs;
    const sorted = pins;
    let next: number;
    if (currentTs === null) {
      next = e.key === "ArrowDown" ? sorted[0].timestamp_ns : sorted[sorted.length - 1].timestamp_ns;
    } else {
      const idx = sorted.findIndex((p) => p.timestamp_ns === currentTs);
      const fallback = sorted.findIndex((p) => p.timestamp_ns > currentTs);
      const baseIdx = idx >= 0 ? idx : fallback >= 0 ? fallback - 1 : sorted.length - 1;
      const targetIdx =
        e.key === "ArrowDown"
          ? Math.min(sorted.length - 1, baseIdx + 1)
          : Math.max(0, baseIdx - 1);
      next = sorted[targetIdx].timestamp_ns;
    }
    viewerState.setSelectedTimestampNs(next);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [pins, viewerState, resolvedBag, search]);
```

- [ ] **Step 7: Pass the new props to `<BagSequenceViewer />`**

In the existing JSX, add three props:

```tsx
<BagSequenceViewer
  // …all existing props…
  headerSlot={headerSlot}
  pinRail={pinRail}
  highlightedTimestamps={highlightedTimestamps}
/>
```

- [ ] **Step 8: Type-check + lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Expected: 0 new errors.

- [ ] **Step 9: Manual smoke**

Build + run. On `/bags/<some-indexed-bag>`:

1. The header now shows: ← back · bag name · status badge · search input.
2. Type "pedestrian" + Enter. URL gains `?q=pedestrian`. Pins appear on a new rail above the thumbnail strip. Matching thumbnails get an orange outline + score badge.
3. Drag the FilterChip's `Min similarity` slider — pins update live.
4. Press ↓ / ↑ — viewer jumps between pins in chronological order.
5. Click a pin on the rail — viewer jumps to that frame.
6. Click the ✕ in the search input — pins clear, URL drops `?q=`, `?t=` is preserved.
7. Open a not-yet-indexed bag — search input is disabled with a tooltip-equivalent (placeholder hint).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/bags/bag-detail-page.tsx
git commit -m "[Feat] add per-bag search with PinRail to BagDetailPage"
```

---

### Task 13: Manual QA pass + cleanup

**Files:** none (verification only; fix-forward commits as needed)

Run the spec's full QA checklist (§11 of the design spec). Fix any issues found inline as additional small commits.

- [ ] **Step 1: Build a fresh production bundle**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Run backend tests for regression**

```bash
cd .. && PYTHONPATH="" uv run pytest tests/ -q
```

Expected: same passing/failing state as Task 0 baseline (the 2 pre-existing `test_api.py` failures are environmental — see CLAUDE.md).

- [ ] **Step 3: Walk through `/search` QA items**

Start the server:

```bash
JWT_SECRET=devsecret REFRESH_SECRET=devrefresh uv run uvicorn app:app --reload &
```

Browse http://localhost:8000 and verify each of these (mark each):

- [ ] Empty state shows with 0 query and bag count.
- [ ] Search submit writes `?q=` to URL; refresh restores results.
- [ ] FilterChip expand/collapse; topK slider triggers refetch; minScore slider re-filters live without refetch; both write to URL.
- [ ] BagPicker popover: filter input, select-all/clear, individual toggles all write to URL.
- [ ] Image upload search runs without URL change.
- [ ] Similar search via magnifier replaces `?q=` with `?similar=`.
- [ ] Click a result → navigates to `/bags/:bagId?t=<ns>`. Cmd/Ctrl-click opens a new tab.
- [ ] Browser back from detail page → restores results instantly.
- [ ] `?bags=<bad_id>` produces a toast and proceeds with valid ids. (Test: edit URL manually.)
- [ ] Clamping: `?topK=999` and `?minScore=2` are normalized in the URL.
- [ ] "No indexed bags" CTA links to `/bags`. (Test: stop scan / re-index nothing.)

- [ ] **Step 4: Walk through `/bags/:bagId` QA items**

- [ ] Per-bag search: typing in the bag-detail header writes `?q=`; pins appear on the rail; matching thumbnails get highlighted.
- [ ] Pin click jumps the viewer.
- [ ] ↑/↓ keys cycle pins.
- [ ] Esc clears search and preserves `?t=`.
- [ ] Scrolling the thumbnail strip moves the orange viewport band on the rail.
- [ ] Search active on an un-indexed bag → input disabled.
- [ ] minScore threshold filtering hides pins live.

- [ ] **Step 5: Walk through `/workspace` regression**

- [ ] Scanner + bag list + checkbox-scoped search + modal sequence viewer + extract dialog + sidebar Jobs tab — all still work.
- [ ] Dashboard "Search" card now navigates to `/search`.

- [ ] **Step 6: Final lint sweep**

```bash
cd frontend && npm run lint
```

Expected: only the 2 pre-existing errors. If anything new, fix and re-commit before ending the task.

- [ ] **Step 7: Final commit (only if QA fixes were needed)**

```bash
git add -A
git commit -m "[Fix] address Phase 3 manual QA findings"
```

(If no fixes were needed, skip this step.)

---

## Done

Phase 3 lands when:

- All commits above are on `frontend-refactor`.
- `cd frontend && npm run build && npm run lint` passes (modulo the 2 pre-existing lint errors).
- Backend `pytest tests/` is green (modulo the 2 pre-existing `test_api.py` connection errors).
- Manual QA checklist (Task 13) is fully checked.
- Spec's "Out of Scope" items remain not built.

**Next phase (Phase 4):** delete `WorkspacePage`, the legacy `SearchBar`, the modal `SequenceViewer`, and the legacy `BagList` — the `/workspace` route disappears with them. CLAUDE.md's roadmap table flips to ✅.
