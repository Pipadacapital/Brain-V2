"use client";

// @paradigm: sql
// SessionBootstrap — hydrates the Redux session slice on app load.
// The middleware authenticates the request (valid Supabase cookie) and lets it
// reach a (shell) page, but Redux is in-memory and resets on every full navigation —
// so without this, isAuthenticated stays false and every page renders "Not signed in".
//
// Flow: call auth.session (verified JWT claim → userId/workspaceId/workspaceRole),
// dispatch setSession, THEN render children. While resolving → a spinner. On failure
// → redirect to /login?error=session.
//
// The offline LOCAL-harness fallback was removed on 2026-05-26 (Founder destub
// Rip B); the only auth path is real Supabase JWT.

import { useEffect } from "react";
import { trpc } from "@/infrastructure/trpc-client.js";
import { useAppDispatch, useAppSelector } from "@/domain/store/hooks.js";
import { setSession } from "@/domain/store/session-slice.js";
import { createSupabaseBrowserClient } from "@/infrastructure/supabase/client.js";

function LoadingScreen() {
  return (
    <div className="flex flex-1 items-center justify-center py-24" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        <span className="text-sm">Loading your workspace…</span>
      </div>
    </div>
  );
}

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.session.isAuthenticated);

  const query = trpc.auth.session.useQuery(undefined, {
    enabled: !isAuthenticated,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // auth.session is the workspace (authed) tier — it fails closed (UNAUTHORIZED) for a
  // VERIFIED user who simply has no membership yet. That is NOT an invalid session: such
  // a user must be routed to /onboarding, not signed out (otherwise they loop
  // login → shell → UNAUTHORIZED → signout → login). When the session query errors,
  // probe the identity-tier user.me (works without a workspace) to tell the two apart.
  const onboardingProbe = trpc.user.me.useQuery(undefined, {
    enabled: query.isError,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.data) {
      dispatch(
        setSession({
          userId: query.data.userId,
          workspaceId: query.data.workspaceId,
          workspaceRole: query.data.workspaceRole,
        }),
      );
      // Keep the persisted active-workspace in sync with what the gateway actually
      // resolved (selection-if-valid, else the default) so the switch header + the
      // sidebar highlight always agree.
      try {
        window.localStorage.setItem('brain.activeWorkspace', query.data.workspaceId);
      } catch {
        /* ignore */
      }
    }
  }, [query.data, dispatch]);

  useEffect(() => {
    if (!query.isError) return;
    // Wait for the identity probe to settle before deciding.
    if (onboardingProbe.isLoading) return;

    // Verified identity with no workspace yet → onboarding, NOT re-auth.
    if (onboardingProbe.data?.needsOnboarding) {
      window.location.assign("/onboarding");
      return;
    }

    // Genuinely unresolvable session (identity probe also failed, i.e. invalid/expired
    // token) → re-authenticate. Sign out first so the middleware doesn't bounce the
    // (now-invalid) cookie straight back.
    void (async () => {
      try {
        await createSupabaseBrowserClient().auth.signOut();
      } catch {
        /* best-effort — redirect regardless */
      }
      window.location.assign("/login?error=session");
    })();
  }, [query.isError, onboardingProbe.isLoading, onboardingProbe.data, onboardingProbe.isError]);

  if (query.isError) return <LoadingScreen />; // redirecting
  if (!isAuthenticated) return <LoadingScreen />; // resolving / not yet hydrated
  return <>{children}</>;
}
