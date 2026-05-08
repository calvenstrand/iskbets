import type { StockPrice } from "@/lib/types";

const SLOGANS = [
  "GREED IS GOOD",
  "DIAMOND HANDS",
  "TO THE MOON",
  "STONKS ONLY GO UP",
  "BUY HIGH SELL LOW",
  "PRINTER GO BRRR",
  "THIS IS THE WAY",
  "APES TOGETHER STRONG",
  "BTFD",
  "LFG",
  "MONEY NEVER SLEEPS",
  "BAGHOLDER NATION",
  "TENDIES INCOMING",
  "YOLO",
];

function formatPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

type TapeItem =
  | { kind: "slogan"; text: string }
  | { kind: "ticker"; ticker: string; pct: number };

function buildTape(stocks: StockPrice[]): TapeItem[] {
  const tickers: TapeItem[] = stocks.map((s) => ({
    kind: "ticker" as const,
    ticker: s.ticker,
    pct: s.regularMarketChangePercent,
  }));
  const slogans: TapeItem[] = SLOGANS.map((text) => ({
    kind: "slogan" as const,
    text,
  }));
  // Interleave: roughly one slogan per ticker
  const out: TapeItem[] = [];
  const max = Math.max(tickers.length, slogans.length);
  for (let i = 0; i < max; i++) {
    const slogan = slogans[i];
    const ticker = tickers[i];
    if (slogan) out.push(slogan);
    if (ticker) out.push(ticker);
  }
  return out;
}

function renderItem(item: TapeItem, key: string) {
  if (item.kind === "slogan") {
    return (
      <span key={key} className="tape-item">
        <span className="tape-diamond">◆</span> {item.text}
      </span>
    );
  }
  const cls = item.pct >= 0 ? "tape-up" : "tape-down";
  return (
    <span key={key} className="tape-item">
      <span className="tape-diamond">◆</span>
      <span>{item.ticker}</span>
      <span className={cls}>{formatPct(item.pct)}</span>
    </span>
  );
}

export function TickerTape({ stocks }: { stocks: StockPrice[] }) {
  const items = buildTape(stocks);
  // Duplicate the items so the marquee loop is seamless
  return (
    <div className="tape" aria-label="Ticker tape">
      <div className="tape-track">
        {items.map((it, i) => renderItem(it, `a-${i}`))}
        {items.map((it, i) => renderItem(it, `b-${i}`))}
      </div>
    </div>
  );
}
