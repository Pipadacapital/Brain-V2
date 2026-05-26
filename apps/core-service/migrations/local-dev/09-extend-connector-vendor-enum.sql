-- =============================================================================
-- Phase 1 — extend connector_vendor with WOOCOMMERCE / UNICOMMERCE / KLAVIYO.
-- SHIPROCKET was added by /tmp/brain_mig/03a_enum_fdw.sql; promoted into local-dev here
-- (idempotent ADD VALUE — safe even if already present).
--
-- IMPORTANT: ALTER TYPE ADD VALUE must run in its OWN session (commit) before the new
-- value can be used in same-txn DML — see canon `connector_vendor` precedent.
-- =============================================================================
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'SHIPROCKET';
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'WOOCOMMERCE';
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'UNICOMMERCE';
ALTER TYPE connector_vendor ADD VALUE IF NOT EXISTS 'KLAVIYO';
