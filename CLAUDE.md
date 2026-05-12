# ISKBets

A WSB-flavored stock tracker. Fetches quotes for a curated Swedish + US ticker list, runs them through Claude for a Gordon-Gekko-energy take, stores the result in Vercel KV, and serves it via a public API + a dark-terminal dashboard.

## Current status

Backend and frontend are both complete; build + lint pass clean.

**Working:**

- `/api/trigger` (auth via `x-trigger-secret` header — or legacy `?key=` query param) → `fetchPrices` (smart: skips closed-market tickers and reuses their cached prices) → optional `analyzeStocks` (gated by smart-skip logic) → `saveStockData` → `maybeArchiveWeekStart` (writes the week baseline on the first trigger of any weekday that doesn't already have one — resilient to Monday holidays / Monday cron failures) → optional brief generation (morning at 08:00 CET, evening at 22:00 CET, weekend wire Friday 22:45 CET; all idempotent). A cron-job.org scheduled job pings the endpoint every 10 min on weekdays; off-hours fires are near-instant since they're pure cache passthrough.
- `/api/data` (public) reads the latest snapshot + all three briefs + a compact `weekStartPrices` map from KV; CDN-cached via `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` so the polling client doesn't drain Upstash
- `/` server component fetches `/api/data` on the server with `revalidate: 60`, then hands the data to a `'use client'` Dashboard
- Dashboard sub-components: one-time boot-sequence splash (CRT-style boot log, gated by sessionStorage so it plays once per browser session), ticker tape, masthead header (I$KBETS wordmark + date/issue dateline), market-status bar (5 markets — Tokyo, Hong Kong, Stockholm, London, NYC — real timezones via `Intl`; collapses to pill+code on mobile), brief card (most-recent of morning / evening / weekend), mood banner, friend leaderboard (per-friend today% + WTD%), winner/loser featured cards, responsive grid, last-updated footer
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
- `@anthropic-ai/sdk` — analysis (model: `claude-sonnet-4-6`, no web search; data is passed in; uses native structured outputs via `output_config.format`)
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
  → maybeGenerateBriefs() (idempotent, time-windowed)
       ├─ inMorningBriefWindow → generateMorningBrief() (reads yesterday)
       ├─ inEveningBriefWindow → archive yesterday + generateEveningBrief()
       │                         + maybeArchiveDailyResult() (compact daily archive)
       └─ inWeekendWireWindow (Friday only) → generateWeekendWire() (reads weekStart)
                                              + maybeArchiveWeeklyResult() (compact weekly archive)
                                              + maybeGenerateWeeklyChampion() (separate AI call, recap of WTD leader)

/api/data (GET, public, CDN-cached 60s)
  → getDashboardData()   lib/storage.ts → { snapshot, morningBrief?, eveningBrief?, weekendBrief?, weeklyChampion?, weekStartPrices? }
```

**Smart AI gating** (`shouldRerunAI` in `app/api/trigger/route.ts`):
The Anthropic call only fires when at least one of these is true:
1. Any ticker's `regularMarketChangePercent` shifted by **> 1pp** since the snapshot Claude last saw, AND it's been **≥ 30 min** since the last AI run.
2. **> 4 hours** since the last AI run (freshness ceiling — the `overallMood` shouldn't go stale on a flat day).
3. No prior analysis exists.

Otherwise prices are refreshed but the existing analysis is carried forward. This decouples price freshness (every 10 min) from AI cost (only when there's something new to say).

**Cron schedule** lives at [cron-job.org](https://cron-job.org): `3,13,23,33,43,53 6-22 * * 1-5` UTC (every 10 min on weekdays, `:03`-style offset so each tick lands ~3 min after each ten-minute mark). The offsets are chosen to land shortly after market opens — Stockholm opens at 09:00 STO (= 08:00 UTC winter / 07:00 UTC summer), so the `:03` tick fires 3 min after open. 3 min vs 1 min gives the opening auction time to settle and Finnhub/Avanza time to start returning sensible intraday `dp` values instead of zero. Same logic for NY's 15:30 STO open → 15:33 STO tick. The window covers ~07:00–00:00 CET / ~08:00–01:00 CEST so the morning brief (08:00 CET), evening brief (22:00 CET), and weekend wire (Fri 22:45 CET) windows always have multiple fires inside them in either DST mode. The job sends GET to `https://www.iskbets.se/api/trigger` with the `x-trigger-secret` header set from a private cron-job.org config (timeout 90s, response logged to job history).

Cadence history: 15 min → 10 min (bumped 2026-05-12 — more headroom for fresher data without straining Upstash quotas; client polling stays at 5 min so users see at most one cron cycle of staleness).

Migration history: Vercel Cron → GitHub Actions (free, but ~12% delivery rate during business hours due to scheduling backlog) → cron-job.org (proper second-level reliability, free tier, web dashboard with manual fire button).

`.github/workflows/fetch.yml` still exists as a `workflow_dispatch`-only fallback: lets us fire a trigger from the GitHub Actions tab if cron-job.org is ever down or we need a quick manual run. No `schedule:` block on it anymore.

**Live-window gating in `fetchPrices`** (`isMarketLive` in `lib/marketHours.ts`): for each ticker, check whether its market is currently in a "live data" window — open + 30 min post-close buffer. Inside the window: fetch fresh from Finnhub/Avanza. Outside: reuse the cached price from the previous snapshot, no API call. Bootstrap edge case: if a ticker has no cached price yet (very first cron run, or a newly added ticker), fetch regardless of window. Result: cron fires outside market hours are essentially free no-ops; only the markets actually trading hit the network.

**Briefs**:

Long-form analyst messages generated on a recurring cadence:

- **Morning Wire** — fires once between 08:00–08:30 Stockholm time (~1 hour before market open). Reads from `iskbets:yesterday` (the snapshot archived at the previous evening's brief) and reflects on yesterday's close + sets up today. Idempotent per Stockholm calendar day.
- **Evening Wrap** — fires once between 22:00–22:45 Stockholm time (after NY close). Wraps up today's action and archives the current snapshot to `iskbets:yesterday` for tomorrow's morning brief. Idempotent per Stockholm calendar day.
- **Weekend Wire** — fires once Friday 22:45–23:30 Stockholm time. Recaps the WHOLE WEEK using `iskbets:weekStart` (the snapshot archived on the first trigger of any weekday this week) as the baseline. Idempotent per *week* — keyed on the Monday's date. Lives there until Monday's morning wire takes over.

All three are stored under separate Redis keys; each stores its own `date`, and the BriefCard rotates to whichever was most recently generated. Morning is gold, evening is cyan, weekend is purple. Brief generation is wrapped in try/catch in the trigger route — a brief failure never breaks the snapshot save.

**Friend leaderboard**: per-friend daily/WTD performance, computed in `lib/leaderboard.ts` from the snapshot + `weekStartPrices` map. Renders above the brief. WTD column gracefully hides when no Monday baseline exists yet (e.g. very first deploy or if Monday's archive missed). Sort is descending by today's % change. Champion (#1) gets a hero treatment with a gold gradient + glow + 👑 LEADER badge; each card shows a top + bottom mover so the story behind the number is visible.

**Champion of the Week**: separate gold card pinned above the leaderboard. Generated once a week alongside the Weekend Wire (Friday 22:45–23:30 STO) by a dedicated Anthropic call. Targets the friend with the highest **WTD%** at end of week — the actual week champion, which can differ from today's #1. Persists through the weekend until next Friday's call overwrites it. Title shows the date range so it's always clear which week it covers.

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
// iskbets:morningBrief — { date: "YYYY-MM-DD", text: string, generatedAt: number }
// iskbets:eveningBrief — same shape as morningBrief
// iskbets:weekendWire   — same shape; `date` is the week's Monday (YYYY-MM-DD)
// iskbets:yesterday — copy of the snapshot at evening-brief time, used by next morning's brief
// iskbets:weekStart — { weekStart: "YYYY-MM-DD" (Monday), stocks: StockPrice[] }
//                     archived on the first weekday trigger of the week that
//                     doesn't already have a baseline (typically Monday morning;
//                     falls forward to Tue+ if Monday is a holiday or cron failed).
//                     Baseline for the leaderboard WTD column and the Weekend
//                     Wire's week-over-week recap.

// iskbets:archive — Redis HASH. Field name = weekStart (YYYY-MM-DD).
//                   Field value = WeeklyResult (compact: per-stock weekChangePct,
//                   per-friend WTD%, Friday's overallMood, optional wireText).
//                   Written Friday evening after the wire fires. Idempotent per
//                   week. Read via `listWeeklyResults(limit?)` from lib/storage.
//                   Future home for history graphs / yearly recap / monthly
//                   leaderboards. NOT in /api/data — pull via a new endpoint
//                   when needed.

// iskbets:dailyArchive — Redis HASH. Field name = date (YYYY-MM-DD STO).
//                   Field value = DailyResult (compact: per-stock close +
//                   changePct, per-friend dayPct, today's overallMood).
//                   Written by the evening-wrap branch (22:00–22:45 STO).
//                   Idempotent per Stockholm calendar day. Read via
//                   `listDailyResults(limit?)`. Foundation for future
//                   per-stock charts, day-by-day leaderboards, volatility
//                   stats. NOT in /api/data — pull when needed.

// iskbets:weeklyChampion — { weekStart, weekEnd, person, name, wtdPct,
//                            line, generatedAt }. Champion of the week
//                            recap, generated alongside the Weekend Wire
//                            on Friday evening. Targets the WTD leader
//                            (highest WTD%, which can differ from today's
//                            #1 on the live leaderboard). Pinned through
//                            the weekend, overwritten next Friday.
//                            Surfaced in /api/data; rendered as a gold
//                            card above the leaderboard.
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
