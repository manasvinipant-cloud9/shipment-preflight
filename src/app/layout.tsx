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

// Runs before first paint so there is no flash: saved choice, else the system setting, else dark.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} ${stencil.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
