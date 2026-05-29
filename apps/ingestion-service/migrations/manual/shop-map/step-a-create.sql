-- =============================================================================
-- IDENTITY MAP — STEP A: CREATE connector_identity_map
--
-- HOLD-AT-CUTOVER: NOT applied by any migration runner.
-- Applied ONLY at Stage-8 ceremony (STEP 2 of the webhook runbook),
-- AFTER startup gates are GREEN and AFTER Track T4 infra is confirmed INTERNAL-only.
--
-- CF-BN-DDL-GATING-1        : not auto-applied.
-- TRANSPORT-1 / MAP-AFTER-VERIFY-1 : this table is read system-scoped BEFORE
--   a workspace session is established (it produces the workspace_id).
--   The PII write into raw_shopify_orders uses the existing with_workspace (P1) path.
--   RLS asymmetry: intentional — documented for Shreya (§11 of the architecture plan).
-- VENDOR-REGISTRY-DISPATCH-1: vendor is a plain TEXT column in the composite PK —
--   no vendor-specific tables or enum types.  Adding a second vendor adds rows,
--   not DDL.  Aligns with feedback_integration_extensible_schema rule #5.
--
-- NO PII in this table.
--   external_identity is a public vendor-specific identifier (e.g. Shopify shop
--   domain, Meta page id, Stripe account id) — not personal data.
--   workspace_id is a UUID foreign key, not personal data.
--   This is a system routing table only.
--
-- Schema (supersedes connector_shop_map from the Shopify-locked shape):
--   PRIMARY KEY (vendor, external_identity) — composite; two vendors' identities
--   cannot collide.  Aligns with customer_ref collision-safety (feedback #5).
--   vendor is a TEXT discriminator (integration-extensible-schema rule):
--     'shopify' → external_identity = shop domain (e.g. 'sugandhlok.myshopify.com')
--     'meta'    → external_identity = page/app id (future)
--     'stripe'  → external_identity = account id (future)
--
-- Reversibility: down.sql drops the table fully (additive, no FKs from existing tables,
--   no prod rows until Stage-8 seeds the Sugandh-Lok row).
-- =============================================================================

CREATE TABLE IF NOT EXISTS connector_identity_map (
    -- vendor: the integration vendor key (e.g. 'shopify', 'meta', 'stripe').
    -- Part of the composite PK. STRING discriminator — no enum, no per-vendor table.
    -- Adding a second vendor adds ROWS, not DDL (integration-extensible-schema rule).
    vendor            TEXT        NOT NULL,

    -- external_identity: the vendor-specific connector identity.
    --   Shopify: shop domain (e.g. 'sugandhlok.myshopify.com')
    --   Meta:    page/app id
    --   Stripe:  account id
    -- NOT PII: a public vendor-assigned identifier, not personal data.
    -- Part of the composite PK (vendor, external_identity).
    external_identity TEXT        NOT NULL,

    PRIMARY KEY (vendor, external_identity),

    -- workspace_id resolved from (vendor, external_identity).
    -- Set by the operator at Stage-8 seeding; NULL is forbidden (the mapping
    -- is only inserted when the workspace is confirmed + DPDP-instrumented).
    workspace_id      UUID        NOT NULL,

    -- created_at: audit timestamp for the mapping insertion.
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No RLS on this table: it is a system routing table read BEFORE a workspace
-- session is established (it produces the workspace_id).
-- System-scoped composite-PK reads: WHERE vendor = $1 AND external_identity = $2.
-- The subsequent PII write into raw_shopify_orders is fully with_workspace-scoped.
-- RLS asymmetry intentional and documented (§11 architecture plan / MAP-AFTER-VERIFY-1).

-- Index: composite PK (vendor, external_identity) is the lookup index.
-- The B-tree index auto-created by Postgres on the composite PK handles the
-- O(1) verify-path lookup. No additional index needed.

COMMENT ON TABLE connector_identity_map IS
  'System routing table: maps (vendor, external_identity) → workspace_id. '
  'Read system-scoped (pre-workspace) during HMAC verify. '
  'No PII. RLS asymmetry intentional — see §11 architecture plan. '
  'Vendor-extensible: adding a new connector adds rows, not DDL columns/tables.';

COMMENT ON COLUMN connector_identity_map.vendor IS
  'Integration vendor key (e.g. ''shopify'', ''meta'', ''stripe''). '
  'STRING discriminator — no enum. Part of composite PK.';

COMMENT ON COLUMN connector_identity_map.external_identity IS
  'Vendor-specific connector identity. '
  'Shopify: shop domain (e.g. sugandhlok.myshopify.com). '
  'Meta: page/app id. Stripe: account id. NOT PII. Part of composite PK.';

COMMENT ON COLUMN connector_identity_map.workspace_id IS
  'Brain workspace UUID resolved from (vendor, external_identity) post-verify.';
