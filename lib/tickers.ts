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
  {
    symbol: "INVE-B.ST",
    name: "Investor B",
    market: "SE",
    avanzaId: 5247,
    owners: ["chris", "johan", "oskar"],
  },
  {
    symbol: "VOLV-B.ST",
    name: "Volvo B",
    market: "SE",
    avanzaId: 5269,
  },
  {
    symbol: "SWED-A.ST",
    name: "Swedbank A",
    market: "SE",
    avanzaId: 5241,
    owners: ["oskar"],
  },
  {
    symbol: "SHB-B.ST",
    name: "Handelsbanken B",
    market: "SE",
    avanzaId: 5265,
    owners: ["chris"],
  },
  {
    symbol: "ATCO-B.ST",
    name: "Atlas Copco B",
    market: "SE",
    avanzaId: 5235,
  },
  {
    symbol: "HM-B.ST",
    name: "H&M B",
    market: "SE",
    avanzaId: 5364,
  },
  {
    symbol: "DOM.ST",
    name: "Dometic Group",
    market: "SE",
    avanzaId: 611718,
    owners: ["eric"],
  },
  {
    symbol: "BINV.ST",
    name: "BioInvent",
    market: "SE",
    avanzaId: 5505,
    owners: ["eric"],
  },
  {
    symbol: "THULE.ST",
    name: "Thule Group",
    market: "SE",
    avanzaId: 521491,
    owners: ["eric"],
  },
  {
    symbol: "CAST.ST",
    name: "Castellum",
    market: "SE",
    avanzaId: 5353,
  },
  {
    symbol: "NIBE-B.ST",
    name: "Nibe Industrier B",
    market: "SE",
    avanzaId: 5325,
    owners: ["eric", "johan"],
  },
  {
    symbol: "DICOT.ST",
    name: "Dicot Pharma",
    market: "SE",
    avanzaId: 861798,
    owners: ["oskar"],
  },
  {
    symbol: "VPLAY-B.ST",
    name: "Viaplay Group B",
    market: "SE",
    avanzaId: 945460,
    owners: ["eric"],
  },
  {
    symbol: "INTRUM.ST",
    name: "Intrum",
    market: "SE",
    avanzaId: 5583,
    owners: ["johan"],
  },
  {
    symbol: "HACK.ST",
    name: "Hacksaw Gaming",
    market: "SE",
    avanzaId: 2094659,
    owners: ["chris"],
  },
  {
    symbol: "BETS-B.ST",
    name: "Betsson B",
    market: "SE",
    avanzaId: 5482,
    owners: ["eric"],
  },
  {
    symbol: "LUND-B.ST",
    name: "Lundbergs B",
    market: "SE",
    avanzaId: 5375,
    owners: ["eric"],
  },
  {
    symbol: "LATO-B.ST",
    name: "Latour B",
    market: "SE",
    avanzaId: 5321,
    owners: ["eric"],
  },
  {
    symbol: "SES.ST",
    name: "Scandinavian Enviro Systems",
    market: "SE",
    avanzaId: 487396,
    owners: ["oskar"],
  },
  {
    symbol: "ACCON.ST",
    name: "Acconeer",
    market: "SE",
    avanzaId: 808452,
    owners: ["oskar"],
  },
  {
    symbol: "FLAT-B.ST",
    name: "Flat Capital B",
    market: "SE",
    avanzaId: 1292424,
    owners: ["chris", "oskar"],
  },
  // WSB darlings — fetched via Finnhub
  {
    symbol: "NVDA",
    name: "Nvidia",
    market: "US",
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    market: "US",
  },
  {
    symbol: "GME",
    name: "GameStop",
    market: "US",
  },
  {
    symbol: "PLTR",
    name: "Palantir",
    market: "US",
    owners: ["johan"],
  },
  {
    symbol: "AMD",
    name: "AMD",
    market: "US",
  },
  {
    symbol: "COIN",
    name: "Coinbase",
    market: "US",
  },
  {
    symbol: "MSTR",
    name: "MicroStrategy",
    market: "US",
  },
  {
    symbol: "SHOP",
    name: "Shopify",
    market: "US",
    owners: ["chris"],
  },
  {
    symbol: "NET",
    name: "Cloudflare",
    market: "US",
    owners: ["chris"],
  },
  {
    symbol: "QBTS",
    name: "D-Wave Quantum",
    market: "US",
    owners: ["johan"],
  },
  {
    symbol: "GOOG",
    name: "Alphabet",
    market: "US",
    owners: ["chris", "oskar"],
  },
  {
    symbol: "DDOG",
    name: "Datadog",
    market: "US",
    owners: ["chris"],
  },
  {
    symbol: "DFTX",
    name: "Definium Therapeutics",
    market: "US",
    owners: ["oskar"],
  },
  {
    symbol: "JOBY",
    name: "Joby Aviation",
    market: "US",
    owners: ["johan"],
  },
  {
    symbol: "IONQ",
    name: "IonQ",
    market: "US",
    owners: ["chris", "johan"],
  },
  {
    symbol: "RDDT",
    name: "Reddit",
    market: "US",
    owners: ["chris"],
  },
];

/** Maps each person to the tickers they own. Derived from TICKERS so it
 * stays in sync automatically as the ticker list grows. */
export function buildOwnersByPerson(): Map<Person, string[]> {
  const map = new Map<Person, string[]>();
  for (const t of TICKERS) {
    for (const owner of t.owners ?? []) {
      const existing = map.get(owner) ?? [];
      existing.push(t.symbol);
      map.set(owner, existing);
    }
  }
  return map;
}
