# ISKBets

A WSB-flavored stock tracker. Fetches quotes for a curated Swedish + US ticker list, decorates them with rule-based WSB commentary (plus two surviving Claude calls), stores everything in Upstash Redis, and serves it via a public API + a dark-terminal dashboard with a per-stock detail view.

See `DESIGN.md` for the design-system reference (tokens, type, motion rules).

## Current status

Backend and frontend are both complete; build + lint + tests pass clean (`npm run typecheck && npm run lint && npm test`). Dev server: `npm run dev` (port 4242).

**Working:**

- `/api/trigger` (auth via the `x-trigger-secret` header ONLY — the legacy `?key=` query param has been removed) → `fetchPrices` (smart: skips closed-market tickers and reuses their cached prices) → `buildStaticComments` (rule-based per-ticker comments, every run) → optional `generateMood` (gated by `shouldRerunMood` in `lib/aiGating.ts`) → `saveStockData` → `maybeSaveDailySnapshot` (slim dated history snapshot every run — last write of the Stockholm day wins) → `maybeRecordDailyMood` (rolling `iskbets:moodHistory` upsert) → `maybeArchiveWeekStart` (week baseline on the first trigger of any weekday without one — resilient to Monday holidays / cron failures) → `runPostCloseWork` (daily archive 22:00–22:45 STO; Friday weekly archive + Weekly Champion AI call 22:45–23:30 STO). All idempotent; every post-save step is individually try/caught so a failure never breaks the main update. A cron-job.org job pings the endpoint every 10 min on weekdays.
- `/api/data` (public) — `getDashboardData()`: ONE Redis MGET (snapshot + weekStart + weeklyChampion + moodHistory), CDN-cached `public, s-maxage=20` (no stale-while-revalidate — see the route comment for the post-open-staleness post-mortem).
- `/api/history` (public, CDN-cached 20s). Three query modes: `?date=YYYY-MM-DD`, `?from=&to=` (inclusive, oldest→newest), `?ticker=DDOG&days=30` (per-ticker series). NB: each dated snapshot holds ALL tickers (~5 KB), so high `days` values are heavy — UI reads stay ≤ 90 days.
- `/` — server component, ISR (`revalidate = 60`). Reads storage DIRECTLY via `getDashboardData()` (not through `/api/data`) and seeds the `'use client'` Dashboard with `initialNowMs` + `initialInRecap` so the first client render is hydration-safe. The dev-only `?mode=` preview param is only read outside production — reading `searchParams` in prod would opt the page out of ISR (this bit us once; don't regress it).
- `/stock/[symbol]` — per-stock detail as BOTH a full page (ISR 60s, `generateStaticParams` over TICKERS, unknown symbols → themed 404) and an intercepting-route modal (`app/@modal/(.)stock/[symbol]`) for in-app card taps. One shared server component (`components/StockDetail.tsx`) renders the content; only the shells differ. Sections: quote header (live price/badges/take), 52-week range bar (SE only — Finnhub free tier lacks it), ownership line + leaderboard-rank link, per-ticker mood strip, ANALYST LOG (dated commentary feed with a "coverage initiated" seed row), and a price sparkline that unlocks at 30 days of receipts. Reads: 1 dashboard MGET (deduped with `generateMetadata` via React `cache()`) + 1 history MGET (90 days).
- Dynamic OG/Twitter unfurl (`app/opengraph-image.tsx`, re-exported by `twitter-image.tsx`): edge-runtime Satori card built from the live snapshot — masthead, day's mood headline, winner/loser chips (colored via the shared 5-tier `SENTIMENT_HEX`), bloodbath/clean-sweep skins. Never throws (falls back to a branded static card on Redis failure); CDN-cached via an explicit `s-maxage=60` header because the `revalidate` export doesn't work for edge metadata images.
- Dashboard sub-components: one-time boot-sequence splash (sessionStorage-gated, skipped for reduced-motion), ticker tape (scenario-biased slogans + per-ticker one-liners, tap-to-pause), masthead header, market-status bar (5 markets via `Intl` timezones), mood banner ("TODAY'S READ" + seeded sweep one-liner), always-on friend leaderboard, winner/loser featured cards (swapped for CelebrationCards during sweeps), sortable stock grid (GridSort pills, persisted to localStorage), 30-day MoodStrip ribbon, pull-to-refresh, last-updated footer, reveal-on-scroll drawer footer with a native-`<dialog>` disclaimer.
- Bloodbath / clean-sweep page skins: when every eligible stock moves one direction, `<main data-daymood>` re-points the wrong-direction `--mood-*` tokens and adds a fixed wash. The sweep predicate is defined ONCE (`detectSweep` + day-framing `detectTodaySweep` in `lib/leaderboard.ts`) and shared by the dashboard, the OG image, and the stock page; the modal picks the skin up via `body:has(main[data-daymood]) .sd-modal`.
- Bebas Neue + Share Tech Mono via `next/font/google`; design tokens in `app/globals.css` (`--surface-*`, `--text-0..3`, `--mood-*`, `--glow-mood`; legacy `--bg`/`--bg-elev`/`--text` are aliases onto the ramp pending full migration).
- `vercel.json` sets `maxDuration: 60` on `/api/trigger` for the AI call.
- Frontend never crashes on missing data: cards fall back to seeded per-ticker lines when the analyzer left no comment, prices render `N/A`, `/` falls through to `NO DATA YET`, empty history renders honest "coverage initiated" / "building history" states.

**Known limitations:**

- Session-window clocks don't know exchange holiday calendars, but `hasTradedToday` (clock floor AND a `lastTradeAt` same-Stockholm-day veto, `lib/marketHours.ts`) keeps holiday-frozen tickers out of today-framed picks, sweeps, and leaderboard scores. The remaining gap is only that `fetchPrices` may still poll providers on a holiday (harmless).
- Redis includes long-term `iskbets:archive` / `iskbets:dailyArchive` hashes not yet exposed in the dashboard — read via `listWeeklyResults` / `listDailyResults` for future history features.
- Finnhub `/quote` free tier lacks 52-week high/low and volume for US tickers, so the range bar / "FROM GLORY" line is SE-only (Avanza has it). Asymmetric but fine.
- Avanza is unofficial — per-ticker error handling in `fetchPrices` means a broken endpoint silently drops the SE cards rather than crashing the batch.
- Per-card market badge derives from clock + market, so there's no `POST` state, only `OPEN`/`PRE`/`CLOSED`.

## Stack

- Next.js 15 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`, no `any`)
- Hybrid quote source via plain `fetch`: **Finnhub** `/api/v1/quote` for US (free tier, 60 req/min), **Avanza** `/_api/market-guide/stock/{orderbookId}` for Stockholm (unofficial, no key; each SE ticker has a hardcoded `avanzaId` in `lib/tickers.ts`). Path we burned: Yahoo (429 from Vercel IPs), Twelve Data (silent 404s on Stockholm).
- `@anthropic-ai/sdk` — exactly two Claude calls remain, both `claude-sonnet-4-6`, native structured outputs, no web search:
  - OVERALL MOOD line (`lib/generateMood.ts`), gated by `shouldRerunMood` (`lib/aiGating.ts`: 90-min floor, 4pp delta, four Stockholm checkpoints, weekday-only).
  - Friday-evening WEEKLY CHAMPION recap (`lib/weeklyChampion.ts`), once a week.
  - Per-ticker comments are NOT AI: `lib/stockMessages.ts` is a static per-ticker × sentiment-bucket table with `{owner}` templating resolved against `lib/tickers.ts` ownership at lookup time.
- `@upstash/redis` — storage layer is `lib/storage.ts` and ONLY `lib/storage.ts` (nothing else may import `@upstash/redis`).
- Tailwind CSS 4 (layout utilities only — colors and typography live in `globals.css` via CSS variables)
- Vitest (`npm test`) — pure-logic libs are covered; CI (`.github/workflows/ci.yml`) runs typecheck + lint + test on push/PR.
- Deploys to Vercel.

## The friend group

`PEOPLE` in `lib/tickers.ts` is the single source of truth: **Chris, Eric, Johan, Oskar**. Each ticker may carry an `owners` array; everything (leaderboard, ownership lines, comment templating) derives from that map. Add a friend by adding one entry.

## Data flow

```
/api/trigger (GET; cron or manual — `x-trigger-secret` header ONLY)
  → markAttempt()          lib/storage.ts (1-min cooldown, written BEFORE the pipeline)
  → fetchPrices(cached)    lib/fetchPrices.ts (live-window gated; closed markets reuse cache)
  → buildStaticComments()  lib/stockMessages.ts (rule-based, every run)
  → shouldRerunMood()      lib/aiGating.ts
       ├─ yes → generateMood()  lib/generateMood.ts (Sonnet)
       └─ no  → carry forward the existing overallMood
  → pickBiggestWinnerLoser() lib/leaderboard.ts (code, not AI)
  → saveStockData()        lib/storage.ts
  → maybeSaveDailySnapshot()   (iskbets:snapshot:YYYY-MM-DD + index, 400-day trim)
  → maybeRecordDailyMood()     (iskbets:moodHistory upsert, 90-day cap)
  → maybeArchiveWeekStart()    (idempotent week baseline)
  → runPostCloseWork()
       ├─ inPostCloseWindow (Mon–Fri 22:00–22:45 STO) → maybeArchiveDailyResult()
       └─ inWeeklyArchiveWindow (Fri 22:45–23:30 STO) → maybeArchiveWeeklyResult()
                                                       + maybeGenerateWeeklyChampion() (Sonnet)

/api/data (GET, public, CDN 20s)      → getDashboardData() — ONE MGET
/api/history (GET, public, CDN 20s)   → date / range / per-ticker series modes
/ (ISR 60s)                           → getDashboardData() server-side → <Dashboard>
/stock/[symbol] (ISR 60s) + @modal    → <StockDetail> — dashboard MGET (cache()d) + 90-day history MGET
opengraph-image / twitter-image (edge)→ getDashboardData() per regeneration (s-maxage=60)
```

**Redis read budget** (protect this): dashboard render = 1 MGET; stock view = 1 MGET + 1 history MGET (`generateMetadata` shares the dashboard read via React `cache()` — cached by the mode STRING, not the options object); OG image = 1 MGET per ≤1/min regeneration. `getDashboardData` must stay a single command.

**Time windows** (all Europe/Stockholm via `Intl`, in `lib/dateUtil.ts` / `lib/marketHours.ts`, all tested):

- **Recap window** — Fri **22:30** STO (NY close + settle buffer) → Mon 09:00 STO. Featured cards flip to week framing, leaderboard becomes WEEK STANDINGS, Champion card renders, mood banner hides.
- **Post-close archive** — Mon–Fri 22:00–22:45 STO (daily archive, no AI).
- **Weekly archive + Champion** — Fri 22:45–23:30 STO (compact WeeklyResult + the one recurring AI narrative).

**Leaderboard**: always-on. Weekdays = day scope (ranked by today%, stale tickers filtered via `hasTradedToday`, gold champion hero for #1); recap window = week scope (ranked by WTD, no hero — the Champion card owns that). One parameterized `computeLeaderboard`; scope selection is `resolveLeaderboardScope` (recap window AND baseline → week) — shared by the dashboard and the stock view's "#N THIS WEEK/TODAY" link so they can't disagree.

**Seeded content** (SSR-safe, never `Math.random`): ALL string-seeded picks go through `lib/seed.ts` (`hashString` = FNV-1a + murmur finalizer, `pickSeeded`). Consumers: per-ticker lines + tape carry (`lib/tickerLines.ts`, seeded per symbol+Stockholm-date), mood-banner sweep one-liners (seeded per snapshot `updatedAt`), mock history. Tape slogans (`lib/slogans.ts`) resolve a scenario (bloodbath > clean-sweep > recap > stale > default, defined once in `resolveScenario`) and interleave scenario/default pools with a deterministic numeric roll.

**Cron schedule** lives at [cron-job.org](https://cron-job.org): `3,13,23,33,43,53 6-22 * * 1-5` UTC (~3 min after each ten-minute mark so the opening auction settles). Sends the `x-trigger-secret` header from the job config. `.github/workflows/fetch.yml` remains as a `workflow_dispatch`-only manual fallback. History: Vercel Cron → GitHub Actions (~12% delivery) → cron-job.org; 15-min → 10-min cadence (2026-05-12).

**Brief subsystem (removed)**: the three long-form briefs were cut for cost (~$0.40/week, unread). Generators live in git history (`lib/briefs.ts`, commits around May 2026). The Weekly Champion call survived because the dashboard renders it as a hero card every weekend.

## KV shape

Fixed keys (all `iskbets:` namespace), accessed only through `lib/storage.ts`:

```ts
// iskbets:snapshot — the live dashboard data
{
  stocks: StockPrice[],           // refreshed every trigger
  analysis: {                     // comments rebuilt every run; mood gated
    stocks: StockAnalysis[],
    overallMood: string,
    biggestWinner: string,
    biggestLoser: string,
  },
  updatedAt: string,              // ISO of last price refresh
  lastFetch: number,              // epoch ms of last price refresh
  moodGeneratedAt?: number,       // epoch ms of last mood (Sonnet) run
  pricesAtLastMood?: StockPrice[] // baseline for the mood-rerun decision
}
// (lastFetch / moodGeneratedAt / pricesAtLastMood are stripped from the
//  public payload — see toPublicSnapshot / PublicStoredData.)

// iskbets:lastAttempt — epoch ms cooldown gate (written pre-pipeline)

// iskbets:weekStart — { weekStart: "YYYY-MM-DD" (Monday), stocks: StockPrice[] }
//   Baseline for WTD + the Weekly Champion. Only surfaced to clients when
//   it matches THIS week's Monday (stale baselines are withheld).

// iskbets:moodHistory — MoodRecord[] (oldest→newest, 90-day cap).
//   One record per Stockholm day: overall sentiment, avgPct, per-ticker
//   sentiments. Upserted every trigger (last write wins). Backs the
//   30-day MoodStrip. Non-atomic read-modify-write — fine at cron cadence.

// iskbets:archive — HASH, field = weekStart → WeeklyResult (compact).
// iskbets:dailyArchive — HASH, field = YYYY-MM-DD → DailyResult (compact).
//   Both written by the post-close windows; not yet in any UI.

// iskbets:weeklyChampion — { weekStart, weekEnd, person, name, wtdPct,
//   line, generatedAt }. Friday's Sonnet call; pinned through the weekend.

// iskbets:snapshot:YYYY-MM-DD — slim DailySnapshot per Stockholm day
//   (per ticker: price, changePct, rating?, sentiment, comment?; plus
//   overallMood). ~5 KB/day. Written every trigger, last write wins.
// iskbets:snapshot:index — SORTED SET (member = date, score = YYYYMMDD).
//   RETENTION: 400 days — on write, overflow is deleted oldest-first,
//   key AND index member.

// DEPRECATED, safe to delete manually: iskbets:morningBrief,
//   iskbets:eveningBrief, iskbets:weekendWire, iskbets:yesterday.
```

## Env vars

Documented in `.env.example`:

- `ANTHROPIC_API_KEY` — Claude SDK (mood + weekly champion)
- `FINNHUB_API_KEY` — US quotes
- `TRIGGER_SECRET` — auth for `/api/trigger`, sent via the `x-trigger-secret` header (the only accepted form)
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — auto-injected in prod; legacy `KV_REST_API_*` names also accepted
- `USE_MOCK_DATA=true` — force mock data locally (refused in production)

## Local dev preview modes

`?mode=` on `/` (dev only — production never reads it, to keep ISR): `default` (full data), `fresh` (no baseline/champion), `empty` (NO DATA YET). Defined in `lib/mockData.ts` (`MockMode`).

## Conventions

- Strict TypeScript, no `any`. Explicit return types for lib functions.
- ALL Redis access through `lib/storage.ts`. All "what time/day is it" decisions through `lib/dateUtil.ts` / `lib/marketHours.ts` (Europe/Stockholm via `Intl` — never `toISOString().slice` or raw `getDay()`).
- All seeded/random-looking selection through `lib/seed.ts`. Client components must be deterministic at first render: seed from server props (`initialNowMs`, symbol+date) or defer to a post-mount effect.
- Per-ticker error handling in `fetchPrices`: skip the bad one, log it, keep going.
- `console.log` at key pipeline steps; API errors return `{ error, ...context }` with proper status.
- Frontend never crashes on missing data; empty states are honest (never fake a neutral).
- Tailwind for layout only; colors/typography via CSS variables in `globals.css`. New code uses the `--surface-*` / `--text-N` / `--mood-*` families (legacy `--bg`/`--text` names are aliases pending removal). The OG image's hex palette is `SENTIMENT_HEX` in `lib/derive.ts` — keep it in sync with the tokens.
- Naming trap: `Sentiment "rekt"` = ≤ -5% (fills with `--mood-liquidated`); `TickerTier "rekt"` (`lib/tickerLines.ts`) = -2..-5%; `--mood-rekt` is a TEXT color with no fill band. Check which scale you're on.
- Comments record decision history (thresholds, burned paths, post-mortems) — keep doing this; it's what makes the codebase auditable.

## WSB voice

- Persona: WSB analyst with Gordon Gekko energy. Claude only generates the `overallMood` line and the Weekly Champion recap; everything else is computed or table-driven.
- `rating` / `sentiment` derive from `regularMarketChangePercent` (`lib/derive.ts`): 🚀 TO THE MOON (>5) · 📈 BULLISH AF (2..5) · 💎 DIAMOND HANDS (0.5..2) · no badge (±0.5) · ⚠️ TURBULENCE (-0.5..-2) · 📉 GET REKT (-2..-5) · 💀 LIQUIDATED (≤-5).
- Static comments (`lib/stockMessages.ts`): one line per ticker × sentiment bucket, `{owner}` templated. Cards without a line fall back to seeded `lib/tickerLines.ts` one-liners.
- Owners' first names are woven into owned-stock copy; ownership changes in `tickers.ts` auto-sync every surface.
