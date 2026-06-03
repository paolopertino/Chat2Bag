import { useEffect, useMemo, useState } from "react";

import type { Pin, PinProvider } from "../types/pin";
import type { SearchResult } from "../api/types";

// Stable reference so callers without additionalProviders don't re-trigger effects.
const EMPTY_PROVIDERS: PinProvider[] = [];

/**
 * Synthesizes Pin[] from search results matching the current bag,
 * filters by minScore, and merges any additional async PinProviders.
 * Result is sorted by timestamp_ns.
 */
export function usePins(
  bagPath: string | null,
  results: SearchResult[],
  minScore: number,
  additionalProviders: PinProvider[] = EMPTY_PROVIDERS,
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
    if (!bagPath || additionalProviders.length === 0) return;
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
    // Ignore stale providerPins when there are no active providers.
    const effectivePins = bagPath && additionalProviders.length > 0 ? providerPins : [];
    const merged = [...searchPins, ...effectivePins];
    merged.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
    return merged;
  }, [searchPins, providerPins, bagPath, additionalProviders]);
}
