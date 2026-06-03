-- =============================================================================
-- connector_identity_map — system routing table for inbound webhooks.
--   Maps (vendor, external_identity) → workspace_id, read system-scoped during
--   HMAC verify (BEFORE a workspace session exists — it PRODUCES the workspace_id).
--
-- LOCAL: applied by the migrator so the local real-time webhook path resolves a
-- workspace. PROD: the identical schema is applied at the Stage-8 webhook ceremony
-- via apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql (held,
-- CF-BN-DDL-GATING-1) — NOT this file. Schemas are kept identical on purpose.
--
-- NO PII: external_identity is a public vendor identifier (shop domain / page id);
-- workspace_id is a UUID. NO RLS: read pre-workspace, system-scoped composite-PK
-- lookup only (the subsequent PII write into raw_shopify_orders is with_workspace-
-- scoped). RLS asymmetry intentional — MAP-AFTER-VERIFY-1.
--
-- Vendor-extensible (integration-extensible-schema rule #5): vendor is a TEXT
-- discriminator in the composite PK — a second vendor adds ROWS, not DDL.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connector_identity_map (
    vendor            TEXT        NOT NULL,
    external_identity TEXT        NOT NULL,
    PRIMARY KEY (vendor, external_identity),
    workspace_id      UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE connector_identity_map IS
  'System routing table: (vendor, external_identity) → workspace_id. Read system-scoped '
  'during HMAC verify (pre-workspace). No PII. No RLS (MAP-AFTER-VERIFY-1). Vendor-extensible.';

-- svc_ingestion reads this table during verify (system-scoped, pre-workspace).
-- Grant is guarded so this migration is safe if the role does not exist (fresh CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_ingestion') THEN
    GRANT SELECT ON connector_identity_map TO svc_ingestion;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_app') THEN
    GRANT SELECT ON connector_identity_map TO rls_app;
  END IF;
END $$;
