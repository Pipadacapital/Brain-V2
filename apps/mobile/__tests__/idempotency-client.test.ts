/**
 * CF-C6-MB-IDEMPOTENCY-1: Client-side idempotency key lifecycle.
 *
 * Tests:
 *   POSITIVE: double-tap reuses same key (offline-replay; does NOT generate new key).
 *   POSITIVE: settle + re-tap generates a NEW key (new action after settlement).
 *   POSITIVE: key generated at initiation, not at send-time.
 *   NEGATIVE: never generates a new key on retry for an unsettled action.
 *
 * G-IDEMPOTENT gate complement: the server-side gate verifies one Decision Log row.
 * This test verifies the CLIENT-SIDE guarantee: same key on retry.
 * Together: same key → server dedup → one row.
 */

import { ClientIdempotencyStore, generateIdempotencyKey } from '../src/domain/idempotency-client.js';

describe('ClientIdempotencyStore — idempotency key lifecycle', () => {
  let store: ClientIdempotencyStore;

  beforeEach(() => {
    store = new ClientIdempotencyStore();
  });

  // -------------------------------------------------------------------------
  // POSITIVE: generate on initiate
  // -------------------------------------------------------------------------
  it('generates a UUID on first initiate', () => {
    const action = store.initiate('insight-1', 'APPROVE');
    expect(action.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(action.response_kind).toBe('APPROVE');
    expect(action.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: double-tap (the primary idempotency test)
  // CF-C6-MB-IDEMPOTENCY-1: offline-replay REUSES same key, never generates new.
  // -------------------------------------------------------------------------
  it('double-tap: reuses the same idempotency_key (does NOT generate a new key on retry)', () => {
    const firstTap = store.initiate('insight-1', 'APPROVE');
    const secondTap = store.initiate('insight-1', 'APPROVE');

    // Same key — the server will deduplicate using this key → ONE row.
    expect(secondTap.idempotency_key).toBe(firstTap.idempotency_key);
    expect(secondTap.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: background-resume (kind change before send) — key preserved.
  // -------------------------------------------------------------------------
  it('app-background-resume: preserves key even when kind changes before send', () => {
    const first = store.initiate('insight-2', 'APPROVE');
    const afterResume = store.initiate('insight-2', 'EDIT', 'different payload');

    // Key PRESERVED (same unsettled action).
    expect(afterResume.idempotency_key).toBe(first.idempotency_key);
    // Kind updated (user changed mind).
    expect(afterResume.response_kind).toBe('EDIT');
    expect(afterResume.edit_payload).toBe('different payload');
  });

  // -------------------------------------------------------------------------
  // POSITIVE: settle then re-tap → NEW key (a new distinct action).
  // -------------------------------------------------------------------------
  it('after settle: re-tap generates a NEW idempotency_key', () => {
    const first = store.initiate('insight-3', 'APPROVE');
    store.settle('insight-3');

    const reTap = store.initiate('insight-3', 'APPROVE');
    // New key after settlement — this is a genuinely new action.
    expect(reTap.idempotency_key).not.toBe(first.idempotency_key);
    expect(reTap.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE: never settle without an explicit settle() call.
  // -------------------------------------------------------------------------
  it('unsettled action stays unsettled across multiple initiates', () => {
    store.initiate('insight-4', 'REJECT');
    store.initiate('insight-4', 'REJECT');
    store.initiate('insight-4', 'REJECT');

    const current = store.get('insight-4');
    expect(current).not.toBeNull();
    expect(current!.settled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: different insight IDs get independent keys.
  // -------------------------------------------------------------------------
  it('independent insights have independent keys', () => {
    const a = store.initiate('insight-a', 'APPROVE');
    const b = store.initiate('insight-b', 'APPROVE');

    expect(a.idempotency_key).not.toBe(b.idempotency_key);
  });

  // -------------------------------------------------------------------------
  // POSITIVE: get() returns null when no action initiated.
  // -------------------------------------------------------------------------
  it('get() returns null for never-initiated insight', () => {
    expect(store.get('never-initiated')).toBeNull();
  });
});

// -------------------------------------------------------------------------
// generateIdempotencyKey — unit test.
// -------------------------------------------------------------------------
describe('generateIdempotencyKey', () => {
  it('generates a valid UUID v4', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique keys on each call', () => {
    const keys = Array.from({ length: 100 }, () => generateIdempotencyKey());
    const unique = new Set(keys);
    expect(unique.size).toBe(100);
  });
});
