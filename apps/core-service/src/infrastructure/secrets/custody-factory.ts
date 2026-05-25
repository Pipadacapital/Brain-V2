/**
 * Custody backing selector (TC-004: flag-gated; local is the dev template, not prod).
 *
 * @paradigm sql (no ML, no LLM)
 *
 * CONNECTOR_CUSTODY_BACKING selects the at-rest custody backing:
 *   'local-aesgcm' (default for local dev) → LocalAesGcmCustody (real AES-256-GCM).
 *   anything else (e.g. 'aws-secrets-manager', 'supabase-column') → HELD production
 *     stub → NotImplementedCustodyError on use (CF-C7-CUSTODY-PROOF-1, Founder-gated).
 *
 * Swapping the backing is a one-line config change, NOT a re-architecture — exactly
 * the Child-3 contract. The local backing is clearly local-dev-only.
 */

import type { CredentialCustody } from './credential-custody.js'
import { LocalAesGcmCustody } from './local-aesgcm-custody.js'
import { HeldProductionCustody } from './production-custody.js'

export type CustodyBacking = 'local-aesgcm' | 'aws-secrets-manager' | 'supabase-column'

export function selectCustody(
  backing: string | undefined = process.env['CONNECTOR_CUSTODY_BACKING'],
): CredentialCustody {
  switch (backing) {
    case undefined:
    case '':
    case 'local-aesgcm':
      // LOCAL-DEV default: real authenticated encryption at rest.
      return new LocalAesGcmCustody()
    default:
      // Any production backing name selects the HELD stub (throws on use).
      return new HeldProductionCustody()
  }
}
