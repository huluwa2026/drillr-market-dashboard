import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { PrivacyAnalytics } from "./privacy-analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "drillr Market Command | Real-time watchlist cockpit";
  const description = "A no-scroll, high-density market cockpit with a watchlist radar, interactive five-minute candlesticks, live events and more than 200 visual data marks.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: {
      canonical: `${origin}/?lang=en`,
      languages: { "en-US": `${origin}/?lang=en`, "zh-CN": `${origin}/?lang=zh` },
    },
    icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/favicon.png" },
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      images: [{ url: `${origin}/og-en.png`, width: 1280, height: 720, alt: "drillr real-time watchlist cockpit." }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-en.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <PrivacyAnalytics />
      </body>
    </html>
  );
}
