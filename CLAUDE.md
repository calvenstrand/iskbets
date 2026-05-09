# ISKBets

A WSB-flavored stock tracker. Fetches quotes for a curated Swedish + US ticker list, runs them through Claude for a Gordon-Gekko-energy take, stores the result in Vercel KV, and serves it via a public API + a dark-terminal dashboard.

## Current status

Backend and frontend are both complete; build + lint pass clean.

**Working:**

- `/api/trigger` (auth via `?key=` for manual or `Authorization: Bearer ${CRON_SECRET}` for Vercel Cron) → `fetchPrices` → optional `analyzeStocks` (gated by smart-skip logic) → `saveStockData`. Vercel Cron fires every 15 min on weekdays during market hours; the AI only re-runs when something genuinely moved.
- `/api/data` (public) reads the latest snapshot from KV
- `/` server component fetches `/api/data` on the server with `revalidate: 60`, then hands the data to a `'use client'` Dashboard
- Dashboard sub-components: one-time boot-sequence splash (CRT-style boot log, gated by sessionStorage so it plays once per browser session), ticker tape, masthead header (I$KBETS wordmark + date/issue dateline), market-status bar (5 markets — Tokyo, Hong Kong, Stockholm, London, NYC — real timezones via `Intl`; collapses to pill+code on mobile), mood banner, winner/loser featured cards, responsive grid, last-updated footer
- Bebas Neue + Share Tech Mono via `next/font/google`; design system in `app/globals.css`
- `vercel.json` sets `maxDuration: 60` on `/api/trigger` for the AI call
- Cards render gracefully when AI analysis is missing for a ticker; prices render `N/A` for non-finite values; `/` falls through to a `NO DATA YET` empty state if KV is empty or unreachable

**Known limitations:**

- Market-hours logic doesn't account for exchange holidays — only weekdays + regular session windows
- Redis layout is two keys (`iskbets:snapshot` for the data, `iskbets:lastAttempt` for the cooldown gate). No history — switching to a list/sorted-set would be a schema change.
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
/api/trigger (GET; manual ?key=TRIGGER_SECRET OR Vercel Cron Bearer ${CRON_SECRET})
  → markAttempt()        lib/storage.ts  (1-min cooldown gate)
  → fetchPrices()        lib/fetchPrices.ts  (Finnhub + Avanza)
  → shouldRerunAI()      app/api/trigger/route.ts (decides whether AI runs)
       ├─ AI run        analyzeStocks()  lib/analyzeStocks.ts
       └─ AI skipped    reuse last analysis from existing snapshot
  → saveStockData()      lib/storage.ts (Upstash Redis)

/api/data (GET, public)
  → getStockData()       lib/storage.ts → JSON
```

**Smart AI gating** (`shouldRerunAI` in `app/api/trigger/route.ts`):
The Anthropic call only fires when at least one of these is true:
1. Any ticker's `regularMarketChangePercent` shifted by **> 1pp** since the snapshot Claude last saw, AND it's been **≥ 30 min** since the last AI run.
2. **> 4 hours** since the last AI run (freshness ceiling — the `overallMood` shouldn't go stale on a flat day).
3. No prior analysis exists.

Otherwise prices are refreshed but the existing analysis is carried forward. This decouples price freshness (every 15 min) from AI cost (only when there's something new to say).

**Cron schedule** lives in `vercel.json`: `*/15 7-21 * * 1-5` UTC (every 15 min, weekdays, ~09:00–22:00 CET).

**Cooldown gate** (`iskbets:lastAttempt`) is intentionally written **before** the pipeline runs — so a partial failure (provider flake, Anthropic rate limit) still consumes the cooldown. It's now 1 min (was 30) — just spam-prevention for manual clicks; cron fires every 15 min so it's never blocked.

## KV shape

```ts
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
```

## Env vars

Documented in `.env.example`:

- `ANTHROPIC_API_KEY` — Claude SDK
- `FINNHUB_API_KEY` — Finnhub quote endpoint (US)
- `TRIGGER_SECRET` — manual `?key=` auth for `/api/trigger`
- `CRON_SECRET` — Vercel Cron auth. Set this in Vercel env vars; Vercel automatically passes it to cron requests as `Authorization: Bearer ${CRON_SECRET}`. Without it, the cron will 401 every 15 min.
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
