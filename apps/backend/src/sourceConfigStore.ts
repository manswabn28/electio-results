import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectionSourceProfile, PublicSourceConfig, SourceConfig } from "@kerala-election/shared";
import { z } from "zod";
import { config } from "./config.js";

const sourceConfigSchema = z.object({
  baseUrl: z.string().url(),
  constituencyListUrl: z.string().min(1),
  candidateDetailUrlTemplate: z.string().min(1).refine((value) => value.includes("{constituencyNumber}") || value.includes("{constituencyNumberPadded}"), {
    message: "Template must include {constituencyNumber} or {constituencyNumberPadded}."
  }),
  refreshIntervalSeconds: z.coerce.number().int().min(5).max(300),
  updatedAt: z.string(),
  updatedBy: z.string(),
  activeProfileId: z.string().optional(),
  profiles: z.array(z.object({
    profileId: z.string(),
    stateName: z.string(),
    electionTitle: z.string(),
    eventFolderUrl: z.string(),
    constituencyListUrl: z.string(),
    candidateDetailUrlTemplate: z.string(),
    partySummaryUrl: z.string().optional(),
    constituencyCount: z.number(),
    confidence: z.number(),
    sampleVerified: z.boolean(),
    enabled: z.boolean(),
    updatedAt: z.string()
  })).optional()
});

const dataDir = path.resolve(process.cwd(), "data");
const configPath = path.join(dataDir, "source-config.json");
const previousConfigPath = path.join(dataDir, "source-config.previous.json");

export async function getSourceConfig(): Promise<SourceConfig> {
  try {
    const file = await readFile(configPath, "utf8");
    return withDefaultProfile(sourceConfigSchema.parse(JSON.parse(file)));
  } catch {
    return migrateSourceConfig();
  }
}

export async function getEffectiveSourceConfig(profileId?: string): Promise<SourceConfig> {
  const sourceConfig = await getSourceConfig();
  const profile = findProfile(sourceConfig, profileId ?? sourceConfig.activeProfileId);
  if (!profile) return sourceConfig;
  return {
    ...sourceConfig,
    baseUrl: new URL(profile.constituencyListUrl).origin,
    constituencyListUrl: profile.constituencyListUrl,
    candidateDetailUrlTemplate: profile.candidateDetailUrlTemplate,
    activeProfileId: profile.profileId
  };
}

export async function updateSourceConfig(input: {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  refreshIntervalSeconds: number;
  updatedBy?: string;
}): Promise<SourceConfig> {
  const candidateDetailUrlTemplate = normalizeCandidateTemplate(input.candidateDetailUrlTemplate.trim());
  const next = sourceConfigSchema.parse({
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    constituencyListUrl: input.constituencyListUrl.trim(),
    candidateDetailUrlTemplate,
    refreshIntervalSeconds: input.refreshIntervalSeconds,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy?.trim() || "admin",
    profiles: [
      makeProfile({
        stateName: inferStateName(input.constituencyListUrl),
        constituencyListUrl: input.constituencyListUrl.trim(),
        candidateDetailUrlTemplate,
        constituencyCount: 0,
        confidence: 100,
        sampleVerified: true
      })
    ],
    activeProfileId: makeProfileId(inferStateName(input.constituencyListUrl), input.constituencyListUrl.trim())
  });
  await savePreviousConfig();
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function updateSourceProfiles(profiles: ElectionSourceProfile[], activeProfileId?: string, updatedBy = "auto-discovery"): Promise<SourceConfig> {
  const current = await getSourceConfig();
  const enabledProfiles = profiles
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      ...profile,
      candidateDetailUrlTemplate: normalizeCandidateTemplate(profile.candidateDetailUrlTemplate)
    }))
    .filter((profile) => profile.candidateDetailUrlTemplate.includes("{constituencyNumber}") || profile.candidateDetailUrlTemplate.includes("{constituencyNumberPadded}"));
  const active = findProfile({ ...current, profiles: enabledProfiles }, activeProfileId) ?? findKeralaProfile(enabledProfiles) ?? enabledProfiles[0];
  if (!active) return current;
  const activeTemplate = normalizeCandidateTemplate(active.candidateDetailUrlTemplate);
  const next = sourceConfigSchema.parse({
    ...current,
    baseUrl: new URL(active.constituencyListUrl).origin,
    constituencyListUrl: active.constituencyListUrl,
    candidateDetailUrlTemplate: activeTemplate,
    activeProfileId: active.profileId,
    profiles: enabledProfiles.map((profile) => profile.profileId === active.profileId ? { ...profile, candidateDetailUrlTemplate: activeTemplate } : profile),
    updatedAt: new Date().toISOString(),
    updatedBy
  });
  await savePreviousConfig(current);
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function revertSourceConfig(): Promise<SourceConfig> {
  const file = await readFile(previousConfigPath, "utf8").catch(() => undefined);
  if (!file) {
    throw Object.assign(new Error("No previous source configuration is available to restore."), { statusCode: 404, code: "NO_PREVIOUS_SOURCE_CONFIG" });
  }
  const previous = withDefaultProfile(sourceConfigSchema.parse(JSON.parse(file)));
  await savePreviousConfig(await getSourceConfig());
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(previous, null, 2), "utf8");
  return previous;
}

export async function hasPreviousSourceConfig(): Promise<boolean> {
  return Boolean(await readFile(previousConfigPath, "utf8").catch(() => ""));
}

export async function setActiveSourceProfile(profileId: string): Promise<SourceConfig> {
  const current = await getSourceConfig();
  const active = findProfile(current, profileId);
  if (!active) {
    throw Object.assign(new Error("Requested source profile was not found."), { statusCode: 404, code: "PROFILE_NOT_FOUND" });
  }
  const next = sourceConfigSchema.parse({
    ...current,
    baseUrl: new URL(active.constituencyListUrl).origin,
    constituencyListUrl: active.constituencyListUrl,
    candidateDetailUrlTemplate: active.candidateDetailUrlTemplate,
    activeProfileId: active.profileId,
    updatedAt: new Date().toISOString(),
    updatedBy: "profile-switch"
  });
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function toPublicSourceConfig(sourceConfig: SourceConfig): PublicSourceConfig {
  const active = findProfile(sourceConfig, sourceConfig.activeProfileId);
  return {
    ...sourceConfig,
    activeTitle: active?.electionTitle ?? deriveElectionTitle(sourceConfig.constituencyListUrl, active?.stateName),
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

export function normalizeCandidateTemplate(value: string): string {
  const decoded = value
    .replace(/%7BconstituencyNumber%7D/gi, "{constituencyNumber}")
    .replace(/%7BconstituencyNumberPadded%7D/gi, "{constituencyNumberPadded}")
    .replace(/%7BconstituencyId%7D/gi, "{constituencyId}");
  if (decoded.includes("{constituencyNumber}") || decoded.includes("{constituencyNumberPadded}")) return decoded;
  return decoded
    .replace(/(candidateswise-S\d{2})(\d{1,3})(\.html?)$/i, "$1{constituencyNumber}$3")
    .replace(/(ConstituencywiseS\d{2})(\d{1,3})(\.html?)$/i, "$1{constituencyNumber}$3")
    .replace(/(\d{1,3})(\.html?)$/i, "{constituencyNumber}$2");
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
  return withDefaultProfile({
    baseUrl: config.ECI_BASE_URL,
    constituencyListUrl: config.ECI_CONSTITUENCY_LIST_URL,
    candidateDetailUrlTemplate: config.ECI_CANDIDATE_DETAIL_URL_TEMPLATE,
    refreshIntervalSeconds: 30,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "environment"
  });
}

function migrateSourceConfig(): SourceConfig {
  return defaultSourceConfig();
}

async function savePreviousConfig(sourceConfig?: SourceConfig): Promise<void> {
  const current = sourceConfig ?? await getSourceConfig().catch(() => undefined);
  if (!current) return;
  await mkdir(dataDir, { recursive: true });
  await writeFile(previousConfigPath, JSON.stringify(current, null, 2), "utf8");
}

function withDefaultProfile(sourceConfig: SourceConfig): SourceConfig {
  if (sourceConfig.profiles?.length && sourceConfig.activeProfileId) return sourceConfig;
  const profile = makeProfile({
    stateName: inferStateName(sourceConfig.constituencyListUrl),
    constituencyListUrl: sourceConfig.constituencyListUrl,
    candidateDetailUrlTemplate: sourceConfig.candidateDetailUrlTemplate,
    constituencyCount: 0,
    confidence: 100,
    sampleVerified: true
  });
  return {
    ...sourceConfig,
    activeProfileId: sourceConfig.activeProfileId ?? profile.profileId,
    profiles: sourceConfig.profiles?.length ? sourceConfig.profiles : [profile]
  };
}

export function makeProfile(input: {
  stateName: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  eventFolderUrl?: string;
  partySummaryUrl?: string;
  constituencyCount: number;
  confidence: number;
  sampleVerified: boolean;
  electionTitle?: string;
}): ElectionSourceProfile {
  const stateName = input.stateName || inferStateName(input.constituencyListUrl);
  return {
    profileId: makeProfileId(stateName, input.constituencyListUrl),
    stateName,
    electionTitle: input.electionTitle ?? deriveElectionTitle(input.constituencyListUrl, stateName),
    eventFolderUrl: input.eventFolderUrl ?? new URL("./", input.constituencyListUrl).toString(),
    constituencyListUrl: input.constituencyListUrl,
    candidateDetailUrlTemplate: input.candidateDetailUrlTemplate,
    partySummaryUrl: input.partySummaryUrl,
    constituencyCount: input.constituencyCount,
    confidence: input.confidence,
    sampleVerified: input.sampleVerified,
    enabled: true,
    updatedAt: new Date().toISOString()
  };
}

function findProfile(sourceConfig: Pick<SourceConfig, "profiles">, profileId?: string) {
  if (!profileId) return undefined;
  return sourceConfig.profiles?.find((profile) => profile.profileId === profileId && profile.enabled);
}

function findKeralaProfile(profiles: ElectionSourceProfile[]) {
  return profiles.find((profile) => /kerala/i.test(profile.stateName));
}

function makeProfileId(stateName: string, url: string) {
  const slug = (stateName || "assembly").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const folder = url.match(/results\.eci\.gov\.in\/([^/]+)/i)?.[1]?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "eci";
  return `${slug || "assembly"}-${folder}`;
}

function inferStateName(url: string) {
  if (/resultacgennov2025/i.test(url)) return "Bihar";
  if (/kerala/i.test(url)) return "Kerala";
  return "Kerala";
}

function deriveElectionTitle(url: string, stateName = inferStateName(url)) {
  if (/resultacgennov2025/i.test(url)) return "Bihar Assembly Election 2025";
  if (/acresultgenjune2024/i.test(url)) return `${stateName} Assembly Election June 2024`;
  if (/2026/i.test(url) || /kerala/i.test(stateName)) return `${stateName} Assembly Election 2026`;
  return `${stateName} Assembly Election Results`;
}
