/**
 * Sync use-cases (Slice E) — pull connector data, normalize, idempotently UPSERT
 * the canonical facts, advance last_sync_at. RLS-scoped + workspace-scoped.
 *
 * @paradigm io+sql (provider pull + deterministic SQL UPSERT; NO ML, NO LLM)
 *
 * Flow (persona P-002/P-006/P-007):
 *   1. read the connection under withWorkspace; if NOT CONNECTED → clean return, NO
 *      custody read, NO crash.
 *   2. mark status = 'syncing'.
 *   3. custody.get(ws, vendor) → token (slice-D AES-GCM; the token VALUE never leaves
 *      this function, is never logged, never returned, never in an error).
 *   4. fetch via the injectable seam → raw provider rows.
 *   5. ACL normalize → canonical facts.
 *   6. in ONE withWorkspace transaction: idempotent UPSERT every fact (ON CONFLICT on
 *      the UNIQUE business key DO UPDATE — re-sync never double-counts), THEN set
 *      last_sync_at = now(), last_sync_error = NULL, status = 'CONNECTED'. If anything
 *      throws: the tx rolls back (facts + last_sync_at unchanged); we set
 *      last_sync_error in a SEPARATE statement; status stays CONNECTED (NOT a fake
 *      "synced"). Every error is generic (no provider body, no token substring).
 */

import type { PoolClient } from 'pg'
import { withWorkspace } from '../../../../infrastructure/db/workspace-context.js'
import { selectCustody } from '../../../../infrastructure/secrets/custody-factory.js'
import { CredentialNotFoundError, type CredentialCustody } from '../../../../infrastructure/secrets/credential-custody.js'
import type { ConnectorVendor } from '../oauth-state.js'
import { ConnectorError } from '../connector-use-cases.js'
import {
  defaultConnectorFetch,
  defaultWindow,
  shopifyBackfillDays,
  adsBackfillDays,
  type ConnectorFetch,
  type SyncWindow,
} from './provider-fetch.js'
import {
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  normalizeMetaSpend,
  normalizeGoogleSpend,
} from './normalizers.js'
import type { OrderFact, LineItemFact, ProductFact, AdSpendFact } from './acl.js'
import { getOrCreateWorkspaceSalt } from '../../../../infrastructure/identity/workspace-salt-vault.js'

export interface SyncDeps {
  withWorkspace: typeof withWorkspace
  custody: CredentialCustody
  fetch: ConnectorFetch
}
function defaultDeps(): SyncDeps {
  return { withWorkspace, custody: selectCustody(), fetch: defaultConnectorFetch() }
}

export interface SyncResult {
  vendor: ConnectorVendor
  status: 'synced' | 'not_connected' | 'error'
  ordersSynced: number
  lineItemsSynced: number
  productsSynced: number
  adRowsSynced: number
  lastSyncAt: string | null
  /** generic message only — NEVER a provider body or token. */
  error?: string
}

// ---------------------------------------------------------------------------
// UPSERT helpers — keyed on the UNIQUE business key (idempotent; P-002).
// ---------------------------------------------------------------------------

async function upsertOrder(tx: PoolClient, ws: string, o: OrderFact): Promise<void> {
  await tx.query(
    `INSERT INTO connector_order_facts
       (workspace_id, vendor, vendor_order_id, order_number, financial_status, fulfillment_status,
        payment_method, currency_code, gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
        customer_ref, is_new_customer, delivery_pincode, delivery_city, processed_at, cancelled_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
     ON CONFLICT (workspace_id, vendor, vendor_order_id) DO UPDATE SET
       order_number=EXCLUDED.order_number, financial_status=EXCLUDED.financial_status,
       fulfillment_status=EXCLUDED.fulfillment_status, payment_method=EXCLUDED.payment_method,
       currency_code=EXCLUDED.currency_code, gross_sales_mu=EXCLUDED.gross_sales_mu,
       total_discount_mu=EXCLUDED.total_discount_mu, total_tax_mu=EXCLUDED.total_tax_mu,
       shipping_mu=EXCLUDED.shipping_mu, customer_ref=EXCLUDED.customer_ref,
       delivery_pincode=EXCLUDED.delivery_pincode, delivery_city=EXCLUDED.delivery_city,
       processed_at=EXCLUDED.processed_at, cancelled_at=EXCLUDED.cancelled_at, synced_at=now()`,
    [
      ws, o.vendor, o.vendorOrderId, o.orderNumber, o.financialStatus, o.fulfillmentStatus,
      o.paymentMethod, o.currencyCode, o.grossSalesMu, o.totalDiscountMu, o.totalTaxMu, o.shippingMu,
      o.customerRef, isNewCustomerFlag(o), o.deliveryPincode, o.deliveryCity, o.processedAt, o.cancelledAt,
    ],
  )
}

// is_new_customer is resolved at read time from the customer_ref first-seen ordering;
// at write we store null and let the analytics derive it (keeps the write idempotent
// and avoids a write-time ordering dependency). Placeholder kept explicit.
function isNewCustomerFlag(_o: OrderFact): boolean | null {
  return null
}

async function upsertLineItem(tx: PoolClient, ws: string, li: LineItemFact): Promise<void> {
  await tx.query(
    `INSERT INTO connector_line_item_facts
       (workspace_id, vendor, vendor_order_id, vendor_line_id, sku, title, quantity, unit_price_mu, gst_slab_bp, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (workspace_id, vendor, vendor_order_id, vendor_line_id) DO UPDATE SET
       sku=EXCLUDED.sku, title=EXCLUDED.title, quantity=EXCLUDED.quantity,
       unit_price_mu=EXCLUDED.unit_price_mu, gst_slab_bp=EXCLUDED.gst_slab_bp, synced_at=now()`,
    [ws, li.vendor, li.vendorOrderId, li.vendorLineId, li.sku, li.title, li.quantity, li.unitPriceMu, li.gstSlabBp],
  )
}

async function upsertProduct(tx: PoolClient, ws: string, p: ProductFact): Promise<void> {
  await tx.query(
    `INSERT INTO connector_product_facts
       (workspace_id, vendor, vendor_product_id, title, product_type, status, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (workspace_id, vendor, vendor_product_id) DO UPDATE SET
       title=EXCLUDED.title, product_type=EXCLUDED.product_type, status=EXCLUDED.status, synced_at=now()`,
    [ws, p.vendor, p.vendorProductId, p.title, p.productType, p.status],
  )
}

async function upsertAdSpend(tx: PoolClient, ws: string, a: AdSpendFact): Promise<void> {
  await tx.query(
    `INSERT INTO connector_ad_spend_facts
       (workspace_id, vendor, campaign_id, campaign_name, spend_date, spend_mu, impressions, clicks, currency_code, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (workspace_id, vendor, campaign_id, spend_date) DO UPDATE SET
       campaign_name=EXCLUDED.campaign_name, spend_mu=EXCLUDED.spend_mu,
       impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks,
       currency_code=EXCLUDED.currency_code, synced_at=now()`,
    [ws, a.vendor, a.campaignId, a.campaignName, a.spendDate, a.spendMu, a.impressions, a.clicks, a.currencyCode],
  )
}

// ---------------------------------------------------------------------------
// syncConnector — the one entry point. requireRole(MANAGER) is enforced at the
// gateway (config-class action). window defaults to the env-driven backfill.
// ---------------------------------------------------------------------------

export async function syncConnector(
  params: { vendor: ConnectorVendor; workspaceId: string; window?: SyncWindow },
  deps: Partial<SyncDeps> = {},
): Promise<SyncResult> {
  const d = { ...defaultDeps(), ...deps }
  const { vendor, workspaceId } = params
  const empty: SyncResult = {
    vendor, status: 'not_connected', ordersSynced: 0, lineItemsSynced: 0, productsSynced: 0, adRowsSynced: 0, lastSyncAt: null,
  }

  // 1. Read the connection. If not CONNECTED → clean return, NO custody read (P-006).
  const conn = await d.withWorkspace(workspaceId, async (tx: PoolClient) => {
    const res = await tx.query<{ status: string; account_ref: string | null; external_metadata: Record<string, unknown> }>(
      `SELECT status, account_ref, external_metadata FROM connector_connections WHERE vendor = $1`,
      [vendor],
    )
    return res.rows[0] ?? null
  })
  if (!conn || conn.status !== 'CONNECTED') {
    return empty
  }

  // NOTE: there is no persisted 'SYNCING' enum value — the slice-D connector_status
  // enum is intentionally NOT extended (no schema change to a committed enum). The
  // sync is a synchronous request/response; "syncing" is the in-flight state of the
  // mutation itself (the UI shows a spinner while the mutation is pending). The
  // connection stays CONNECTED throughout; only last_sync_at / last_sync_error move.

  try {
    // 3. Read the custody token (decrypted). Never logged/returned.
    let token: Record<string, unknown>
    try {
      const cred = await d.custody.get(workspaceId, vendor)
      token = cred.content
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        // Connected row but no credential → restore CONNECTED, report cleanly.
        await restoreConnected(d, workspaceId, vendor, 'No credential on record for this connector.')
        return { ...empty, status: 'error', error: 'No credential on record for this connector.' }
      }
      throw err
    }

    // 4. Fetch + 5. ACL normalize.
    const orders: OrderFact[] = []
    const lineItems: LineItemFact[] = []
    const products: ProductFact[] = []
    const adSpend: AdSpendFact[] = []

    if (vendor === 'SHOPIFY') {
      const shopDomain = conn.account_ref ?? ''
      const window = params.window ?? defaultWindow(shopifyBackfillDays())
      const pull = await d.fetch.fetchShopify(token, shopDomain, window)

      // Resolve the per-workspace salt ONCE, before the order loop (R10 / P1-C).
      // When IDENTITY_STITCHER=true this guarantees the HMAC path is taken for
      // every order in the batch — the same Shopify customer at two brands will
      // produce different customer_ref values (cross-workspace isolation).
      // When IDENTITY_STITCHER=false the salt is still fetched/created but
      // normalizeShopifyOrder ignores it (the flag check lives in acl.customerRef).
      let workspaceSalt: Buffer | undefined
      if (process.env.IDENTITY_STITCHER === 'true') {
        const saltResult = await getOrCreateWorkspaceSalt(workspaceId)
        workspaceSalt = saltResult.salt
      }

      for (const node of pull.orders) {
        const { order, lineItems: lis } = normalizeShopifyOrder(node, workspaceSalt)
        orders.push(order)
        lineItems.push(...lis)
      }
      for (const node of pull.products) products.push(normalizeShopifyProduct(node))
    } else if (vendor === 'META') {
      const window = params.window ?? defaultWindow(adsBackfillDays())
      const { rows, accountCurrency } = await d.fetch.fetchMetaSpend(token, window)
      for (const row of rows) adSpend.push(normalizeMetaSpend(row, accountCurrency))
    } else if (vendor === 'GOOGLE') {
      const window = params.window ?? defaultWindow(adsBackfillDays())
      const { rows, customerCurrency } = await d.fetch.fetchGoogleSpend(token, window)
      for (const row of rows) adSpend.push(normalizeGoogleSpend(row, customerCurrency))
    }

    // 6. UPSERT facts + advance last_sync_at in ONE transaction (P-002/P-007).
    const lastSyncAt = await d.withWorkspace(workspaceId, async (tx: PoolClient) => {
      for (const o of orders) await upsertOrder(tx, workspaceId, o)
      for (const li of lineItems) await upsertLineItem(tx, workspaceId, li)
      for (const p of products) await upsertProduct(tx, workspaceId, p)
      for (const a of adSpend) await upsertAdSpend(tx, workspaceId, a)
      const res = await tx.query<{ last_sync_at: Date }>(
        `UPDATE connector_connections
            SET status = 'CONNECTED'::connector_status, last_sync_at = now(), last_sync_error = NULL, updated_at = now()
          WHERE vendor = $1
          RETURNING last_sync_at`,
        [vendor],
      )
      return res.rows[0]?.last_sync_at ?? null
    })

    return {
      vendor,
      status: 'synced',
      ordersSynced: orders.length,
      lineItemsSynced: lineItems.length,
      productsSynced: products.length,
      adRowsSynced: adSpend.length,
      lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
    }
  } catch (err) {
    // Generic error — NEVER echo a provider body or token (P-006). last_sync_at unchanged (P-007).
    const message = err instanceof ConnectorError ? err.message : 'Connector sync failed.'
    await restoreConnected(d, workspaceId, vendor, message)
    return { ...empty, status: 'error', error: message }
  }
}

// Restore CONNECTED status + record a generic last_sync_error WITHOUT touching last_sync_at.
async function restoreConnected(d: SyncDeps, workspaceId: string, vendor: ConnectorVendor, error: string): Promise<void> {
  await d.withWorkspace(workspaceId, async (tx: PoolClient) => {
    await tx.query(
      `UPDATE connector_connections
          SET status = 'CONNECTED'::connector_status, last_sync_error = $2, updated_at = now()
        WHERE vendor = $1`,
      [vendor, error.slice(0, 500)],
    )
  })
}
