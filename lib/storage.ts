import { kv } from "@vercel/kv";
import type { AnalysisPayload, StockPrice, StoredData } from "./types";

const KV_KEY = "iskbets:snapshot";

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

export async function getStockData(): Promise<StoredData | null> {
  if (process.env.USE_MOCK_DATA === "true") {
    console.log("[storage] returning mock data (USE_MOCK_DATA=true)");
    const { getMockData } = await import("./mockData");
    return getMockData();
  }
  const data = await kv.get<StoredData>(KV_KEY);
  return data ?? null;
}
