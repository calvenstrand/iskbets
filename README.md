# ISKBets

A WSB-flavored stock tracker — Wall Street meets WallStreetBets. Fetches a curated list of Swedish + US tickers from Yahoo Finance, runs the snapshot through Claude for a Gordon-Gekko-energy take, stores the result in Vercel KV, and renders it as a dark Bloomberg-terminal-built-by-apes dashboard.

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
| `TWELVEDATA_API_KEY` | Twelve Data quote endpoint for Stockholm tickers — sign up at [twelvedata.com](https://twelvedata.com/) |
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
- `500` if Yahoo or Claude blew up

Read the latest snapshot at `/api/data` (no auth):

```
GET https://<your-domain>/api/data
```

The dashboard at `/` reads `/api/data` server-side and revalidates every 60 seconds.

## Stack

- Next.js 15 (App Router) + TypeScript (strict, `noUncheckedIndexedAccess`)
- Quote data via plain `fetch` to two providers: Finnhub (US tickers) + Twelve Data (Stockholm tickers)
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
  Dashboard.tsx            'use client' orchestrator
  TickerTape.tsx           scrolling marquee
  Header.tsx               WALL$TREET BETS + rotating Gekko quotes
  MarketStatus.tsx         Stockholm + NYC open/closed pips
  MoodBanner.tsx           overall portfolio sentiment
  StockCard.tsx            one stock per card
  UpdatedFooter.tsx        last-updated + ape disclaimer
lib/
  tickers.ts               hardcoded ticker list
  fetchPrices.ts           per-ticker error-isolated yahoo fetch
  analyzeStocks.ts         Claude call + JSON validation
  storage.ts               Redis wrapper
  types.ts                 shared types
```

## A word on the data source

We started on Yahoo Finance (via `yahoo-finance2` and then the public `/v8/finance/chart` endpoint), but Yahoo aggressively rate-limits Vercel's serverless IP pool — both endpoints 429'd on every request. We then went to Finnhub for everything, but Finnhub's free tier doesn't cover international markets (403 on `.ST` symbols), so Stockholm tickers couldn't resolve. The code now uses **Finnhub for US tickers** and **Twelve Data for Stockholm tickers**, both via plain `fetch`. Per-ticker errors are caught in [`lib/fetchPrices.ts`](lib/fetchPrices.ts) so a single bad ticker never crashes the batch.

## Disclaimer

This is a toy. The "analysis" is a language model riffing on numbers. Tickers may render `N/A` if Yahoo flakes out. Cards may render without analysis if Claude misses one. Nothing here is **financial advice 🦍** — apes do their own due diligence.
