import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4100),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  ECI_BASE_URL: z.string().url().default("https://results.eci.gov.in"),
  ECI_CONSTITUENCY_LIST_URL: z.string().optional().default("https://results.eci.gov.in/ResultAcGenNov2025/statewiseS041.htm"),
  ECI_CANDIDATE_DETAIL_URL_TEMPLATE: z.string().optional().default("https://results.eci.gov.in/ResultAcGenNov2025/candidateswise-S04{constituencyNumber}.htm"),
  ECI_ELECTION_PATH: z.string().optional().default(""),
  ECI_KERALA_STATE_PAGE: z.string().optional().default(""),
  ECI_KERALA_STATE_CODE: z.string().optional().default(""),
  CACHE_TTL_SECONDS: z.coerce.number().min(5).max(300).default(8),
  ECI_MAX_CONCURRENCY: z.coerce.number().min(1).max(10).default(4),
  ECI_REQUEST_SPACING_MS: z.coerce.number().min(0).max(2000).default(150),
  ECI_BACKOFF_BASE_SECONDS: z.coerce.number().min(5).max(120).default(15),
  ECI_BACKOFF_MAX_SECONDS: z.coerce.number().min(10).max(600).default(90),
  DEFAULT_FAVORITES: z.string().default("thrissur,ernakulam,palakkad,nemom"),
  REQUEST_TIMEOUT_MS: z.coerce.number().min(3000).max(30000).default(12000),
  PREWARM_INTERVAL_SECONDS: z.coerce.number().min(2).max(300).default(6),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(""),
  TELEGRAM_ALERT_INTERVAL_SECONDS: z.coerce.number().min(5).max(300).default(20)
});

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  defaultFavoriteIds: parsed.DEFAULT_FAVORITES.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  sourceConfigured: Boolean(parsed.ECI_ELECTION_PATH || parsed.ECI_KERALA_STATE_PAGE)
};

export function resolveEciUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = config.ECI_BASE_URL.replace(/\/+$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

export function configuredElectionRoot(): string | undefined {
  if (!config.ECI_ELECTION_PATH) return undefined;
  const path = config.ECI_ELECTION_PATH.endsWith("/")
    ? config.ECI_ELECTION_PATH
    : `${config.ECI_ELECTION_PATH}/`;
  return resolveEciUrl(path);
}
