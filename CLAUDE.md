# ISKBets

A WSB-flavored stock tracker. Fetches quotes for a curated Swedish + US ticker list, runs them through Claude for a Gordon-Gekko-energy take, stores the result in Vercel KV, and serves it via a public API + a dark-terminal dashboard.

## Current status

Backend and frontend are both complete; build + lint pass clean.

**Working:**

- `/api/trigger` (auth via `x-trigger-secret` header — or legacy `?key=` query param) → `fetchPrices` (smart: skips closed-market tickers and reuses their cached prices) → optional `analyzeStocks` (gated by smart-skip logic) → `saveStockData` → `maybeArchiveWeekStart` (writes the week baseline on the first trigger of any weekday that doesn't already have one — resilient to Monday holidays / Monday cron failures) → post-close daily archive (22:00 CET, no AI) + Friday-only weekly archive + Weekly Champion AI call (22:45 CET). All idempotent. A cron-job.org scheduled job pings the endpoint every 10 min on weekdays; off-hours fires are near-instant since they're pure cache passthrough.
- `/api/data` (public) reads the latest snapshot + the weekly champion + a compact `weekStartPrices` map from KV; CDN-cached via `Cache-Control: public, s-maxage=20, stale-while-revalidate=300` so the polling client doesn't drain Upstash
- `/` server component fetches `/api/data` on the server with `revalidate: 60`, then hands the data to a `'use client'` Dashboard
- Dashboard sub-components: one-time boot-sequence splash (CRT-style boot log, gated by sessionStorage so it plays once per browser session), ticker tape, masthead header (I$KBETS wordmark + date/issue dateline), market-status bar (5 markets — Tokyo, Hong Kong, Stockholm, London, NYC — real timezones via `Intl`; collapses to pill+code on mobile), mood banner, friend leaderboard (per-friend today% + WTD%), winner/loser featured cards, weekend-only Champion+Standings recap-row, responsive grid, last-updated footer
- Bebas Neue + Share Tech Mono via `next/font/google`; design system in `app/globals.css`
- `vercel.json` sets `maxDuration: 60` on `/api/trigger` for the AI call
- Cards render gracefully when AI analysis is missing for a ticker; prices render `N/A` for non-finite values; `/` falls through to a `NO DATA YET` empty state if KV is empty or unreachable

**Known limitations:**

- Market-hours logic doesn't account for exchange holidays — only weekdays + regular session windows
- Redis includes a long-term `iskbets:archive` hash that accumulates one compact `WeeklyResult` per trading week (~3 KB each, capped naturally by the trim policy). Not yet exposed in the dashboard — read via `listWeeklyResults` for future history features.
- Finnhub `/quote` doesn't return 52-week high/low or volume on the free tier, so the "X% FROM GLORY" line is hidden on US cards (the StockCard guards on `fiftyTwoWeekHigh > 0`). Stockholm cards (Avanza) DO have it. Asymmetric but fine.
- Avanza is unofficial — could change/break at any time. Per-ticker error handling in `fetchPrices` means a broken Avanza endpoint just silently drops the SE cards rather than crashing the batch. Switch to a paid provider if SE coverage becomes critical.
- Per-card market badge is derived from the current time + ticker market (Stockholm/NY hours via `lib/marketHours.ts`) rather than from the data source — so there's no `POST` state, only `OPEN`/`PRE`/`CLOSED`.



## Stack

- Next.js 15 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`)
- Hybrid quote source via plain `fetch`:
  - **Finnhub** `/api/v1/quote` for US tickers (free tier, 60 req/min, US-only)
  - **Avanza** `/_api/market-guide/stock/{orderbookId}` for Stockholm tickers — unofficial public JSON, no auth, no key. Each SE ticker has a hardcoded `avanzaId` in `lib/tickers.ts`.
  - Path we burned: Yahoo (429 from Vercel IPs on both `yahoo-finance2` and `/v8/finance/chart`); Twelve Data (free tier silently 404s on Stockholm despite docs claiming coverage). Avanza was the unblock.
- `@anthropic-ai/sdk` — analysis (model: `claude-haiku-4-5` for the per-tick analyzer, `claude-sonnet-4-6` for the weekly champion recap; no web search; data is passed in; uses native structured outputs via `output_config.format`)
- `@upstash/redis` — storage (Upstash Redis via Vercel Marketplace; keys `iskbets:snapshot` for the data, `iskbets:lastAttempt` for the cooldown gate)
- Tailwind CSS 4 (layout utilities only — colors and typography live in `globals.css` via CSS variables)
- `next/font/google` — Bebas Neue (display) + Share Tech Mono (mono)
- Deploys to Vercel

## Data flow

```
/api/trigger (GET; manual or scheduled — `x-trigger-secret: ${TRIGGER_SECRET}` header, or legacy ?key=)
  → markAttempt()        lib/storage.ts  (1-min cooldown gate)
  → fetchPrices(cached)  lib/fetchPrices.ts  (Finnhub + Avanza, only for tickers whose market is in its live window — closed-market tickers reuse cached prices, no API call)
  → shouldRerunAI()      app/api/trigger/route.ts (decides whether AI runs)
       ├─ AI run        analyzeStocks()  lib/analyzeStocks.ts
       └─ AI skipped    reuse last analysis from existing snapshot
  → saveStockData()      lib/storage.ts (Upstash Redis)
  → maybeArchiveWeekStart() (idempotent — writes the week's baseline on the first trigger of any weekday that doesn't already have it; resilient to Monday holidays / Monday cron outages)
  → runPostCloseWork() (idempotent, time-windowed)
       ├─ inPostCloseWindow (Mon-Fri 22:00-22:45 STO)
       │                       → maybeArchiveDailyResult() (compact daily archive)
       └─ inWeeklyArchiveWindow (Friday 22:45-23:30 STO)
                                  → maybeArchiveWeeklyResult() (compact weekly archive)
                                  + maybeGenerateWeeklyChampion() (AI call, recap of WTD leader — the only recurring AI narrative)

/api/data (GET, public, CDN-cached 20s)
  → getDashboardData()   lib/storage.ts → { snapshot, weeklyChampion?, weekStartPrices? }
```

**Smart AI gating** (`shouldRerunAI` in `app/api/trigger/route.ts`):
The Anthropic call only fires when at least one of these is true:
1. Any ticker's `regularMarketChangePercent` shifted by **> 2pp** since the snapshot Claude last saw (threshold history: 1 → 2pp; 1pp was firing on nearly every tick on volatile days), AND it's been **≥ 60 min** since the last AI run (floor history: 30 → 45 → 60 min as cost tightened).
2. **> 4 hours** since the last AI run (freshness ceiling — the `overallMood` shouldn't go stale on a flat day).
3. No prior analysis exists.

Otherwise prices are refreshed but the existing analysis is carried forward. This decouples price freshness (every 10 min) from AI cost (only when there's something new to say).

**Cron schedule** lives at [cron-job.org](https://cron-job.org): `3,13,23,33,43,53 6-22 * * 1-5` UTC (every 10 min on weekdays, `:03`-style offset so each tick lands ~3 min after each ten-minute mark). The offsets are chosen to land shortly after market opens — Stockholm opens at 09:00 STO (= 08:00 UTC winter / 07:00 UTC summer), so the `:03` tick fires 3 min after open. 3 min vs 1 min gives the opening auction time to settle and Finnhub/Avanza time to start returning sensible intraday `dp` values instead of zero. Same logic for NY's 15:30 STO open → 15:33 STO tick. The window covers ~07:00–00:00 CET / ~08:00–01:00 CEST so the post-close window (22:00 CET) and weekly archive window (Fri 22:45 CET) always have multiple fires inside them in either DST mode. The job sends GET to `https://www.iskbets.se/api/trigger` with the `x-trigger-secret` header set from a private cron-job.org config (timeout 90s, response logged to job history).

Cadence history: 15 min → 10 min (bumped 2026-05-12 — more headroom for fresher data without straining Upstash quotas; client polling currently 2 min so users see at most one cron cycle + ~20s CDN of staleness).

Migration history: Vercel Cron → GitHub Actions (free, but ~12% delivery rate during business hours due to scheduling backlog) → cron-job.org (proper second-level reliability, free tier, web dashboard with manual fire button).

`.github/workflows/fetch.yml` still exists as a `workflow_dispatch`-only fallback: lets us fire a trigger from the GitHub Actions tab if cron-job.org is ever down or we need a quick manual run. No `schedule:` block on it anymore.

**Live-window gating in `fetchPrices`** (`isMarketLive` in `lib/marketHours.ts`): for each ticker, check whether its market is currently in a "live data" window — open + 30 min post-close buffer. Inside the window: fetch fresh from Finnhub/Avanza. Outside: reuse the cached price from the previous snapshot, no API call. Bootstrap edge case: if a ticker has no cached price yet (very first cron run, or a newly added ticker), fetch regardless of window. Result: cron fires outside market hours are essentially free no-ops; only the markets actually trading hit the network.

**Brief subsystem (removed)**: the dashboard once carried three long-form Anthropic-generated briefs (Morning Wire 08:00 STO, Evening Wrap 22:00 STO, Weekend Wire Fri 22:45 STO). All three were removed for cost — nobody on the friend group was reading them and the combined AI calls added ~$0.40/week. The Weekly Champion AI call (below) survived because the dashboard actively renders it as a hero card every weekend. If a future feature needs long-form prose again (e.g. an archive page), the old generators are in git history (`lib/briefs.ts` commits around May 2026).

**Time windows still in play**:

- **Post-close archive** — runs in the 22:00–22:45 STO window after NY close. Writes the daily archive (`iskbets:dailyArchive`) to capture today's close for long-term history. Idempotent per Stockholm calendar day. No AI cost.
- **Weekly archive + Weekly Champion** — Friday 22:45–23:30 STO. Writes `iskbets:archive` (compact `WeeklyResult` for the week) and fires one Anthropic call to generate the Weekly Champion recap (the only recurring AI narrative). Idempotent per week.

**Friend leaderboard**: per-friend daily/WTD performance, computed in `lib/leaderboard.ts` from the snapshot + `weekStartPrices` map. Only renders during the recap window (Fri 22:00 → Mon 09:00 STO). WTD column gracefully hides when no Monday baseline exists yet (e.g. very first deploy or if Monday's archive missed). Sort is by today% during weekdays, by WTD during the recap window. In recap mode the standings sit side-by-side with the Champion card in a `.recap-row` 2-column grid; cards get green/red sentiment tints based on each friend's WTD performance.

**Champion of the Week**: gold hero card pinned above the standings during the recap window. Generated once a week (Friday 22:45–23:30 STO) by the surviving Anthropic call. Targets the friend with the highest **WTD%** at end of week — the actual week champion, which can differ from today's #1. Persists through the weekend until next Friday's call overwrites it. Title shows the date range so it's always clear which week it covers.

**Cooldown gate** (`iskbets:lastAttempt`) is intentionally written **before** the pipeline runs — so a partial failure (provider flake, Anthropic rate limit) still consumes the cooldown. It's now 1 min (was 30) — just spam-prevention for manual clicks; cron fires every 10 min so it's never blocked.

## KV shape

Ten Redis keys (two are hashes), all under the `iskbets:` namespace:

```ts
// iskbets:snapshot — the live dashboard data
{
  stocks: StockPrice[],          // refreshed every trigger
  analysis: {                    // regenerated only when shouldRerunAI fires
    stocks: StockAnalysis[],
    overallMood: string,
    biggestWinner: string,
    biggestLoser: string,
  },
  updatedAt: string,             // ISO of last price refresh
  lastFetch: number,             // epoch ms of last price refresh
  analyzedAt: number,            // epoch ms of last AI run
  pricesAtLastAnalysis: StockPrice[]  // baseline for the AI-rerun decision
}

// iskbets:lastAttempt — number, epoch ms (cooldown gate)

// iskbets:weekStart — { weekStart: "YYYY-MM-DD" (Monday), stocks: StockPrice[] }
//                     archived on the first weekday trigger of the week that
//                     doesn't already have a baseline (typically Monday morning;
//                     falls forward to Tue+ if Monday is a holiday or cron failed).
//                     Baseline for the leaderboard WTD column and the Weekly
//                     Champion's week-over-week recap.

// iskbets:archive — Redis HASH. Field name = weekStart (YYYY-MM-DD).
//                   Field value = WeeklyResult (compact: per-stock weekChangePct,
//                   per-friend WTD%, Friday's overallMood).
//                   Written Friday evening (22:45–23:30 STO) after the weekly
//                   archive window fires. Idempotent per week. Read via
//                   `listWeeklyResults(limit?)` from lib/storage. Future home
//                   for history graphs / yearly recap / monthly leaderboards.
//                   NOT in /api/data — pull via a new endpoint when needed.

// iskbets:dailyArchive — Redis HASH. Field name = date (YYYY-MM-DD STO).
//                   Field value = DailyResult (compact: per-stock close +
//                   changePct, per-friend dayPct, today's overallMood).
//                   Written by the post-close branch (22:00–22:45 STO).
//                   Idempotent per Stockholm calendar day. Read via
//                   `listDailyResults(limit?)`. Foundation for future
//                   per-stock charts, day-by-day leaderboards, volatility
//                   stats. NOT in /api/data — pull when needed.

// iskbets:weeklyChampion — { weekStart, weekEnd, person, name, wtdPct,
//                            line, generatedAt }. Champion of the week
//                            recap, generated by the Friday 22:45–23:30
//                            STO Anthropic call. Targets the WTD leader
//                            (highest WTD%, which can differ from today's
//                            #1 on the live leaderboard). Pinned through
//                            the weekend, overwritten next Friday.
//                            Surfaced in /api/data; rendered as a gold
//                            card during the recap window.

// DEPRECATED keys still in Redis from the removed brief subsystem.
// Safe to delete manually if you want a clean Redis dump — nothing
// reads them anymore:
//   iskbets:morningBrief
//   iskbets:eveningBrief
//   iskbets:weekendWire
//   iskbets:yesterday
```

## Env vars

Documented in `.env.example`:

- `ANTHROPIC_API_KEY` — Claude SDK
- `FINNHUB_API_KEY` — Finnhub quote endpoint (US)
- `TRIGGER_SECRET` — auth for `/api/trigger`. Send via the `x-trigger-secret` header (preferred) or the legacy `?key=` query param. Configured as a custom request header in the cron-job.org job config (also pasteable into the GitHub Actions workflow if we ever need the manual `workflow_dispatch` fallback to authenticate).
- (Avanza needs no key — orderbookIds are hardcoded in `lib/tickers.ts`)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis; auto-injected in production via the Vercel Marketplace integration, manual for local dev. Legacy `KV_REST_API_URL` / `KV_REST_API_TOKEN` names are also supported as a fallback.

## Conventions

- Strict TypeScript, no `any`. Define explicit return types for lib functions.
- `async`/`await` throughout, no `.then` chains.
- Per-ticker error handling in `fetchPrices`: skip the bad one, log it, keep going. One ticker must never crash the batch.
- `console.log` at key pipeline steps so Vercel logs are useful for debugging.
- API routes return JSON. Errors return `{ error: string, ...context }` with appropriate status (401, 404, 429, 500).
- Frontend never crashes on missing data: cards render without analysis if Claude misses a ticker; prices render `N/A` for non-finite values; `/` falls through to `NO DATA YET` if KV is empty.
- Tailwind is for layout only (`grid`, `flex`, padding, etc.). Colors and typography come from CSS variables in `app/globals.css` — don't add Tailwind color or font utilities.

## WSB voice (for the analyzer prompt)

- Persona: WSB analyst with Gordon Gekko energy.
- **Claude only generates two things**: optional per-stock `comment`s, and the `overallMood`. Everything else is computed in code:
  - `rating` and `sentiment` are derived from `regularMarketChangePercent` via `lib/derive.ts`. Pure rule-based, no LLM judgment needed for magnitude-based labels.
  - `biggestWinner` / `biggestLoser` are picked by `Math.max`/`Math.min` over the price data.
- `comment` is **optional** per stock — Claude only includes one when (a) move >±3%, OR (b) owned + move >±1.5%. Otherwise omit. ≤ 10 words, punchy, slang-heavy.
- `rating` is one of `🚀 TO THE MOON | 💎 DIAMOND HANDS | 📈 BULLISH AF | ⚠️ TURBULENCE | 📉 GET REKT` (see `lib/types.ts` RATINGS). YOLO CALL was dropped — re-add as a per-ticker static flag if a "high conviction high risk" badge is wanted.
- `sentiment` ∈ `"moon" | "up" | "neutral" | "down" | "rekt"` — derived alongside rating; sentiment is decoupled from rating so a TURBULENCE card can still glow "down" if the move is mildly negative.
- **Owners**: each ticker may have an `owners` array (Chris/Eric/Oskar) in `lib/tickers.ts`. Owner names are passed to Claude in the enriched price payload. When commenting on an owned stock, Claude weaves the friend's first name in.
