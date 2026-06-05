/**
 * Domain layer — Identity hashing (P1-C, R10, ADR #4).
 *
 * @paradigm sql (deterministic crypto; NO ML, NO LLM, NO network)
 *
 * Pure functions for computing salted HMAC identity hashes.
 * These replace the bare sha256 in acl.ts (G4/G6 cross-workspace breach fix).
 *
 * Design invariants (R10):
 *   1. Per-workspace salt — the same Shopify customer at two brands produces
 *      DIFFERENT hashes, preventing cross-workspace inference.
 *   2. HMAC (keyed), not bare SHA-256 — defeats rainbow-table re-identification
 *      of low-entropy phone numbers.
 *   3. E.164 normalization for phone BEFORE hashing — the same number from
 *      Shopify (+91-98765-43210) and Klaviyo (9876543210) hash identically.
 *   4. Email lowercase/trim BEFORE hashing.
 *   5. salt_version is append-only — rotation produces a new version, never
 *      in-place overwrite; historical hashes reference their version.
 *
 * NO I/O here. DB reads/writes live in infrastructure/identity/.
 */

import { createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// Normalization helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Normalize an email address for hashing: lowercase + trim.
 * Returns null if the input is empty/null/undefined.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const n = email.toLowerCase().trim()
  return n.length > 0 ? n : null
}

/**
 * Normalize a phone number to E.164 for hashing.
 * Strips all non-digit characters, then prepends '+91' for India (10-digit)
 * or '+' if the number already has a country code (>10 digits after stripping).
 *
 * This is a best-effort normalization for the India-first use case.
 * Complex international normalization (libphonenumber) is out of scope at P1-C.
 *
 * Returns null if the stripped number is empty or fewer than 7 digits (not a phone).
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  // Strip all non-digit characters.
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return null

  // Already has a country code prefix (e.g. '+91...' was stripped to '91...' = 12 digits).
  // India country code is 91; 10-digit local numbers → prepend 91.
  if (digits.length === 10) {
    // India 10-digit local number.
    return `+91${digits}`
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    // India number with country code prefix (digits are '91XXXXXXXXXX').
    return `+${digits}`
  }
  // For other lengths, prefix with '+' — this is a passthrough for non-India formats.
  // The hashes will still be consistent within a workspace as long as the same
  // normalization is applied to both values being compared.
  return `+${digits}`
}

// ---------------------------------------------------------------------------
// HMAC hash computation
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256(salt, normalizedValue) and return as 64-char hex.
 * The per-workspace salt (32 bytes) is the keying material.
 *
 * NEVER pass raw PII as `normalizedValue` without normalizing first.
 * Use normalizeEmail() / normalizePhone() before calling this.
 */
export function hmacSha256Hex(salt: Buffer, normalizedValue: string): string {
  return createHmac('sha256', salt).update(normalizedValue, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// High-level hash helpers
// ---------------------------------------------------------------------------

export interface IdentityHashes {
  emailHash: string | null
  phoneHash: string | null
  saltVersion: string
}

/**
 * Compute identity hashes for an email + phone pair using a per-workspace salt.
 * Both normalizations are applied before hashing.
 * Returns null for any field that has no usable value after normalization.
 */
export function computeIdentityHashes(opts: {
  email: string | null | undefined
  phone: string | null | undefined
  salt: Buffer
  saltVersion: string
}): IdentityHashes {
  const normalizedEmail = normalizeEmail(opts.email)
  const normalizedPhone = normalizePhone(opts.phone)

  return {
    emailHash: normalizedEmail !== null ? hmacSha256Hex(opts.salt, normalizedEmail) : null,
    phoneHash: normalizedPhone !== null ? hmacSha256Hex(opts.salt, normalizedPhone) : null,
    saltVersion: opts.saltVersion,
  }
}

// ---------------------------------------------------------------------------
// Salted customer_ref (replaces bare sha256 in acl.ts when IDENTITY_STITCHER=true)
// ---------------------------------------------------------------------------

/**
 * Compute a per-workspace-salted customer_ref from a vendor customer ID.
 * This replaces the bare sha256 in acl.ts when the IDENTITY_STITCHER flag is ON.
 *
 * Result: first 32 hex chars of HMAC-SHA256(salt, vendorCustomerId).
 * Matches the existing 32-char hex convention in customer_pii.customer_ref.
 */
export function saltedCustomerRef(
  vendorCustomerId: string | null | undefined,
  salt: Buffer,
): string | null {
  if (!vendorCustomerId) return null
  return hmacSha256Hex(salt, String(vendorCustomerId)).slice(0, 32)
}
