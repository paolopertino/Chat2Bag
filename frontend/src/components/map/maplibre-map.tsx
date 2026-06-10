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

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const MapContext = createContext<maplibregl.Map | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useMap(): maplibregl.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error("useMap must be used inside <MapLibreMap>");
  return map;
}

/** Run fn once the style is loaded (immediately if it already is). */
// eslint-disable-next-line react-refresh/only-export-components
export function whenStyleReady(map: maplibregl.Map, fn: () => void): void {
  if (map.isStyleLoaded()) fn();
  else map.once("style.load", fn);
}

export function MapLibreMap({ children }: { children?: ReactNode }) {
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
    });
    m.once("style.load", () => m.setProjection({ type: "globe" }));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    setMap(m);
    return () => {
      setMap(null);
      m.remove();
    };
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </>
  );
}
