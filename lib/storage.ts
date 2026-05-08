import { kv } from "@vercel/kv";
import type { AnalysisPayload, StockPrice, StoredData } from "./types";

const KV_KEY = "iskbets:snapshot";
const ATTEMPT_KEY = "iskbets:lastAttempt";

export async function saveStockData(args: {
  stocks: StockPrice[];
  analysis: AnalysisPayload;
}): Promise<StoredData> {
  const now = Date.now();
  const data: StoredData = {
    stocks: args.stocks,
    analysis: args.analysis,
    updatedAt: new Date(now).toISOString(),
    lastFetch: now,
  };
  console.log(`[storage] saving snapshot at ${data.updatedAt}`);
  await kv.set(KV_KEY, data);
  return data;
}

function shouldUseMock(): { use: boolean; reason: string } {
  if (process.env.USE_MOCK_DATA === "true") {
    return { use: true, reason: "USE_MOCK_DATA=true" };
  }
  // Zero-config dev: if KV creds are missing and we're not in production,
  // fall back to mock so the dashboard renders without any setup.
  const kvConfigured =
    !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
  if (!kvConfigured && process.env.NODE_ENV !== "production") {
    return { use: true, reason: "no KV creds in non-production env" };
  }
  return { use: false, reason: "" };
}

export async function getStockData(): Promise<StoredData | null> {
  const mock = shouldUseMock();
  if (mock.use) {
    console.log(`[storage] returning mock data (${mock.reason})`);
    const { getMockData } = await import("./mockData");
    return getMockData();
  }
  const data = await kv.get<StoredData>(KV_KEY);
  return data ?? null;
}

/**
 * Returns the epoch ms of the most recent /api/trigger attempt — success
 * OR failure. Used for cooldown gating so a failing pipeline can't be
 * hammered. Returns 0 if no attempt has been recorded yet.
 */
export async function getLastAttempt(): Promise<number> {
  const v = await kv.get<number>(ATTEMPT_KEY);
  return v ?? 0;
}

/**
 * Records "we tried at this moment". Called BEFORE the pipeline runs in
 * the trigger route, so the cooldown applies even if fetchPrices or
 * analyzeStocks throws midway.
 */
export async function markAttempt(): Promise<void> {
  await kv.set(ATTEMPT_KEY, Date.now());
}
