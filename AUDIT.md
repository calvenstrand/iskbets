# ISKBets Codebase Audit — 2026-07-10

Read-only review after the three-week expansion (design tokens, card rebuild, skins,
always-on leaderboard, snapshot history, OG image, tape slogans, ticker lines, stock
detail view). Gates at audit time: `typecheck` ✅, `lint` ✅, `vitest` ✅ (141 tests,
13 files). No hydration violations found. Price source is **Finnhub + Avanza** (the
"yahoo-finance2" in the audit brief is outdated; CLAUDE.md is right, `yahoo-finance2`
appears nowhere in the lockfile).

Severity: **P0** broken / will break · **P1** drift that will hurt soon · **P2** hygiene.

---

## P0

### P0-1 · The dashboard page is silently dynamic — `revalidate = 60` is inert
**`app/page.tsx:10` + `app/page.tsx:35`.** The page exports `revalidate = 60` ("at most
once per minute") but unconditionally awaits `searchParams` for the dev-only `?mode=`
preview. In Next 15, reading `searchParams` opts the route into request-time dynamic
rendering, so the ISR export does nothing: **every page view runs `getDashboardData()` =
4 Redis commands** (see P1-1), with no CDN caching of the HTML. The documented budget is
one cached read per minute; the real behavior scales linearly with traffic and quietly
eats the Upstash free tier the `/api/data` comments (`app/api/data/route.ts:26-29`)
assume is protected.
**Fix:** don't touch `searchParams` in production — gate the mock-mode read behind
`process.env.NODE_ENV !== "production"` (or move previews to a dev-only route) so the
page is statically regenerated again.

### P0-2 · Stock view reads the entire 400-day, all-ticker history to plot one ticker
**`components/StockDetail.tsx:25,117` → `lib/storage.ts:437-441`;
`app/api/history/route.ts:18,54`.** `HISTORY_DAYS = 400` triggers
`getRecentDailySnapshots(400)`: a ZRANGE + one **MGET over up to 400 keys**, each
`DailySnapshot` ~5 KB and containing *every* ticker — ~2 MB per read at the retention
cap, to extract a single ticker's series. It works today (history is young) and the
page is ISR'd, but the payload grows daily until it hits Upstash REST response limits,
at which point `.catch(() => [])` silently blanks the mood strip / analyst log /
sparkline with no error anywhere. The same worst case is publicly reachable via
`/api/history?ticker=X&days=400` (`MAX_DAYS = 400`).
**Fix:** cap the detail-view read (~90 days covers the strip + the 30-receipt sparkline
gate) now; store a compact per-ticker series key if/when full-depth charts are wanted.

---

## P1

### P1-1 · Redis reads: duplicated `getDashboardData()` + 4 GETs where 1 MGET would do
- **`app/stock/[symbol]/page.tsx:36` + `components/StockDetail.tsx:116`** both call
  `getDashboardData()` in the same render pass; nothing in `lib/storage.ts` is wrapped
  in React `cache()`, and Upstash calls aren't deduped like `fetch`. A full stock-page
  regeneration = 4 + 4 + 2 = **10 commands** vs the stated 2-read budget (modal path: 6).
- **`lib/storage.ts:468-474`**: `getDashboardData` is `Promise.all` of four separate
  GETs (snapshot, weekStart, weeklyChampion, moodHistory) — four REST round-trips per
  consumer (`/`, `/api/data`, stock page ×2, OG image).
**Fix:** wrap `getDashboardData` in React `cache()`, and collapse the four GETs into one
`MGET` (they're all plain string keys). Together with P0-1 this restores the documented
budget everywhere.

### P1-2 · Four seeded-selection implementations, zero shared utilities
The audit question "one seeding utility or three near-copies?" — it's **four
independent ones**:
1. `lib/tickerLines.ts:110-123` — FNV-1a + murmur3 finalizer (the good one, documented).
2. `lib/slogans.ts:134` — ad-hoc arithmetic roll `(s*31 + i*131) % 100`.
3. `components/MoodBanner.tsx:41-47` — `h*31 + charCode` string hash (`pickLine`).
4. `lib/mockData.ts:958-966` — second FNV-1a copy (`hash01`), no finalizer.
All are individually SSR-safe, but each new feature has invented its own hash, and the
weaker ones (3, 4) have exactly the low-bit clustering the tickerLines comment warns
about. (`lib/stockMessages.ts` is fine — it's a static 1:1 table, not seeded.)
**Fix:** extract `lib/seed.ts` (`hashString(seed): number` + `pick(pool, seed)`), port
all four callers; tickerLines' implementation is the one to keep.

### P1-3 · Day/week scope resolution is forked between dashboard and stock view
**`components/StockDetail.tsx:79-99`** (`ownerRank`) switches to week scope whenever a
Monday baseline exists (`useWeek = !!weekStartPrices` — i.e. all week from Monday
morning), while the dashboard's leaderboard (`components/Dashboard.tsx:340-438`)
switches on the **recap window** (Fri 22:30 → Mon 09:00 STO). Mid-week, the detail page
links "👑 #1 THIS WEEK" while the visible leaderboard ranks by today — same friend,
different rank, same click. The scoring itself is *not* forked (single parameterized
`computeLeaderboard`, `lib/leaderboard.ts:69` — day scope applies `hasTradedToday`,
week scope correctly doesn't), only the scope *choice* is.
**Fix:** share one `resolveLeaderboardScope(now, weekStartPrices)` helper (recap-window
semantics) between Dashboard and `ownerRank`.

### P1-4 · Day-mood skin doesn't reach the modal or the stock page
- **`app/layout.tsx:186-190`** renders the `@modal` slot as a **sibling** of
  `{children}` — outside `<main data-daymood>`. The skin's re-pointed `--mood-*` tokens
  and the fixed wash (`app/globals.css:752-812`) therefore never apply inside the modal;
  the doc comment in `components/StockDetailModal.tsx:13-16` claiming the skin "is
  inherited automatically" is wrong (only the dimmed backdrop see-through is).
- **`app/stock/[symbol]/page.tsx:57`** renders its own `<main className="sd-page">`
  with no `data-daymood` — on a bloodbath day, opening a card as a modal keeps the
  event framing around it; refreshing that URL silently drops it.
**Fix:** compute the sweep in the stock page / detail shell too (it already reads the
same snapshot) and stamp `data-daymood` there; fix or implement the modal claim.

### P1-5 · Tier→color mapping diverges across surfaces, and "rekt" means two things
- **Bands:** the site's fills use `deriveSentiment` (5 tiers: `down` spans **-0.5..-5 →
  orange `--mood-down`**; `rekt` ≤ -5 → `--mood-liquidated`, `lib/derive.ts:42-71`). The
  OG image (`app/opengraph-image.tsx:67-72`) uses **2 tiers per side**: any loser above
  -5% gets red `#e9483d` (= `--mood-rekt`), any winner below +5% gets green — so a
  -1.2% "biggest loser" is orange on the site and red on the unfurl; a +0.2% "winner"
  is gold-neutral on site, green on OG. Its comment ("same magnitude encoding as the
  site's featured cards") also overstates: the featured cards use flat `--green`/`--red`
  brand colors, not the mood ramp.
- **Naming:** `Sentiment "rekt"` = ≤ -5% (`lib/derive.ts:48`) but `TickerTier "rekt"` =
  **-2..-5%** (`lib/tickerLines.ts:101`), and the `--mood-rekt` token has *no* fill band
  at all (`moodVar` maps sentiment-rekt to `--mood-liquidated`; `--mood-rekt` is used
  only as readable *text* red, `app/globals.css:1222-1241`). Nothing is visually wrong
  today, but the same word naming three different bands is exactly how the next commit
  ships a mismatch.
- **Hex fidelity:** the OG hex table matches the documented equivalents in
  `globals.css:24-38` verbatim (`#d7e6dd`, `#7c8a83`, `#33f5a0`, `#53c48e`, `#e9483d`,
  `#b7162d`, `#252e2a`, `#0d1110`) — the oklch→hex conversions themselves weren't
  re-derived numerically, but the two tables agree.
**Fix:** give OG the same 5-tier mapping via a tiny shared `sentimentHex` table exported
next to `moodVar`; rename `TickerTier` members (`dip`/`rekt`/`liquidated` or similar) so
"rekt" means one band.

### P1-6 · Token migration is half-finished — two live families with duplicate values
`app/globals.css:3-45` defines both the legacy set and the new ramp, and **both are
heavily consumed**: `--text` ×17 / `--text-dim` ×22 / `--text-faint` ×6 / `--bg` ×4 /
`--bg-elev` ×9 / `--border-bright` ×5, alongside `--text-0..3` (×8/10/15/6) and
`--surface-0..2` (×8/6/4). Values are near or exact duplicates: `--bg` ≡ `--surface-0`
(#080b0a), `--bg-elev` ≡ `--surface-1` (#0d1110), `--text` #d8e6dc vs `--text-0`
#d7e6dd (one digit apart). New components pick whichever family the author happened to
see. (`--green`/`--gold`/`--red` are legitimately a separate brand-accent family.)
**Fix:** alias the legacy names to the ramp (`--text: var(--text-0)` etc.) in one
commit, migrate call sites opportunistically, then delete the aliases.

### P1-7 · Top untested code by blast radius
Well-tested: derive, leaderboard/detectSweep, marketHours, dateUtil, mood, slogans,
tickerLines, stockDetail shaping, stockMessages coverage, aiGating, snapshot-history
storage (nice in-memory Redis fake in `lib/snapshotHistory.test.ts`).
Untested, ranked:
1. **`lib/fetchPrices.ts`** — provider parsing, live-window gating, cached-price reuse,
   bootstrap fetch. Per-ticker error handling means a regression *silently drops
   tickers from the site*; nothing would fail loudly.
2. **`app/api/trigger/route.ts` orchestration (~280 lines)** — the six `maybe*` steps,
   window gating, idempotency keys, cooldown. A regression here loses archives/history
   permanently (the data-loss surface of the whole app), and only the pure helpers it
   calls are tested.
3. **`components/Dashboard.tsx` selection logic** — `sortGridStocks`, featured
   winner/loser slot fallbacks, sweep eligibility, week-framing map. Pure and easily
   extractable to `lib/`, currently only exercised by eyeballing the browser.

### P1-8 · `inRecapWindow` opens at 22:30 but every document says 22:00
**`lib/dateUtil.ts:55-75`**: the code checks `Fri minutes >= 22*60 + 30`; the function's
own docblock says "Spans from Friday's NY close (22:00 STO)", and Dashboard comments,
`components/CelebrationCard.tsx:50`, `components/Leaderboard.tsx` docs, and CLAUDE.md
all say **22:00**. The test title (`dateUtil.test.ts`) says 22:30, so the code appears
intentional and the prose is wrong everywhere.
**Fix:** one sweep updating every "Fri 22:00" comment to 22:30 (or change the code —
but pick one).

### P1-9 · Dashboard client fetch on initial load
**`hooks/usePollDashboard.ts:135-138`** fires `refresh()` (a `fetch("/api/data")`)
immediately on mount, duplicating data the server just rendered (≤80s stale worst
case); `visibilitychange` + `focus` handlers also both fire on tab return
(double-fetch). CDN absorbs it (`s-maxage=20`), but it violates the "no client fetch on
load" rule and is pure duplication.
**Fix:** start with the interval only; merge/debounce the focus+visibility handlers.
(`PullToRefresh` is clean — gesture-only `router.refresh()`.)

---

## P2

### Documentation
- **CLAUDE.md is stale in at least ten ways:** (1) friend list says Chris/Eric/Oskar —
  `lib/tickers.ts:4-9` has **Johan** (Jesper/William removed); (2) no mention of
  `/stock/[symbol]`, the `@modal` intercepting route, `opengraph-image`/`twitter-image`,
  `manifest`/`robots`/`sitemap`/`not-found`; (3) component list predates MoodStrip,
  StockDetail(+Modal), StockMoodStrip, AnalystLog, GridSort, PullToRefresh,
  CelebrationCard, DisclaimerDialog, DrawerFooter, and the `hooks/` dir; (4) KV shape
  omits `iskbets:moodHistory` (`lib/storage.ts:25,284-308`); (5) `shouldRerunAI` is now
  `shouldRerunMood` in `lib/aiGating.ts`, and snapshot fields are
  `moodGeneratedAt`/`pricesAtLastMood`, not `analyzedAt`/`pricesAtLastAnalysis`;
  (6) legacy `?key=` auth no longer exists — `app/api/trigger/route.ts:47-55` is
  header-only (`.env.example` is already correct); (7) "`/` fetches `/api/data` on the
  server" — it calls `getDashboardData()` directly; (8) leaderboard described as
  recap-window-only — it's always-on with a day scope; (9) recap window 22:00 vs 22:30
  (P1-8); (10) "market-hours logic doesn't account for exchange holidays" — partially
  obsolete since the `lastTradeAt` holiday veto (`lib/marketHours.ts:96-131`). Also
  unmentioned: DESIGN.md, the CI workflow, dev port 4242, tape slogans / ticker lines /
  skins / OG subsystems.
- **`app/layout.tsx:34-35`**: site `DESCRIPTION` still sells "daily morning/evening
  market briefs" (subsystem removed) — feeds `<meta name="description">` *and* the
  JSON-LD the file itself warns about. Comments at :121,127 also reference
  `opengraph-image.jpg`/`twitter-image.jpg` (they're `.tsx`).
- **`hooks/usePollDashboard.ts:68`** comment references `?mode=weekend` — not a valid
  `MockMode` (`default`/`fresh`/`empty`, `lib/mockData.ts:21-30`).

### Code hygiene
- **`app/api/trigger/route.ts:66-339`** — ~280 lines of pipeline orchestration in the
  route file; a `lib/pipeline.ts` would leave a thin auth+cooldown shell (and make P1-7
  item 2 testable).
- **`lib/storage.ts:290-292`** — `recordDailyMood` is a non-atomic read-modify-write
  (GET → merge → SET); cron cadence makes collisions unlikely and it self-heals, but
  note it. **`lib/storage.ts:349-368`** — `saveDailySnapshot` is 3-6 sequential
  round-trips; an Upstash pipeline would make it one.
- **Duplicated micro-helpers:** the `MONTHS` abbreviation array exists 4× (
  `lib/stockDetail.ts`, `components/MoodStrip.tsx`, `components/StockMoodStrip.tsx`,
  `components/AnalystLog.tsx`) + `MONTH_ABBR` in `UpdatedFooter.tsx`; `fmtPct`/
  `formatPct`/`formatChangePct` ≈6 copies; the launch epoch `Date.UTC(2025, 5, 1)` is
  defined in both `components/Header.tsx:5` and `app/opengraph-image.tsx:162`
  (currently consistent — keep it that way by sharing it).
- **Four independent clocks:** `useNow` (60s), `Header` (60s), `MarketStatus` (30s),
  `UpdatedFooter` (30s) each run their own interval + SSR-placeholder pattern.
  Consolidating on `useNow` would also delete three placeholder branches.
- **`components/StockDetail.tsx:74`** — `statusPip` returns `"sd-pip-closed"`, a class
  no CSS rule defines (harmless: base `.sd-pip` covers it). `AnalystLog.tsx:66` colors
  exactly-0% moves `sd-up` where every other `changeClass` treats 0 as flat.
  `StockDetail.tsx:130` uses UTC month for the coverage-marker fallback (STO would be
  consistent; drift only near month boundaries).
- **`app/globals.css:583`** — `.market-bar { background: #06090807 }`: an 8-digit hex
  with alpha `07` (~3% opaque, i.e. effectively transparent). Looks like a typo'd
  `#060908`; decide and token-ize. A handful of other in-CSS literals
  (`#090c0b`, `#0a0e0c` gradients, `rgba(120,130,125,.25)` in `.market-closed`) predate
  the token system; components themselves are literal-free (the craft sweep held — no
  hex/rgb/oklch in any `.tsx` outside the OG image's documented Satori table).

### Accessibility (post-sweep additions)
- **`components/TickerTape.tsx:120-124`** — the marquee duplicates the full item list
  for the seamless loop with no `aria-hidden` on the second copy, and the whole tape is
  one `role="button"` whose accessible name/content is hundreds of words read twice.
  Mark copy B `aria-hidden="true"`; consider a separate small pause control.
- Reduced-motion coverage on new work is otherwise good (modal, PTR spinner, mood strip
  static by design, boot skips entirely; the tape's always-on animation is an explicit,
  documented decision with tap-to-pause as the escape hatch).
- Modal focus story is solid (trap, Esc, restore, `aria-modal`); `.sd-modal-close` and
  `.sort-pill` rely on border-color change + `outline: none` for `:focus-visible` —
  acceptable but the green-dim border is a subtle ring; worth a contrast pass.

### Suppressions
Only 7 in the repo, all justified: 4 `as unknown as` inside the test-only Redis fake
(`lib/snapshotHistory.test.ts`), 3 `eslint-disable @typescript-eslint/no-unused-vars`
for the destructure-to-drop pattern in `toPublicSnapshot` (`lib/storage.ts:502-506`).
No `@ts-ignore`/`@ts-expect-error`/`any` anywhere.

---

## Confirmed clean (checked, no action)
- **Single Redis access point** — only `lib/storage.ts` imports `@upstash/redis`; lazy
  singleton; legacy `KV_REST_API_*` fallback centralized.
- **Snapshot retention trim is correct** (`lib/storage.ts:358-374`): oldest-first,
  deletes key *and* index member, no off-by-one, drains backlogs.
- **Trigger failure isolation holds** — all six post-save steps individually try/caught;
  live snapshot saved before any of them; cooldown written first.
- **`detectSweep` + `resolveScenario` are each defined once** (`lib/leaderboard.ts:219`,
  `lib/slogans.ts:94`) with the priority order (bloodbath > clean-sweep > recap > stale)
  encoded and tested in exactly one place; OG intentionally consumes only the sweep tier.
- **Leaderboard scoring is one parameterized path** with the traded-today filter in day
  scope (P1-3 is about scope *selection*, not scoring).
- **Page/modal shells share one `StockDetail`** with no content divergence (modal
  correctly skips `generateMetadata`; `@modal/default.tsx` returns null).
- **No dead components** — all 20 components and all libs have importers; no superseded
  card variants or static OG asset ship (`public/` = icons + logo only; the logo is
  referenced by `og:logo`/manifest).
- **OG image**: never-throws fallback card on Redis failure, fonts loaded per-render on
  edge, explicit `s-maxage=60` header replacing the inert-on-edge `revalidate` export
  (with a comment explaining the footgun); `twitter-image.tsx` re-exports the renderer
  instead of duplicating it.
- **Timezone discipline** — every window/date key goes through `Intl` with
  `Europe/Stockholm` (or the exchange's own zone); no `toISOString().slice` dates, no
  raw `getDay()` in decision paths. `hasTradedToday` = clock floor AND `lastTradeAt`
  holiday veto, fully tested.
- **Hydration** — every time/random-dependent client render is either seeded from the
  server (`initialNowMs`, symbol+date seeds, snapshot `updatedAt`) or deferred behind a
  post-mount state (`Header`, `MarketStatus`, `UpdatedFooter` placeholders;
  `BootSequence` sessionStorage in effects; `useGridSort` seeds "chaos" then reads
  localStorage post-mount). No `Math.random`/free-running `Date.now()` in first paint.

---

## Proposed follow-up commits (smallest independent units, in order)
1. `fix(page)`: gate the `?mode=` searchParams read out of production on `/` → restores
   ISR (P0-1).
2. `perf(storage)`: React `cache()` around `getDashboardData` + collapse its 4 GETs to
   one MGET (P1-1).
3. `perf(stock-view)`: `HISTORY_DAYS` 400 → 90; drop `/api/history` `MAX_DAYS` or
   document the payload cost (P0-2).
4. `fix(skin)`: stamp `data-daymood` on the stock page; correct the StockDetailModal
   skin claim (implement or reword) (P1-4).
5. `refactor(seed)`: extract `lib/seed.ts`; port tickerLines/slogans/MoodBanner/mockData
   (P1-2).
6. `fix(scope)`: shared `resolveLeaderboardScope` for Dashboard + StockDetail `ownerRank`
   (P1-3).
7. `fix(colors)`: shared 5-tier `sentimentHex` for the OG image; rename `TickerTier`
   bands so "rekt" is one thing (P1-5).
8. `chore(tokens)`: alias legacy `--text/--bg/*` onto the ramp, then migrate + delete
   (P1-6).
9. `a11y(tape)`: `aria-hidden` the duplicate loop copy; extract the pause control (P2).
10. `test`: fetchPrices; extract + test trigger pipeline; extract `sortGridStocks` +
    featured-slot selection into `lib/` with tests (P1-7).
11. `docs`: CLAUDE.md rewrite (keys, routes, components, Johan, header-only auth, 22:30
    window), layout `DESCRIPTION`, stray comments (P1-8/P2).
12. `fix(poll)`: drop the on-mount refresh; merge focus/visibility handlers (P1-9).

---

## Three things this codebase does well — protect these
1. **The layered market-time model** (`lib/marketHours.ts` + `lib/dateUtil.ts`). Every
   "what time is it" question goes through `Intl` in the right zone; there are four
   *deliberately distinct* predicates (strict session, broad live-window, opened-today
   clock floor, `lastTradeAt` holiday veto), each with a docstring explaining why it
   exists and which caller should use it, and all of them are tested — including DST
   edges. New time-dependent features should extend this file, never inline a clock.
2. **Failure isolation + idempotency in the trigger pipeline.** The live snapshot is
   saved first; every archival step is individually try/caught and keyed idempotent on
   the Stockholm day/week; the cooldown is burned before the pipeline so partial
   failures can't stampede. One Redis client, one storage module, zero Redis access
   anywhere else. This is why a flaky provider has never corrupted history — keep the
   pattern for every new write path.
3. **Honest states + server-seeded determinism, with history-preserving comments.**
   Missing data is always *shown as missing* (mood-strip holes "never faked as neutral",
   the analyst log's "coverage initiated" seed row, `N/A` prices, WTD "pending Monday
   baseline"), and every client render is deterministic from server-provided seeds
   (`initialNowMs`, symbol+date). Alongside that, the comments record *decision history*
   ("threshold history: 1 → 2pp", "path we burned: Yahoo…", the SWR-removal post-mortem
   in `/api/data`) — which is exactly what made this audit tractable. Future commits
   should keep writing comments like that.
