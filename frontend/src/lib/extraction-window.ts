export interface NsWindow {
  startNs: number;
  endNs: number;
}

export const DEFAULT_WINDOW_S = 10;

const NS_PER_S = 1e9;
const NS_PER_MS = 1e6;

export function clampNs(ns: number, firstNs: number, lastNs: number): number {
  if (ns < firstNs) return firstNs;
  if (ns > lastNs) return lastNs;
  return ns;
}

export function windowLengthS(w: NsWindow): number {
  return Math.max(0, (w.endNs - w.startNs) / NS_PER_S);
}

export function clampWindow(w: NsWindow, firstNs: number, lastNs: number): NsWindow {
  const startNs = clampNs(w.startNs, firstNs, lastNs);
  const endNs = clampNs(Math.max(w.endNs, startNs), firstNs, lastNs);
  return { startNs, endNs };
}

// Returns a new endNs keeping startNs fixed, clamped so end stays within the bag and >= start.
export function withLengthS(startNs: number, lengthS: number, lastNs: number): number {
  const end = startNs + Math.max(0, lengthS) * NS_PER_S;
  return Math.min(Math.max(end, startNs), lastNs);
}

// Nanoseconds to "mm:ss.mmm", relative to the bag start.
export function formatWindowTime(ns: number, firstNs: number): string {
  const totalMs = Math.max(0, Math.round((ns - firstNs) / NS_PER_MS));
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

// Parses "mm:ss.mmm", "mm:ss", "ss.mmm", or plain seconds. Returns absolute ns, or null if invalid.
export function parseWindowTime(text: string, firstNs: number): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const m = trimmed.match(/^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  const millis = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
  const offsetMs = (minutes * 60 + seconds) * 1000 + millis;
  return firstNs + offsetMs * NS_PER_MS;
}
