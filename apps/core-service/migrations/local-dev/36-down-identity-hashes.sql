-- =============================================================================
-- DOWN — 36-identity-hashes.sql
-- Reverses the P1-C identity migration in dev/test environments.
-- CAUTION: dropping these tables removes all cluster assignments and salt records.
-- Do not run in production.
-- =============================================================================

-- Remove extended columns from customer_pii first.
ALTER TABLE customer_pii
  DROP COLUMN IF EXISTS identity_cluster_id,
  DROP COLUMN IF EXISTS salt_version,
  DROP COLUMN IF EXISTS phone_hash,
  DROP COLUMN IF EXISTS email_hash;

-- Drop tables in reverse dependency order.
DROP TABLE IF EXISTS identity_cluster_edges;
DROP TABLE IF EXISTS identity_cluster_registry;
DROP TABLE IF EXISTS workspace_identity_salt;
