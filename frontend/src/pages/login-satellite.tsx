import { useEffect } from "react";

import { useMap, whenStyleReady } from "../components/map/maplibre-map";
import { SATELLITE_LAYER_ID } from "../lib/basemap";

/**
 * Forces the satellite basemap visible on the login backdrop, ignoring the
 * saved basemap preference. Renders nothing; must be a child of <MapLibreMap>.
 */
export function LoginSatellite() {
  const map = useMap();

  useEffect(() => {
    whenStyleReady(map, () => {
      map.setLayoutProperty(SATELLITE_LAYER_ID, "visibility", "visible");
    });
  }, [map]);

  return null;
}
