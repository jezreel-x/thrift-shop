import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { siteUrl } from "@/lib/site";
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
  // Makes every relative canonical and Open Graph URL below absolute.
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
