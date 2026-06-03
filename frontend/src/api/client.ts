import type {
  ChatResponse,
  BagInfoResponse,
  BagStatusResponse,
  ExtractionConfigSchema,
  ExtractionJob,
  ExtractionLogsResponse,
  ExtractionSubmitRequest,
  ExtractionSubmitResponse,
  FramesResponse,
  HeatmapResponse,
  Point,
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

// ---- Auth integration (token injection + 401 refresh) ----

let _accessToken: string | null = null;
let _authFailureHandler: (() => void) | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setClientToken(token: string | null): void {
  _accessToken = token;
}

export function setAuthFailureHandler(handler: (() => void) | null): void {
  _authFailureHandler = handler;
}

interface RefreshResponse {
  access_token: string;
  username: string;
  token_type: string;
}

async function doRefresh(): Promise<string | null> {
  const response = await fetch("/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as RefreshResponse;
  _accessToken = body.access_token;
  return body.access_token;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

export { refreshAccessToken };

// ---- http() wrapper ----

async function rawFetch(url: string, init: RequestInit | undefined): Promise<Response> {
  const isFormData = init?.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers ?? {}),
  };
  if (_accessToken) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${_accessToken}`;
  }
  return fetch(url, { ...init, headers, credentials: "include" });
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  let response = await rawFetch(url, init);

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await rawFetch(url, init);
    }
    if (response.status === 401) {
      if (_authFailureHandler) _authFailureHandler();
      throw new Error("Unauthorized");
    }
  }

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

// ---- Auth endpoints ----

interface LoginResponse {
  access_token: string;
  username: string;
  token_type: string;
}

export async function loginRequest(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    let detail = "Login failed";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      detail = response.statusText || "Login failed";
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as LoginResponse;
  _accessToken = body.access_token;
  return body;
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    _accessToken = null;
  }
}

// ---- Existing API (unchanged signatures) ----

export async function fetchImageAsObjectUrl(filePath: string): Promise<string> {
  const url = `/api/image?path=${encodeURIComponent(filePath)}`;
  let response = await rawFetch(url, undefined);

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await rawFetch(url, undefined);
    }
    if (response.status === 401) {
      if (_authFailureHandler) _authFailureHandler();
      throw new Error("Unauthorized");
    }
  }

  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }

  return URL.createObjectURL(await response.blob());
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

export async function getBagInfo(bagPath: string): Promise<BagInfoResponse> {
  return http<BagInfoResponse>(`/api/bags/info?bag_path=${encodeURIComponent(bagPath)}`);
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

export async function searchByImage(
  file: File,
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("top_k", String(topK));
  for (const bagPath of bagPaths) formData.append("bag_paths", bagPath);
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

export async function getExtractionSchema(): Promise<ExtractionConfigSchema> {
  return http<ExtractionConfigSchema>("/api/datasets/config/schema");
}

export async function submitExtraction(
  payload: ExtractionSubmitRequest,
): Promise<ExtractionSubmitResponse> {
  return http<ExtractionSubmitResponse>("/api/datasets/extract", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listExtractionJobs(): Promise<ExtractionJob[]> {
  return http<ExtractionJob[]>("/api/datasets/jobs");
}

export async function getExtractionJob(jobId: string): Promise<ExtractionJob> {
  return http<ExtractionJob>(`/api/datasets/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelExtractionJob(jobId: string): Promise<ExtractionJob> {
  return http<ExtractionJob>(`/api/datasets/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

export async function getExtractionLogs(jobId: string, tail = 500): Promise<string[]> {
  const resp = await http<ExtractionLogsResponse>(
    `/api/datasets/jobs/${encodeURIComponent(jobId)}/logs?tail=${tail}`,
  );
  return resp.lines;
}

// ---- Region search ----

export async function regionSearchByText(
  text: string,
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/region/by-text", {
    method: "POST",
    body: JSON.stringify({ text, bag_paths: bagPaths, top_k: topK }),
  });
}

export async function regionSearchByFrame(
  supportFilePath: string,
  points: Point[],
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/region/by-frame", {
    method: "POST",
    body: JSON.stringify({
      support_file_path: supportFilePath,
      points,
      bag_paths: bagPaths,
      top_k: topK,
    }),
  });
}

export async function regionSearchByImage(
  file: File,
  points: Point[],
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("points", JSON.stringify(points));
  formData.append("top_k", String(topK));
  for (const bagPath of bagPaths) formData.append("bag_paths", bagPath);
  return http<SearchResponse>("/api/search/region/by-image", {
    method: "POST",
    body: formData,
  });
}

export async function regionHeatmapByText(
  text: string,
  targetFilePath: string,
): Promise<HeatmapResponse> {
  return http<HeatmapResponse>("/api/search/region/heatmap", {
    method: "POST",
    body: JSON.stringify({ text, target_file_path: targetFilePath }),
  });
}

export async function regionHeatmapByFrame(
  supportFilePath: string,
  points: Point[],
  targetFilePath: string,
): Promise<HeatmapResponse> {
  return http<HeatmapResponse>("/api/search/region/heatmap/by-frame", {
    method: "POST",
    body: JSON.stringify({
      support_file_path: supportFilePath,
      points,
      target_file_path: targetFilePath,
    }),
  });
}

export async function regionHeatmapByImage(
  file: File,
  points: Point[],
  targetFilePath: string,
): Promise<HeatmapResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("points", JSON.stringify(points));
  formData.append("target_file_path", targetFilePath);
  return http<HeatmapResponse>("/api/search/region/heatmap/by-image", {
    method: "POST",
    body: formData,
  });
}
