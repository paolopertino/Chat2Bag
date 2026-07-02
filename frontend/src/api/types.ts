export type BagStatus = "idle" | "indexing" | "done" | "error";

export interface BagInfo {
  bag_path: string;
  bag_name: string;
  is_indexed: boolean;
  status: BagStatus;
  error_message?: string | null;
  is_located?: boolean;
  located_frame_count?: number;
}

export interface ScanBagsResponse {
  root_dir: string;
  bags: BagInfo[];
}

export interface BagStatusResponse {
  bag_path: string;
  status: BagStatus;
  error_message?: string | null;
  is_located?: boolean;
  located_frame_count?: number;
}

export interface BagInfoResponse {
  bag_path: string;
  frame_count: number;
  first_timestamp_ns: number | null;
  last_timestamp_ns: number | null;
}

export interface SearchResult {
  bag_path: string;
  timestamp_ns: number;
  file_path: string;
  topic: string;
  similarity_score?: number;   // absent for Map browse rows
  source_bag: string;
  lat?: number;
  lon?: number;
  distance_m?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface Point {
  x: number;
  y: number;
}

export interface LatLon { lat: number; lon: number; }
export type Area =
  | { kind: "circle"; center: LatLon; radius_m: number }
  | { kind: "polygon"; vertices: LatLon[] };

export interface TrackPoint { lat: number; lon: number; timestamp_ns: number; }
export interface TrackResponse { bag_path: string; points: TrackPoint[]; }

export interface FleetTrack {
  bag_path: string;
  bag_name: string;
  points: TrackPoint[];
}
export interface FleetTracksResponse {
  tracks: FleetTrack[];
}

export interface HeatmapResponse {
  height: number;
  width: number;
  grid: number[][];
}

export interface FrameInfo {
  timestamp_ns: number;
  file_path: string;
}

export interface FramesResponse {
  bag_path: string;
  frames: FrameInfo[];
}

export interface SampleFrameInfo {
  timestamp_ns: number;
  topic: string;
  file_path: string;
  delta_ns: number;
  is_focus?: boolean;
}

export interface SampleInfo {
  timestamp_ns: number;
  anchor_frame: SampleFrameInfo | null;
  frames_by_camera: Record<string, SampleFrameInfo>;
}

export interface SamplesResponse {
  bag_path: string;
  cameras: string[];
  anchor_camera: string | null;
  sample_tolerance_ns: number;
  samples: SampleInfo[];
}

// ---- Dataset extraction types ----

export type ExtractionJobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface ExtractionJob {
  job_id: string;
  bag_path: string;
  mode: "window" | "full";
  timestamp_ns: number | null;
  window_length_s: number | null;
  output_folder: string;
  status: ExtractionJobStatus;
  pid: number | null;
  started_at: string | null;
  ended_at: string | null;
  error_message: string | null;
}

export interface ExtractionConfigSchema {
  enabled: boolean;
  editable_fields: string[];
  defaults: Record<string, unknown>;
  fixed_overrides_preview: Record<string, unknown>;
}

export interface ExtractionTopic {
  name: string;
  topic_path: string;
  modality: string;
  group: string;
  is_sync_leader: boolean;
  file_extension: string;
  field_names?: string[];
  [key: string]: unknown;
}

export interface ExtractionSubmitRequest {
  bag_path: string;
  mode: "window" | "full";
  timestamp_ns?: number;
  window_length_s?: number;
  user_config: Record<string, unknown>;
  output_folder?: string;
}

export interface ExtractionSubmitResponse {
  job_id: string;
}

export interface ExtractionLogsResponse {
  lines: string[];
}
