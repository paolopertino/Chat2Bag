import { useEffect } from "react";
import { useMap } from "react-leaflet";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

import type { Area } from "../../api/types";

interface AreaLayerProps {
  area: Area | null;
  onChange: (area: Area) => void;
}

export function AreaLayer({ onChange }: AreaLayerProps) {
  const map = useMap();

  useEffect(() => {
    map.pm.addControls({
      position: "topleft",
      drawCircle: true,
      drawPolygon: true,
      drawMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawText: false,
      cutPolygon: false,
    });

    const handleCreate = (e: { layer: L.Layer; shape: string }) => {
      // keep only the latest shape (single Area for v1)
      map.pm.getGeomanLayers().forEach((l) => { if (l !== e.layer) map.removeLayer(l); });
      if (e.shape === "Circle") {
        const c = e.layer as L.Circle;
        const ll = c.getLatLng();
        onChange({ kind: "circle", center: { lat: ll.lat, lon: ll.lng }, radius_m: c.getRadius() });
      } else if (e.shape === "Polygon") {
        const latlngs = (e.layer as L.Polygon).getLatLngs()[0] as L.LatLng[];
        onChange({ kind: "polygon", vertices: latlngs.map((p) => ({ lat: p.lat, lon: p.lng })) });
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on("pm:create", handleCreate as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off("pm:create", handleCreate as any);
      map.pm.removeControls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: rendering an existing `area` back onto the map (edit case) is a follow-up
  // refinement — the dialog opens fresh-draw for v1; persisted area is shown via the chip.
  return null;
}
