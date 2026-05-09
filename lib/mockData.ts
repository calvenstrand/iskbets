import { deriveRating, deriveSentiment } from "./derive";
import { stockholmDate } from "./dateUtil";
import type { Brief, StockAnalysis, StockPrice, StoredData } from "./types";

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
    ticker: "KLAR",
    name: "Klarna Group",
    currency: "USD",
    regularMarketPrice: 48.2,
    regularMarketChange: 0.71,
    regularMarketChangePercent: 1.5,
    regularMarketVolume: 4_200_000,
    averageDailyVolume3Month: 5_100_000,
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
  "BINV.ST": "Biotech rollercoaster, FDA gods unhappy today",
  NET: "Chris's Cloudflare ripping faces, AI infra moon",
  SHOP: "Chris's Shopify printing tendies, ATH in sight",
  "THULE.ST": "Eric's roof boxes printing, Volvo dad approves",
  "NIBE-B.ST": "Eric's heat pumps go brrr, Swedish saviour",
  "DICOT.ST": "Oskar's Dicot apes vaporized at 25 öre",
  "VPLAY-B.ST": "Eric's Viaplay sinking, paper hands fleeing",
  "INVE-B.ST": "the gang's Investor B grinding +1.4%, Wallenberg blessing",
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
    return {
      ticker: s.ticker,
      rating: deriveRating(s.regularMarketChangePercent),
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
    analyzedAt: now,
    pricesAtLastAnalysis: STOCKS,
  };
}

// ============== Mock briefs ==============

const MORNING_BRIEF_TEXT =
  "Yesterday Chris's Cloudflare ripped face off everyone and everything else, dragging the syndicate to +2.3% net. Eric's industrials held the line as always. Oskar's Dicot apes still haven't shown up to morning prayer — currency: copium. Stockholm rings the bell in 30, ape eyes on Klarna after that earnings beat last night.";

const EVENING_BRIEF_TEXT =
  "What a session. NVDA printed +6.8%, hauling Chris's tech bag to +4.1% net while the rest of the gang grinded sideways. Stockholm closed mixed — Eric's roof boxes catching a bid, Oskar's Dicot continuing its slow death at 25 öre. NY rolled over into the close. Sleep tight, bagholders. Tomorrow we ride.";

export function getMockMorningBrief(): Brief {
  const now = Date.now();
  return {
    date: stockholmDate(new Date(now)),
    text: MORNING_BRIEF_TEXT,
    generatedAt: now - 2 * 60 * 60 * 1000, // 2h ago
  };
}

export function getMockEveningBrief(): Brief {
  const now = Date.now();
  return {
    date: stockholmDate(new Date(now - 24 * 60 * 60 * 1000)), // yesterday
    text: EVENING_BRIEF_TEXT,
    generatedAt: now - 12 * 60 * 60 * 1000, // 12h ago
  };
}
