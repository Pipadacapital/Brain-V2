/**
 * Track T -- LOCAL pgbouncer-txn-pool integration test (CF-C1-POOL-1.a)
 *
 * Stage-3 deliverable + Stage-5 QA gate.
 *
 * This test closes the legacy "untestable-in-isolation" gap: the legacy Child-1
 * could only verify pool-correctness against the live :6543/:5432 at Stage-8.
 * This test runs against a LOCAL docker-compose Postgres+pgbouncer.
 *
 * F1 FIX: The test now uses rls_app (non-BYPASSRLS) for isolation assertions.
 * The postgres superuser has rolbypassrls=true and bypasses RLS even under
 * FORCE ROW LEVEL SECURITY, making ALPHA/BETA row-count assertions and the
 * fail-closed contextless assertion structurally unprovable when queries run as
 * postgres. rls_app is created by docker/initdb/01-create-rls-app-role.sql with
 * rolbypassrls=false -- RLS actually applies to this role.
 *
 * Connection split:
 *   SUPERUSER (postgres) pool -- port 5433 -- DDL only: CREATE TABLE, ENABLE,
 *     FORCE ROW LEVEL SECURITY, INSERT seed data, grant privileges, teardown.
 *   APP (rls_app) session pool -- port 5433 -- RLS isolation assertions, tx-local
 *     set_config proof, context-clear test, fail-closed contextless test.
 *   APP (rls_app) pgbouncer pool -- port 6544 -- concurrent interleaved test +
 *     fail-closed test via pool.
 *
 * SKIP CONDITION: if INTEGRATION_TEST=true is NOT set, this test is skipped.
 * The test suite (vitest run) passes without Docker. Stage-5 QA (Tanvi)
 * runs with INTEGRATION_TEST=true + docker-compose up.
 *
 * DOCKER-COMPOSE SETUP (see docker-compose.test.yml):
 *   - postgres: port 5433 (mapped from 5432 inside container)
 *   - pgbouncer: port 6544 (txn-mode, mapped from 5432 inside container)
 *
 * RUNNING LOCALLY:
 *   cd apps/core-service
 *   docker-compose -f docker-compose.test.yml up -d
 *   # Wait for both services to be healthy (~10s), then:
 *   TEST_SESSION_URL=postgresql://rls_app:rls_app_pw@localhost:5433/brain_test \
 *   TEST_POOLED_URL=postgresql://rls_app:rls_app_pw@localhost:6544/brain_test \
 *   INTEGRATION_TEST=true pnpm test src/__tests__/integration/pool-isolation.test.ts
 *   docker-compose -f docker-compose.test.yml down -v
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'

// Superuser connection -- DDL only. Connects as postgres (BYPASSRLS=true).
// Used ONLY for setup/teardown. NEVER used for RLS isolation assertions.
const SUPER_URL = process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5433/brain_test'

// Application role (rls_app, BYPASSRLS=false) -- session-mode direct connection.
// Used for ALL RLS isolation assertions.
const SESSION_URL = process.env['TEST_SESSION_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5433/brain_test'

// Application role via pgbouncer (txn-pool). Used for concurrent + pool tests.
const POOLED_URL = process.env['TEST_POOLED_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:6544/brain_test'

const ALPHA_WS = 'aaaaaaaa-0000-0000-0000-000000000001'
const BETA_WS  = 'bbbbbbbb-0000-0000-0000-000000000002'

// ---------------------------------------------------------------------------
// Test schema setup helpers
// ---------------------------------------------------------------------------

async function setupSchema(superPool: Pool, appPool: Pool): Promise<void> {
  const client = await superPool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rls_test_table (
        id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL,
        value TEXT
      );
    `)
    // Clean slate
    await client.query('DELETE FROM rls_test_table')
    // Seed ALPHA rows (2 rows)
    await client.query(
      `INSERT INTO rls_test_table (workspace_id, value) VALUES ($1, 'alpha-row-1'), ($1, 'alpha-row-2')`,
      [ALPHA_WS],
    )
    // Seed BETA rows (1 row)
    await client.query(
      `INSERT INTO rls_test_table (workspace_id, value) VALUES ($1, 'beta-row-1')`,
      [BETA_WS],
    )
    // Apply RLS policy (ws_isolation pattern -- same shape as production DDL).
    // NULLIF(..., '') converts empty string to NULL so that a bare connection
    // (or one where a prior session-SET was cleaned up with set_config('..', '', false))
    // returns 0 rows instead of throwing a UUID cast error. This matches the
    // production policy shape and is the fail-closed behavior for all empty-GUC states.
    await client.query('ALTER TABLE rls_test_table ENABLE ROW LEVEL SECURITY')
    await client.query(`
      DROP POLICY IF EXISTS ws_isolation ON rls_test_table;
      CREATE POLICY ws_isolation ON rls_test_table
        USING      (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
    `)
    // FORCE ROW LEVEL SECURITY so even the table owner is subject to RLS.
    // This is the production state that the probe verifies.
    await client.query('ALTER TABLE rls_test_table FORCE ROW LEVEL SECURITY')
    // Grant rls_app access to the newly created table.
    // (ALTER DEFAULT PRIVILEGES in initdb handles future tables, but the
    //  explicit GRANT here covers the test-created table immediately.)
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON rls_test_table TO rls_app')
  } finally {
    client.release()
  }
}

async function teardownSchema(superPool: Pool): Promise<void> {
  const client = await superPool.connect()
  try {
    await client.query('DROP TABLE IF EXISTS rls_test_table CASCADE')
  } finally {
    client.release()
  }
}

// countInContext: runs as the APP role (rls_app, BYPASSRLS=false) with a
// tx-local workspace GUC set. Under FORCE RLS, only rows matching the GUC
// are visible.
async function countInContext(pool: Pool, workspaceId: string): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId])
    await client.query("SELECT set_config('app.is_superadmin', 'false', true)")
    const result = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM rls_test_table',
    )
    await client.query('COMMIT')
    return Number(result.rows[0]?.count ?? 0)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// countContextless: runs as the APP role (rls_app, BYPASSRLS=false) with NO
// GUC set. Under FORCE RLS, current_setting('app.workspace_id', true) returns
// NULL, which does not equal any workspace_id UUID -> 0 rows (fail-closed).
async function countContextless(pool: Pool): Promise<number> {
  const client = await pool.connect()
  try {
    // No GUC set -- should return 0 after FORCE (fail-closed).
    // With rls_app (BYPASSRLS=false) this actually exercises RLS.
    // With postgres (BYPASSRLS=true) this would return 3, masking the bug.
    const result = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM rls_test_table',
    )
    return Number(result.rows[0]?.count ?? 0)
  } finally {
    client.release()
  }
}

// assertNonBypassRls: verify at runtime that the pool's role is NOT BYPASSRLS.
// This is the production correctness corollary for CF-SEC-1.
async function assertNonBypassRls(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    const result = await client.query<{ rolbypassrls: boolean }>(
      'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
    )
    const bypassrls = result.rows[0]?.rolbypassrls ?? false
    if (bypassrls) {
      throw new Error(
        `Integration test connected as a BYPASSRLS role -- RLS isolation assertions are ` +
        `unprovable. Use a non-BYPASSRLS application role (e.g. rls_app) for the ` +
        `SESSION_URL and POOLED_URL. See docker/initdb/01-create-rls-app-role.sql.`,
      )
    }
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

// Superuser pool (DDL only -- NEVER used for RLS isolation assertions).
const superPool   = new Pool({ connectionString: SUPER_URL,   max: 3 })
// App role pools (rls_app, BYPASSRLS=false -- used for all isolation assertions).
const sessionPool = new Pool({ connectionString: SESSION_URL, max: 5 })
const pooledPool  = new Pool({ connectionString: POOLED_URL,  max: 5 })

describe.skipIf(!IS_INTEGRATION)('LOCAL pgbouncer-txn-pool integration (CF-C1-POOL-1.a)', () => {
  beforeAll(async () => {
    // F1 production-correctness corollary: assert app pools are non-BYPASSRLS.
    await assertNonBypassRls(sessionPool)
    await setupSchema(superPool, sessionPool)
  })

  afterAll(async () => {
    await teardownSchema(superPool)
    await superPool.end()
    await sessionPool.end()
    await pooledPool.end()
  })

  // F1 production-correctness assertion: rls_app must have rolbypassrls=false.
  // If this test fails, all RLS isolation assertions below are meaningless.
  it('(production-correctness) rls_app role has rolbypassrls=false', async () => {
    const client = await sessionPool.connect()
    try {
      const result = await client.query<{ rolbypassrls: boolean }>(
        'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
      )
      expect(result.rows[0]?.rolbypassrls).toBe(false)
    } finally {
      client.release()
    }
  })

  // ---------------------------------------------------------------------------
  // (a) No context leak across pooled connections
  // ---------------------------------------------------------------------------
  describe('(a) No cross-workspace context leak', () => {
    it('ALPHA context sees ONLY ALPHA rows (2)', async () => {
      const count = await countInContext(sessionPool, ALPHA_WS)
      expect(count).toBe(2)
    })

    it('BETA context sees ONLY BETA rows (1)', async () => {
      const count = await countInContext(sessionPool, BETA_WS)
      expect(count).toBe(1)
    })

    it('interleaved concurrent ALPHA+BETA via pgbouncer each see only their rows', async () => {
      // Run multiple concurrent calls through the txn-pool pgbouncer.
      // If context leaks, one workspace will see the other's rows.
      const rounds = 5
      const results = await Promise.all(
        Array.from({ length: rounds }, (_, i) =>
          i % 2 === 0
            ? countInContext(pooledPool, ALPHA_WS).then((c) => ({ ws: 'ALPHA', count: c }))
            : countInContext(pooledPool, BETA_WS).then((c) => ({ ws: 'BETA', count: c })),
        ),
      )

      for (const r of results) {
        if (r.ws === 'ALPHA') expect(r.count).toBe(2)
        if (r.ws === 'BETA')  expect(r.count).toBe(1)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // (b) Context clears at tx end -- reused connection sees no prior workspace
  // ---------------------------------------------------------------------------
  describe('(b) Context clears at transaction end', () => {
    it('after ALPHA tx commits, same pooled connection with no context returns 0 rows', async () => {
      // Acquire a connection via the app role pool, set ALPHA context, commit, then re-use
      // without context. Under txn-pool, the same backend connection may be re-issued.
      // The set_config(..., true) is tx-local: it is scrubbed at COMMIT.
      const client = await sessionPool.connect()
      try {
        // ALPHA context
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [ALPHA_WS])
        const mid = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM rls_test_table')
        expect(Number(mid.rows[0]?.count)).toBe(2) // Sees ALPHA rows during tx

        await client.query('COMMIT') // Context scrubbed here (tx-local)

        // Post-commit, same client, no new context set -- must return 0 (fail-closed).
        // rls_app has BYPASSRLS=false, so RLS applies and returns 0 rows.
        const after = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM rls_test_table')
        expect(Number(after.rows[0]?.count)).toBe(0)
      } finally {
        client.release()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // (c) Session-level SET leaks -- negative control proving WHY it is banned
  // ---------------------------------------------------------------------------
  describe('(c) Session-SET negative control (WHY session-SET is banned)', () => {
    it('session-SET leaks across pool -- demonstrating the banned shape risk', async () => {
      // This test DELIBERATELY uses the banned SET (not set_config) to prove the leak.
      // It does NOT use withWorkspace; it directly issues SET SESSION to show leakage.

      const client = await sessionPool.connect()
      let leakDetected = false
      try {
        // Issue a session-level SET (BANNED -- demonstrates why it leaks)
        await client.query(`SET app.workspace_id = '${ALPHA_WS}'`)
        // In a new query (same session), context is still set -- this is the leak.
        const result = await client.query<{ setting: string }>(
          "SELECT current_setting('app.workspace_id', true) AS setting",
        )
        const setting = result.rows[0]?.setting
        if (setting === ALPHA_WS) {
          leakDetected = true
        }
        // Clean up the session SET
        await client.query("SELECT set_config('app.workspace_id', '', false)")
      } finally {
        client.release()
      }
      // The leak MUST be detected -- session-SET persists outside a transaction.
      expect(leakDetected).toBe(true)
    })

    it('tx-local set_config (the approved pattern) does NOT leak across statements', async () => {
      // After a COMMIT, a subsequent query on the same connection sees GUC as empty.
      const client = await sessionPool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [ALPHA_WS])
        await client.query('COMMIT')
        // GUC reverts to default (empty string) after commit
        const result = await client.query<{ setting: string }>(
          "SELECT current_setting('app.workspace_id', true) AS setting",
        )
        const setting = result.rows[0]?.setting
        // After commit, the GUC should be empty (no leak)
        expect(setting).toBeFalsy()
      } finally {
        client.release()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // (d) Fail-closed default -- context-less returns 0 rows after FORCE
  // ---------------------------------------------------------------------------
  describe('(d) Fail-closed default (CF-C1-RLS-DEFAULT-1.a)', () => {
    it('context-less query returns 0 rows via rls_app session pool (fail-closed)', async () => {
      // rls_app has BYPASSRLS=false, so FORCE RLS applies.
      // No GUC = current_setting('app.workspace_id', true) = NULL != any UUID -> 0 rows.
      const count = await countContextless(sessionPool)
      expect(count).toBe(0)
    })

    it('context-less query via pgbouncer pool also returns 0 rows', async () => {
      const count = await countContextless(pooledPool)
      expect(count).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Non-integration: documents what this test covers when not run with Docker
// ---------------------------------------------------------------------------
describe.skipIf(IS_INTEGRATION)('pgbouncer integration tests (SKIPPED -- INTEGRATION_TEST != true)', () => {
  it('pool-isolation tests are deferred to Stage-5 QA (Tanvi) with docker-compose', () => {
    // This is the Stage-5 QA gate: Tanvi runs with INTEGRATION_TEST=true
    // and the docker-compose.test.yml pgbouncer setup.
    // F1: tests now use rls_app (non-BYPASSRLS) so isolation assertions are real.
    // F2: docker-compose.test.yml now uses edoburu/pgbouncer (ARM64-compatible).
    expect(true).toBe(true)
  })
})
