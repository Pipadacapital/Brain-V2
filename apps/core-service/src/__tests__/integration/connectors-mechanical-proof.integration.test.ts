/**
 * Slice D — MECHANICAL VERIFICATION proof (Stage 5). Runs the full flow against the
 * LIVE local Postgres + real OAuth client config (from the gateway .env), printing
 * NON-secret captured output: the built auth URLs (client_id REDACTED), the at-rest
 * ciphertext proof, the decrypt round-trip, and the no-token status list.
 *
 * The provider TOKEN EXCHANGE uses a fixture ProviderHttp (no live consent needed) —
 * this is the mechanical seam the directive requires. Run with INTEGRATION_TEST=true
 * + the gateway .env loaded (--env-file) so the real client_ids/scopes are exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { randomUUID, createHmac } from 'node:crypto'
import { buildAuthUrl, type ProviderHttp } from '../../application/connectors/provider-config.js'
import {
  completeCallback,
  listConnectors,
} from '../../application/connectors/connector-use-cases.js'
import { generateNonce, createOAuthState } from '../../application/connectors/oauth-state.js'
import { withWorkspace, _resetPoolForTest } from '../../infrastructure/db/workspace-context.js'
import { LocalAesGcmCustody } from '../../infrastructure/secrets/local-aesgcm-custody.js'

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'
const SUPER_URL = process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'
const APP_URL = process.env['DATABASE_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'
const superPool = new Pool({ connectionString: SUPER_URL, max: 2 })

/** Replace the client_id value with <PRESENT> to prove presence WITHOUT echoing it. */
function redactClientId(u: string): string {
  const url = new URL(u)
  if (url.searchParams.has('client_id')) url.searchParams.set('client_id', '<PRESENT>')
  return decodeURIComponent(url.toString())
}

describe.skipIf(!IS_INTEGRATION)('Slice D — mechanical verification proof (live DB + real config)', () => {
  let workspaceId: string
  let userId: string

  beforeAll(async () => {
    process.env['DATABASE_URL'] = APP_URL
    _resetPoolForTest()
    const c = await superPool.connect()
    userId = randomUUID()
    await c.query(`INSERT INTO users (id,email) VALUES ($1,$2)`, [userId, `${userId}@ex.com`])
    const ws = await c.query<{ id: string }>(`INSERT INTO workspaces (name,slug,created_by_id) VALUES ($1,$2,$3) RETURNING id`, ['Proof', `proof-${userId.slice(0, 8)}`, userId])
    workspaceId = ws.rows[0]!.id
    await c.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'OWNER')`, [workspaceId, userId])
    c.release()
  })

  afterAll(async () => {
    const c = await superPool.connect()
    await c.query('DELETE FROM connector_oauth_states')
    await c.query('DELETE FROM connector_credentials')
    await c.query('DELETE FROM connector_connections')
    await c.query('DELETE FROM workspace_members WHERE user_id=$1', [userId])
    await c.query('DELETE FROM workspaces WHERE id=$1', [workspaceId])
    await c.query('DELETE FROM users WHERE id=$1', [userId])
    c.release()
    await superPool.end()
  })

  it('PROOF 1 — initiate builds the correct auth URL per vendor (client_id redacted)', () => {
    const shopify = buildAuthUrl('SHOPIFY', { state: 'NONCE_SHOPIFY', shopDomain: 'demo.myshopify.com' })
    const meta = buildAuthUrl('META', { state: 'NONCE_META' })
    const google = buildAuthUrl('GOOGLE', { state: 'NONCE_GOOGLE' })
    console.log('\n[PROOF 1] AUTH URLs (client_id REDACTED to <PRESENT>):')
    console.log('  SHOPIFY:', redactClientId(shopify))
    console.log('  META:   ', redactClientId(meta))
    console.log('  GOOGLE: ', redactClientId(google))

    // Assert the load-bearing params per vendor.
    expect(new URL(shopify).pathname).toBe('/admin/oauth/authorize')
    expect(new URL(shopify).searchParams.get('state')).toBe('NONCE_SHOPIFY')
    expect(new URL(shopify).searchParams.get('client_id')).toBeTruthy()
    expect(new URL(meta).pathname).toMatch(/\/dialog\/oauth$/)
    expect(new URL(meta).searchParams.get('response_type')).toBe('code')
    expect(new URL(google).searchParams.get('access_type')).toBe('offline')
    expect(new URL(google).searchParams.get('prompt')).toBe('consent')
  })

  it('PROOF 2 — callback exchange → encrypted at rest → decrypt round-trip → no-token list', async () => {
    const custody = new LocalAesGcmCustody()
    const vendors = ['SHOPIFY', 'META', 'GOOGLE'] as const
    for (const vendor of vendors) {
      const raw = generateNonce()
      await createOAuthState({ state: raw, vendor, workspaceId, userId, shopDomain: vendor === 'SHOPIFY' ? 'demo.myshopify.com' : null })
      let n = 0
      const http: ProviderHttp = {
        async request() {
          n++
          let d: Record<string, unknown>
          if (vendor === 'SHOPIFY') d = { access_token: 'shpat_FIXTURE', scope: 'read_orders,read_products' }
          else if (vendor === 'META') d = n === 1 ? { access_token: 'short_FIXTURE' } : { access_token: 'meta_long_FIXTURE', expires_in: 5184000 }
          else d = { access_token: 'g_at_FIXTURE', refresh_token: 'g_rt_FIXTURE', expires_in: 3600 }
          return { ok: true, status: 200, json: async () => d, text: async () => '' }
        },
      }
      let query: Record<string, string> | undefined
      if (vendor === 'SHOPIFY') {
        const q = { shop: 'demo.myshopify.com', timestamp: '1', code: 'CODE' }
        const msg = Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
        query = { ...q, hmac: createHmac('sha256', process.env['SHOPIFY_CLIENT_SECRET']!).update(msg).digest('hex') }
      }
      const res = await completeCallback({ vendor, code: 'CODE', state: raw, query }, { withWorkspace, custody, http })
      expect(res.status).toBe('CONNECTED')
      expect(JSON.stringify(res)).not.toContain('FIXTURE') // no token in result
    }

    // At-rest proof: credential_enc is ciphertext, no plaintext token.
    const c = await superPool.connect()
    const enc = await c.query<{ vendor: string; credential_enc: Buffer }>(`SELECT vendor, credential_enc FROM connector_credentials WHERE workspace_id=$1 ORDER BY vendor`, [workspaceId])
    c.release()
    console.log('\n[PROOF 2] AT-REST (credential_enc is AES-256-GCM ciphertext):')
    for (const r of enc.rows) {
      const hasPlain = r.credential_enc.toString('latin1').includes('FIXTURE')
      console.log(`  ${r.vendor}: ${r.credential_enc.length} bytes, plaintext-token-present=${hasPlain}, iv+tag(28B) hex=${r.credential_enc.subarray(0, 28).toString('hex')}`)
      expect(hasPlain).toBe(false)
    }
    expect(enc.rows.length).toBe(3)

    // Decrypt round-trip proof.
    console.log('\n[PROOF 3] DECRYPT round-trip:')
    for (const vendor of vendors) {
      const cred = await custody.get(workspaceId, vendor)
      console.log(`  ${vendor}: content keys = [${Object.keys(cred.content).sort().join(', ')}]`)
      expect(Object.keys(cred.content).length).toBeGreaterThan(0)
    }

    // No-token status list + sync-pending (ingestion deferred).
    const rows = await listConnectors(workspaceId, { withWorkspace })
    console.log('\n[PROOF 4] LIST (no token; syncPending = ingestion deferred):')
    for (const r of rows) console.log(`  ${r.vendor}: status=${r.status} syncPending=${r.syncPending} scopes=${r.scopes.length}`)
    expect(JSON.stringify(rows)).not.toContain('FIXTURE')
    expect(rows.find((r) => r.vendor === 'SHOPIFY')!.status).toBe('CONNECTED')
    expect(rows.find((r) => r.vendor === 'META')!.syncPending).toBe(true)
  })
})
