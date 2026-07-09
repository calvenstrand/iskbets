import { notFound } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { deriveRating, deriveSentiment, moodVar } from "@/lib/derive";
import { computeLeaderboard } from "@/lib/leaderboard";
import { newYorkStatus, stockholmStatus, type Status } from "@/lib/marketHours";
import {
  buildAnalystLog,
  buildMoodStrip,
  buildSparklinePath,
  extractTickerHistory,
  fromTheTop,
  monthYearOf,
  rangePosition,
  SPARKLINE_UNLOCK_DAYS,
} from "@/lib/stockDetail";
import { displayTicker, PEOPLE, type Person, TICKERS } from "@/lib/tickers";
import { getDashboardData, getRecentDailySnapshots } from "@/lib/storage";
import type { StockPrice } from "@/lib/types";
import { AnalystLog } from "./AnalystLog";
import { MoodStrip } from "./MoodStrip";

/** How deep to read history for the log / strip / sparkline. Matches the
 * snapshot retention cap so a mature ticker gets its whole run. */
const HISTORY_DAYS = 400;

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  return value >= 100
    ? value.toFixed(2)
    : value.toFixed(value >= 1 ? 2 : 4);
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function fmtSignedPrice(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function changeClass(value: number): string {
  if (!Number.isFinite(value)) return "sd-flat";
  if (value > 0) return "sd-up";
  if (value < 0) return "sd-down";
  return "sd-flat";
}

function arrow(value: number): string {
  if (!Number.isFinite(value)) return "·";
  return value > 0 ? "▲" : value < 0 ? "▼" : "·";
}

/** Emoji for the "distance from the top" line — colder the further from
 * glory. ~0 (at the high) gets the summit. */
function topEmoji(pctFromTop: number): string {
  if (pctFromTop >= -0.5) return "🗻";
  if (pctFromTop > -15) return "😤";
  if (pctFromTop > -35) return "🥶";
  return "⚰️";
}

function marketStatus(market: "SE" | "US", now: Date): Status {
  return market === "SE" ? stockholmStatus(now) : newYorkStatus(now);
}

function statusPip(s: Status): string {
  if (s === "OPEN") return "sd-pip-open";
  if (s === "PRE-MARKET") return "sd-pip-pre";
  return "sd-pip-closed";
}

/** Best (lowest) leaderboard rank across a ticker's owners, plus the
 * scope label. Week scope when a Monday baseline exists, else today. */
function ownerRank(
  owners: Person[],
  stocks: StockPrice[],
  weekStartPrices: Record<string, number> | undefined,
  now: Date,
): { rank: number; scope: "WEEK" | "TODAY" } | null {
  const useWeek = !!weekStartPrices;
  const entries = computeLeaderboard(
    stocks,
    weekStartPrices,
    useWeek ? { sortBy: "wtd" } : { now },
  );
  let best: number | null = null;
  for (const owner of owners) {
    const idx = entries.findIndex((e) => e.person === owner);
    if (idx === -1) continue;
    if (best === null || idx < best) best = idx;
  }
  if (best === null) return null;
  return { rank: best + 1, scope: useWeek ? "WEEK" : "TODAY" };
}

/**
 * The shared inner content of the per-stock detail view. Rendered
 * identically by the full-page route and the intercepting modal — only
 * the surrounding shell differs. Server component: reads the cached
 * dashboard snapshot + this ticker's dated history ONCE, then shapes
 * every section from that single read. Now-dependent bits (market badge,
 * owner rank) are computed here from server time and emitted as static
 * HTML, so there's no client re-render / hydration drift.
 */
export async function StockDetail({ symbol }: { symbol: string }) {
  const meta = TICKERS.find((t) => t.symbol === symbol);
  if (!meta) notFound();

  const now = new Date();
  const [dashboard, snapshots] = await Promise.all([
    getDashboardData().catch(() => null),
    getRecentDailySnapshots(HISTORY_DAYS).catch(() => []),
  ]);

  const stock = dashboard?.snapshot.stocks.find((s) => s.ticker === symbol);
  const analysis = dashboard?.snapshot.analysis.stocks.find(
    (a) => a.ticker === symbol,
  );
  const weekStartPrices = dashboard?.weekStartPrices;

  const history = extractTickerHistory(snapshots, symbol);
  const moodCells = buildMoodStrip(history);
  const log = buildAnalystLog(history, {
    fallbackMonthYear: monthYearOf(
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
    ),
  });

  const price = stock?.regularMarketPrice ?? NaN;
  const dayPct = stock?.regularMarketChangePercent ?? NaN;
  const dayChange = stock?.regularMarketChange ?? NaN;
  const currency = stock?.currency ?? "";

  // Mood follows the live day move, matching the card system.
  const sentiment = deriveSentiment(dayPct);
  const rating = deriveRating(dayPct);
  const mood = moodVar(sentiment);
  const style = {
    "--mood": mood,
    "--mood-ink":
      sentiment === "moon" ? "var(--surface-0)" : "var(--text-0)",
  } as CSSProperties;

  // Week-to-date, only when a Monday baseline exists for this ticker.
  const baseline = weekStartPrices?.[symbol];
  const wtdPct =
    baseline && baseline > 0 && Number.isFinite(price)
      ? ((price - baseline) / baseline) * 100
      : null;

  // 52-week geometry (SE tickers have it; US free-tier reports 0/0).
  const high = stock?.fiftyTwoWeekHigh ?? 0;
  const low = stock?.fiftyTwoWeekLow ?? 0;
  const rangePos = rangePosition(price, low, high);
  const pctFromTop = fromTheTop(price, high);

  // Ownership.
  const owners = meta.owners ?? [];
  const ownerNames = owners.map((o) => PEOPLE[o]);
  const rankInfo =
    owners.length > 0 && dashboard
      ? ownerRank(owners, dashboard.snapshot.stocks, weekStartPrices, now)
      : null;

  // Sparkline gate + path.
  const prices = history.map((p) => p.price);
  const receipts = prices.length;
  const sparkPath =
    receipts >= SPARKLINE_UNLOCK_DAYS
      ? buildSparklinePath(prices, 600, 120, 4)
      : null;

  const status = marketStatus(meta.market, now);
  const solidChip = sentiment === "moon" || sentiment === "rekt";

  return (
    <div className="sd" style={style}>
      {/* 1 — Quote header */}
      <header className="sd-quote">
        <div className="sd-quote-head">
          <div className="sd-identity">
            <h1 className="sd-name">{meta.name}</h1>
            <div className="sd-symbol">{displayTicker(symbol)}</div>
          </div>
          <div className="sd-badges">
            <span className={`sd-market ${statusPip(status)}`}>
              <span className="sd-pip" aria-hidden="true" />
              {status}
            </span>
            {rating && (
              <span className={`sd-chip ${solidChip ? "sd-chip-solid" : ""}`}>
                {rating}
              </span>
            )}
          </div>
        </div>

        <div className="sd-price-row">
          <span className={`sd-price ${Number.isFinite(price) ? "" : "sd-na"}`}>
            {fmtPrice(price)}
          </span>
          {Number.isFinite(price) && currency && (
            <span className="sd-currency">{currency}</span>
          )}
          <span className={`sd-day ${changeClass(dayPct)}`}>
            {arrow(dayPct)} {fmtSignedPrice(dayChange)} ({fmtPct(dayPct)})
          </span>
        </div>

        <div className="sd-subline">
          {wtdPct !== null ? (
            <span className={`sd-wtd ${changeClass(wtdPct)}`}>
              WEEK-TO-DATE {fmtPct(wtdPct)}
            </span>
          ) : (
            <span className="sd-wtd sd-muted">WTD PENDING MONDAY BASELINE</span>
          )}
          {analysis?.comment && (
            <span className="sd-live-take">&ldquo;{analysis.comment}&rdquo;</span>
          )}
        </div>
      </header>

      {/* 2 — 52-week range bar */}
      <section className="sd-section">
        <h2 className="sd-label">52-WEEK RANGE</h2>
        {rangePos !== null ? (
          <>
            <div className="sd-range">
              <div
                className="sd-range-fill"
                style={{ width: `${(rangePos * 100).toFixed(1)}%` }}
              />
              <div
                className="sd-range-marker"
                style={{ left: `${(rangePos * 100).toFixed(1)}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="sd-range-ends">
              <span>{fmtPrice(low)}</span>
              {pctFromTop !== null && (
                <span className="sd-from-top">
                  {fmtPct(pctFromTop)} FROM THE TOP {topEmoji(pctFromTop)}
                </span>
              )}
              <span>{fmtPrice(high)}</span>
            </div>
          </>
        ) : (
          <p className="sd-thin">
            {`// no 52-week range on the free-tier quote — ${meta.market === "US" ? "US card" : "not reported"}`}
          </p>
        )}
      </section>

      {/* 3 — Ownership */}
      <section className="sd-section sd-ownership">
        {owners.length > 0 ? (
          <p className="sd-own-line">
            THIS IS {joinNames(ownerNames).toUpperCase()}&apos;S{" "}
            {owners.length > 1 ? "SHARED PROBLEM" : "PROBLEM"}
            {rankInfo && (
              <>
                {" · "}
                <Link href="/#leaderboard" className="sd-rank-link">
                  {rankInfo.rank === 1 ? "👑 " : ""}#{rankInfo.rank} THIS{" "}
                  {rankInfo.scope}
                </Link>
              </>
            )}
          </p>
        ) : (
          <p className="sd-own-line sd-muted">NOBODY&apos;S BAG (yet)</p>
        )}
      </section>

      {/* 4 — Mood strip */}
      <section className="sd-section">
        <h2 className="sd-label">MOOD STRIP</h2>
        {moodCells.length > 0 ? (
          <MoodStrip cells={moodCells} />
        ) : (
          <p className="sd-thin">
            {`// no snapshot days yet — the strip fills in as the cron logs closes`}
          </p>
        )}
      </section>

      {/* 5 — Analyst log (the spine) */}
      <section className="sd-section sd-analyst">
        <h2 className="sd-label">ANALYST LOG</h2>
        <AnalystLog entries={log} />
      </section>

      {/* 6 — Sparkline slot (locked until 30 receipts) */}
      <section className="sd-section">
        <h2 className="sd-label">PRICE CHART</h2>
        {sparkPath ? (
          <svg
            className="sd-sparkline"
            viewBox="0 0 600 120"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${displayTicker(symbol)} price over ${receipts} snapshots`}
          >
            <path d={sparkPath} className="sd-spark-path" />
          </svg>
        ) : (
          <div className="sd-locked">
            <div className="sd-locked-line">
              🔒 PRICE CHART UNLOCKS AT {SPARKLINE_UNLOCK_DAYS} DAYS OF RECEIPTS
            </div>
            <div className="sd-locked-bar" aria-hidden="true">
              <div
                className="sd-locked-fill"
                style={{
                  width: `${Math.min(100, (receipts / SPARKLINE_UNLOCK_DAYS) * 100).toFixed(1)}%`,
                }}
              />
            </div>
            <div className="sd-locked-count">
              {receipts} / {SPARKLINE_UNLOCK_DAYS}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** "Chris", "Chris & Oskar", "Chris, Oskar & Johan". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
