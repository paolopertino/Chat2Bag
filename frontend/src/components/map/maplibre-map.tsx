import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  readBasemapPref,
  SATELLITE_ATTRIBUTION,
  SATELLITE_LAYER_ID,
  SATELLITE_SOURCE_ID,
  SATELLITE_TILE_URL,
} from "../../lib/basemap";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const MapContext = createContext<maplibregl.Map | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useMap(): maplibregl.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error("useMap must be used inside <MapLibreMap>");
  return map;
}

// Maps whose one-shot "style.load" event has already fired. `isStyleLoaded()`
// can report false AFTER style.load (e.g. while globe tiles stream in), so it
// is unsafe to use as the "already loaded" gate: a late caller would register
// `once("style.load")` for an event that will never fire again, and its work
// (typically a source.setData) would be lost forever. We instead remember that
// the style finished loading so late callers run immediately.
const styleLoaded = new WeakSet<maplibregl.Map>();

/** Run fn once the style has loaded (immediately if it already has). */
// eslint-disable-next-line react-refresh/only-export-components
export function whenStyleReady(map: maplibregl.Map, fn: () => void): void {
  if (styleLoaded.has(map)) {
    fn();
    return;
  }
  if (map.isStyleLoaded()) {
    styleLoaded.add(map);
    fn();
    return;
  }
  map.once("style.load", () => {
    styleLoaded.add(map);
    fn();
  });
}

export function MapLibreMap({
  children,
  interactive = true,
}: {
  children?: ReactNode;
  interactive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [9.19, 45.46], // northern Italy; fitBounds overrides once Tracks load
      zoom: 5,
      attributionControl: { compact: true },
      interactive,
    });
    m.once("style.load", () => {
      m.setProjection({ type: "globe" });
      // The satellite raster must be inserted before the style's first symbol
      // layer (so place labels stay readable on top of imagery) and before any
      // whenStyleReady callback runs (so tracks/pins/areas land above it).
      // This handler was registered first, so both orderings hold.
      const firstSymbolId = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
      m.addSource(SATELLITE_SOURCE_ID, {
        type: "raster",
        tiles: [SATELLITE_TILE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: SATELLITE_ATTRIBUTION,
      });
      m.addLayer(
        {
          id: SATELLITE_LAYER_ID,
          type: "raster",
          source: SATELLITE_SOURCE_ID,
          layout: {
            visibility: readBasemapPref() === "satellite" ? "visible" : "none",
          },
        },
        firstSymbolId,
      );
    });
    if (interactive) {
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    }
    setMap(m);
    return () => {
      setMap(null);
      m.remove();
    };
  }, [interactive]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </>
  );
}
