import { cache } from "react";
import { Redis } from "@upstash/redis";
import { stockholmDate, stockholmMondayOfWeek } from "./dateUtil";
import { computeMoodRecord, selectRecentMood, upsertMoodRecords } from "./mood";
import type { MockMode } from "./mockData";
import type {
  AnalysisPayload,
  DailyResult,
  DailySnapshot,
  DashboardData,
  MoodRecord,
  PublicStoredData,
  StockPrice,
  StoredData,
  WeeklyChampion,
  WeeklyResult,
  WeekStartSnapshot,
} from "./types";

const KV_KEY = "iskbets:snapshot";
const ATTEMPT_KEY = "iskbets:lastAttempt";
const WEEK_START_KEY = "iskbets:weekStart";
const ARCHIVE_KEY = "iskbets:archive"; // Redis hash, fields = weekStart dates
const DAILY_ARCHIVE_KEY = "iskbets:dailyArchive"; // Redis hash, fields = YYYY-MM-DD
const WEEKLY_CHAMPION_KEY = "iskbets:weeklyChampion";
const MOOD_HISTORY_KEY = "iskbets:moodHistory"; // JSON array of MoodRecord, oldest→newest

// Dated end-of-day history. Each day is its own string key
// `iskbets:snapshot:YYYY-MM-DD`; `iskbets:snapshot:index` is a sorted
// set of the dates that exist (score = YYYYMMDD) so history can be
// enumerated without KEYS/SCAN. Capped at SNAPSHOT_RETENTION_DAYS.
const SNAPSHOT_HISTORY_PREFIX = "iskbets:snapshot:";
const SNAPSHOT_INDEX_KEY = "iskbets:snapshot:index";
const SNAPSHOT_RETENTION_DAYS = 400;

// Deprecated keys left orphaned in Redis after the brief subsystem
// was removed. Listed here so anyone debugging stale data knows
// what they're looking at; safe to manually delete from Upstash.
//   iskbets:morningBrief
//   iskbets:eveningBrief
//   iskbets:weekendWire
//   iskbets:yesterday

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
    if (process.env.NODE_ENV === "production")
      throw new Error("USE_MOCK_DATA must not be set in production");
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
  /** When the MOOD call (Sonnet) was last regenerated. Carried over if
   * mood didn't run this turn. Optional — first deploy will not have it. */
  moodGeneratedAt?: number;
  /** Snapshot used as the diff baseline for the next mood-call decision.
   * Optional — first deploy will not have it. */
  pricesAtLastMood?: StockPrice[];
}): Promise<StoredData> {
  const now = Date.now();
  const data: StoredData = {
    stocks: args.stocks,
    analysis: args.analysis,
    updatedAt: new Date(now).toISOString(),
    lastFetch: now,
    ...(args.moodGeneratedAt !== undefined
      ? { moodGeneratedAt: args.moodGeneratedAt }
      : {}),
    ...(args.pricesAtLastMood !== undefined
      ? { pricesAtLastMood: args.pricesAtLastMood }
      : {}),
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

// ============== Week-start snapshot (leaderboard WTD baseline) ==============

/**
 * Baseline snapshot for the trading week — written by the first Monday
 * trigger and read by the leaderboard (WTD column) and the Weekly
 * Champion AI call (week-over-week recap).
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

// ============== Daily mood history (rolling, ~90-day cap) ==============

/**
 * Capture today's group + per-ticker sentiment into the rolling mood
 * history that backs the historical mood strip. UPSERT by Stockholm
 * calendar day (last-write-wins), sorted oldest→newest, capped at
 * MOOD_HISTORY_CAP — the merge/cap/sort is the pure `upsertMoodRecords`,
 * the sentiment derivation the pure `computeMoodRecord` (both in
 * lib/mood.ts, unit-tested there).
 *
 * The whole array lives under one key: it's tiny (enums + one number per
 * day, ~90 days) so a read-modify-write per trigger is cheap, and the
 * dashboard read gets it in one round-trip. Throws on Redis failure —
 * the caller (trigger route) wraps this so a mood-write failure never
 * breaks the pipeline.
 */
export async function recordDailyMood(
  snapshot: Pick<StoredData, "stocks">,
): Promise<MoodRecord> {
  const date = stockholmDate(new Date());
  const record = computeMoodRecord(snapshot.stocks, date);
  const redis = getRedis();
  const existing = (await redis.get<MoodRecord[]>(MOOD_HISTORY_KEY)) ?? [];
  const next = upsertMoodRecords(existing, record);
  await redis.set(MOOD_HISTORY_KEY, next);
  return record;
}

/**
 * Rolling mood history, oldest→newest, at most the last `days` records.
 * Returns `[]` when nothing has been recorded yet (fresh deploy) so the
 * UI can render an all-placeholder "building history" strip.
 */
export async function getMoodHistory(days = 30): Promise<MoodRecord[]> {
  if (shouldUseMock().use) {
    const { getMockMoodHistory } = await import("./mockData");
    return selectRecentMood(getMockMoodHistory(), days);
  }
  const all = (await getRedis().get<MoodRecord[]>(MOOD_HISTORY_KEY)) ?? [];
  return selectRecentMood(all, days);
}

// ============== Dated history snapshots (end-of-day, 400-day cap) ==============

/**
 * Slim, dated end-of-day snapshots for long-term history. Written on
 * every trigger; the last write of a Stockholm calendar day wins (one
 * key per day, overwritten intraday). Enables future mood timelines,
 * streaks, weekly recaps, per-stock charts.
 *
 * Storage shape:
 *   iskbets:snapshot:YYYY-MM-DD  → DailySnapshot (string key, JSON)
 *   iskbets:snapshot:index       → sorted set, member = date,
 *                                  score = YYYYMMDD (chronological)
 *
 * Retention: capped at SNAPSHOT_RETENTION_DAYS (400). On write, any
 * overflow (oldest dates beyond the cap) is deleted key-and-index.
 */

function snapshotDateKey(date: string): string {
  return `${SNAPSHOT_HISTORY_PREFIX}${date}`;
}

/** YYYY-MM-DD → numeric score for the index sorted set (chronological). */
function snapshotDateScore(date: string): number {
  return Number(date.replaceAll("-", ""));
}

/**
 * Write today's dated snapshot and register it in the index. Idempotent
 * per day: re-writing the same date overwrites the key and the index
 * entry (zadd on an existing member just updates its score) rather than
 * duplicating. After writing, trims history down to the 400-day cap by
 * deleting the oldest snapshot keys + index members.
 *
 * Throws on Redis failure — the caller (trigger route) wraps this so a
 * snapshot-write failure never breaks the main pipeline.
 */
export async function saveDailySnapshot(snapshot: DailySnapshot): Promise<void> {
  const redis = getRedis();
  const key = snapshotDateKey(snapshot.date);
  await redis.set(key, snapshot);
  await redis.zadd(SNAPSHOT_INDEX_KEY, {
    score: snapshotDateScore(snapshot.date),
    member: snapshot.date,
  });

  // Retention: cap at SNAPSHOT_RETENTION_DAYS. On a normal day this
  // trims at most one date (the 401st), but the loop handles any
  // backlog (e.g. after a cap change) in one pass.
  const count = await redis.zcard(SNAPSHOT_INDEX_KEY);
  if (count > SNAPSHOT_RETENTION_DAYS) {
    const overflow = count - SNAPSHOT_RETENTION_DAYS;
    const oldest = await redis.zrange<string[]>(
      SNAPSHOT_INDEX_KEY,
      0,
      overflow - 1,
    );
    if (oldest.length > 0) {
      await redis.del(...oldest.map(snapshotDateKey));
      await redis.zrem(SNAPSHOT_INDEX_KEY, ...oldest);
      console.log(
        `[storage] snapshot retention trimmed ${oldest.length} day(s): ` +
          oldest.join(", "),
      );
    }
  }
}

/** A single day's history snapshot, or null if that date wasn't archived. */
export async function getDailySnapshot(
  date: string,
): Promise<DailySnapshot | null> {
  if (shouldUseMock().use) {
    const { getMockDailySnapshots } = await import("./mockData");
    return getMockDailySnapshots().find((s) => s.date === date) ?? null;
  }
  const v = await getRedis().get<DailySnapshot>(snapshotDateKey(date));
  return v ?? null;
}

/**
 * All history snapshots with `from ≤ date ≤ to`, oldest→newest. Uses the
 * index sorted set for the date range then a single MGET for the bodies,
 * so no KEYS/SCAN. Both bounds inclusive; caller passes them already
 * ordered (from ≤ to).
 */
export async function getDailySnapshotsInRange(
  from: string,
  to: string,
): Promise<DailySnapshot[]> {
  if (shouldUseMock().use) {
    const { getMockDailySnapshots } = await import("./mockData");
    return getMockDailySnapshots().filter(
      (s) => s.date >= from && s.date <= to,
    );
  }
  const redis = getRedis();
  const dates = await redis.zrange<string[]>(
    SNAPSHOT_INDEX_KEY,
    snapshotDateScore(from),
    snapshotDateScore(to),
    { byScore: true },
  );
  if (dates.length === 0) return [];
  const rows = await redis.mget<(DailySnapshot | null)[]>(
    ...dates.map(snapshotDateKey),
  );
  return rows.filter((r): r is DailySnapshot => r !== null);
}

/**
 * The most recent `limit` history snapshots, oldest→newest (so the
 * result reads left-to-right as a time series). `limit` is clamped to
 * [1, SNAPSHOT_RETENTION_DAYS].
 */
export async function getRecentDailySnapshots(
  limit: number,
): Promise<DailySnapshot[]> {
  if (shouldUseMock().use) {
    const { getMockDailySnapshots } = await import("./mockData");
    const all = getMockDailySnapshots();
    const n = Math.max(1, Math.min(Math.floor(limit), SNAPSHOT_RETENTION_DAYS));
    return all.slice(Math.max(0, all.length - n));
  }
  const redis = getRedis();
  const n = Math.max(1, Math.min(Math.floor(limit), SNAPSHOT_RETENTION_DAYS));
  // Negative-rank range returns the top-N by score (newest) in ascending
  // order — exactly the oldest→newest ordering a time series wants.
  const dates = await redis.zrange<string[]>(SNAPSHOT_INDEX_KEY, -n, -1);
  if (dates.length === 0) return [];
  const rows = await redis.mget<(DailySnapshot | null)[]>(
    ...dates.map(snapshotDateKey),
  );
  return rows.filter((r): r is DailySnapshot => r !== null);
}

/**
 * One-shot fetch for the dashboard: snapshot + weekly champion + the
 * compact week-start price map (just ticker → price, not the full
 * snapshot — keeps the polled payload small). One MGET — all four are
 * plain string keys, so this is a single Redis command / round-trip.
 * Returns null only if the live snapshot is missing — everything else
 * is best-effort.
 *
 * Wrapped in React cache() (keyed on the mode STRING, not the options
 * object) so multiple calls in one render pass — e.g. the stock page's
 * generateMetadata + <StockDetail> — share a single Redis read. In
 * route handlers cache() is a per-request no-op, which is fine.
 *
 * Briefs (morning / evening / weekend wire) were removed for cost;
 * the only AI-generated narrative still surfaced is the Weekly Champion.
 */
const getDashboardDataByMode = cache(async (
  mode: MockMode,
): Promise<DashboardData | null> => {
  // Mock branch: route the whole assembly through the aggregator so
  // the mode-driven preview is consistent across all pieces.
  if (shouldUseMock().use) {
    const { getMockDashboardData } = await import("./mockData");
    return getMockDashboardData(mode);
  }

  const [snapshot, weekStart, weeklyChampion, moodHistoryRaw] =
    await getRedis().mget<
      [
        StoredData | null,
        WeekStartSnapshot | null,
        WeeklyChampion | null,
        MoodRecord[] | null,
      ]
    >(KV_KEY, WEEK_START_KEY, WEEKLY_CHAMPION_KEY, MOOD_HISTORY_KEY);
  const moodHistory = selectRecentMood(moodHistoryRaw ?? [], 30);
  if (!snapshot) return null;
  // Project weekStart down to a small ticker→price map. Saves ~80% of
  // the snapshot payload on every poll. Only include it if the stored
  // baseline is for THIS Stockholm-week's Monday — if Monday's archive
  // failed and we're holding last week's snapshot, the leaderboard's
  // WTD column would silently compare against a stale baseline and lie.
  // The trigger route's weekly-archive branch already does this same check;
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
    ...(weeklyChampion ? { weeklyChampion } : {}),
    ...(weekStartPrices ? { weekStartPrices } : {}),
    ...(moodHistory.length > 0 ? { moodHistory } : {}),
  };
});

export async function getDashboardData(opts?: {
  /** Dev-only preview mode; only honored when the storage layer is in
   * mock mode (no Redis creds in non-prod, or USE_MOCK_DATA=true).
   * Production calls ignore this param. */
  mode?: MockMode;
}): Promise<DashboardData | null> {
  return getDashboardDataByMode(opts?.mode ?? "default");
}

/** Drop trigger-route bookkeeping fields before exposing the snapshot
 * to the frontend / public API. See PublicStoredData docstring. */
function toPublicSnapshot(snapshot: StoredData): PublicStoredData {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lastFetch: _lastFetch,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    moodGeneratedAt: _moodGeneratedAt,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    pricesAtLastMood: _pricesAtLastMood,
    ...publicFields
  } = snapshot;
  return publicFields;
}
