import { Redis } from "@upstash/redis";
import type {
  AnalysisPayload,
  Brief,
  DashboardData,
  StockPrice,
  StoredData,
  WeekStartSnapshot,
} from "./types";

const KV_KEY = "iskbets:snapshot";
const ATTEMPT_KEY = "iskbets:lastAttempt";
const MORNING_BRIEF_KEY = "iskbets:morningBrief";
const EVENING_BRIEF_KEY = "iskbets:eveningBrief";
const WEEKEND_BRIEF_KEY = "iskbets:weekendWire";
const YESTERDAY_KEY = "iskbets:yesterday";
const WEEK_START_KEY = "iskbets:weekStart";

function readCreds(): { url: string | undefined; token: string | undefined } {
  // Support both env name conventions:
  //   UPSTASH_REDIS_REST_URL / _TOKEN — modern Marketplace integration
  //   KV_REST_API_URL / _TOKEN        — legacy @vercel/kv integration
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return { url, token };
}

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (_redis) return _redis;
  const { url, token } = readCreds();
  if (!url || !token) {
    throw new Error(
      "Redis not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN " +
        "(or the legacy KV_REST_API_URL and KV_REST_API_TOKEN).",
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

function shouldUseMock(): { use: boolean; reason: string } {
  if (process.env.USE_MOCK_DATA === "true") {
    return { use: true, reason: "USE_MOCK_DATA=true" };
  }
  // Zero-config dev: if Redis creds are missing and we're not in production,
  // fall back to mock so the dashboard renders without any setup.
  const { url, token } = readCreds();
  const configured = !!url && !!token;
  if (!configured && process.env.NODE_ENV !== "production") {
    return { use: true, reason: "no Redis creds in non-production env" };
  }
  return { use: false, reason: "" };
}

export async function saveStockData(args: {
  stocks: StockPrice[];
  analysis: AnalysisPayload;
  /** When the AI was last regenerated. Carried over if AI didn't run this turn. */
  analyzedAt: number;
  /** Snapshot used as the diff baseline for the next trigger. */
  pricesAtLastAnalysis: StockPrice[];
}): Promise<StoredData> {
  const now = Date.now();
  const data: StoredData = {
    stocks: args.stocks,
    analysis: args.analysis,
    updatedAt: new Date(now).toISOString(),
    lastFetch: now,
    analyzedAt: args.analyzedAt,
    pricesAtLastAnalysis: args.pricesAtLastAnalysis,
  };
  console.log(`[storage] saving snapshot at ${data.updatedAt}`);
  await getRedis().set(KV_KEY, data);
  return data;
}

export async function getStockData(): Promise<StoredData | null> {
  const mock = shouldUseMock();
  if (mock.use) {
    console.log(`[storage] returning mock data (${mock.reason})`);
    const { getMockData } = await import("./mockData");
    return getMockData();
  }
  const data = await getRedis().get<StoredData>(KV_KEY);
  return data ?? null;
}

/**
 * Returns the epoch ms of the most recent /api/trigger attempt — success
 * OR failure. Used for cooldown gating so a failing pipeline can't be
 * hammered. Returns 0 if no attempt has been recorded yet.
 */
export async function getLastAttempt(): Promise<number> {
  const v = await getRedis().get<number>(ATTEMPT_KEY);
  return v ?? 0;
}

/**
 * Records "we tried at this moment". Called BEFORE the pipeline runs in
 * the trigger route, so the cooldown applies even if fetchPrices or
 * analyzeStocks throws midway.
 */
export async function markAttempt(): Promise<void> {
  await getRedis().set(ATTEMPT_KEY, Date.now());
}

// ============== Briefs ==============

export async function getMorningBrief(): Promise<Brief | null> {
  if (shouldUseMock().use) {
    const { getMockMorningBrief } = await import("./mockData");
    return getMockMorningBrief();
  }
  const v = await getRedis().get<Brief>(MORNING_BRIEF_KEY);
  return v ?? null;
}

export async function setMorningBrief(brief: Brief): Promise<void> {
  await getRedis().set(MORNING_BRIEF_KEY, brief);
}

export async function getEveningBrief(): Promise<Brief | null> {
  if (shouldUseMock().use) {
    const { getMockEveningBrief } = await import("./mockData");
    return getMockEveningBrief();
  }
  const v = await getRedis().get<Brief>(EVENING_BRIEF_KEY);
  return v ?? null;
}

export async function setEveningBrief(brief: Brief): Promise<void> {
  await getRedis().set(EVENING_BRIEF_KEY, brief);
}

/**
 * Snapshot taken at evening-brief time — what the morning brief reads from.
 * Capped at one day; overwritten each evening.
 */
export async function getYesterdaySnapshot(): Promise<StoredData | null> {
  const v = await getRedis().get<StoredData>(YESTERDAY_KEY);
  return v ?? null;
}

export async function setYesterdaySnapshot(data: StoredData): Promise<void> {
  await getRedis().set(YESTERDAY_KEY, data);
}

// ============== Weekend Wire (weekly recap brief) ==============

export async function getWeekendBrief(): Promise<Brief | null> {
  if (shouldUseMock().use) {
    const { getMockWeekendBrief } = await import("./mockData");
    return getMockWeekendBrief();
  }
  const v = await getRedis().get<Brief>(WEEKEND_BRIEF_KEY);
  return v ?? null;
}

export async function setWeekendBrief(brief: Brief): Promise<void> {
  await getRedis().set(WEEKEND_BRIEF_KEY, brief);
}

// ============== Week-start snapshot (leaderboard WTD baseline) ==============

/**
 * Baseline snapshot for the trading week — written by the first Monday
 * trigger and read by both the leaderboard (WTD column) and the Weekend
 * Wire (week-over-week recap).
 */
export async function getWeekStartSnapshot(): Promise<WeekStartSnapshot | null> {
  if (shouldUseMock().use) {
    const { getMockWeekStartSnapshot } = await import("./mockData");
    return getMockWeekStartSnapshot();
  }
  const v = await getRedis().get<WeekStartSnapshot>(WEEK_START_KEY);
  return v ?? null;
}

export async function setWeekStartSnapshot(
  data: WeekStartSnapshot,
): Promise<void> {
  await getRedis().set(WEEK_START_KEY, data);
}

/**
 * One-shot fetch for the dashboard: snapshot + all three briefs + the
 * compact week-start price map (just ticker → price, not the full
 * snapshot — keeps the polled payload small). All in parallel.
 * Returns null only if the live snapshot is missing — everything else
 * is best-effort.
 */
export async function getDashboardData(): Promise<DashboardData | null> {
  const [snapshot, morningBrief, eveningBrief, weekendBrief, weekStart] =
    await Promise.all([
      getStockData(),
      getMorningBrief(),
      getEveningBrief(),
      getWeekendBrief(),
      getWeekStartSnapshot(),
    ]);
  if (!snapshot) return null;
  // Project weekStart down to a small ticker→price map. Saves ~80% of
  // the snapshot payload on every poll.
  const weekStartPrices = weekStart
    ? Object.fromEntries(
        weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
      )
    : undefined;
  return {
    snapshot,
    ...(morningBrief ? { morningBrief } : {}),
    ...(eveningBrief ? { eveningBrief } : {}),
    ...(weekendBrief ? { weekendBrief } : {}),
    ...(weekStartPrices ? { weekStartPrices } : {}),
  };
}
