/**
 * Slice C — LOCAL Postgres integration test: onboarding/membership use-cases run
 * against the REAL Brain-native RLS schema, proving fail-closed at the wire.
 *
 * SKIP CONDITION: skipped unless INTEGRATION_TEST=true (so `vitest run` passes
 * without Docker). Stage-5 QA runs it with the dev DB up.
 *
 * SETUP (Founder / Stage-5):
 *   docker compose -f apps/core-service/docker-compose.dev.yml up -d
 *   psql "postgresql://postgres:postgres@localhost:5432/brain_dev" \
 *     -f apps/core-service/migrations/local-dev/01-schema-onboarding.sql
 *   psql "postgresql://postgres:postgres@localhost:5432/brain_dev" \
 *     -f apps/core-service/migrations/local-dev/02-enable-rls-onboarding.sql
 *   DATABASE_URL=postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev \
 *   INTEGRATION_TEST=true pnpm --filter @brain/core-service test \
 *     src/__tests__/integration/onboarding-rls.integration.test.ts
 *
 * The app connects as rls_app (NON-BYPASSRLS) via DATABASE_URL — so FORCE RLS
 * actually applies and the fail-closed assertions are real.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import {
  completeOnboarding,
  resolveMembership,
  listWorkspaces,
  acceptInvitation,
  ensureUser,
} from '../../application/onboarding/onboarding-use-cases.js'
import { _resetPoolForTest } from '../../infrastructure/db/workspace-context.js'

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'

// Superuser pool — DDL/seed/cleanup only. NEVER used for RLS assertions.
const SUPER_URL =
  process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'

// The app role pool the use-cases use (via DATABASE_URL → workspace-context).
const APP_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'

const superPool = new Pool({ connectionString: SUPER_URL, max: 3 })

async function truncateAll(): Promise<void> {
  const c = await superPool.connect()
  try {
    await c.query('DELETE FROM workspace_members')
    await c.query('DELETE FROM invitations')
    await c.query('DELETE FROM workspaces')
    await c.query('DELETE FROM users')
  } finally {
    c.release()
  }
}

describe.skipIf(!IS_INTEGRATION)('Slice C onboarding/membership RLS (LOCAL Postgres)', () => {
  beforeAll(() => {
    // Point the Child-1 primitive at the app role (DATABASE_URL alias).
    process.env['DATABASE_URL'] = APP_URL
    _resetPoolForTest()
  })

  afterEach(async () => {
    await truncateAll()
  })

  it('(production-correctness) the app role is NON-BYPASSRLS', async () => {
    const appPool = new Pool({ connectionString: APP_URL, max: 2 })
    try {
      const r = await appPool.query<{ rolbypassrls: boolean }>(
        'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
      )
      expect(r.rows[0]?.rolbypassrls).toBe(false)
    } finally {
      await appPool.end()
    }
  })

  it('completeOnboarding creates a real workspace + OWNER membership', async () => {
    const sub = randomUUID()
    const { workspaceId, slug } = await completeOnboarding({
      identity: { sub, email: 'founder@brand-c.test', fullName: 'Founder C' },
      fullName: 'Founder C',
      jobRole: 'Founder',
      brandName: 'Brand C',
      slug: 'brand-c',
      industry: 'Beauty',
      monthlyRevenue: '5-10L',
      platform: 'SHOPIFY',
      storeHandle: 'brand-c',
    })
    expect(slug).toBe('brand-c')

    // Verify directly via the superuser (ground truth).
    const c = await superPool.connect()
    try {
      const ws = await c.query('SELECT id, created_by_id FROM workspaces WHERE id = $1', [workspaceId])
      expect(ws.rows[0]?.created_by_id).toBe(sub)
      const mem = await c.query(
        "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, sub],
      )
      expect(mem.rows[0]?.role).toBe('OWNER')
    } finally {
      c.release()
    }
  })

  it('resolveMembership returns the workspace for a member; null for a non-member (→ /onboarding)', async () => {
    const sub = randomUUID()
    await completeOnboarding({
      identity: { sub, email: 'm@brand-d.test', fullName: 'M' },
      fullName: 'M', jobRole: '', brandName: 'Brand D', slug: 'brand-d',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })
    const resolved = await resolveMembership(sub)
    expect(resolved?.workspaceRole).toBe('OWNER')

    // A user who never onboarded resolves to null → routed to /onboarding (no grant).
    expect(await resolveMembership(randomUUID())).toBeNull()
  })

  it('FAIL-CLOSED at the wire: a context-less app-role read returns 0 rows', async () => {
    // Seed via superuser.
    const sub = randomUUID()
    await completeOnboarding({
      identity: { sub, email: 'f@brand-e.test', fullName: 'F' },
      fullName: 'F', jobRole: '', brandName: 'Brand E', slug: 'brand-e',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })

    // A BARE app-role connection (NO GUC) must see 0 rows under FORCE RLS.
    const appPool = new Pool({ connectionString: APP_URL, max: 2 })
    try {
      const members = await appPool.query('SELECT count(*)::int AS n FROM workspace_members')
      const workspaces = await appPool.query('SELECT count(*)::int AS n FROM workspaces')
      const users = await appPool.query('SELECT count(*)::int AS n FROM users')
      expect(members.rows[0]?.n).toBe(0)
      expect(workspaces.rows[0]?.n).toBe(0)
      expect(users.rows[0]?.n).toBe(0)
    } finally {
      await appPool.end()
    }
  })

  it('CROSS-WORKSPACE isolation: workspace A context cannot read workspace B rows', async () => {
    const subA = randomUUID()
    const subB = randomUUID()
    const a = await completeOnboarding({
      identity: { sub: subA, email: 'a@brand-f.test', fullName: 'A' },
      fullName: 'A', jobRole: '', brandName: 'Brand F', slug: 'brand-f',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })
    const b = await completeOnboarding({
      identity: { sub: subB, email: 'b@brand-g.test', fullName: 'B' },
      fullName: 'B', jobRole: '', brandName: 'Brand G', slug: 'brand-g',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })

    // In workspace A's context, only A's member is visible — B's is invisible.
    const appPool = new Pool({ connectionString: APP_URL, max: 2 })
    try {
      const client = await appPool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [a.workspaceId])
        await client.query("SELECT set_config('app.is_superadmin', 'false', true)")
        const visible = await client.query('SELECT count(*)::int AS n FROM workspace_members')
        const tryB = await client.query(
          'SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1',
          [b.workspaceId],
        )
        await client.query('COMMIT')
        expect(visible.rows[0]?.n).toBe(1) // only A's OWNER row
        expect(tryB.rows[0]?.n).toBe(0)    // B is invisible even with explicit WHERE
      } finally {
        client.release()
      }
    } finally {
      await appPool.end()
    }
  })

  it('acceptInvitation: PENDING invite → membership (role-mapped), idempotent on repeat', async () => {
    // Owner onboards, then we seed a PENDING invite (sender email deferred — we
    // insert the invitation row directly via superuser, simulating an invite).
    const owner = randomUUID()
    const ws = await completeOnboarding({
      identity: { sub: owner, email: 'owner@brand-h.test', fullName: 'Owner' },
      fullName: 'Owner', jobRole: '', brandName: 'Brand H', slug: 'brand-h',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })
    const token = randomUUID()
    const c = await superPool.connect()
    try {
      // The Brain-native invitations.role column is the 5-value workspace_role enum
      // (no EDITOR — that historical value is folded to MANAGER by mapInvitationRole
      // for LEGACY data only, proven in the use-case unit test). Here we seed a valid
      // Brain role (MANAGER) and assert it maps 1:1 at the accept boundary.
      await c.query(
        `INSERT INTO invitations (workspace_id, email, role, status, token, invited_by_id, expires_at)
         VALUES ($1, $2, 'MANAGER', 'PENDING', $3, $4, now() + interval '7 days')`,
        [ws.workspaceId, 'invitee@brand-h.test', token, owner],
      )
    } finally {
      c.release()
    }

    const joiner = randomUUID()
    const first = await acceptInvitation(token, { sub: joiner, email: 'invitee@brand-h.test' })
    expect(first).toMatchObject({ status: 'accepted', workspaceId: ws.workspaceId, role: 'MANAGER' })

    // Idempotent: accepting again (now a member) → already_member, no duplicate row.
    const second = await acceptInvitation(token, { sub: joiner, email: 'invitee@brand-h.test' })
    expect(second.status).toBe('already_member')

    const verify = await superPool.query(
      'SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [ws.workspaceId, joiner],
    )
    expect(verify.rows[0]?.n).toBe(1) // exactly one membership row
  })

  it('ensureUser is idempotent (created=true then false)', async () => {
    const sub = randomUUID()
    const first = await ensureUser({ sub, email: 'idem@brand.test', fullName: 'Idem' })
    expect(first.created).toBe(true)
    const second = await ensureUser({ sub, email: 'idem@brand.test', fullName: 'Idem' })
    expect(second.created).toBe(false)
  })

  it('listWorkspaces returns all memberships for a multi-workspace user', async () => {
    const sub = randomUUID()
    await completeOnboarding({
      identity: { sub, email: 'multi@brand.test', fullName: 'Multi' },
      fullName: 'Multi', jobRole: '', brandName: 'WS One', slug: 'ws-one',
      industry: '', monthlyRevenue: '', platform: 'SHOPIFY', storeHandle: null,
    })
    await completeOnboarding({
      identity: { sub, email: 'multi@brand.test', fullName: 'Multi' },
      fullName: 'Multi', jobRole: '', brandName: 'WS Two', slug: 'ws-two',
      industry: '', monthlyRevenue: '', platform: 'WOOCOMMERCE', storeHandle: null,
    })
    const list = await listWorkspaces(sub)
    expect(list).toHaveLength(2)
    expect(list.map((w) => w.slug).sort()).toEqual(['ws-one', 'ws-two'])
  })
})
