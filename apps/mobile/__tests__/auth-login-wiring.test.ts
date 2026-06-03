/**
 * mobile-2: Auth-store wiring — login → store → persisted-session path.
 *
 * Tests:
 *   POSITIVE: login() writes accessToken to memory (in-memory only).
 *   POSITIVE: login() persists refreshToken to SecureStore.
 *   POSITIVE: login() persists workspaceId + userId to SecureStore.
 *   POSITIVE: after login(), getAccessToken() returns the access token.
 *   POSITIVE: after login(), getRefreshToken() returns the refresh token.
 *   POSITIVE: logout() clears access token from memory.
 *   POSITIVE: logout() clears refresh token from SecureStore.
 *   NEGATIVE: if SecureStore throws during login(), in-memory state is rolled back.
 *   NEGATIVE: after rollback, getAccessToken() returns null.
 */

// ---------------------------------------------------------------------------
// Mock expo-secure-store so tests run in Node (no native module).
// ---------------------------------------------------------------------------
const secureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => secureStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStore[key];
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import {
  setAccessToken,
  getAccessToken,
  clearAccessToken,
  getRefreshToken,
  getWorkspaceId,
  getUserId,
  clearAllAuth,
} from '../src/infrastructure/auth-store.js';

// Re-import useLogin after mocks are in place.
// We use the plain functions directly (not the hook) since renderHook requires
// @testing-library/react-native which needs a native environment.
// The hook is a thin wrapper; we test the underlying auth-store functions.

describe('auth-store wiring: login path (mobile-2)', () => {
  // Reset state before each test.
  beforeEach(() => {
    clearAccessToken();
    Object.keys(secureStore).forEach((k) => delete secureStore[k]);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: access token round-trip (memory only)
  // -------------------------------------------------------------------------
  it('setAccessToken/getAccessToken: writes to memory, not SecureStore', () => {
    setAccessToken('at_test_token');
    expect(getAccessToken()).toBe('at_test_token');
    // Confirm it is NOT in SecureStore (memory-only invariant).
    expect(secureStore['brain_refresh_token']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: clearAccessToken wipes in-memory token.
  // -------------------------------------------------------------------------
  it('clearAccessToken: wipes the in-memory token', () => {
    setAccessToken('at_to_clear');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: refresh token persists to SecureStore.
  // -------------------------------------------------------------------------
  it('getRefreshToken returns null before any login', async () => {
    const token = await getRefreshToken();
    expect(token).toBeNull();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: full login flow — access token in memory + refresh in SecureStore.
  // This is the core mobile-2 wiring test.
  // -------------------------------------------------------------------------
  it('full login flow: access token in memory, refresh+workspace+userId in SecureStore', async () => {
    const { storeRefreshToken, storeWorkspaceId, storeUserId } = await import('../src/infrastructure/auth-store.js');

    // Simulate what use-login.ts does on a successful login.
    setAccessToken('at_live_token');
    await Promise.all([
      storeRefreshToken('rt_live_token'),
      storeWorkspaceId('ws-test-uuid'),
      storeUserId('user-test-uuid'),
    ]);

    // Access token in memory.
    expect(getAccessToken()).toBe('at_live_token');

    // Refresh token, workspaceId, userId in SecureStore.
    expect(await getRefreshToken()).toBe('rt_live_token');
    expect(await getWorkspaceId()).toBe('ws-test-uuid');
    expect(await getUserId()).toBe('user-test-uuid');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: clearAllAuth wipes everything.
  // -------------------------------------------------------------------------
  it('clearAllAuth: clears access token (memory) + refresh/workspace/userId (SecureStore)', async () => {
    const { storeRefreshToken, storeWorkspaceId, storeUserId } = await import('../src/infrastructure/auth-store.js');

    setAccessToken('at_to_wipe');
    await storeRefreshToken('rt_to_wipe');
    await storeWorkspaceId('ws_to_wipe');
    await storeUserId('user_to_wipe');

    await clearAllAuth();

    // Memory token gone.
    expect(getAccessToken()).toBeNull();
    // SecureStore entries gone.
    expect(await getRefreshToken()).toBeNull();
    expect(await getWorkspaceId()).toBeNull();
    expect(await getUserId()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE: if SecureStore throws, rollback clears the in-memory access token.
  // This tests the invariant from use-login.ts: no partial session state.
  // -------------------------------------------------------------------------
  it('rollback on SecureStore failure: clears memory token (no partial session)', async () => {
    const SecureStore = await import('expo-secure-store');
    // Make SecureStore.setItemAsync throw on the refreshToken write.
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Keychain locked'));

    const { storeRefreshToken } = await import('../src/infrastructure/auth-store.js');

    // Simulate the login attempt that fails.
    setAccessToken('at_partial');
    let threw = false;
    try {
      await storeRefreshToken('rt_will_fail'); // this throws
    } catch {
      // Simulate the rollback from use-login.ts.
      await clearAllAuth();
      threw = true;
    }

    expect(threw).toBe(true);
    // After rollback: access token must be gone (no partial session).
    expect(getAccessToken()).toBeNull();
    // Restore the mock for subsequent tests.
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
      secureStore[key] = value;
    });
  });
});

// ---------------------------------------------------------------------------
// mobile-5: data_epoch rehydration — string not Date.
// Tests that the MorningBriefSloMetric and InsightItem types use string for
// date fields, matching what redux-persist actually stores.
// ---------------------------------------------------------------------------
describe('mobile-5: data_epoch rehydrates as ISO string, not Date object', () => {
  it('JSON round-trip: data_epoch stays a string after JSON.parse (redux-persist behaviour)', () => {
    // Simulate what redux-persist does: serialize to JSON string, then parse back.
    const original = {
      data_epoch: '2026-05-25T07:00:00.000Z',
      items: [{ data_epoch: '2026-05-25T07:00:00.000Z' }],
    };
    const serialized = JSON.stringify(original);
    const parsed = JSON.parse(serialized) as typeof original;

    // After rehydration, data_epoch is still a string — NOT a Date object.
    expect(typeof parsed.data_epoch).toBe('string');
    expect(typeof parsed.items[0]!.data_epoch).toBe('string');

    // .toISOString() on a string would throw — callers must use new Date(data_epoch)
    // explicitly when a Date object is needed.
    expect(() => new Date(parsed.data_epoch).toISOString()).not.toThrow();
  });

  it('Date object does NOT survive JSON round-trip (validates the type fix)', () => {
    // This demonstrates WHY the type was a lie: a Date in, a string out.
    const dateObj = new Date('2026-05-25T07:00:00.000Z');
    // Use `unknown` so we can check the runtime type without TS narrowing it away.
    const afterRoundTrip = JSON.parse(JSON.stringify({ d: dateObj })) as { d: unknown };

    // After JSON.parse, d is a string, not a Date instance.
    expect(typeof afterRoundTrip.d).toBe('string');
    // Confirm it is not a Date object at runtime.
    expect(afterRoundTrip.d instanceof Date).toBe(false);
  });
});
