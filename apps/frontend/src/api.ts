import type {
  ChatMessage,
  ChatMessagesResponse,
  CandidatesResponse,
  ConstituencyDetailCandidate,
  ConstituencyDetailResponse,
  ConstituencyElectionHistory,
  ConstituencyElectionHistoryEntry,
  ConstituencyHistoryResponse,
  ConstituencyTimelineBatchResponse,
  ConstituencyTimelineResponse,
  ConstituenciesResponse,
  ElectionTimelineEvent,
  ConstituencyResult,
  DiscoveredSource,
  ProfileTimelineResponse,
  ResultsDetailsResponse,
  PartySummaryResponse,
  PublicSourceConfig,
  ResultEnvelope,
  SourceDiagnosticsResponse,
  ResultsSummaryResponse,
  TelegramAlertRules,
  TelegramSubscriptionLinkResponse,
  TelegramSubscriptionStatusResponse,
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

export async function fetchConstituencyHistory(ids: string[], profileId?: string): Promise<ConstituencyElectionHistory[]> {
  if (!ids.length) return [];
  const params = new URLSearchParams({ ids: ids.join(",") });
  const response = await request<ConstituencyHistoryResponse>(apiUrl(withProfile(`/api/constituency-history?${params}`, profileId)));
  return response.histories;
}

export function fetchConstituencyDetail(stateSlug: string, constituencySlug: string, profileId?: string) {
  return request<ConstituencyDetailResponse>(
    apiUrl(withProfile(`/api/elections/${encodeURIComponent(stateSlug)}/constituencies/${encodeURIComponent(constituencySlug)}`, profileId))
  ).catch(async (error) => {
    const message = error instanceof Error ? error.message : "";
    if (!/Route not found|404|Request failed with 404/i.test(message)) {
      throw error;
    }
    return buildFallbackConstituencyDetail(stateSlug, constituencySlug, profileId);
  });
}

export async function fetchConstituencyTimelines(ids: string[], profileId?: string): Promise<Record<string, ElectionTimelineEvent[]>> {
  if (!ids.length) return {};
  const params = new URLSearchParams({ ids: ids.join(",") });
  const response = await request<ConstituencyTimelineBatchResponse>(apiUrl(withProfile(`/api/timeline/constituencies?${params}`, profileId)));
  return response.timelines;
}

export async function fetchConstituencyTimeline(id: string, profileId?: string): Promise<ElectionTimelineEvent[]> {
  const response = await request<ConstituencyTimelineResponse>(apiUrl(withProfile(`/api/timeline/constituency/${encodeURIComponent(id)}`, profileId)));
  return response.timeline;
}

export async function fetchProfileTimeline(profileId?: string): Promise<ElectionTimelineEvent[]> {
  const response = await request<ProfileTimelineResponse>(apiUrl(withProfile("/api/timeline/profile", profileId)));
  return response.timeline;
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

export function shareImageProxyUrl(url: string) {
  return apiUrl(`/api/share-image?url=${encodeURIComponent(url)}`);
}

export function fetchTelegramSubscriptionStatus(viewerId: string, profileId?: string) {
  return request<TelegramSubscriptionStatusResponse>(apiUrl(withProfile(`/api/telegram/status?viewerId=${encodeURIComponent(viewerId)}`, profileId)));
}

export function createTelegramSubscriptionLink(payload: {
  viewerId: string;
  profileId: string;
  selectedIds: string[];
  watchedCandidateIds?: string[];
  rules?: Partial<TelegramAlertRules>;
}) {
  return request<TelegramSubscriptionLinkResponse>(apiUrl("/api/telegram/subscribe-link"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
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

export function fetchChatMessages(limit = 120, profileId?: string) {
  return request<ChatMessagesResponse>(apiUrl(withProfile(`/api/chat/messages?limit=${encodeURIComponent(String(limit))}`, profileId)));
}

export async function postChatMessage(payload: { profileId?: string; viewerId: string; displayName?: string; message: string; adminPassword?: string }) {
  const { adminPassword, ...body } = payload;
  const envelope = await request<ResultEnvelope<ChatMessage>>(apiUrl("/api/chat/messages"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(adminPassword ? { authorization: `Bearer ${adminPassword}` } : {})
    },
    body: JSON.stringify(body)
  });
  return envelope.data;
}

export async function deleteChatMessage(password: string, messageId: string, profileId?: string) {
  const envelope = await request<ResultEnvelope<ChatMessage>>(apiUrl(withProfile(`/api/admin/chat/messages/${encodeURIComponent(messageId)}`, profileId)), {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${password}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ profileId })
  });
  return envelope.data;
}

export function apiBaseForDiagnostics() {
  return apiBaseUrl || "same-origin";
}

export function chatStreamUrl(profileId?: string) {
  return apiUrl(withProfile("/api/chat/stream", profileId));
}

export function updateSourceConfig(
  password: string,
  payload: Pick<PublicSourceConfig, "baseUrl" | "constituencyListUrl" | "candidateDetailUrlTemplate" | "refreshIntervalSeconds" | "hidePreviewBanner" | "hideCountdown">
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

async function buildFallbackConstituencyDetail(stateSlug: string, constituencySlug: string, profileId?: string): Promise<ConstituencyDetailResponse> {
  const constituencies = await fetchConstituencies(profileId);
  const constituency = constituencies.constituencies.find((seat) => slugify(seat.constituencyName) === constituencySlug);
  if (!constituency) {
    throw new Error("Constituency not found for the requested route.");
  }
  const [result, histories, sourceConfig] = await Promise.all([
    fetchResult(constituency.constituencyId, profileId),
    fetchConstituencyHistory([constituency.constituencyId], profileId),
    fetchSourceConfig()
  ]);
  const history = histories[0];
  const rounds = parseRoundProgress(result.roundStatus || result.statusText);
  const declared = isDeclaredWinner(result.statusText || result.roundStatus);
  const electionTitle = sourceConfig.profiles?.find((profile) => profile.profileId === (profileId || sourceConfig.activeProfileId))?.electionTitle
    ?? sourceConfig.activeTitle
    ?? "Assembly Election";
  const stateName = sourceConfig.profiles?.find((profile) => profile.profileId === (profileId || sourceConfig.activeProfileId))?.stateName
    ?? deslugify(stateSlug);
  const candidates = mapCandidates(result, declared);
  return {
    generatedAt: new Date().toISOString(),
    profileId,
    election: {
      id: profileId || sourceConfig.activeProfileId || stateSlug,
      name: electionTitle,
      year: extractYear(electionTitle),
      stateName,
      stateSlug,
      status: declared ? "final" : "live",
      lastUpdated: result.lastUpdated
    },
    constituency: {
      id: constituency.constituencyId,
      name: constituency.constituencyName,
      slug: constituencySlug,
      district: undefined,
      assemblyNumber: constituency.constituencyNumber,
      totalRounds: rounds?.total,
      roundsCounted: rounds?.current,
      status: declared ? "final" : "live"
    },
    result: {
      leadingCandidateId: candidates[0]?.id,
      runnerUpCandidateId: candidates[1]?.id,
      winnerCandidateId: declared ? candidates[0]?.id : undefined,
      margin: result.margin,
      marginStatus: marginStatusLabel(result.margin, declared),
      declared,
      leadChangedRecently: !declared && result.margin <= 1000,
      previousLeaderCandidateId: !declared && candidates[1] ? candidates[1].id : undefined,
      totalVotes: result.totalVotes,
      statusText: result.statusText || result.roundStatus,
      sourceUrl: result.sourceUrl
    },
    candidates,
    history: history?.entries ?? [],
    timeline: buildFallbackTimeline(result, candidates, history?.entries ?? [], declared),
    insights: {
      seatType: result.margin <= 500 ? "Ultra-close finish" : result.margin <= 5000 ? "Competitive seat" : "Clear mandate",
      historicalLean: deriveHistoricalLean(history?.entries ?? []),
      closestPastMargin: history?.entries?.length ? Math.min(...history.entries.map((entry) => entry.margin)) : undefined,
      biggestPastMargin: history?.entries?.length ? Math.max(...history.entries.map((entry) => entry.margin)) : undefined,
      previousWinnerParty: history?.entries?.[0]?.party,
      previousWinnerName: history?.entries?.[0]?.winnerName,
      volatilityScore: result.margin <= 500 ? "high" : result.margin <= 5000 ? "medium" : "low",
      turnout: history?.entries?.[0]?.turnoutPercent,
      totalCandidates: candidates.length,
      leadStability: !declared && result.margin <= 1000 ? "swinging" : "stable"
    }
  };
}

function mapCandidates(result: ConstituencyResult, declared: boolean): ConstituencyDetailCandidate[] {
  return result.candidates.map((candidate, index) => {
    const party = splitPartyIdentity(candidate.party);
    return {
      id: `${candidate.serialNo}-${slugify(candidate.candidateName)}`,
      name: candidate.candidateName,
      partyCode: party.partyCode,
      partyName: party.partyName,
      votes: candidate.totalVotes,
      voteShare: candidate.votePercent,
      rank: index + 1,
      photoUrl: candidate.photoUrl,
      status: index === 0
        ? declared ? "won" : "leading"
        : index === 1
          ? declared ? "runner-up" : "trailing"
          : declared ? "lost" : "trailing",
      marginFromLeader: index === 0 ? 0 : Math.max(0, (result.candidates[0]?.totalVotes ?? 0) - candidate.totalVotes)
    };
  });
}

function buildFallbackTimeline(
  result: ConstituencyResult,
  candidates: ConstituencyDetailCandidate[],
  history: ConstituencyElectionHistoryEntry[],
  declared: boolean
): ConstituencyDetailResponse["timeline"] {
  const time = result.lastUpdated || new Date().toISOString();
  const rounds = parseRoundProgress(result.roundStatus || result.statusText);
  const timeline: ConstituencyDetailResponse["timeline"] = [
    {
      id: "counting-started",
      time,
      type: "counting-started",
      title: "Counting started",
      description: `Counting updates started for ${result.constituencyName}.`
    },
    {
      id: "first-trend",
      time,
      type: "update",
      title: "First trend available",
      description: `${candidates[0]?.name ?? result.leadingCandidate} appeared first in front.`
    }
  ];
  if (rounds) {
    timeline.push({
      id: "round-progress",
      time,
      type: "milestone",
      title: "Counting progress",
      description: `${rounds.current}/${rounds.total} rounds counted.`
    });
  }
  if (result.margin <= 1000) {
    timeline.push({
      id: "tight-race",
      time,
      type: "tight-race",
      title: "Tight race alert",
      description: `Margin narrowed to ${formatNumber(result.margin)} votes.`
    });
  }
  if (declared && candidates[0]) {
    timeline.push({
      id: "winner",
      time,
      type: "winner",
      title: `Winner declared: ${candidates[0].partyCode}`,
      description: `${candidates[0].name} won by ${formatNumber(result.margin)} votes.`
    });
  } else if (history[0]) {
    timeline.push({
      id: "history-context",
      time,
      type: "update",
      title: "Historical context",
      description: `${history[0].year}: ${history[0].party} won here by ${formatNumber(history[0].margin)} votes.`
    });
  }
  return timeline;
}

function parseRoundProgress(value: string) {
  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  return { current, total };
}

function isDeclaredWinner(value: string) {
  return /\b(won|result\s+declared|declared)\b/i.test(value);
}

function splitPartyIdentity(value: string): { partyCode: string; partyName: string } {
  const raw = String(value || "").trim();
  if (!raw) return { partyCode: "-", partyName: "-" };
  const parts = raw.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (last.length <= 8 && /[A-Z()]/.test(last)) {
      return { partyCode: last.replace(/[^\w()]/g, ""), partyName: first };
    }
  }
  const acronym = raw
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return { partyCode: acronym || raw.toUpperCase().slice(0, 8), partyName: raw };
}

function marginStatusLabel(margin: number, declared: boolean) {
  if (declared) return "Winner declared";
  if (margin <= 500) return "Too close to call";
  if (margin <= 1000) return "Alert lead";
  if (margin <= 5000) return "Tight lead";
  return "Clear lead";
}

function deriveHistoricalLean(entries: ConstituencyElectionHistoryEntry[]): string | undefined {
  if (!entries.length) return undefined;
  const winners = new Map<string, number>();
  for (const entry of entries) {
    winners.set(entry.party, (winners.get(entry.party) ?? 0) + 1);
  }
  const sorted = [...winners.entries()].sort((left, right) => right[1] - left[1]);
  if (!sorted.length) return undefined;
  if (sorted[0][1] >= 2) return `${sorted[0][0]} leaning`;
  if (sorted.length > 1) return "Swing seat";
  return "Competitive seat";
}

function extractYear(value: string): number | undefined {
  const match = value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function deslugify(value: string) {
  return value.split("-").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}
