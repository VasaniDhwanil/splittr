import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { ScrollReset } from "@/components/scroll-reset";
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
  title: "Splittr - Split Bills with Friends",
  description: "Scan receipts, share with friends, and split bills fairly.",
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
  maximumScale: 1,
  userScalable: false,
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
        <ScrollReset />
        <Toaster />
      </body>
    </html>
  );
}
