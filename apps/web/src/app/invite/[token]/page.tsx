// @paradigm: sql
// Invitation accept page (Slice C) — /invite/[token].
// Server Component shell: requires a real Supabase session; unauthenticated → /auth/login
// (carrying the invite path as ?next so the user lands back here after sign-in).
// The client component calls the tRPC invitation.accept procedure (idempotent, RLS-scoped,
// role-mapped) and then routes to /dashboard.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';
import { InvitationAccept } from '@/interfaces/components/invitation/invitation-accept.js';

export const metadata: Metadata = {
  title: 'Accept invitation — Brain',
};

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!IS_LOCAL_HARNESS) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // Send them to login, returning here after authentication.
      redirect(`/auth/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Join a workspace</h1>
          <p className="mt-1 text-sm text-gray-600">You&apos;ve been invited to Brain.</p>
        </div>
        <InvitationAccept token={token} />
      </div>
    </div>
  );
}
