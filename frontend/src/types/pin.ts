export interface Pin {
  timestamp_ns: number;
  source: string;
  score?: number;
  label?: string;
  color?: string;
}

export interface PinProvider {
  source: string;
  getPins(bagPath: string): Pin[] | Promise<Pin[]>;
}
