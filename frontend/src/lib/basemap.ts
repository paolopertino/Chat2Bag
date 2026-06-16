export type Basemap = "streets" | "satellite";

export const SATELLITE_SOURCE_ID = "satellite-imagery";
export const SATELLITE_LAYER_ID = "satellite-imagery";

// Esri World Imagery: key-free XYZ raster endpoint; attribution is required.
export const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION =
  "&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const STORAGE_KEY = "bag-gpt.basemap";

export function readBasemapPref(): Basemap {
  return localStorage.getItem(STORAGE_KEY) === "satellite" ? "satellite" : "streets";
}

export function saveBasemapPref(basemap: Basemap): void {
  localStorage.setItem(STORAGE_KEY, basemap);
}
