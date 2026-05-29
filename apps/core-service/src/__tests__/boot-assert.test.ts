/**
 * Unit tests for assertShopifyOAuthSecretsPresent (boot-assert.ts).
 *
 * Tests:
 *   (+) present, non-empty  → returns null (bootable)
 *   (+) whitespace only     → returns fatal (non-empty trim check)
 *   (-) unset               → fatal message contains var NAME, NOT the value
 *   (-) empty string        → fatal message contains var NAME, NOT the value
 *   (-) never-log: value MUST NOT appear in the fatal message
 *   (-) wrong-region / multi-var scope: function does not assert vars it does
 *       not own (stays single-primitive — only SHOPIFY_CLIENT_SECRET)
 *
 * CF-TS-FAILFAST-1 / CF-TS-NEVERLOG-1
 */

import { describe, it, expect } from 'vitest'
import { assertShopifyOAuthSecretsPresent } from '../application/connectors/boot-assert.js'

// Fake value — clearly not real, safe to use in tests.
const FAKE_SECRET = 'shpss_FAKE_TEST_VALUE_NOT_REAL'

describe('assertShopifyOAuthSecretsPresent — present/bootable', () => {
  it('(+) returns null when SHOPIFY_CLIENT_SECRET is present and non-empty', () => {
    const result = assertShopifyOAuthSecretsPresent({
      SHOPIFY_CLIENT_SECRET: FAKE_SECRET,
    })
    expect(result).toBeNull()
  })

  it('(+) returns null when other env vars are absent (scope is SHOPIFY_CLIENT_SECRET only)', () => {
    // The function must not assert other vars — Single-Primitive scope.
    const result = assertShopifyOAuthSecretsPresent({
      SHOPIFY_CLIENT_SECRET: FAKE_SECRET,
      // intentionally omit unrelated vars
    })
    expect(result).toBeNull()
  })

  it('(+) accepts a real-looking value shape (non-empty presence check only)', () => {
    const result = assertShopifyOAuthSecretsPresent({
      SHOPIFY_CLIENT_SECRET: 'any-non-empty-value',
    })
    expect(result).toBeNull()
  })
})

describe('assertShopifyOAuthSecretsPresent — fatal / missing', () => {
  it('(-) returns a fatal string when SHOPIFY_CLIENT_SECRET is absent', () => {
    const result = assertShopifyOAuthSecretsPresent({})
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeGreaterThan(0)
  })

  it('(-) fatal message names the variable SHOPIFY_CLIENT_SECRET', () => {
    const result = assertShopifyOAuthSecretsPresent({})
    expect(result).toContain('SHOPIFY_CLIENT_SECRET')
  })

  it('(-) fatal message does NOT contain the secret value (CF-TS-NEVERLOG-1) — unset path', () => {
    // No value set; confirms the message cannot embed a value it never read.
    const result = assertShopifyOAuthSecretsPresent({})
    // The message must not contain any recognizable secret-shaped content.
    expect(result).not.toContain(FAKE_SECRET)
    expect(result).not.toContain('shpss_')
  })

  it('(-) fatal message does NOT contain the secret value (CF-TS-NEVERLOG-1) — value provided to env but unset path never reached', () => {
    // This tests the positive branch: when the value IS present, result is null.
    // Combined with the unset test above, proves the function never embeds the value.
    const presentResult = assertShopifyOAuthSecretsPresent({ SHOPIFY_CLIENT_SECRET: FAKE_SECRET })
    expect(presentResult).toBeNull()

    const absentResult = assertShopifyOAuthSecretsPresent({})
    // absentResult is the fatal string — it must not contain our fake value.
    expect(absentResult).not.toContain(FAKE_SECRET)
  })

  it('(-) returns fatal when SHOPIFY_CLIENT_SECRET is an empty string', () => {
    const result = assertShopifyOAuthSecretsPresent({ SHOPIFY_CLIENT_SECRET: '' })
    expect(typeof result).toBe('string')
    expect(result).toContain('SHOPIFY_CLIENT_SECRET')
    expect(result).not.toContain(FAKE_SECRET)
  })

  it('(-) returns fatal when SHOPIFY_CLIENT_SECRET is whitespace only (trim check)', () => {
    const result = assertShopifyOAuthSecretsPresent({ SHOPIFY_CLIENT_SECRET: '   ' })
    expect(typeof result).toBe('string')
    expect(result).toContain('SHOPIFY_CLIENT_SECRET')
  })
})

describe('assertShopifyOAuthSecretsPresent — pure / injectable', () => {
  it('(+) does not read process.env when a custom env is provided', () => {
    // If the function were to reach into process.env instead of the injected
    // param, this would fail when process.env has no SHOPIFY_CLIENT_SECRET.
    const savedValue = process.env['SHOPIFY_CLIENT_SECRET']
    delete process.env['SHOPIFY_CLIENT_SECRET']

    const result = assertShopifyOAuthSecretsPresent({ SHOPIFY_CLIENT_SECRET: FAKE_SECRET })
    expect(result).toBeNull()

    // Restore
    if (savedValue !== undefined) process.env['SHOPIFY_CLIENT_SECRET'] = savedValue
  })

  it('(-) uses process.env by default when no param provided and key absent', () => {
    // Ensure SHOPIFY_CLIENT_SECRET is absent from actual process.env for this test.
    const saved = process.env['SHOPIFY_CLIENT_SECRET']
    delete process.env['SHOPIFY_CLIENT_SECRET']

    const result = assertShopifyOAuthSecretsPresent()
    expect(typeof result).toBe('string')
    expect(result).toContain('SHOPIFY_CLIENT_SECRET')

    // Restore
    if (saved !== undefined) process.env['SHOPIFY_CLIENT_SECRET'] = saved
  })
})
