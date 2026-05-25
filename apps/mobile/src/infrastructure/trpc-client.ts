// @paradigm: sql
// CF-C6-NEW-LAYER-1: tRPC client — zero axios, zero Zustand.
// CF-C6-BIGINT-JSON-1: superjson transformer registered — bigint fields round-trip
//   faithfully (e.g. expected_impact.revenue_mu as bigint, not number).
//
// CF-C6-PII-CLIENT-1: NO PII in client logs. Errors surface request_id only.
//
// Trace context propagation (per role spec §In-lane DoD):
//   x-request-id and x-trace-id headers are injected on every request.
//   These values are surfaced on error UI so operators can trace failures.
//
// The BrainRouter type is imported from api-gateway — ONE typed contract,
// not a local reimplementation.

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { BrainRouter } from '../../../api-gateway/src/application/router.js';
import { getAccessToken } from './auth-store.js';

// ---------------------------------------------------------------------------
// Cert pinning — applied at the native HTTP layer via expo-build-properties
// and app.json NSPinnedDomains (iOS) / NetworkSecurityConfig (Android).
// This file configures the fetch layer; cert pinning is a build-time artifact.
// See app.json §plugins for the pinning configuration.
// MASVS L1 + key L2: current pin + rotation pin both configured.
// ---------------------------------------------------------------------------

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Generate a request ID for correlation tracing. CF-SEC-5. */
function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const trpcClient = createTRPCClient<BrainRouter>({
  links: [
    httpBatchLink({
      url: `${API_BASE_URL}/trpc`,
      transformer: superjson, // CF-C6-BIGINT-JSON-1: bigint round-trip
      headers() {
        const requestId = generateRequestId();
        const accessToken = getAccessToken();

        const headers: Record<string, string> = {
          'x-request-id': requestId,
          'x-trace-id': requestId, // Phase 0-1: trace_id = request_id
          'content-type': 'application/json',
        };

        if (accessToken) {
          headers['authorization'] = `Bearer ${accessToken}`;
        }

        return headers;
      },
    }),
  ],
});

export type { BrainRouter };
