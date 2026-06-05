/**
 * P1-C — Identity RLS + salt-wiring integration tests (VETO findings 1–3).
 *
 * @paradigm sql (deterministic; no LLM)
 *
 * Covers:
 *   Finding 1 (HIGH): workspace_identity_salt, identity_cluster_registry, and
 *     identity_cluster_edges have FORCE RLS — a context-less rls_app read returns
 *     ZERO rows (fail-closed).  Also confirms a correctly-scoped read returns the
 *     right rows (positive).
 *
 *   Finding 2 (HIGH): normalizeShopifyOrder + syncConnector pass the per-workspace
 *     salt to customerRef when IDENTITY_STITCHER=true.  Same Shopify customer at
 *     two workspaces produces DIFFERENT customer_ref values (no cross-workspace
 *     collision).
 *
 *   Finding 3 (MEDIUM): wipePgPii (called by eraseSubject) nulls all four
 *     identity columns (email_hash, phone_hash, salt_version, identity_cluster_id)
 *     AND deletes the subject's identity_cluster_edges rows.  COUNT=0 verified.
 *
 * SKIP CONDITION: skipped unless INTEGRATION_TEST=true.
 * Local run:
 *   INTEGRATION_TEST=true \
 *   ERASURE_ORCHESTRATOR=true \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/brain_dev \
 *   CONNECTOR_CUSTODY_KEY=<32-byte base64> \
 *   pnpm --filter @brain/core-service test \
 *     src/__tests__/integration/p1-c-identity-rls.integration.test.ts
 *
 * Connection model:
 *   superPool  — postgres (BYPASSRLS=true)  — seed / teardown / verify via superuser.
 *   appPool    — rls_app  (BYPASSRLS=false) — RLS isolation assertions (the only
 *                connection that proves fail-closed is real, not bypassed).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { _resetPoolForTest } from '../../infrastructure/db/workspace-context.js'
import {
  eraseSubject,
} from '../../application/contexts/consent/commands/erase-subject.js'
import { _resetErasureClientForTest } from '../../infrastructure/erasure/clickhouse-eraser.js'

// ---------------------------------------------------------------------------
// Test environment guard
// ---------------------------------------------------------------------------

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'

const SUPER_URL =
  process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'

// rls_app connects as the non-BYPASSRLS application role.  RLS FORCE actually
// applies to this role — assertions on zero rows are real, not bypassed.
const APP_URL =
  process.env['TEST_APP_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'

const superPool = new Pool({ connectionString: SUPER_URL, max: 3 })
const appPool   = new Pool({ connectionString: APP_URL,   max: 3 })

// ---------------------------------------------------------------------------
// Seed / teardown helpers
// ---------------------------------------------------------------------------

interface IdentityTestFixture {
  workspaceIdA: string
  workspaceIdB: string
  userIdA:      string
  userIdB:      string
  customerRef:  string
  saltVersion:  string
}

async function seedTwoWorkspacesWithIdentityData(): Promise<IdentityTestFixture> {
  const c = await superPool.connect()
  try {
    // Workspace A
    const userIdA = randomUUID()
    await c.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [userIdA, `${userIdA.slice(0, 8)}@test.brain`])
    const wsA = await c.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, created_by_id) VALUES ($1, $2, $3) RETURNING id`,
      [`IdentityRLSA-${userIdA.slice(0, 8)}`, `irl-a-${userIdA.slice(0, 8)}`, userIdA],
    )
    const workspaceIdA = wsA.rows[0]!.id
    await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [workspaceIdA, userIdA])

    // Workspace B
    const userIdB = randomUUID()
    await c.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [userIdB, `${userIdB.slice(0, 8)}@test.brain`])
    const wsB = await c.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, created_by_id) VALUES ($1, $2, $3) RETURNING id`,
      [`IdentityRLSB-${userIdB.slice(0, 8)}`, `irl-b-${userIdB.slice(0, 8)}`, userIdB],
    )
    const workspaceIdB = wsB.rows[0]!.id
    await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [workspaceIdB, userIdB])

    // Insert a workspace_identity_salt row for workspace A (via superuser — bypasses RLS).
    const saltVersion = 'v1'
    await c.query(
      `INSERT INTO workspace_identity_salt (workspace_id, salt_version, salt_enc, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (workspace_id, salt_version) DO NOTHING`,
      [workspaceIdA, saltVersion, Buffer.from('fake-salt-for-test')],
    )

    // Insert an identity_cluster_registry row for workspace A.
    const customerRef = `tok:irl_${randomUUID().slice(0, 8)}`
    const minLabel = customerRef
    await c.query(
      `INSERT INTO identity_cluster_registry (workspace_id, min_label, cluster_id, customer_count)
       VALUES ($1, $2, gen_random_uuid(), 1)
       ON CONFLICT (workspace_id, min_label) DO NOTHING`,
      [workspaceIdA, minLabel],
    )

    // Insert identity_cluster_edges for workspace A (node_a + node_b both this ref for simplicity).
    const nodeA = customerRef
    const nodeB = customerRef + '_b'
    // Ensure node_a <= node_b lexicographically (DB constraint).
    const [na, nb] = nodeA <= nodeB ? [nodeA, nodeB] : [nodeB, nodeA]
    await c.query(
      `INSERT INTO identity_cluster_edges (workspace_id, node_a, node_b, match_key_type)
       VALUES ($1, $2, $3, 'email_hash')
       ON CONFLICT (workspace_id, node_a, node_b) DO NOTHING`,
      [workspaceIdA, na, nb],
    )

    // Insert a customer_pii row for workspace A with all identity columns populated.
    await c.query(
      `INSERT INTO customer_pii
         (workspace_id, customer_ref, source_vendor, vendor_customer_id,
          email_ct, phone_ct, full_name_ct,
          email_hash, phone_hash, salt_version, identity_cluster_id)
       VALUES ($1, $2, 'SHOPIFY', $3, $4, $5, $6, $7, $8, $9, gen_random_uuid())
       ON CONFLICT (workspace_id, customer_ref) DO NOTHING`,
      [
        workspaceIdA,
        customerRef,
        `vendor_${randomUUID().slice(0, 8)}`,
        Buffer.from('enc_email'),
        Buffer.from('enc_phone'),
        Buffer.from('enc_name'),
        'test_email_hash_64chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.slice(0, 64),
        'test_phone_hash_64chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.slice(0, 64),
        saltVersion,
      ],
    )

    return { workspaceIdA, workspaceIdB, userIdA, userIdB, customerRef, saltVersion }
  } finally {
    c.release()
  }
}

async function cleanupTwoWorkspaces(fixture: IdentityTestFixture): Promise<void> {
  const c = await superPool.connect()
  try {
    for (const wsId of [fixture.workspaceIdA, fixture.workspaceIdB]) {
      // key_destruction_ledger has a WORM trigger — disable it for test teardown (superuser only).
      await c.query(`ALTER TABLE key_destruction_ledger DISABLE TRIGGER kdl_worm_guard`)
      await c.query(
        `DELETE FROM key_destruction_ledger WHERE erasure_id IN (
           SELECT id FROM subject_erasure_request WHERE workspace_id = $1
         )`,
        [wsId],
      )
      await c.query(`ALTER TABLE key_destruction_ledger ENABLE TRIGGER kdl_worm_guard`)

      await c.query(`DELETE FROM identity_cluster_edges      WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM identity_cluster_registry   WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM workspace_identity_salt     WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM subject_erasure_request     WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM audit_log                   WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM customer_pii                WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM workspace_members           WHERE workspace_id = $1`, [wsId])
      await c.query(`DELETE FROM workspaces                  WHERE id = $1`,           [wsId])
    }
    for (const uid of [fixture.userIdA, fixture.userIdB]) {
      await c.query(`DELETE FROM users WHERE id = $1`, [uid])
    }
  } finally {
    c.release()
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!IS_INTEGRATION)('P1-C — Identity RLS + erasure (VETO findings 1–3)', () => {
  let fixture: IdentityTestFixture

  beforeAll(async () => {
    process.env['DATABASE_URL'] = SUPER_URL
    process.env['ERASURE_ORCHESTRATOR'] = 'true'
    _resetPoolForTest()
    _resetErasureClientForTest()
    fixture = await seedTwoWorkspacesWithIdentityData()
  })

  afterAll(async () => {
    if (fixture) await cleanupTwoWorkspaces(fixture)
    await superPool.end()
    await appPool.end()
    _resetPoolForTest()
    _resetErasureClientForTest()
  })

  // =========================================================================
  // FINDING 1 — RLS on identity tables
  // =========================================================================

  describe('Finding 1 — FORCE RLS: context-less rls_app reads return ZERO rows', () => {
    it('NEGATIVE: workspace_identity_salt — context-less read returns 0 rows', async () => {
      const c = await appPool.connect()
      try {
        // No app.workspace_id set → GUC is empty → RLS NULLIF path → no rows.
        const res = await c.query<{ cnt: string }>(`SELECT count(*) AS cnt FROM workspace_identity_salt`)
        expect(parseInt(res.rows[0]!.cnt, 10)).toBe(0)
      } finally {
        c.release()
      }
    })

    it('NEGATIVE: identity_cluster_registry — context-less read returns 0 rows', async () => {
      const c = await appPool.connect()
      try {
        const res = await c.query<{ cnt: string }>(`SELECT count(*) AS cnt FROM identity_cluster_registry`)
        expect(parseInt(res.rows[0]!.cnt, 10)).toBe(0)
      } finally {
        c.release()
      }
    })

    it('NEGATIVE: identity_cluster_edges — context-less read returns 0 rows', async () => {
      const c = await appPool.connect()
      try {
        const res = await c.query<{ cnt: string }>(`SELECT count(*) AS cnt FROM identity_cluster_edges`)
        expect(parseInt(res.rows[0]!.cnt, 10)).toBe(0)
      } finally {
        c.release()
      }
    })

    it('POSITIVE: workspace_identity_salt — scoped to workspace A returns only A rows', async () => {
      const c = await appPool.connect()
      try {
        // Set workspace context for workspace A (session-level so it applies to the query).
        await c.query(`SELECT set_config('app.workspace_id', $1, false)`, [fixture.workspaceIdA])
        const res = await c.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM workspace_identity_salt`,
        )
        expect(res.rows.length).toBeGreaterThanOrEqual(1)
        for (const row of res.rows) {
          expect(row.workspace_id).toBe(fixture.workspaceIdA)
        }
      } finally {
        // Reset GUC so this connection is clean when returned to pool.
        await c.query(`SELECT set_config('app.workspace_id', '', false)`)
        c.release()
      }
    })

    it('POSITIVE: workspace_identity_salt — scoped to workspace B returns 0 rows (no salt seeded)', async () => {
      const c = await appPool.connect()
      try {
        await c.query(`SELECT set_config('app.workspace_id', $1, false)`, [fixture.workspaceIdB])
        const res = await c.query<{ cnt: string }>(
          `SELECT count(*) AS cnt FROM workspace_identity_salt`,
        )
        // Workspace B has no salt row → isolated: 0 rows.
        expect(parseInt(res.rows[0]!.cnt, 10)).toBe(0)
      } finally {
        await c.query(`SELECT set_config('app.workspace_id', '', false)`)
        c.release()
      }
    })

    it('POSITIVE: identity_cluster_registry — workspace A reads only its own cluster rows', async () => {
      const c = await appPool.connect()
      try {
        await c.query(`SELECT set_config('app.workspace_id', $1, false)`, [fixture.workspaceIdA])
        const res = await c.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM identity_cluster_registry`,
        )
        expect(res.rows.length).toBeGreaterThanOrEqual(1)
        for (const row of res.rows) {
          expect(row.workspace_id).toBe(fixture.workspaceIdA)
        }
      } finally {
        await c.query(`SELECT set_config('app.workspace_id', '', false)`)
        c.release()
      }
    })

    it('POSITIVE: identity_cluster_edges — workspace A reads only its own edges', async () => {
      const c = await appPool.connect()
      try {
        await c.query(`SELECT set_config('app.workspace_id', $1, false)`, [fixture.workspaceIdA])
        const res = await c.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM identity_cluster_edges`,
        )
        expect(res.rows.length).toBeGreaterThanOrEqual(1)
        for (const row of res.rows) {
          expect(row.workspace_id).toBe(fixture.workspaceIdA)
        }
      } finally {
        await c.query(`SELECT set_config('app.workspace_id', '', false)`)
        c.release()
      }
    })
  })

  // =========================================================================
  // FINDING 2 — Cross-workspace customer_ref isolation (unit + structural)
  // =========================================================================

  describe('Finding 2 — salt-wired normalizer: cross-workspace customer_ref no collision', () => {
    it('POSITIVE (flag ON): same Shopify customer at two workspaces → different customer_ref', async () => {
      // This is a structural (unit-level) assertion that does not require a live DB.
      // It proves the normalizeShopifyOrder fix is correct: passing different salts
      // produces different customer_ref values.
      const { normalizeShopifyOrder } = await import(
        '../../application/contexts/connectors/sync/normalizers.js'
      )

      const vendorCustomerId = 'gid://shopify/Customer/999'
      const saltWsA = Buffer.alloc(32, 0xaa) // workspace A salt
      const saltWsB = Buffer.alloc(32, 0xbb) // workspace B salt

      const savedFlag = process.env['IDENTITY_STITCHER']
      process.env['IDENTITY_STITCHER'] = 'true'

      try {
        const node = { id: 'gid://shopify/Order/1', customer: { id: vendorCustomerId } }
        const { order: orderA } = normalizeShopifyOrder(node, saltWsA)
        const { order: orderB } = normalizeShopifyOrder(node, saltWsB)

        expect(orderA.customerRef).not.toBeNull()
        expect(orderB.customerRef).not.toBeNull()
        // Cross-workspace isolation: same vendor customer → different ref per workspace.
        expect(orderA.customerRef).not.toBe(orderB.customerRef)
      } finally {
        if (savedFlag !== undefined) {
          process.env['IDENTITY_STITCHER'] = savedFlag
        } else {
          delete process.env['IDENTITY_STITCHER']
        }
      }
    })

    it('POSITIVE (flag ON): same workspace + same customer → stable customer_ref (idempotent)', async () => {
      const { normalizeShopifyOrder } = await import(
        '../../application/contexts/connectors/sync/normalizers.js'
      )

      const vendorCustomerId = 'gid://shopify/Customer/999'
      const saltWsA = Buffer.alloc(32, 0xaa)
      const node = { id: 'gid://shopify/Order/1', customer: { id: vendorCustomerId } }

      const savedFlag = process.env['IDENTITY_STITCHER']
      process.env['IDENTITY_STITCHER'] = 'true'
      try {
        const { order: order1 } = normalizeShopifyOrder(node, saltWsA)
        const { order: order2 } = normalizeShopifyOrder(node, saltWsA)
        expect(order1.customerRef).toBe(order2.customerRef)
      } finally {
        if (savedFlag !== undefined) {
          process.env['IDENTITY_STITCHER'] = savedFlag
        } else {
          delete process.env['IDENTITY_STITCHER']
        }
      }
    })

    it('NEGATIVE (flag OFF): no salt path taken, legacy sha256 — backward compat preserved', async () => {
      const { normalizeShopifyOrder } = await import(
        '../../application/contexts/connectors/sync/normalizers.js'
      )

      const vendorCustomerId = 'gid://shopify/Customer/999'
      const node = { id: 'gid://shopify/Order/1', customer: { id: vendorCustomerId } }

      const savedFlag = process.env['IDENTITY_STITCHER']
      process.env['IDENTITY_STITCHER'] = 'false'
      try {
        // Flag OFF: result must be a 32-char hex (legacy bare sha256).
        const { order } = normalizeShopifyOrder(node)
        expect(order.customerRef).toMatch(/^[0-9a-f]{32}$/)

        // Flag OFF with a salt passed — salt should be ignored (flag check in acl.customerRef).
        const saltWsA = Buffer.alloc(32, 0xaa)
        const { order: orderWithSalt } = normalizeShopifyOrder(node, saltWsA)
        // Both produce the bare sha256 path (legacy result should be identical).
        expect(orderWithSalt.customerRef).toBe(order.customerRef)
      } finally {
        if (savedFlag !== undefined) {
          process.env['IDENTITY_STITCHER'] = savedFlag
        } else {
          delete process.env['IDENTITY_STITCHER']
        }
      }
    })

    it('NEGATIVE: null customer id → null customer_ref regardless of salt or flag', async () => {
      const { normalizeShopifyOrder } = await import(
        '../../application/contexts/connectors/sync/normalizers.js'
      )
      const saltWsA = Buffer.alloc(32, 0xaa)
      const node = { id: 'gid://shopify/Order/1', customer: null }

      const savedFlag = process.env['IDENTITY_STITCHER']
      process.env['IDENTITY_STITCHER'] = 'true'
      try {
        const { order } = normalizeShopifyOrder(node, saltWsA)
        expect(order.customerRef).toBeNull()
      } finally {
        if (savedFlag !== undefined) {
          process.env['IDENTITY_STITCHER'] = savedFlag
        } else {
          delete process.env['IDENTITY_STITCHER']
        }
      }
    })
  })

  // =========================================================================
  // FINDING 3 — Erasure covers all identity columns + deletes edges
  // =========================================================================

  describe('Finding 3 — wipePgPii: erasure nulls all 4 identity columns + deletes edges', () => {
    it('POSITIVE: all four identity columns are NULL after eraseSubject', async () => {
      process.env['ERASURE_ORCHESTRATOR'] = 'true'

      await eraseSubject({
        workspaceId: fixture.workspaceIdA,
        customerRef: fixture.customerRef,
        requestedByUserId: fixture.userIdA,
        saltVersion: fixture.saltVersion,
        _skipNoticeWindowCheckForTest: true,
      })

      const c = await superPool.connect()
      try {
        const res = await c.query<{
          email_hash: string | null
          phone_hash: string | null
          salt_version: string | null
          identity_cluster_id: string | null
          tombstoned_at: string | null
        }>(
          `SELECT email_hash, phone_hash, salt_version, identity_cluster_id, tombstoned_at
           FROM customer_pii
           WHERE workspace_id = $1 AND customer_ref = $2`,
          [fixture.workspaceIdA, fixture.customerRef],
        )

        expect(res.rows.length).toBe(1)
        const row = res.rows[0]!

        // DPDP §12: all identity-derived columns must be NULL after erasure.
        expect(row.email_hash).toBeNull()
        expect(row.phone_hash).toBeNull()
        expect(row.salt_version).toBeNull()
        expect(row.identity_cluster_id).toBeNull()

        // The row must also be tombstoned.
        expect(row.tombstoned_at).not.toBeNull()
      } finally {
        c.release()
      }
    })

    it('POSITIVE: identity_cluster_edges for the subject are deleted after eraseSubject', async () => {
      const c = await superPool.connect()
      try {
        const res = await c.query<{ cnt: string }>(
          `SELECT count(*) AS cnt FROM identity_cluster_edges
           WHERE workspace_id = $1 AND (node_a = $2 OR node_b = $2)`,
          [fixture.workspaceIdA, fixture.customerRef],
        )
        // COUNT must be 0 — all edges for this subject are deleted.
        expect(parseInt(res.rows[0]!.cnt, 10)).toBe(0)
      } finally {
        c.release()
      }
    })

    it('NEGATIVE: re-running erasure on a tombstoned subject is idempotent (COUNT still 0)', async () => {
      process.env['ERASURE_ORCHESTRATOR'] = 'true'

      // Second call — already completed; must short-circuit.
      const result = await eraseSubject({
        workspaceId: fixture.workspaceIdA,
        customerRef: fixture.customerRef,
        requestedByUserId: fixture.userIdA,
        saltVersion: fixture.saltVersion,
        _skipNoticeWindowCheckForTest: true,
      })

      expect(result.artifact.allZero).toBe(true)

      // Confirm columns are still NULL (idempotency: no re-population).
      const c = await superPool.connect()
      try {
        const res = await c.query<{ email_hash: string | null }>(
          `SELECT email_hash FROM customer_pii WHERE workspace_id = $1 AND customer_ref = $2`,
          [fixture.workspaceIdA, fixture.customerRef],
        )
        expect(res.rows[0]!.email_hash).toBeNull()
      } finally {
        c.release()
      }
    })
  })
})
