import type {
  CandidatesResponse,
  ConstituenciesResponse,
  ConstituencyResult,
  DiscoveredSource,
  ResultsDetailsResponse,
  PartySummaryResponse,
  PublicSourceConfig,
  ResultEnvelope,
  SourceDiagnosticsResponse,
  ResultsSummaryResponse,
  TrafficResponse
} from "@kerala-election/shared";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const productionApiBaseUrl =
  typeof window !== "undefined" && ["kerala-election.onrender.com", "results.onekeralam.in", "results.onekeralam.com"].includes(window.location.hostname)
    ? "https://api-election-results.onrender.com"
    : "";
const apiBaseUrl = (configuredApiBaseUrl || productionApiBaseUrl).replace(/\/+$/, "");

function apiUrl(path: string): string {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function withProfile(path: string, profileId?: string): string {
  if (!profileId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}profile=${encodeURIComponent(profileId)}`;
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

export function fetchConstituencies(profileId?: string) {
  return request<ConstituenciesResponse>(apiUrl(withProfile("/api/constituencies", profileId)));
}

export function fetchCandidates(profileId?: string) {
  return request<CandidatesResponse>(apiUrl(withProfile("/api/candidates", profileId)));
}

export function fetchSummary(ids: string[], profileId?: string) {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return request<ResultsSummaryResponse>(apiUrl(withProfile(`/api/results/summary?${params}`, profileId)));
}

export async function fetchResult(id: string, profileId?: string): Promise<ConstituencyResult> {
  const envelope = await request<ResultEnvelope<ConstituencyResult>>(apiUrl(withProfile(`/api/results/${encodeURIComponent(id)}`, profileId)));
  return envelope.data;
}

export function fetchResults(ids: string[], profileId?: string) {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return request<ResultsDetailsResponse>(apiUrl(withProfile(`/api/results/details?${params}`, profileId)));
}

export function fetchSourceConfig() {
  return request<PublicSourceConfig>(apiUrl("/api/source-config"));
}

export function fetchPartySummary(profileId?: string) {
  return request<PartySummaryResponse>(apiUrl(withProfile("/api/party-summary", profileId)));
}

export function updateActiveSourceProfile(profileId: string) {
  return request<PublicSourceConfig>(apiUrl("/api/source-config/active-profile"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId })
  });
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

export function revertSourceConfig(password: string) {
  return request<PublicSourceConfig>(apiUrl("/api/admin/source-config/revert"), {
    method: "POST",
    headers: { authorization: `Bearer ${password}` }
  });
}

export function fetchDiscoveryStatus(password: string) {
  return request<DiscoveredSource>(apiUrl("/api/admin/source-discovery/status"), {
    headers: { authorization: `Bearer ${password}` }
  });
}

export function fetchSourceDiagnostics(password: string, profileId?: string) {
  return request<SourceDiagnosticsResponse>(apiUrl(withProfile("/api/admin/source-diagnostics", profileId)), {
    headers: { authorization: `Bearer ${password}` }
  });
}

export function runSourceDiscovery(password: string) {
  return request<DiscoveredSource>(apiUrl("/api/admin/source-discovery/run"), {
    method: "POST",
    headers: { authorization: `Bearer ${password}` }
  });
}

export function applyDiscoveredSource(password: string) {
  return request<DiscoveredSource>(apiUrl("/api/admin/source-discovery/apply"), {
    method: "POST",
    headers: { authorization: `Bearer ${password}` }
  });
}

export function updateDiscoverySchedule(password: string, enabled: boolean) {
  return request<DiscoveredSource>(apiUrl("/api/admin/source-discovery/schedule"), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${password}`
    },
    body: JSON.stringify({ enabled })
  });
}
