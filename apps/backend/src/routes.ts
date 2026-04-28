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

    const response = await fetch(imageUrl.toString(), {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw Object.assign(new Error(`Image fetch failed with ${response.status}`), {
        statusCode: response.status,
        code: "IMAGE_FETCH_FAILED"
      });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
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
