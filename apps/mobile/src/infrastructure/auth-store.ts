// @paradigm: sql
// CF-C6-PII-CLIENT-1 + MASVS L1 + expo-secure-store:
//   - Refresh token: stored in expo-secure-store (encrypted at rest, OS keychain).
//   - Access token: in memory only (never persisted to AsyncStorage or disk).
//   - CF-C6-MB-PUSH-TOKEN-1: push token is stored in core.device_tokens (server-side).
//
// Cert pinning: configured in app.json via expo-modules + managed via
// CustomTrustManager (Android) / NSPinnedDomains (iOS) — see app.json §certPinning.
// Current pin + rotation pin BOTH configured (CF-C6-PII-CLIENT-1, MASVS L1/L2).
//
// NO AsyncStorage for tokens. Every token call goes through this module.

import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'brain_refresh_token';
const WORKSPACE_ID_KEY = 'brain_workspace_id';
const USER_ID_KEY = 'brain_user_id';

// ---------------------------------------------------------------------------
// In-memory access token (never written to disk / AsyncStorage).
// CF-MASVS-L1: access token in memory only.
// ---------------------------------------------------------------------------

let _accessToken: string | null = null;

export function setAccessToken(token: string): void {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function clearAccessToken(): void {
  _accessToken = null;
}

// ---------------------------------------------------------------------------
// Refresh token — expo-secure-store (encrypted at rest).
// CF-MASVS-L1: SecureStore uses the device keychain / keystore.
// ---------------------------------------------------------------------------

export async function storeRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Workspace ID + User ID (not sensitive but cached for UX).
// Stored in SecureStore for consistency — could use AsyncStorage if perf required.
// ---------------------------------------------------------------------------

export async function storeWorkspaceId(workspaceId: string): Promise<void> {
  await SecureStore.setItemAsync(WORKSPACE_ID_KEY, workspaceId);
}

export async function getWorkspaceId(): Promise<string | null> {
  return SecureStore.getItemAsync(WORKSPACE_ID_KEY);
}

export async function storeUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(USER_ID_KEY, userId);
}

export async function getUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY);
}

// ---------------------------------------------------------------------------
// Sign-out — clear everything.
// ---------------------------------------------------------------------------

export async function clearAllAuth(): Promise<void> {
  clearAccessToken();
  await Promise.all([
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(WORKSPACE_ID_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
  ]);
}
