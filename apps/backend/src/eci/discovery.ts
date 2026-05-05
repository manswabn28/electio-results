import type { DiscoveredSource, DiscoveryTrailItem, ElectionSourceProfile, SourceConfig } from "@kerala-election/shared";
import { config } from "../config.js";
import { fallbackKeralaConstituencies, normalizeComparable } from "../keralaConstituencies.js";
import { getSourceConfig, hasPreviousSourceConfig, makeProfile, normalizeCandidateTemplate, resolveConfiguredUrl, updateSourceProfiles } from "../sourceConfigStore.js";
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
    void runSourceDiscovery({ autoApply: true, skipIfCurrent: false }).catch((error) => {
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
  addTrail("Started ECI source discovery.");

  try {
    const current = await getSourceConfig();
    addTrail(`Checking the base URL: ${config.ECI_BASE_URL}`);
    const currentValidation = await validateCurrentSource(current).catch((error) => {
      addTrail("Current saved ECI URLs could not be validated.", "warning", [error instanceof Error ? error.message : String(error)]);
      return false;
    });
    if (currentValidation) {
      addTrail("Current saved ECI URLs are valid.", "success", [
        resolveConfiguredUrl(current, current.constituencyListUrl),
        resolveConfiguredUrl(current, current.candidateDetailUrlTemplate)
      ]);
    }
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
        previousAvailable: await hasPreviousSourceConfig(),
        warnings: []
      };
      return getDiscoveryStatus();
    }

    const candidateRoots = await discoverCandidateRoots();
    addTrail(`Found ${candidateRoots.length} possible ECI result folder${candidateRoots.length === 1 ? "" : "s"}.`, candidateRoots.length ? "success" : "warning", candidateRoots.slice(0, 12));
    const candidates = [];
    for (const root of candidateRoots.slice(0, 12)) {
      candidates.push(...await discoverStatePages(root));
    }
    addTrail(`Validated ${candidates.length} assembly result profile${candidates.length === 1 ? "" : "s"}.`, candidates.length ? "success" : "warning");

    const profiles = candidates
      .sort((a, b) => b.confidence - a.confidence)
      .map((candidate) => candidate.profile);
    const best = candidates.sort((a, b) => {
      const keralaDelta = Number(/kerala/i.test(b.profile.stateName)) - Number(/kerala/i.test(a.profile.stateName));
      return keralaDelta || b.confidence - a.confidence;
    })[0];
    if (!best) {
      status = { ...status, status: "failed", checkedAt: new Date().toISOString(), message: "No assembly result source was discovered.", warnings: ["ECI may not have published the 2026 result links yet."] };
      addTrail("No assembly result profile could be created from the ECI links.", "error");
      return getDiscoveryStatus();
    }

    const result: DiscoveredSource = {
      ...emptyStatus(best.confidence >= 80 ? "ECI assembly result sources discovered and verified." : "Possible ECI assembly result sources discovered; admin review recommended."),
      status: "found",
      checkedAt: new Date().toISOString(),
      confidence: best.confidence,
      eventFolderUrl: best.eventFolderUrl,
      constituencyListUrl: best.constituencyListUrl,
      candidateDetailUrlTemplate: best.candidateDetailUrlTemplate,
      partySummaryUrl: best.partySummaryUrl,
      stateName: best.profile.stateName,
      constituencyCount: best.constituencyCount,
      sampleVerified: best.sampleVerified,
      alreadyCurrent: sameSource(current, best),
      profiles,
      previousAvailable: await hasPreviousSourceConfig(),
      trail: status.trail,
      warnings: best.warnings
    };

    status = result;
    if (options.autoApply && result.confidence >= 85 && result.sampleVerified && result.constituencyListUrl && result.candidateDetailUrlTemplate && !result.alreadyCurrent) {
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
  const profiles = status.profiles?.length
    ? status.profiles.map((profile) => ({
        ...profile,
        candidateDetailUrlTemplate: normalizeCandidateTemplate(profile.candidateDetailUrlTemplate)
      }))
    : [makeProfile({
        stateName: status.stateName ?? "Kerala",
        constituencyListUrl: status.constituencyListUrl,
        candidateDetailUrlTemplate: status.candidateDetailUrlTemplate,
        eventFolderUrl: status.eventFolderUrl,
        partySummaryUrl: status.partySummaryUrl,
        constituencyCount: status.constituencyCount ?? 0,
        confidence: status.confidence,
        sampleVerified: Boolean(status.sampleVerified)
      })];
  const usableProfiles = profiles.filter((profile) => profile.candidateDetailUrlTemplate.includes("{constituencyNumber}") || profile.candidateDetailUrlTemplate.includes("{constituencyNumberPadded}"));
  if (!usableProfiles.length) {
    throw Object.assign(new Error(`Discovered candidate detail URL could not be converted into a template. Found: ${status.candidateDetailUrlTemplate}`), {
      statusCode: 400,
      code: "DISCOVERY_TEMPLATE_INVALID"
    });
  }
  const verifiedProfiles = await verifyProfilesBeforeApply(usableProfiles);
  if (!verifiedProfiles.length) {
    addTrail("Apply Found blocked because candidate detail URLs failed verification.", "error");
    status = {
      ...status,
      status: "found",
      message: "Discovered source was not applied because candidate detail pages could not be verified.",
      warnings: [
        ...status.warnings,
        "Apply Found was blocked to protect the current working ECI source. Check the discovered candidate detail URL template before applying."
      ]
    };
    throw Object.assign(new Error("Discovered source was not applied because candidate detail pages could not be verified."), {
      statusCode: 422,
      code: "DISCOVERY_VERIFICATION_FAILED"
    });
  }
  addTrail(`Applying ${verifiedProfiles.length} verified source profile${verifiedProfiles.length === 1 ? "" : "s"}.`, "success");
  const next = await updateSourceProfiles(verifiedProfiles, verifiedProfiles.find((profile) => /kerala/i.test(profile.stateName))?.profileId ?? verifiedProfiles[0]?.profileId, "auto-discovery");
  status = {
    ...status,
    status: "applied",
    appliedAt: new Date().toISOString(),
    alreadyCurrent: true,
    autoApplied: true,
    previousAvailable: await hasPreviousSourceConfig(),
    message: `Applied discovered ECI source updated at ${next.updatedAt}.`
  };
  return getDiscoveryStatus();
}

async function verifyProfilesBeforeApply(profiles: ElectionSourceProfile[]): Promise<ElectionSourceProfile[]> {
  const verifiedProfiles: ElectionSourceProfile[] = [];
  for (const profile of profiles) {
    const html = await fetchHtml(profile.constituencyListUrl).catch((error) => {
      logger.warn({ error, profileId: profile.profileId, url: profile.constituencyListUrl }, "Discovery apply could not fetch constituency list page");
      return "";
    });
    if (!html) continue;
    const pageUrls = new Set([profile.constituencyListUrl, ...parsePaginationUrls(html, profile.constituencyListUrl)]);
    const summaries = [];
    for (const pageUrl of pageUrls) {
      const pageHtml = pageUrl === profile.constituencyListUrl ? html : await fetchHtml(pageUrl).catch(() => "");
      if (pageHtml) summaries.push(...parseStatePage(pageHtml, pageUrl, config.defaultFavoriteIds, false));
    }
    if (summaries.length < 20) {
      logger.warn({ profileId: profile.profileId, count: summaries.length }, "Discovery apply rejected profile with too few constituency rows");
      continue;
    }
    const sampleVerified = await verifySamples(summaries, profile.candidateDetailUrlTemplate, { preferTemplate: true });
    if (!sampleVerified) {
      logger.warn({ profileId: profile.profileId, template: profile.candidateDetailUrlTemplate }, "Discovery apply rejected unverified candidate detail template");
      continue;
    }
    verifiedProfiles.push({
      ...profile,
      confidence: Math.max(profile.confidence, 85),
      sampleVerified: true
    });
  }
  return verifiedProfiles;
}

async function discoverCandidateRoots(): Promise<string[]> {
  const base = config.ECI_BASE_URL.replace(/\/+$/, "/");
  const roots = new Set<string>();
  const current = await getSourceConfig();
  roots.add(new URL("./", resolveConfiguredUrl(current, current.constituencyListUrl)).toString());

  const html = await fetchHtml(base);
  addTrail("Fetched ECI base page and scanning for result links.", "success");
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
    profile: ElectionSourceProfile;
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
  addTrail(`Checking result folder: ${root}`);

  const linkLabels = new Map<string, string>();
  for (const url of [root, indexUrl]) {
    const html = await fetchHtml(url).catch(() => "");
    if (!html) continue;
    for (const link of extractLinks(html, url)) {
      if (/statewiseS\d+/i.test(link.href)) {
        urls.add(link.href);
        if (link.text) linkLabels.set(link.href, link.text);
      }
    }
  }
  addTrail(`Found ${urls.size} state/assembly constituency page${urls.size === 1 ? "" : "s"} in ${root}.`, urls.size ? "success" : "warning", [...urls].slice(0, 10));

  for (const stateUrl of [...urls].slice(0, 30)) {
    const html = await fetchHtml(stateUrl).catch(() => "");
    if (!html) continue;
    addTrail(`Identifying constituency data from ${stateUrl}`);
    const pageUrls = new Set([stateUrl, ...parsePaginationUrls(html, stateUrl)]);
    const summaries = [];
    for (const pageUrl of pageUrls) {
      const pageHtml = pageUrl === stateUrl ? html : await fetchHtml(pageUrl).catch(() => "");
      if (pageHtml) summaries.push(...parseStatePage(pageHtml, pageUrl, config.defaultFavoriteIds, false));
    }
    const stateName = inferStateName(linkLabels.get(stateUrl) || html, summaries.length, root);
    addTrail(`Discovered ${stateName} assembly result with ${summaries.length} constituencies.`, summaries.length >= 20 ? "success" : "warning");
    const score = scoreAssemblyStatePage(html, summaries.length, stateName);
    if (score < 25) continue;
    const template = inferDetailTemplate(summaries);
    const fallbackTemplate = fallbackDetailTemplateFromStateUrl(stateUrl);
    const candidateDetailUrlTemplate = template || fallbackTemplate;
    addTrail("Identifying candidate detail URL template.", candidateDetailUrlTemplate ? "success" : "warning", candidateDetailUrlTemplate ? [candidateDetailUrlTemplate] : undefined);
    const sampleVerified = await verifySamples(summaries, candidateDetailUrlTemplate);
    addTrail("Making candidate detail links work and checking candidate table data.", sampleVerified ? "success" : "warning", candidateDetailUrlTemplate ? [candidateDetailUrlTemplate] : undefined);
    const confidence = Math.min(100, score + (sampleVerified ? 25 : 0) + (candidateDetailUrlTemplate ? 10 : 0) + (fallbackTemplate && !template ? 5 : 0));
    if (!candidateDetailUrlTemplate) continue;
    const profile = makeProfile({
      stateName,
      electionTitle: inferElectionTitle(root, stateName),
      eventFolderUrl: new URL("./", stateUrl).toString(),
      constituencyListUrl: stateUrl,
      candidateDetailUrlTemplate,
      partySummaryUrl: new URL("index.htm", stateUrl).toString(),
      constituencyCount: summaries.length,
      confidence,
      sampleVerified
    });
    results.push({
      confidence,
      profile,
      eventFolderUrl: new URL("./", stateUrl).toString(),
      constituencyListUrl: stateUrl,
      candidateDetailUrlTemplate,
      partySummaryUrl: new URL("index.htm", stateUrl).toString(),
      constituencyCount: summaries.length,
      sampleVerified,
      warnings: [
        ...(sampleVerified ? [] : ["Candidate detail sample verification was incomplete."]),
        ...(fallbackTemplate && !template ? ["Candidate detail URL template was inferred from the statewise page code."] : [])
      ]
    });
  }
  return results;
}

function scoreAssemblyStatePage(html: string, count: number, stateName: string): number {
  const text = normalizeComparable(html);
  const keralaMatches = fallbackKeralaConstituencies.filter((seat) => text.includes(normalizeComparable(seat.constituencyName))).length;
  let score = 0;
  if (stateName) score += 25;
  if (/kerala/i.test(stateName) || text.includes("kerala")) score += 10;
  if (count >= 20 && count <= 320) score += 35;
  else if (count >= 20) score += 15;
  score += Math.min(25, keralaMatches * 2);
  if (text.includes("leadingcandidate") || text.includes("trailingcandidate")) score += 10;
  return score;
}

function inferStateName(text: string, count: number, root = ""): string {
  const haystack = text.replace(/\s+/g, " ");
  for (const state of ["Kerala", "Tamil Nadu", "West Bengal", "Assam", "Puducherry"]) {
    if (new RegExp(state, "i").test(haystack)) return state;
  }
  if (/resultacgenmay2026/i.test(root) && count >= 130 && count <= 150) return "Kerala";
  if (count >= 130 && count <= 150) return "Kerala";
  if (count >= 220 && count <= 238) return "Tamil Nadu";
  if (count >= 280 && count <= 300) return "West Bengal";
  if (count >= 115 && count <= 135) return "Assam";
  if (count >= 25 && count <= 35) return "Puducherry";
  return "Assembly";
}

function inferElectionTitle(root: string, stateName: string): string {
  if (/2026/i.test(root)) return `${stateName} Assembly Election 2026`;
  return `${stateName} Assembly Election Results`;
}

function placeholderUrl(base: string, path: string, token: string, placeholder: string): string {
  return new URL(path, base).toString().replace(token, placeholder);
}

function fallbackDetailTemplateFromStateUrl(stateUrl: string): string | undefined {
  const match = stateUrl.match(/statewise(S\d+)1\.html?$/i);
  if (!match?.[1]) return undefined;
  return placeholderUrl(stateUrl, `./candidateswise-${match[1]}__CONSTITUENCY_NUMBER__.htm`, "__CONSTITUENCY_NUMBER__", "{constituencyNumber}");
}

function inferDetailTemplate(summaries: { constituencyNumber: string; sourceUrl?: string }[]): string | undefined {
  const sample = summaries.find((summary) => summary.sourceUrl && /candidateswise|Constituencywise/i.test(summary.sourceUrl));
  if (!sample?.sourceUrl) return undefined;
  const number = String(Number(sample.constituencyNumber) || sample.constituencyNumber).replace(/^0+/, "") || sample.constituencyNumber;
  const padded = sample.constituencyNumber.padStart(3, "0");
  const escapedNumber = escapeRegExp(number);
  const escapedPadded = escapeRegExp(padded);
  const direct = sample.sourceUrl
    .replace(new RegExp(`${escapedPadded}(\\.html?)$`, "i"), "{constituencyNumberPadded}$1")
    .replace(new RegExp(`${escapedNumber}(\\.html?)$`, "i"), "{constituencyNumber}$1");
  if (direct.includes("{constituencyNumber")) return direct;

  return sample.sourceUrl
    .replace(/(candidateswise-S\d{2})(\d{1,3})(\.html?)$/i, "$1{constituencyNumber}$3")
    .replace(/(ConstituencywiseS\d{2})(\d{1,3})(\.html?)$/i, "$1{constituencyNumber}$3");
}

async function verifySamples(
  summaries: { constituencyId: string; constituencyName: string; constituencyNumber: string; sourceUrl?: string }[],
  template?: string,
  options: { preferTemplate?: boolean } = {}
): Promise<boolean> {
  const samples = summaries.filter((summary) => summary.sourceUrl || template).slice(0, 3);
  if (!samples.length) return false;
  let verified = 0;
  for (const summary of samples) {
    const plainNumber = String(Number(summary.constituencyNumber) || summary.constituencyNumber).replace(/^0+/, "") || summary.constituencyNumber;
    const paddedNumber = summary.constituencyNumber.padStart(3, "0");
    const templatedUrl = template
      ?.replaceAll("{constituencyNumber}", plainNumber)
      .replaceAll("{constituencyNumberPadded}", paddedNumber);
    const url = options.preferTemplate ? templatedUrl : summary.sourceUrl || templatedUrl;
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
  return summaries.length >= 20 && await verifySamples(summaries, resolveConfiguredUrl(source, source.candidateDetailUrlTemplate), { preferTemplate: true });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    previousAvailable: false,
    trail: [],
    warnings: [],
    schedule: scheduleStatus()
  };
}

function addTrail(message: string, itemStatus: DiscoveryTrailItem["status"] = "running", details?: string[]): void {
  const nextItem: DiscoveryTrailItem = {
    time: new Date().toISOString(),
    status: itemStatus,
    message,
    details
  };
  status = {
    ...status,
    trail: [...(status.trail ?? []), nextItem].slice(-80)
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
