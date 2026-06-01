// @paradigm: sql
// Admin (SUPERADMIN) layout guard — Server Component.
//
// Brain-native port of legacy app/(protected)/admin/layout.tsx. Reads the caller's
// platform systemRole from the gateway's user.me (verified-JWT path) and redirects
// non-superadmins to '/'. This is DEFENSE-IN-DEPTH UX only — the real gate is the
// gateway's superadminProc, which fails closed FORBIDDEN on every admin.* procedure
// regardless of what the client renders. Never trust this layout alone.
//
// Lives OUTSIDE the (shell) sidebar group → full-bleed chrome (min-h-screen p-6),
// matching the legacy admin look.
//
// CF-C6-PII-CLIENT-1: never log email or token.

import { redirect } from 'next/navigation';
import React from 'react';
import { createSupabaseServerClient } from '@/infrastructure/supabase/server.js';

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true';

/** Fetch the caller's systemRole from the gateway user.me using the session token. */
async function fetchSystemRole(accessToken: string): Promise<'SUPERADMIN' | 'USER'> {
  try {
    const gatewayUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const url = `${gatewayUrl}/trpc/user.me?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return 'USER'; // fail closed — any non-200 is treated as non-superadmin
    const body = (await res.json()) as Array<{
      result?: { data?: { json?: { systemRole?: 'SUPERADMIN' | 'USER' } } };
    }>;
    return body?.[0]?.result?.data?.json?.systemRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'USER';
  } catch {
    return 'USER'; // fail closed
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The offline stub has no real identity (resolver hardcodes systemRole USER), so the
  // admin area is not reachable there — fail closed to '/'.
  if (IS_LOCAL_HARNESS) {
    redirect('/');
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    redirect('/auth/login');
  }

  const role = await fetchSystemRole(session.access_token);
  if (role !== 'SUPERADMIN') {
    redirect('/');
  }

  return <>{children}</>;
}
