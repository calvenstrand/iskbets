import { DisclaimerDialog } from "./DisclaimerDialog";

/**
 * Reveal-on-scroll drawer footer. Sits at body level (NOT inside the
 * dashboard <main>) so the main content can slide over it as you
 * scroll, exposing the footer at the bottom of the page.
 *
 * The drawer mechanism is pure CSS — see globals.css under
 * "Drawer footer". Adjust `--drawer-footer-height` there if this
 * component grows; main's margin-bottom syncs off the same var.
 */
export function DrawerFooter() {
  return (
    <footer className="drawer-footer" aria-label="Site footer">
      <div className="drawer-footer-inner">
        <h2 className="drawer-footer-name">CHRISTOFFER ÄLVENSTRAND</h2>

        <p className="drawer-footer-tagline">
          ISKBets is a WSB-flavored stock tracker I built for a small group of
          friends — Chris, Eric, Johan, Oskar. Live prices, AI commentary, and
          a leaderboard. Greed is good. Diamond hands. Not financial advice.
        </p>

        <a
          className="drawer-footer-pill"
          href="https://riverbeach.se"
          target="_blank"
          rel="noopener noreferrer"
        >
          RIVERBEACH.SE
        </a>

        <a
          className="drawer-footer-email"
          href="mailto:christoffer.alvenstrand@gmail.com"
        >
          christoffer.alvenstrand@gmail.com
        </a>

        <nav className="drawer-footer-links" aria-label="Footer links">
          <a
            href="https://github.com/calvenstrand/iskbets"
            target="_blank"
            rel="noopener noreferrer"
          >
            SOURCE
          </a>
          <span aria-hidden="true">·</span>
          <DisclaimerDialog />
          <span aria-hidden="true">·</span>
          <span className="drawer-footer-flag">MADE IN SWEDEN 🇸🇪</span>
        </nav>

        <p className="drawer-footer-meta">
          DATA: FINNHUB · AVANZA · COMMENTARY: CLAUDE · BUILT WITH NEXT.JS
        </p>
      </div>
    </footer>
  );
}
