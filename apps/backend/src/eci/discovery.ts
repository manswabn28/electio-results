import type { DiscoveredSource, SourceConfig } from "@kerala-election/shared";
import { config } from "../config.js";
import { fallbackKeralaConstituencies, normalizeComparable } from "../keralaConstituencies.js";
import { getSourceConfig, resolveConfiguredUrl, updateSourceConfig } from "../sourceConfigStore.js";
import { logger } from "../logger.js";
import { fetchHtml } from "./http.js";
import { extractLinks, parseConstituencyPage, parsePaginationUrls, parseStatePage } from "./parser.js";

const IST_TIMEZONE = "Asia/Kolkata";
const SCHEDULE = {
  startAt: "2026-05-04T00:00:00.000Z",
  intenseStartAt: "2026-05-04T00:25:00.000Z",
  endAt: "2026-05-04T01:30:00.000Z",
  normalIntervalSeconds: 120,
  intenseIntervalSeconds: 45
};

let running: Promise<DiscoveredSource> | undefined;
let lastScheduledRunAt = 0;
let scheduleEnabled = true;
let status: DiscoveredSource = emptyStatus("ECI source discovery is scheduled.");

export function getDiscoveryStatus(): DiscoveredSource {
  return { ...status, schedule: scheduleStatus() };
}

export function setDiscoveryScheduleEnabled(enabled: boolean): DiscoveredSource {
  scheduleEnabled = enabled;
  status = {
    ...status,
    message: enabled
      ? "Backend source discovery schedule is enabled."
      : "Backend source discovery schedule is disabled by admin."
  };
  return getDiscoveryStatus();
}

export function startDiscoveryScheduler(): void {
  setInterval(() => {
    const schedule = scheduleStatus();
    if (!schedule.enabled || !schedule.activeNow) return;
    const intervalMs = (Date.now() >= Date.parse(SCHEDULE.intenseStartAt) ? SCHEDULE.intenseIntervalSeconds : SCHEDULE.normalIntervalSeconds) * 1000;
    if (Date.now() - lastScheduledRunAt < intervalMs) return;
    lastScheduledRunAt = Date.now();
    void runSourceDiscovery({ autoApply: true, skipIfCurrent: true }).catch((error) => {
      logger.warn({ error }, "Scheduled ECI source discovery failed");
    });
  }, 30_000).unref();
}

export async function runSourceDiscovery(options: { autoApply?: boolean; skipIfCurrent?: boolean } = {}): Promise<DiscoveredSource> {
  if (running) return running;
  running = discover(options).finally(() => {
    running = undefined;
  });
  return running;
}

async function discover(options: { autoApply?: boolean; skipIfCurrent?: boolean }): Promise<DiscoveredSource> {
  status = { ...emptyStatus("ECI source discovery is running."), status: "running", checkedAt: new Date().toISOString() };

  try {
    const current = await getSourceConfig();
    const currentValidation = await validateCurrentSource(current).catch(() => false);
    if (options.skipIfCurrent && currentValidation) {
      status = {
        ...status,
        status: "skipped",
        confidence: 100,
        checkedAt: new Date().toISOString(),
        alreadyCurrent: true,
        constituencyListUrl: resolveConfiguredUrl(current, current.constituencyListUrl),
        candidateDetailUrlTemplate: resolveConfiguredUrl(current, current.candidateDetailUrlTemplate),
        message: "Current ECI source is already valid; scheduled discovery skipped.",
        warnings: []
      };
      return getDiscoveryStatus();
    }

    const candidateRoots = await discoverCandidateRoots();
    const candidates = [];
    for (const root of candidateRoots.slice(0, 12)) {
      candidates.push(...await discoverStatePages(root));
    }

    const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    if (!best) {
      status = { ...status, status: "failed", checkedAt: new Date().toISOString(), message: "No Kerala-like ECI result source was discovered.", warnings: ["ECI may not have published the 2026 result links yet."] };
      return getDiscoveryStatus();
    }

    const result: DiscoveredSource = {
      ...emptyStatus(best.confidence >= 80 ? "Kerala ECI source discovered and verified." : "Possible Kerala ECI source discovered; admin review recommended."),
      status: "found",
      checkedAt: new Date().toISOString(),
      confidence: best.confidence,
      eventFolderUrl: best.eventFolderUrl,
      constituencyListUrl: best.constituencyListUrl,
      candidateDetailUrlTemplate: best.candidateDetailUrlTemplate,
      partySummaryUrl: best.partySummaryUrl,
      stateName: "Kerala",
      constituencyCount: best.constituencyCount,
      sampleVerified: best.sampleVerified,
      alreadyCurrent: sameSource(current, best),
      warnings: best.warnings
    };

    status = result;
    if (options.autoApply && result.confidence >= 85 && result.constituencyListUrl && result.candidateDetailUrlTemplate && !result.alreadyCurrent) {
      await applyDiscoveredSource();
    }
    return getDiscoveryStatus();
  } catch (error) {
    status = {
      ...status,
      status: "failed",
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "ECI source discovery failed.",
      warnings: ["Manual URL update may be required if ECI changed the result website structure."]
    };
    return getDiscoveryStatus();
  }
}

export async function applyDiscoveredSource(): Promise<DiscoveredSource> {
  if (!status.constituencyListUrl || !status.candidateDetailUrlTemplate) {
    throw Object.assign(new Error("No discovered source is ready to apply."), { statusCode: 400, code: "NO_DISCOVERY_READY" });
  }
  const next = await updateSourceConfig({
    baseUrl: new URL(status.constituencyListUrl).origin,
    constituencyListUrl: status.constituencyListUrl,
    candidateDetailUrlTemplate: status.candidateDetailUrlTemplate,
    refreshIntervalSeconds: (await getSourceConfig()).refreshIntervalSeconds,
    updatedBy: "auto-discovery"
  });
  status = {
    ...status,
    status: "applied",
    appliedAt: new Date().toISOString(),
    alreadyCurrent: true,
    autoApplied: true,
    message: `Applied discovered ECI source updated at ${next.updatedAt}.`
  };
  return getDiscoveryStatus();
}

async function discoverCandidateRoots(): Promise<string[]> {
  const base = config.ECI_BASE_URL.replace(/\/+$/, "/");
  const roots = new Set<string>();
  const current = await getSourceConfig();
  roots.add(new URL("./", resolveConfiguredUrl(current, current.constituencyListUrl)).toString());

  const html = await fetchHtml(base);
  for (const link of extractLinks(html, base)) {
    if (new URL(link.href).origin !== new URL(base).origin) continue;
    if (!/result|acresult|acgen|assembly/i.test(link.href + " " + link.text)) continue;
    roots.add(link.href.endsWith("/") ? link.href : new URL("./", link.href).toString());
  }
  return [...roots];
}

async function discoverStatePages(root: string) {
  const results: Array<{
    confidence: number;
    eventFolderUrl: string;
    constituencyListUrl: string;
    candidateDetailUrlTemplate: string;
    partySummaryUrl: string;
    constituencyCount: number;
    sampleVerified: boolean;
    warnings: string[];
  }> = [];
  const indexUrl = new URL("index.htm", root).toString();
  const urls = new Set<string>();

  for (const url of [root, indexUrl]) {
    const html = await fetchHtml(url).catch(() => "");
    if (!html) continue;
    for (const link of extractLinks(html, url)) {
      if (/statewiseS\d+/i.test(link.href)) urls.add(link.href);
    }
  }

  for (const stateUrl of [...urls].slice(0, 30)) {
    const html = await fetchHtml(stateUrl).catch(() => "");
    if (!html) continue;
    const pageUrls = new Set([stateUrl, ...parsePaginationUrls(html, stateUrl)]);
    const summaries = [];
    for (const pageUrl of pageUrls) {
      const pageHtml = pageUrl === stateUrl ? html : await fetchHtml(pageUrl).catch(() => "");
      if (pageHtml) summaries.push(...parseStatePage(pageHtml, pageUrl, config.defaultFavoriteIds, false));
    }
    const score = scoreKeralaStatePage(html, summaries.length);
    if (score < 35) continue;
    const template = inferDetailTemplate(summaries.map((summary) => summary.sourceUrl).filter(Boolean) as string[]);
    const sampleVerified = await verifySamples(summaries, template);
    const confidence = Math.min(100, score + (sampleVerified ? 25 : 0) + (template ? 10 : 0));
    results.push({
      confidence,
      eventFolderUrl: new URL("./", stateUrl).toString(),
      constituencyListUrl: stateUrl,
      candidateDetailUrlTemplate: template || new URL("./candidateswise-S{constituencyNumber}.htm", stateUrl).toString(),
      partySummaryUrl: new URL("index.htm", stateUrl).toString(),
      constituencyCount: summaries.length,
      sampleVerified,
      warnings: sampleVerified ? [] : ["Candidate detail sample verification was incomplete."]
    });
  }
  return results;
}

function scoreKeralaStatePage(html: string, count: number): number {
  const text = normalizeComparable(html);
  const keralaMatches = fallbackKeralaConstituencies.filter((seat) => text.includes(normalizeComparable(seat.constituencyName))).length;
  let score = 0;
  if (text.includes("kerala")) score += 35;
  if (count >= 120 && count <= 160) score += 35;
  else if (count >= 20) score += 15;
  score += Math.min(25, keralaMatches * 2);
  if (text.includes("leadingcandidate") || text.includes("trailingcandidate")) score += 10;
  return score;
}

function inferDetailTemplate(urls: string[]): string | undefined {
  const sample = urls.find((url) => /candidateswise/i.test(url)) ?? urls[0];
  if (!sample) return undefined;
  return sample
    .replace(/(candidateswise-S\d{2,3})\d{1,3}(\.html?)$/i, "$1{constituencyNumber}$2")
    .replace(/(ConstituencywiseS\d{2,3})\d{1,3}(\.html?)$/i, "$1{constituencyNumber}$2");
}

async function verifySamples(summaries: { constituencyId: string; constituencyName: string; constituencyNumber: string; sourceUrl?: string }[], template?: string): Promise<boolean> {
  const samples = summaries.filter((summary) => summary.sourceUrl || template).slice(0, 3);
  if (!samples.length) return false;
  let verified = 0;
  for (const summary of samples) {
    const url = summary.sourceUrl || template?.replaceAll("{constituencyNumber}", String(Number(summary.constituencyNumber) || summary.constituencyNumber));
    if (!url) continue;
    const html = await fetchHtml(url).catch(() => "");
    if (!html) continue;
    const result = parseConstituencyPage(html, url, summary as never);
    if (result.candidates.length >= 2) verified += 1;
  }
  return verified >= Math.min(2, samples.length);
}

async function validateCurrentSource(source: SourceConfig): Promise<boolean> {
  const url = resolveConfiguredUrl(source, source.constituencyListUrl);
  const html = await fetchHtml(url);
  const summaries = parseStatePage(html, url, config.defaultFavoriteIds, false);
  return summaries.length >= 20 && Boolean(inferDetailTemplate(summaries.map((summary) => summary.sourceUrl).filter(Boolean) as string[]));
}

function sameSource(current: SourceConfig, best: { constituencyListUrl: string; candidateDetailUrlTemplate: string }) {
  return resolveConfiguredUrl(current, current.constituencyListUrl) === best.constituencyListUrl &&
    resolveConfiguredUrl(current, current.candidateDetailUrlTemplate) === best.candidateDetailUrlTemplate;
}

function emptyStatus(message: string): DiscoveredSource {
  return {
    confidence: 0,
    status: "idle",
    message,
    warnings: [],
    schedule: scheduleStatus()
  };
}

function scheduleStatus() {
  const now = Date.now();
  const start = Date.parse(SCHEDULE.startAt);
  const intense = Date.parse(SCHEDULE.intenseStartAt);
  const end = Date.parse(SCHEDULE.endAt);
  const activeNow = now >= start && now <= end;
  const nextRunAt = now < start ? SCHEDULE.startAt : activeNow ? new Date(Math.max(now, lastScheduledRunAt + (now >= intense ? SCHEDULE.intenseIntervalSeconds : SCHEDULE.normalIntervalSeconds) * 1000)).toISOString() : undefined;
  return {
    enabled: scheduleEnabled,
    timezone: IST_TIMEZONE,
    startAt: "2026-05-04 05:30 IST",
    intenseStartAt: "2026-05-04 05:55 IST",
    endAt: "2026-05-04 07:00 IST",
    normalIntervalSeconds: SCHEDULE.normalIntervalSeconds,
    intenseIntervalSeconds: SCHEDULE.intenseIntervalSeconds,
    nextRunAt,
    activeNow: scheduleEnabled && activeNow
  };
}
