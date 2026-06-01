/**
 * Provider fetch seam (Slice E) — the injectable network boundary for live pulls.
 *
 * @paradigm io (READ-only external API calls; NO outbound sends; NO ML/LLM)
 *
 * Mirrors slice-D's ProviderHttp injectable pattern (persona P-005): tests inject a
 * FIXTURE that returns canned provider JSON in the REAL shapes (from legacy); prod
 * injects the real `fetch`-backed impl. The custody token is passed IN by the caller
 * (sync-use-cases.ts) — it is NEVER logged, NEVER returned, NEVER in an error here.
 *
 * READ-only: every call is a GET/query for data; there is NO write back to any
 * provider, so there is NO DLT/NCPR/9am-9pm/WhatsApp outbound-channel surface.
 */

import type { ShopifyOrderNode, ShopifyProductNode, MetaInsightRaw, GoogleAdsRaw } from './normalizers.js'

export interface SyncWindow {
  /** ISO yyyy-mm-dd inclusive lower bound, or null for the connector's default backfill. */
  since: string | null
  /** ISO yyyy-mm-dd inclusive upper bound, or null for "now". */
  until: string | null
}

export interface ShopifyPull {
  orders: ShopifyOrderNode[]
  products: ShopifyProductNode[]
  shopCurrency: string
}

/**
 * The fetch seam. Implementations receive the decrypted token CONTENT (opaque) and a
 * window. They MUST NOT log the token. The real impl calls the provider; the fixture
 * impl returns canned data.
 */
export interface ConnectorFetch {
  fetchShopify(token: Record<string, unknown>, shopDomain: string, window: SyncWindow): Promise<ShopifyPull>
  fetchMetaSpend(token: Record<string, unknown>, window: SyncWindow): Promise<{ rows: MetaInsightRaw[]; accountCurrency: string }>
  fetchGoogleSpend(token: Record<string, unknown>, window: SyncWindow): Promise<{ rows: GoogleAdsRaw[]; customerCurrency: string }>
}

// ---------------------------------------------------------------------------
// Backfill window defaults — read from env (legacy SHOPIFY_ORDER_BACKFILL_DAYS /
// ADS_BACKFILL_DAYS). NEVER a hardcoded value. Falls back to safe defaults.
// ---------------------------------------------------------------------------

export function shopifyBackfillDays(): number {
  const v = parseInt(process.env.SHOPIFY_ORDER_BACKFILL_DAYS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 60 // Shopify ReplayCapability.FULL_60D
}

export function adsBackfillDays(): number {
  const v = parseInt(process.env.ADS_BACKFILL_DAYS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 30
}

export function defaultWindow(days: number): SyncWindow {
  const until = new Date()
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { since: iso(since), until: iso(until) }
}

// ---------------------------------------------------------------------------
// Real (live) fetch implementation — HELD-AT-CUTOVER for the network call.
//
// The Shopify Admin GraphQL / Meta insights / Google GAQL queries are documented
// here (the legacy shapes). Activating the real `fetch` requires a real per-account
// token from the Founder's OAuth consent (slice-D flow). Until consent, the live
// path throws a clear, generic error — it does NOT fabricate data (Founder constraint).
// The shapes are exercised end-to-end via the fixture impl in tests.
// ---------------------------------------------------------------------------

export class LiveConnectorFetch implements ConnectorFetch {
  async fetchShopify(_token: Record<string, unknown>, _shopDomain: string, _window: SyncWindow): Promise<ShopifyPull> {
    // Real call: POST https://{shop}/admin/api/2024-10/graphql.json
    //   headers: { 'X-Shopify-Access-Token': <token.access_token>, 'Content-Type': 'application/json' }
    //   body: { query: ORDERS_QUERY/PRODUCTS_QUERY, variables: { cursor } }  (paginate via pageInfo.endCursor)
    // (token.access_token is used here ONLY as a request header — never logged.)
    throw new Error(
      '[provider-fetch] Shopify live pull requires a real per-account access token from OAuth consent ' +
        '(slice-D flow). Run the consent + retry; do NOT fabricate data.',
    )
  }

  async fetchMetaSpend(_token: Record<string, unknown>, _window: SyncWindow): Promise<{ rows: MetaInsightRaw[]; accountCurrency: string }> {
    // Real call: GET graph.facebook.com/v21.0/act_{id}/insights?fields=campaign_id,campaign_name,
    //   impressions,clicks,spend&time_range={...}&level=campaign&access_token=<token>
    throw new Error(
      '[provider-fetch] Meta live pull requires a real per-account access token from OAuth consent. ' +
        'Run the consent + retry; do NOT fabricate data.',
    )
  }

  async fetchGoogleSpend(_token: Record<string, unknown>, _window: SyncWindow): Promise<{ rows: GoogleAdsRaw[]; customerCurrency: string }> {
    // Real call: refresh access token (offline refresh_token) → POST googleads.googleapis.com GAQL:
    //   SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks,
    //   segments.date FROM campaign WHERE segments.date BETWEEN ...
    throw new Error(
      '[provider-fetch] Google live pull requires a real per-account refresh token from OAuth consent. ' +
        'Run the consent + retry; do NOT fabricate data.',
    )
  }
}

/** The default seam selector — live impl in prod. Tests pass a fixture impl explicitly. */
export function defaultConnectorFetch(): ConnectorFetch {
  return new LiveConnectorFetch()
}
