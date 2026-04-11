import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublicSourceConfig, SourceConfig } from "@kerala-election/shared";
import { z } from "zod";
import { config } from "./config.js";

const sourceConfigSchema = z.object({
  baseUrl: z.string().url(),
  constituencyListUrl: z.string().min(1),
  candidateDetailUrlTemplate: z.string().min(1).refine((value) => value.includes("{constituencyNumber}"), {
    message: "Template must include {constituencyNumber}."
  }),
  refreshIntervalSeconds: z.coerce.number().int().min(5).max(300),
  updatedAt: z.string(),
  updatedBy: z.string()
});

const dataDir = path.resolve(process.cwd(), "data");
const configPath = path.join(dataDir, "source-config.json");

export async function getSourceConfig(): Promise<SourceConfig> {
  try {
    const file = await readFile(configPath, "utf8");
    return sourceConfigSchema.parse(JSON.parse(file));
  } catch {
    return migrateSourceConfig();
  }
}

export async function updateSourceConfig(input: {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  refreshIntervalSeconds: number;
  updatedBy?: string;
}): Promise<SourceConfig> {
  const next = sourceConfigSchema.parse({
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    constituencyListUrl: input.constituencyListUrl.trim(),
    candidateDetailUrlTemplate: input.candidateDetailUrlTemplate.trim(),
    refreshIntervalSeconds: input.refreshIntervalSeconds,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy?.trim() || "admin"
  });
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function toPublicSourceConfig(sourceConfig: SourceConfig): PublicSourceConfig {
  return {
    ...sourceConfig,
    adminEnabled: true
  };
}

export function buildCandidateDetailUrl(template: string, args: { constituencyNumber: string; constituencyId: string }): string {
  const plainNumber = String(Number(args.constituencyNumber) || args.constituencyNumber).replace(/^0+/, "") || args.constituencyNumber;
  const paddedNumber = args.constituencyNumber.padStart(3, "0");
  return template
    .replaceAll("{constituencyNumber}", plainNumber)
    .replaceAll("{constituencyNumberPadded}", paddedNumber)
    .replaceAll("{constituencyId}", encodeURIComponent(args.constituencyId));
}

export function resolveConfiguredUrl(sourceConfig: SourceConfig, value: string): string {
  const placeholders: Record<string, string> = {
    "__CONSTITUENCY_NUMBER__": "{constituencyNumber}",
    "__CONSTITUENCY_NUMBER_PADDED__": "{constituencyNumberPadded}",
    "__CONSTITUENCY_ID__": "{constituencyId}"
  };
  let protectedValue = value
    .replaceAll("{constituencyNumberPadded}", "__CONSTITUENCY_NUMBER_PADDED__")
    .replaceAll("{constituencyNumber}", "__CONSTITUENCY_NUMBER__")
    .replaceAll("{constituencyId}", "__CONSTITUENCY_ID__");
  protectedValue = new URL(protectedValue, `${sourceConfig.baseUrl.replace(/\/+$/, "")}/`).toString();
  for (const [token, placeholder] of Object.entries(placeholders)) {
    protectedValue = protectedValue.replaceAll(token, placeholder);
  }
  return protectedValue;
}

function defaultSourceConfig(): SourceConfig {
  return {
    baseUrl: config.ECI_BASE_URL,
    constituencyListUrl: config.ECI_CONSTITUENCY_LIST_URL,
    candidateDetailUrlTemplate: config.ECI_CANDIDATE_DETAIL_URL_TEMPLATE,
    refreshIntervalSeconds: 30,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "environment"
  };
}

function migrateSourceConfig(): SourceConfig {
  return defaultSourceConfig();
}
