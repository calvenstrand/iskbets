"use client";

import type { StockAnalysis, StockPrice, StoredData } from "@/lib/types";
import { Header } from "./Header";
import { MarketStatus } from "./MarketStatus";
import { MoodBanner } from "./MoodBanner";
import { StockCard } from "./StockCard";
import { TickerTape } from "./TickerTape";
import { UpdatedFooter } from "./UpdatedFooter";

type DashboardProps = {
  data: StoredData;
};

export function Dashboard({ data }: DashboardProps) {
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

  const gridStocks: StockPrice[] = data.stocks.filter(
    (s) => !featuredTickers.has(s.ticker),
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
      <TickerTape stocks={data.stocks} />
      <Header />
      <MarketStatus />
      <MoodBanner mood={data.analysis.overallMood} avgChangePct={avgChangePct} />

      <section className="px-4 md:px-8 lg:px-12 mt-8">
        {(winner || loser) && (
          <div
            className="grid gap-4 mb-8"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            }}
          >
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

        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          }}
        >
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
