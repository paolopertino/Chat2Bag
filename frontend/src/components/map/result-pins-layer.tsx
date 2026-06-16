import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { SearchResult } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

interface ResultPinsLayerProps {
  results: SearchResult[];
  onPinClick: (resultIndex: number) => void;
}

export function ResultPinsLayer({ results, onPinClick }: ResultPinsLayerProps) {
  const map = useMap();
  const clickRef = useRef(onPinClick);

  useEffect(() => {
    clickRef.current = onPinClick;
  });

  useEffect(() => {
    whenStyleReady(map, () => {
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: results.flatMap((r, i) =>
          r.lat !== undefined && r.lon !== undefined
            ? [
                {
                  type: "Feature" as const,
                  properties: { resultIndex: i },
                  geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
                },
              ]
            : [],
        ),
      };
      const source = map.getSource("result-pins") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      map.addSource("result-pins", { type: "geojson", data, cluster: true, clusterRadius: 40 });
      map.addLayer({
        id: "result-pins-clusters",
        type: "circle",
        source: "result-pins",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ffb84d",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 50, 22],
        },
      });
      map.addLayer({
        id: "result-pins-count",
        type: "symbol",
        source: "result-pins",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 },
      });
      map.addLayer({
        id: "result-pins-point",
        type: "circle",
        source: "result-pins",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#ffb84d",
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.on("click", "result-pins-point", (e) => {
        const f = e.features?.[0];
        if (f) clickRef.current(f.properties.resultIndex as number);
      });
      map.on("click", "result-pins-clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource("result-pins") as maplibregl.GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
        map.easeTo({
          center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });
      for (const layer of ["result-pins-point", "result-pins-clusters"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
    });
  }, [map, results]);

  return null;
}
