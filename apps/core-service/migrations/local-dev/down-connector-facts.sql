-- =============================================================================
-- LOCAL-DEV — symmetric rollback for the slice-E connector-fact schema.
--
-- Reverses 06-enable-rls-connector-facts.sql + 05-schema-connector-facts.sql.
-- Idempotent (IF EXISTS). Run as the postgres superuser BEFORE down-connectors.sql
-- (these tables FK to workspaces). LOCAL DEV teardown only; live DB untouched.
-- =============================================================================

ALTER TABLE IF EXISTS connector_ad_spend_facts   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_ad_spend_facts   DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_ad_spend_facts;

ALTER TABLE IF EXISTS connector_product_facts    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_product_facts    DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_product_facts;

ALTER TABLE IF EXISTS connector_line_item_facts  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_line_item_facts  DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_line_item_facts;

ALTER TABLE IF EXISTS connector_order_facts      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connector_order_facts      DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_isolation ON connector_order_facts;

DROP TABLE IF EXISTS connector_ad_spend_facts   CASCADE;
DROP TABLE IF EXISTS connector_product_facts    CASCADE;
DROP TABLE IF EXISTS connector_line_item_facts  CASCADE;
DROP TABLE IF EXISTS connector_order_facts      CASCADE;
