import { Dashboard } from "@/components/Dashboard";
import type { StoredData } from "@/lib/types";

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function getData(): Promise<StoredData | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/data`, {
      next: { revalidate: 60 },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[page] /api/data returned ${res.status}`);
      return null;
    }
    return (await res.json()) as StoredData;
  } catch (err) {
    // During `next build` there's no server running, so the fetch fails.
    // Treat as "no data" — ISR will fetch real data on the first runtime request.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[page] failed to fetch /api/data: ${msg}`);
    return null;
  }
}

export default async function Home() {
  const data = await getData();

  if (!data) {
    return (
      <main className="empty-state">
        <div className="signal">NO DATA YET</div>
        <div className="hint">Run a fetch to initialize.</div>
        <div className="blip">▮ AWAITING TRANSMISSION ▮</div>
      </main>
    );
  }

  return <Dashboard data={data} />;
}
