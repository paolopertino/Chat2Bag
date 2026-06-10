import type { Area } from "../api/types";

// circle:LAT,LON,RADIUS   |   poly:LAT,LON;LAT,LON;...
export function encodeArea(area: Area): string {
  if (area.kind === "circle") {
    return `circle:${area.center.lat},${area.center.lon},${area.radius_m}`;
  }
  return "poly:" + area.vertices.map((v) => `${v.lat},${v.lon}`).join(";");
}

export function decodeArea(raw: string | null): Area | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("circle:")) {
      const [lat, lon, r] = raw.slice(7).split(",").map(Number);
      if ([lat, lon, r].some((n) => !Number.isFinite(n)) || r <= 0) return null;
      return { kind: "circle", center: { lat, lon }, radius_m: r };
    }
    if (raw.startsWith("poly:")) {
      const vertices = raw.slice(5).split(";").map((pair) => {
        const [lat, lon] = pair.split(",").map(Number);
        return { lat, lon };
      });
      if (vertices.length < 3 || vertices.some((v) => !Number.isFinite(v.lat) || !Number.isFinite(v.lon)))
        return null;
      return { kind: "polygon", vertices };
    }
  } catch {
    return null;
  }
  return null;
}
