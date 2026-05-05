import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { ConstituencyElectionHistory, ConstituencyElectionHistoryEntry, ElectionSourceProfile } from "@kerala-election/shared";
import { TtlCache } from "./cache.js";
import { logger } from "./logger.js";
import { getConstituencies } from "./eci/service.js";
import { fetchHtml } from "./eci/http.js";
import { parseConstituencyPage, parsePaginationUrls, parseStatePage } from "./eci/parser.js";
import { getSourceConfig } from "./sourceConfigStore.js";
import { normalizeComparable } from "./keralaConstituencies.js";

type ParsedHistoryRow = {
  constituencyName: string;
  constituencyNumber?: string;
  entry: ConstituencyElectionHistoryEntry;
};

type StoredHistoryYear = {
  sourceType: "official-eci" | "wikipedia-fallback";
  sourceUrl: string;
  importedAt: string;
  rows: ParsedHistoryRow[];
};

type HistoryArchiveStore = {
  version: 1;
  states: Record<string, Record<string, StoredHistoryYear>>;
};

type OfficialHistorySource = {
  statewiseUrl: string;
};

type OfficialHistoryCatalogStore = {
  version: 1;
  sources: Record<string, Record<string, OfficialHistorySource>>;
};

const HISTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_PREWARM_INTERVAL_MS = 6 * 60 * 60 * 1000;
const HISTORY_REQUEST_TIMEOUT_MS = 20_000;
const HISTORY_REQUEST_SPACING_MS = 500;
const HISTORY_IMPORT_RETRY_COUNT = 3;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const historyDataDir = path.resolve(moduleDir, "..", "data");
const historyArchivePath = path.join(historyDataDir, "constituency-history-archive.json");
const officialHistoryCatalogPath = path.join(historyDataDir, "official-history-sources.json");
const OFFICIAL_HISTORY_CATALOG: Record<string, Record<number, OfficialHistorySource>> = {
  kerala: {
    2021: {
      statewiseUrl: "https://results.eci.gov.in/Result2021/statewiseS114.htm"
    }
  },
  "tamil-nadu": {
    2021: {
      statewiseUrl: "https://results.eci.gov.in/Result2021/statewiseS221.htm"
    }
  },
  "west-bengal": {
    2021: {
      statewiseUrl: "https://results.eci.gov.in/Result2021/statewiseS251.htm"
    }
  },
  assam: {
    2021: {
      statewiseUrl: "https://results.eci.gov.in/Result2021/statewiseS031.htm"
    }
  },
  puducherry: {
    2021: {
      statewiseUrl: "https://results.eci.gov.in/Result2021/statewiseU051.htm"
    }
  }
};

const historyCache = new TtlCache<ConstituencyElectionHistory[]>(HISTORY_CACHE_TTL_MS);
const historyRefreshes = new Map<string, Promise<ConstituencyElectionHistory[]>>();
let officialHistoryCatalogPromise: Promise<Record<string, Record<number, OfficialHistorySource>>> | undefined;
let prewarmTimer: NodeJS.Timeout | undefined;
let lastHistoryRequestAt = 0;

export type HistoryImportSummary = {
  profileId: string;
  stateName: string;
  constituencyCount: number;
  yearsRequested: number[];
  importedYearCount: number;
  historyCount: number;
};

export async function getConstituencyHistories(
  constituencyIds: string[],
  profileId?: string
): Promise<ConstituencyElectionHistory[]> {
  if (!constituencyIds.length) return [];
  const profile = await resolveHistoryProfile(profileId);
  if (!profile) return [];
  const cacheKey = `history:${profile.profileId}`;
  const cached = historyCache.get(cacheKey);
  if (cached?.length) {
    return filterRequestedHistories(cached, constituencyIds);
  }
  const stale = historyCache.getStale(cacheKey);
  if (stale?.length) {
    refreshHistoryInBackground(cacheKey, profile);
    return filterRequestedHistories(stale, constituencyIds);
  }
  const loaded = await refreshHistory(cacheKey, profile);
  return filterRequestedHistories(loaded, constituencyIds);
}

export function startHistoryPrewarming(): void {
  if (prewarmTimer) return;
  void prewarmHistoryCaches();
  prewarmTimer = setInterval(() => {
    void prewarmHistoryCaches();
  }, HISTORY_PREWARM_INTERVAL_MS);
}

export async function importAllEnabledHistoryArchives(): Promise<HistoryImportSummary[]> {
  const sourceConfig = await getSourceConfig().catch(() => undefined);
  const profiles = resolveHistoryProfiles(sourceConfig);
  const summaries: HistoryImportSummary[] = [];
  for (const profile of profiles) {
    summaries.push(await importHistoryArchiveForResolvedProfile(profile));
  }
  return summaries;
}

export async function importHistoryArchiveForProfile(profileId: string): Promise<HistoryImportSummary> {
  const sourceConfig = await getSourceConfig();
  const profile = sourceConfig.profiles?.find((item) => item.enabled && item.profileId === profileId);
  if (!profile) {
    throw new Error(`History import profile not found: ${profileId}`);
  }
  return importHistoryArchiveForResolvedProfile(profile);
}

async function prewarmHistoryCaches(): Promise<void> {
  const sourceConfig = await getSourceConfig().catch(() => undefined);
  const profiles = resolveHistoryProfiles(sourceConfig);
  for (const profile of profiles) {
    const cacheKey = `history:${profile.profileId}`;
    if (historyCache.isFresh(cacheKey)) continue;
    await refreshHistory(cacheKey, profile).catch((error) => {
      logger.warn({ error, profileId: profile.profileId }, "History prewarm failed");
    });
  }
}

async function refreshHistory(cacheKey: string, profile: ElectionSourceProfile): Promise<ConstituencyElectionHistory[]> {
  const running = historyRefreshes.get(cacheKey);
  if (running) return running;
  const promise = loadHistoryForProfile(profile)
    .then((histories) => {
      historyCache.set(cacheKey, histories);
      return histories;
    })
    .finally(() => {
      historyRefreshes.delete(cacheKey);
    });
  historyRefreshes.set(cacheKey, promise);
  return promise;
}

function refreshHistoryInBackground(cacheKey: string, profile: ElectionSourceProfile) {
  if (historyRefreshes.has(cacheKey)) return;
  void refreshHistory(cacheKey, profile).catch((error) => {
    logger.warn({ error, profileId: profile.profileId }, "Background history refresh failed");
  });
}

async function loadHistoryForProfile(
  profile: ElectionSourceProfile,
  options?: { forceImport?: boolean }
): Promise<ConstituencyElectionHistory[]> {
  const constituencies = (await getConstituencies(profile.profileId)).constituencies;
  if (!constituencies.length) return [];

  const years = deriveHistoryYears(profile);
  const archiveStateKey = normalizeArchiveStateKey(profile.stateName);
  const archiveStore = await loadHistoryArchiveStore();
  const forceImport = options?.forceImport ?? false;

  for (const year of years) {
    const existingYear = archiveStore.states[archiveStateKey]?.[String(year)];
    if (!forceImport && existingYear?.rows?.length) continue;
    const imported = await importHistoryYear(profile, year);
    if (!imported) {
      logger.warn({ profileId: profile.profileId, state: profile.stateName, year }, "No historical archive data imported for year");
      continue;
    }
    archiveStore.states[archiveStateKey] ??= {};
    const shouldReplace = !existingYear?.rows?.length || imported.rows.length >= existingYear.rows.length;
    if (shouldReplace) {
      archiveStore.states[archiveStateKey][String(year)] = imported;
    }
  }

  await saveHistoryArchiveStore(archiveStore);
  const parsedRows = years.flatMap((year) => archiveStore.states[archiveStateKey]?.[String(year)]?.rows ?? []);

  const byNumber = new Map<string, ParsedHistoryRow[]>();
  const byName = new Map<string, ParsedHistoryRow[]>();

  for (const row of parsedRows) {
    const nameKey = normalizeHistorySeatName(row.constituencyName);
    if (nameKey) {
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), row]);
    }
    const numberKey = normalizeConstituencyNumber(row.constituencyNumber);
    if (numberKey) {
      byNumber.set(numberKey, [...(byNumber.get(numberKey) ?? []), row]);
    }
  }

  return constituencies.map((seat) => {
    const matchedRows = dedupeHistoryRows([
      ...(byNumber.get(normalizeConstituencyNumber(seat.constituencyNumber)) ?? []),
      ...(byName.get(normalizeHistorySeatName(seat.constituencyName)) ?? [])
    ]);
    const entries = matchedRows
      .map((row) => row.entry)
      .sort((left, right) => right.year - left.year);

    return {
      constituencyId: seat.constituencyId,
      constituencyNumber: seat.constituencyNumber,
      constituencyName: seat.constituencyName,
      trendLabel: buildTrendLabel(entries),
      contextNote: buildContextNote(entries),
      notableLeaders: [...new Set(entries.map((entry) => entry.winnerName).filter(Boolean))].slice(0, 3),
      entries
    } satisfies ConstituencyElectionHistory;
  });
}

async function importHistoryArchiveForResolvedProfile(profile: ElectionSourceProfile): Promise<HistoryImportSummary> {
  const histories = await loadHistoryForProfile(profile, { forceImport: true });
  const yearsRequested = deriveHistoryYears(profile);
  const archiveStore = await loadHistoryArchiveStore();
  const archiveStateKey = normalizeArchiveStateKey(profile.stateName);
  const importedYearCount = yearsRequested.filter((year) => Boolean(archiveStore.states[archiveStateKey]?.[String(year)]?.rows?.length)).length;
  historyCache.set(`history:${profile.profileId}`, histories);
  return {
    profileId: profile.profileId,
    stateName: profile.stateName,
    constituencyCount: histories.length,
    yearsRequested,
    importedYearCount,
    historyCount: histories.reduce((sum, history) => sum + history.entries.length, 0)
  };
}

async function importHistoryYear(profile: ElectionSourceProfile, year: number): Promise<StoredHistoryYear | undefined> {
  const official = await importOfficialHistoryYear(profile, year).catch((error) => {
    logger.warn({ error, state: profile.stateName, year }, "Official ECI history import failed");
    return undefined;
  });
  if (official?.rows.length) return official;

  const fallback = await importWikipediaHistoryYear(profile, year).catch((error) => {
    logger.warn({ error, state: profile.stateName, year }, "Fallback history import failed");
    return undefined;
  });
  return fallback?.rows.length ? fallback : undefined;
}

async function importOfficialHistoryYear(profile: ElectionSourceProfile, year: number): Promise<StoredHistoryYear | undefined> {
  const officialSource = await resolveOfficialHistorySource(profile.stateName, year);
  if (!officialSource) return undefined;

  const firstHtml = await fetchHistoryHtml(officialSource.statewiseUrl);
  const pageUrls = new Set([officialSource.statewiseUrl, ...parsePaginationUrls(firstHtml, officialSource.statewiseUrl)]);
  const summaries = [];
  for (const pageUrl of pageUrls) {
    const html = pageUrl === officialSource.statewiseUrl ? firstHtml : await fetchHistoryHtml(pageUrl);
    summaries.push(...parseStatePage(html, pageUrl, [], false));
  }
  if (!summaries.length) return undefined;

  const rows: ParsedHistoryRow[] = [];
  for (const summary of summaries) {
    if (!summary.sourceUrl) continue;
    try {
      const detailHtml = await fetchHistoryHtml(summary.sourceUrl);
      const result = parseConstituencyPage(detailHtml, summary.sourceUrl, summary);
      const leader = result.candidates[0];
      const runner = result.candidates[1];
      if (!leader || !runner) continue;
      rows.push({
        constituencyName: result.constituencyName,
        constituencyNumber: result.constituencyNumber,
        entry: {
          year,
          winnerName: leader.candidateName,
          party: leader.party,
          votes: leader.totalVotes,
          voteSharePercent: leader.votePercent,
          runnerUpName: runner.candidateName,
          runnerUpParty: runner.party,
          runnerUpVotes: runner.totalVotes,
          margin: Math.max(0, leader.totalVotes - runner.totalVotes)
        }
      });
    } catch (error) {
      logger.warn({ error, state: profile.stateName, year, constituency: summary.constituencyName }, "Official constituency history import failed");
    }
  }

  if (!rows.length) return undefined;
  return {
    sourceType: "official-eci",
    sourceUrl: officialSource.statewiseUrl,
    importedAt: new Date().toISOString(),
    rows
  };
}

async function importWikipediaHistoryYear(profile: ElectionSourceProfile, year: number): Promise<StoredHistoryYear | undefined> {
  const url = wikipediaElectionUrl(profile.stateName, year);
  for (let attempt = 1; attempt <= HISTORY_IMPORT_RETRY_COUNT; attempt += 1) {
    const html = await fetchHistoryHtml(url);
    const rows = parseWikipediaElectionRows(html, year);
    if (rows.length) {
      return {
        sourceType: "wikipedia-fallback",
        sourceUrl: url,
        importedAt: new Date().toISOString(),
        rows
      };
    }
    if (attempt < HISTORY_IMPORT_RETRY_COUNT) {
      await delay(400 * attempt);
    }
  }
  const plainHtml = await fetchPlainHistoryHtml(url).catch(() => undefined);
  if (plainHtml) {
    const rows = parseWikipediaElectionRows(plainHtml, year);
    if (rows.length) {
      return {
        sourceType: "wikipedia-fallback",
        sourceUrl: url,
        importedAt: new Date().toISOString(),
        rows
      };
    }
  }
  return undefined;
}

async function resolveOfficialHistorySource(stateName: string, year: number): Promise<OfficialHistorySource | undefined> {
  officialHistoryCatalogPromise ??= loadOfficialHistoryCatalog();
  const catalog = await officialHistoryCatalogPromise;
  return catalog[normalizeArchiveStateKey(stateName)]?.[year];
}

async function loadHistoryArchiveStore(): Promise<HistoryArchiveStore> {
  try {
    const raw = await readFile(historyArchivePath, "utf8");
    const parsed = JSON.parse(raw) as HistoryArchiveStore;
    return parsed?.version === 1 && parsed.states ? parsed : { version: 1, states: {} };
  } catch {
    return { version: 1, states: {} };
  }
}

async function saveHistoryArchiveStore(store: HistoryArchiveStore): Promise<void> {
  await mkdir(historyDataDir, { recursive: true });
  await writeFile(historyArchivePath, JSON.stringify(store, null, 2), "utf8");
}

async function resolveHistoryProfile(profileId?: string): Promise<ElectionSourceProfile | undefined> {
  const sourceConfig = await getSourceConfig().catch(() => undefined);
  return sourceConfig?.profiles?.find((profile) => profile.enabled && profile.profileId === (profileId || sourceConfig.activeProfileId))
    ?? sourceConfig?.profiles?.find((profile) => profile.enabled && /kerala/i.test(profile.stateName))
    ?? sourceConfig?.profiles?.find((profile) => profile.enabled);
}

function resolveHistoryProfiles(sourceConfig?: Awaited<ReturnType<typeof getSourceConfig>>): ElectionSourceProfile[] {
  const enabled = (sourceConfig?.profiles ?? []).filter((profile) => profile.enabled);
  return enabled.length ? enabled : [];
}

function filterRequestedHistories(histories: ConstituencyElectionHistory[], constituencyIds: string[]) {
  const requested = new Set(constituencyIds);
  return histories.filter((history) => requested.has(history.constituencyId));
}

function deriveHistoryYears(profile: ElectionSourceProfile): number[] {
  const inferredCurrentYear = parseElectionYear(profile) ?? new Date().getFullYear();
  return Array.from({ length: Math.max(0, Math.floor((inferredCurrentYear - 1950) / 5)) }, (_, index) => inferredCurrentYear - (index + 1) * 5)
    .filter((year) => year >= 1950);
}

function parseElectionYear(profile: ElectionSourceProfile): number | undefined {
  const text = `${profile.electionTitle} ${profile.eventFolderUrl} ${profile.profileId}`;
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years.length ? Math.max(...years) : undefined;
}

function wikipediaElectionUrl(stateName: string, year: number): string {
  return `https://en.wikipedia.org/wiki/${year}_${wikipediaStateSlug(stateName)}_Legislative_Assembly_election`;
}

function wikipediaStateSlug(stateName: string): string {
  return stateName
    .trim()
    .replace(/&/g, "and")
    .replace(/[().]/g, "")
    .replace(/\s+/g, "_");
}

async function fetchHistoryHtml(url: string): Promise<string> {
  const waitMs = Math.max(0, HISTORY_REQUEST_SPACING_MS - (Date.now() - lastHistoryRequestAt));
  if (waitMs) await delay(waitMs);
  lastHistoryRequestAt = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HISTORY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      throw new Error(`History source request failed ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPlainHistoryHtml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Plain history source request failed ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function parseWikipediaElectionRows(html: string, year: number): ParsedHistoryRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedHistoryRow[] = [];

  $("table.wikitable").each((_, table) => {
    const tableText = cleanText($(table).text()).toLowerCase();
    const tableLooksRelevant =
      tableText.includes("constituency") &&
      tableText.includes("margin") &&
      (
        tableText.includes("party") ||
        tableText.includes("runner-up") ||
        tableText.includes("runner up")
      );
    if (!tableLooksRelevant) return;
    $(table)
      .find("tr")
      .each((__, row) => {
        const cells = $(row)
          .children("th,td")
          .toArray()
          .map((cell) => cleanText($(cell).text()));

        const parsed = parseWikipediaResultRow(cells, year);
        if (parsed) rows.push(parsed);
      });
  });

  return rows;
}

function parseWikipediaResultRow(cells: string[], year: number): ParsedHistoryRow | undefined {
  const compact = cells.map((cell) => cleanText(cell)).filter(Boolean);
  if (compact.length < 8) return undefined;
  if (!/^\d{1,3}$/.test(compact[0])) return undefined;
  const constituencyName = cleanHistoryConstituencyName(compact[1]);
  if (!constituencyName) return undefined;

  const marginIndex = resolveWikipediaMarginIndex(compact);
  const margin = toNumber(compact[marginIndex] ?? "0");
  const body = compact.slice(2, marginIndex);
  if (looksLikePercentValue(body[0])) {
    body.shift();
  }

  const winner = parseWikipediaCandidateBlock(body);
  if (!winner) return undefined;
  const runner = parseWikipediaCandidateBlock(body.slice(winner.consumed));
  if (!runner) return undefined;
  if (!winner.name || !winner.party || !runner.name) return undefined;

  return {
    constituencyName,
    constituencyNumber: compact[0].padStart(3, "0"),
    entry: {
      year,
      winnerName: winner.name,
      party: winner.party,
      votes: winner.votes || undefined,
      voteSharePercent: winner.voteSharePercent,
      runnerUpName: runner.name,
      runnerUpParty: runner.party,
      runnerUpVotes: runner.votes || undefined,
      margin
    }
  };
}

function parseWikipediaCandidateBlock(
  cells: string[]
): { name: string; party: string; votes: number; voteSharePercent?: number; consumed: number } | undefined {
  if (cells.length < 3) return undefined;
  const name = cells[0] ?? "";
  const party = cells[1] ?? "";
  let index = 2;

  while (index < cells.length && !looksLikeVoteCount(cells[index])) {
    index += 1;
  }

  if (index >= cells.length) return undefined;
  const votes = toNumber(cells[index] ?? "0");
  const voteShareCandidate = cells[index + 1];
  const voteSharePercent = looksLikePercentValue(voteShareCandidate) ? toPercent(voteShareCandidate) : undefined;
  const consumed = index + (voteSharePercent !== undefined ? 2 : 1);

  return {
    name,
    party,
    votes,
    voteSharePercent,
    consumed
  };
}

function cleanHistoryConstituencyName(value: string): string {
  return cleanText(value)
    .replace(/\((sc|st)\)/gi, "")
    .replace(/\bassembly constituency\b/gi, "")
    .trim();
}

function cleanText(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: string): number {
  const digits = value.replace(/[^\d-]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPercent(value: string): number | undefined {
  const numeric = value.replace(/[^\d.-]/g, "");
  if (!/\d/.test(numeric)) return undefined;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function looksLikeVoteCount(value: string | undefined): boolean {
  if (!value) return false;
  const numeric = value.replace(/[^\d.-]/g, "");
  if (!/\d/.test(numeric)) return false;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed > 100;
}

function looksLikePercentValue(value: string | undefined): boolean {
  if (!value) return false;
  const numeric = value.replace(/[^\d.-]/g, "");
  if (!/\d/.test(numeric)) return false;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
}

function resolveWikipediaMarginIndex(cells: string[]): number {
  const lastIndex = cells.length - 1;
  const lastValue = cells[lastIndex];
  const previousValue = cells[lastIndex - 1];
  if (looksLikePercentValue(lastValue) && looksLikeVoteCount(previousValue)) {
    return lastIndex - 1;
  }
  return lastIndex;
}

function normalizeHistorySeatName(value: string): string {
  return normalizeComparable(
    value
      .replace(/\((sc|st)\)/gi, "")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeConstituencyNumber(value: string | undefined): string {
  if (!value) return "";
  return String(Number(value) || value).padStart(3, "0");
}

function normalizeArchiveStateKey(stateName: string): string {
  return stateName
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[().]/g, "")
    .replace(/\s+/g, "-");
}

function dedupeHistoryRows(rows: ParsedHistoryRow[]): ParsedHistoryRow[] {
  const seen = new Set<string>();
  const deduped: ParsedHistoryRow[] = [];
  for (const row of rows) {
    const key = `${row.entry.year}:${normalizeConstituencyNumber(row.constituencyNumber)}:${normalizeHistorySeatName(row.constituencyName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function buildTrendLabel(entries: ConstituencyElectionHistoryEntry[]): string | undefined {
  if (!entries.length) return undefined;
  const partyCounts = new Map<string, number>();
  for (const entry of entries) {
    partyCounts.set(entry.party, (partyCounts.get(entry.party) ?? 0) + 1);
  }
  const sorted = [...partyCounts.entries()].sort((left, right) => right[1] - left[1]);
  const [topParty, topCount] = sorted[0] ?? [];
  const averageMargin = entries.reduce((sum, entry) => sum + entry.margin, 0) / entries.length;
  if (entries.length >= 3 && sorted.length >= 3) return "Frequent party change";
  if (averageMargin <= 5000) return "Close-fight seat";
  if (topParty && topCount === entries.length) return `${shortPartyName(topParty)} stronghold`;
  if (topParty && topCount >= 2) return `${shortPartyName(topParty)} leaning seat`;
  return "Swing seat";
}

function buildContextNote(entries: ConstituencyElectionHistoryEntry[]): string | undefined {
  if (!entries.length) return undefined;
  const latest = entries[0];
  const parties = [...new Set(entries.map((entry) => shortPartyName(entry.party)))];
  const lastMargin = formatCompactNumber(latest.margin);
  if (parties.length === 1) {
    return `${parties[0]} won each of the last ${entries.length} assembly elections. Last recorded margin: ${lastMargin} votes in ${latest.year}.`;
  }
  return `${parties.join(", ")} shared the last ${entries.length} elections here. Last recorded margin: ${lastMargin} votes in ${latest.year}.`;
}

function shortPartyName(party: string): string {
  const cleaned = cleanText(party);
  if (!cleaned) return party;
  if (cleaned.length <= 16 && /[A-Z]/.test(cleaned) && !/\s[a-z]/.test(cleaned)) {
    return cleaned;
  }
  const explicitAbbreviation = cleaned.match(/-\s*([A-Z][A-Z()&./-]{1,})$/)?.[1];
  if (explicitAbbreviation) return explicitAbbreviation;
  const acronym = cleaned.match(/\b[A-Z]{2,}\b/g)?.join("");
  return acronym || cleaned;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

async function loadOfficialHistoryCatalog(): Promise<Record<string, Record<number, OfficialHistorySource>>> {
  const fileStore = await readOfficialHistoryCatalogStore();
  const merged = new Map<string, Map<number, OfficialHistorySource>>();

  const mergeCatalog = (catalog: Record<string, Record<number, OfficialHistorySource>> | Record<string, Record<string, OfficialHistorySource>>) => {
    for (const [stateKey, yearMap] of Object.entries(catalog)) {
      const target = merged.get(stateKey) ?? new Map<number, OfficialHistorySource>();
      merged.set(stateKey, target);
      for (const [yearKey, source] of Object.entries(yearMap)) {
        const year = Number(yearKey);
        if (!Number.isFinite(year) || !source?.statewiseUrl) continue;
        target.set(year, source);
      }
    }
  };

  mergeCatalog(OFFICIAL_HISTORY_CATALOG);
  if (fileStore?.sources) {
    mergeCatalog(fileStore.sources);
  }

  return Object.fromEntries(
    [...merged.entries()].map(([stateKey, yearMap]) => [
      stateKey,
      Object.fromEntries([...yearMap.entries()].map(([year, source]) => [String(year), source]))
    ])
  ) as Record<string, Record<number, OfficialHistorySource>>;
}

async function readOfficialHistoryCatalogStore(): Promise<OfficialHistoryCatalogStore | undefined> {
  try {
    const raw = await readFile(officialHistoryCatalogPath, "utf8");
    const parsed = JSON.parse(raw) as OfficialHistoryCatalogStore;
    if (parsed?.version === 1 && parsed.sources) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
