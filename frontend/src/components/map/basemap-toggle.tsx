import { Map as MapIcon, Satellite } from "lucide-react";
import type { IControl } from "maplibre-gl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  readBasemapPref,
  saveBasemapPref,
  SATELLITE_LAYER_ID,
  type Basemap,
} from "../../lib/basemap";
import { useMap, whenStyleReady } from "./maplibre-map";

/**
 * Street/satellite basemap switch. Registered as a native MapLibre control in
 * the bottom-right corner so it stacks with the zoom and attribution controls
 * instead of being absolutely positioned over them (the corner stack's height
 * varies with the attribution's expanded/compact state, so any fixed pixel
 * offset eventually overlaps).
 */
export function BasemapToggle() {
  const map = useMap();
  const [container] = useState<HTMLDivElement>(() => {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    return div;
  });
  const [basemap, setBasemap] = useState<Basemap>(readBasemapPref);

  useEffect(() => {
    const control: IControl = {
      onAdd: () => container,
      onRemove: () => container.remove(),
    };
    map.addControl(control, "bottom-right");
    return () => {
      try {
        map.removeControl(control);
      } catch {
        /* map already removed during route teardown */
      }
    };
  }, [map, container]);

  const next: Basemap = basemap === "satellite" ? "streets" : "satellite";
  const toggle = () => {
    setBasemap(next);
    saveBasemapPref(next);
    whenStyleReady(map, () => {
      map.setLayoutProperty(
        SATELLITE_LAYER_ID,
        "visibility",
        next === "satellite" ? "visible" : "none",
      );
    });
  };

  return createPortal(
    <button
      type="button"
      onClick={toggle}
      title={next === "satellite" ? "Switch to satellite view" : "Switch to street map"}
      aria-label={next === "satellite" ? "Switch to satellite view" : "Switch to street map"}
    >
      {/* maplibre's `.maplibregl-ctrl-group button` forces display:block with
          higher specificity than Tailwind utilities, so centering must live on
          an inner wrapper it doesn't style. */}
      <span className="flex h-full w-full items-center justify-center">
        {basemap === "satellite" ? (
          <MapIcon className="h-4 w-4" />
        ) : (
          <Satellite className="h-4 w-4" />
        )}
      </span>
    </button>,
    container,
  );
}
