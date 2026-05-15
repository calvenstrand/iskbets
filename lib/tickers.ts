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
  /** Optional terse business context for the analyzer to weave into
   * WSB-style comments. Use for stocks where the story matters beyond
   * the price move (single-drug biotechs, imminent catalysts,
   * mechanism-of-action specifics, ownership structure, etc).
   * Keep terse — the comment is ≤12 words, so context just needs to
   * give Claude the hooks. Refresh when company status changes
   * (e.g. update after a Phase 2b readout, M&A, etc). */
  context?: string;
};

export const TICKERS: Ticker[] = [
  // Swedish stocks — fetched via Avanza unofficial API by orderbookId
  {
    symbol: "INVE-B.ST",
    name: "Investor B",
    market: "SE",
    avanzaId: 5247,
    owners: ["chris", "johan", "oskar"],
    context:
      "Wallenberg-family holding company. Big stakes in ABB, AstraZeneca, Atlas Copco, Ericsson, SEB, Saab, Patricia Industries. Slow-grinding Swedish industrial compounder, premium-to-NAV trading. The Wallenberg name is the meme angle.",
  },
  {
    symbol: "VOLV-B.ST",
    name: "Volvo B",
    market: "SE",
    avanzaId: 5269,
    context:
      "Volvo Group — trucks, buses, construction equipment (NOT Volvo Cars — different listed company). Cyclical with global freight + logistics + capex cycles. The truck Volvo, not the SUV Volvo.",
  },
  {
    symbol: "SWED-A.ST",
    name: "Swedbank A",
    market: "SE",
    avanzaId: 5241,
    owners: ["oskar"],
    context:
      "Large Swedish retail bank, mortgage-heavy. Dividend payer, conservative profile. Moves with Swedish housing + ECB/Riksbank rates. Oskar works here (or did) — owner-loyalty bag.",
  },
  {
    symbol: "SHB-B.ST",
    name: "Handelsbanken B",
    market: "SE",
    avanzaId: 5265,
    owners: ["chris"],
    context:
      "Swedish retail bank with a famously decentralized branch model (every branch runs as a profit center). Conservative lending. Chris works there — owner-loyalty bag.",
  },
  {
    symbol: "ATCO-B.ST",
    name: "Atlas Copco B",
    market: "SE",
    avanzaId: 5235,
    context:
      "World leader in industrial compressors + vacuum tech + power tools + mining equipment. Quiet long-term compounder, the kind of Swedish industrial Buffett would love.",
  },
  {
    symbol: "HM-B.ST",
    name: "H&M B",
    market: "SE",
    avanzaId: 5364,
    context:
      "Swedish fast-fashion giant. Lost ground to Zara + Shein + ultra-fast-fashion. Margin pressure, brand fatigue, perpetual turnaround attempts. The slow-decline of a national institution.",
  },
  {
    symbol: "DOM.ST",
    name: "Dometic Group",
    market: "SE",
    avanzaId: 611718,
    owners: ["eric"],
    context:
      "Outdoor lifestyle products — RV appliances, marine refrigeration, outdoor power. Cyclical with consumer leisure spending + the RV cycle (which got crushed post-COVID hangover).",
  },
  {
    symbol: "BINV.ST",
    name: "BioInvent",
    market: "SE",
    avanzaId: 5505,
    owners: ["eric"],
    context:
      "Swedish cancer immunotherapy biotech. Antibody-based oncology pipeline, multiple candidates in clinical trials. More diversified than DICOT (multiple shots on goal). Moves on data readouts + Big Pharma licensing deals.",
  },
  {
    symbol: "THULE.ST",
    name: "Thule Group",
    market: "SE",
    avanzaId: 521491,
    owners: ["eric"],
    context:
      "Swedish outdoor accessories — roof boxes, bike racks, strollers, luggage. Premium lifestyle brand. Cyclical with consumer durables + travel spend. Boring-but-compounds energy.",
  },
  {
    symbol: "CAST.ST",
    name: "Castellum",
    market: "SE",
    avanzaId: 5353,
    context:
      "Swedish commercial real estate. Heavily exposed to offices + retail. Beat-up since 2022 rate hikes, debt-laden, perpetual turnaround. Real-estate bagholder material.",
  },
  {
    symbol: "NIBE-B.ST",
    name: "Nibe Industrier B",
    market: "SE",
    avanzaId: 5325,
    owners: ["eric"],
    context:
      "World leader in heat pumps. Won big during the European energy crisis when everyone wanted to ditch gas heating. Then de-rated hard as policy subsidies softened and growth slowed. Industrial turnaround story.",
  },
  {
    symbol: "DICOT.ST",
    name: "Dicot Pharma",
    market: "SE",
    avanzaId: 861798,
    owners: ["oskar"],
    context:
      "Swedish ED biotech. LIB-01 is a long-acting alternative to Viagra/Cialis — effect lasts WEEKS not hours, MC4 receptor mechanism instead of PDE5. Phase 2a positive Oct 2025. Phase 2b due H2 2026, funded by a 210 MSEK rights issue (May 2026) → heavy dilution dragging the share price. Penny-stock valuation; binary catalyst on Phase 2b readout. HUMOR PERMISSION: this ticker is the one place where erection / ED / penis / dick double entendres are not just allowed but EXPECTED — lean into anatomical puns (hard / soft / limp / pumping / dropping / staying up / getting it up / blue pill / climax / coming / wood / can't keep it up / long-lasting / weak / firm). Pair the pun with the pharma reality (the drug, the dilution, the Phase 2b wait) so it's smart-dumb not just gratuitous. Keep tasteful enough to read aloud at a dinner party but suggestive enough that everyone notices.",
  },
  {
    symbol: "VPLAY-B.ST",
    name: "Viaplay Group B",
    market: "SE",
    avanzaId: 945460,
    owners: ["eric"],
    context:
      "Swedish streaming + Nordic media. Did a catastrophic international expansion (US / UK / Poland / Baltics) then retreated to Nordics in 2023. Stock fell ~95% from 2021 peak. Penny-stock-adjacent turnaround story. Pure unrelenting bagholder energy.",
  },
  {
    symbol: "INTRUM.ST",
    name: "Intrum",
    market: "SE",
    avanzaId: 5583,
    owners: ["johan"],
    context:
      "European debt-collection giant. Profits when consumer credit goes bad — counter-cyclical to economic optimism. Multi-year restructuring, messy debt-laden balance sheet, perpetual turnaround attempts. Bagholder favorite.",
  },
  {
    symbol: "HACK.ST",
    name: "Hacksaw Gaming",
    market: "SE",
    avanzaId: 2094659,
    owners: ["chris"],
    context:
      "Swedish B2B iGaming software — designs slot games for online casinos worldwide. Revenue ties to new-market launches (US states, LatAm) + slot title hit rates. WSB-friendly degenerate-gambling angle: slot pulls, RTP, jackpots, spin-and-pray.",
  },
  {
    symbol: "BETS-B.ST",
    name: "Betsson B",
    market: "SE",
    avanzaId: 5482,
    owners: ["eric"],
    context:
      "Swedish online gambling operator — multi-brand sportsbook + online casino across Europe + LatAm. Moves on regulatory wins/losses and new-market launches. Cash-generative gambling-degenerate income stream.",
  },
  {
    symbol: "LUND-B.ST",
    name: "Lundbergs B",
    market: "SE",
    avanzaId: 5375,
    owners: ["eric"],
    context:
      "Swedish family investment holdco. Lundberg-family controlled (not Wallenberg). Major stakes in Hufvudstaden, Holmen, Indutrade. Slow-grinding compounder, old-money discipline, trades at a discount to NAV.",
  },
  {
    symbol: "LATO-B.ST",
    name: "Latour B",
    market: "SE",
    avanzaId: 5321,
    owners: ["eric"],
    context:
      "Investment AB Latour — Swedish industrial holding company. Stakes in Assa Abloy, Tomra, Sweco, plus wholly-owned industrial businesses. Long-term Swedish industrial compounder, premium-to-NAV.",
  },
  {
    symbol: "SES.ST",
    name: "Scandinavian Enviro Systems",
    market: "SE",
    avanzaId: 487396,
    owners: ["oskar"],
    context:
      "Swedish tire-pyrolysis tech — recycles end-of-life tires into recovered carbon black for new tire manufacturing. ESG / circular-economy play with Michelin as a strategic partner. Pre-scale, capital-intensive, slow commercial ramp. Penny-stock territory.",
  },
  {
    symbol: "FLAT-B.ST",
    name: "Flat Capital B",
    market: "SE",
    avanzaId: 1292424,
    owners: ["chris", "oskar"],
    context:
      "Swedish-listed investment holding company. Concentrated stakes in Klarna and Defensor Group, plus private-tech YOLOs in OpenAI / SpaceX / Cerebras Systems. Essentially a Stockholm-listed wrapper for AI/space/fintech exposure that's otherwise unreachable in public markets. Trading at meaningful discount to NAV (~35% as of Q4 2025: ~9 SEK price vs ~14 SEK NAV/share). Founded 2013. Klarna IPO + any private-tech revaluation are the main catalysts.",
  },
  // WSB darlings — fetched via Finnhub
  {
    symbol: "NVDA",
    name: "Nvidia",
    market: "US",
    context:
      "AI compute monopoly. Datacenter GPUs + CUDA moat. Moves on AI capex narrative, earnings guidance, Blackwell / Rubin roadmap, hyperscaler orders. The altar where WSB worships AI. Jensen Huang's leather jacket is a meme.",
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    market: "US",
    context:
      "EVs + Optimus humanoid robot + FSD/robotaxi + energy storage. Highest retail beta in the index. Moves on Elon tweets, delivery numbers, FSD/robotaxi progress, China sales. Cult stock with religious bagholders and equally fanatical shorts.",
  },
  {
    symbol: "GME",
    name: "GameStop",
    market: "US",
    context:
      "OG meme stock — failing brick-and-mortar gaming retail + Ryan Cohen's crypto-and-Bitcoin treasury sideline. Disconnected from fundamentals. Moves on community sentiment, short-squeeze narratives, RC tweets, kitty pictures. WSB sacred ground.",
  },
  {
    symbol: "PLTR",
    name: "Palantir",
    market: "US",
    owners: ["johan"],
    context:
      "Defense + intelligence + commercial analytics software. CEO Alex Karp is a meme — eccentric, ranty, philosophy degree. Moves on AI sentiment, big government contracts (Project Maven, ICE, DoD), Karp's earnings-call performances. Heavy retail bag.",
  },
  {
    symbol: "AMD",
    name: "AMD",
    market: "US",
    context:
      "x86 chips + datacenter GPUs (MI300 / MI350 ramp). NVDA's closest competitor in AI accelerators. Lisa Su execution story. Beta to AI capex + datacenter share gains. Forever the perpetual challenger.",
  },
  {
    symbol: "COIN",
    name: "Coinbase",
    market: "US",
    context:
      "Largest US crypto exchange. Revenue tied to trading volume (cyclical with crypto sentiment) + custody / staking / stablecoin fees. Beta to BTC + ETH + ETF flows + regulatory headlines.",
  },
  {
    symbol: "MSTR",
    name: "MicroStrategy",
    market: "US",
    context:
      "Effectively a leveraged Bitcoin proxy — Michael Saylor relentlessly raises debt + equity to buy BTC. Stock = BTC × premium-to-NAV + a small business-intelligence software side gig. Moves with crypto sentiment more than fundamentals. Saylor cult.",
  },
  {
    symbol: "SHOP",
    name: "Shopify",
    market: "US",
    owners: ["chris"],
    context:
      "E-commerce platform — merchant store-builder + payments + logistics + Shop Pay. Beta to consumer spending + merchant signups. Lapped pandemic comps a while ago. SaaS-with-payments business model.",
  },
  {
    symbol: "NET",
    name: "Cloudflare",
    market: "US",
    owners: ["chris"],
    context:
      "CDN + edge security + Workers serverless platform + Vectorize / Workers AI. Growth SaaS with a GenAI tailwind. High-multiple valuation, hype-driven. Matthew Prince's blog posts move the stock.",
  },
  {
    symbol: "QBTS",
    name: "D-Wave Quantum",
    market: "US",
    owners: ["johan"],
    context:
      "Quantum computing hardware via annealing approach (distinct from IONQ's gate-based). Pre-revenue, speculative, runway-dependent. Moves on AI/quantum hype cycles + government contract announcements. Cult-favorite of WSB quantum bulls.",
  },
  {
    symbol: "GOOG",
    name: "Alphabet",
    market: "US",
    owners: ["chris", "oskar"],
    context:
      "Search + YouTube + Cloud + Gemini AI + Waymo + TPU silicon. Moves on Search-vs-AI narrative, Cloud growth rate, ad cycle, Gemini benchmark drops, antitrust news. Big AI bet trying to defend a 95% search-revenue moat.",
  },
  {
    symbol: "DDOG",
    name: "Datadog",
    market: "US",
    owners: ["chris"],
    context:
      "Observability SaaS — logs, metrics, APM, security, RUM. Cloud-native, beta to overall cloud spend + new-product attach. Recent push into AI/LLM observability. Boring-reliable growth.",
  },
  {
    symbol: "DFTX",
    name: "Definium Therapeutics",
    market: "US",
    owners: ["oskar"],
    context:
      "Small-cap US clinical-stage biotech. Speculative — like most pre-revenue biotechs, binary on trial readouts and dilution from regular cap raises. Oskar's degenerate biotech bag #2 (companion to DICOT).",
  },
  {
    symbol: "JOBY",
    name: "Joby Aviation",
    market: "US",
    owners: ["johan"],
    context:
      "eVTOL — electric vertical-takeoff aircraft, i.e. flying taxis. Pre-revenue, FAA certification in progress, partnerships with Toyota + Delta. Years from commercial launch. Pure flying-car-future hype stock, multi-year YOLO horizon.",
  },
  {
    symbol: "IONQ",
    name: "IonQ",
    market: "US",
    owners: ["chris", "johan"],
    context:
      "Trapped-ion quantum computing — gate-based architecture (different from QBTS's annealing). Pre-revenue, partnerships with Microsoft / Hyundai / others. Multi-bag-or-zero. The Microsoft-aligned quantum supremacy meme stock.",
  },
];
