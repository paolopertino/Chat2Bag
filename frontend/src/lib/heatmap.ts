/** Map a value in [0,1] to an [r,g,b] blue→cyan→yellow→red ramp. */
export function colormap(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const r = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 3))));
  const g = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 2))));
  const b = Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * x - 1))));
  return [r, g, b];
}

/** Min-max normalize a cosine grid (values may be slightly negative) to [0,1]. */
export function normalizeGrid(grid: number[][]): number[][] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const span = max - min || 1;
  return grid.map((row) => row.map((v) => (v - min) / span));
}

/**
 * Render a (height x width) cosine grid into an RGBA ImageData at patch
 * resolution. Alpha encodes intensity so cool regions stay transparent.
 */
export function gridToImageData(grid: number[][], width: number, height: number): ImageData {
  const norm = normalizeGrid(grid);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = norm[y]?.[x] ?? 0;
      const [r, g, b] = colormap(t);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(255 * t);
    }
  }
  return new ImageData(data, width, height);
}
