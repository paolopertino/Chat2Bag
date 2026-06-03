import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import type { Area } from "../api/types";
import { decodeArea, encodeArea } from "../lib/area-codec";

export function useMapArea() {
  const [searchParams, setSearchParams] = useSearchParams();
  const area = decodeArea(searchParams.get("area"));

  const setArea = useCallback(
    (next: Area | null) => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set("area", encodeArea(next));
      else params.delete("area");
      setSearchParams(params, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  return { area, setArea, clearArea: () => setArea(null) };
}
