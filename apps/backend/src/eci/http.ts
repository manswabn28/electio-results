import { config } from "../config.js";
import { logger } from "../logger.js";

let activeRequests = 0;
let lastRequestStartedAt = 0;
let backoffUntil = 0;
let consecutiveFailures = 0;
const queue: Array<() => void> = [];

async function withEciSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await task();
  } finally {
    activeRequests -= 1;
    queue.shift()?.();
  }
}

function acquireSlot(): Promise<void> {
  if (activeRequests < config.ECI_MAX_CONCURRENCY) {
    activeRequests += 1;
    return waitForSpacing();
  }

  return new Promise((resolve) => {
    queue.push(async () => {
      activeRequests += 1;
      await waitForSpacing();
      resolve();
    });
  });
}

async function waitForSpacing(): Promise<void> {
  const waitMs = Math.max(0, config.ECI_REQUEST_SPACING_MS - (Date.now() - lastRequestStartedAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestStartedAt = Date.now();
}

export async function fetchHtml(url: string): Promise<string> {
  if (Date.now() < backoffUntil) {
    throw Object.assign(new Error(`ECI backoff active until ${new Date(backoffUntil).toISOString()}`), {
      code: "ECI_BACKOFF_ACTIVE",
      statusCode: 503
    });
  }

  return withEciSlot(() => fetchHtmlUnqueued(url));
}

async function fetchHtmlUnqueued(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
        "cache-control": "no-cache",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "upgrade-insecure-requests": "1",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`ECI request failed ${response.status} ${response.statusText} for ${url}`);
    }

    const html = await response.text();
    assertLooksLikeEciHtml(html, url);
    registerEciSuccess();
    return html;
  } catch (error) {
    registerEciFailure(error, url);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertLooksLikeEciHtml(html: string, url: string): void {
  const normalized = html.slice(0, 5000).toLowerCase();
  const blocked =
    normalized.includes("cloudflare") ||
    normalized.includes("checking your browser") ||
    normalized.includes("attention required") ||
    normalized.includes("captcha") ||
    normalized.includes("access denied");

  if (blocked) {
    throw Object.assign(new Error(`ECI returned a blocked/verification page for ${url}`), {
      code: "ECI_BLOCKED",
      statusCode: 503
    });
  }

  if (!/<html|<table|cand-box|custom-table|grid-box/i.test(html)) {
    throw Object.assign(new Error(`ECI returned unexpected HTML for ${url}`), {
      code: "ECI_UNEXPECTED_HTML",
      statusCode: 502
    });
  }
}

function registerEciSuccess(): void {
  consecutiveFailures = 0;
  backoffUntil = 0;
}

function registerEciFailure(error: unknown, url: string): void {
  consecutiveFailures += 1;
  const backoffSeconds = Math.min(
    config.ECI_BACKOFF_MAX_SECONDS,
    config.ECI_BACKOFF_BASE_SECONDS * Math.max(1, consecutiveFailures)
  );
  backoffUntil = Date.now() + backoffSeconds * 1000;
  logger.warn(
    {
      url,
      consecutiveFailures,
      backoffSeconds,
      error: error instanceof Error ? { message: error.message, name: error.name } : error
    },
    "ECI fetch failed; temporary backoff enabled"
  );
}
