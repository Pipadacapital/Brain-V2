// @paradigm: sql
// CF-C6-RENDER-ONLY-1: Next.js 16 App Router config.
// Server Components by default. No LLM, no metric arithmetic.
// CF-C6-BIGINT-JSON-1: superjson transformer registered on the tRPC instance (in providers).

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router is default in Next.js 16.
  experimental: {
    // Turbopack is default in Next 16 (--turbopack flag in dev).
    // Bundle-cost lever: rewrite barrel imports from these heavy packages into
    // direct deep imports so only what's used is bundled (recharts + the icon
    // set are the largest contributors to the analytics route bundles).
    optimizePackageImports: ['recharts', 'lucide-react'],
  },
  // LOCAL-HARNESS: @brain/lib-metrics + @brain/api-gateway are aliased to raw TS
  // source that uses NodeNext-style ".js" import specifiers. webpack's extensionAlias
  // resolves those ".js" specifiers to the real .ts/.tsx files so the bundler can
  // consume the workspace packages from source without a build step. Run via `next dev`
  // (webpack), not `--turbopack` (Turbopack has no extensionAlias equivalent yet).
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
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
