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

export const metadata: Metadata = {
  title: "ISKBets — Wall$treet Bets",
  description: "WSB-flavored stock tracker. Greed is good. Not financial advice.",
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
