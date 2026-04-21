export type BagStatus = "idle" | "indexing" | "done" | "error";

export interface BagInfo {
  bag_path: string;
  bag_name: string;
  is_indexed: boolean;
  status: BagStatus;
}

export interface ScanBagsResponse {
  root_dir: string;
  bags: BagInfo[];
}

export interface BagStatusResponse {
  bag_path: string;
  status: BagStatus;
}

export interface SearchResult {
  bag_path: string;
  timestamp_ns: number;
  file_path: string;
  topic: string;
  similarity_score: number;
  source_bag: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface FrameInfo {
  timestamp_ns: number;
  file_path: string;
}

export interface FramesResponse {
  bag_path: string;
  frames: FrameInfo[];
}

export interface ChatResponse {
  response: string;
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
