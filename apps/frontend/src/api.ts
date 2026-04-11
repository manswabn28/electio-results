import type {
  CandidatesResponse,
  ConstituenciesResponse,
  ConstituencyResult,
  PartySummaryResponse,
  PublicSourceConfig,
  ResultEnvelope,
  ResultsSummaryResponse,
  TrafficResponse
} from "@kerala-election/shared";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const productionApiBaseUrl =
  typeof window !== "undefined" && ["kerala-election.onrender.com", "results.onekeralam.in"].includes(window.location.hostname)
    ? "https://api-election-results.onrender.com"
    : "";
const apiBaseUrl = (configuredApiBaseUrl || productionApiBaseUrl).replace(/\/+$/, "");

function apiUrl(path: string): string {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) }
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed with ${response.status}`);
  }
  return body as T;
}

export function fetchConstituencies() {
  return request<ConstituenciesResponse>(apiUrl("/api/constituencies"));
}

export function fetchCandidates() {
  return request<CandidatesResponse>(apiUrl("/api/candidates"));
}

export function fetchSummary(ids: string[]) {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return request<ResultsSummaryResponse>(apiUrl(`/api/results/summary?${params}`));
}

export async function fetchResult(id: string): Promise<ConstituencyResult> {
  const envelope = await request<ResultEnvelope<ConstituencyResult>>(apiUrl(`/api/results/${encodeURIComponent(id)}`));
  return envelope.data;
}

export function fetchSourceConfig() {
  return request<PublicSourceConfig>(apiUrl("/api/source-config"));
}

export function fetchPartySummary() {
  return request<PartySummaryResponse>(apiUrl("/api/party-summary"));
}

export function sendTrafficHeartbeat(viewerId: string) {
  return request<TrafficResponse>(apiUrl("/api/traffic/heartbeat"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewerId })
  });
}

export function apiBaseForDiagnostics() {
  return apiBaseUrl || "same-origin";
}

export function updateSourceConfig(
  password: string,
  payload: Pick<PublicSourceConfig, "baseUrl" | "constituencyListUrl" | "candidateDetailUrlTemplate" | "refreshIntervalSeconds">
) {
  return request<PublicSourceConfig>(apiUrl("/api/admin/source-config"), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${password}`
    },
    body: JSON.stringify(payload)
  });
}
