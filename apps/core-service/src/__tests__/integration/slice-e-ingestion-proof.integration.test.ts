/**
 * Slice E — MECHANICAL VERIFICATION proof (Stage 5). Runs the full connector-data
 * ingestion flow against the LIVE local Postgres, with a FIXTURE provider response (the
 * real GraphQL/insights/GAQL shapes from legacy) + a real custody token — NO live consent.
 *
 * Proves all 7 persona concerns at the ANALYTICS layer:
 *   P-001  a CONNECTED+SYNCED workspace's store summary returns the INGESTED numbers
 *          (not the Sugandh seed).
 *   P-002  re-sync the SAME fixture batch → analytics revenue/spend BYTE-IDENTICAL (no
 *          double-count at the aggregate layer).
 *   P-003  two synced workspaces are isolated; a context-less fact read returns 0 rows
 *          (FORCE RLS).
 *   P-004  money/GST: decimal-string → minor units with NO float drift; per-SKU line items.
 *   P-005  the fetch seam is fixture-injected; the full sync runs without live creds.
 *   P-006  a NOT_CONNECTED vendor returns a clean result with NO token read; no token in
 *          any output.
 *   P-007  a forced fetch failure leaves last_sync_at unchanged + records last_sync_error.
 *
 * Run with INTEGRATION_TEST=true + the gateway .env loaded (--env-file) so the real
 * CONNECTOR_CUSTODY_KEY + CONNECTOR_CUSTODY_BACKING are present (slice-D custody).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { withWorkspace, withSuperadmin, _resetPoolForTest } from '../../infrastructure/db/workspace-context.js'
import { LocalAesGcmCustody } from '../../infrastructure/secrets/local-aesgcm-custody.js'
import { syncConnector } from '../../application/contexts/connectors/sync/sync-use-cases.js'
import { readStoreSummary, readPnl, readMarketing } from '../../application/contexts/connectors/sync/fact-analytics.js'
import { decimalStringToMinorUnits, microsToMinorUnits } from '../../application/contexts/connectors/sync/acl.js'
import type { ConnectorFetch, SyncWindow } from '../../application/contexts/connectors/sync/provider-fetch.js'

const IS_INTEGRATION = process.env['INTEGRATION_TEST'] === 'true'
const SUPER_URL = process.env['TEST_SUPER_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'
const APP_URL = process.env['DATABASE_URL'] ?? 'postgresql://rls_app:rls_app_pw@localhost:5432/brain_dev'
const superPool = new Pool({ connectionString: SUPER_URL, max: 3 })

// ---------------------------------------------------------------------------
// Fixture provider responses — the REAL shapes from legacy (persona P-005).
// One Shopify order: 1 SKU @ ₹4999.00, ₹0 discount, ₹899.82 tax (18% GST), prepaid.
// ---------------------------------------------------------------------------

const SHOPIFY_FIXTURE = {
  orders: [
    {
      id: 'gid://shopify/Order/1001',
      name: '#1001',
      currencyCode: 'INR',
      subtotalPriceSet: { shopMoney: { amount: '4999.00', currencyCode: 'INR' } },
      totalPriceSet: { shopMoney: { amount: '4999.00', currencyCode: 'INR' } },
      totalTaxSet: { shopMoney: { amount: '899.82', currencyCode: 'INR' } },
      totalDiscountsSet: { shopMoney: { amount: '0.00', currencyCode: 'INR' } },
      totalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'INR' } },
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'FULFILLED',
      processedAt: '2026-05-01T10:00:00Z',
      cancelledAt: null,
      paymentGatewayNames: ['razorpay'],
      customer: { id: 'gid://shopify/Customer/55' },
      shippingAddress: { zip: '560001', city: 'Bengaluru' },
      lineItems: {
        edges: [
          {
            node: {
              id: 'gid://shopify/LineItem/9001',
              title: 'Attar Oud 12ml',
              quantity: 1,
              sku: 'OUD-12',
              originalUnitPriceSet: { shopMoney: { amount: '4999.00', currencyCode: 'INR' } },
              variant: { product: { id: 'gid://shopify/Product/700' } },
            },
          },
        ],
      },
    },
  ],
  products: [{ id: 'gid://shopify/Product/700', title: 'Attar Oud 12ml', productType: 'Perfume', status: 'ACTIVE' }],
  shopCurrency: 'INR',
}

const META_FIXTURE = {
  rows: [
    { campaign_id: 'm_111', campaign_name: 'Prospecting', impressions: '12000', clicks: '340', spend: '5000.00', date_start: '2026-05-01', currency: 'INR' },
  ],
  accountCurrency: 'INR',
}

const GOOGLE_FIXTURE = {
  // GAQL cost_micros: cost = units × 1e6 → ₹3000.00 = 3_000_000_000 micros = 300000 paise.
  rows: [
    { campaign: { id: 'g_222', name: 'Search Brand' }, metrics: { cost_micros: '3000000000', impressions: '8000', clicks: '210' }, segments: { date: '2026-05-01' } },
  ],
  customerCurrency: 'INR',
}

function fixtureFetch(): ConnectorFetch {
  return {
    async fetchShopify(_t, _shop, _w: SyncWindow) {
      return SHOPIFY_FIXTURE
    },
    async fetchMetaSpend() {
      return META_FIXTURE
    },
    async fetchGoogleSpend() {
      return GOOGLE_FIXTURE
    },
  }
}

function failingFetch(): ConnectorFetch {
  return {
    async fetchShopify() {
      throw new Error('provider 500 — token=shpat_SHOULD_NOT_LEAK')
    },
    async fetchMetaSpend() {
      throw new Error('boom')
    },
    async fetchGoogleSpend() {
      throw new Error('boom')
    },
  }
}

async function seedWorkspace(slugPrefix: string): Promise<{ workspaceId: string; userId: string }> {
  const c = await superPool.connect()
  const userId = randomUUID()
  await c.query(`INSERT INTO users (id,email) VALUES ($1,$2)`, [userId, `${userId}@ex.com`])
  const ws = await c.query<{ id: string }>(
    `INSERT INTO workspaces (name,slug,created_by_id) VALUES ($1,$2,$3) RETURNING id`,
    ['SliceE', `${slugPrefix}-${userId.slice(0, 8)}`, userId],
  )
  const workspaceId = ws.rows[0]!.id
  await c.query(`INSERT INTO workspace_members (workspace_id,user_id,role) VALUES ($1,$2,'OWNER')`, [workspaceId, userId])
  c.release()
  return { workspaceId, userId }
}

describe.skipIf(!IS_INTEGRATION)('Slice E — connector-data ingestion mechanical proof (live DB + fixtures)', () => {
  let wsA: string
  let wsB: string
  let userA: string
  let userB: string
  let custody: LocalAesGcmCustody

  beforeAll(async () => {
    process.env['DATABASE_URL'] = APP_URL
    _resetPoolForTest()
    custody = new LocalAesGcmCustody()
    ;({ workspaceId: wsA, userId: userA } = await seedWorkspace('e-a'))
    ;({ workspaceId: wsB, userId: userB } = await seedWorkspace('e-b'))

    // Connect SHOPIFY+META+GOOGLE for wsA (write a real custody token + CONNECTED row).
    for (const vendor of ['SHOPIFY', 'META', 'GOOGLE'] as const) {
      await custody.put(wsA, vendor, { access_token: `at_FIXTURE_${vendor}`, refresh_token: 'rt_FIXTURE' })
      await withWorkspace(wsA, async (tx) => {
        await tx.query(
          `INSERT INTO connector_connections (workspace_id, vendor, status, scopes, account_ref, connected_at, updated_at)
           VALUES ($1,$2,'CONNECTED','{}',$3, now(), now())
           ON CONFLICT (workspace_id, vendor) DO UPDATE SET status='CONNECTED'`,
          [wsA, vendor, vendor === 'SHOPIFY' ? 'demo.myshopify.com' : 'act_123'],
        )
      })
    }
    // Connect SHOPIFY for wsB only (for the cross-tenant isolation test).
    await custody.put(wsB, 'SHOPIFY', { access_token: 'at_FIXTURE_B' })
    await withWorkspace(wsB, async (tx) => {
      await tx.query(
        `INSERT INTO connector_connections (workspace_id, vendor, status, scopes, account_ref, connected_at, updated_at)
         VALUES ($1,'SHOPIFY','CONNECTED','{}','b.myshopify.com', now(), now())
         ON CONFLICT (workspace_id, vendor) DO UPDATE SET status='CONNECTED'`,
        [wsB],
      )
    })
  })

  afterAll(async () => {
    const c = await superPool.connect()
    for (const ws of [wsA, wsB]) {
      await c.query('DELETE FROM connector_order_facts WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM connector_line_item_facts WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM connector_product_facts WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM connector_ad_spend_facts WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM connector_credentials WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM connector_connections WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM workspace_members WHERE workspace_id=$1', [ws])
      await c.query('DELETE FROM workspaces WHERE id=$1', [ws])
    }
    await c.query('DELETE FROM users WHERE id = ANY($1)', [[userA, userB]])
    c.release()
    await superPool.end()
  })

  it('P-004 — money/GST: decimal-string → minor units with NO float drift', () => {
    // The classic float trap: parseFloat("4999.00")*100 = 499899.99999999994.
    expect(decimalStringToMinorUnits('4999.00', 'INR')).toBe(499900n)
    expect(decimalStringToMinorUnits('899.82', 'INR')).toBe(89982n)
    expect(decimalStringToMinorUnits('0.00', 'INR')).toBe(0n)
    expect(decimalStringToMinorUnits('1234.5', 'INR')).toBe(123450n) // pad fraction
    expect(microsToMinorUnits('3000000000', 'INR')).toBe(300000n) // ₹3000.00 (micros = units×1e6)
    console.log('\n[P-004] 4999.00→499900 ; 899.82→89982 ; micros 3000000000→300000 (no float drift)')
  })

  it('P-005/P-001 — fixture sync ingests + a connected workspace reads the INGESTED numbers (not the seed)', async () => {
    const fetch = fixtureFetch()
    const shop = await syncConnector({ vendor: 'SHOPIFY', workspaceId: wsA }, { custody, fetch })
    const meta = await syncConnector({ vendor: 'META', workspaceId: wsA }, { custody, fetch })
    const google = await syncConnector({ vendor: 'GOOGLE', workspaceId: wsA }, { custody, fetch })
    console.log('\n[P-005] sync counts:', { shop, meta, google })
    expect(shop.status).toBe('synced')
    expect(shop.ordersSynced).toBe(1)
    expect(shop.lineItemsSynced).toBe(1)
    expect(meta.adRowsSynced).toBe(1)
    expect(google.adRowsSynced).toBe(1)

    const store = await readStoreSummary(wsA)
    const mk = await readMarketing(wsA)
    console.log('[P-001] store:', { gross: store.grossSalesMu, tax: store.totalTaxMu, netOfTax: store.netNetTaxMu, realized: store.realizedRevenueMu, orders: store.orderCount })
    console.log('[P-001] marketing:', { meta: mk.metaSpendMu, google: mk.googleSpendMu })
    // Ingested numbers — NOT the Sugandh seed (₹18.5L realized = 185000000n).
    expect(store.grossSalesMu).toBe(499900n)
    expect(store.totalTaxMu).toBe(89982n)
    expect(store.netNetTaxMu).toBe(499900n - 89982n) // gross − discount − tax
    expect(store.realizedRevenueMu).toBe(499900n - 89982n) // non-cancelled
    expect(store.realizedRevenueMu).not.toBe(185000000n) // NOT the seed
    expect(store.orderCount).toBe(1n)
    expect(mk.metaSpendMu).toBe(500000n) // ₹5000.00
    expect(mk.googleSpendMu).toBe(300000n) // ₹3000.00
  })

  it('P-002 — re-sync the SAME batch → analytics numbers BYTE-IDENTICAL (no double-count)', async () => {
    const fetch = fixtureFetch()
    const before = await readStoreSummary(wsA)
    const beforeMk = await readMarketing(wsA)
    // Re-run all three syncs.
    await syncConnector({ vendor: 'SHOPIFY', workspaceId: wsA }, { custody, fetch })
    await syncConnector({ vendor: 'META', workspaceId: wsA }, { custody, fetch })
    await syncConnector({ vendor: 'GOOGLE', workspaceId: wsA }, { custody, fetch })
    const after = await readStoreSummary(wsA)
    const afterMk = await readMarketing(wsA)
    console.log('\n[P-002] before vs after re-sync — realized:', before.realizedRevenueMu, '→', after.realizedRevenueMu, '| meta:', beforeMk.metaSpendMu, '→', afterMk.metaSpendMu)
    expect(after.realizedRevenueMu).toBe(before.realizedRevenueMu)
    expect(after.orderCount).toBe(before.orderCount)
    expect(afterMk.metaSpendMu).toBe(beforeMk.metaSpendMu)
    expect(afterMk.googleSpendMu).toBe(beforeMk.googleSpendMu)
    expect(after.orderCount).toBe(1n) // still ONE order after 2 syncs
  })

  it('P-003 — two synced workspaces isolated; context-less fact read = 0 rows (FORCE RLS)', async () => {
    const fetch = fixtureFetch()
    await syncConnector({ vendor: 'SHOPIFY', workspaceId: wsB }, { custody, fetch })
    const a = await readStoreSummary(wsA)
    const b = await readStoreSummary(wsB)
    // Both have their own 1 order; A's read never includes B's rows (and vice-versa).
    expect(a.orderCount).toBe(1n)
    expect(b.orderCount).toBe(1n)
    // Context-less read (no withWorkspace) → 0 rows under FORCE RLS.
    const appPool = new Pool({ connectionString: APP_URL, max: 1 })
    const contextless = await appPool.query<{ n: string }>('SELECT count(*)::text AS n FROM connector_order_facts')
    console.log('\n[P-003] context-less SELECT count(*) on connector_order_facts =', contextless.rows[0]?.n, '(expect 0 — FORCE RLS)')
    expect(contextless.rows[0]?.n).toBe('0')
    // Per-workspace isolation: each workspace context sees ONLY its own 1 order.
    const aCount = await withWorkspace(wsA, async (tx) => {
      const r = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM connector_order_facts')
      return r.rows[0]?.n
    })
    const bCount = await withWorkspace(wsB, async (tx) => {
      const r = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM connector_order_facts')
      return r.rows[0]?.n
    })
    console.log('[P-003] in-context counts — wsA:', aCount, 'wsB:', bCount, '(each sees only its own)')
    expect(aCount).toBe('1')
    expect(bCount).toBe('1')
    // Fact tables intentionally have NO superadmin policy (workspace-only; no
    // sanctioned no-context path) — so even withSuperadmin sees 0 rows. Stronger isolation.
    const superCount = await withSuperadmin(async (tx) => {
      const r = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM connector_order_facts')
      return r.rows[0]?.n
    })
    console.log('[P-003] withSuperadmin count =', superCount, '(0 — no superadmin policy on fact tables, by design)')
    expect(superCount).toBe('0')
    await appPool.end()
  })

  it('P-006 — NOT_CONNECTED vendor → clean result, NO token read; no token in any output', async () => {
    const fetch = fixtureFetch()
    // wsB has NO Meta connection → not_connected, no custody read, no crash.
    const res = await syncConnector({ vendor: 'META', workspaceId: wsB }, { custody, fetch })
    console.log('\n[P-006] sync META on a workspace that never connected it:', res)
    expect(res.status).toBe('not_connected')
    expect(res.ordersSynced).toBe(0)
    expect(JSON.stringify(res)).not.toContain('FIXTURE')
    expect(JSON.stringify(res)).not.toContain('access_token')
  })

  it('P-007 — forced fetch failure: last_sync_at unchanged, last_sync_error set, no token leak', async () => {
    // Capture last_sync_at before the failing sync (wsA SHOPIFY succeeded earlier).
    const before = await withWorkspace(wsA, async (tx) => {
      const r = await tx.query<{ last_sync_at: Date | null; last_sync_error: string | null }>(
        `SELECT last_sync_at, last_sync_error FROM connector_connections WHERE vendor='SHOPIFY'`,
      )
      return r.rows[0]
    })
    const res = await syncConnector({ vendor: 'SHOPIFY', workspaceId: wsA }, { custody, fetch: failingFetch() })
    console.log('\n[P-007] failing sync result:', res)
    expect(res.status).toBe('error')
    // The error message is generic — it must NOT echo the provider body / token.
    expect(res.error ?? '').not.toContain('shpat_')
    expect(res.error ?? '').not.toContain('SHOULD_NOT_LEAK')

    const after = await withWorkspace(wsA, async (tx) => {
      const r = await tx.query<{ last_sync_at: Date | null; last_sync_error: string | null }>(
        `SELECT last_sync_at, last_sync_error FROM connector_connections WHERE vendor='SHOPIFY'`,
      )
      return r.rows[0]
    })
    // last_sync_at UNCHANGED (the failed run did not advance it).
    expect(after?.last_sync_at?.toISOString()).toBe(before?.last_sync_at?.toISOString())
    // last_sync_error recorded (generic), and it does not contain a token.
    expect(after?.last_sync_error).toBeTruthy()
    expect(after?.last_sync_error ?? '').not.toContain('shpat_')
    console.log('[P-007] last_sync_at preserved:', after?.last_sync_at?.toISOString(), '| error recorded (token-free):', after?.last_sync_error)
  })
})
