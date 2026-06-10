import type { Area, TrackPoint } from "../api/types";

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLmb = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLmb / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pointInPolygon(lat: number, lon: number, verts: { lat: number; lon: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const yi = verts[i].lat, xi = verts[i].lon, yj = verts[j].lat, xj = verts[j].lon;
    if ((yi > lat) !== (yj > lat)) {
      const xCross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xCross) inside = !inside;
    }
  }
  return inside;
}

export function areaContains(area: Area, lat: number, lon: number): boolean {
  if (area.kind === "circle") {
    return haversine(area.center.lat, area.center.lon, lat, lon) <= area.radius_m;
  }
  return pointInPolygon(lat, lon, area.vertices);
}

export function countInArea(area: Area, tracks: TrackPoint[][]): number {
  let n = 0;
  for (const track of tracks) for (const p of track) if (areaContains(area, p.lat, p.lon)) n++;
  return n;
}
