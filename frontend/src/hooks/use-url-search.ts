import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { useSearch } from "./use-search";
import { useBags } from "../context/bags-context";
import { decodeBagId } from "../lib/bag-id";
import { decodeArea } from "../lib/area-codec";
import type { Area } from "../api/types";

const TOP_K_DEFAULT = 25;
const MIN_SCORE_DEFAULT = 0;
const TOP_K_MIN = 1;
const TOP_K_MAX = 100;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function parseBags(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeBagIds(ids: string[]): { paths: string[]; malformedCount: number } {
  const paths: string[] = [];
  let malformedCount = 0;
  for (const id of ids) {
    try {
      paths.push(decodeBagId(id));
    } catch {
      malformedCount++;
    }
  }
  return { paths, malformedCount };
}

interface UseUrlSearchOptions {
  /** When provided, these bag PATHS override the URL `bags` param (used by per-bag search). */
  scope?: { bagPaths: string[] };
  /**
   * Default value for topK when the URL param is absent.
   * Defaults to 25 for global search; use 100 for per-bag search (all hits in a single bag).
   */
  topKDefault?: number;
}

export function useUrlSearch(options: UseUrlSearchOptions = {}) {
  const { topKDefault = TOP_K_DEFAULT } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const search = useSearch();
  const { bags } = useBags();
  const lastFetchKeyRef = useRef<string>("");

  // All indexed bag paths — the fallback when no explicit selection is in the URL.
  const allIndexedBagPaths = useMemo(
    () => bags.filter((b) => b.is_indexed).map((b) => b.bag_path),
    [bags],
  );

  // Read URL state, with normalization
  const q = searchParams.get("q") ?? "";
  const similar = searchParams.get("similar") ?? "";
  const area: Area | null = decodeArea(searchParams.get("area"));
  const rawTopKStr = searchParams.get("topK");
  const rawMinScoreStr = searchParams.get("minScore");
  const rawTopK = rawTopKStr !== null ? Number(rawTopKStr) : NaN;
  const rawMinScore = rawMinScoreStr !== null ? Number(rawMinScoreStr) : NaN;
  const topK = clamp(Number.isFinite(rawTopK) ? rawTopK : topKDefault, TOP_K_MIN, TOP_K_MAX);
  const minScore = clamp(Number.isFinite(rawMinScore) ? rawMinScore : MIN_SCORE_DEFAULT, 0, 1);

  // Write clamped values back when URL params are out of range (replace history entry).
  useEffect(() => {
    const patches: Record<string, string> = {};
    if (rawTopKStr && String(topK) !== rawTopKStr) patches.topK = String(topK);
    if (rawMinScoreStr && String(minScore) !== rawMinScoreStr) patches.minScore = String(minScore);
    if (Object.keys(patches).length === 0) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patches)) next.set(k, v);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTopKStr, rawMinScoreStr]);

  // urlBags = raw encoded IDs (used by the chip for selection state).
  const urlBags = useMemo(() => parseBags(searchParams.get("bags")), [searchParams]);

  // bagPaths from URL = decoded paths (used by the API).
  const { paths: bagPathsFromUrl, malformedCount } = useMemo(
    () => decodeBagIds(urlBags),
    [urlBags],
  );

  // Toast when malformed bag IDs are encountered in the URL.
  useEffect(() => {
    if (malformedCount > 0) {
      toast.error(
        `${malformedCount} bag ID${malformedCount === 1 ? "" : "s"} in the URL could not be decoded and ${malformedCount === 1 ? "was" : "were"} skipped.`,
      );
    }
  }, [malformedCount]);

  // Effective bag paths sent to the search backend.
  // Priority: scope override > explicit URL bags > all indexed (spec default).
  // Wrapped in useMemo so identity is stable — callers must memoize options.scope.
  const effectiveBagPaths = useMemo(
    () =>
      options.scope
        ? options.scope.bagPaths
        : bagPathsFromUrl.length > 0
          ? bagPathsFromUrl
          : allIndexedBagPaths,
    [options.scope, bagPathsFromUrl, allIndexedBagPaths],
  );

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
    const key = JSON.stringify({ q, similar, topK, bags: effectiveBagPaths, area: searchParams.get("area") });
    if (key === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = key;

    if (similar) {
      void search.runSimilarSearch({ file_path: similar }, effectiveBagPaths, topK);
    } else if (q) {
      void search.runSearch(effectiveBagPaths, q, topK, area ?? undefined);
    } else if (area) {
      void search.runMapBrowse(area, effectiveBagPaths, topK);
    } else {
      search.clearResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, similar, topK, effectiveBagPaths.join(","), searchParams.get("area")]);

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
    () => search.results.filter((r) => (r.similarity_score ?? 1) >= minScore),
    [search.results, minScore],
  );

  return {
    q,
    similar,
    topK,
    minScore,
    area,
    /** Effective bag PATHS for the fetch (decoded; or scope override; or all indexed by default). */
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
