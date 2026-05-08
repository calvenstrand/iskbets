import type { CSSProperties } from "react";
import type { MarketState, Sentiment, StockAnalysis, StockPrice } from "@/lib/types";

type Featured = "winner" | "loser";

type StockCardProps = {
  stock: StockPrice;
  analysis: StockAnalysis | undefined;
  index: number;
  featured?: Featured;
};

function formatPrice(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "N/A";
  // Use a stable, locale-independent format to avoid SSR/CSR drift.
  const fixed = value >= 100 ? value.toFixed(2) : value.toFixed(value >= 1 ? 2 : 4);
  return currency ? `${fixed}` : fixed;
}

function formatChangeAmount(value: number): string {
  if (!Number.isFinite(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatChangePct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function changeClass(value: number): string {
  if (!Number.isFinite(value)) return "change-neutral";
  if (value > 0) return "change-up";
  if (value < 0) return "change-down";
  return "change-neutral";
}

function changeArrow(value: number): string {
  if (!Number.isFinite(value)) return "·";
  if (value > 0) return "▲";
  if (value < 0) return "▼";
  return "·";
}

function marketStateLabel(s: MarketState): string {
  if (s === "REGULAR") return "OPEN";
  if (s === "PRE") return "PRE";
  if (s === "POST") return "POST";
  return "CLOSED";
}

function marketStateBadgeClass(s: MarketState): string {
  if (s === "REGULAR") return "badge badge-open";
  if (s === "PRE") return "badge badge-pre";
  if (s === "POST") return "badge badge-post";
  return "badge badge-closed";
}

function sentimentGlow(sentiment: Sentiment | undefined): string {
  if (!sentiment) return "";
  return `glow-${sentiment}`;
}

function fromGlory(price: number, high: number): string | null {
  if (!Number.isFinite(price) || !Number.isFinite(high) || high <= 0) return null;
  const pct = ((high - price) / high) * 100;
  if (pct < 0) return "ALL TIME HIGH";
  return `${pct.toFixed(1)}% FROM GLORY`;
}

export function StockCard({ stock, analysis, index, featured }: StockCardProps) {
  const glow = sentimentGlow(analysis?.sentiment);
  const featuredClass = featured ? `featured ${featured}` : "";
  const cardClass = ["stock-card", featuredClass, glow]
    .filter(Boolean)
    .join(" ");

  const style: CSSProperties = {
    animationDelay: `${index * 60}ms`,
  };

  const hasPrice = Number.isFinite(stock.regularMarketPrice);
  const glory = fromGlory(stock.regularMarketPrice, stock.fiftyTwoWeekHigh);

  return (
    <article className={cardClass} style={style}>
      {featured === "winner" && (
        <div className="featured-label win">▲ BIGGEST WINNER 🚀</div>
      )}
      {featured === "loser" && (
        <div className="featured-label lose">▼ BIGGEST LOSER 📉</div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ticker">{stock.ticker}</div>
          <div className="name">{stock.name}</div>
        </div>
        {analysis && <div className="rating">{analysis.rating}</div>}
      </div>

      <div className="mt-4 flex items-baseline gap-3 flex-wrap">
        <span className={`price ${hasPrice ? "" : "na"}`}>
          {hasPrice ? formatPrice(stock.regularMarketPrice, stock.currency) : "N/A"}
        </span>
        {hasPrice && stock.currency && (
          <span className="currency">{stock.currency}</span>
        )}
      </div>

      <div className={`mt-1 ${changeClass(stock.regularMarketChangePercent)}`}>
        {changeArrow(stock.regularMarketChangePercent)}{" "}
        {formatChangeAmount(stock.regularMarketChange)}{" "}
        ({formatChangePct(stock.regularMarketChangePercent)})
      </div>

      {analysis && (
        <p className="comment mt-4">&ldquo;{analysis.comment}&rdquo;</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <span className={marketStateBadgeClass(stock.marketState)}>
          {marketStateLabel(stock.marketState)}
        </span>
        {glory && <span className="meta">{glory}</span>}
      </div>
    </article>
  );
}
