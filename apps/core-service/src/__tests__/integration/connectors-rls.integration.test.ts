/**
 * Slice D — LOCAL Postgres integration test: connector custody + OAuth flow run
 * against the REAL Brain-native FORCE-RLS schema, proving fail-closed at the wire.
 *
 * SKIP CONDITION: skipped unless INTEGRATION_TEST=true (so `vitest run` passes
 * without Docker). Stage-5 QA runs it with the dev DB up.
 *
 * SETUP (Stage-5):
 *   docker compose -f apps/core-service/docker-compose.dev.yml up -d
 *   psql ".../brain_dev" -f migrations/local-dev/01-schema-onboarding.sql
 *   psql ".../brain_dev" -f migrations/local-dev/02-enable-rls-onboarding.sql
 *   psql ".../brain_dev" -f migrations/local-dev/03-schema-connectors.sql
 *   psql ".../brain_dev" -f migrations/local-dev/04-enable-rls-connectors.sql
 *   DATABASE_URL=postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev \
 *   CONNECTOR_CUSTODY_KEY=<32-byte base64> CONNECTOR_CUSTODY_BACKING=local-aesgcm \
 *   INTEGRATION_TEST=true pnpm --filter @brain/core-service test \
 *     src/__tests__/integration/connectors-rls.integration.test.ts
 *
 * The app connects as rls_app (NON-BYPASSRLS) via DATABASE_URL — so FORCE RLS
 * actually applies and the fail-closed assertions are real.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, randomBytes } from 'node:crypto'
import { LocalAesGcmCustody } from '../../infrastructure/secrets/local-aesgcm-custody.js'
import { CredentialNotFoundError } from '../../infrastructure/secrets/credential-custody.js'
import {
  completeCallback,
  listConnectors,
  disconnect,
} from '../../application/contexts/connectors/connector-use-cases.js'
import * as oauthState from '../../application/contexts/connectors/oauth-state.js'
import { withWorkspace } from '../../infrastructure/db/workspace-context.js'
import { _resetPoolForTest } from '../../infrastructure/db/workspace-context.js'
import type { ProviderHttp } from '../../application/contexts/connectors/provider-config.js'

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'
const SUPER_URL = process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'
const APP_URL = process.env['DATABASE_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'

const superPool = new Pool({ connectionString: SUPER_URL, max: 3 })

async function seedWorkspace(): Promise<{ workspaceId: string; userId: string }> {
  const c = await superPool.connect()
  try {
    const userId = randomUUID()
    await c.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [userId, `${userId}@ex.com`])
    const ws = await c.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug, created_by_id) VALUES ($1, $2, $3) RETURNING id`,
      [`WS ${userId.slice(0, 8)}`, `ws-${userId.slice(0, 8)}`, userId],
    )
    const workspaceId = ws.rows[0]!.id
    await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [workspaceId, userId])
    return { workspaceId, userId }
  } finally {
    c.release()
  }
}

async function cleanup(): Promise<void> {
  const c = await superPool.connect()
  try {
    await c.query('DELETE FROM connector_oauth_states')
    await c.query('DELETE FROM connector_credentials')
    await c.query('DELETE FROM connector_connections')
    await c.query('DELETE FROM workspace_members')
    await c.query('DELETE FROM workspaces')
    await c.query('DELETE FROM users')
  } finally {
    c.release()
  }
}

function okHttp(content: Record<string, unknown>): ProviderHttp {
  return { async request() { return { ok: true, status: 200, json: async () => content, text: async () => '' } } }
}

describe.skipIf(!IS_INTEGRATION)('Slice D — connector custody + RLS (live local Postgres)', () => {
  beforeAll(() => {
    process.env['DATABASE_URL'] = APP_URL
    if (!process.env['CONNECTOR_CUSTODY_KEY']) {
      process.env['CONNECTOR_CUSTODY_KEY'] = randomBytes(32).toString('base64')
    }
    _resetPoolForTest()
  })
  afterEach(async () => { await cleanup(); vi.restoreAllMocks() })

  it('custody.put encrypts at rest (no plaintext token in the column) + get round-trips', async () => {
    const { workspaceId } = await seedWorkspace()
    const custody = new LocalAesGcmCustody()
    await custody.put(workspaceId, 'GOOGLE', { refresh_token: 'rt_PLAINTEXT_CANARY' })

    // The raw column (read as superuser) must NOT contain the plaintext token.
    const c = await superPool.connect()
    try {
      const res = await c.query<{ credential_enc: Buffer }>(
        `SELECT credential_enc FROM connector_credentials WHERE workspace_id = $1 AND vendor = 'GOOGLE'`,
        [workspaceId],
      )
      const blob = res.rows[0]!.credential_enc
      expect(blob).toBeInstanceOf(Buffer)
      expect(blob.toString('utf8')).not.toContain('rt_PLAINTEXT_CANARY')
      expect(blob.toString('latin1')).not.toContain('rt_PLAINTEXT_CANARY')
    } finally {
      c.release()
    }

    // get() decrypts faithfully.
    const cred = await custody.get(workspaceId, 'GOOGLE')
    expect(cred.content).toEqual({ refresh_token: 'rt_PLAINTEXT_CANARY' })
  })

  it('RLS fail-closed: a credential is unreadable from another workspace context', async () => {
    const a = await seedWorkspace()
    const b = await seedWorkspace()
    const custody = new LocalAesGcmCustody()
    await custody.put(a.workspaceId, 'META', { access_token: 'a_token' })

    // get under workspace B's context → 0 rows → CredentialNotFoundError (fail-closed).
    await expect(custody.get(b.workspaceId, 'META')).rejects.toBeInstanceOf(CredentialNotFoundError)
    // Even a direct cross-workspace SELECT under B's context returns 0 rows.
    const rows = await withWorkspace(b.workspaceId, async (tx) => {
      const r = await tx.query(`SELECT * FROM connector_credentials WHERE workspace_id = $1`, [a.workspaceId])
      return r.rows
    })
    expect(rows.length).toBe(0)
  })

  it('completeCallback: state→exchange→custody→UPSERT is idempotent (replay = 1 row)', async () => {
    const { workspaceId } = await seedWorkspace()
    // Use the REAL oauth-state persistence (createOAuthState writes to the live DB).
    const raw1 = oauthState.generateNonce()
    await oauthState.createOAuthState({ state: raw1, vendor: 'META', workspaceId, userId: randomUUID() })

    const http = (() => { let n = 0; return { async request() { n++; const d = n % 2 === 1 ? { access_token: 'short' } : { access_token: 'LONG', expires_in: 100 }; return { ok: true, status: 200, json: async () => d, text: async () => '' } } } as ProviderHttp })()
    const custody = new LocalAesGcmCustody()

    const r1 = await completeCallback({ vendor: 'META', code: 'c1', state: raw1 }, { withWorkspace, custody, http })
    expect(r1.status).toBe('CONNECTED')

    // Replay with a fresh state (provider re-issues) → UPSERT, still ONE row.
    const raw2 = oauthState.generateNonce()
    await oauthState.createOAuthState({ state: raw2, vendor: 'META', workspaceId, userId: randomUUID() })
    await completeCallback({ vendor: 'META', code: 'c2', state: raw2 }, { withWorkspace, custody, http })

    const c = await superPool.connect()
    try {
      const res = await c.query(`SELECT count(*)::int AS n FROM connector_connections WHERE workspace_id = $1 AND vendor = 'META'`, [workspaceId])
      expect(res.rows[0].n).toBe(1) // idempotent UPSERT
      const cred = await c.query(`SELECT count(*)::int AS n FROM connector_credentials WHERE workspace_id = $1 AND vendor = 'META'`, [workspaceId])
      expect(cred.rows[0].n).toBe(1)
    } finally {
      c.release()
    }
  })

  it('oauth state is one-time: a replayed state is rejected', async () => {
    const { workspaceId } = await seedWorkspace()
    const raw = oauthState.generateNonce()
    await oauthState.createOAuthState({ state: raw, vendor: 'GOOGLE', workspaceId, userId: randomUUID() })
    const first = await oauthState.validateAndConsumeOAuthState(raw, 'GOOGLE')
    expect(first?.workspaceId).toBe(workspaceId)
    const second = await oauthState.validateAndConsumeOAuthState(raw, 'GOOGLE')
    expect(second).toBeNull() // consumed
  })

  it('listConnectors reflects live status; disconnect seals the credential', async () => {
    const { workspaceId } = await seedWorkspace()
    const raw = oauthState.generateNonce()
    await oauthState.createOAuthState({ state: raw, vendor: 'GOOGLE', workspaceId, userId: randomUUID() })
    const custody = new LocalAesGcmCustody()
    await completeCallback({ vendor: 'GOOGLE', code: 'c', state: raw }, { withWorkspace, custody, http: okHttp({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }) })

    let rows = await listConnectors(workspaceId, { withWorkspace })
    expect(rows.find((r) => r.vendor === 'GOOGLE')!.status).toBe('CONNECTED')
    expect(rows.find((r) => r.vendor === 'GOOGLE')!.syncPending).toBe(true)
    expect(rows.find((r) => r.vendor === 'SHOPIFY')!.status).toBe('NOT_CONNECTED')
    expect(JSON.stringify(rows)).not.toMatch(/access_token|refresh_token|"rt"/)

    await disconnect({ vendor: 'GOOGLE', workspaceId }, { withWorkspace, custody })
    rows = await listConnectors(workspaceId, { withWorkspace })
    expect(rows.find((r) => r.vendor === 'GOOGLE')!.status).toBe('DISCONNECTED')
    await expect(custody.get(workspaceId, 'GOOGLE')).rejects.toBeInstanceOf(CredentialNotFoundError)
  })
})
