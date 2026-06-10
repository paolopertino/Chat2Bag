import { useCallback, useEffect, useRef, useState } from "react";

import { getTrack } from "../api/client";
import type { TrackPoint } from "../api/types";

export function useBagTracks(bagPaths: string[]) {
  const [tracks, setTracks] = useState<Record<string, TrackPoint[]>>({});
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Record<string, TrackPoint[]>>({});

  const key = bagPaths.join(",");
  useEffect(() => {
    let cancelled = false;
    const missing = bagPaths.filter((b) => !(b in cacheRef.current));
    if (missing.length === 0) {
      setTracks({ ...cacheRef.current });
      return;
    }
    setLoading(true);
    Promise.all(missing.map((b) => getTrack(b).then((r) => [b, r.points] as [string, TrackPoint[]]).catch(() => [b, [] as TrackPoint[]] as [string, TrackPoint[]])))
      .then((entries) => {
        if (cancelled) return;
        for (const [b, pts] of entries) cacheRef.current[b] = pts;
        setTracks({ ...cacheRef.current });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const tracksForSelected = useCallback(
    () => bagPaths.map((b) => tracks[b] ?? []),
    [bagPaths, tracks],
  );

  return { tracks, tracksForSelected, loading };
}
