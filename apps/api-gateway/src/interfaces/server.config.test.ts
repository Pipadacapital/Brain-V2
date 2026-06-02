// Boot-config validators (production-readiness config hardening): the prod
// env-validator + CORS-from-env resolver + the BRAIN_ENV discriminator.
import { describe, it, expect } from 'vitest';
import { isRealProd, resolveCorsOrigins, assertBootableRuntimeConfig } from './server.js';

describe('isRealProd (BRAIN_ENV discriminator)', () => {
  it('is false by default / for local|staging (local stack runs NODE_ENV=production)', () => {
    expect(isRealProd({})).toBe(false);
    expect(isRealProd({ BRAIN_ENV: 'local', NODE_ENV: 'production' })).toBe(false);
    expect(isRealProd({ BRAIN_ENV: 'staging' })).toBe(false);
  });
  it('is true only when BRAIN_ENV=production (case-insensitive)', () => {
    expect(isRealProd({ BRAIN_ENV: 'production' })).toBe(true);
    expect(isRealProd({ BRAIN_ENV: 'PRODUCTION' })).toBe(true);
  });
});

describe('resolveCorsOrigins', () => {
  it('defaults to the dev localhost allow-list when unset', () => {
    expect(resolveCorsOrigins({})).toContain('http://localhost:3000');
  });
  it('parses CORS_ALLOWED_ORIGINS as a trimmed comma list', () => {
    expect(resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com' }))
      .toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('assertBootableRuntimeConfig (fail-fast for real prod)', () => {
  it('is a no-op in local/staging (defaults are fine)', () => {
    expect(assertBootableRuntimeConfig({})).toBeNull();
    expect(assertBootableRuntimeConfig({ BRAIN_ENV: 'local' })).toBeNull();
  });

  it('rejects a prod deploy missing required config or shipping dev defaults', () => {
    const msg = assertBootableRuntimeConfig({
      BRAIN_ENV: 'production',
      DATABASE_URL: 'postgresql://x@localhost:5432/db', // localhost in prod = misconfig
      CLICKHOUSE_PASSWORD: 'brain_app_pw',              // dev default
      // CLICKHOUSE_URL / SUPABASE_URL / CORS_ALLOWED_ORIGINS / custody unset
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/CLICKHOUSE_URL/);
    expect(msg).toMatch(/localhost/);
    expect(msg).toMatch(/dev default/);
  });

  it('passes a well-formed prod config', () => {
    expect(
      assertBootableRuntimeConfig({
        BRAIN_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db.internal:5432/brain',
        CLICKHOUSE_URL: 'https://ch.internal:8443',
        CLICKHOUSE_PASSWORD: 'a-real-secret',
        SUPABASE_URL: 'https://proj.supabase.co',
        CORS_ALLOWED_ORIGINS: 'https://app.brain.com',
        CONNECTOR_CUSTODY_BACKING: 'aws-secrets-manager',
      }),
    ).toBeNull();
  });
});
