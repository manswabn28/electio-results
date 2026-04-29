import type { Request, Response, Router } from "express";
import express from "express";
import { clearElectionCache, getCandidateIndex, getConstituencies, getConstituencyResult, getConstituencyResults, getPartySummary, getSourceDiagnostics, getSummary } from "./eci/service.js";
import { applyDiscoveredSource, getDiscoveryStatus, runSourceDiscovery, setDiscoveryScheduleEnabled } from "./eci/discovery.js";
import { getSourceConfig, revertSourceConfig, setActiveSourceProfile, toPublicSourceConfig, updateSourceConfig } from "./sourceConfigStore.js";
import { addChatMessage, deleteChatMessage, getChatMessages, subscribeToChat } from "./chatStore.js";
import { recordViewer } from "./traffic.js";
import { createTelegramSubscriptionLink, getTelegramSubscriptionStatus, telegramEnabled } from "./telegramAlerts.js";
import { config } from "./config.js";
import { getConstituencyHistories } from "./constituencyHistory.js";
import type { CandidateResult, ConstituencyDetailCandidate, ConstituencyDetailInsights, ConstituencyDetailTimelineItem, ConstituencyElectionHistoryEntry, ElectionSourceProfile } from "@kerala-election/shared";
import { getConstituencyTimeline, getConstituencyTimelineBatch, getProfileTimeline } from "./timelineStore.js";

export function createApiRouter(): Router {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "kerala-election-results-api",
      timestamp: new Date().toISOString(),
      sourceConfigured: true
    });
  });

  router.get("/source-config", asyncHandler(async (_req, res) => {
    res.json(toPublicSourceConfig(await getSourceConfig()));
  }));

  router.put("/admin/source-config", requireAdmin, asyncHandler(async (req, res) => {
    const next = await updateSourceConfig({
      baseUrl: String(req.body?.baseUrl ?? ""),
      constituencyListUrl: String(req.body?.constituencyListUrl ?? ""),
      candidateDetailUrlTemplate: String(req.body?.candidateDetailUrlTemplate ?? ""),
      refreshIntervalSeconds: Number(req.body?.refreshIntervalSeconds ?? 30),
      hidePreviewBanner: Boolean(req.body?.hidePreviewBanner),
      hideCountdown: Boolean(req.body?.hideCountdown),
      updatedBy: "admin"
    });
    clearElectionCache();
    res.json(toPublicSourceConfig(next));
  }));

  router.put("/source-config/active-profile", asyncHandler(async (req, res) => {
    const next = await setActiveSourceProfile(String(req.body?.profileId ?? ""));
    clearElectionCache();
    res.json(toPublicSourceConfig(next));
  }));

  router.get("/admin/source-discovery/status", requireAdmin, asyncHandler(async (_req, res) => {
    res.json(getDiscoveryStatus());
  }));

  router.get("/admin/source-diagnostics", requireAdmin, asyncHandler(async (req, res) => {
    res.json(await getSourceDiagnostics(parseProfile(req)));
  }));

  router.post("/admin/source-discovery/run", requireAdmin, asyncHandler(async (_req, res) => {
    res.json(await runSourceDiscovery({ autoApply: false, skipIfCurrent: false }));
  }));

  router.put("/admin/source-discovery/schedule", requireAdmin, asyncHandler(async (req, res) => {
    res.json(setDiscoveryScheduleEnabled(Boolean(req.body?.enabled)));
  }));

  router.post("/admin/source-discovery/apply", requireAdmin, asyncHandler(async (_req, res) => {
    const applied = await applyDiscoveredSource();
    clearElectionCache();
    res.json(applied);
  }));

  router.post("/admin/source-config/revert", requireAdmin, asyncHandler(async (_req, res) => {
    const reverted = await revertSourceConfig();
    clearElectionCache();
    res.json(toPublicSourceConfig(reverted));
  }));

  router.get("/constituencies", asyncHandler(async (req, res) => {
    res.json(await getConstituencies(parseProfile(req)));
  }));

  router.get("/candidates", asyncHandler(async (req, res) => {
    res.json(await getCandidateIndex(parseProfile(req)));
  }));

  router.get("/constituency-history", asyncHandler(async (req, res) => {
    const ids = parseIds(req.query.ids);
    res.json({
      generatedAt: new Date().toISOString(),
      profileId: parseProfile(req),
      histories: await getConstituencyHistories(ids, parseProfile(req))
    });
  }));

  router.get("/timeline/constituencies", asyncHandler(async (req, res) => {
    const ids = parseIds(req.query.ids);
    const profileId = parseProfile(req);
    res.json({
      generatedAt: new Date().toISOString(),
      profileId,
      timelines: getConstituencyTimelineBatch(profileId ?? "active", ids)
    });
  }));

  router.get("/timeline/constituency/:constituencyId", asyncHandler(async (req, res) => {
    const profileId = parseProfile(req);
    res.json({
      generatedAt: new Date().toISOString(),
      profileId,
      constituencyId: String(req.params.constituencyId ?? ""),
      timeline: getConstituencyTimeline(profileId ?? "active", String(req.params.constituencyId ?? ""))
    });
  }));

  router.get("/timeline/profile", asyncHandler(async (req, res) => {
    const profileId = parseProfile(req);
    res.json({
      generatedAt: new Date().toISOString(),
      profileId,
      timeline: getProfileTimeline(profileId ?? "active")
    });
  }));

  router.get("/elections/:stateSlug/constituencies/:constituencySlug", asyncHandler(async (req, res) => {
    const requestedStateSlug = normalizeSlug(String(req.params.stateSlug ?? ""));
    const requestedSeatSlug = normalizeSlug(String(req.params.constituencySlug ?? ""));
    const profile = await resolveProfileForState(requestedStateSlug, parseProfile(req));
    if (!profile) {
      throw Object.assign(new Error("Election profile not found for the requested state."), {
        statusCode: 404,
        code: "PROFILE_NOT_FOUND"
      });
    }

    const constituencies = (await getConstituencies(profile.profileId)).constituencies;
    const constituency = constituencies.find((seat) => normalizeSlug(seat.constituencyName) === requestedSeatSlug);
    if (!constituency) {
      throw Object.assign(new Error("Constituency not found for the requested state profile."), {
        statusCode: 404,
        code: "CONSTITUENCY_NOT_FOUND"
      });
    }

    const [detail, historyEnvelope] = await Promise.all([
      getConstituencyResult(constituency.constituencyId, profile.profileId),
      getConstituencyHistories([constituency.constituencyId], profile.profileId)
    ]);
    const history = historyEnvelope[0];
    const rounds = parseRoundProgress(detail.roundStatus || detail.statusText);
    const declared = isDeclaredWinner(detail.statusText || detail.roundStatus);
    const electionYear = extractElectionYear(profile.electionTitle);
    const candidates = buildDetailCandidates(detail.candidates, detail.totalVotes, declared);
    const winner = candidates[0];
    const runnerUp = candidates[1];
    const leadChangedRecently = !declared && detail.margin <= 1000;
    const timeline = getConstituencyTimeline(profile.profileId, constituency.constituencyId);
    const insights = buildConstituencyInsights({
      candidates,
      declared,
      detail,
      historyEntries: history?.entries ?? []
    });

    res.json({
      generatedAt: new Date().toISOString(),
      profileId: profile.profileId,
      election: {
        id: profile.profileId,
        name: profile.electionTitle,
        year: electionYear,
        stateName: profile.stateName,
        stateSlug: requestedStateSlug,
        status: declared ? "final" : detail.candidates.length ? "live" : "awaiting",
        lastUpdated: detail.lastUpdated
      },
      constituency: {
        id: constituency.constituencyId,
        name: constituency.constituencyName,
        slug: requestedSeatSlug,
        district: inferDistrictName(constituency.constituencyName),
        assemblyNumber: constituency.constituencyNumber,
        totalRounds: rounds?.total,
        roundsCounted: rounds?.current,
        status: declared ? "final" : detail.candidates.length ? "live" : "awaiting"
      },
      result: {
        leadingCandidateId: winner?.id,
        runnerUpCandidateId: runnerUp?.id,
        winnerCandidateId: declared ? winner?.id : undefined,
        margin: detail.margin,
        marginStatus: declared ? "Winner declared" : marginStatusLabel(detail.margin),
        declared,
        leadChangedRecently,
        previousLeaderCandidateId: leadChangedRecently ? runnerUp?.id : undefined,
        totalVotes: detail.totalVotes,
        statusText: detail.statusText || detail.roundStatus,
        sourceUrl: detail.sourceUrl
      },
      candidates,
      history: history?.entries ?? [],
      timeline: timeline.length ? timeline : buildDetailTimeline({
        declared,
        detail,
        winner,
        runnerUp,
        rounds,
        electionTitle: profile.electionTitle
      }),
      insights
    });
  }));

  router.get("/results/summary", asyncHandler(async (req, res) => {
    const ids = parseIds(req.query.ids);
    res.json(await getSummary(ids, parseProfile(req)));
  }));

  router.get("/party-summary", asyncHandler(async (req, res) => {
    res.json(await getPartySummary(parseProfile(req)));
  }));

  router.get("/telegram/config", asyncHandler(async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      enabled: telegramEnabled(),
      botUsername: config.TELEGRAM_BOT_USERNAME || undefined
    });
  }));

  router.get("/telegram/status", asyncHandler(async (req, res) => {
    const viewerId = String(req.query.viewerId ?? "").trim();
    const profileId = parseProfile(req) ?? "";
    res.json(await getTelegramSubscriptionStatus(viewerId, profileId));
  }));

  router.post("/telegram/subscribe-link", asyncHandler(async (req, res) => {
    res.json(await createTelegramSubscriptionLink({
      viewerId: String(req.body?.viewerId ?? "").trim(),
      profileId: String(req.body?.profileId ?? parseProfile(req) ?? "").trim(),
      selectedIds: Array.isArray(req.body?.selectedIds) ? req.body.selectedIds.map(String) : [],
      watchedCandidateIds: Array.isArray(req.body?.watchedCandidateIds) ? req.body.watchedCandidateIds.map(String) : [],
      rules: typeof req.body?.rules === "object" && req.body?.rules ? req.body.rules : undefined
    }));
  }));

  router.get("/results/details", asyncHandler(async (req, res) => {
    const ids = parseIds(req.query.ids);
    res.json(await getConstituencyResults(ids, parseProfile(req)));
  }));

  router.get("/share-image", asyncHandler(async (req, res) => {
    const rawUrl = String(req.query.url ?? "").trim();
    if (!rawUrl) {
      res.status(400).json({
        error: {
          message: "Image URL is required.",
          code: "MISSING_IMAGE_URL"
        }
      });
      return;
    }

    const imageUrl = new URL(rawUrl);
    if (!["http:", "https:"].includes(imageUrl.protocol) || !/results\.eci\.gov\.in$/i.test(imageUrl.hostname)) {
      res.status(400).json({
        error: {
          message: "Only official ECI image URLs are allowed.",
          code: "UNSUPPORTED_IMAGE_HOST"
        }
      });
      return;
    }

    const browserHeaders = {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      origin: imageUrl.origin,
      referer: `${imageUrl.origin}/`,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    };

    let response = await fetch(imageUrl.toString(), {
      headers: browserHeaders
    });

    if (response.status === 403) {
      response = await fetch(imageUrl.toString(), {
        headers: {
          ...browserHeaders,
          referer: "https://results.eci.gov.in/",
          origin: "https://results.eci.gov.in"
        }
      });
    }

    if (!response.ok) {
      throw Object.assign(new Error(`Image fetch failed with ${response.status}`), {
        statusCode: response.status,
        code: "IMAGE_FETCH_FAILED"
      });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(buffer);
  }));

  router.post("/traffic/heartbeat", asyncHandler(async (req, res) => {
    res.json(recordViewer(String(req.body?.viewerId ?? "")));
  }));

  router.get("/chat/messages", asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 120);
    res.json(await getChatMessages(parseProfile(req) ?? "default", Number.isFinite(limit) ? limit : 120));
  }));

  router.get("/chat/stream", (req, res) => {
    const profileId = parseProfile(req) ?? "default";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({ type: "ready", generatedAt: new Date().toISOString() });

    const unsubscribe = subscribeToChat(profileId, (message) => {
      send({ type: "message", message });
    });

    const heartbeat = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  router.post("/chat/messages", asyncHandler(async (req, res) => {
    const adminPassword = resolveAdminPassword(req);
    const message = await addChatMessage({
      profileId: String(req.body?.profileId ?? parseProfile(req) ?? "default"),
      viewerId: String(req.body?.viewerId ?? ""),
      displayName: String(req.body?.displayName ?? ""),
      isAdmin: adminPassword === "ldfudf#2026",
      message: String(req.body?.message ?? "")
    });
    res.status(201).json({
      generatedAt: new Date().toISOString(),
      data: message
    });
  }));

  router.delete("/admin/chat/messages/:messageId", requireAdmin, asyncHandler(async (req, res) => {
    const message = await deleteChatMessage(String(req.body?.profileId ?? req.query.profile ?? "default"), String(req.params.messageId ?? ""));
    res.json({
      generatedAt: new Date().toISOString(),
      data: message
    });
  }));

  router.get("/results/:constituencyId", asyncHandler(async (req, res) => {
    const result = await getConstituencyResult(req.params.constituencyId, parseProfile(req));
    res.json({
      generatedAt: new Date().toISOString(),
      sourceConfigured: true,
      data: result
    });
  }));

  return router;
}

function parseProfile(req: Request): string | undefined {
  const value = req.query.profile;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(",")).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function asyncHandler(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error) => {
      const status = Number(error.statusCode) || 500;
      res.status(status).json({
        generatedAt: new Date().toISOString(),
        sourceConfigured: true,
        error: {
          message: error.message ?? "Unexpected server error",
          code: error.code ?? "INTERNAL_ERROR"
        }
      });
    });
  };
}

function requireAdmin(req: Request, res: Response, next: () => void): void {
  const password = resolveAdminPassword(req);
  if (password !== "ldfudf#2026") {
    res.status(401).json({
      error: {
        message: "Admin password is required to modify settings.",
        code: "UNAUTHORIZED"
      }
    });
    return;
  }

  next();
}

function resolveAdminPassword(req: Request): string | undefined {
  const header = req.header("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  return bearer || req.header("x-admin-password");
}

async function resolveProfileForState(stateSlug: string, requestedProfileId?: string): Promise<ElectionSourceProfile | undefined> {
  const sourceConfig = await getSourceConfig();
  const enabledProfiles = (sourceConfig.profiles ?? []).filter((profile) => profile.enabled);
  if (requestedProfileId) {
    return enabledProfiles.find((profile) => profile.profileId === requestedProfileId);
  }
  if (stateSlug) {
    return enabledProfiles.find((profile) => normalizeSlug(profile.stateName) === stateSlug);
  }
  return enabledProfiles.find((profile) => profile.profileId === sourceConfig.activeProfileId)
    ?? enabledProfiles[0];
}

function normalizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function extractElectionYear(value: string): number | undefined {
  const match = value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
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
      return {
        partyCode: last.replace(/[^\w()]/g, ""),
        partyName: first
      };
    }
  }
  if (raw.length <= 8 && raw === raw.toUpperCase()) {
    return { partyCode: raw, partyName: raw };
  }
  const acronym = raw
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return {
    partyCode: acronym || raw.toUpperCase().slice(0, 8),
    partyName: raw
  };
}

function buildDetailCandidates(candidates: CandidateResult[], totalVotes: number, declared: boolean): ConstituencyDetailCandidate[] {
  const safeTotal = totalVotes > 0 ? totalVotes : candidates.reduce((sum, candidate) => sum + candidate.totalVotes, 0);
  return candidates.map((candidate, index) => {
    const party = splitPartyIdentity(candidate.party);
    const marginFromLeader = index === 0 ? 0 : Math.max(0, (candidates[0]?.totalVotes ?? 0) - candidate.totalVotes);
    return {
      id: `${candidate.serialNo}-${normalizeSlug(candidate.candidateName)}`,
      name: candidate.candidateName,
      partyCode: party.partyCode,
      partyName: party.partyName,
      votes: candidate.totalVotes,
      voteShare: safeTotal > 0 ? Number(((candidate.totalVotes / safeTotal) * 100).toFixed(2)) : candidate.votePercent,
      rank: index + 1,
      photoUrl: candidate.photoUrl,
      status: index === 0
        ? declared ? "won" : "leading"
        : index === 1
          ? declared ? "runner-up" : "trailing"
          : declared ? "lost" : "trailing",
      marginFromLeader
    };
  });
}

function buildDetailTimeline(input: {
  declared: boolean;
  detail: Awaited<ReturnType<typeof getConstituencyResult>>;
  winner?: ConstituencyDetailCandidate;
  runnerUp?: ConstituencyDetailCandidate;
  rounds?: { current: number; total: number };
  electionTitle: string;
}): ConstituencyDetailTimelineItem[] {
  const time = input.detail.lastUpdated || new Date().toISOString();
  const items: ConstituencyDetailTimelineItem[] = [
    {
      id: "counting-started",
      time,
      type: "counting-started",
      title: "Counting started",
      description: `${input.electionTitle} counting updates began for ${input.detail.constituencyName}.`
    },
    {
      id: "first-trend",
      time,
      type: "update",
      title: "First trend available",
      description: `${input.winner?.name ?? input.detail.leadingCandidate} moved ahead in the early count.`
    }
  ];

  if (input.detail.margin <= 1000) {
    items.push({
      id: "tight-race",
      time,
      type: "tight-race",
      title: "Tight race alert",
      description: `Margin narrowed to ${formatNumber(input.detail.margin)} votes.`
    });
  } else if (input.runnerUp) {
    items.push({
      id: "lead-update",
      time,
      type: "milestone",
      title: `${input.winner?.partyCode ?? "Leader"} extends lead`,
      description: `${input.winner?.name ?? input.detail.leadingCandidate} led ${input.runnerUp.name} by ${formatNumber(input.detail.margin)} votes.`
    });
  }

  if (input.rounds) {
    items.push({
      id: "round-progress",
      time,
      type: "update",
      title: "Counting progress update",
      description: `${input.rounds.current}/${input.rounds.total} rounds counted.`
    });
  }

  if (input.declared && input.winner) {
    items.push({
      id: "winner-declared",
      time,
      type: "winner",
      title: `Winner declared: ${input.winner.partyCode}`,
      description: `${input.winner.name} won by ${formatNumber(input.detail.margin)} votes.`
    });
  }

  return items;
}

function buildConstituencyInsights(input: {
  candidates: ConstituencyDetailCandidate[];
  declared: boolean;
  detail: Awaited<ReturnType<typeof getConstituencyResult>>;
  historyEntries: ConstituencyElectionHistoryEntry[];
}): ConstituencyDetailInsights {
  const previous = input.historyEntries[0];
  const margins = input.historyEntries.map((entry) => entry.margin).filter((value) => Number.isFinite(value));
  const historicalLean = deriveHistoricalLean(input.historyEntries);
  return {
    seatType: input.detail.margin <= 500 ? "Ultra-close finish" : input.detail.margin <= 5000 ? "Competitive seat" : "Clear mandate",
    historicalLean,
    closestPastMargin: margins.length ? Math.min(...margins) : undefined,
    biggestPastMargin: margins.length ? Math.max(...margins) : undefined,
    previousWinnerParty: previous?.party,
    previousWinnerName: previous?.winnerName,
    volatilityScore: input.detail.margin <= 500 ? "high" : input.detail.margin <= 5000 ? "medium" : "low",
    turnout: previous?.turnoutPercent,
    totalCandidates: input.candidates.length,
    leadStability: input.declared || input.detail.margin > 1000 ? "stable" : "swinging"
  };
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

function marginStatusLabel(margin: number): string {
  if (margin <= 500) return "Too close to call";
  if (margin <= 1000) return "Alert lead";
  if (margin <= 5000) return "Tight lead";
  return "Clear lead";
}

function inferDistrictName(_constituencyName: string): string | undefined {
  return undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}
