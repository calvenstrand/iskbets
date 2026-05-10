import { DisclaimerDialog } from "./DisclaimerDialog";

/**
 * Reveal-on-scroll drawer footer. Sits at body level (NOT inside the
 * dashboard <main>) so the main content can slide over it as you
 * scroll, exposing the footer at the bottom of the page.
 *
 * The drawer mechanism is pure CSS — see globals.css under
 * "Drawer footer". Adjust `--drawer-footer-height` there if this
 * component grows; main's margin-bottom syncs off the same var.
 *
 * Design intent: the footer "bookends" the page with a smaller
 * echo of the masthead wordmark, the tagline answers "what is this",
 * inline links cover the practical asks (source, disclaimer, contact),
 * and the dev byline at the bottom is deliberately understated — the
 * "christoffer älvenstrand" name is the link, findable on hover but
 * not shouting.
 */
export function DrawerFooter() {
  return (
    <footer className="drawer-footer" aria-label="Site footer">
      <div className="drawer-footer-inner">
        <h2 className="drawer-footer-brand">
          I<span className="dollar">$</span>KBETS
        </h2>

        <p className="drawer-footer-tagline">
          A WSB-flavored stock tracker for a small group of friends. Live
          prices, AI commentary, leaderboard. Greed is good. Diamond hands.
          Not financial advice.
        </p>

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
          <a href="mailto:christoffer.alvenstrand@gmail.com">CONTACT</a>
        </nav>

        <p className="drawer-footer-byline">
          Built in Sweden by{" "}
          <a
            href="https://riverbeach.se"
            target="_blank"
            rel="noopener noreferrer"
            className="drawer-footer-credit"
          >
            christoffer älvenstrand
          </a>{" "}
          <span aria-hidden="true">🦍</span>
        </p>
      </div>
    </footer>
  );
}
