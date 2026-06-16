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

/**
 * timestamp_ns of the point on the track *line* nearest to a clicked lng/lat
 * (equirectangular approx). We project the click onto each polyline segment and
 * interpolate the timestamp along the nearest one — not onto the nearest vertex.
 *
 * Tracks are decimated to ~500 points (see /api/bags/tracks), so vertices are sparse
 * along the path. Snapping to the nearest *vertex* makes two spatially-separate passes
 * over the same road collapse to the same point (the cross-track gap between the passes
 * is smaller than the along-track spacing between surviving vertices), so clicking
 * either line returned the same timestamp. Projecting onto segments distinguishes the
 * passes the same way the rendered lines do.
 */
function nearestTimestampNs(track: FleetTrack, lng: number, lat: number): number | undefined {
  const pts = track.points;
  if (pts.length === 0) return undefined;
  if (pts.length === 1) return pts[0].timestamp_ns;

  // Scale longitude by cos(lat) so distances are ~isotropic in this local frame.
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const cx = lng * cosLat;
  const cy = lat;

  let bestDist = Infinity;
  let bestTs = pts[0].timestamp_ns;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ax = a.lon * cosLat;
    const ay = a.lat;
    const vx = b.lon * cosLat - ax;
    const vy = b.lat - ay;
    const len2 = vx * vx + vy * vy;
    // Projection fraction of the click onto segment [a, b], clamped to the segment.
    let t = len2 > 0 ? ((cx - ax) * vx + (cy - ay) * vy) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = cx - (ax + t * vx);
    const dy = cy - (ay + t * vy);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestTs = Math.round(a.timestamp_ns + (b.timestamp_ns - a.timestamp_ns) * t);
    }
  }
  return bestTs;
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
  onTrackClick: (bagPath: string, timestampNs?: number) => void;
}

export function FleetTracksLayer({ tracks, hoveredBagPath, onTrackClick }: FleetTracksLayerProps) {
  const map = useMap();
  const didFitRef = useRef(false);
  const clickRef = useRef(onTrackClick);
  // The click handler is registered once (on first style-ready add), so read the
  // latest callback and tracks through refs to avoid stale closures.
  const tracksRef = useRef(tracks);

  useEffect(() => {
    clickRef.current = onTrackClick;
    tracksRef.current = tracks;
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
          if (!f) return;
          const bagPath = f.properties.bag_path as string;
          const track = tracksRef.current.find((t) => t.bag_path === bagPath);
          const timestampNs = track
            ? nearestTimestampNs(track, e.lngLat.lng, e.lngLat.lat)
            : undefined;
          clickRef.current(bagPath, timestampNs);
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
