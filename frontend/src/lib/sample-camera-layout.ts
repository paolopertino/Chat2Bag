// v1 types — kept only for migrateV1; not exported
interface CameraSlot {
  row: number;
  col: number;
}

interface CameraLayout {
  version: 1;
  cameras: string[];
  slots: Record<string, CameraSlot>;
}

export interface GridDimensions {
  rows: number;
  cols: number;
}

export function cameraLayoutStorageKey(cameras: string[]): string {
  const stable = [...cameras].sort().map((camera) => encodeURIComponent(camera)).join("|");
  return `sample-camera-layout:${stable}`;
}

export function defaultGridDimensions(count: number): GridDimensions {
  if (count <= 1) return { rows: 1, cols: 1 };
  if (count === 2) return { rows: 1, cols: 2 };
  if (count === 3) return { rows: 1, cols: 3 };
  if (count === 4) return { rows: 2, cols: 2 };
  if (count <= 6) return { rows: 2, cols: 3 };
  return { rows: Math.ceil(count / 3), cols: 3 };
}

// ---- v2: fine snap-grid layout (react-grid-layout based) ----

export const GRID_COLS = 12;
export const TILE_DEFAULT_H = 4; // grid rows per tile

export interface CameraTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraLayoutV2 {
  version: 2;
  cameras: string[];
  tiles: Record<string, CameraTile>;
}

// KEY_PREFIX matches the prefix used by cameraLayoutStorageKey
const KEY_PREFIX = "sample-camera-layout:";

export function defaultLayoutV2(cameras: string[]): CameraLayoutV2 {
  const { cols } = defaultGridDimensions(cameras.length);
  const w = Math.max(1, Math.floor(GRID_COLS / cols));
  // Square cells: with the viewer's rowHeight = colWidth / imageAspect, a w === h
  // tile renders at the frame's aspect ratio, so the default layout has no
  // letterbox bars regardless of camera count.
  const h = w;
  const tiles: Record<string, CameraTile> = {};
  cameras.forEach((camera, i) => {
    tiles[camera] = {
      x: (i % cols) * w,
      y: Math.floor(i / cols) * h,
      w,
      h,
    };
  });
  return { version: 2, cameras: [...cameras].sort(), tiles };
}

function v1Cols(v1: CameraLayout): number {
  const slots = Object.values(v1.slots);
  if (slots.length === 0) return 1;
  return Math.max(...slots.map((s) => s.col)) + 1;
}

function migrateV1(v1: CameraLayout): CameraLayoutV2 {
  const cols = v1Cols(v1);
  const w = Math.max(1, Math.floor(GRID_COLS / cols));
  const tiles: Record<string, CameraTile> = {};
  for (const [camera, slot] of Object.entries(v1.slots)) {
    tiles[camera] = { x: slot.col * w, y: slot.row * TILE_DEFAULT_H, w, h: TILE_DEFAULT_H };
  }
  return { version: 2, cameras: [...v1.cameras].sort(), tiles };
}

function parseStored(raw: string | null): CameraLayoutV2 | CameraLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number };
    if (parsed.version === 2) return parsed as CameraLayoutV2;
    if (parsed.version === 1) return parsed as CameraLayout;
  } catch {
    /* corrupt entry */
  }
  return null;
}

function maxOccupiedY(layout: CameraLayoutV2): number {
  return Object.values(layout.tiles).reduce((m, t) => Math.max(m, t.y + t.h), 0);
}

export function seedFromBestOverlap(cameras: string[]): CameraLayoutV2 | null {
  let best: { layout: CameraLayoutV2; overlap: number } | null = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    const stored = parseStored(localStorage.getItem(key));
    if (!stored) continue;
    const v2 = stored.version === 2 ? stored : migrateV1(stored as CameraLayout);
    const overlap = v2.cameras.filter((c) => cameras.includes(c)).length;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { layout: v2, overlap };
  }
  if (!best) return null;
  const seeded: CameraLayoutV2 = { version: 2, cameras: [...cameras].sort(), tiles: {} };
  for (const camera of cameras) {
    if (best.layout.tiles[camera]) seeded.tiles[camera] = { ...best.layout.tiles[camera] };
  }
  let nextY = maxOccupiedY(seeded);
  let nextX = 0;
  for (const camera of cameras) {
    if (seeded.tiles[camera]) continue;
    const w = 3;
    if (nextX + w > GRID_COLS) {
      nextX = 0;
      nextY += TILE_DEFAULT_H;
    }
    seeded.tiles[camera] = { x: nextX, y: nextY, w, h: TILE_DEFAULT_H };
    nextX += w;
  }
  return seeded;
}

export function readCameraLayoutV2(cameras: string[]): CameraLayoutV2 {
  const stored = parseStored(localStorage.getItem(cameraLayoutStorageKey(cameras)));
  if (stored) return stored.version === 2 ? stored : migrateV1(stored as CameraLayout);
  return seedFromBestOverlap(cameras) ?? defaultLayoutV2(cameras);
}

export function saveCameraLayoutV2(layout: CameraLayoutV2): void {
  localStorage.setItem(cameraLayoutStorageKey(layout.cameras), JSON.stringify(layout));
}
