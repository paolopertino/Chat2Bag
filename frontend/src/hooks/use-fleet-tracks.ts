import { useEffect, useState } from "react";

import { fetchFleetTracks } from "../api/client";
import type { FleetTrack } from "../api/types";

export function useFleetTracks(bagPaths: string[]): {
  tracks: FleetTrack[];
  loading: boolean;
} {
  const [tracks, setTracks] = useState<FleetTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const key = bagPaths.slice().sort().join("|");

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTracks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFleetTracks(key.split("|"))
      .then((resp) => {
        if (!cancelled) setTracks(resp.tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { tracks, loading };
}
