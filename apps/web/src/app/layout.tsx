// @paradigm: sql
// Root layout — Server Component (default).
// CF-C6-I18N-SEAM-1: next-intl string externalization. No translations built now.
// CF-C6-PERF-A11Y-1: lang attribute, skip-nav link, proper root structure.

import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/application/providers.js';

export const metadata: Metadata = {
  title: 'Brain — DTC Analytics OS',
  description: 'Contribution-margin-first analytics for Indian DTC brands.',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" dir="ltr">
      <head />
      <body>
        {/* CF-C6-PERF-A11Y-1: skip-to-content for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-blue-700 focus:underline"
        >
          Skip to main content
        </a>
        <Providers>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
