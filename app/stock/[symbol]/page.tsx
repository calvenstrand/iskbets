import type { Metadata } from "next";
import Link from "next/link";
import { StockDetail } from "@/components/StockDetail";
import { getDashboardData } from "@/lib/storage";
import { displayTicker, TICKERS } from "@/lib/tickers";

// Re-render at most once a minute, mirroring the dashboard. Data is
// read server-side from the cached snapshot — never a client fetch.
export const revalidate = 60;
// Known tickers are prebuilt; unknown symbols still resolve at runtime
// (→ notFound inside StockDetail).
export const dynamicParams = true;

type Params = Promise<{ symbol: string }>;

export function generateStaticParams(): Array<{ symbol: string }> {
  return TICKERS.map((t) => ({ symbol: t.symbol }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { symbol } = await params;
  const meta = TICKERS.find((t) => t.symbol === symbol);
  if (!meta) {
    return { title: { absolute: "UNKNOWN TICKER · ISKBETS" } };
  }
  const display = displayTicker(symbol);
  // Description = this ticker's latest commentary line, falling back to
  // the day's overall mood, then a static line. Best-effort — a Redis
  // hiccup at build/runtime just yields the fallback.
  let description = `${meta.name} (${display}) on ISKBETS — WSB-rated moves, analyst log, and mood history. Not financial advice 🦍`;
  try {
    const data = await getDashboardData();
    const comment = data?.snapshot.analysis.stocks.find(
      (a) => a.ticker === symbol,
    )?.comment;
    if (comment) description = comment;
    else if (data?.snapshot.analysis.overallMood) {
      description = data.snapshot.analysis.overallMood;
    }
  } catch {
    // keep the fallback
  }
  return {
    title: { absolute: `${display} · ISKBETS` },
    description,
    // Site-wide OG image is inherited (per-ticker OG is a later commit).
  };
}

export default async function StockPage({ params }: { params: Params }) {
  const { symbol } = await params;
  return (
    <main className="sd-page">
      <div className="sd-page-inner">
        <Link href="/" className="sd-back">
          ← BACK TO THE TERMINAL
        </Link>
        <StockDetail symbol={symbol} />
      </div>
    </main>
  );
}
