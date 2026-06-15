import { useEffect, useRef } from "react";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawPolygonMode,
  type GeoJSONStoreFeatures,
  type GeoJSONStoreGeometries,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import type { Area, LatLon } from "../../api/types";
import { useMap, whenStyleReady } from "./maplibre-map";

function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function featureToArea(
  feature: GeoJSONStoreFeatures<GeoJSONStoreGeometries>,
  mode: "circle" | "polygon",
): Area | null {
  if (feature.geometry.type !== "Polygon") return null;
  const ring = feature.geometry.coordinates[0].slice(0, -1); // drop closing vertex
  const vertices = ring.map(([lon, lat]) => ({ lat, lon } as LatLon));
  if (mode === "polygon") return vertices.length >= 3 ? { kind: "polygon", vertices } : null;
  const center: LatLon = {
    lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length,
    lon: vertices.reduce((s, v) => s + v.lon, 0) / vertices.length,
  };
  return { kind: "circle", center, radius_m: haversineMeters(center, vertices[0]) };
}

interface AreaDrawProps {
  mode: "circle" | "polygon" | null;
  onArea: (area: Area) => void;
  onDone: () => void;
}

export function AreaDraw({ mode, onArea, onDone }: AreaDrawProps) {
  const map = useMap();
  const drawRef = useRef<TerraDraw | null>(null);

  useEffect(() => {
    // terra-draw's start() registers GeoJSON sources/layers on the map, which
    // throws "Style is not done loading" if called before the style loads.
    // Defer start until the style is ready (matching the other map layers),
    // and guard against unmount happening before that fires.
    let cancelled = false;
    let draw: TerraDraw | null = null;
    whenStyleReady(map, () => {
      if (cancelled) return;
      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawCircleMode()],
      });
      draw.start();
      draw.setMode("static");
      drawRef.current = draw;
    });
    return () => {
      cancelled = true;
      // Navigating away unmounts both this component and <MapLibreMap>, which
      // calls map.remove(). If the map is torn down first, terra-draw's stop()
      // reaches into the dead map (getSource on an undefined style) and throws,
      // crashing the route. The map's removal disposes terra-draw's own
      // sources/layers anyway, so a teardown failure here is safe to ignore.
      if (draw) {
        try {
          draw.stop();
        } catch {
          /* map already removed — terra-draw teardown is moot */
        }
      }
      drawRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (!mode) {
      draw.setMode("static");
      return;
    }
    draw.setMode(mode);
    const onFinish = (id: string | number) => {
      const feature = draw.getSnapshot().find((f) => f.id === id);
      if (feature) {
        const area = featureToArea(feature, mode);
        if (area) onArea(area);
      }
      draw.clear();
      draw.setMode("static");
      onDone();
    };
    draw.on("finish", onFinish);
    return () => {
      draw.off("finish", onFinish);
    };
  }, [mode, onArea, onDone]);

  return null;
}
