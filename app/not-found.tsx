import Link from "next/link";

// Themed 404 — reached when notFound() fires (e.g. an unknown ticker
// symbol in /stock/[symbol]) or any unmatched route. Same terminal
// register as the dashboard's NO DATA YET empty state.
export default function NotFound() {
  return (
    <main className="empty-state">
      <div className="signal">404: TICKER NOT FOUND</div>
      <div className="hint">
        This symbol isn&apos;t on the watchlist. Either it got delisted,
        rugged, or never existed — classic.
      </div>
      <Link href="/" className="sd-back sd-back-404">
        ← BACK TO THE TERMINAL
      </Link>
      <div className="blip">▮ POSITION CLOSED ▮</div>
    </main>
  );
}
