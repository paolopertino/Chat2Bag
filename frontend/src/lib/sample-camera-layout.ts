export interface CameraSlot {
  row: number;
  col: number;
}

export interface CameraLayout {
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

export function defaultCameraLayout(cameras: string[]): CameraLayout {
  const { cols } = defaultGridDimensions(cameras.length);
  const slots: Record<string, CameraSlot> = {};
  cameras.forEach((camera, index) => {
    slots[camera] = { row: Math.floor(index / cols), col: index % cols };
  });
  return { version: 1, cameras: [...cameras], slots };
}

export function layoutDimensions(layout: CameraLayout): GridDimensions {
  const slots = Object.values(layout.slots);
  if (slots.length === 0) return { rows: 1, cols: 1 };
  return {
    rows: Math.max(...slots.map((slot) => slot.row)) + 1,
    cols: Math.max(...slots.map((slot) => slot.col)) + 1,
  };
}

export function layoutMatches(layout: CameraLayout, cameras: string[]): boolean {
  const expected = [...cameras].sort();
  const actual = [...layout.cameras].sort();
  if (expected.length !== actual.length) return false;
  return expected.every((camera, index) => camera === actual[index])
    && expected.every((camera) => layout.slots[camera] !== undefined);
}

export function readCameraLayout(cameras: string[]): CameraLayout {
  if (typeof window === "undefined") return defaultCameraLayout(cameras);
  const raw = window.localStorage.getItem(cameraLayoutStorageKey(cameras));
  if (!raw) return defaultCameraLayout(cameras);
  try {
    const parsed = JSON.parse(raw) as CameraLayout;
    if (parsed.version === 1 && layoutMatches(parsed, cameras)) return parsed;
  } catch {
    return defaultCameraLayout(cameras);
  }
  return defaultCameraLayout(cameras);
}

export function saveCameraLayout(layout: CameraLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(cameraLayoutStorageKey(layout.cameras), JSON.stringify(layout));
}

export function clearCameraLayout(cameras: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(cameraLayoutStorageKey(cameras));
}

export function swapCameraSlots(
  layout: CameraLayout,
  camera: string,
  direction: "up" | "down" | "left" | "right",
): CameraLayout {
  const current = layout.slots[camera];
  if (!current) return layout;
  const delta = {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 },
  }[direction];
  const next = { row: current.row + delta.row, col: current.col + delta.col };
  const { rows, cols } = layoutDimensions(layout);
  if (next.row < 0 || next.col < 0 || next.row >= rows || next.col >= cols) return layout;
  const other = layout.cameras.find((name) => {
    const slot = layout.slots[name];
    return slot.row === next.row && slot.col === next.col;
  });
  const slots = { ...layout.slots, [camera]: next };
  if (other) slots[other] = current;
  return { ...layout, slots };
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
  const tiles: Record<string, CameraTile> = {};
  cameras.forEach((camera, i) => {
    tiles[camera] = {
      x: (i % cols) * w,
      y: Math.floor(i / cols) * TILE_DEFAULT_H,
      w,
      h: TILE_DEFAULT_H,
    };
  });
  return { version: 2, cameras: [...cameras].sort(), tiles };
}

function migrateV1(v1: CameraLayout): CameraLayoutV2 {
  const { cols } = layoutDimensions(v1);
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
