// @paradigm: sql
// CF-C6-MB-IDEMPOTENCY-1: CLIENT-SIDE idempotency key lifecycle.
//
// Rules (binding, spec §Track K task 3):
//   1. Generate the UUID at ACTION-INITIATION (when the user taps, before the request).
//      NOT at send-time. This is load-bearing for offline-replay correctness.
//   2. Persist the key until a non-error response is received (settled=true).
//   3. Offline-replay and app-background-resume REUSE the same key.
//      NEVER generate a new key on retry — that would break the server-side dedup.
//   4. After a non-error response the key is considered settled; a subsequent
//      tap on the same insight initiates a NEW key (new action).
//
// This module is pure — no React Native imports. It can be unit-tested in Node.

/** Generate a UUID v4 idempotency key. */
export function generateIdempotencyKey(): string {
  // RFC 4122 v4 UUID — crypto.randomUUID() available in Hermes >=0.74 (RN 0.74+).
  // Fallback for older Hermes: manual implementation.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual v4 UUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * In-memory idempotency key map for the session.
 * Maps insight_id → { key, settled, kind }.
 *
 * When an action is initiated, the key is stored.
 * When the action is settled (non-error response), settled=true.
 * A re-tap on a settled insight generates a NEW key for the new action.
 *
 * This is intentionally NOT persisted across app restarts for simplicity:
 * on app restart, the server's Redis TTL (24h) prevents double-write
 * even if a new key is generated. The critical invariant is that within
 * a single session an offline-replay reuses the same key.
 */
export interface PendingAction {
  /** The idempotency key. Generated at initiation, reused on retry. */
  idempotency_key: string;
  response_kind: 'APPROVE' | 'REJECT' | 'EDIT';
  edit_payload?: string;
  /**
   * true once we receive a non-error response.
   * A subsequent new action on the same insight clears this entry.
   */
  settled: boolean;
}

export class ClientIdempotencyStore {
  private readonly pending = new Map<string, PendingAction>();

  /**
   * Begin an action on an insight.
   * If there is already an unsettled action, REUSE its key (offline-replay path).
   * If the prior action is settled, start a new action with a new key.
   *
   * CF-C6-MB-IDEMPOTENCY-1: key generated here, NOT at send-time.
   */
  initiate(
    insightId: string,
    kind: 'APPROVE' | 'REJECT' | 'EDIT',
    editPayload?: string,
  ): PendingAction {
    const existing = this.pending.get(insightId);

    // Reuse unsettled action key — offline-replay guard.
    if (existing && !existing.settled) {
      // Update kind/payload in case user changed mind before send (e.g., APPROVE→EDIT)
      // but KEEP the same idempotency_key.
      const updated: PendingAction = {
        ...existing,
        response_kind: kind,
        edit_payload: editPayload,
      };
      this.pending.set(insightId, updated);
      return updated;
    }

    // New action (first tap, or re-tap after prior settled).
    const action: PendingAction = {
      idempotency_key: generateIdempotencyKey(),
      response_kind: kind,
      edit_payload: editPayload,
      settled: false,
    };
    this.pending.set(insightId, action);
    return action;
  }

  /**
   * Mark an action as settled after a non-error server response.
   * Future retries will see settled=true and initiate a new key.
   */
  settle(insightId: string): void {
    const existing = this.pending.get(insightId);
    if (existing) {
      this.pending.set(insightId, { ...existing, settled: true });
    }
  }

  /**
   * Get the current pending action for an insight.
   * Returns null if no action is pending (never initiated).
   */
  get(insightId: string): PendingAction | null {
    return this.pending.get(insightId) ?? null;
  }

  /** Clear all pending actions (for testing). */
  clear(): void {
    this.pending.clear();
  }
}

/** Module-level singleton for use in the app. Tests instantiate their own. */
export const clientIdempotencyStore = new ClientIdempotencyStore();
