import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Absolute URLs for Open Graph and canonical tags. Vercel injects VERCEL_URL
 * per deployment, so preview builds describe themselves rather than pointing
 * search engines and link previews at production.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "The Thrift Plug — secondhand fashion in Nairobi",
    template: "%s | The Thrift Plug",
  },
  description:
    "Handpicked secondhand clothing in Nairobi. Every piece is one of one — when it is gone, it is gone.",
  openGraph: {
    type: "website",
    locale: "en_KE",
    siteName: "The Thrift Plug",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
