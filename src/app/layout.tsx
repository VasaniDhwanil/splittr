import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { ScrollReset } from "@/components/scroll-reset";
import { JsonLd } from "@/components/seo/json-ld";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.splittr.cash"),
  title: {
    default: "Splittr: split the bill by what you ordered",
    template: "%s · Splittr",
  },
  description:
    "Scan a restaurant receipt, share a link, and everyone taps what they ordered. Tax and tip split fairly. Free, no app to install.",
  keywords: [
    "split bill",
    "receipt scanner",
    "split restaurant bill",
    "bill splitting app",
    "Venmo split",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Splittr",
    url: "/",
    title: "Splittr: split the bill by what you ordered",
    description:
      "Scan a restaurant receipt, share a link, and everyone taps what they ordered. Tax and tip split fairly.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Splittr: split the bill by what you ordered",
    description:
      "Scan a restaurant receipt, share a link, and everyone taps what they ordered. Tax and tip split fairly.",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Splittr",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body
        className="antialiased bg-background"
      >
        <AnimatedBackground />
        {/* App shell: the document never scrolls — this container does. Fixed
            elements (bottom bar, dialogs) stay glued instead of riding the
            iOS rubber-band bounce. */}
        <div id="app-scroll" className="relative z-10 h-dvh overflow-y-auto overscroll-y-contain">
          {children}
        </div>
        <JsonLd />
        <ScrollReset />
        <Toaster />
      </body>
    </html>
  );
}
