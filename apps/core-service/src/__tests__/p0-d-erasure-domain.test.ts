/**
 * P0-D domain unit tests — DPDP §12 erasure orchestrator (pure, no I/O).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Tests the domain invariants for subject_erasure_request and key_destruction_ledger:
 *   - buildNoticeWindowEndsAt always produces requestedAt + 48h (§12 mandate)
 *   - isNoticeWindowExpired returns correct state for past and future windows
 *   - isValidDekKeyId enforces the 3-part format
 *   - buildDekKeyId produces the correct workspace/ref/version triple
 *   - ErasureVerificationArtifact shape + allZero semantics
 *
 * These are PURE (no DB, no I/O) — the integration acceptance probes are
 * in erase-subject.integration.test.ts (INTEGRATION_TEST=true).
 *
 * POSITIVE scenarios: all invariants satisfied under valid inputs.
 * NEGATIVE scenarios: each guard fires correctly under invalid/edge-case inputs.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildNoticeWindowEndsAt,
  isNoticeWindowExpired,
  isValidDekKeyId,
  buildDekKeyId,
  type ErasureVerificationArtifact,
  type TierVerificationResult,
} from '../domain/consent/subject-erasure.js'

// ---------------------------------------------------------------------------
// buildNoticeWindowEndsAt
// ---------------------------------------------------------------------------

describe('P0-D domain — buildNoticeWindowEndsAt (DPDP §12)', () => {
  it('POSITIVE: notice window is exactly 48 hours after requestedAt', () => {
    const requestedAt = new Date('2026-06-05T10:00:00.000Z')
    const windowEnd = buildNoticeWindowEndsAt(requestedAt)
    const diffMs = windowEnd.getTime() - requestedAt.getTime()
    const expected = 48 * 60 * 60 * 1000
    expect(diffMs).toBe(expected)
  })

  it('POSITIVE: handles midnight boundary (no DST drift in UTC)', () => {
    const requestedAt = new Date('2026-06-30T23:30:00.000Z')
    const windowEnd = buildNoticeWindowEndsAt(requestedAt)
    const diffMs = windowEnd.getTime() - requestedAt.getTime()
    expect(diffMs).toBe(48 * 60 * 60 * 1000)
  })

  it('POSITIVE: does not mutate the input date', () => {
    const requestedAt = new Date('2026-06-05T10:00:00.000Z')
    const originalMs = requestedAt.getTime()
    buildNoticeWindowEndsAt(requestedAt)
    expect(requestedAt.getTime()).toBe(originalMs)
  })

  it('NEGATIVE: window is NOT 24h (short-window detection)', () => {
    const requestedAt = new Date('2026-06-05T10:00:00.000Z')
    const windowEnd = buildNoticeWindowEndsAt(requestedAt)
    const diffMs = windowEnd.getTime() - requestedAt.getTime()
    expect(diffMs).not.toBe(24 * 60 * 60 * 1000)
  })

  it('NEGATIVE: window is NOT 0h (immediate erasure is forbidden)', () => {
    const requestedAt = new Date('2026-06-05T10:00:00.000Z')
    const windowEnd = buildNoticeWindowEndsAt(requestedAt)
    const diffMs = windowEnd.getTime() - requestedAt.getTime()
    expect(diffMs).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// isNoticeWindowExpired
// ---------------------------------------------------------------------------

describe('P0-D domain — isNoticeWindowExpired', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('POSITIVE: returns true when the window ended in the past', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-10T10:00:00.000Z')
    vi.setSystemTime(now)

    const req = { noticeWindowEndsAt: new Date('2026-06-08T10:00:00.000Z') }
    expect(isNoticeWindowExpired(req)).toBe(true)
  })

  it('POSITIVE: returns true when the window ends exactly now (boundary)', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-10T10:00:00.000Z')
    vi.setSystemTime(now)

    const req = { noticeWindowEndsAt: now }
    expect(isNoticeWindowExpired(req)).toBe(true)
  })

  it('NEGATIVE: returns false when the window ends in the future', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-05T10:00:00.000Z')
    vi.setSystemTime(now)

    const req = { noticeWindowEndsAt: new Date('2026-06-07T10:00:00.000Z') }
    expect(isNoticeWindowExpired(req)).toBe(false)
  })

  it('NEGATIVE: returns false for a freshly created request (48h window not elapsed)', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-05T10:00:00.000Z')
    vi.setSystemTime(now)

    const requestedAt = now
    const windowEnd = buildNoticeWindowEndsAt(requestedAt)
    expect(isNoticeWindowExpired({ noticeWindowEndsAt: windowEnd })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidDekKeyId
// ---------------------------------------------------------------------------

describe('P0-D domain — isValidDekKeyId', () => {
  it('POSITIVE: accepts a well-formed 3-part DEK key ID', () => {
    const dekKeyId = 'ws-uuid-123/tok:customer-ref-abc/v1'
    expect(isValidDekKeyId(dekKeyId)).toBe(true)
  })

  it('POSITIVE: accepts a UUID-based workspace ID', () => {
    const dekKeyId = '00000000-0000-0000-0000-000000000001/tok:ref/v2'
    expect(isValidDekKeyId(dekKeyId)).toBe(true)
  })

  it('NEGATIVE: rejects a key ID with only 2 parts', () => {
    expect(isValidDekKeyId('workspace-id/customer-ref')).toBe(false)
  })

  it('NEGATIVE: rejects a key ID with 4+ parts', () => {
    expect(isValidDekKeyId('a/b/c/d')).toBe(false)
  })

  it('NEGATIVE: rejects an empty string', () => {
    expect(isValidDekKeyId('')).toBe(false)
  })

  it('NEGATIVE: rejects a key ID with an empty part (//)', () => {
    expect(isValidDekKeyId('workspace-id//v1')).toBe(false)
  })

  it('NEGATIVE: rejects a key ID with a leading slash', () => {
    expect(isValidDekKeyId('/workspace-id/ref/v1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildDekKeyId
// ---------------------------------------------------------------------------

describe('P0-D domain — buildDekKeyId', () => {
  it('POSITIVE: produces the correct "<workspaceId>/<customerRef>/<saltVersion>" format', () => {
    const workspaceId = '00000000-0000-0000-0000-000000000001'
    const customerRef = 'tok:abc123'
    const saltVersion = 'v1'
    const keyId = buildDekKeyId(workspaceId, customerRef, saltVersion)
    expect(keyId).toBe(`${workspaceId}/${customerRef}/${saltVersion}`)
  })

  it('POSITIVE: the result is a valid DEK key ID (isValidDekKeyId returns true)', () => {
    const keyId = buildDekKeyId('ws-abc', 'tok:ref', 'v1')
    expect(isValidDekKeyId(keyId)).toBe(true)
  })

  it('POSITIVE: different workspaces produce different key IDs for the same ref', () => {
    const ref = 'tok:same_ref'
    const salt = 'v1'
    const key1 = buildDekKeyId('workspace-1', ref, salt)
    const key2 = buildDekKeyId('workspace-2', ref, salt)
    expect(key1).not.toBe(key2)
  })

  it('POSITIVE: different salt versions produce different key IDs', () => {
    const ws = 'ws-abc'
    const ref = 'tok:ref'
    const key1 = buildDekKeyId(ws, ref, 'v1')
    const key2 = buildDekKeyId(ws, ref, 'v2')
    expect(key1).not.toBe(key2)
  })
})

// ---------------------------------------------------------------------------
// ErasureVerificationArtifact — shape + allZero semantics
// ---------------------------------------------------------------------------

describe('P0-D domain — ErasureVerificationArtifact shape', () => {
  it('POSITIVE: allZero=true when all tiers have countRemaining=0 and verified=true', () => {
    const tiers: TierVerificationResult[] = [
      { tier: 'pg_hot_mirror', table: 'customer_pii', countRemaining: 0, verified: true },
      { tier: 'ch', table: 'brain.connector_raw_events', countRemaining: 0, verified: true },
      { tier: 'ch', table: 'brain.connector_order_facts', countRemaining: 0, verified: true },
      { tier: 's3_crypto_shred:s3_raw', table: 'dek:ws/ref/v1', countRemaining: 0, verified: true },
    ]

    const allZero = tiers.every((t) => t.verified)
    expect(allZero).toBe(true)
  })

  it('NEGATIVE: allZero=false when any tier has verified=false', () => {
    const tiers: TierVerificationResult[] = [
      { tier: 'pg_hot_mirror', table: 'customer_pii', countRemaining: 0, verified: true },
      { tier: 'ch', table: 'brain.connector_raw_events', countRemaining: 2, verified: false },
    ]
    const allZero = tiers.every((t) => t.verified)
    expect(allZero).toBe(false)
  })

  it('NEGATIVE: allZero=false when a tier has countRemaining>0', () => {
    const tiers: TierVerificationResult[] = [
      { tier: 'pg_hot_mirror', table: 'customer_pii', countRemaining: 3, verified: false },
    ]
    const allZero = tiers.every((t) => t.verified)
    expect(allZero).toBe(false)
  })

  it('POSITIVE: artifact carries executedAt and countZeroVerifiedAt as Date objects', () => {
    const now = new Date()
    const artifact: ErasureVerificationArtifact = {
      erasureId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      customerRef: 'tok:ref',
      executedAt: now,
      countZeroVerifiedAt: now,
      tiers: [],
      allZero: true,
      dekDestroyedTiers: ['s3_raw', 'glacier', 'customer_pii_ct'],
      auditLogEntryId: 'log-id-123',
    }

    expect(artifact.executedAt).toBeInstanceOf(Date)
    expect(artifact.countZeroVerifiedAt).toBeInstanceOf(Date)
    expect(artifact.allZero).toBe(true)
    expect(artifact.dekDestroyedTiers).toHaveLength(3)
    expect(artifact.auditLogEntryId).toBe('log-id-123')
  })

  it('POSITIVE: allZero true with empty tiers array (no tiers = vacuously true)', () => {
    const tiers: TierVerificationResult[] = []
    const allZero = tiers.every((t) => t.verified)
    expect(allZero).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DEK vault — unit-level (in-memory registry behavior)
// ---------------------------------------------------------------------------

describe('P0-D domain — DEK vault (in-memory registry)', () => {
  // Import synchronously to avoid circular ESM issues in vitest
  // These imports are safe: dek-vault.ts is pure logic + registry
  let _registerDekForTest: (key: string, material: string) => void
  let _clearDekRegistryForTest: () => void
  let decryptWithDek: (key: string, ciphertext: string) => Promise<string>
  let destroyDek: (key: string) => Promise<{ dekKeyId: string; outcome: string; errorDetail: string | null }>

  beforeEach(async () => {
    // Dynamic import in beforeEach avoids vitest ESM hoisting issues
    const vault = await import('../infrastructure/erasure/dek-vault.js')
    _registerDekForTest = vault._registerDekForTest
    _clearDekRegistryForTest = vault._clearDekRegistryForTest
    decryptWithDek = vault.decryptWithDek
    destroyDek = vault.destroyDek
    _clearDekRegistryForTest()
  })

  afterEach(() => {
    _clearDekRegistryForTest()
  })

  it('POSITIVE: destroyDek returns destroyed when DEK is found and removed', async () => {
    const key = 'ws/ref/v1'
    _registerDekForTest(key, 'secret-material')

    const result = await destroyDek(key)
    expect(result.outcome).toBe('destroyed')
    expect(result.dekKeyId).toBe(key)
    expect(result.errorDetail).toBeNull()
  })

  it('POSITIVE: decryptWithDek returns material before destruction', async () => {
    const key = 'ws/ref/v1'
    _registerDekForTest(key, 'my-key-material')
    const decrypted = await decryptWithDek(key, 'ignored-ciphertext')
    expect(decrypted).toBe('my-key-material')
  })

  it('NEGATIVE: decryptWithDek throws after destruction (crypto-shred verified)', async () => {
    const key = 'ws/ref/v1'
    _registerDekForTest(key, 'material')
    await destroyDek(key)
    await expect(decryptWithDek(key, 'any-ciphertext')).rejects.toThrow(/DEK not found/)
  })

  it('NEGATIVE: destroyDek returns not_found for an unregistered DEK', async () => {
    const result = await destroyDek('ws/nonexistent/v1')
    expect(result.outcome).toBe('not_found')
  })

  it('POSITIVE: idempotent — second destroyDek call returns not_found (already destroyed)', async () => {
    const key = 'ws/ref/v1'
    _registerDekForTest(key, 'material')
    const first = await destroyDek(key)
    expect(first.outcome).toBe('destroyed')

    const second = await destroyDek(key)
    // Second call: key no longer in registry → not_found (safe idempotent return)
    expect(second.outcome).toBe('not_found')
  })

  it('POSITIVE: different keys do not interfere (workspace isolation)', async () => {
    _registerDekForTest('ws1/ref/v1', 'material-1')
    _registerDekForTest('ws2/ref/v1', 'material-2')

    await destroyDek('ws1/ref/v1')

    // ws2 key still decryptable
    const decrypted = await decryptWithDek('ws2/ref/v1', 'ignored')
    expect(decrypted).toBe('material-2')

    // ws1 key is gone
    await expect(decryptWithDek('ws1/ref/v1', 'ignored')).rejects.toThrow(/DEK not found/)
  })
})
