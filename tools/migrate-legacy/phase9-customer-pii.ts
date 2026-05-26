/**
 * Phase 9 — customer_pii ETL (110K Shopify customers → encrypted PII dim).
 *
 * Reads legacy_src.shopify_customers (via the FDW already established in Phase 0/2),
 * encrypts email + full_name with AES-256-GCM using the SAME blob layout as
 * connector_credentials.credential_enc (IV(12) || tag(16) || ciphertext), and
 * UPSERTs into the local customer_pii table per v2 §3.1.
 *
 * LOCAL-DEV ONLY. The key is read from CONNECTOR_CUSTODY_KEY (the same base64 key
 * the OAuth custody backing uses); production custody is a separate decision.
 *
 * Run:
 *   pnpm --filter @brain/api-gateway exec env $(cat apps/api-gateway/.env | xargs) \
 *     tsx tools/migrate-legacy/phase9-customer-pii.ts
 *   # or just (with the key in env):
 *   CONNECTOR_CUSTODY_KEY=... DATABASE_URL=postgresql://postgres:postgres@localhost:5432/brain_dev \
 *     pnpm exec tsx tools/migrate-legacy/phase9-customer-pii.ts
 *
 * Idempotent: ON CONFLICT (workspace_id, source_vendor, vendor_customer_id) DO UPDATE.
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { Client } from 'pg'

// ---------------------------------------------------------------------------
// Crypto (mirror apps/core-service/.../local-aesgcm-custody.ts)
// ---------------------------------------------------------------------------
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

function loadKey(): Buffer {
  const b64 = process.env.CONNECTOR_CUSTODY_KEY
  if (!b64) {
    throw new Error('CONNECTOR_CUSTODY_KEY is required (base64 32-byte key from apps/api-gateway/.env)')
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== KEY_LEN) {
    throw new Error(`CONNECTOR_CUSTODY_KEY must decode to ${KEY_LEN} bytes (got ${key.length})`)
  }
  return key
}

function seal(plaintext: string | null, key: Buffer): Buffer | null {
  if (plaintext === null || plaintext === '') return null
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_LEN) throw new Error(`unexpected auth tag length ${tag.length}`)
  return Buffer.concat([iv, tag, ct])
}

function customerRef(vendorCustomerId: string): string {
  // sha256 → hex → first 32 chars; matches connector_order_facts.customer_ref.
  return createHash('sha256').update(vendorCustomerId).digest('hex').slice(0, 32)
}

function subunitMultiplier(currency: string | null): number {
  const c = (currency ?? 'INR').toUpperCase()
  if (c === 'KWD' || c === 'BHD') return 1000
  if (c === 'JPY') return 1
  return 100
}

// ---------------------------------------------------------------------------
// ETL
// ---------------------------------------------------------------------------
const BATCH = 1000

async function main() {
  const key = loadKey()
  const conn = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/brain_dev'
  const pg = new Client({ connectionString: conn })
  await pg.connect()

  // Foreign tables for shopify_customers + shopify_connections (Phase-9 extensions).
  await pg.query(`DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_customers`)
  await pg.query(`
    CREATE FOREIGN TABLE legacy_src.shopify_customers (
      id uuid, connection_id uuid, shopify_id text, email text,
      first_name text, last_name text,
      orders_count integer, total_spent numeric, currency text, tags text[], state text,
      shopify_created_at timestamp, created_at timestamp, updated_at timestamp
    ) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_customers')`)
  await pg.query(`DROP FOREIGN TABLE IF EXISTS legacy_src.shopify_connections`)
  await pg.query(`
    CREATE FOREIGN TABLE legacy_src.shopify_connections (
      id uuid, workspace_id uuid
    ) SERVER legacy_supa OPTIONS (schema_name 'public', table_name 'shopify_connections')`)

  // Join shopify_customers → shopify_connections to get workspace_id.
  const total = await pg.query<{ c: string }>(`
    SELECT count(*)::text c FROM legacy_src.shopify_customers sc
    JOIN legacy_src.shopify_connections c ON c.id = sc.connection_id`)
  console.log(`source rows (joined w/ workspace): ${total.rows[0].c}`)

  // Stream via OFFSET/LIMIT — postgres_fdw doesn't expose server-side cursors well.
  // For 110K rows this is fine.
  let offset = 0
  let migrated = 0
  while (true) {
    const batch = await pg.query<{
      workspace_id: string
      shopify_id: string
      email: string | null
      first_name: string | null
      last_name: string | null
      orders_count: number
      total_spent: string
      currency: string | null
      tags: string[] | null
      shopify_created_at: string | null
      updated_at: string | null
    }>(
      `SELECT c.workspace_id, sc.shopify_id, sc.email, sc.first_name, sc.last_name,
              sc.orders_count, sc.total_spent::text, sc.currency, sc.tags,
              sc.shopify_created_at::text, sc.updated_at::text
         FROM legacy_src.shopify_customers sc
         JOIN legacy_src.shopify_connections c ON c.id = sc.connection_id
         ORDER BY sc.shopify_id
         OFFSET $1 LIMIT $2`,
      [offset, BATCH],
    )
    if (batch.rows.length === 0) break

    // Build a multi-row INSERT (with explicit casts so bytea params work).
    const values: unknown[] = []
    const placeholders: string[] = []
    for (let i = 0; i < batch.rows.length; i++) {
      const r = batch.rows[i]
      const ref = customerRef(r.shopify_id)
      const emailCt = seal(r.email, key)
      const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
      const nameCt = seal(fullName || null, key)
      const spentMu = BigInt(Math.round(Number(r.total_spent || '0') * subunitMultiplier(r.currency)))
      const base = i * 12
      placeholders.push(
        `($${base + 1}, $${base + 2}, 'SHOPIFY'::connector_vendor, $${base + 3}, $${base + 4}, ` +
          `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::bigint, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`,
      )
      values.push(
        r.workspace_id,
        ref,
        r.shopify_id,
        emailCt,
        nameCt,
        r.shopify_created_at,
        r.updated_at,
        r.orders_count ?? 0,
        spentMu.toString(),
        r.currency ?? 'INR',
        r.tags ?? [],
        r.updated_at ?? null,
      )
    }
    const sql = `
      INSERT INTO customer_pii (
        workspace_id, customer_ref, source_vendor, vendor_customer_id,
        email_ct, full_name_ct, first_seen_at, last_seen_at,
        orders_count, lifetime_spent_mu, currency_code, tags, updated_at
      ) VALUES ${placeholders.join(',')}
      ON CONFLICT (workspace_id, source_vendor, vendor_customer_id) DO UPDATE SET
        email_ct = EXCLUDED.email_ct,
        full_name_ct = EXCLUDED.full_name_ct,
        last_seen_at = EXCLUDED.last_seen_at,
        orders_count = EXCLUDED.orders_count,
        lifetime_spent_mu = EXCLUDED.lifetime_spent_mu,
        currency_code = EXCLUDED.currency_code,
        tags = EXCLUDED.tags,
        updated_at = EXCLUDED.updated_at`
    await pg.query(sql, values)
    migrated += batch.rows.length
    offset += BATCH
    if (migrated % 10000 === 0 || batch.rows.length < BATCH) {
      console.log(`  migrated ${migrated} customers`)
    }
  }

  const localCount = await pg.query<{ c: string }>('SELECT count(*)::text c FROM customer_pii')
  console.log(`✓ customer_pii rows: ${localCount.rows[0].c}`)
  await pg.end()
}

main().catch((e) => {
  console.error('phase9 failed:', e)
  process.exit(1)
})
