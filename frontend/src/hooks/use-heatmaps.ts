import { useEffect, useRef, useState } from "react";

import type { HeatmapResponse } from "../api/types";

/**
 * Lazily fetches region-search heatmaps for the given frames while `enabled`.
 * Results accumulate in a `filePath -> heatmap` map; each frame is fetched at
 * most once. Returns an empty map when disabled or no fetcher is provided.
 */
export function useHeatmaps(
  filePaths: string[],
  fetchHeatmap: ((targetFilePath: string) => Promise<HeatmapResponse | null>) | undefined,
  enabled: boolean,
): Record<string, HeatmapResponse | undefined> {
  const [heatmaps, setHeatmaps] = useState<Record<string, HeatmapResponse | undefined>>({});
  const heatmapsRef = useRef(heatmaps);
  const loadingRef = useRef<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const key = filePaths.join("|");
  useEffect(() => {
    if (!enabled || !fetchHeatmap || filePaths.length === 0) return;
    const missing = filePaths.filter(
      (filePath) => !heatmapsRef.current[filePath] && !loadingRef.current[filePath],
    );
    if (missing.length === 0) return;
    for (const filePath of missing) loadingRef.current[filePath] = true;
    for (const filePath of missing) {
      fetchHeatmap(filePath)
        .then((heatmap) => {
          if (mountedRef.current && heatmap) {
            setHeatmaps((previous) => {
              const next = { ...previous, [filePath]: heatmap };
              heatmapsRef.current = next;
              return next;
            });
          }
        })
        .catch(() => null)
        .finally(() => {
          loadingRef.current[filePath] = false;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fetchHeatmap, key]);

  return heatmaps;
}
