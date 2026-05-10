/**
 * Reveal-on-scroll drawer footer. Sits at body level (NOT inside the
 * dashboard <main>) so the main content can slide over it as you
 * scroll, exposing the footer at the bottom of the page.
 *
 * The drawer mechanism is pure CSS — see globals.css under
 * "Drawer footer". Adjust `--drawer-footer-height` there if this
 * component grows; main's margin-bottom syncs off the same var.
 *
 * Placeholder content for now — replace freely. The structure
 * (drawer-footer wrapper > drawer-footer-inner content slot) keeps the
 * outer positioning/height contract intact even as content evolves.
 */
export function DrawerFooter() {
  return (
    <footer className="drawer-footer" aria-label="Site footer">
      <div className="drawer-footer-inner">
        <div className="drawer-footer-brand">
          I<span className="dollar">$</span>KBETS
        </div>
        <p className="drawer-footer-tagline">
          Stockholm meets WallStreetBets · Diamond hands · Not financial advice
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
          <a href="#disclaimer">DISCLAIMER</a>
          <span aria-hidden="true">·</span>
          <a href="mailto:hello@iskbets.se">CONTACT</a>
        </nav>
        <p className="drawer-footer-meta">
          BUILT WITH NEXT.JS · DEPLOYED ON VERCEL · MADE FOR APES
        </p>
      </div>
    </footer>
  );
}
