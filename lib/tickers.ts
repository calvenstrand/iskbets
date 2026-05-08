export type Ticker = {
  symbol: string;
  name: string;
  market: "SE" | "US";
};

export const TICKERS: Ticker[] = [
  // Swedish blue chips — ISK-account staples
  { symbol: "INVE-B.ST", name: "Investor B", market: "SE" },
  { symbol: "VOLV-B.ST", name: "Volvo B", market: "SE" },
  { symbol: "SEB-A.ST", name: "SEB A", market: "SE" },
  { symbol: "ATCO-A.ST", name: "Atlas Copco A", market: "SE" },
  { symbol: "HM-B.ST", name: "H&M B", market: "SE" },
  // WSB darlings
  { symbol: "NVDA", name: "Nvidia", market: "US" },
  { symbol: "TSLA", name: "Tesla", market: "US" },
  { symbol: "GME", name: "GameStop", market: "US" },
  { symbol: "PLTR", name: "Palantir", market: "US" },
  { symbol: "AMD", name: "AMD", market: "US" },
  { symbol: "COIN", name: "Coinbase", market: "US" },
  { symbol: "MSTR", name: "MicroStrategy", market: "US" },
];
