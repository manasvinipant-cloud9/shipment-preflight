import type { Metadata, Viewport } from "next";
import { Big_Shoulders_Stencil, Host_Grotesk, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const display = Host_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"] });
const stencil = Big_Shoulders_Stencil({ subsets: ["latin"], variable: "--font-stencil", weight: ["800", "900"], adjustFontFallback: false });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Shipment Pre-Flight",
  description: "Book UK to Europe freight in plain English and catch shipment mistakes before they leave the UK.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} ${stencil.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
