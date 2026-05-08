export type Ticker = {
  symbol: string;
  name: string;
  market: "SE" | "US";
};

export const TICKERS: Ticker[] = [
  // Swedish
  { symbol: "INVE-B.ST", name: "Investor B", market: "SE" },
  { symbol: "SWED-A.ST", name: "Swedbank A", market: "SE" },
  { symbol: "ABB.ST", name: "ABB", market: "SE" },
  { symbol: "SAND.ST", name: "Sandvik", market: "SE" },
  { symbol: "ASSA-B.ST", name: "Assa Abloy B", market: "SE" },
  { symbol: "HEICO.ST", name: "Heico", market: "SE" },
  { symbol: "PARADOX.ST", name: "Paradox Interactive", market: "SE" },
  // US
  { symbol: "NET", name: "Cloudflare", market: "US" },
  { symbol: "DDOG", name: "Datadog", market: "US" },
  { symbol: "IONQ", name: "IonQ", market: "US" },
  { symbol: "SHOP", name: "Shopify", market: "US" },
  { symbol: "GOOGL", name: "Alphabet A", market: "US" },
];
