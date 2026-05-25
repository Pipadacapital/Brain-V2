// @paradigm: sql
// CF-C6-MB-IDEMPOTENCY-1: cross-cutting idempotency primitive for the
// morningBrief.submitResponse mutation. ONE primitive, ONE home.
//
// Redis key: ws:<workspace_id>:idem:<idempotency_key>
// TTL: 24h (86400 seconds)
//
// G-IDEMPOTENT gate: same idempotency_key twice → single ai.decision_log row.
// The Redis dedup check MUST happen before any write to ai.decision_log.
// Mutant: remove the dedup check → double-submit produces two rows → RED.
//
// CF-SEC-5: the idempotency store key includes workspace_id to prevent
// cross-workspace key collisions.

import type { Redis } from 'ioredis';

const IDEM_TTL_SECONDS = 86_400; // 24 hours

/**
 * Build the Redis key for an idempotency check.
 * Format: ws:<workspace_id>:idem:<idempotency_key>
 * CF-C6-MB-IDEMPOTENCY-1: workspace-scoped to prevent cross-tenant key collisions.
 */
export function buildIdempotencyKey(workspaceId: string, idempotencyKey: string): string {
  return `ws:${workspaceId}:idem:${idempotencyKey}`;
}

/**
 * Check if an idempotency key has already been processed.
 * Returns the cached response JSON string if present, null otherwise.
 *
 * G-IDEMPOTENT gate: this check MUST precede any write to ai.decision_log.
 */
export async function checkIdempotency(
  redis: Redis,
  workspaceId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const key = buildIdempotencyKey(workspaceId, idempotencyKey);
  return redis.get(key);
}

/**
 * Store the result of a successful mutation under the idempotency key.
 * TTL: 24h. Called AFTER the write succeeds.
 */
export async function storeIdempotencyResult(
  redis: Redis,
  workspaceId: string,
  idempotencyKey: string,
  result: string,
): Promise<void> {
  const key = buildIdempotencyKey(workspaceId, idempotencyKey);
  await redis.set(key, result, 'EX', IDEM_TTL_SECONDS);
}

/**
 * InMemoryIdempotencyStore — a test double for Redis, used in unit tests.
 * Implements the same interface as ioredis.Redis for the methods we need.
 * Mutant test: remove the `get` check → double-submit inserts twice → RED.
 */
export class InMemoryIdempotencyStore {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode?: string, _ttl?: number): Promise<void> {
    this.store.set(key, value);
  }

  /** Test helper: check raw key presence */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Test helper: count all entries */
  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

/** Type alias for the minimal Redis interface we depend on. */
export type IdempotencyStore = Pick<Redis, 'get' | 'set'> | InMemoryIdempotencyStore;
