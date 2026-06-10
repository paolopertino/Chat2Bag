import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { FleetTrack } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

const PALETTE = [
  "#4da3ff", "#39d98a", "#b07cff", "#ffb84d",
  "#ff6b81", "#4dd6c1", "#c9d64d", "#7c9cff",
];

// eslint-disable-next-line react-refresh/only-export-components
export function trackColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function toFeatureCollection(tracks: FleetTrack[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: tracks.map((t, i) => ({
      type: "Feature",
      properties: { bag_path: t.bag_path, bag_name: t.bag_name, color: trackColor(i) },
      geometry: {
        type: "LineString",
        coordinates: t.points.map((p) => [p.lon, p.lat]),
      },
    })),
  };
}

interface FleetTracksLayerProps {
  tracks: FleetTrack[];
  hoveredBagPath: string | null;
  onTrackClick: (bagPath: string) => void;
}

export function FleetTracksLayer({ tracks, hoveredBagPath, onTrackClick }: FleetTracksLayerProps) {
  const map = useMap();
  const didFitRef = useRef(false);
  const clickRef = useRef(onTrackClick);

  useEffect(() => {
    clickRef.current = onTrackClick;
  });

  useEffect(() => {
    whenStyleReady(map, () => {
      const data = toFeatureCollection(tracks);
      const source = map.getSource("fleet-tracks") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
      } else {
        map.addSource("fleet-tracks", { type: "geojson", data });
        map.addLayer({
          id: "fleet-tracks-line",
          type: "line",
          source: "fleet-tracks",
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85 },
        });
        map.addLayer({
          id: "fleet-tracks-hover",
          type: "line",
          source: "fleet-tracks",
          paint: { "line-color": ["get", "color"], "line-width": 7 },
          filter: ["==", ["get", "bag_path"], ""],
        });
        map.on("click", "fleet-tracks-line", (e) => {
          const f = e.features?.[0];
          if (f) clickRef.current(f.properties.bag_path as string);
        });
        map.on("mouseenter", "fleet-tracks-line", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "fleet-tracks-line", () => {
          map.getCanvas().style.cursor = "";
        });
      }
      if (!didFitRef.current && tracks.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const t of tracks) for (const p of t.points) bounds.extend([p.lon, p.lat]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 1500 });
        didFitRef.current = true;
      }
    });
  }, [map, tracks]);

  useEffect(() => {
    whenStyleReady(map, () => {
      if (map.getLayer("fleet-tracks-hover")) {
        map.setFilter("fleet-tracks-hover", ["==", ["get", "bag_path"], hoveredBagPath ?? ""]);
      }
    });
  }, [map, hoveredBagPath]);

  return null;
}
