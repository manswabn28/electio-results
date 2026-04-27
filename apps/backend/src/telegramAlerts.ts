import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type {
  ConstituencySummary,
  ElectionSourceProfile,
  PartySeatSummary,
  TelegramAlertRules,
  TelegramSubscriptionLinkResponse,
  TelegramSubscriptionStatusResponse
} from "@kerala-election/shared";
import { config } from "./config.js";
import { getConstituencies, getPartySummary, getSummary } from "./eci/service.js";
import { logger } from "./logger.js";
import { getSourceConfig } from "./sourceConfigStore.js";

const dataDir = path.resolve(process.cwd(), "data");
const storePath = path.join(dataDir, "telegram-alerts.json");
const DEFAULT_RULES: TelegramAlertRules = {
  leadChange: true,
  winnerDeclared: true,
  marginBelow500: true,
  majorityCrossed: true
};
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

type TelegramSubscription = {
  viewerId: string;
  profileId: string;
  chatId: string;
  chatLabel: string;
  selectedIds: string[];
  watchedCandidateIds: string[];
  rules: TelegramAlertRules;
  createdAt: string;
  verifiedAt: string;
};

type PendingSubscription = {
  code: string;
  viewerId: string;
  profileId: string;
  selectedIds: string[];
  watchedCandidateIds: string[];
  rules: TelegramAlertRules;
  createdAt: string;
};

type TelegramStore = {
  subscriptions: TelegramSubscription[];
  pending: PendingSubscription[];
  lastUpdateId?: number;
  lastAlertAtByKey?: Record<string, string>;
};

let pollTimer: NodeJS.Timeout | undefined;
let alertTimer: NodeJS.Timeout | undefined;
let polling = false;
let checkingAlerts = false;
const previousLeadersByProfile = new Map<string, Map<string, string>>();
const previousDeclaredByProfile = new Map<string, Set<string>>();
const previousMajorityByProfile = new Map<string, string>();

export function telegramEnabled() {
  return Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_BOT_USERNAME);
}

export async function createTelegramSubscriptionLink(input: {
  viewerId: string;
  profileId: string;
  selectedIds: string[];
  watchedCandidateIds?: string[];
  rules?: Partial<TelegramAlertRules>;
}): Promise<TelegramSubscriptionLinkResponse> {
  if (!telegramEnabled()) {
    return {
      generatedAt: new Date().toISOString(),
      enabled: false,
      linked: false
    };
  }

  const store = await readStore();
  const existing = findSubscription(store, input.viewerId, input.profileId);
  if (existing) {
    return {
      generatedAt: new Date().toISOString(),
      enabled: true,
      linked: true,
      botUsername: config.TELEGRAM_BOT_USERNAME,
      botUrl: `https://t.me/${config.TELEGRAM_BOT_USERNAME}`,
      pendingCode: undefined
    };
  }

  const code = randomBytes(16).toString("hex");
  const pending: PendingSubscription = {
    code,
    viewerId: input.viewerId.trim(),
    profileId: input.profileId.trim(),
    selectedIds: [...new Set(input.selectedIds.map((item) => item.trim()).filter(Boolean))],
    watchedCandidateIds: [...new Set((input.watchedCandidateIds ?? []).map((item) => item.trim()).filter(Boolean))],
    rules: { ...DEFAULT_RULES, ...(input.rules ?? {}) },
    createdAt: new Date().toISOString()
  };
  store.pending = [pending, ...store.pending.filter((item) => item.viewerId !== pending.viewerId || item.profileId !== pending.profileId)].slice(0, 500);
  await writeStore(store);

  return {
    generatedAt: new Date().toISOString(),
    enabled: true,
    linked: false,
    botUsername: config.TELEGRAM_BOT_USERNAME,
    botUrl: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${code}`,
    pendingCode: code
  };
}

export async function getTelegramSubscriptionStatus(viewerId: string, profileId: string): Promise<TelegramSubscriptionStatusResponse> {
  const store = await readStore();
  const subscription = findSubscription(store, viewerId, profileId);
  return {
    generatedAt: new Date().toISOString(),
    enabled: telegramEnabled(),
    botUsername: config.TELEGRAM_BOT_USERNAME || undefined,
    linked: Boolean(subscription),
    viewerId,
    profileId,
    chatId: subscription?.chatId,
    chatLabel: subscription?.chatLabel,
    rules: subscription?.rules,
    selectedCount: subscription?.selectedIds.length
  };
}

export function startTelegramAlerts(): void {
  if (!telegramEnabled()) {
    logger.info("Telegram alerts disabled; bot token or username not configured");
    return;
  }
  if (!pollTimer) {
    void pollTelegramUpdates();
    pollTimer = setInterval(() => {
      void pollTelegramUpdates();
    }, 8000);
  }
  if (!alertTimer) {
    void runAlertChecks();
    alertTimer = setInterval(() => {
      void runAlertChecks();
    }, config.TELEGRAM_ALERT_INTERVAL_SECONDS * 1000);
  }
}

async function pollTelegramUpdates(): Promise<void> {
  if (polling || !telegramEnabled()) return;
  polling = true;
  try {
    const store = await readStore();
    const url = new URL(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getUpdates`);
    if (store.lastUpdateId) url.searchParams.set("offset", String(store.lastUpdateId + 1));
    url.searchParams.set("timeout", "0");
    const response = await fetch(url.toString());
    const body = await response.json() as { ok?: boolean; result?: Array<{ update_id: number; message?: { text?: string; chat?: { id: number | string; type?: string; title?: string; username?: string; first_name?: string; last_name?: string } } }> };
    if (!body.ok || !Array.isArray(body.result)) return;

    let latestUpdateId = store.lastUpdateId ?? 0;
    for (const update of body.result) {
      latestUpdateId = Math.max(latestUpdateId, update.update_id);
      const text = update.message?.text?.trim() ?? "";
      const chat = update.message?.chat;
      if (!text.startsWith("/start") || !chat) continue;
      const code = text.split(/\s+/, 2)[1]?.trim();
      if (!code) {
        await sendTelegramMessage(String(chat.id), "Welcome to OneKerala Results alerts. Please open the app and tap the Telegram alerts button to link your watchlist.");
        continue;
      }
      const pending = store.pending.find((item) => item.code === code);
      if (!pending) {
        await sendTelegramMessage(String(chat.id), "This alert link is no longer valid. Please open the app and request a fresh Telegram link.");
        continue;
      }
      const subscription: TelegramSubscription = {
        viewerId: pending.viewerId,
        profileId: pending.profileId,
        chatId: String(chat.id),
        chatLabel: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Telegram chat",
        selectedIds: pending.selectedIds,
        watchedCandidateIds: pending.watchedCandidateIds,
        rules: pending.rules,
        createdAt: pending.createdAt,
        verifiedAt: new Date().toISOString()
      };
      store.subscriptions = [
        subscription,
        ...store.subscriptions.filter((item) => !(item.viewerId === subscription.viewerId && item.profileId === subscription.profileId))
      ].slice(0, 2000);
      store.pending = store.pending.filter((item) => item.code !== code);
      await sendTelegramMessage(
        subscription.chatId,
        `OneKerala alerts linked for ${subscription.profileId}.\nWatching ${subscription.selectedIds.length} seat(s).\nYou will receive lead changes, winners, close-margin alerts, and majority-crossing alerts based on your selection.`
      );
    }

    if (latestUpdateId !== (store.lastUpdateId ?? 0)) {
      store.lastUpdateId = latestUpdateId;
      await writeStore(store);
    }
  } catch (error) {
    logger.warn({ error }, "Telegram update polling failed");
  } finally {
    polling = false;
  }
}

async function runAlertChecks(): Promise<void> {
  if (checkingAlerts || !telegramEnabled()) return;
  checkingAlerts = true;
  try {
    const store = await readStore();
    if (!store.subscriptions.length) return;
    const profiles = profileIdsFromStore(store);
    for (const profile of profiles) {
      await checkProfileAlerts(profile, store);
    }
    await writeStore(store);
  } catch (error) {
    logger.warn({ error }, "Telegram alert pass failed");
  } finally {
    checkingAlerts = false;
  }
}

async function checkProfileAlerts(profileId: string, store: TelegramStore): Promise<void> {
  const constituencyResponse = await getConstituencies(profileId);
  const ids = constituencyResponse.constituencies.map((item) => item.constituencyId);
  if (!ids.length) return;
  const summaryResponse = await getSummary(ids, profileId);
  const partyResponse = await getPartySummary(profileId).catch(() => undefined);
  const summaries = summaryResponse.results;
  const summaryMap = new Map(summaries.map((summary) => [summary.constituencyId, summary]));
  const previousLeaders = previousLeadersByProfile.get(profileId) ?? new Map<string, string>();
  const previousDeclared = previousDeclaredByProfile.get(profileId) ?? new Set<string>();
  const subscriptions = store.subscriptions.filter((item) => item.profileId === profileId);

  for (const subscription of subscriptions) {
    for (const constituencyId of subscription.selectedIds) {
      const summary = summaryMap.get(constituencyId);
      if (!summary) continue;
      const previousLeader = previousLeaders.get(constituencyId) ?? "";
      const currentLeader = summary.leadingCandidate || summary.leadingParty || "";
      const declared = isDeclared(summary);
      if (subscription.rules.leadChange && previousLeader && currentLeader && previousLeader !== currentLeader) {
        await sendWithCooldown(
          store,
          `lead:${subscription.chatId}:${profileId}:${constituencyId}`,
          subscription.chatId,
          `Lead changed in ${summary.constituencyName}.\nNow: ${summary.leadingCandidate || shortParty(summary.leadingParty)} (${shortParty(summary.leadingParty)})\nMargin: ${formatNumber(summary.margin)}`
        );
      }
      if (subscription.rules.winnerDeclared && declared && !previousDeclared.has(constituencyId)) {
        await sendWithCooldown(
          store,
          `winner:${subscription.chatId}:${profileId}:${constituencyId}`,
          subscription.chatId,
          `Winner declared in ${summary.constituencyName}.\n${summary.leadingCandidate || shortParty(summary.leadingParty)} (${shortParty(summary.leadingParty)}) wins by ${formatNumber(summary.margin)} votes.`
        );
      }
      if (subscription.rules.marginBelow500 && summary.margin > 0 && summary.margin <= 500) {
        const previousMargin = previousLeader === currentLeader ? previousLeaders.get(`${constituencyId}:margin`) ?? "" : "";
        const previousNumeric = Number(previousMargin || "999999");
        if (previousNumeric > 500) {
          await sendWithCooldown(
            store,
            `margin500:${subscription.chatId}:${profileId}:${constituencyId}`,
            subscription.chatId,
            `Very tight race in ${summary.constituencyName}.\nMargin is down to ${formatNumber(summary.margin)} votes.\nLeader: ${summary.leadingCandidate || shortParty(summary.leadingParty)}`
          );
        }
        previousLeaders.set(`${constituencyId}:margin`, String(summary.margin));
      } else {
        previousLeaders.set(`${constituencyId}:margin`, String(summary.margin));
      }
    }

    if (subscription.rules.majorityCrossed && partyResponse?.parties?.length) {
      const totalSeats = partyResponse.parties.reduce((sum, party) => sum + party.total, 0);
      const majority = Math.floor(totalSeats / 2) + 1;
      const winner = [...partyResponse.parties].sort((left, right) => right.total - left.total)[0];
      const previousMajorityParty = previousMajorityByProfile.get(profileId) ?? "";
      if (winner && winner.total >= majority && previousMajorityParty !== winner.party) {
        previousMajorityByProfile.set(profileId, winner.party);
        await sendWithCooldown(
          store,
          `majority:${subscription.chatId}:${profileId}:${winner.party}`,
          subscription.chatId,
          `${shortParty(winner.party)} crosses majority in ${profileId}.\nSeats: ${formatNumber(winner.total)}\nMajority mark: ${formatNumber(majority)}`
        );
      }
    }
  }

  previousLeadersByProfile.set(profileId, new Map(summaries.map((summary) => [summary.constituencyId, summary.leadingCandidate || summary.leadingParty || ""])));
  previousDeclaredByProfile.set(profileId, new Set(summaries.filter(isDeclared).map((summary) => summary.constituencyId)));
}

async function sendWithCooldown(store: TelegramStore, key: string, chatId: string, text: string) {
  const lastSentAt = store.lastAlertAtByKey?.[key] ? Date.parse(store.lastAlertAtByKey[key]) : 0;
  if (Date.now() - lastSentAt < ALERT_COOLDOWN_MS) return;
  await sendTelegramMessage(chatId, text);
  store.lastAlertAtByKey = { ...(store.lastAlertAtByKey ?? {}), [key]: new Date().toISOString() };
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!telegramEnabled()) return;
  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.warn({ chatId, body }, "Telegram sendMessage failed");
  }
}

async function readStore(): Promise<TelegramStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as TelegramStore;
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      lastUpdateId: parsed.lastUpdateId,
      lastAlertAtByKey: parsed.lastAlertAtByKey ?? {}
    };
  } catch {
    return { subscriptions: [], pending: [], lastAlertAtByKey: {} };
  }
}

async function writeStore(store: TelegramStore): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function findSubscription(store: TelegramStore, viewerId: string, profileId: string) {
  return store.subscriptions.find((item) => item.viewerId === viewerId && item.profileId === profileId);
}

function profileIdsFromStore(store: TelegramStore) {
  return [...new Set(store.subscriptions.map((item) => item.profileId))];
}

function isDeclared(summary: ConstituencySummary) {
  return /\b(won|result\s+declared|declared)\b/i.test(summary.statusText || summary.roundStatus || "");
}

function shortParty(value: string) {
  const match = value.match(/\s-\s(.+)$/);
  return match?.[1]?.trim() ?? value;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}
