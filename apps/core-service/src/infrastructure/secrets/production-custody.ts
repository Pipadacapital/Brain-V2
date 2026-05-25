/**
 * Production credential custody — HELD (CF-C7-CUSTODY-PROOF-1).
 *
 * @paradigm sql (no ML, no LLM)
 *
 * The production at-rest custody decision is a Founder-gated escalation, unchanged
 * by slice D:
 *   Option A — AWS Secrets Manager, ap-south-1 (IAM-scoped GetSecretValue).
 *   Option B — Supabase column encrypt-in-place.
 * BOTH backings are NotImplementedError stubs in the Child-3 Python framework
 * (aws_secrets_manager_custody.py / supabase_column_custody.py). This TS mirror keeps
 * them held identically: selecting a production backing raises NotImplementedError.
 *
 * Slice D ships ONLY the local-aesgcm backing (local-dev). The production seal()
 * remains a held, Founder-gated item. Do NOT implement here without the Founder's
 * written Option A/B decision + WS-1 (security-governance) activation.
 */

import type { Credential, CredentialCustody } from './credential-custody.js'

export class NotImplementedCustodyError extends Error {
  constructor(method: string) {
    super(
      `[production-custody.${method}] HELD — CF-C7-CUSTODY-PROOF-1. The production ` +
        `at-rest custody decision (AWS Secrets Manager ap-south-1 vs Supabase ` +
        `encrypt-in-place) is Founder-gated and not yet activated. Slice D ships the ` +
        `local-aesgcm backing only. Do not enable a production backing without the ` +
        `Founder's written Option A/B decision + WS-1 activation.`,
    )
    this.name = 'NotImplementedCustodyError'
  }
}

/** Held production backing — every method throws until the Founder gate clears. */
export class HeldProductionCustody implements CredentialCustody {
  async get(_workspaceId: string, _vendor: string): Promise<Credential> {
    throw new NotImplementedCustodyError('get')
  }
  async put(
    _workspaceId: string,
    _vendor: string,
    _content: Record<string, unknown>,
  ): Promise<void> {
    throw new NotImplementedCustodyError('put')
  }
  async seal(_workspaceId: string, _vendor: string): Promise<void> {
    throw new NotImplementedCustodyError('seal')
  }
}
