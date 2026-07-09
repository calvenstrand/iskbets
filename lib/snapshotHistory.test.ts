import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DailySnapshot, StoredData } from "./types";

// ---- In-memory Redis fake (the subset the snapshot code uses) --------------
// Mirrors @upstash/redis semantics closely enough to exercise the real
// storage functions + history route without a live Upstash instance
// (no local creds). vi.hoisted so the mock factory can see it.
const fake = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  return {
    store,
    zsets,
    async set(key: string, val: unknown): Promise<void> {
      store.set(key, val);
    },
    async get<T>(key: string): Promise<T | null> {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async mget<T>(...keys: string[]): Promise<T> {
      return keys.map((k) => (store.has(k) ? store.get(k) : null)) as T;
    },
    async zadd(
      key: string,
      m: { score: number; member: string },
    ): Promise<number> {
      let z = zsets.get(key);
      if (!z) {
        z = new Map();
        zsets.set(key, z);
      }
      const isNew = !z.has(m.member);
      z.set(m.member, m.score);
      return isNew ? 1 : 0;
    },
    async zcard(key: string): Promise<number> {
      return zsets.get(key)?.size ?? 0;
    },
    async zrem(key: string, ...members: string[]): Promise<number> {
      const z = zsets.get(key);
      if (!z) return 0;
      let n = 0;
      for (const mem of members) if (z.delete(mem)) n++;
      return n;
    },
    async zrange<T>(
      key: string,
      a: number,
      b: number,
      opts?: { byScore?: boolean },
    ): Promise<T> {
      const z = zsets.get(key);
      if (!z) return [] as unknown as T;
      const sorted = [...z.entries()].sort(
        (x, y) => x[1] - y[1] || x[0].localeCompare(y[0]),
      );
      if (opts?.byScore) {
        return sorted
          .filter(([, s]) => s >= a && s <= b)
          .map(([mem]) => mem) as unknown as T;
      }
      const len = sorted.length;
      let start = a < 0 ? len + a : a;
      const stop = b < 0 ? len + b : b;
      if (start < 0) start = 0;
      const out: string[] = [];
      for (let i = start; i <= stop && i < len; i++) {
        if (i >= 0) out.push(sorted[i]![0]);
      }
      return out as unknown as T;
    },
  };
});

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      return fake as unknown as InstanceType<typeof import("@upstash/redis").Redis>;
    }
  },
}));

// Real creds must look present so the storage layer skips its mock branch
// and builds the (mocked) Redis client.
beforeAll(() => {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  delete process.env.USE_MOCK_DATA;
});

// Import AFTER the mock is registered.
import { computeDailySnapshot } from "./dailySnapshot";
import {
  getDailySnapshot,
  getDailySnapshotsInRange,
  getRecentDailySnapshots,
  saveDailySnapshot,
} from "./storage";
import { getMockData } from "./mockData";
import { GET as historyGET } from "@/app/api/history/route";

function snapshotForDate(
  date: string,
  capturedAt: number,
  mutate?: (d: StoredData) => void,
): DailySnapshot {
  const data = getMockData();
  mutate?.(data);
  return computeDailySnapshot({ data, date, capturedAt });
}

function req(qs: string): Request {
  return new Request(`http://localhost/api/history${qs}`);
}

describe("daily snapshot history", () => {
  it("run twice same day → overwrites, does not duplicate the index entry", async () => {
    fake.store.clear();
    fake.zsets.clear();

    // First trigger of the day.
    await saveDailySnapshot(snapshotForDate("2026-07-09", 1_000));
    // Second trigger, later the same day, NVDA moved.
    await saveDailySnapshot(
      snapshotForDate("2026-07-09", 2_000, (d) => {
        const nvda = d.stocks.find((s) => s.ticker === "NVDA")!;
        nvda.regularMarketPrice = 999.99;
      }),
    );

    // Exactly one dated key + one index member.
    expect(fake.zsets.get("iskbets:snapshot:index")?.size).toBe(1);
    expect(fake.store.has("iskbets:snapshot:2026-07-09")).toBe(true);

    // Second write won.
    const snap = await getDailySnapshot("2026-07-09");
    expect(snap?.capturedAt).toBe(2_000);
    expect(snap?.stocks.find((s) => s.ticker === "NVDA")?.price).toBe(999.99);

    console.log(
      "\n=== ?date=2026-07-09 (single day, slim shape) ===\n" +
        JSON.stringify(
          { ...snap, stocks: snap?.stocks.slice(0, 3) },
          null,
          2,
        ) +
        `\n  ...(${snap?.stocks.length} stocks total)`,
    );
  });

  it("slim snapshot carries only the history fields", async () => {
    const snap = await getDailySnapshot("2026-07-09");
    const nvda = snap!.stocks.find((s) => s.ticker === "NVDA")!;
    expect(Object.keys(nvda).sort()).toEqual(
      ["changePct", "comment", "price", "rating", "sentiment", "ticker"].sort(),
    );
    // None of the heavy live-snapshot fields leaked in.
    expect("regularMarketVolume" in nvda).toBe(false);
    expect("fiftyTwoWeekHigh" in nvda).toBe(false);
    expect("marketState" in nvda).toBe(false);
  });

  it("range query returns snapshots oldest→newest", async () => {
    fake.store.clear();
    fake.zsets.clear();
    for (const d of ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"]) {
      await saveDailySnapshot(snapshotForDate(d, 1_000));
    }
    const range = await getDailySnapshotsInRange("2026-07-07", "2026-07-09");
    expect(range.map((s) => s.date)).toEqual([
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ]);
  });

  it("ticker series pulls (date, price, change, mood) from the last N days", async () => {
    const snapshots = await getRecentDailySnapshots(30);
    const { extractTickerSeries } = await import("./dailySnapshot");
    const series = extractTickerSeries(snapshots, "DDOG");
    expect(series.length).toBe(4);
    expect(series[0]).toMatchObject({
      date: "2026-07-06",
      sentiment: expect.any(String),
    });
    expect(series.map((p) => p.date)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ]);
  });

  it("retention caps history at 400 days, trimming the oldest", async () => {
    fake.store.clear();
    fake.zsets.clear();
    // Write 402 consecutive days; only the newest 400 should survive.
    const base = Date.UTC(2025, 0, 1);
    const dates: string[] = [];
    for (let i = 0; i < 402; i++) {
      const dt = new Date(base + i * 86_400_000);
      const date = dt.toISOString().slice(0, 10);
      dates.push(date);
      await saveDailySnapshot(snapshotForDate(date, 1_000));
    }
    expect(fake.zsets.get("iskbets:snapshot:index")?.size).toBe(400);
    // Oldest two dropped, key deleted.
    expect(fake.store.has(`iskbets:snapshot:${dates[0]}`)).toBe(false);
    expect(fake.store.has(`iskbets:snapshot:${dates[1]}`)).toBe(false);
    expect(fake.store.has(`iskbets:snapshot:${dates[2]}`)).toBe(true);
    expect(fake.store.has(`iskbets:snapshot:${dates[401]}`)).toBe(true);
  });

  // ---- Exercise the actual route handler for all three variants ------------

  it("route: ?date= returns the day, ?from&to returns a range, ?ticker returns a series", async () => {
    fake.store.clear();
    fake.zsets.clear();
    for (const d of ["2026-07-07", "2026-07-08", "2026-07-09"]) {
      await saveDailySnapshot(snapshotForDate(d, 5_000));
    }

    const single = await historyGET(req("?date=2026-07-08"));
    expect(single.status).toBe(200);
    const singleBody = await single.json();
    expect(singleBody.date).toBe("2026-07-08");

    const range = await historyGET(req("?from=2026-07-07&to=2026-07-09"));
    expect(range.status).toBe(200);
    const rangeBody = await range.json();
    expect(rangeBody.count).toBe(3);
    expect(rangeBody.snapshots.map((s: DailySnapshot) => s.date)).toEqual([
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ]);

    const tick = await historyGET(req("?ticker=ddog&days=30"));
    expect(tick.status).toBe(200);
    const tickBody = await tick.json();
    expect(tickBody.ticker).toBe("DDOG"); // uppercased
    expect(tickBody.count).toBe(3);

    console.log(
      "\n=== ?from=2026-07-07&to=2026-07-09 (range) ===\n" +
        JSON.stringify(
          {
            from: rangeBody.from,
            to: rangeBody.to,
            count: rangeBody.count,
            dates: rangeBody.snapshots.map((s: DailySnapshot) => s.date),
          },
          null,
          2,
        ),
    );
    console.log(
      "\n=== ?ticker=DDOG&days=30 (per-ticker series) ===\n" +
        JSON.stringify(tickBody, null, 2),
    );

    // Bad inputs.
    expect((await historyGET(req("?date=nope"))).status).toBe(400);
    expect((await historyGET(req("?from=2026-07-07"))).status).toBe(400);
    expect((await historyGET(req("?date=2026-01-01"))).status).toBe(404);
    expect((await historyGET(req(""))).status).toBe(400);
  });
});
