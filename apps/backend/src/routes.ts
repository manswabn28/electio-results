import type { Request, Response, Router } from "express";
import express from "express";
import { clearElectionCache, getConstituencies, getConstituencyResult, getPartySummary, getSummary } from "./eci/service.js";
import { getSourceConfig, toPublicSourceConfig, updateSourceConfig } from "./sourceConfigStore.js";

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
      updatedBy: "admin"
    });
    clearElectionCache();
    res.json(toPublicSourceConfig(next));
  }));

  router.get("/constituencies", asyncHandler(async (_req, res) => {
    res.json(await getConstituencies());
  }));

  router.get("/results/summary", asyncHandler(async (req, res) => {
    const ids = parseIds(req.query.ids);
    res.json(await getSummary(ids));
  }));

  router.get("/party-summary", asyncHandler(async (_req, res) => {
    res.json(await getPartySummary());
  }));

  router.get("/results/:constituencyId", asyncHandler(async (req, res) => {
    const result = await getConstituencyResult(req.params.constituencyId);
    res.json({
      generatedAt: new Date().toISOString(),
      sourceConfigured: true,
      data: result
    });
  }));

  return router;
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
  const header = req.header("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const password = bearer || req.header("x-admin-password");
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
