import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Share_Tech_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BootSequence } from "@/components/BootSequence";
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
  "Wall Street meets WallStreetBets. AI-rated Stockholm stocks with WSB-flavored commentary. Greed is good. Diamond hands. Not financial advice.";

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
        <BootSequence />
        {children}
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
