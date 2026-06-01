// @paradigm: sql
// tRPC client setup for apps/web.
// CF-C6-BIGINT-JSON-1: superjson transformer MUST match the server's transformer.
//   bigint _mu fields round-trip faithfully. Do NOT swap to a bare JSON link.
// CF-C6-NEW-LAYER-1: zero axios. HTTP link only (tRPC).
//
// The typed BrainRouter is imported from the api-gateway.
// This import gives Ananya's components the FULL type-safe procedure tree.

import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
// Platform-agnostic core (typed hooks object, vanilla client factory, BrainRouter type)
// lives in @brain/trpc-client (spec: packages/trpc-client). This file keeps the WEB-specific
// header/link factory and re-exports `trpc` so existing importers are unchanged.
import { trpc, createVanillaClient } from '@brain/trpc-client';
import type { BrainRouter } from '@brain/trpc-client';
import { createSupabaseBrowserClient } from './supabase/client.js';
// Browser-safe subpath — does NOT pull pino into the client bundle.
// (The top-level '@brain/lib-logger' import pulls pino's stdSerializers
// through; webpack production builds choke on it. The /correlation subpath
// is the browser-safe surface.)
import {
  newCorrelationId,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
} from '@brain/lib-logger/correlation';
import { browserLog } from './browser-logger.js';

// Slice A: when real auth is active (the default), every tRPC call carries the
// Supabase access token as `Authorization: Bearer`. The gateway JWKS-verifies it
// and derives workspace_id from the verified claim — it IGNORES x-workspace-id on
// the authed path (B3 / N1). The x-workspace-id header is sent ONLY in the LOCAL
// harness so the offline stub path can pick a workspace.
const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

// ---------------------------------------------------------------------------
// API Gateway URL — resolved from env at build time (or runtime in Next).
// For the LOCAL harness: NEXT_PUBLIC_API_URL defaults to http://localhost:3001.
// CF-C6-PII-CLIENT-1: no user data passes through URL params.
// ---------------------------------------------------------------------------

const getApiUrl = (): string => {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  return 'http://localhost:3001';
};

// ---------------------------------------------------------------------------
// tRPC React hooks factory — for use inside Client Components.
// CF-C6-BIGINT-JSON-1: superjson transformer on the httpBatchLink.
// ---------------------------------------------------------------------------

// Re-export the shared typed hooks object + router type so existing importers
// (`@/infrastructure/trpc-client`) keep working unchanged.
export { trpc };
export type { BrainRouter };

// ---------------------------------------------------------------------------
// Factory to create the tRPC React client (called once in the provider).
// Headers factory injects the workspace_id and trace headers on every call.
// CF-C6-GATEWAY-TENANCY-1: workspace_id flows JWT→gateway→data-plane.
// ---------------------------------------------------------------------------

export function createTrpcClient(workspaceId?: string) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiUrl()}/trpc`,
        transformer: superjson,
        async headers() {
          // Correlation 4-tuple — every tRPC call gets a fresh request_id
          // (per-call) and trace_id (shared within a tRPC batch). The gateway
          // receives both and propagates downstream. Browser console gets the
          // same request_id so a user-reported bug links DevTools → server logs.
          const request_id = newCorrelationId();
          const trace_id = newCorrelationId();
          const h: Record<string, string> = {
            [REQUEST_ID_HEADER]: request_id,
            [TRACE_ID_HEADER]: trace_id,
          };

          // Browser-side log (DevTools console). PII-free — just the IDs +
          // route shape. Set localStorage 'brain.log_level' to 'debug' to see.
          browserLog('debug', 'trpc call', { request_id, trace_id });

          if (IS_LOCAL_HARNESS) {
            // Offline harness ONLY: the stub gateway path reads x-workspace-id.
            // On the real-auth path the server IGNORES this header (B3/N1).
            if (workspaceId) {
              h['x-workspace-id'] = workspaceId;
            }
            return h;
          }

          // REAL auth: attach the verified Supabase access token as a Bearer.
          // CF-C6-PII-CLIENT-1: the token is a credential — never logged.
          try {
            const supabase = createSupabaseBrowserClient();
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (session?.access_token) {
              h['authorization'] = `Bearer ${session.access_token}`;
            }
          } catch {
            // No session / misconfig → send no Bearer; the gateway returns
            // UNAUTHORIZED and the middleware bounces to /auth/login.
          }

          // Active workspace selection (workspace switch). The gateway validates this
          // against the user's REAL memberships before honoring it (never blind trust);
          // when absent it defaults to the user's primary workspace.
          try {
            const activeWs =
              typeof window !== 'undefined' ? window.localStorage.getItem('brain.activeWorkspace') : null;
            if (activeWs) h['x-brain-workspace'] = activeWs;
          } catch {
            /* localStorage unavailable — fall back to the gateway default */
          }
          return h;
        },
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Vanilla tRPC client (for Server Components / RSC where hooks can't be used).
// Not used for data fetching in Server Components — they call the BFF directly
// (same process in Phase 0) via the gateway stub. This is available for
// rare Server Action patterns.
// ---------------------------------------------------------------------------

export const trpcVanillaClient = createVanillaClient(getApiUrl());
