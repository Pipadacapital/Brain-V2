'use client';

// @paradigm: sql
// Providers — wraps the React tree with:
//   1. TanStack Query (server state)
//   2. tRPC React client (typed + superjson)
//   3. Redux store (ui/session slices)
//   4. NuqsAdapter (URL state for date range / filters)
//
// CF-C6-NEW-LAYER-1: exactly these four. Zero additional global state mechanisms.
// CF-C6-BIGINT-JSON-1: superjson transformer bound at provider level.

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as ReduxProvider } from 'react-redux';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { trpc, createTrpcClient } from '@/infrastructure/trpc-client.js';
import { store } from '@/domain/store/store.js';

interface ProvidersProps {
  children: React.ReactNode;
  workspaceId?: string;
}

export function Providers({ children, workspaceId }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,   // 5 min — matches the brief's 6h cache posture
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [trpcClient] = useState(() => createTrpcClient(workspaceId));

  return (
    <ReduxProvider store={store}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </QueryClientProvider>
      </trpc.Provider>
    </ReduxProvider>
  );
}
