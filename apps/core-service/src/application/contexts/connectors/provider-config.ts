/**
 * Per-vendor OAuth provider config + URL builders + token exchange (Slice D).
 *
 * @paradigm io (vendor HTTP + URL construction; no ML, no LLM)
 *
 * Per-connector quirks (Shopify per-store host vs Meta long-lived exchange vs Google
 * offline refresh_token) are CONFIG behind a single interface — NOT three bespoke
 * connect paths (mirrors Child-3 CF-C3-SINGLE-PRIMITIVE-1). Scopes / API versions /
 * endpoints are carried VERBATIM from the legacy lib/integrations + lib/shopify code.
 *
 * SECRETS: client id / client secret / redirect uri are read from process.env AT
 * CALL TIME. No secret VALUE is ever inlined, logged, or returned. The built auth
 * URL contains the client_id (a public identifier per the OAuth spec) and redirect
 * URI; the client SECRET is used only server-side in the token exchange POST body
 * and is NEVER placed in a redirect URL or logged.
 *
 * The token EXCHANGE goes through an injectable ProviderHttp seam: production passes
 * the real fetch; tests pass a fixture. This is the mechanical-verification seam that
 * lets us prove exchange→persist→idempotent→RLS WITHOUT live provider credentials.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ConnectorVendor } from './oauth-state.js'

// ---------------------------------------------------------------------------
// ProviderHttp seam — the ONLY outbound surface. Injectable for tests.
// ---------------------------------------------------------------------------
export interface ProviderHttpRequest {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  /** application/x-www-form-urlencoded body for token exchanges. */
  formBody?: Record<string, string>
}
export interface ProviderHttpResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}
export interface ProviderHttp {
  request(req: ProviderHttpRequest): Promise<ProviderHttpResponse>
}

/** Real fetch-backed ProviderHttp (production). */
export const fetchProviderHttp: ProviderHttp = {
  async request(req: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    const init: RequestInit = { method: req.method, headers: req.headers }
    if (req.formBody) {
      init.body = new URLSearchParams(req.formBody).toString()
      init.headers = { ...req.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
    }
    const res = await fetch(req.url, init)
    return {
      ok: res.ok,
      status: res.status,
      json: () => res.json(),
      text: () => res.text(),
    }
  },
}

// ---------------------------------------------------------------------------
// Scopes / versions — VERBATIM from legacy. Read-only families (least-privilege).
// ---------------------------------------------------------------------------
export const SHOPIFY_SCOPES =
  'read_orders,read_all_orders,read_products,read_customers,read_analytics,read_inventory,read_reports'
export const META_SCOPES = ['ads_management', 'ads_read', 'business_management', 'read_insights'].join(',')
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/adwords'

function metaApiVersion(): string {
  return process.env['META_API_VERSION'] || 'v21.0'
}

/** Require an env var at call time (never logs the value). */
function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`[provider-config] ${name} is not set — required to build the OAuth flow.`)
  }
  return v
}

// ---------------------------------------------------------------------------
// Token content returned by exchange — the secret payload persisted via custody.
// ---------------------------------------------------------------------------
export interface ExchangedToken {
  /** Normalized credential content to hand to custody.put (NEVER logged). */
  content: Record<string, unknown>
  /** NON-secret connection metadata for connector_connections. */
  scopes: string[]
  accountRef: string | null
  tokenExpiresAt: Date | null
  externalMetadata: Record<string, unknown>
}

// ===========================================================================
// AUTH-URL BUILDERS
// ===========================================================================

export interface AuthUrlOpts {
  state: string
  /** Shopify only — the *.myshopify.com host (per-store OAuth). */
  shopDomain?: string | null
}

/** Build the provider consent URL. client_id is a public identifier (OAuth spec). */
export function buildAuthUrl(vendor: ConnectorVendor, opts: AuthUrlOpts): string {
  switch (vendor) {
    case 'SHOPIFY': {
      const shop = opts.shopDomain
      if (!shop) throw new Error('[provider-config] Shopify connect requires a shop domain.')
      const redirectUri = requireEnv('SHOPIFY_REDIRECT_URI')
      const params = new URLSearchParams({
        client_id: requireEnv('SHOPIFY_CLIENT_ID'),
        scope: SHOPIFY_SCOPES,
        redirect_uri: redirectUri,
        state: opts.state,
      })
      return `https://${shop}/admin/oauth/authorize?${params.toString()}`
    }
    case 'META': {
      const params = new URLSearchParams({
        client_id: requireEnv('META_APP_ID'),
        redirect_uri: requireEnv('META_REDIRECT_URI'),
        state: opts.state,
        scope: META_SCOPES,
        response_type: 'code',
      })
      const configId = process.env['META_CONFIG_ID']
      if (configId) params.set('config_id', configId)
      return `https://www.facebook.com/${metaApiVersion()}/dialog/oauth?${params.toString()}`
    }
    case 'GOOGLE': {
      const params = new URLSearchParams({
        client_id: requireEnv('GOOGLE_ADS_CLIENT_ID'),
        redirect_uri: requireEnv('GOOGLE_ADS_REDIRECT_URI'),
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline', // REQUIRED for a refresh_token
        prompt: 'consent', // force refresh_token issuance
        state: opts.state,
      })
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    }
    default:
      // P0-R6: ConnectorVendor is now an open string (registry-backed). Vendors
      // other than SHOPIFY/META/GOOGLE do not support OAuth consent URL flows;
      // they use API key / basic-auth patterns configured in connector_definitions.
      throw new Error(`[provider-config] buildAuthUrl: vendor '${vendor}' does not support OAuth consent URL.`)
  }
}

// ===========================================================================
// SHOPIFY HMAC validation (callback integrity) — timing-safe, per legacy client.ts.
// ===========================================================================

export function validateShopifyHmac(query: Record<string, string>): boolean {
  const hmac = query['hmac']
  if (!hmac) return false
  const secret = requireEnv('SHOPIFY_CLIENT_SECRET')
  const message = Object.entries(query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const generated = createHmac('sha256', secret).update(message).digest('hex')
  const a = Buffer.from(generated, 'hex')
  const b = Buffer.from(hmac, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/
export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test(shop)
}
export function normalizeShopDomain(input: string): string {
  let shop = input.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? ''
  if (!shop.endsWith('.myshopify.com')) shop = `${shop}.myshopify.com`
  return shop
}

// ===========================================================================
// TOKEN EXCHANGE — through the injectable ProviderHttp seam.
// ===========================================================================

export async function exchangeCode(
  vendor: ConnectorVendor,
  code: string,
  http: ProviderHttp,
  opts: { shopDomain?: string | null } = {},
): Promise<ExchangedToken> {
  switch (vendor) {
    case 'SHOPIFY':
      return exchangeShopify(code, http, opts.shopDomain ?? null)
    case 'META':
      return exchangeMeta(code, http)
    case 'GOOGLE':
      return exchangeGoogle(code, http)
    default:
      // P0-R6: ConnectorVendor is now an open string. Non-OAuth vendors do not
      // support code exchange; they use API key / basic-auth patterns.
      throw new Error(`[provider-config] exchangeCode: vendor '${vendor}' does not support OAuth code exchange.`)
  }
}

async function exchangeShopify(
  code: string,
  http: ProviderHttp,
  shopDomain: string | null,
): Promise<ExchangedToken> {
  if (!shopDomain) throw new Error('[provider-config] Shopify exchange requires a shop domain.')
  const res = await http.request({
    method: 'POST',
    url: `https://${shopDomain}/admin/oauth/access_token`,
    formBody: {
      client_id: requireEnv('SHOPIFY_CLIENT_ID'),
      client_secret: requireEnv('SHOPIFY_CLIENT_SECRET'),
      code,
    },
  })
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status}).`)
  const data = (await res.json()) as { access_token?: string; scope?: string }
  if (!data.access_token) throw new Error('Shopify token exchange returned no access_token.')
  const scopes = (data.scope ?? SHOPIFY_SCOPES).split(',').map((s) => s.trim()).filter(Boolean)
  return {
    content: { access_token: data.access_token, shop_domain: shopDomain },
    scopes,
    accountRef: shopDomain,
    tokenExpiresAt: null, // Shopify offline tokens do not expire
    externalMetadata: {},
  }
}

async function exchangeMeta(code: string, http: ProviderHttp): Promise<ExchangedToken> {
  const ver = metaApiVersion()
  // Step 1: short-lived token.
  const shortParams = new URLSearchParams({
    client_id: requireEnv('META_APP_ID'),
    client_secret: requireEnv('META_APP_SECRET'),
    redirect_uri: requireEnv('META_REDIRECT_URI'),
    code,
  })
  const shortRes = await http.request({
    method: 'GET',
    url: `https://graph.facebook.com/${ver}/oauth/access_token?${shortParams.toString()}`,
  })
  if (!shortRes.ok) throw new Error(`Meta token exchange failed (${shortRes.status}).`)
  const shortData = (await shortRes.json()) as { access_token?: string }
  if (!shortData.access_token) throw new Error('Meta token exchange returned no access_token.')

  // Step 2: long-lived token.
  const longParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: requireEnv('META_APP_ID'),
    client_secret: requireEnv('META_APP_SECRET'),
    fb_exchange_token: shortData.access_token,
  })
  const longRes = await http.request({
    method: 'GET',
    url: `https://graph.facebook.com/${ver}/oauth/access_token?${longParams.toString()}`,
  })
  if (!longRes.ok) throw new Error(`Meta long-lived token exchange failed (${longRes.status}).`)
  const longData = (await longRes.json()) as { access_token?: string; expires_in?: number }
  const accessToken = longData.access_token ?? shortData.access_token
  const expiresAt = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : null
  return {
    content: { access_token: accessToken },
    scopes: META_SCOPES.split(','),
    accountRef: null, // ad-account selection deferred (status carries it later)
    tokenExpiresAt: expiresAt,
    externalMetadata: {},
  }
}

async function exchangeGoogle(code: string, http: ProviderHttp): Promise<ExchangedToken> {
  const res = await http.request({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    formBody: {
      code,
      client_id: requireEnv('GOOGLE_ADS_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
      redirect_uri: requireEnv('GOOGLE_ADS_REDIRECT_URI'),
      grant_type: 'authorization_code',
    },
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}).`)
  const data = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!data.refresh_token) {
    // Offline access requires a refresh_token; prompt=consent forces it.
    throw new Error('Google did not return a refresh token. Re-authorize with prompt=consent.')
  }
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null
  return {
    content: { refresh_token: data.refresh_token, access_token: data.access_token ?? null },
    scopes: [GOOGLE_SCOPES],
    accountRef: null, // customer-id discovery (listAccessibleCustomers/MCC) deferred
    tokenExpiresAt: expiresAt,
    externalMetadata: {},
  }
}
