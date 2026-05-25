// @paradigm: sql
// CF-C6-RENDER-ONLY-1: Next.js 16 App Router config.
// Server Components by default. No LLM, no metric arithmetic.
// CF-C6-BIGINT-JSON-1: superjson transformer registered on the tRPC instance (in providers).

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router is default in Next.js 16.
  experimental: {
    // Turbopack is default in Next 16 (--turbopack flag in dev).
  },
  // CF-C6-PII-CLIENT-1: never log PII in client-facing error pages.
  // Production: configure CSP headers here.
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default nextConfig;
