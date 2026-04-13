import type {
  CandidateOption,
  CandidatesResponse,
  ConstituenciesResponse,
  ConstituencyResult,
  ConstituencySummary,
  PartySummaryResponse,
  ResultsDetailsResponse,
  SourceDiagnosticsResponse,
  ResultsSummaryResponse
} from "@kerala-election/shared";
import { TtlCache } from "../cache.js";
import { config, resolveEciUrl } from "../config.js";
import { logger } from "../logger.js";
import { fallbackKeralaConstituencies, normalizeComparable } from "../keralaConstituencies.js";
import { fetchHtml } from "./http.js";
import {
  parseConstituencyPage,
  parsePaginationUrls,
  parsePartySummaryPage,
  parseStatePage,
  toConstituencyOptions
} from "./parser.js";
import { buildCandidateDetailUrl, getSourceConfig, resolveConfiguredUrl } from "../sourceConfigStore.js";

const cache = new TtlCache<unknown>(config.CACHE_TTL_SECONDS * 1000);
const backgroundRefreshes = new Map<string, Promise<unknown>>();
const foregroundRefreshes = new Map<string, Promise<unknown>>();
let candidateIndex:
  | {
      sourceKey: string;
      response: CandidatesResponse;
    }
  | undefined;
let candidateIndexPromise: Promise<CandidatesResponse> | undefined;

async function getKeralaStatePageUrl(): Promise<string | undefined> {
  const cacheKey = "kerala-state-page-url";
  const cached = cache.get(cacheKey) as string | undefined;
  if (cached) return cached;

  const sourceConfig = await getSourceConfig();
  if (sourceConfig.constituencyListUrl) {
    const url = resolveConfiguredUrl(sourceConfig, sourceConfig.constituencyListUrl);
    cache.set(cacheKey, url);
    return url;
  }

  if (config.ECI_KERALA_STATE_PAGE) {
    const url = resolveEciUrl(config.ECI_KERALA_STATE_PAGE);
    cache.set(cacheKey, url);
    return url;
  }

  return undefined;
}

async function getStateSummaries(): Promise<{ sourceUrl?: string; summaries: ConstituencySummary[]; error?: string }> {
  const cacheKey = "state-summaries";
  const cached = cache.get(cacheKey) as { sourceUrl?: string; summaries: ConstituencySummary[]; error?: string } | undefined;
  if (cached) return cached;
  const stale = cache.getStale(cacheKey) as { sourceUrl?: string; summaries: ConstituencySummary[]; error?: string } | undefined;
  if (stale?.summaries.length) {
    refreshInBackground(cacheKey, () => refreshStateSummaries(cacheKey));
    return stale;
  }

  return refreshOnce(cacheKey, () => refreshStateSummaries(cacheKey));
}

async function refreshStateSummaries(cacheKey: string): Promise<{ sourceUrl?: string; summaries: ConstituencySummary[]; error?: string }> {
  try {
    const sourceUrl = await getKeralaStatePageUrl();
    if (!sourceUrl) {
      const value = fallbackState("ECI Kerala statewise result page is not configured or not discoverable yet.");
      cache.set(cacheKey, value);
      return value;
    }

    const sourceConfig = await getSourceConfig();
    const summaries = await loadAllStatePageSummaries(sourceUrl, sourceConfig);
    const value = { sourceUrl, summaries };
    cache.set(cacheKey, value);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ECI source error";
    logger.error({ error }, "Failed to load Kerala state summaries from ECI");
    const value = fallbackState(message);
    cache.set(cacheKey, value);
    return value;
  }
}

async function loadAllStatePageSummaries(sourceUrl: string, sourceConfig: Awaited<ReturnType<typeof getSourceConfig>>): Promise<ConstituencySummary[]> {
  const firstHtml = await fetchHtml(sourceUrl);
  const pageUrls = new Set([sourceUrl, ...parsePaginationUrls(firstHtml, sourceUrl)]);
  const allSummaries: ConstituencySummary[] = [];

  for (const pageUrl of pageUrls) {
    const html = pageUrl === sourceUrl ? firstHtml : await fetchHtml(pageUrl);
    allSummaries.push(...parseStatePage(html, pageUrl, config.defaultFavoriteIds, false));
  }

  const byNumber = new Map<string, ConstituencySummary>();
  for (const summary of allSummaries) {
    const key = String(Number(summary.constituencyNumber) || summary.constituencyNumber);
    if (!key || byNumber.has(key)) continue;
    const detailTemplate = resolveConfiguredUrl(sourceConfig, sourceConfig.candidateDetailUrlTemplate);
    byNumber.set(key, {
      ...summary,
      sourceUrl: buildCandidateDetailUrl(detailTemplate, {
        constituencyNumber: summary.constituencyNumber,
        constituencyId: summary.constituencyId
      })
    });
  }

  return byNumber.size ? [...byNumber.values()] : parseStatePage(firstHtml, sourceUrl, config.defaultFavoriteIds);
}

export async function getConstituencies(): Promise<ConstituenciesResponse> {
  const { sourceUrl, summaries, error } = await getStateSummaries();
  return {
    generatedAt: new Date().toISOString(),
    sourceConfigured: Boolean(sourceUrl),
    sourceUrl,
    constituencies: toConstituencyOptions(summaries, config.defaultFavoriteIds, !sourceUrl),
    warning: sourceUrl ? undefined : `Selection is available, but live results are pending. ${error}`
  };
}

export async function getCandidateIndex(): Promise<CandidatesResponse> {
  const sourceConfig = await getSourceConfig();
  const sourceKey = `${sourceConfig.updatedAt}|${sourceConfig.constituencyListUrl}|${sourceConfig.candidateDetailUrlTemplate}`;
  if (candidateIndex?.sourceKey === sourceKey) return candidateIndex.response;
  if (candidateIndexPromise) return candidateIndexPromise;

  candidateIndexPromise = buildCandidateIndex(sourceKey).finally(() => {
    candidateIndexPromise = undefined;
  });

  return candidateIndexPromise;
}

async function buildCandidateIndex(sourceKey: string): Promise<CandidatesResponse> {
  const { sourceUrl, summaries, error } = await getStateSummaries();
  if (!sourceUrl) {
    return {
      generatedAt: new Date().toISOString(),
      sourceConfigured: false,
      sourceUrl,
      candidates: [],
      errors: [{ message: error ?? "Live ECI source is not configured yet.", code: "SOURCE_NOT_CONFIGURED" }]
    };
  }

  const candidates: CandidateOption[] = [];
  const errors: { constituencyId?: string; message: string; code?: string }[] = [];

  for (const summary of summaries.filter((item) => item.sourceUrl)) {
    try {
      const result = await getConstituencyResult(summary.constituencyId);
      for (const candidate of result.candidates) {
        candidates.push({
          candidateId: `${summary.constituencyId}:${candidate.serialNo}:${normalizeComparable(candidate.candidateName)}`,
          candidateName: candidate.candidateName,
          party: candidate.party,
          photoUrl: candidate.photoUrl,
          constituencyId: summary.constituencyId,
          constituencyName: summary.constituencyName,
          constituencyNumber: summary.constituencyNumber
        });
      }
    } catch (candidateError) {
      errors.push({
        constituencyId: summary.constituencyId,
        message: candidateError instanceof Error ? candidateError.message : "Failed to load candidate list.",
        code: "CANDIDATE_INDEX_PARTIAL"
      });
    }
  }

  const response = {
    generatedAt: new Date().toISOString(),
    sourceConfigured: true,
    sourceUrl,
    candidates,
    errors
  };
  candidateIndex = { sourceKey, response };
  logger.info({ candidates: candidates.length, errors: errors.length }, "Candidate index built");
  return response;
}

export async function getSummary(ids: string[]): Promise<ResultsSummaryResponse> {
  const { sourceUrl, summaries, error } = await getStateSummaries();
  const requested = filterRequested(summaries, ids);
  return {
    generatedAt: new Date().toISOString(),
    sourceConfigured: Boolean(sourceUrl),
    sourceUrl,
    results: requested,
    errors: sourceUrl
      ? []
      : [{ message: error ?? "Live ECI source is not configured yet.", code: "SOURCE_NOT_CONFIGURED" }]
  };
}

export async function getConstituencyResult(constituencyId: string): Promise<ConstituencyResult> {
  const cacheKey = `result:${constituencyId}`;
  const cached = cache.get(cacheKey) as ConstituencyResult | undefined;
  if (cached) return cached;
  const stale = cache.getStale(cacheKey) as ConstituencyResult | undefined;
  if (stale) {
    refreshInBackground(cacheKey, () => refreshConstituencyResult(constituencyId, cacheKey));
    return stale;
  }

  return refreshOnce(cacheKey, () => refreshConstituencyResult(constituencyId, cacheKey));
}

export async function getConstituencyResults(ids: string[]): Promise<ResultsDetailsResponse> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const results: ConstituencyResult[] = [];
  const errors: { constituencyId?: string; message: string; code?: string }[] = [];

  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        results.push(await getConstituencyResult(id));
      } catch (error) {
        errors.push({
          constituencyId: id,
          message: error instanceof Error ? error.message : "Failed to load constituency detail.",
          code: typeof error === "object" && error && "code" in error ? String(error.code) : "RESULT_DETAIL_FAILED"
        });
      }
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceConfigured: true,
    results: sortByRequestedOrder(results, uniqueIds),
    errors
  };
}

async function refreshConstituencyResult(constituencyId: string, cacheKey: string): Promise<ConstituencyResult> {
  const { sourceUrl, summaries } = await getStateSummaries();
  if (!sourceUrl) {
    throw Object.assign(new Error("Live ECI source is not configured yet."), { statusCode: 503, code: "SOURCE_NOT_CONFIGURED" });
  }

  const summary = filterRequested(summaries, [constituencyId])[0];
  if (!summary?.sourceUrl) {
    throw Object.assign(new Error(`No ECI detail page found for constituency ${constituencyId}.`), {
      statusCode: 404,
      code: "CONSTITUENCY_NOT_FOUND"
    });
  }

  try {
    const html = await fetchHtml(summary.sourceUrl);
    const result = parseConstituencyPage(html, summary.sourceUrl, summary);
    if (!result.candidates.length) {
      throw Object.assign(new Error(`No candidate rows parsed for constituency ${constituencyId}.`), {
        statusCode: 502,
        code: "ECI_UNEXPECTED_HTML"
      });
    }
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    logger.error({ error, constituencyId, sourceUrl: summary.sourceUrl }, "Failed to parse constituency detail page");
    throw error;
  }
}

export async function getPartySummary(): Promise<PartySummaryResponse> {
  const cacheKey = "party-summary";
  const cached = cache.get(cacheKey) as PartySummaryResponse | undefined;
  if (cached) return cached;
  const stale = cache.getStale(cacheKey) as PartySummaryResponse | undefined;
  if (stale) {
    refreshInBackground(cacheKey, () => refreshPartySummary(cacheKey));
    return stale;
  }

  return refreshOnce(cacheKey, () => refreshPartySummary(cacheKey));
}

async function refreshPartySummary(cacheKey: string): Promise<PartySummaryResponse> {
  const sourceConfig = await getSourceConfig();
  const listUrl = resolveConfiguredUrl(sourceConfig, sourceConfig.constituencyListUrl);
  const indexUrl = new URL("index.htm", listUrl).toString();
  try {
    const html = await fetchHtml(indexUrl);
    const parties = parsePartySummaryPage(html);
    if (!parties.length) {
      throw Object.assign(new Error("No party summary rows parsed from ECI index page."), {
        statusCode: 502,
        code: "ECI_UNEXPECTED_HTML"
      });
    }
    const value = {
      generatedAt: new Date().toISOString(),
      sourceUrl: indexUrl,
      parties
    };
    cache.set(cacheKey, value);
    return value;
  } catch (error) {
    logger.error({ error, sourceUrl: indexUrl }, "Failed to parse party summary page");
    throw error;
  }
}

export function clearElectionCache(): void {
  cache.clear();
  backgroundRefreshes.clear();
  foregroundRefreshes.clear();
  candidateIndex = undefined;
  candidateIndexPromise = undefined;
}

export async function getSourceDiagnostics(): Promise<SourceDiagnosticsResponse> {
  const errors: SourceDiagnosticsResponse["errors"] = [];
  const { sourceUrl, summaries, error } = await getStateSummaries();
  if (error) errors.push({ message: error, code: "STATE_SUMMARY_WARNING" });

  let sampleDetailCount = 0;
  let sampleCandidateCount = 0;
  for (const summary of summaries.filter((item) => item.sourceUrl).slice(0, 3)) {
    try {
      const result = await getConstituencyResult(summary.constituencyId);
      sampleDetailCount += 1;
      sampleCandidateCount += result.candidates.length;
    } catch (detailError) {
      errors.push({
        constituencyId: summary.constituencyId,
        message: detailError instanceof Error ? detailError.message : "Sample detail check failed.",
        code: "DETAIL_SAMPLE_FAILED"
      });
    }
  }

  let partySummaryCount = 0;
  try {
    partySummaryCount = (await getPartySummary()).parties.length;
  } catch (partyError) {
    errors.push({
      message: partyError instanceof Error ? partyError.message : "Party summary check failed.",
      code: "PARTY_SUMMARY_FAILED"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceConfigured: Boolean(sourceUrl),
    uptimeSeconds: Math.round(process.uptime()),
    cacheTtlSeconds: config.CACHE_TTL_SECONDS,
    sourceUrl,
    constituencyCount: sourceUrl ? summaries.length : 0,
    sampleDetailCount,
    sampleCandidateCount,
    partySummaryCount,
    errors
  };
}

function refreshInBackground<T>(key: string, task: () => Promise<T>): void {
  if (backgroundRefreshes.has(key)) return;
  const promise = task()
    .catch((error) => {
      logger.warn({ error, key }, "Background ECI refresh failed; keeping stale data");
    })
    .finally(() => {
      backgroundRefreshes.delete(key);
    });
  backgroundRefreshes.set(key, promise);
}

function refreshOnce<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = foregroundRefreshes.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = task().finally(() => {
    foregroundRefreshes.delete(key);
  });
  foregroundRefreshes.set(key, promise);
  return promise;
}

function sortByRequestedOrder(results: ConstituencyResult[], ids: string[]): ConstituencyResult[] {
  const order = new Map(ids.map((id, index) => [normalizeComparable(id), index]));
  return [...results].sort((a, b) => (order.get(normalizeComparable(a.constituencyId)) ?? 0) - (order.get(normalizeComparable(b.constituencyId)) ?? 0));
}

function filterRequested(summaries: ConstituencySummary[], ids: string[]): ConstituencySummary[] {
  if (!ids.length) return [];
  const requested = new Set(ids.map(normalizeComparable));
  return summaries.filter(
    (summary) =>
      requested.has(normalizeComparable(summary.constituencyId)) ||
      requested.has(normalizeComparable(summary.constituencyName)) ||
      requested.has(normalizeComparable(summary.constituencyNumber))
  );
}

function fallbackState(error: string): { summaries: ConstituencySummary[]; error: string } {
  return {
    error,
    summaries: fallbackKeralaConstituencies.map((item) => ({
      constituencyId: item.constituencyId,
      constituencyName: item.constituencyName,
      constituencyNumber: item.constituencyNumber,
      statusText: "",
      roundStatus: "",
      leadingCandidate: "",
      leadingParty: "",
      trailingCandidate: "",
      trailingParty: "",
      margin: 0
    }))
  };
}
