/**
 * Credential-custody interface (TS mirror of the Child-3 Python Protocol).
 *
 * @paradigm sql (deterministic crypto + DB persistence; no ML, no LLM)
 *
 * Slice D (live integrations) runs on the TS runtime (web → gateway → core-service),
 * NOT the held Python ingestion-service framework. This is the FIRST TS custody
 * implementation and the SINGLE TS custody seam — every TS connector token read/
 * write goes through a CredentialCustody. It mirrors the locked Python signature
 * (apps/ingestion-service/src/infrastructure/secrets/custody.py) 1:1:
 *
 *   get(workspace_id, vendor)  -> Credential        (KeyError-equiv: throws if none)
 *   put(workspace_id, vendor, content) -> void       (UPSERT — idempotent)
 *   seal(workspace_id, vendor) -> void               (delete/encrypt-in-place at revoke)
 *
 * IMPORTANT (mirrors the Python rule): implementations MUST NEVER log or serialize
 * Credential.content — it contains plaintext OAuth tokens. The only at-rest form is
 * the AES-256-GCM ciphertext in connector_credentials.credential_enc.
 *
 * The PRODUCTION custody backing (AWS Secrets Manager ap-south-1 vs Supabase
 * encrypt-in-place) REMAINS HELD (CF-C7-CUSTODY-PROOF-1, Founder-gated). The
 * local-aesgcm backing is a real dev backing + the template the production seal()
 * must satisfy — it does NOT make the production decision.
 */

/**
 * Opaque credential container. NEVER log or serialize this object.
 * `content` holds whatever the vendor needs (access_token, refresh_token, scope, …).
 */
export interface Credential {
  workspaceId: string
  vendor: string
  /** NEVER logged or serialized outside the custody backing. */
  content: Record<string, unknown>
}

export interface CredentialCustody {
  /**
   * Retrieve the credential for (workspaceId, vendor).
   * Throws CredentialNotFoundError if no credential is on record for this pair.
   */
  get(workspaceId: string, vendor: string): Promise<Credential>

  /**
   * Store / update the credential for (workspaceId, vendor). Idempotent (UPSERT) —
   * a replayed OAuth callback re-writes the same row, never duplicates. `content`
   * MUST never be logged.
   */
  put(workspaceId: string, vendor: string, content: Record<string, unknown>): Promise<void>

  /**
   * Delete or encrypt-in-place the credential (user-disconnect / revoke).
   * In the local backing this is a row DELETE (the local revoke analogue). In
   * production this is the held seal() (CF-C7-CUSTODY-PROOF-1).
   */
  seal(workspaceId: string, vendor: string): Promise<void>
}

/** Thrown by get() when no credential exists for (workspaceId, vendor). */
export class CredentialNotFoundError extends Error {
  constructor(workspaceId: string, vendor: string) {
    // Message carries ids for correlation but NEVER any token content.
    super(`[custody] no credential on record for workspace=${workspaceId} vendor=${vendor}`)
    this.name = 'CredentialNotFoundError'
  }
}
