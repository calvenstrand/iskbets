import type { Metadata } from "next";
import { Bebas_Neue, Share_Tech_Mono } from "next/font/google";
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

const TITLE = "ISKBets — WSB-flavored stock tracker";
const DESCRIPTION =
  "Wall Street meets WallStreetBets. Greed is good. Diamond hands forever. Not financial advice.";

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: TITLE,
    template: "%s · ISKBets",
  },
  description: DESCRIPTION,
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${bebas.variable} ${shareTechMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
