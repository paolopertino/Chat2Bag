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
