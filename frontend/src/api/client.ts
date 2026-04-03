import type {
  ChatResponse,
  BagStatusResponse,
  FramesResponse,
  ScanBagsResponse,
  SearchResponse,
} from "./types";

interface SearchRequest {
  query: string;
  bag_paths: string[];
  top_k: number;
}

interface SimilarSearchRequest {
  file_path: string;
  bag_paths: string[];
  top_k: number;
}

interface IndexRequest {
  bag_path: string;
}

interface ChatRequest {
  bag_path: string;
  start_ns: number;
  duration: number;
  query: string;
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(url, {
    headers: isFormData
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
    ...init,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function getImageUrl(filePath: string): string {
  return `/api/image?path=${encodeURIComponent(filePath)}`;
}

export async function scanBags(rootDir: string): Promise<ScanBagsResponse> {
  return http<ScanBagsResponse>(`/api/bags/scan?root_dir=${encodeURIComponent(rootDir)}`);
}

export async function indexBag(bagPath: string): Promise<void> {
  await http<{ status: string; bag: string }>("/api/index", {
    method: "POST",
    body: JSON.stringify({ bag_path: bagPath } satisfies IndexRequest),
  });
}

export async function getBagStatus(bagPath: string): Promise<BagStatusResponse> {
  return http<BagStatusResponse>(`/api/bags/status?bag_path=${encodeURIComponent(bagPath)}`);
}

export async function getFrames(
  bagPath: string,
  startNs: number,
  durationSec: number,
): Promise<FramesResponse> {
  const params = new URLSearchParams({
    bag_path: bagPath,
    start_ns: String(startNs),
    duration_sec: String(durationSec),
  });
  return http<FramesResponse>(`/api/bags/frames?${params.toString()}`);
}

export async function search(payload: SearchRequest): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchByImage(file: File, bagPaths: string[], topK: number): Promise<SearchResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("top_k", String(topK));
  for (const bagPath of bagPaths) {
    formData.append("bag_paths", bagPath);
  }

  return http<SearchResponse>("/api/search/image", {
    method: "POST",
    body: formData,
  });
}

export async function searchSimilar(payload: SimilarSearchRequest): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/similar", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function chatWithClip(payload: ChatRequest): Promise<ChatResponse> {
  return http<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
