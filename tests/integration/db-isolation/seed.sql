-- Representative schema + owned tables for the A4 db-isolation negative-test.
-- A subset (not every real table) — full per-table grant correctness is asserted
-- statically by conformance C12; THIS harness proves the deny MECHANISM works.
-- Tables are owned by the bootstrap superuser, exactly as in the real DB today.
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS memory;
CREATE SCHEMA IF NOT EXISTS legacy_aggregates;

CREATE TABLE IF NOT EXISTS public.customer_pii          (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.connector_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.raw_shopify_orders    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.connector_identity_map(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE IF NOT EXISTS ai.decision_log              (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL);
CREATE TABLE IF NOT EXISTS memory.brand_fingerprint     (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL);
