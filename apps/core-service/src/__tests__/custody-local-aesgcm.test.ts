/**
 * Slice D — LOCAL custody (AES-256-GCM) unit tests. No DB; the crypto + key handling
 * are exercised directly (encryptContent/decryptBlob) plus the LocalAesGcmCustody
 * round-trip via an injected mock runner. Covers TC-001 (AEAD tamper-reject),
 * TC-002 (key fail-closed), TC-003 (never-log), TC-004 (held production), TC-005 path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  encryptContent,
  decryptBlob,
  LocalAesGcmCustody,
} from '../infrastructure/secrets/local-aesgcm-custody.js'
import { CredentialNotFoundError } from '../infrastructure/secrets/credential-custody.js'
import { selectCustody } from '../infrastructure/secrets/custody-factory.js'
import { HeldProductionCustody, NotImplementedCustodyError } from '../infrastructure/secrets/production-custody.js'

const KEY = randomBytes(32)
const KEY_B64 = KEY.toString('base64')

describe('AES-256-GCM encrypt/decrypt (TC-001)', () => {
  it('round-trips a token object faithfully', () => {
    const content = { access_token: 'shpat_secret_value', shop_domain: 'x.myshopify.com' }
    const blob = encryptContent(content, KEY)
    const out = decryptBlob(blob, KEY)
    expect(out).toEqual(content)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const content = { access_token: 'same' }
    const a = encryptContent(content, KEY)
    const b = encryptContent(content, KEY)
    expect(Buffer.compare(a, b)).not.toBe(0)
  })

  it('REJECTS a tampered ciphertext (auth tag mismatch) — does NOT silently decrypt', () => {
    const blob = encryptContent({ access_token: 'tamperme' }, KEY)
    const tampered = Buffer.from(blob)
    // Flip one byte in the ciphertext region (after iv(12)+tag(16)).
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01
    expect(() => decryptBlob(tampered, KEY)).toThrow(/decryption failed/i)
  })

  it('REJECTS a tampered auth tag', () => {
    const blob = encryptContent({ access_token: 'tagflip' }, KEY)
    const tampered = Buffer.from(blob)
    tampered[12] = tampered[12]! ^ 0xff // first tag byte
    expect(() => decryptBlob(tampered, KEY)).toThrow(/decryption failed/i)
  })

  it('REJECTS decryption under a different key', () => {
    const blob = encryptContent({ access_token: 'wrongkey' }, KEY)
    expect(() => decryptBlob(blob, randomBytes(32))).toThrow(/decryption failed/i)
  })

  it('rejects a too-short blob (corrupt)', () => {
    expect(() => decryptBlob(Buffer.from([1, 2, 3]), KEY)).toThrow(/too short|corrupt/i)
  })
})

describe('LocalAesGcmCustody key handling (TC-002 fail-closed)', () => {
  const orig = process.env['CONNECTOR_CUSTODY_KEY']
  afterEach(() => {
    if (orig === undefined) delete process.env['CONNECTOR_CUSTODY_KEY']
    else process.env['CONNECTOR_CUSTODY_KEY'] = orig
  })

  function mockRunner() {
    const store = new Map<string, Buffer>()
    return {
      store,
      withWorkspace: async (_ws: string, fn: (tx: any) => Promise<any>) => {
        const tx = {
          query: async (sql: string, params: any[]) => {
            if (/INSERT INTO connector_credentials/i.test(sql)) {
              store.set(`${params[0]}:${params[1]}`, params[2] as Buffer)
              return { rows: [] }
            }
            if (/SELECT credential_enc/i.test(sql)) {
              const v = store.get(`${params[0]}:${params[1]}`)
              return { rows: v ? [{ credential_enc: v }] : [] }
            }
            if (/DELETE FROM connector_credentials/i.test(sql)) {
              store.delete(`${params[0]}:${params[1]}`)
              return { rows: [] }
            }
            return { rows: [] }
          },
        }
        return fn(tx)
      },
    } as any
  }

  it('throws (fail-closed) when CONNECTOR_CUSTODY_KEY is unset — NO silent default key', async () => {
    delete process.env['CONNECTOR_CUSTODY_KEY']
    const custody = new LocalAesGcmCustody(mockRunner())
    await expect(custody.put('00000000-0000-0000-0000-000000000001', 'META', { access_token: 'x' }))
      .rejects.toThrow(/CONNECTOR_CUSTODY_KEY is not set/i)
  })

  it('throws when the key is the wrong length', async () => {
    process.env['CONNECTOR_CUSTODY_KEY'] = Buffer.from('short').toString('base64')
    const custody = new LocalAesGcmCustody(mockRunner())
    await expect(custody.put('00000000-0000-0000-0000-000000000001', 'META', { access_token: 'x' }))
      .rejects.toThrow(/must decode to exactly 32 bytes/i)
  })

  it('put → get round-trips through the (mock) RLS runner; tamper at rest rejects on get', async () => {
    process.env['CONNECTOR_CUSTODY_KEY'] = KEY_B64
    const runner = mockRunner()
    const custody = new LocalAesGcmCustody(runner)
    const ws = '00000000-0000-0000-0000-000000000002'
    await custody.put(ws, 'GOOGLE', { refresh_token: 'rt_secret' })
    const cred = await custody.get(ws, 'GOOGLE')
    expect(cred.content).toEqual({ refresh_token: 'rt_secret' })

    // Tamper the at-rest blob → get() must reject (not return garbage).
    const blob = runner.store.get(`${ws}:GOOGLE`) as Buffer
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0x01
    await expect(custody.get(ws, 'GOOGLE')).rejects.toThrow(/decryption failed/i)
  })

  it('get throws CredentialNotFoundError when no row (fail-closed / cross-ws / never-stored)', async () => {
    process.env['CONNECTOR_CUSTODY_KEY'] = KEY_B64
    const custody = new LocalAesGcmCustody(mockRunner())
    await expect(custody.get('00000000-0000-0000-0000-000000000003', 'SHOPIFY'))
      .rejects.toBeInstanceOf(CredentialNotFoundError)
  })

  it('seal deletes the credential (local revoke)', async () => {
    process.env['CONNECTOR_CUSTODY_KEY'] = KEY_B64
    const runner = mockRunner()
    const custody = new LocalAesGcmCustody(runner)
    const ws = '00000000-0000-0000-0000-000000000004'
    await custody.put(ws, 'META', { access_token: 'a' })
    await custody.seal(ws, 'META')
    await expect(custody.get(ws, 'META')).rejects.toBeInstanceOf(CredentialNotFoundError)
  })
})

describe('TC-003 — the token VALUE never leaks into errors', () => {
  it('CredentialNotFoundError carries ids but no token', () => {
    const e = new CredentialNotFoundError('ws-1', 'META')
    expect(e.message).not.toMatch(/access_token|refresh_token|shpat_/)
    expect(e.message).toContain('META')
  })

  it('decrypt error message carries no plaintext', () => {
    const blob = encryptContent({ access_token: 'topsecret_leak_canary' }, KEY)
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0x01
    try {
      decryptBlob(blob, KEY)
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('topsecret_leak_canary')
    }
  })
})

describe('TC-004 — custody factory selects backing; production is HELD', () => {
  it('local-aesgcm selects the real local backing', () => {
    expect(selectCustody('local-aesgcm')).toBeInstanceOf(LocalAesGcmCustody)
  })
  it('undefined/empty defaults to local-aesgcm', () => {
    expect(selectCustody(undefined)).toBeInstanceOf(LocalAesGcmCustody)
    expect(selectCustody('')).toBeInstanceOf(LocalAesGcmCustody)
  })
  it('a production backing name selects the HELD stub', () => {
    expect(selectCustody('aws-secrets-manager')).toBeInstanceOf(HeldProductionCustody)
    expect(selectCustody('supabase-column')).toBeInstanceOf(HeldProductionCustody)
  })
  it('HELD production stub throws NotImplementedCustodyError on every method', async () => {
    const held = new HeldProductionCustody()
    await expect(held.get('w', 'META')).rejects.toBeInstanceOf(NotImplementedCustodyError)
    await expect(held.put('w', 'META', {})).rejects.toBeInstanceOf(NotImplementedCustodyError)
    await expect(held.seal('w', 'META')).rejects.toBeInstanceOf(NotImplementedCustodyError)
  })
})
