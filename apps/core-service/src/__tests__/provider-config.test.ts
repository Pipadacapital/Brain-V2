/**
 * Slice D — provider-config unit tests. Auth-URL correctness (host/path/scopes/
 * redirect/state/offline), Shopify HMAC validation, shop-domain normalization, and
 * token exchange through a fixture ProviderHttp (no live creds). NO secret VALUE is
 * asserted — we assert that client_id is PRESENT in the URL, not its value.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  buildAuthUrl,
  validateShopifyHmac,
  isValidShopDomain,
  normalizeShopDomain,
  exchangeCode,
  SHOPIFY_SCOPES,
  META_SCOPES,
  GOOGLE_SCOPES,
  type ProviderHttp,
} from '../application/contexts/connectors/provider-config.js'

const ENV = {
  SHOPIFY_CLIENT_ID: 'test_shopify_id',
  SHOPIFY_CLIENT_SECRET: 'test_shopify_secret',
  SHOPIFY_REDIRECT_URI: 'http://localhost:3000/api/integrations/shopify/callback',
  META_APP_ID: 'test_meta_id',
  META_APP_SECRET: 'test_meta_secret',
  META_REDIRECT_URI: 'http://localhost:3000/api/integrations/meta/callback',
  META_API_VERSION: 'v21.0',
  GOOGLE_ADS_CLIENT_ID: 'test_google_id',
  GOOGLE_ADS_CLIENT_SECRET: 'test_google_secret',
  GOOGLE_ADS_REDIRECT_URI: 'http://localhost:3000/api/integrations/google/callback',
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  delete process.env['META_CONFIG_ID']
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k]
  delete process.env['META_CONFIG_ID']
})

describe('buildAuthUrl — Shopify', () => {
  it('builds the per-store authorize URL with scopes, redirect, state, client_id present', () => {
    const url = new URL(buildAuthUrl('SHOPIFY', { state: 'nonce123', shopDomain: 'shop.myshopify.com' }))
    expect(url.host).toBe('shop.myshopify.com')
    expect(url.pathname).toBe('/admin/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe(SHOPIFY_SCOPES)
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.SHOPIFY_REDIRECT_URI)
    expect(url.searchParams.get('state')).toBe('nonce123')
    expect(url.searchParams.get('client_id')).toBeTruthy() // present (value not asserted)
  })
  it('throws without a shop domain', () => {
    expect(() => buildAuthUrl('SHOPIFY', { state: 's' })).toThrow(/shop domain/i)
  })
})

describe('buildAuthUrl — Meta', () => {
  it('builds the dialog/oauth URL with scopes, response_type=code, state', () => {
    const url = new URL(buildAuthUrl('META', { state: 'metastate' }))
    expect(url.host).toBe('www.facebook.com')
    expect(url.pathname).toBe('/v21.0/dialog/oauth')
    expect(url.searchParams.get('scope')).toBe(META_SCOPES)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.META_REDIRECT_URI)
    expect(url.searchParams.get('state')).toBe('metastate')
    expect(url.searchParams.get('client_id')).toBeTruthy()
    expect(url.searchParams.has('config_id')).toBe(false) // omitted when unset
  })
  it('includes config_id when META_CONFIG_ID is set', () => {
    process.env['META_CONFIG_ID'] = 'cfg_1'
    const url = new URL(buildAuthUrl('META', { state: 's' }))
    expect(url.searchParams.get('config_id')).toBe('cfg_1')
  })
})

describe('buildAuthUrl — Google', () => {
  it('builds the oauth2 URL with adwords scope, access_type=offline, prompt=consent', () => {
    const url = new URL(buildAuthUrl('GOOGLE', { state: 'gstate' }))
    expect(url.host).toBe('accounts.google.com')
    expect(url.pathname).toBe('/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES)
    expect(url.searchParams.get('access_type')).toBe('offline') // required for refresh_token
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.GOOGLE_ADS_REDIRECT_URI)
    expect(url.searchParams.get('state')).toBe('gstate')
    expect(url.searchParams.get('client_id')).toBeTruthy()
  })
})

describe('shop domain helpers', () => {
  it('validates *.myshopify.com', () => {
    expect(isValidShopDomain('abc.myshopify.com')).toBe(true)
    expect(isValidShopDomain('not-shopify.com')).toBe(false)
    expect(isValidShopDomain('evil.com/x.myshopify.com')).toBe(false)
  })
  it('normalizes handles and URLs', () => {
    expect(normalizeShopDomain('my-store')).toBe('my-store.myshopify.com')
    expect(normalizeShopDomain('https://my-store.myshopify.com/path')).toBe('my-store.myshopify.com')
    expect(normalizeShopDomain('MY-STORE.myshopify.com')).toBe('my-store.myshopify.com')
  })
})

describe('validateShopifyHmac — timing-safe', () => {
  it('accepts a correctly-signed query', () => {
    const q: Record<string, string> = { shop: 'shop.myshopify.com', timestamp: '123', code: 'abc' }
    const msg = Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
    const hmac = createHmac('sha256', ENV.SHOPIFY_CLIENT_SECRET).update(msg).digest('hex')
    expect(validateShopifyHmac({ ...q, hmac })).toBe(true)
  })
  it('rejects a tampered query', () => {
    const q: Record<string, string> = { shop: 'shop.myshopify.com', timestamp: '123', code: 'abc' }
    const msg = Object.entries(q).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
    const hmac = createHmac('sha256', ENV.SHOPIFY_CLIENT_SECRET).update(msg).digest('hex')
    expect(validateShopifyHmac({ ...q, code: 'tampered', hmac })).toBe(false)
  })
  it('rejects when hmac is missing', () => {
    expect(validateShopifyHmac({ shop: 'x' })).toBe(false)
  })
})

// Fixture ProviderHttp — canned exchange responses (no live creds).
function fixtureHttp(byUrl: (url: string) => unknown): ProviderHttp {
  return {
    async request(req) {
      const data = byUrl(req.url)
      return {
        ok: data != null,
        status: data != null ? 200 : 400,
        json: async () => data,
        text: async () => JSON.stringify(data),
      }
    },
  }
}

describe('exchangeCode through the fixture seam (mechanical verification)', () => {
  it('Shopify: returns access_token content + shop accountRef + no expiry', async () => {
    const http = fixtureHttp((url) =>
      url.includes('/admin/oauth/access_token')
        ? { access_token: 'shpat_xxx', scope: 'read_orders,read_products' }
        : null,
    )
    const out = await exchangeCode('SHOPIFY', 'code1', http, { shopDomain: 'shop.myshopify.com' })
    expect(out.content['access_token']).toBe('shpat_xxx')
    expect(out.accountRef).toBe('shop.myshopify.com')
    expect(out.tokenExpiresAt).toBeNull()
    expect(out.scopes).toContain('read_orders')
  })

  it('Meta: short-lived → long-lived exchange; expiry set from expires_in', async () => {
    let calls = 0
    const http: ProviderHttp = {
      async request() {
        calls++
        const data = calls === 1 ? { access_token: 'short' } : { access_token: 'long', expires_in: 5184000 }
        return { ok: true, status: 200, json: async () => data, text: async () => '' }
      },
    }
    const out = await exchangeCode('META', 'code2', http)
    expect(calls).toBe(2) // short + long-lived
    expect(out.content['access_token']).toBe('long')
    expect(out.tokenExpiresAt).toBeInstanceOf(Date)
    expect(out.scopes).toEqual(META_SCOPES.split(','))
  })

  it('Google: returns refresh_token; throws if none (offline access required)', async () => {
    const ok = fixtureHttp((url) =>
      url.includes('oauth2.googleapis.com/token')
        ? { access_token: 'at', refresh_token: 'rt', expires_in: 3600 }
        : null,
    )
    const out = await exchangeCode('GOOGLE', 'code3', ok)
    expect(out.content['refresh_token']).toBe('rt')
    expect(out.tokenExpiresAt).toBeInstanceOf(Date)

    const noRt = fixtureHttp(() => ({ access_token: 'at' })) // no refresh_token
    await expect(exchangeCode('GOOGLE', 'code4', noRt)).rejects.toThrow(/refresh token/i)
  })

  it('throws a generic error on a non-ok exchange (no provider body leaked)', async () => {
    const bad: ProviderHttp = {
      async request() {
        return { ok: false, status: 401, json: async () => ({}), text: async () => 'SECRET_BODY' }
      },
    }
    await expect(exchangeCode('META', 'c', bad)).rejects.toThrow(/Meta token exchange failed/i)
    await expect(exchangeCode('META', 'c', bad)).rejects.not.toThrow(/SECRET_BODY/)
  })
})
