// @paradigm: sql
// tRPC client setup for apps/web.
// CF-C6-BIGINT-JSON-1: superjson transformer MUST match the server's transformer.
//   bigint _mu fields round-trip faithfully. Do NOT swap to a bare JSON link.
// CF-C6-NEW-LAYER-1: zero axios. HTTP link only (tRPC).
//
// The typed BrainRouter is imported from the api-gateway.
// This import gives Ananya's components the FULL type-safe procedure tree.

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import type { BrainRouter } from '@brain/api-gateway';
import { createSupabaseBrowserClient } from './supabase/client.js';

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

// Explicit type annotation avoids the "cannot name inferred type" TS2883 error.
// CF-C6-BIGINT-JSON-1: superjson transformer is configured at the link level.
export const trpc: ReturnType<typeof createTRPCReact<BrainRouter>> = createTRPCReact<BrainRouter>();

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
          const h: Record<string, string> = {
            'x-trace-id': globalThis.crypto?.randomUUID?.() ?? 'browser',
          };

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

export const trpcVanillaClient = createTRPCClient<BrainRouter>({
  links: [
    httpBatchLink({
      url: `${getApiUrl()}/trpc`,
      transformer: superjson,
    }),
  ],
});
