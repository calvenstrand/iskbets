import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Share_Tech_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BootSequence } from "@/components/BootSequence";
import { DrawerFooter } from "@/components/DrawerFooter";
import "./globals.css";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas-neue",
  display: "swap",
});

const shareTechMono = Share_Tech_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-share-tech-mono",
  display: "swap",
});

function getMetadataBase(): URL {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL);
  }
  if (process.env.VERCEL_URL) {
    return new URL(`https://${process.env.VERCEL_URL}`);
  }
  return new URL("http://localhost:3000");
}

const TITLE = "ISKBets — Stockholm meets WallStreetBets. Diamond hands.";
const DESCRIPTION =
  "Live stock dashboard for Stockholmsbörsen and US tickers with AI-rated WSB-style commentary, a friend-group leaderboard, and daily morning/evening market briefs. Diamond hands. Not financial advice.";

// JSON-LD structured data — gives Google a machine-readable description of
// what ISKBets is, who built it, and what it does. Helps with rich-result
// eligibility (sitelinks, knowledge panel hints) and canonical entity
// resolution. Keep schema fields minimal but accurate; lying to schema.org
// is a manual-action footgun.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": "https://www.iskbets.se/#webapp",
      name: "ISKBets",
      url: "https://www.iskbets.se",
      description: DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      inLanguage: "en",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "SEK",
      },
      creator: {
        "@type": "Person",
        name: "Christoffer Alvenstrand",
        url: "https://riverbeach.se",
      },
    },
    {
      "@type": "WebSite",
      "@id": "https://www.iskbets.se/#website",
      url: "https://www.iskbets.se",
      name: "ISKBets",
      description: DESCRIPTION,
      inLanguage: "en",
      publisher: {
        "@type": "Person",
        name: "Christoffer Alvenstrand",
        url: "https://riverbeach.se",
      },
    },
  ],
};

// LinkedIn (and some other crawlers) read og:logo with `property=`, but
// Next.js's metadata.other always emits `name=`. Render the tag manually
// — React 19 hoists <meta> from anywhere in the tree into <head>.
const LOGO_URL = new URL(
  "/logo.png",
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.iskbets.se",
).toString();

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: TITLE,
    template: "%s · ISKBets",
  },
  description: DESCRIPTION,
  alternates: {
    canonical: "https://www.iskbets.se",
  },
  applicationName: "ISKBets",
  keywords: [
    "stocks",
    "WSB",
    "wallstreetbets",
    "ISK",
    "investeringssparkonto",
    "stock tracker",
    "Stockholm",
    "Wall Street",
    "Sweden",
  ],
  authors: [{ name: "calvenstrand" }],
  creator: "calvenstrand",
  openGraph: {
    type: "website",
    siteName: "ISKBets",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    url: "/",
    // app/opengraph-image.jpg is picked up automatically — no need to declare images here
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    // app/twitter-image.jpg is picked up automatically
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tints the iOS Safari URL bar / Chrome address bar to match the bg.
  themeColor: "#080b0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `booting` is set server-side so the very first paint already hides
    // the dashboard and shows the overlay — no flash of content. On
    // hydration, BootSequence checks sessionStorage and either runs the
    // animation (and removes the class when done) or removes it
    // immediately (returning visitors). React 19 strips JSX-rendered
    // <script> tags from SSR, so this className-on-html trick is the
    // only reliable way to gate first paint without a build step.
    <html
      lang="en"
      className={`${bebas.variable} ${shareTechMono.variable} booting`}
    >
      <body>
        <meta property="og:logo" content={LOGO_URL} />
        {/* JSON-LD: machine-readable site description for Google. Inlined
            via dangerouslySetInnerHTML because React escapes characters
            inside <script> tag children, which breaks JSON-LD parsing. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // Escape `<` so any future addition containing `</script>`
            // (or `<!--`) can't break out of the script tag. Currently
            // safe — STRUCTURED_DATA is hardcoded — but defense in depth.
            __html: JSON.stringify(STRUCTURED_DATA).replace(
              /</g,
              "\\u003c",
            ),
          }}
        />
        <BootSequence />
        {children}
        {/* Drawer footer renders OUTSIDE/BELOW main so the reveal-on-scroll
            mechanism works. Sits at z-index: 0 with main at z-index: 1
            covering it until you scroll past main's content. */}
        <DrawerFooter />
        <Analytics />
        <SpeedInsights />
        {/* No-JS fallback: BootSequence never gets to remove the
            booting class, so override it in CSS for noscript clients. */}
        <noscript>
          <style>{`html.booting body > *:not(.boot-overlay){visibility:visible!important}html.booting .boot-overlay{display:none!important}`}</style>
        </noscript>
      </body>
    </html>
  );
}
