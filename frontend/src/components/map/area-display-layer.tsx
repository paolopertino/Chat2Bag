import maplibregl from "maplibre-gl";
import { useEffect } from "react";

import type { Area } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

function areaToPolygon(area: Area): GeoJSON.Feature {
  if (area.kind === "polygon") {
    const ring = area.vertices.map((v) => [v.lon, v.lat]);
    ring.push(ring[0]);
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }
  const ring: [number, number][] = [];
  const latRad = (area.center.lat * Math.PI) / 180;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([
      area.center.lon + (area.radius_m * Math.sin(t)) / (111320 * Math.cos(latRad)),
      area.center.lat + (area.radius_m * Math.cos(t)) / 111320,
    ]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export function AreaDisplayLayer({ area }: { area: Area | null }) {
  const map = useMap();

  useEffect(() => {
    whenStyleReady(map, () => {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: area ? [areaToPolygon(area)] : [],
      };
      const source = map.getSource("area-display") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource("area-display", { type: "geojson", data });
        map.addLayer({
          id: "area-display-fill",
          type: "fill",
          source: "area-display",
          paint: { "fill-color": "#34d399", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "area-display-line",
          type: "line",
          source: "area-display",
          paint: { "line-color": "#34d399", "line-width": 2, "line-dasharray": [2, 1] },
        });
      }
    });
  }, [map, area]);

  return null;
}
