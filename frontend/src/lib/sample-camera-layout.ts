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
