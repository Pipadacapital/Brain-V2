'use client';

// App Router error boundary for the workspace (shell) segment — covers every
// analytics route under /w/[workspaceSlug]. Without this, an uncaught render/query
// error bubbles to the root and blanks the entire dashboard. Here it is contained
// to the content area (the shell chrome stays), with a retry that re-runs the
// segment. CF-SEC-5: surface the error digest for end-to-end traceability; no PII.

import { useEffect } from 'react';
import { ErrorDisplay } from '@/interfaces/components/shared/error-display';

export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side breadcrumb; a real transport (Sentry) wires in here later.
    console.error('[shell] segment error:', error);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorDisplay
        title="This view failed to load"
        message="Something went wrong rendering this page. Retry below — if it persists, contact support with the reference."
        requestId={error.digest}
      />
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
      >
        Retry
      </button>
    </div>
  );
}
