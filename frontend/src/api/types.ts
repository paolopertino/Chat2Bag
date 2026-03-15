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
