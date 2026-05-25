'use client';

// @paradigm: sql
// InvitationAccept — client accept action (Slice C).
// Calls the tRPC invitation.accept procedure (idempotent, RLS-scoped, role-mapped
// EDITOR→MANAGER). On accept OR already-member → /dashboard. NOT_FOUND / expired /
// non-pending → a clear, generic message (no internal detail leaked).
//
// Member-invite SENDING (email) is DEFERRED (honest affordance) — this only handles
// ACCEPT via a token the inviter shares out-of-band for slice C.
//
// CF-C6-PII-CLIENT-1: never log email or token. CF-C6-PERF-A11Y-1: roles + kbd nav.

import { useState, useId } from 'react';
import { trpc } from '@/infrastructure/trpc-client.js';

interface InvitationAcceptProps {
  token: string;
}

export function InvitationAccept({ token }: InvitationAcceptProps) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const acceptMutation = trpc.invitation.accept.useMutation({
    onSuccess: () => {
      window.location.assign('/dashboard');
    },
    onError: (err) => {
      setError(err.message.replace(/\s*request_id=.*/, '') || 'Could not accept this invitation.');
    },
  });

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      <p className="text-sm text-gray-600">
        Accept this invitation to join the workspace and start collaborating.
      </p>

      {error && (
        <p id={errorId} role="alert" aria-live="assertive" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setError(null);
          acceptMutation.mutate({ token });
        }}
        disabled={acceptMutation.isPending}
        aria-describedby={error ? errorId : undefined}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {acceptMutation.isPending ? 'Joining…' : 'Accept invitation'}
      </button>
    </div>
  );
}
