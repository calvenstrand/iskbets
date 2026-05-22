import { Redis } from "@upstash/redis";
import { stockholmMondayOfWeek } from "./dateUtil";
import type { MockMode } from "./mockData";
import type {
  AnalysisPayload,
  Brief,
  DailyResult,
  DashboardData,
  PublicStoredData,
  StockPrice,
  StoredData,
  WeeklyChampion,
  WeeklyResult,
  WeekStartSnapshot,
} from "./types";

const KV_KEY = "iskbets:snapshot";
const ATTEMPT_KEY = "iskbets:lastAttempt";
const MORNING_BRIEF_KEY = "iskbets:morningBrief";
const EVENING_BRIEF_KEY = "iskbets:eveningBrief";
const WEEKEND_BRIEF_KEY = "iskbets:weekendWire";
const YESTERDAY_KEY = "iskbets:yesterday";
const WEEK_START_KEY = "iskbets:weekStart";
const ARCHIVE_KEY = "iskbets:archive"; // Redis hash, fields = weekStart dates
const DAILY_ARCHIVE_KEY = "iskbets:dailyArchive"; // Redis hash, fields = YYYY-MM-DD
const WEEKLY_CHAMPION_KEY = "iskbets:weeklyChampion";

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

// ============== Weekly archive (long-term history) ==============

/**
 * Stored as a Redis hash where field name = `weekStart` (YYYY-MM-DD)
 * and value = the WeeklyResult JSON. Idempotent per week — re-archiving
 * the same week overwrites the previous entry.
 *
 * Why a hash? O(1) get/set per week, single HGETALL pulls every week,
 * no separate index list to maintain. With 52 weekly entries at ~3KB
 * each the hash sits at ~150KB — well under any Upstash limit.
 */

export async function getWeeklyResult(
  weekStart: string,
): Promise<WeeklyResult | null> {
  const v = await getRedis().hget<WeeklyResult>(ARCHIVE_KEY, weekStart);
  return v ?? null;
}

export async function setWeeklyResult(result: WeeklyResult): Promise<void> {
  await getRedis().hset(ARCHIVE_KEY, { [result.weekStart]: result });
}

/**
 * All archived weeks, sorted DESC by `weekStart` (newest first).
 * Optional `limit` caps the result for callers that only want the
 * recent N weeks (e.g. a future history graph would just want ~12).
 */
export async function listWeeklyResults(
  limit?: number,
): Promise<WeeklyResult[]> {
  if (shouldUseMock().use) {
    const { getMockWeeklyResults } = await import("./mockData");
    const all = getMockWeeklyResults();
    return limit ? all.slice(0, limit) : all;
  }
  const all = await getRedis().hgetall<Record<string, WeeklyResult>>(
    ARCHIVE_KEY,
  );
  if (!all) return [];
  const sorted = Object.values(all).sort((a, b) =>
    b.weekStart.localeCompare(a.weekStart),
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

// ============== Weekly champion (the WTD leader's recap) ==============

export async function getWeeklyChampion(): Promise<WeeklyChampion | null> {
  if (shouldUseMock().use) {
    const { getMockWeeklyChampion } = await import("./mockData");
    return getMockWeeklyChampion();
  }
  const v = await getRedis().get<WeeklyChampion>(WEEKLY_CHAMPION_KEY);
  return v ?? null;
}

export async function setWeeklyChampion(
  champion: WeeklyChampion,
): Promise<void> {
  await getRedis().set(WEEKLY_CHAMPION_KEY, champion);
}

// ============== Daily archive (per-trading-day history) ==============

/**
 * Same hash pattern as the weekly archive, finer granularity. Field
 * name = `date` (YYYY-MM-DD STO). Idempotent per trading day. Holiday
 * Mondays will store a duplicate of the previous Friday's close — that
 * can be filtered downstream by detecting zero `changePct` across the
 * board if a future feature needs strict trading-day filtering.
 */

export async function getDailyResult(
  date: string,
): Promise<DailyResult | null> {
  const v = await getRedis().hget<DailyResult>(DAILY_ARCHIVE_KEY, date);
  return v ?? null;
}

export async function setDailyResult(result: DailyResult): Promise<void> {
  await getRedis().hset(DAILY_ARCHIVE_KEY, { [result.date]: result });
}

/** All archived days, sorted DESC by `date` (newest first). */
export async function listDailyResults(
  limit?: number,
): Promise<DailyResult[]> {
  if (shouldUseMock().use) {
    const { getMockDailyResults } = await import("./mockData");
    const all = getMockDailyResults();
    return limit ? all.slice(0, limit) : all;
  }
  const all = await getRedis().hgetall<Record<string, DailyResult>>(
    DAILY_ARCHIVE_KEY,
  );
  if (!all) return [];
  const sorted = Object.values(all).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * One-shot fetch for the dashboard: snapshot + all three briefs + the
 * compact week-start price map (just ticker → price, not the full
 * snapshot — keeps the polled payload small). All in parallel.
 * Returns null only if the live snapshot is missing — everything else
 * is best-effort.
 */
export async function getDashboardData(opts?: {
  /** Dev-only preview mode; only honored when the storage layer is in
   * mock mode (no Redis creds in non-prod, or USE_MOCK_DATA=true).
   * Production calls ignore this param. */
  mode?: MockMode;
}): Promise<DashboardData | null> {
  // Mock branch: route the whole assembly through the aggregator so
  // the mode-driven preview is consistent across all pieces.
  if (shouldUseMock().use) {
    const { getMockDashboardData } = await import("./mockData");
    return getMockDashboardData(opts?.mode ?? "default");
  }

  // Evening brief intentionally not fetched — generation was removed
  // (nobody read the after-close paragraph, and the AI call was
  // ~$0.10/week with no observed engagement). Any orphaned eveningBrief
  // value still in Redis from before the removal is silently ignored.
  const [
    snapshot,
    morningBrief,
    weekendBrief,
    weekStart,
    weeklyChampion,
  ] = await Promise.all([
    getStockData(),
    getMorningBrief(),
    getWeekendBrief(),
    getWeekStartSnapshot(),
    getWeeklyChampion(),
  ]);
  if (!snapshot) return null;
  // Project weekStart down to a small ticker→price map. Saves ~80% of
  // the snapshot payload on every poll. Only include it if the stored
  // baseline is for THIS Stockholm-week's Monday — if Monday's archive
  // failed and we're holding last week's snapshot, the leaderboard's
  // WTD column would silently compare against a stale baseline and lie.
  // The trigger route's weekend-wire branch already does this same check;
  // we mirror it here so the client-side leaderboard never sees stale data.
  const thisMonday = stockholmMondayOfWeek(new Date());
  const weekStartPrices =
    weekStart && weekStart.weekStart === thisMonday
      ? Object.fromEntries(
          weekStart.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
        )
      : undefined;
  return {
    snapshot: toPublicSnapshot(snapshot),
    ...(morningBrief ? { morningBrief } : {}),
    ...(weekendBrief ? { weekendBrief } : {}),
    ...(weeklyChampion ? { weeklyChampion } : {}),
    ...(weekStartPrices ? { weekStartPrices } : {}),
  };
}

/** Drop trigger-route bookkeeping fields before exposing the snapshot
 * to the frontend / public API. See PublicStoredData docstring. */
function toPublicSnapshot(snapshot: StoredData): PublicStoredData {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lastFetch: _lastFetch,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    analyzedAt: _analyzedAt,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pricesAtLastAnalysis: _pricesAtLastAnalysis,
    ...publicFields
  } = snapshot;
  return publicFields;
}
