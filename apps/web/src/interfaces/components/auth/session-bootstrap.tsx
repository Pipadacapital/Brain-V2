"use client";

// @paradigm: sql
// SessionBootstrap — hydrates the Redux session slice on app load for the REAL-auth
// path. The middleware authenticates the request (valid Supabase cookie) and lets it
// reach a (shell) page, but Redux is in-memory and resets on every full navigation —
// so without this, isAuthenticated stays false and every page renders "Not signed in".
//
// Flow: call auth.session (verified JWT claim → userId/workspaceId/workspaceRole),
// dispatch setSession, THEN render children. While resolving → a spinner (never the
// dead-end "Not signed in" panel). On failure → redirect to /auth/login?error=session
// (the page is protected; a session we cannot resolve means re-authenticate).
//
// Offline harness: the stub login sets the session itself and there is no real JWT,
// so this bootstrap is a no-op there (render children directly).

import { useEffect } from "react";
import { trpc } from "@/infrastructure/trpc-client.js";
import { useAppDispatch, useAppSelector } from "@/domain/store/hooks.js";
import { setSession } from "@/domain/store/session-slice.js";
import { createSupabaseBrowserClient } from "@/infrastructure/supabase/client.js";

const IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === "true";

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

  // Harness: offline stub owns the session; do not bootstrap against a real JWT.
  const query = trpc.auth.session.useQuery(undefined, {
    enabled: !IS_LOCAL_HARNESS && !isAuthenticated,
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
    // Protected route + unresolvable session → re-authenticate (your directive:
    // never sit on a dashboard while "not signed in"). We sign OUT first: the
    // middleware bounces an authenticated user off /auth/login straight back to
    // /dashboard, so leaving the (now-invalid) cookie in place would loop. Clearing
    // it means the user lands on the login page and stays there with the error.
    if (!IS_LOCAL_HARNESS && query.isError) {
      void (async () => {
        try {
          await createSupabaseBrowserClient().auth.signOut();
        } catch {
          /* best-effort — redirect regardless */
        }
        window.location.assign("/auth/login?error=session");
      })();
    }
  }, [query.isError]);

  if (IS_LOCAL_HARNESS) return <>{children}</>;
  if (query.isError) return <LoadingScreen />; // redirecting
  if (!isAuthenticated) return <LoadingScreen />; // resolving / not yet hydrated
  return <>{children}</>;
}
