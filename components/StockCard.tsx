import type { CSSProperties } from "react";
import { displayTicker } from "@/lib/tickers";
import type { Sentiment, StockAnalysis, StockPrice } from "@/lib/types";

type Featured = "winner" | "loser";
type FeaturedScope = "week" | "day";

type StockCardProps = {
  stock: StockPrice;
  analysis: StockAnalysis | undefined;
  index: number;
  featured?: Featured;
  /** Whether the featured pick was selected based on week-over-week
   * performance (default) or just today's intraday move (fallback when
   * no Monday baseline exists yet). Drives the badge label. */
  featuredScope?: FeaturedScope;
  /** Week-over-week % to show as the headline number under the
   * BIGGEST WINNER / LOSER badge on featured cards. */
  featuredWeekChangePct?: number;
  /** Set true momentarily when the AI comment for this stock just changed.
   * Triggers a one-shot glow animation on the card. */
  flashing?: boolean;
  /** True when this ticker's market hasn't opened in the current
   * Stockholm calendar day. Drives the dimmed "market-closed" treatment
   * — gray border, neutral bg, reduced opacity — so live cards stand
   * out against the stale ones. */
  marketStale?: boolean;
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

export function StockCard({
  stock,
  analysis,
  index,
  featured,
  featuredScope = "week",
  featuredWeekChangePct,
  flashing,
  marketStale,
}: StockCardProps) {
  const glow = sentimentGlow(analysis?.sentiment);
  const featuredClass = featured ? `featured ${featured}` : "";
  const cardClass = [
    "stock-card",
    featuredClass,
    glow,
    flashing ? "ai-update" : null,
    // Stale-market wins over the sentiment glow visually because its
    // CSS rule has 2-class specificity (.stock-card.market-closed).
    marketStale ? "market-closed" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const style: CSSProperties = {
    animationDelay: `${index * 60}ms`,
  };

  const hasPrice = Number.isFinite(stock.regularMarketPrice);
  const glory = fromGlory(stock.regularMarketPrice, stock.fiftyTwoWeekHigh);

  const scopeLabel = featuredScope === "week" ? "WEEK" : "TODAY";
  const hasWeekChange =
    featured && Number.isFinite(featuredWeekChangePct ?? NaN);

  return (
    <article className={cardClass} style={style}>
      {featured === "winner" && (
        <div className="featured-label win">
          ▲ {scopeLabel}&apos;S BIGGEST WINNER 🚀
        </div>
      )}
      {featured === "loser" && (
        <div className="featured-label lose">
          ▼ {scopeLabel}&apos;S BIGGEST LOSER 📉
        </div>
      )}
      {hasWeekChange && (
        <div
          className={`featured-week ${changeClass(featuredWeekChangePct ?? 0)}`}
        >
          {formatChangePct(featuredWeekChangePct ?? 0)} this week
        </div>
      )}

      <div className="card-header flex items-start justify-between gap-3">
        <div>
          <div className="name">{stock.name}</div>
          <div className="ticker">{displayTicker(stock.ticker)}</div>
        </div>
        {analysis?.rating && <div className="rating">{analysis.rating}</div>}
      </div>

      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
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

      {analysis?.comment && (
        <p className="comment mt-3">&ldquo;{analysis.comment}&rdquo;</p>
      )}

      {glory && <p className="meta mt-3">{glory}</p>}
    </article>
  );
}
