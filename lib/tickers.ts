export type Ticker = {
  symbol: string;
  name: string;
  market: "SE" | "US";
  /** Avanza orderbookId — required for SE tickers (used by Avanza fetch). */
  avanzaId?: number;
};

export const TICKERS: Ticker[] = [
  // Swedish stocks — fetched via Avanza unofficial API by orderbookId
  { symbol: "INVE-B.ST", name: "Investor B", market: "SE", avanzaId: 5247 },
  { symbol: "VOLV-B.ST", name: "Volvo B", market: "SE", avanzaId: 5269 },
  { symbol: "SWED-A.ST", name: "Swedbank A", market: "SE", avanzaId: 5241 },
  { symbol: "SHB-B.ST", name: "Handelsbanken B", market: "SE", avanzaId: 5265 },
  { symbol: "ATCO-B.ST", name: "Atlas Copco B", market: "SE", avanzaId: 5235 },
  { symbol: "HM-B.ST", name: "H&M B", market: "SE", avanzaId: 5364 },
  { symbol: "DOM.ST", name: "Dometic Group", market: "SE", avanzaId: 611718 },
  { symbol: "BINV.ST", name: "BioInvent", market: "SE", avanzaId: 5505 },
  { symbol: "THULE.ST", name: "Thule Group", market: "SE", avanzaId: 521491 },
  { symbol: "CAST.ST", name: "Castellum", market: "SE", avanzaId: 5353 },
  { symbol: "NIBE-B.ST", name: "Nibe Industrier B", market: "SE", avanzaId: 5325 },
  { symbol: "DICOT.ST", name: "Dicot Pharma", market: "SE", avanzaId: 861798 },
  // WSB darlings — fetched via Finnhub
  { symbol: "NVDA", name: "Nvidia", market: "US" },
  { symbol: "TSLA", name: "Tesla", market: "US" },
  { symbol: "GME", name: "GameStop", market: "US" },
  { symbol: "PLTR", name: "Palantir", market: "US" },
  { symbol: "AMD", name: "AMD", market: "US" },
  { symbol: "COIN", name: "Coinbase", market: "US" },
  { symbol: "MSTR", name: "MicroStrategy", market: "US" },
];
