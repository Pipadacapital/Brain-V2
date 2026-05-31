// @paradigm: sql
// @brain/trpc-client — shared tRPC client + AppRouter types (spec: packages/trpc-client).
// CF-C6-BIGINT-JSON-1: superjson transformer MUST match the server's; bigint _mu fields
// round-trip faithfully. CF-C6-NEW-LAYER-1: zero axios — HTTP link only.
//
// This package owns the PLATFORM-AGNOSTIC surface: the typed `trpc` React hooks object and a
// vanilla client factory, both bound to the gateway's BrainRouter. Platform-specific
// header/link factories (Supabase token, localStorage workspace selection, browser logging)
// stay in the consuming app (apps/web, apps/mobile) since they differ per platform — the app
// composes them around this shared core.

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import type { BrainRouter } from '@brain/api-gateway';

// Re-export the AppRouter type so consumers can type their own clients.
export type { BrainRouter } from '@brain/api-gateway';

// Typed tRPC React hooks object — the FULL type-safe procedure tree.
// Explicit annotation avoids the "cannot name inferred type" TS2883 error.
export const trpc: ReturnType<typeof createTRPCReact<BrainRouter>> =
  createTRPCReact<BrainRouter>();

/**
 * Build a vanilla (non-hook) tRPC client for the gateway. Used by Server Components /
 * Server Actions where React hooks can't run.
 * @param apiUrl gateway base URL (the app resolves this from its own env).
 */
export function createVanillaClient(apiUrl: string) {
  return createTRPCClient<BrainRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
        transformer: superjson,
      }),
    ],
  });
}
