// @paradigm: sql
// mobile-2 fix: wire auth-store setters into the login flow.
//
// Previously, auth-store.ts had setters (setAccessToken, storeRefreshToken,
// storeWorkspaceId, storeUserId) but they were never called — login never
// persisted a session. This hook is the single wiring point for the login path.
//
// MASVS L1 compliance:
//   - Refresh token → expo-secure-store (WHEN_UNLOCKED_THIS_DEVICE_ONLY).
//   - Access token → in-memory only (setAccessToken, never AsyncStorage/disk).
//   - On failure: no partial state written.
//   - On sign-out: clearAllAuth() wipes both.
//
// CF-C6-PII-CLIENT-1: no PII in logs (no email/phone in error messages returned here).
//
// Usage:
//   const { login, isLoading, error } = useLogin();
//   await login({ accessToken, refreshToken, workspaceId, userId });
//
// The caller (login screen, magic-link callback, etc.) supplies the tokens
// after authenticating with Supabase (expo-auth-session or magic-link).

import { useState, useCallback } from 'react';
import {
  setAccessToken,
  storeRefreshToken,
  storeWorkspaceId,
  storeUserId,
  clearAllAuth,
} from './auth-store.js';

export interface LoginPayload {
  /** JWT access token from Supabase Auth. Kept in memory only. */
  accessToken: string;
  /** Supabase refresh token. Persisted to expo-secure-store. */
  refreshToken: string;
  /** The workspace the user should land in. Persisted to secure-store. */
  workspaceId: string;
  /** Supabase user UUID. Persisted to secure-store. */
  userId: string;
}

export interface UseLoginResult {
  /** Call this after receiving tokens from Supabase Auth. */
  login: (payload: LoginPayload) => Promise<void>;
  /** Call on sign-out (clears memory + secure-store). */
  logout: () => Promise<void>;
  /** True while the persist operations are in flight. */
  isLoading: boolean;
  /** Set if the persist operations threw (e.g. SecureStore locked). */
  error: string | null;
}

/**
 * useLogin — wires auth-store setters into the login flow.
 *
 * mobile-2 fix: this hook ensures that after authentication, the session
 * is actually persisted so the app can resume it across kills/restarts.
 *
 * The session lifecycle:
 *   1. User authenticates (magic-link / OAuth).
 *   2. Caller calls login({ accessToken, refreshToken, workspaceId, userId }).
 *   3. This hook:
 *      a. Writes accessToken to memory (setAccessToken).
 *      b. Writes refreshToken to SecureStore (storeRefreshToken).
 *      c. Writes workspaceId + userId to SecureStore for push registration.
 *   4. On next cold start, _layout.tsx reads workspaceId + userId from SecureStore
 *      and calls registerPushToken.
 *   5. The tRPC client picks up the in-memory accessToken via getAccessToken().
 *      When the app is killed, the access token is lost → the auth layer must
 *      use the stored refreshToken to obtain a fresh one (Phase 2: implement
 *      the token refresh guard in _layout.tsx).
 */
export function useLogin(): UseLoginResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (payload: LoginPayload): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Write access token to memory FIRST (non-blocking, synchronous).
      //    The tRPC client reads this immediately for the next request.
      setAccessToken(payload.accessToken);

      // 2. Persist refresh token + metadata to SecureStore (encrypted at rest).
      //    All three writes are parallelised; if any throw, we roll back.
      await Promise.all([
        storeRefreshToken(payload.refreshToken),
        storeWorkspaceId(payload.workspaceId),
        storeUserId(payload.userId),
      ]);
    } catch (err) {
      // Roll back: clear any partial state so the app doesn't boot with a
      // half-written session (which would cause silent auth failures).
      await clearAllAuth().catch(() => {
        // clearAllAuth itself failed — ignore (best effort rollback).
      });
      const msg =
        err instanceof Error ? err.message : 'Login failed: could not persist session.';
      setError(msg);
      throw err; // re-throw so the login screen can surface it
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await clearAllAuth();
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { login, logout, isLoading, error };
}
