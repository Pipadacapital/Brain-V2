// @paradigm: sql
// Root layout — Server Component (default).
// CF-C6-I18N-SEAM-1: next-intl string externalization. No translations built now.
// CF-C6-PERF-A11Y-1: lang attribute, skip-nav link, proper root structure.

import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/application/providers.js";

export const metadata: Metadata = {
  title: "Brain — DTC Analytics OS",
  description: "Contribution-margin-first analytics for Indian DTC brands.",
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" dir="ltr">
      <head />
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes onto <body> before React
          hydrates. Scoped to this element's own attrs — does NOT mask
          mismatches in the component tree below. */}
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`} suppressHydrationWarning>
        {/* CF-C6-PERF-A11Y-1: skip-to-content for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:underline"
        >
          Skip to main content
        </a>
        <Providers>
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
