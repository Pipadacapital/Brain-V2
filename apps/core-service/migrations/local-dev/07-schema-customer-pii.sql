-- =============================================================================
-- Phase 1 (legacy-parity migration) — D2: customer PII dim.
-- Design: docs/data-architecture-plan.md §3.1.
--
-- The ONLY home for customer PII. Facts stay minimized (customer_ref hash +
-- pincode/city only). email/phone/full_name are AES-256-GCM ciphertext blobs
-- (same shape as connector_credentials.credential_enc — IV(12) || tag(16) || ct).
-- Erasure tombs the row (set tombstoned_at, zero the _ct columns) — facts intact.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE customer_consent_status AS ENUM ('unknown','opted_in','opted_out','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS customer_pii (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_ref        TEXT NOT NULL,                  -- sha256(vendor customer id) — same join key as facts
  source_vendor       connector_vendor NOT NULL,      -- which connector first observed this customer
  vendor_customer_id  TEXT NOT NULL,                  -- raw vendor id

  -- Encrypted PII (NEVER plaintext). AES-256-GCM(iv||tag||ct), same backing as connector_credentials.
  email_ct            BYTEA,
  phone_ct            BYTEA,
  full_name_ct        BYTEA,

  -- Non-PII derived
  first_seen_at       TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  orders_count        INT NOT NULL DEFAULT 0,
  lifetime_spent_mu   BIGINT NOT NULL DEFAULT 0,
  currency_code       TEXT,
  tags                TEXT[] NOT NULL DEFAULT '{}',

  -- Consent (TECH/16 §3 — opt-in default OFF)
  consent_status      customer_consent_status NOT NULL DEFAULT 'unknown',
  consent_recorded_at TIMESTAMPTZ,
  withdrawn_at        TIMESTAMPTZ,

  -- Erasure tombstone
  tombstoned_at       TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, customer_ref),
  UNIQUE (workspace_id, source_vendor, vendor_customer_id)
);
CREATE INDEX IF NOT EXISTS customer_pii_workspace_idx ON customer_pii (workspace_id, last_seen_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_pii TO rls_app;
