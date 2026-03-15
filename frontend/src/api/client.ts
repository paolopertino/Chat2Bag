import type {
  BagStatusResponse,
  ScanBagsResponse,
  SearchResponse,
} from "./types";

interface SearchRequest {
  query: string;
  bag_paths: string[];
  top_k: number;
}

interface IndexRequest {
  bag_path: string;
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
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

export async function search(payload: SearchRequest): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
