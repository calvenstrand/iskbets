// Single source of truth for the friend group. Add a new friend by adding
// one entry here; the Person type, owner lookups, and the analyzer prompt
// list all derive from this map.
export const PEOPLE = {
  chris: "Chris",
  eric: "Eric",
  johan: "Johan",
  oskar: "Oskar",
} as const;

export type Person = keyof typeof PEOPLE;

/**
 * Stockholm tickers carry a `.ST` suffix and a hyphen for the share class
 * (e.g., "VOLV-B.ST") as our internal disambiguation key. On the local
 * exchange and on Avanza they render as "VOLV B" — strip the suffix and
 * convert the hyphen to a space.
 */
export function displayTicker(ticker: string): string {
  if (ticker.endsWith(".ST")) {
    return ticker.slice(0, -3).replace("-", " ");
  }
  return ticker;
}

export type Ticker = {
  symbol: string;
  name: string;
  market: "SE" | "US";
  /** Avanza orderbookId — required for SE tickers (used by Avanza fetch). */
  avanzaId?: number;
  /** Friends who own / care about this ticker. Used to render owner chips. */
  owners?: Person[];
};

export const TICKERS: Ticker[] = [
  // Swedish stocks — fetched via Avanza unofficial API by orderbookId
  { symbol: "INVE-B.ST", name: "Investor B", market: "SE", avanzaId: 5247, owners: ["chris", "eric", "oskar"] },
  { symbol: "VOLV-B.ST", name: "Volvo B", market: "SE", avanzaId: 5269, owners: ["eric"] },
  { symbol: "SWED-A.ST", name: "Swedbank A", market: "SE", avanzaId: 5241, owners: ["oskar"] },
  { symbol: "SHB-B.ST", name: "Handelsbanken B", market: "SE", avanzaId: 5265, owners: ["chris"] },
  { symbol: "ATCO-B.ST", name: "Atlas Copco B", market: "SE", avanzaId: 5235, owners: ["eric"] },
  { symbol: "HM-B.ST", name: "H&M B", market: "SE", avanzaId: 5364 },
  { symbol: "DOM.ST", name: "Dometic Group", market: "SE", avanzaId: 611718, owners: ["eric"] },
  { symbol: "BINV.ST", name: "BioInvent", market: "SE", avanzaId: 5505 },
  { symbol: "THULE.ST", name: "Thule Group", market: "SE", avanzaId: 521491, owners: ["eric"] },
  { symbol: "CAST.ST", name: "Castellum", market: "SE", avanzaId: 5353 },
  { symbol: "NIBE-B.ST", name: "Nibe Industrier B", market: "SE", avanzaId: 5325, owners: ["eric"] },
  { symbol: "DICOT.ST", name: "Dicot Pharma", market: "SE", avanzaId: 861798, owners: ["oskar"] },
  { symbol: "VPLAY-B.ST", name: "Viaplay Group B", market: "SE", avanzaId: 945460, owners: ["eric"] },
  { symbol: "INTRUM.ST", name: "Intrum", market: "SE", avanzaId: 5583, owners: ["johan"] },
  // WSB darlings — fetched via Finnhub
  { symbol: "NVDA", name: "Nvidia", market: "US" },
  { symbol: "TSLA", name: "Tesla", market: "US" },
  { symbol: "GME", name: "GameStop", market: "US" },
  { symbol: "PLTR", name: "Palantir", market: "US", owners: ["johan"] },
  { symbol: "AMD", name: "AMD", market: "US" },
  { symbol: "COIN", name: "Coinbase", market: "US" },
  { symbol: "MSTR", name: "MicroStrategy", market: "US" },
  { symbol: "SHOP", name: "Shopify", market: "US", owners: ["chris"] },
  { symbol: "NET", name: "Cloudflare", market: "US", owners: ["chris"] },
  { symbol: "KLAR", name: "Klarna Group", market: "US", owners: ["chris"] },
  { symbol: "QBTS", name: "D-Wave Quantum", market: "US", owners: ["johan"] },
];
