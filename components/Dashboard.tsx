"use client";

import { TICKERS } from "@/lib/tickers";
import type { Brief, StockAnalysis, StockPrice, StoredData } from "@/lib/types";
import { BriefCard } from "./Brief";
import { Header } from "./Header";
import { MarketStatus } from "./MarketStatus";
import { MoodBanner } from "./MoodBanner";
import { PullToRefresh } from "./PullToRefresh";
import { StockCard } from "./StockCard";
import { TickerTape } from "./TickerTape";
import { UpdatedFooter } from "./UpdatedFooter";

type DashboardProps = {
  data: StoredData;
  morningBrief?: Brief;
  eveningBrief?: Brief;
};

// Pre-built lookup so the grid sort doesn't scan TICKERS for every card.
const OWNED_TICKERS = new Set(
  TICKERS.filter((t) => (t.owners?.length ?? 0) > 0).map((t) => t.symbol),
);

// Owners' picks bubble to the top (Chris/Eric/Oskar), then everyone else.
// Within each group, biggest gainers first.
function sortGridStocks(stocks: StockPrice[]): StockPrice[] {
  return [...stocks].sort((a, b) => {
    const aOwned = OWNED_TICKERS.has(a.ticker);
    const bOwned = OWNED_TICKERS.has(b.ticker);
    if (aOwned !== bOwned) return aOwned ? -1 : 1;
    return b.regularMarketChangePercent - a.regularMarketChangePercent;
  });
}

export function Dashboard({ data, morningBrief, eveningBrief }: DashboardProps) {
  const analysisByTicker = new Map<string, StockAnalysis>(
    data.analysis.stocks.map((a) => [a.ticker, a]),
  );

  const winnerTicker = data.analysis.biggestWinner;
  const loserTicker = data.analysis.biggestLoser;

  const winner = data.stocks.find((s) => s.ticker === winnerTicker);
  const loser = data.stocks.find((s) => s.ticker === loserTicker);

  const featuredTickers = new Set<string>();
  if (winner) featuredTickers.add(winner.ticker);
  if (loser) featuredTickers.add(loser.ticker);

  const gridStocks: StockPrice[] = sortGridStocks(
    data.stocks.filter((s) => !featuredTickers.has(s.ticker)),
  );

  const totalChangePct = data.stocks.reduce(
    (sum, s) => sum + (s.regularMarketChangePercent ?? 0),
    0,
  );
  const avgChangePct = data.stocks.length
    ? totalChangePct / data.stocks.length
    : 0;

  return (
    <main>
      <PullToRefresh />
      <TickerTape stocks={data.stocks} />
      <Header />
      <MarketStatus />
      <BriefCard morningBrief={morningBrief} eveningBrief={eveningBrief} />
      <MoodBanner mood={data.analysis.overallMood} avgChangePct={avgChangePct} />

      <section className="px-4 md:px-8 lg:px-12 mt-8 mb-12">
        {(winner || loser) && (
          <div className="stock-grid-featured gap-3 mb-6">
            {winner && (
              <StockCard
                stock={winner}
                analysis={analysisByTicker.get(winner.ticker)}
                featured="winner"
                index={0}
              />
            )}
            {loser && (
              <StockCard
                stock={loser}
                analysis={analysisByTicker.get(loser.ticker)}
                featured="loser"
                index={1}
              />
            )}
          </div>
        )}

        <div className="stock-grid gap-3">
          {gridStocks.map((stock, i) => (
            <StockCard
              key={stock.ticker}
              stock={stock}
              analysis={analysisByTicker.get(stock.ticker)}
              index={i + 2}
            />
          ))}
        </div>
      </section>

      <UpdatedFooter updatedAt={data.updatedAt} />
    </main>
  );
}
