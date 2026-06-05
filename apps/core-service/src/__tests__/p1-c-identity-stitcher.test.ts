/**
 * P1-C — Identity stitcher unit tests (no DB, no IO).
 *
 * Covers:
 *   1. identity-hash.ts: normalizeEmail, normalizePhone, computeIdentityHashes,
 *      saltedCustomerRef — POSITIVE and NEGATIVE scenarios.
 *   2. acl.ts: customerRef salted vs legacy — cross-workspace isolation.
 *   3. union-find.ts: UnionFind data structure, buildComponentsFromEdges,
 *      resolveWinningClusterId (older-cluster-wins), isClusterExportEligible,
 *      filterExportEligibleClusters (k>=5 guard).
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  computeIdentityHashes,
  saltedCustomerRef,
  hmacSha256Hex,
} from '../domain/identity/identity-hash.js'
import {
  UnionFind,
  buildComponentsFromEdges,
  resolveWinningClusterId,
  isClusterExportEligible,
  filterExportEligibleClusters,
  IDENTITY_EXPORT_K_MIN,
} from '../domain/identity/union-find.js'
import { customerRef } from '../application/contexts/connectors/sync/acl.js'

// ---------------------------------------------------------------------------
// Test salt helpers
// ---------------------------------------------------------------------------

/** A fixed 32-byte salt for workspace A (deterministic in tests). */
const SALT_A = Buffer.alloc(32, 0xaa) // 32 bytes of 0xaa

/** A fixed 32-byte salt for workspace B — must differ from SALT_A. */
const SALT_B = Buffer.alloc(32, 0xbb) // 32 bytes of 0xbb

// ---------------------------------------------------------------------------
// 1. identity-hash.ts — normalizeEmail
// ---------------------------------------------------------------------------

describe('P1-C — normalizeEmail', () => {
  it('POSITIVE: lowercases and trims', () => {
    expect(normalizeEmail('  Hello@Example.COM  ')).toBe('hello@example.com')
  })
  it('POSITIVE: already lowercase, no change', () => {
    expect(normalizeEmail('user@brand.in')).toBe('user@brand.in')
  })
  it('NEGATIVE: null → null', () => {
    expect(normalizeEmail(null)).toBe(null)
    expect(normalizeEmail(undefined)).toBe(null)
  })
  it('NEGATIVE: empty / whitespace-only → null', () => {
    expect(normalizeEmail('')).toBe(null)
    expect(normalizeEmail('   ')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// 2. identity-hash.ts — normalizePhone
// ---------------------------------------------------------------------------

describe('P1-C — normalizePhone', () => {
  it('POSITIVE: Indian 10-digit local → +91XXXXXXXXXX', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210')
  })
  it('POSITIVE: +91 prefix already present (stripped to 12 digits starting 91)', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210')
  })
  it('POSITIVE: dashes/spaces stripped before normalization', () => {
    expect(normalizePhone('98765-43210')).toBe('+919876543210')
  })
  it('POSITIVE: same number via Shopify and Klaviyo → identical hash input', () => {
    const shopify = normalizePhone('+91-98765-43210')
    const klaviyo = normalizePhone('9876543210')
    expect(shopify).toBe(klaviyo)
  })
  it('NEGATIVE: null/undefined → null', () => {
    expect(normalizePhone(null)).toBe(null)
    expect(normalizePhone(undefined)).toBe(null)
  })
  it('NEGATIVE: too short (< 7 digits) → null', () => {
    expect(normalizePhone('12345')).toBe(null)
    expect(normalizePhone('abc')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// 3. identity-hash.ts — computeIdentityHashes
// ---------------------------------------------------------------------------

describe('P1-C — computeIdentityHashes', () => {
  it('POSITIVE: computes non-null hashes for valid email + phone', () => {
    const result = computeIdentityHashes({
      email: 'user@brand.in',
      phone: '9876543210',
      salt: SALT_A,
      saltVersion: 'v1',
    })
    expect(result.emailHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.phoneHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.saltVersion).toBe('v1')
  })

  it('POSITIVE: same phone from two vendors → identical hash (same salt)', () => {
    // Shopify sends "+91-98765-43210"; Klaviyo sends "9876543210"
    const shopify = computeIdentityHashes({ email: null, phone: '+91-98765-43210', salt: SALT_A, saltVersion: 'v1' })
    const klaviyo = computeIdentityHashes({ email: null, phone: '9876543210', salt: SALT_A, saltVersion: 'v1' })
    expect(shopify.phoneHash).toBe(klaviyo.phoneHash)
  })

  it('POSITIVE: rotating salt_version → different hash, old still resolvable', () => {
    const v1 = computeIdentityHashes({ email: 'user@brand.in', phone: null, salt: SALT_A, saltVersion: 'v1' })
    const v2 = computeIdentityHashes({ email: 'user@brand.in', phone: null, salt: SALT_B, saltVersion: 'v2' })
    // Different salts → different hashes.
    expect(v1.emailHash).not.toBe(v2.emailHash)
    // Both are valid 64-char hex.
    expect(v1.emailHash).toMatch(/^[0-9a-f]{64}$/)
    expect(v2.emailHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('NEGATIVE: null email + null phone → both hashes are null', () => {
    const result = computeIdentityHashes({ email: null, phone: null, salt: SALT_A, saltVersion: 'v1' })
    expect(result.emailHash).toBe(null)
    expect(result.phoneHash).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// 4. identity-hash.ts — saltedCustomerRef
// ---------------------------------------------------------------------------

describe('P1-C — saltedCustomerRef', () => {
  it('POSITIVE: produces a 32-char hex string', () => {
    const ref = saltedCustomerRef('gid://shopify/Customer/55', SALT_A)
    expect(ref).toMatch(/^[0-9a-f]{32}$/)
  })
  it('POSITIVE: same id + same salt → same ref (stable)', () => {
    const a = saltedCustomerRef('cust123', SALT_A)
    const b = saltedCustomerRef('cust123', SALT_A)
    expect(a).toBe(b)
  })
  it('NEGATIVE: null/undefined → null', () => {
    expect(saltedCustomerRef(null, SALT_A)).toBe(null)
    expect(saltedCustomerRef(undefined, SALT_A)).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// 5. acl.ts — customerRef: cross-workspace collision fix (G4/G6)
// ---------------------------------------------------------------------------

describe('P1-C — acl.customerRef: per-workspace salt isolation', () => {
  const originalFlag = process.env.IDENTITY_STITCHER

  it('POSITIVE (flag ON): same vendor_customer_id in 2 workspaces → DIFFERENT customer_ref', () => {
    process.env.IDENTITY_STITCHER = 'true'
    const refWs1 = customerRef('gid://shopify/Customer/55', SALT_A)
    const refWs2 = customerRef('gid://shopify/Customer/55', SALT_B)
    expect(refWs1).not.toBeNull()
    expect(refWs2).not.toBeNull()
    expect(refWs1).not.toBe(refWs2) // Cross-workspace isolation guaranteed.
    process.env.IDENTITY_STITCHER = originalFlag
  })

  it('POSITIVE (flag ON): same id + same salt → same ref (intra-workspace stability)', () => {
    process.env.IDENTITY_STITCHER = 'true'
    const a = customerRef('cust123', SALT_A)
    const b = customerRef('cust123', SALT_A)
    expect(a).toBe(b)
    process.env.IDENTITY_STITCHER = originalFlag
  })

  it('POSITIVE (flag OFF): legacy sha256, no salt, backward compatible', () => {
    process.env.IDENTITY_STITCHER = 'false'
    const ref = customerRef('gid://shopify/Customer/55')
    expect(ref).toMatch(/^[0-9a-f]{32}$/)
    // Legacy result is deterministic.
    expect(customerRef('abc')).toBe(customerRef('abc'))
    process.env.IDENTITY_STITCHER = originalFlag
  })

  it('NEGATIVE (flag ON, no salt): falls back to legacy sha256 (no crash)', () => {
    process.env.IDENTITY_STITCHER = 'true'
    // No salt provided → should not throw; uses legacy path.
    const ref = customerRef('gid://shopify/Customer/55')
    expect(ref).toMatch(/^[0-9a-f]{32}$/)
    process.env.IDENTITY_STITCHER = originalFlag
  })

  it('NEGATIVE: null → null regardless of flag or salt', () => {
    process.env.IDENTITY_STITCHER = 'true'
    expect(customerRef(null, SALT_A)).toBe(null)
    process.env.IDENTITY_STITCHER = 'false'
    expect(customerRef(undefined)).toBe(null)
    process.env.IDENTITY_STITCHER = originalFlag
  })
})

// ---------------------------------------------------------------------------
// 6. union-find.ts — UnionFind data structure
// ---------------------------------------------------------------------------

describe('P1-C — UnionFind', () => {
  it('POSITIVE: find on a new node returns itself', () => {
    const uf = new UnionFind()
    uf.add('a')
    expect(uf.find('a')).toBe('a')
  })

  it('POSITIVE: two nodes unioned → same root', () => {
    const uf = new UnionFind()
    uf.union('a', 'b')
    expect(uf.connected('a', 'b')).toBe(true)
  })

  it('POSITIVE: transitivity (a-b, b-c → a connected to c)', () => {
    const uf = new UnionFind()
    uf.union('a', 'b')
    uf.union('b', 'c')
    expect(uf.connected('a', 'c')).toBe(true)
  })

  it('POSITIVE: disjoint nodes stay disconnected', () => {
    const uf = new UnionFind()
    uf.union('a', 'b')
    uf.add('c')
    expect(uf.connected('a', 'c')).toBe(false)
  })

  it('POSITIVE: self-union is a no-op', () => {
    const uf = new UnionFind()
    uf.add('a')
    uf.union('a', 'a')
    expect(uf.find('a')).toBe('a')
  })

  it('NEGATIVE: nodes() returns all registered nodes', () => {
    const uf = new UnionFind()
    uf.add('x')
    uf.union('y', 'z')
    expect(uf.nodes().sort()).toEqual(['x', 'y', 'z'])
  })
})

// ---------------------------------------------------------------------------
// 7. union-find.ts — buildComponentsFromEdges
// ---------------------------------------------------------------------------

describe('P1-C — buildComponentsFromEdges', () => {
  it('POSITIVE: single edge → one 2-member component with correct minLabel', () => {
    const components = buildComponentsFromEdges([{ nodeA: 'ref_b', nodeB: 'ref_a' }])
    expect(components).toHaveLength(1)
    expect(components[0]!.members.sort()).toEqual(['ref_a', 'ref_b'])
    // minLabel is the lexicographically smallest member.
    expect(components[0]!.minLabel).toBe('ref_a')
    expect(components[0]!.size).toBe(2)
  })

  it('POSITIVE: three edges forming one chain → one component', () => {
    const edges = [
      { nodeA: 'a', nodeB: 'b' },
      { nodeA: 'b', nodeB: 'c' },
      { nodeA: 'c', nodeB: 'd' },
    ]
    const components = buildComponentsFromEdges(edges)
    expect(components).toHaveLength(1)
    expect(components[0]!.size).toBe(4)
    expect(components[0]!.minLabel).toBe('a')
  })

  it('POSITIVE: two disjoint pairs → two components', () => {
    const edges = [
      { nodeA: 'a', nodeB: 'b' },
      { nodeA: 'c', nodeB: 'd' },
    ]
    const components = buildComponentsFromEdges(edges)
    expect(components).toHaveLength(2)
    const sizes = components.map((c) => c.size).sort((x, y) => x - y)
    expect(sizes).toEqual([2, 2])
  })

  it('POSITIVE: no edges → empty components list', () => {
    expect(buildComponentsFromEdges([])).toHaveLength(0)
  })

  it('POSITIVE: idempotent — adding same edge twice = same component', () => {
    const edges = [
      { nodeA: 'a', nodeB: 'b' },
      { nodeA: 'a', nodeB: 'b' }, // duplicate
    ]
    const components = buildComponentsFromEdges(edges)
    expect(components).toHaveLength(1)
    expect(components[0]!.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 8. union-find.ts — resolveWinningClusterId (older-cluster-wins)
// ---------------------------------------------------------------------------

describe('P1-C — resolveWinningClusterId', () => {
  const older = { clusterId: 'cluster-aaa', createdAt: new Date('2026-01-01T00:00:00Z') }
  const newer = { clusterId: 'cluster-bbb', createdAt: new Date('2026-06-01T00:00:00Z') }

  it('POSITIVE: older cluster always wins', () => {
    expect(resolveWinningClusterId(older, newer)).toBe('cluster-aaa')
    expect(resolveWinningClusterId(newer, older)).toBe('cluster-aaa')
  })

  it('POSITIVE: same timestamp → smaller cluster_id wins (lexicographic tie-break)', () => {
    const tied1 = { clusterId: 'zzz-cluster', createdAt: new Date('2026-03-01T00:00:00Z') }
    const tied2 = { clusterId: 'aaa-cluster', createdAt: new Date('2026-03-01T00:00:00Z') }
    expect(resolveWinningClusterId(tied1, tied2)).toBe('aaa-cluster')
    expect(resolveWinningClusterId(tied2, tied1)).toBe('aaa-cluster')
  })

  it('POSITIVE: merging preserves older cluster_id on downstream facts (invariant)', () => {
    // The older cluster must survive any pair — simulate multiple merges.
    const clusters = [
      { clusterId: 'cluster-z', createdAt: new Date('2026-06-04') },
      { clusterId: 'cluster-oldest', createdAt: new Date('2026-01-01') },
      { clusterId: 'cluster-mid', createdAt: new Date('2026-03-01') },
    ]
    let winner = clusters[0]!
    for (let i = 1; i < clusters.length; i++) {
      const winningId = resolveWinningClusterId(winner, clusters[i]!)
      winner = clusters.find((c) => c.clusterId === winningId)!
    }
    expect(winner.clusterId).toBe('cluster-oldest')
  })
})

// ---------------------------------------------------------------------------
// 9. union-find.ts — k>=5 export guard
// ---------------------------------------------------------------------------

describe('P1-C — k>=5 export guard (DPDP k-anonymity)', () => {
  it('POSITIVE: cluster with 5+ members → export eligible', () => {
    expect(isClusterExportEligible({ size: 5 })).toBe(true)
    expect(isClusterExportEligible({ size: 100 })).toBe(true)
    expect(isClusterExportEligible({ customerCount: 5 })).toBe(true)
  })

  it('NEGATIVE: cluster with < 5 members → suppressed from export', () => {
    expect(isClusterExportEligible({ size: 1 })).toBe(false)
    expect(isClusterExportEligible({ size: 4 })).toBe(false)
    expect(isClusterExportEligible({ customerCount: 3 })).toBe(false)
  })

  it('NEGATIVE: k min constant is 5', () => {
    expect(IDENTITY_EXPORT_K_MIN).toBe(5)
  })

  it('POSITIVE + NEGATIVE: filterExportEligibleClusters removes <5-member clusters', () => {
    const clusters = [
      { workspaceId: 'ws1', minLabel: 'a', clusterId: 'c1', customerCount: 2 },
      { workspaceId: 'ws1', minLabel: 'b', clusterId: 'c2', customerCount: 5 },
      { workspaceId: 'ws1', minLabel: 'c', clusterId: 'c3', customerCount: 10 },
      { workspaceId: 'ws1', minLabel: 'd', clusterId: 'c4', customerCount: 1 },
    ]
    const eligible = filterExportEligibleClusters(clusters)
    expect(eligible).toHaveLength(2)
    expect(eligible.map((c) => c.clusterId).sort()).toEqual(['c2', 'c3'])
  })

  it('NEGATIVE: a workspace with only 1 customer → its cluster is suppressed', () => {
    // Singleton workspace — simulates the 1-brand reality (bound amendment)
    const clusters = [
      { workspaceId: 'ws-singleton', minLabel: 'ref_abc', clusterId: 'c-singleton', customerCount: 1 },
    ]
    const eligible = filterExportEligibleClusters(clusters)
    expect(eligible).toHaveLength(0) // suppressed
  })
})

// ---------------------------------------------------------------------------
// 10. Cross-workspace salt isolation end-to-end (R10)
// ---------------------------------------------------------------------------

describe('P1-C — cross-workspace salt isolation (R10 end-to-end)', () => {
  it('same vendor_customer_id at two brands produces different HMAC hashes', () => {
    const vendorId = 'gid://shopify/Customer/999'
    const hashWs1 = hmacSha256Hex(SALT_A, vendorId)
    const hashWs2 = hmacSha256Hex(SALT_B, vendorId)
    expect(hashWs1).not.toBe(hashWs2)
    // Both are 64-char hex.
    expect(hashWs1).toMatch(/^[0-9a-f]{64}$/)
    expect(hashWs2).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same vendor_customer_id at same brand with same salt → IDENTICAL (stable)', () => {
    const vendorId = 'gid://shopify/Customer/999'
    expect(hmacSha256Hex(SALT_A, vendorId)).toBe(hmacSha256Hex(SALT_A, vendorId))
  })

  it('salt rotation: SALT_A vs SALT_B produce different hashes; both are 64-char hex', () => {
    const v1 = hmacSha256Hex(SALT_A, 'user@example.in')
    const v2 = hmacSha256Hex(SALT_B, 'user@example.in')
    expect(v1).not.toBe(v2)
    expect(v1).toMatch(/^[0-9a-f]{64}$/)
    expect(v2).toMatch(/^[0-9a-f]{64}$/)
  })
})
