# ISKBets

A WSB-flavored stock tracker — Wall Street meets WallStreetBets. Fetches a curated list of Swedish + US tickers (Finnhub for US, Avanza's unofficial JSON for Stockholm), runs the snapshot through Claude for a Gordon-Gekko-energy take, stores the result in Vercel KV, and renders it as a dark Bloomberg-terminal-built-by-apes dashboard.

## Local setup

```bash
git clone https://github.com/calvenstrand/iskbets.git
cd iskbets
npm install
cp .env.example .env.local        # fill in the four values
npm run dev
```

The four env vars (see [`.env.example`](.env.example)):

| Var | What it's for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude SDK — the WSB-analyst pass |
| `FINNHUB_API_KEY` | Finnhub quote endpoint for US tickers — sign up at [finnhub.io](https://finnhub.io/) |
| `TRIGGER_SECRET` | Shared secret guarding `/api/trigger` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |

For local dev, copy the `UPSTASH_REDIS_*` values from the Vercel dashboard → Storage → your Upstash database → ".env.local" tab. In production they're auto-injected. Legacy `KV_REST_API_URL` / `KV_REST_API_TOKEN` names are also accepted by the storage layer.

## Triggering a fetch

The pipeline runs on demand. Hit the trigger route:

```
GET https://<your-domain>/api/trigger?key=<TRIGGER_SECRET>
```

- `401` if the key is wrong
- `429 { error, nextAllowed, minutesRemaining }` during the 30-minute cooldown
- `200` with the saved snapshot on success
- `500` if Finnhub/Avanza or Claude blew up

Read the latest snapshot at `/api/data` (no auth):

```
GET https://<your-domain>/api/data
```

The dashboard at `/` reads `/api/data` server-side and revalidates every 60 seconds.

## Stack

- Next.js 15 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`)
- Quote data via plain `fetch` — Finnhub for US tickers, Avanza's unofficial JSON API for Stockholm tickers (no auth, hardcoded orderbookIds)
- [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) — Claude analysis
- [`@upstash/redis`](https://www.npmjs.com/package/@upstash/redis) — snapshot storage (Upstash Redis via Vercel Marketplace)
- Tailwind CSS 4 (layout utilities only) + a hand-rolled CSS design system
- `next/font/google` — Bebas Neue + Share Tech Mono
- Deploys to Vercel

## Project layout

```
app/
  api/data/route.ts        public read endpoint
  api/trigger/route.ts     auth + cooldown + pipeline
  layout.tsx               fonts + globals
  page.tsx                 server component, fetches /api/data
  globals.css              CSS variables + animations + component styles
components/
  BootSequence.tsx         CRT-style boot log shown once per session
  Dashboard.tsx            'use client' orchestrator
  TickerTape.tsx           scrolling marquee
  Header.tsx               I$KBETS masthead + date/issue dateline
  MarketStatus.tsx         5-market open/closed bar (TYO/HKG/STO/LON/NYC)
  MoodBanner.tsx           overall portfolio sentiment
  PullToRefresh.tsx        mobile pull-to-refresh gesture
  StockCard.tsx            one stock per card
  UpdatedFooter.tsx        last-updated + ape disclaimer
lib/
  tickers.ts               hardcoded ticker list
  fetchPrices.ts           per-ticker error-isolated Finnhub/Avanza fetch
  analyzeStocks.ts         Claude call + JSON validation
  derive.ts                rating/sentiment from price-change % (no LLM)
  marketHours.ts           per-exchange open/closed math via Intl
  mockData.ts              demo snapshot for non-prod (no Redis creds)
  storage.ts               Redis wrapper
  types.ts                 shared types
```

## A word on the data source

Stock quotes were a battle. We tried Yahoo (`yahoo-finance2` and the public `/v8/finance/chart` endpoint) — both 429'd from Vercel's IP pool. Finnhub free tier doesn't cover international (403 on `.ST`). Twelve Data free tier silently 404s on Stockholm despite their docs claiming coverage. The shipping configuration:

- **US tickers** → Finnhub `/quote` (free tier, real-time, 60 req/min)
- **Stockholm tickers** → [Avanza](https://www.avanza.se)'s unofficial public JSON API at `/_api/market-guide/stock/{orderbookId}` — no auth, no key, no signup. Stable for years but technically unofficial; could change. Each Swedish ticker has a hardcoded `avanzaId` in [`lib/tickers.ts`](lib/tickers.ts).

Per-ticker errors are caught in [`lib/fetchPrices.ts`](lib/fetchPrices.ts) so any one bad ticker never crashes the batch.

## Disclaimer

This is a toy. The "analysis" is a language model riffing on numbers. Tickers may render `N/A` if Finnhub or Avanza flakes out. Cards may render without analysis if Claude misses one. Nothing here is **financial advice 🦍** — apes do their own due diligence.
