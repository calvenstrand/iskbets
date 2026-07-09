import { deriveRating, deriveSentiment } from "./derive";
import { stockholmMondayOfWeek } from "./dateUtil";
import type {
  DailyResult,
  DailySnapshot,
  DailySnapshotStock,
  DashboardData,
  StockAnalysis,
  StockPrice,
  StoredData,
  WeeklyChampion,
  WeeklyResult,
  WeekStartSnapshot,
} from "./types";

/** Local-only preview modes driven by `?mode=X` on the URL. Pure dev
 * affordance — has no effect in production (mock branch never fires
 * with real Redis configured). */
export type MockMode =
  | "default" // populated dashboard, weekly champion + WTD baseline present
  | "fresh" // first-deploy: no week-start baseline → no WTD, no weekly champion
  | "empty"; // null dashboard data → "NO DATA YET" state

const VALID_MODES: ReadonlySet<string> = new Set([
  "default",
  "fresh",
  "empty",
]);

/** Parse a query param value into a MockMode. Falls back to "default" for
 * unknown values so a typo doesn't blow up. */
export function parseMockMode(raw: string | string[] | undefined): MockMode {
  if (typeof raw !== "string") return "default";
  return VALID_MODES.has(raw) ? (raw as MockMode) : "default";
}

const STOCKS: StockPrice[] = [
  // ============== US — WSB darlings ==============
  {
    ticker: "NVDA",
    name: "Nvidia",
    currency: "USD",
    regularMarketPrice: 142.85,
    regularMarketChange: 9.07,
    regularMarketChangePercent: 6.8,
    regularMarketVolume: 235_000_000,
    averageDailyVolume3Month: 180_000_000,
    fiftyTwoWeekHigh: 148.0,
    fiftyTwoWeekLow: 84.5,
    marketState: "REGULAR",
  },
  {
    ticker: "TSLA",
    name: "Tesla",
    currency: "USD",
    regularMarketPrice: 428.6,
    regularMarketChange: 19.61,
    regularMarketChangePercent: 4.8,
    regularMarketVolume: 92_000_000,
    averageDailyVolume3Month: 78_000_000,
    fiftyTwoWeekHigh: 488.5,
    fiftyTwoWeekLow: 178.0,
    marketState: "REGULAR",
  },
  {
    ticker: "GME",
    name: "GameStop",
    currency: "USD",
    regularMarketPrice: 22.85,
    regularMarketChange: -2.32,
    regularMarketChangePercent: -9.2,
    regularMarketVolume: 18_500_000,
    averageDailyVolume3Month: 9_400_000,
    fiftyTwoWeekHigh: 64.83,
    fiftyTwoWeekLow: 9.95,
    marketState: "REGULAR",
  },
  {
    ticker: "PLTR",
    name: "Palantir",
    currency: "USD",
    regularMarketPrice: 72.4,
    regularMarketChange: 2.18,
    regularMarketChangePercent: 3.1,
    regularMarketVolume: 45_000_000,
    averageDailyVolume3Month: 62_000_000,
    fiftyTwoWeekHigh: 84.0,
    fiftyTwoWeekLow: 21.0,
    marketState: "REGULAR",
  },
  {
    ticker: "AMD",
    name: "AMD",
    currency: "USD",
    regularMarketPrice: 132.6,
    regularMarketChange: 2.34,
    regularMarketChangePercent: 1.8,
    regularMarketVolume: 38_000_000,
    averageDailyVolume3Month: 45_000_000,
    fiftyTwoWeekHigh: 187.0,
    fiftyTwoWeekLow: 116.0,
    marketState: "PRE",
  },
  {
    ticker: "COIN",
    name: "Coinbase",
    currency: "USD",
    regularMarketPrice: 278.4,
    regularMarketChange: -4.24,
    regularMarketChangePercent: -1.5,
    regularMarketVolume: 11_200_000,
    averageDailyVolume3Month: 9_800_000,
    fiftyTwoWeekHigh: 343.0,
    fiftyTwoWeekLow: 142.5,
    marketState: "REGULAR",
  },
  {
    ticker: "MSTR",
    name: "MicroStrategy",
    currency: "USD",
    regularMarketPrice: 382.1,
    regularMarketChange: 4.53,
    regularMarketChangePercent: 1.2,
    regularMarketVolume: 14_500_000,
    averageDailyVolume3Month: 18_200_000,
    fiftyTwoWeekHigh: 543.0,
    fiftyTwoWeekLow: 184.0,
    marketState: "REGULAR",
  },
  {
    ticker: "SHOP",
    name: "Shopify",
    currency: "USD",
    regularMarketPrice: 110.4,
    regularMarketChange: 2.7,
    regularMarketChangePercent: 2.5,
    regularMarketVolume: 7_840_000,
    averageDailyVolume3Month: 6_200_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "NET",
    name: "Cloudflare",
    currency: "USD",
    regularMarketPrice: 124.5,
    regularMarketChange: 4.56,
    regularMarketChangePercent: 3.8,
    regularMarketVolume: 12_500_000,
    averageDailyVolume3Month: 8_400_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "QBTS",
    name: "D-Wave Quantum",
    currency: "USD",
    regularMarketPrice: 12.85,
    regularMarketChange: 1.62,
    regularMarketChangePercent: 14.4,
    regularMarketVolume: 28_400_000,
    averageDailyVolume3Month: 14_800_000,
    fiftyTwoWeekHigh: 14.2,
    fiftyTwoWeekLow: 1.18,
    marketState: "REGULAR",
  },
  {
    ticker: "GOOG",
    name: "Alphabet",
    currency: "USD",
    regularMarketPrice: 198.4,
    regularMarketChange: 2.36,
    regularMarketChangePercent: 1.2,
    regularMarketVolume: 22_400_000,
    averageDailyVolume3Month: 28_300_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "DDOG",
    name: "Datadog",
    currency: "USD",
    regularMarketPrice: 132.6,
    regularMarketChange: 2.81,
    regularMarketChangePercent: 2.2,
    regularMarketVolume: 4_100_000,
    averageDailyVolume3Month: 3_700_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "DFTX",
    name: "Definium Therapeutics",
    currency: "USD",
    regularMarketPrice: 4.85,
    regularMarketChange: -0.42,
    regularMarketChangePercent: -8.0,
    regularMarketVolume: 1_240_000,
    averageDailyVolume3Month: 980_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "JOBY",
    name: "Joby Aviation",
    currency: "USD",
    regularMarketPrice: 8.42,
    regularMarketChange: 0.31,
    regularMarketChangePercent: 3.8,
    regularMarketVolume: 12_400_000,
    averageDailyVolume3Month: 9_800_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "IONQ",
    name: "IonQ",
    currency: "USD",
    regularMarketPrice: 38.6,
    regularMarketChange: 2.85,
    regularMarketChangePercent: 7.97,
    regularMarketVolume: 18_400_000,
    averageDailyVolume3Month: 14_200_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  // ============== Sweden — ISK staples ==============
  {
    ticker: "INVE-B.ST",
    name: "Investor B",
    currency: "SEK",
    regularMarketPrice: 285.4,
    regularMarketChange: 3.94,
    regularMarketChangePercent: 1.4,
    regularMarketVolume: 1_240_000,
    averageDailyVolume3Month: 1_800_000,
    fiftyTwoWeekHigh: 302.0,
    fiftyTwoWeekLow: 240.5,
    marketState: "REGULAR",
  },
  {
    ticker: "VOLV-B.ST",
    name: "Volvo B",
    currency: "SEK",
    regularMarketPrice: 312.7,
    regularMarketChange: 2.48,
    regularMarketChangePercent: 0.8,
    regularMarketVolume: 1_580_000,
    averageDailyVolume3Month: 2_100_000,
    fiftyTwoWeekHigh: 335.0,
    fiftyTwoWeekLow: 248.0,
    marketState: "CLOSED",
  },
  {
    ticker: "SWED-A.ST",
    name: "Swedbank A",
    currency: "SEK",
    regularMarketPrice: 218.4,
    regularMarketChange: -1.56,
    regularMarketChangePercent: -0.7,
    regularMarketVolume: 1_980_000,
    averageDailyVolume3Month: 2_400_000,
    fiftyTwoWeekHigh: 235.0,
    fiftyTwoWeekLow: 182.0,
    marketState: "CLOSED",
  },
  {
    ticker: "SHB-B.ST",
    name: "Handelsbanken B",
    currency: "SEK",
    regularMarketPrice: 124.9,
    regularMarketChange: 0.45,
    regularMarketChangePercent: 0.4,
    regularMarketVolume: 2_300_000,
    averageDailyVolume3Month: 2_700_000,
    fiftyTwoWeekHigh: 132.0,
    fiftyTwoWeekLow: 102.5,
    marketState: "CLOSED",
  },
  {
    ticker: "ATCO-B.ST",
    name: "Atlas Copco B",
    currency: "SEK",
    regularMarketPrice: 162.3,
    regularMarketChange: 1.21,
    regularMarketChangePercent: 0.7,
    regularMarketVolume: 1_870_000,
    averageDailyVolume3Month: 2_100_000,
    fiftyTwoWeekHigh: 178.0,
    fiftyTwoWeekLow: 138.5,
    marketState: "REGULAR",
  },
  {
    ticker: "HM-B.ST",
    name: "H&M B",
    currency: "SEK",
    regularMarketPrice: 153.6,
    regularMarketChange: -3.62,
    regularMarketChangePercent: -2.3,
    regularMarketVolume: 3_400_000,
    averageDailyVolume3Month: 3_900_000,
    fiftyTwoWeekHigh: 198.0,
    fiftyTwoWeekLow: 142.0,
    marketState: "POST",
  },
  {
    ticker: "DOM.ST",
    name: "Dometic Group",
    currency: "SEK",
    regularMarketPrice: 33.28,
    regularMarketChange: 0.42,
    regularMarketChangePercent: 1.3,
    regularMarketVolume: 1_120_000,
    averageDailyVolume3Month: 1_400_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "BINV.ST",
    name: "BioInvent",
    currency: "SEK",
    regularMarketPrice: 23.15,
    regularMarketChange: -0.85,
    regularMarketChangePercent: -3.5,
    regularMarketVolume: 540_000,
    averageDailyVolume3Month: 720_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "THULE.ST",
    name: "Thule Group",
    currency: "SEK",
    regularMarketPrice: 240.8,
    regularMarketChange: 4.85,
    regularMarketChangePercent: 2.1,
    regularMarketVolume: 380_000,
    averageDailyVolume3Month: 510_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "CAST.ST",
    name: "Castellum",
    currency: "SEK",
    regularMarketPrice: 120.8,
    regularMarketChange: -1.32,
    regularMarketChangePercent: -1.1,
    regularMarketVolume: 1_240_000,
    averageDailyVolume3Month: 1_500_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "NIBE-B.ST",
    name: "Nibe Industrier B",
    currency: "SEK",
    regularMarketPrice: 42.42,
    regularMarketChange: 0.91,
    regularMarketChangePercent: 2.2,
    regularMarketVolume: 4_200_000,
    averageDailyVolume3Month: 5_100_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "DICOT.ST",
    name: "Dicot Pharma",
    currency: "SEK",
    regularMarketPrice: 0.2684,
    regularMarketChange: -0.0382,
    regularMarketChangePercent: -12.5,
    regularMarketVolume: 8_300_000,
    averageDailyVolume3Month: 4_200_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "VPLAY-B.ST",
    name: "Viaplay Group B",
    currency: "SEK",
    regularMarketPrice: 1.85,
    regularMarketChange: -0.08,
    regularMarketChangePercent: -4.2,
    regularMarketVolume: 6_400_000,
    averageDailyVolume3Month: 4_800_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "INTRUM.ST",
    name: "Intrum",
    currency: "SEK",
    regularMarketPrice: 32.4,
    regularMarketChange: -0.83,
    regularMarketChangePercent: -2.5,
    regularMarketVolume: 980_000,
    averageDailyVolume3Month: 1_300_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "BETS-B.ST",
    name: "Betsson B",
    currency: "SEK",
    regularMarketPrice: 128.5,
    regularMarketChange: 1.28,
    regularMarketChangePercent: 1.0,
    regularMarketVolume: 850_000,
    averageDailyVolume3Month: 1_100_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "LUND-B.ST",
    name: "Lundbergs B",
    currency: "SEK",
    regularMarketPrice: 582.0,
    regularMarketChange: -1.75,
    regularMarketChangePercent: -0.3,
    regularMarketVolume: 95_000,
    averageDailyVolume3Month: 140_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "LATO-B.ST",
    name: "Latour B",
    currency: "SEK",
    regularMarketPrice: 274.6,
    regularMarketChange: 2.19,
    regularMarketChangePercent: 0.8,
    regularMarketVolume: 180_000,
    averageDailyVolume3Month: 240_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "SES.ST",
    name: "Scandinavian Enviro Systems",
    currency: "SEK",
    regularMarketPrice: 1.42,
    regularMarketChange: -0.08,
    regularMarketChangePercent: -5.3,
    regularMarketVolume: 2_400_000,
    averageDailyVolume3Month: 1_800_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "FLAT-B.ST",
    name: "Flat Capital B",
    currency: "SEK",
    regularMarketPrice: 8.98,
    regularMarketChange: 0.18,
    regularMarketChangePercent: 2.0,
    regularMarketVolume: 320_000,
    averageDailyVolume3Month: 480_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
  {
    ticker: "HACK.ST",
    name: "Hacksaw Gaming",
    currency: "SEK",
    regularMarketPrice: 124.5,
    regularMarketChange: 4.2,
    regularMarketChangePercent: 3.5,
    regularMarketVolume: 320_000,
    averageDailyVolume3Month: 410_000,
    fiftyTwoWeekHigh: 0,
    fiftyTwoWeekLow: 0,
    marketState: "REGULAR",
  },
];

// Hand-written WSB comments for the tickers worth talking about. Tickers
// not in this map get no comment (mirrors what Claude does in production).
const COMMENTS: Record<string, string> = {
  NVDA: "Jensen printing tendies, AI apes feast tonight",
  TSLA: "Elon tweeted, robotaxis loaded, full port long",
  GME: "Pump dumped, paper hands fleeing, bagholders crying",
  PLTR: "Johan's PLTR mooning, Karp's army marching",
  QBTS: "Johan's QBTS qubits printing +14%, quantum chads",
  "INTRUM.ST": "Johan's Intrum sliding, debt-collection bagholders rekt",
  "HM-B.ST": "Fast fashion fading, paper bag holders eternal",
  "BINV.ST": "Eric's BioInvent on the FDA rollercoaster, bagholders praying",
  NET: "Chris's Cloudflare ripping faces, AI infra moon",
  SHOP: "Chris's Shopify printing tendies, ATH in sight",
  "THULE.ST": "Eric's roof boxes printing, Volvo dad approves",
  "NIBE-B.ST": "Eric's heat pumps go brrr, Swedish saviour",
  "DICOT.ST": "Oskar's Dicot apes vaporized at 25 öre",
  "VPLAY-B.ST": "Eric's Viaplay sinking, paper hands fleeing",
  "INVE-B.ST": "the syndicate's Investor B grinding +1.4%, Wallenberg blessing",
  GOOG: "two apes' GOOG printing, Gemini cooking the comp",
  DDOG: "Chris's DDOG +2.2%, observability bag fed",
  DFTX: "Oskar's DFTX -8%, biotech bagholder gets another lesson",
  "HACK.ST": "Chris's Hacksaw +3.5%, slot machines printing tendies",
  JOBY: "Johan's Joby +3.8%, flying cars actually printing",
  IONQ: "two apes' IonQ +8%, quantum bag printing",
  "BETS-B.ST": "Eric's Betsson +1%, casino prints in any weather",
  "LUND-B.ST": "Eric's Lundbergs napping, old-money patience",
  "LATO-B.ST": "Eric's Latour grinding +0.8%, industrial discipline",
  "SES.ST": "Oskar's Enviro Systems -5%, ESG dream burning fossil",
  "FLAT-B.ST": "two apes' Flat Capital +2%, OpenAI/SpaceX wrapper printing",
};

const OVERALL_MOOD =
  "Chris's Cloudflare moons while Eric's Viaplay tanks and Oskar's Dicot apes get fully vaporized — typical Tuesday in the trenches.";

function pickWinnerLoser(stocks: StockPrice[]): {
  winner: string;
  loser: string;
} {
  let winner = stocks[0];
  let loser = stocks[0];
  for (const s of stocks) {
    if (
      !winner ||
      s.regularMarketChangePercent > winner.regularMarketChangePercent
    ) {
      winner = s;
    }
    if (
      !loser ||
      s.regularMarketChangePercent < loser.regularMarketChangePercent
    ) {
      loser = s;
    }
  }
  return { winner: winner?.ticker ?? "", loser: loser?.ticker ?? "" };
}

export function getMockData(): StoredData {
  const now = Date.now();

  const analysis: StockAnalysis[] = STOCKS.map((s) => {
    const comment = COMMENTS[s.ticker];
    const rating = deriveRating(s.regularMarketChangePercent);
    return {
      ticker: s.ticker,
      ...(rating ? { rating } : {}),
      sentiment: deriveSentiment(s.regularMarketChangePercent),
      ...(comment ? { comment } : {}),
    };
  });

  const { winner, loser } = pickWinnerLoser(STOCKS);

  return {
    stocks: STOCKS,
    analysis: {
      stocks: analysis,
      overallMood: OVERALL_MOOD,
      biggestWinner: winner,
      biggestLoser: loser,
    },
    updatedAt: new Date(now).toISOString(),
    lastFetch: now,
  };
}

// Per-ticker offset: weekStart price = today * (1 - WEEK_DELTA[ticker]).
// Hand-picked so each friend's leaderboard column tells a story —
// Chris is up, Eric mixed, Oskar down, Johan winning.
const WEEK_DELTA: Record<string, number> = {
  // Chris's bag — winning
  "INVE-B.ST": 0.025,
  "SHB-B.ST": 0.018,
  SHOP: 0.062,
  NET: 0.094,
  "FLAT-B.ST": 0.041,
  DDOG: 0.057,
  GOOG: 0.034,
  "HACK.ST": 0.082,
  // Eric — mixed
  "DOM.ST": 0.034,
  "THULE.ST": 0.045,
  "NIBE-B.ST": -0.022,
  "VPLAY-B.ST": -0.083,
  "BETS-B.ST": 0.028,
  "LUND-B.ST": -0.011,
  "LATO-B.ST": 0.019,
  // Unowned but still in the universe
  "VOLV-B.ST": 0.012,
  "ATCO-B.ST": 0.008,
  // Oskar — bagholder week
  "SWED-A.ST": -0.015,
  "DICOT.ST": -0.184,
  DFTX: -0.142,
  "SES.ST": -0.078,
  // Johan — quantum chads
  "INTRUM.ST": -0.04,
  PLTR: 0.078,
  QBTS: 0.124,
  JOBY: 0.062,
  IONQ: 0.142,
  // Unowned, just for color
  NVDA: 0.099,
  TSLA: 0.045,
  GME: -0.062,
  AMD: 0.014,
  COIN: -0.024,
  MSTR: 0.018,
  "HM-B.ST": -0.038,
  "BINV.ST": -0.092,
  "CAST.ST": -0.011,
};

export function getMockWeekStartSnapshot(): WeekStartSnapshot {
  const monday = stockholmMondayOfWeek(new Date());
  const stocks: StockPrice[] = STOCKS.map((s) => {
    const delta = WEEK_DELTA[s.ticker] ?? 0;
    return {
      ...s,
      // Reverse-derive Monday's open: today = monday * (1 + delta).
      regularMarketPrice: s.regularMarketPrice / (1 + delta),
    };
  });
  return { weekStart: monday, stocks };
}

// ============== Mock dashboard aggregator (driven by ?mode=X) ==============

/**
 * One-stop mock for `getDashboardData`. Reads the requested preview
 * mode and assembles the full DashboardData accordingly. Pure dev
 * affordance — only ever called from the mock branch in storage.ts.
 *
 * Modes:
 *  - "default" → populated dashboard, weekly champion + WTD baseline present
 *  - "fresh"   → no week-start, no weekly champion (first deploy)
 *  - "empty"   → returns null (NO DATA YET state)
 *
 * To preview the recap-mode layout (Champion + WEEK STANDINGS
 * side-by-side), run the dashboard during the actual recap window
 * (Fri 22:00 → Mon 09:00 STO) — inRecapWindow keys off real time.
 */
export function getMockDashboardData(mode: MockMode): DashboardData | null {
  if (mode === "empty") return null;

  const snapshot = getMockData();

  // "fresh" hides the week-baseline data so the dashboard renders the
  // pre-Monday-archive fallback state: leaderboard hides WTD column,
  // featured cards fall back to today's biggest mover, no champion-of-
  // week card. Useful for previewing first-deploy / missed-archive UX.
  const includeWeekData = mode !== "fresh";

  let weekStartPrices: Record<string, number> | undefined;
  if (includeWeekData) {
    const ws = getMockWeekStartSnapshot();
    weekStartPrices = Object.fromEntries(
      ws.stocks.map((s) => [s.ticker, s.regularMarketPrice]),
    );
  }

  const weeklyChampion = includeWeekData ? getMockWeeklyChampion() : null;

  return {
    snapshot,
    ...(weeklyChampion ? { weeklyChampion } : {}),
    ...(weekStartPrices ? { weekStartPrices } : {}),
  };
}

/** Mock weekly champion for dev mode. Targets the WTD leader given
 * the WEEK_DELTA fixture (Chris, dragged up by NET +9.4% / SHOP +6.2%
 * / HACK +8.2% / DDOG +5.7%). Update when WEEK_DELTA changes so the
 * card matches the leaderboard math. */
export function getMockWeeklyChampion(): WeeklyChampion {
  const monday = stockholmMondayOfWeek(new Date());
  const [y, m, d] = monday.split("-").map(Number);
  let weekEnd = monday;
  if (y && m && d) {
    const friday = new Date(Date.UTC(y, m - 1, d + 4));
    const yy = friday.getUTCFullYear();
    const mm = String(friday.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(friday.getUTCDate()).padStart(2, "0");
    weekEnd = `${yy}-${mm}-${dd}`;
  }
  return {
    weekStart: monday,
    weekEnd,
    person: "chris",
    name: "Chris",
    wtdPct: 5.16,
    line: "Chris ate this week alive — NET +9.4% and HACK +8.2% printing tendies while everybody else's bag took naps. The syndicate's tech tilt finally paying. Eric's industrials grinded sideways but the gang knows who's wearing the crown until Monday's open.",
    generatedAt: Date.now() - 2 * 60 * 60 * 1000, // 2h ago
  };
}

/** Five trading days of fake history so dev mode returns realistic data
 * from `listDailyResults` end-to-end. Hand-picked numbers so each day
 * tells a slightly different story. */
export function getMockDailyResults(): DailyResult[] {
  const today = new Date();
  const todayMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;

  // Each day: per-ticker change% delta map. Stocks not in a day's map
  // get a small random-ish move from a fixed offset.
  const dayDeltas: Array<{ daysBack: number; mood: string; deltas: Record<string, number> }> = [
    {
      daysBack: 1,
      mood: "Chris's tech bag printing tendies, NET +5.4% leading the gang.",
      deltas: { NET: 5.4, SHOP: 2.1, DDOG: 3.2, "HACK.ST": 2.8, QBTS: -1.8, "DICOT.ST": -2.4 },
    },
    {
      daysBack: 2,
      mood: "Eric's industrials carried the day. Volvo + Atlas both bid.",
      deltas: { "VOLV-B.ST": 2.4, "ATCO-B.ST": 1.9, "THULE.ST": 3.1, NVDA: -0.8, GME: -3.2 },
    },
    {
      daysBack: 3,
      mood: "Bagholders' day. Almost everything red except QBTS quantum-printing.",
      deltas: { QBTS: 8.2, PLTR: 1.4, NET: -2.1, SHOP: -3.4, "DICOT.ST": -5.8, DFTX: -4.2 },
    },
    {
      daysBack: 4,
      mood: "Tuesday grind. Mixed action. Nothing dramatic.",
      deltas: { "INVE-B.ST": 0.8, NVDA: 1.2, TSLA: -1.4, "VPLAY-B.ST": -2.1 },
    },
    {
      daysBack: 5,
      mood: "Monday open. Flat Capital popped on SpaceX revaluation. Rest sideways.",
      deltas: { "FLAT-B.ST": 6.4, "INVE-B.ST": 1.1, GOOG: 0.4, AMD: 1.8, "BINV.ST": -2.4 },
    },
  ];

  return dayDeltas.map(({ daysBack, mood, deltas }) => {
    const dt = new Date(todayMs - daysBack * 86_400_000);
    const stocks = STOCKS.filter((s) => Number.isFinite(s.regularMarketPrice)).map(
      (s) => ({
        ticker: s.ticker,
        name: s.name,
        currency: s.currency,
        close: s.regularMarketPrice,
        changePct: deltas[s.ticker] ?? 0,
      }),
    );
    // Per-friend: simple mean of owned-ticker changePct.
    const friends = [
      { person: "chris", name: "Chris" },
      { person: "eric", name: "Eric" },
      { person: "johan", name: "Johan" },
      { person: "oskar", name: "Oskar" },
    ].map(({ person, name }) => ({
      person,
      name,
      dayPct: 0, // Could compute from deltas + ownership; left at 0 for the demo.
    }));
    return {
      date: fmt(dt),
      capturedAt: todayMs - daysBack * 86_400_000 + 22 * 3600_000,
      stocks,
      friends,
      overallMood: mood,
    };
  });
}

/** Three weeks of fake history so dev mode shows what `listWeeklyResults`
 * returns without needing real cron fires. Hand-picked numbers tell a
 * rough story: Chris dominant week 1, Eric leading week 2, Johan wild
 * week 3 thanks to QBTS. */
export function getMockWeeklyResults(): WeeklyResult[] {
  const monday = stockholmMondayOfWeek(new Date());
  const [y, m, d] = monday.split("-").map(Number);
  if (!y || !m || !d) return [];
  // Narrowing doesn't propagate into the closure below; capture locally.
  const yy = y;
  const mm = m;
  const dd = d;

  function shiftDate(daysBack: number): { ws: string; we: string } {
    const ms = Date.UTC(yy, mm - 1, dd - daysBack);
    const wsd = new Date(ms);
    const wed = new Date(ms + 4 * 86_400_000);
    const fmt = (dt: Date) =>
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    return { ws: fmt(wsd), we: fmt(wed) };
  }

  const w1 = shiftDate(7); // last week
  const w2 = shiftDate(14);
  const w3 = shiftDate(21);

  const baseStocks = (deltaMap: Record<string, number>) =>
    STOCKS.map((s) => ({
      ticker: s.ticker,
      name: s.name,
      currency: s.currency,
      fridayClose: s.regularMarketPrice,
      weekChangePct: (deltaMap[s.ticker] ?? 0) * 100,
    }));

  return [
    {
      weekStart: w1.ws,
      weekEnd: w1.we,
      capturedAt: Date.now() - 3 * 86_400_000,
      stocks: baseStocks({
        NET: 0.094,
        SHOP: 0.062,
        DDOG: 0.057,
        "HACK.ST": 0.082,
        QBTS: 0.124,
        "DICOT.ST": -0.184,
        DFTX: -0.142,
        "VPLAY-B.ST": -0.083,
      }),
      friends: [
        { person: "chris", name: "Chris", tickers: [], wtdPct: 5.4 },
        { person: "johan", name: "Johan", tickers: [], wtdPct: 3.1 },
        { person: "eric", name: "Eric", tickers: [], wtdPct: 0.4 },
        { person: "oskar", name: "Oskar", tickers: [], wtdPct: -7.2 },
      ],
      overallMood:
        "Chris's tech bag printed tendies all week while Oskar's biotech apes got vaporized on both sides of the Atlantic.",
    },
    {
      weekStart: w2.ws,
      weekEnd: w2.we,
      capturedAt: Date.now() - 10 * 86_400_000,
      stocks: baseStocks({
        "ATCO-B.ST": 0.041,
        "VOLV-B.ST": 0.038,
        "THULE.ST": 0.052,
        "DOM.ST": 0.029,
        NVDA: 0.044,
        "DICOT.ST": -0.071,
      }),
      friends: [
        { person: "eric", name: "Eric", tickers: [], wtdPct: 2.7 },
        { person: "chris", name: "Chris", tickers: [], wtdPct: 1.4 },
        { person: "johan", name: "Johan", tickers: [], wtdPct: 0.8 },
        { person: "oskar", name: "Oskar", tickers: [], wtdPct: -1.9 },
      ],
      overallMood:
        "Eric's industrials carried the week — Atlas, Volvo, Thule all printing while everyone else grinded sideways.",
    },
    {
      weekStart: w3.ws,
      weekEnd: w3.we,
      capturedAt: Date.now() - 17 * 86_400_000,
      stocks: baseStocks({
        QBTS: 0.218,
        PLTR: 0.094,
        TSLA: 0.062,
        "INVE-B.ST": 0.024,
        GME: -0.114,
        "BINV.ST": -0.087,
      }),
      friends: [
        { person: "johan", name: "Johan", tickers: [], wtdPct: 8.4 },
        { person: "chris", name: "Chris", tickers: [], wtdPct: 1.1 },
        { person: "eric", name: "Eric", tickers: [], wtdPct: 0.6 },
        { person: "oskar", name: "Oskar", tickers: [], wtdPct: -0.3 },
      ],
      overallMood:
        "Johan's quantum stocks printed a generational week. He hasn't shut up about it.",
    },
  ];
}

// ============== Mock dated snapshot history (detail-view preview) ==============

/** How many recent weekdays of fake history the detail view gets in dev
 * mode. Deliberately < the 30-day sparkline gate so the locked "receipts"
 * state is visible in preview; bump past 30 to preview the unlocked SVG. */
const MOCK_HISTORY_DAYS = 18;

/** Deterministic 0..1 hash of a string — used to vary the fake per-day
 * moves without Math.random (stable across renders / SSR). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 → unsigned; scale to 0..1.
  return ((h >>> 0) % 100000) / 100000;
}

/** YYYY-MM-DD for a UTC day offset back from today. */
function dateBack(daysBack: number): { date: string; weekday: number } {
  const now = new Date();
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    daysBack * 86_400_000;
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, weekday: dt.getUTCDay() };
}

/**
 * Fabricated dated history so the per-stock detail view renders a real
 * ANALYST LOG + mood strip in dev mode (no Redis). Pure dev affordance —
 * only the mock branch in storage.ts ever calls it. Skips weekends (so
 * the mood strip shows honest gaps) and only attaches a commentary line
 * on the bigger-move days, mirroring the production comment rule. Ordered
 * oldest→newest, matching the real storage layer.
 */
export function getMockDailySnapshots(): DailySnapshot[] {
  const snapshots: DailySnapshot[] = [];
  // Walk back far enough to collect MOCK_HISTORY_DAYS *weekdays*.
  for (let back = 40; back >= 1 && snapshots.length < MOCK_HISTORY_DAYS; back--) {
    const { date, weekday } = dateBack(back);
    if (weekday === 0 || weekday === 6) continue; // skip Sat/Sun → gaps

    const stocks: DailySnapshotStock[] = STOCKS.filter((s) =>
      Number.isFinite(s.regularMarketPrice),
    ).map((s) => {
      // Deterministic day move in roughly [-6, +6]%, biased per ticker.
      const raw = hash01(`${s.ticker}:${date}`);
      const changePct = Number(((raw - 0.5) * 12).toFixed(2));
      const rating = deriveRating(changePct);
      const sentiment = deriveSentiment(changePct);
      // Mirror the production comment rule: a line only on a big move,
      // and only for tickers that have an authored one.
      const authored = COMMENTS[s.ticker];
      const comment =
        authored && Math.abs(changePct) > 3 ? authored : undefined;
      // Reconstruct a plausible historical price from the move.
      const price = Number(
        (s.regularMarketPrice * (1 + (raw - 0.5) * 0.08)).toFixed(
          s.regularMarketPrice >= 100 ? 2 : 4,
        ),
      );
      return {
        ticker: s.ticker,
        price,
        changePct,
        ...(rating ? { rating } : {}),
        sentiment,
        ...(comment ? { comment } : {}),
      };
    });

    snapshots.push({
      date,
      capturedAt: 0,
      updatedAt: `${date}T20:00:00.000Z`,
      overallMood: OVERALL_MOOD,
      stocks,
    });
  }
  // Collected newest→oldest above; flip to oldest→newest like storage.
  return snapshots.reverse();
}
