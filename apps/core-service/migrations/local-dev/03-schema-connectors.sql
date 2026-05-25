-- =============================================================================
-- LOCAL-DEV — Slice D (live integrations: Shopify, Meta, Google OAuth + custody).
--
-- Three connector tables on the LOCAL dev Postgres (docker, :5432). Additive on
-- top of slice-C's onboarding schema. Same fail-closed FORCE-RLS shape Child-1
-- codified (CF-C1-RLS-DEFAULT-1.a) — applied in 04-enable-rls-connectors.sql.
--
-- TOKEN CUSTODY: connector_credentials holds OAuth access/refresh tokens ENCRYPTED
-- AT REST ONLY (AES-256-GCM blob in `credential_enc bytea`). There is NO plaintext
-- token column, ever. The encrypt/decrypt happens in the TS custody backing
-- (local-aesgcm-custody.ts); the DB only ever sees the ciphertext blob.
--
-- The PRODUCTION custody seal()/at-rest decision (AWS Secrets Manager ap-south-1
-- vs Supabase encrypt-in-place) REMAINS HELD (CF-C7-CUSTODY-PROOF-1). This local
-- backing is the dev template; it does NOT make the production decision.
--
-- Apply order: 01 → 02 → THIS (03) → 04-enable-rls-connectors.sql.
-- Run as the postgres superuser (DDL); the app connects as rls_app (non-BYPASSRLS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE connector_vendor AS ENUM ('SHOPIFY', 'META', 'GOOGLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- NOT_CONNECTED = never connected; CONNECTED = live token on record;
  -- TOKEN_EXPIRED = token_expires_at < now() (re-auth needed);
  -- ERROR = last operation failed; DISCONNECTED = user-revoked (credential sealed).
  CREATE TYPE connector_status AS ENUM
    ('NOT_CONNECTED', 'CONNECTED', 'TOKEN_EXPIRED', 'ERROR', 'DISCONNECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- connector_connections — one row per (workspace, vendor). NON-SECRET metadata:
-- status, scopes, account ref (shop domain / ad-account id / customer id),
-- currency/account names, token expiry, sync state. NEVER holds a token value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor            connector_vendor NOT NULL,
  status            connector_status NOT NULL DEFAULT 'NOT_CONNECTED',
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  account_ref       TEXT,                 -- shop domain / ad-account id / customer id (NON-secret)
  external_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- NON-secret: currency, account names
  token_expires_at  TIMESTAMPTZ,
  connected_at      TIMESTAMPTZ,
  last_sync_at      TIMESTAMPTZ,          -- stays NULL: data-ingestion DEFERRED (status = "sync pending")
  last_sync_error   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor)           -- idempotent callback UPSERT key
);
CREATE INDEX IF NOT EXISTS connector_connections_workspace_idx
  ON connector_connections (workspace_id);

-- ---------------------------------------------------------------------------
-- connector_credentials — the CUSTODY store (SECRET). credential_enc is the
-- AES-256-GCM blob (iv || authTag || ciphertext) of the token JSON. There is NO
-- plaintext column. Primary key (workspace_id, vendor) → idempotent custody UPSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_credentials (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor         connector_vendor NOT NULL,
  credential_enc BYTEA NOT NULL,          -- iv(12) || authTag(16) || ciphertext — NEVER plaintext
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, vendor)
);

-- ---------------------------------------------------------------------------
-- connector_oauth_states — CSRF / one-time state nonce. state_hash = sha256(nonce);
-- the raw nonce is never stored. 10-minute TTL; consumed (deleted) on validate.
-- shop_domain carried for Shopify (per-store OAuth host). user_id = the initiator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_oauth_states (
  state_hash   TEXT PRIMARY KEY,          -- sha256 hex of the random nonce
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor       connector_vendor NOT NULL,
  user_id      UUID NOT NULL,
  shop_domain  TEXT,                       -- Shopify only (the *.myshopify.com host)
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_oauth_states_workspace_idx
  ON connector_oauth_states (workspace_id);
CREATE INDEX IF NOT EXISTS connector_oauth_states_expires_idx
  ON connector_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- Grants — the app role (rls_app, non-BYPASSRLS) needs DML on these tables.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_connections   TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_credentials   TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_oauth_states  TO rls_app;
