-- =============================================================================
-- Brain — PostgreSQL bootstrap schema (SINGLE SOURCE OF TRUTH).
--
-- Creates the ENTIRE brain_dev OLTP schema from scratch: roles, extensions,
-- enum types, functions/procedures, 46 tables, 2 security_invoker views, all
-- indexes + constraints, RLS (ENABLE + FORCE) policies, and per-role grants.
--
-- Run as the postgres SUPERUSER against an empty database. Idempotent at the
-- ROLE/EXTENSION level; table DDL assumes a fresh DB (the startup wrapper,
-- scripts/bootstrap-db.sh, only applies this file when the sentinel table
-- public.users is absent). Replaces the retired per-migration pipeline.
--
-- Derived from the verified-healthy brain_dev schema (pg_dump --schema-only),
-- with the mig-32 security_invoker view leak fixed in-place.
-- =============================================================================

SET statement_timeout = 0;
SET client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Roles (idempotent). Application roles are NON-BYPASSRLS so FORCE RLS bites.
-- Local-dev passwords; production sets passwords out-of-band (console/secrets).
-- ---------------------------------------------------------------------------
DO $brain_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rls_app') THEN
    CREATE ROLE rls_app          WITH LOGIN PASSWORD 'rls_app_pw'          NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_core') THEN
    CREATE ROLE svc_core         WITH LOGIN PASSWORD 'svc_core_pw'         NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_ingestion') THEN
    CREATE ROLE svc_ingestion    WITH LOGIN PASSWORD 'svc_ingestion_pw'    NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_intelligence') THEN
    CREATE ROLE svc_intelligence WITH LOGIN PASSWORD 'svc_intelligence_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='svc_analytics_ro') THEN
    CREATE ROLE svc_analytics_ro WITH LOGIN PASSWORD 'svc_analytics_ro_pw' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$brain_roles$;

-- Connect + default schema USAGE. Per-table grants are emitted by the dump below.
GRANT CONNECT ON DATABASE brain_dev TO rls_app, svc_core, svc_ingestion, svc_intelligence, svc_analytics_ro;
GRANT USAGE ON SCHEMA public TO rls_app, svc_core, svc_ingestion, svc_analytics_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rls_app;

-- ============================ schema (from pg_dump) ==========================
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
--



--
--



--
-- Name: connector_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.connector_status AS ENUM (
    'NOT_CONNECTED',
    'CONNECTED',
    'TOKEN_EXPIRED',
    'ERROR',
    'DISCONNECTED'
);


ALTER TYPE public.connector_status OWNER TO postgres;

--
-- Name: customer_consent_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.customer_consent_status AS ENUM (
    'unknown',
    'opted_in',
    'opted_out',
    'withdrawn'
);


ALTER TYPE public.customer_consent_status OWNER TO postgres;

--
-- Name: goal_period_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.goal_period_type AS ENUM (
    'DAILY',
    'WEEKLY',
    'MONTHLY'
);


ALTER TYPE public.goal_period_type OWNER TO postgres;

--
-- Name: goal_unit; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.goal_unit AS ENUM (
    'mu',
    'bp',
    'count'
);


ALTER TYPE public.goal_unit OWNER TO postgres;

--
-- Name: goal_value_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.goal_value_type AS ENUM (
    'MINIMUM',
    'MAXIMUM',
    'TARGET'
);


ALTER TYPE public.goal_value_type OWNER TO postgres;

--
-- Name: invitation_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.invitation_status AS ENUM (
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'REVOKED'
);


ALTER TYPE public.invitation_status OWNER TO postgres;

--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.notification_type AS ENUM (
    'WORKSPACE_INVITE',
    'INVITE_ACCEPTED',
    'MEMBER_JOINED',
    'MEMBER_REMOVED',
    'ROLE_CHANGED',
    'CONNECTOR_CONNECTED',
    'CONNECTOR_DISCONNECTED',
    'SYNC_COMPLETED',
    'SYNC_FAILED',
    'SYSTEM'
);


ALTER TYPE public.notification_type OWNER TO postgres;

--
-- Name: store_platform; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.store_platform AS ENUM (
    'SHOPIFY',
    'WOOCOMMERCE'
);


ALTER TYPE public.store_platform OWNER TO postgres;

--
-- Name: subscription_plan; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.subscription_plan AS ENUM (
    'FREE',
    'STARTER',
    'GROWTH',
    'ENTERPRISE'
);


ALTER TYPE public.subscription_plan OWNER TO postgres;

--
-- Name: system_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.system_role AS ENUM (
    'SUPERADMIN',
    'USER'
);


ALTER TYPE public.system_role OWNER TO postgres;

--
-- Name: workspace_cost_billing_mode; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.workspace_cost_billing_mode AS ENUM (
    'MONTHLY',
    'PER_ORDER'
);


ALTER TYPE public.workspace_cost_billing_mode OWNER TO postgres;

--
-- Name: workspace_cost_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.workspace_cost_type AS ENUM (
    'SHIPPING',
    'PACKAGING',
    'WEBSITE',
    'CUSTOM'
);


ALTER TYPE public.workspace_cost_type OWNER TO postgres;

--
-- Name: workspace_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.workspace_role AS ENUM (
    'OWNER',
    'ADMIN',
    'MANAGER',
    'ANALYST',
    'VIEWER'
);


ALTER TYPE public.workspace_role OWNER TO postgres;

--
-- Name: is_order_pii_purgeable(text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_order_pii_purgeable(p_financial_status text, p_fulfillment_status text, p_cancelled_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT (
    -- Gate 1: closed financial status only
    upper(coalesce(p_financial_status, '')) NOT IN (
      'PENDING', 'PARTIALLY_PAID', 'VOIDED', ''
    )
    -- Gate 2: fulfilled (not open) fulfillment status
    AND upper(coalesce(p_fulfillment_status, '')) NOT IN (
      'UNFULFILLED', 'ON_HOLD', 'PARTIAL', ''
    )
    -- Gate 3: either explicitly cancelled OR refunded after fulfilment
    AND (
      p_cancelled_at IS NOT NULL
      OR (
        upper(coalesce(p_financial_status, '')) IN ('REFUNDED', 'PARTIALLY_REFUNDED')
        AND upper(coalesce(p_fulfillment_status, '')) = 'FULFILLED'
      )
    )
  )
$$;


ALTER FUNCTION public.is_order_pii_purgeable(p_financial_status text, p_fulfillment_status text, p_cancelled_at timestamp with time zone) OWNER TO postgres;

--
-- Name: key_destruction_ledger_worm_guard(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.key_destruction_ledger_worm_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION
    'key_destruction_ledger is append-only (WORM). Attempted % on row id=%. '
    'This table is the DPDP §12 crypto-shred evidence record and must never be modified.',
    TG_OP,
    OLD.id;
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.key_destruction_ledger_worm_guard() OWNER TO postgres;

--
-- Name: purge_closed_order_pii(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_closed_order_pii(p_workspace_id uuid, p_retention_days integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_purged INT := 0;
BEGIN
  -- Safety: never purge orders newer than retention_days.
  -- Safety: only touch the workspace passed as the argument.
  UPDATE connector_order_facts_hot
  SET
    customer_ref      = NULL,
    delivery_pincode  = NULL,
    delivery_city     = NULL,
    billing_pincode   = NULL,
    is_new_customer   = NULL
  WHERE
    workspace_id = p_workspace_id
    AND synced_at < now() - (p_retention_days || ' days')::INTERVAL
    -- Only purge orders whose lifecycle is fully closed (ruling C exemptions).
    AND is_order_pii_purgeable(financial_status, fulfillment_status, cancelled_at)
    -- Belt-and-suspenders: only purge rows that still have PII (avoid no-op updates).
    AND (
      customer_ref IS NOT NULL
      OR delivery_pincode IS NOT NULL
      OR delivery_city IS NOT NULL
      OR billing_pincode IS NOT NULL
      OR is_new_customer IS NOT NULL
    );

  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;


ALTER FUNCTION public.purge_closed_order_pii(p_workspace_id uuid, p_retention_days integer) OWNER TO postgres;

--
-- Name: run_nightly_pii_purge(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.run_nightly_pii_purge(IN p_retention_days integer DEFAULT 90)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_workspace_id  UUID;
  v_purged        INT;
BEGIN
  FOR v_workspace_id IN
    SELECT DISTINCT workspace_id
    FROM connector_order_facts_hot
    ORDER BY workspace_id
  LOOP
    BEGIN
      v_purged := purge_closed_order_pii(v_workspace_id, p_retention_days);
      INSERT INTO pii_purge_log
        (workspace_id, orders_purged, retention_days, status)
      VALUES
        (v_workspace_id, v_purged, p_retention_days, 'ok');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO pii_purge_log
        (workspace_id, orders_purged, retention_days, status, error_msg)
      VALUES
        (v_workspace_id, 0, p_retention_days, 'error', SQLERRM);
    END;
  END LOOP;
END;
$$;


ALTER PROCEDURE public.run_nightly_pii_purge(IN p_retention_days integer) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
--




--
-- Name: ai_insights; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    page text NOT NULL,
    date_from timestamp with time zone NOT NULL,
    date_to timestamp with time zone NOT NULL,
    filters_hash text NOT NULL,
    status text DEFAULT 'done'::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    provider text DEFAULT ''::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    tokens_used integer DEFAULT 0 NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.ai_insights FORCE ROW LEVEL SECURITY;


ALTER TABLE public.ai_insights OWNER TO postgres;

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    metadata jsonb,
    ip_hash text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: connector_ad_spend_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_ad_spend_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    campaign_id text NOT NULL,
    campaign_name text,
    spend_date date NOT NULL,
    spend_mu bigint NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    currency_code text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_ad_spend_facts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_ad_spend_facts OWNER TO postgres;

--
-- Name: connector_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    status public.connector_status DEFAULT 'NOT_CONNECTED'::public.connector_status NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    account_ref text,
    external_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    token_expires_at timestamp with time zone,
    connected_at timestamp with time zone,
    last_sync_at timestamp with time zone,
    last_sync_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_connections FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_connections OWNER TO postgres;

--
-- Name: connector_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_credentials (
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    credential_enc bytea NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_credentials FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_credentials OWNER TO postgres;

--
-- Name: connector_cursor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_cursor (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    cursor_value text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.connector_cursor OWNER TO postgres;

--
-- Name: connector_definitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_definitions (
    vendor text NOT NULL,
    display_name text NOT NULL,
    category text NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    oauth_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    api_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    polling_cadence_min integer DEFAULT 60 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT category_known CHECK ((category = ANY (ARRAY['ecom'::text, 'ads'::text, 'email'::text, '3pl'::text, 'payments'::text, 'crm'::text, 'attribution'::text, 'erp'::text, 'bi'::text, 'other'::text])))
);

ALTER TABLE ONLY public.connector_definitions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_definitions OWNER TO postgres;

--
-- Name: TABLE connector_definitions; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.connector_definitions IS 'Integration registry — UI / ingestion / OAuth all read this. New integration = INSERT here + ALTER enum.';


--
-- Name: COLUMN connector_definitions.capabilities; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.connector_definitions.capabilities IS 'jsonb of booleans per fact-type: { "orders": true, "line_items": true, ... }';


--
-- Name: connector_identity_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_identity_map (
    vendor text NOT NULL,
    external_identity text NOT NULL,
    workspace_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.connector_identity_map OWNER TO postgres;

--
-- Name: TABLE connector_identity_map; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.connector_identity_map IS 'System routing table: (vendor, external_identity) → workspace_id. Read system-scoped during HMAC verify (pre-workspace). No PII. No RLS (MAP-AFTER-VERIFY-1). Vendor-extensible.';


--
-- Name: connector_line_item_facts_hot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_line_item_facts_hot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    vendor_order_id text NOT NULL,
    vendor_line_id text NOT NULL,
    sku text,
    title text,
    quantity bigint NOT NULL,
    unit_price_mu bigint NOT NULL,
    gst_slab_bp integer,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_product_id text
);

ALTER TABLE ONLY public.connector_line_item_facts_hot FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_line_item_facts_hot OWNER TO postgres;

--
-- Name: connector_line_item_facts; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.connector_line_item_facts WITH (security_invoker = true) AS
 SELECT id,
    workspace_id,
    vendor,
    vendor_order_id,
    vendor_line_id,
    sku,
    title,
    quantity,
    unit_price_mu,
    gst_slab_bp,
    synced_at,
    vendor_product_id
   FROM public.connector_line_item_facts_hot;


ALTER VIEW public.connector_line_item_facts OWNER TO postgres;

--
-- Name: connector_oauth_states; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_oauth_states (
    state_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    user_id uuid NOT NULL,
    shop_domain text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_oauth_states FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_oauth_states OWNER TO postgres;

--
-- Name: connector_order_facts_hot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_order_facts_hot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    vendor_order_id text NOT NULL,
    order_number text,
    financial_status text,
    fulfillment_status text,
    payment_method text,
    currency_code text NOT NULL,
    gross_sales_mu bigint NOT NULL,
    total_discount_mu bigint NOT NULL,
    total_tax_mu bigint NOT NULL,
    shipping_mu bigint DEFAULT 0 NOT NULL,
    customer_ref text,
    is_new_customer boolean,
    delivery_pincode text,
    delivery_city text,
    processed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_pincode text,
    is_cod boolean,
    order_type text,
    total_refund_mu bigint DEFAULT 0 NOT NULL,
    raw_event_id text,
    provenance text DEFAULT 'legacy_etl'::text
);

ALTER TABLE ONLY public.connector_order_facts_hot FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_order_facts_hot OWNER TO postgres;

--
-- Name: connector_order_facts; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.connector_order_facts WITH (security_invoker = true) AS
 SELECT id,
    workspace_id,
    vendor,
    vendor_order_id,
    order_number,
    financial_status,
    fulfillment_status,
    payment_method,
    currency_code,
    gross_sales_mu,
    total_discount_mu,
    total_tax_mu,
    shipping_mu,
    customer_ref,
    is_new_customer,
    delivery_pincode,
    delivery_city,
    processed_at,
    cancelled_at,
    synced_at,
    billing_pincode,
    is_cod,
    order_type,
    total_refund_mu
   FROM public.connector_order_facts_hot;


ALTER VIEW public.connector_order_facts OWNER TO postgres;

--
-- Name: connector_product_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_product_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    vendor_product_id text NOT NULL,
    title text,
    product_type text,
    status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_mu bigint,
    mrp_mu bigint,
    inventory_qty integer,
    handle text,
    image_url text,
    tags text[] DEFAULT '{}'::text[] NOT NULL
);

ALTER TABLE ONLY public.connector_product_facts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_product_facts OWNER TO postgres;

--
-- Name: connector_refund_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_refund_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    vendor_order_id text NOT NULL,
    vendor_refund_id text NOT NULL,
    vendor_refund_line_id text NOT NULL,
    sku text,
    quantity bigint,
    subtotal_mu bigint,
    tax_mu bigint,
    processed_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_product_id text
);

ALTER TABLE ONLY public.connector_refund_facts FORCE ROW LEVEL SECURITY;


ALTER TABLE public.connector_refund_facts OWNER TO postgres;

--
-- Name: connector_shipment_facts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_shipment_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    vendor_shipment_id text NOT NULL,
    vendor_order_ref text,
    status text,
    status_bucket text,
    is_cod boolean,
    cod_amount_mu bigint,
    shipping_charges_mu bigint,
    courier_name text,
    delivery_pincode text,
    delivery_city text,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    rto_initiated_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.connector_shipment_facts OWNER TO postgres;

--
-- Name: connector_vendors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connector_vendors (
    code text NOT NULL,
    archetype text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.connector_vendors OWNER TO postgres;

--
-- Name: TABLE connector_vendors; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.connector_vendors IS 'Registry of known vendor codes.  Adding a new vendor = INSERT one row here; no ALTER TYPE, no code change.  archetype mirrors connector_definitions.category.';


--
-- Name: COLUMN connector_vendors.code; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.connector_vendors.code IS 'Upper-case vendor identifier — matches connector_vendor enum values 1:1.';


--
-- Name: customer_pii; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_pii (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    customer_ref text NOT NULL,
    source_vendor text NOT NULL,
    vendor_customer_id text NOT NULL,
    email_ct bytea,
    phone_ct bytea,
    full_name_ct bytea,
    first_seen_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    orders_count integer DEFAULT 0 NOT NULL,
    lifetime_spent_mu bigint DEFAULT 0 NOT NULL,
    currency_code text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    consent_status public.customer_consent_status DEFAULT 'unknown'::public.customer_consent_status NOT NULL,
    consent_recorded_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    tombstoned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email_hash text,
    phone_hash text,
    salt_version text,
    identity_cluster_id uuid
);

ALTER TABLE ONLY public.customer_pii FORCE ROW LEVEL SECURITY;


ALTER TABLE public.customer_pii OWNER TO postgres;

--
-- Name: identity_cluster_edges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.identity_cluster_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    node_a text NOT NULL,
    node_b text NOT NULL,
    match_key_type text NOT NULL,
    raw_event_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edge_normalized_order CHECK ((node_a <= node_b)),
    CONSTRAINT identity_cluster_edges_match_key_type_check CHECK ((match_key_type = ANY (ARRAY['email_hash'::text, 'phone_hash'::text, 'both'::text])))
);

ALTER TABLE ONLY public.identity_cluster_edges FORCE ROW LEVEL SECURITY;


ALTER TABLE public.identity_cluster_edges OWNER TO postgres;

--
-- Name: identity_cluster_registry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.identity_cluster_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    min_label text NOT NULL,
    cluster_id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.identity_cluster_registry FORCE ROW LEVEL SECURITY;


ALTER TABLE public.identity_cluster_registry OWNER TO postgres;

--
-- Name: invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role public.workspace_role DEFAULT 'VIEWER'::public.workspace_role NOT NULL,
    status public.invitation_status DEFAULT 'PENDING'::public.invitation_status NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    invited_by_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;


ALTER TABLE public.invitations OWNER TO postgres;

--
-- Name: key_destruction_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.key_destruction_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    erasure_id uuid NOT NULL,
    dek_key_id text NOT NULL,
    destroyed_at timestamp with time zone DEFAULT now() NOT NULL,
    tier text NOT NULL,
    outcome text DEFAULT 'destroyed'::text NOT NULL,
    error_detail text,
    vault_backend text DEFAULT 'local_aesgcm'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT key_destruction_ledger_outcome_check CHECK ((outcome = ANY (ARRAY['destroyed'::text, 'already_destroyed'::text, 'not_found'::text, 'error'::text]))),
    CONSTRAINT key_destruction_ledger_tier_check CHECK ((tier = ANY (ARRAY['s3_raw'::text, 'glacier'::text, 'customer_pii_ct'::text])))
);


ALTER TABLE public.key_destruction_ledger OWNER TO postgres;

--
-- Name: marketing_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.marketing_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    action_date date NOT NULL,
    action_type text NOT NULL,
    action_name text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.marketing_actions FORCE ROW LEVEL SECURITY;


ALTER TABLE public.marketing_actions OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid,
    type public.notification_type NOT NULL,
    title text NOT NULL,
    body text,
    action_url text,
    read boolean DEFAULT false NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: pii_purge_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pii_purge_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    orders_purged integer DEFAULT 0 NOT NULL,
    retention_days integer DEFAULT 90 NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    error_msg text,
    zero_row_webhook_updates integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.pii_purge_log OWNER TO postgres;

--
-- Name: raw_event_transform_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_event_transform_state (
    workspace_id uuid NOT NULL,
    vendor text NOT NULL,
    event_type text NOT NULL,
    last_processed_received_at timestamp with time zone,
    last_processed_idempotency_key text,
    status text DEFAULT 'idle'::text NOT NULL,
    error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT raw_event_transform_state_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'errored'::text])))
);


ALTER TABLE public.raw_event_transform_state OWNER TO postgres;

--
-- Name: raw_google_ads_daily; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_google_ads_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'google'::text NOT NULL,
    event_type text DEFAULT 'ads_daily'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    campaign_id text,
    ad_group_id text,
    date_day date,
    impressions integer,
    clicks integer,
    cost_micros_raw text,
    currency text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_google_ads_daily_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_google_ads_daily_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_google_ads_daily OWNER TO postgres;

--
-- Name: raw_klaviyo_email_performance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_klaviyo_email_performance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'klaviyo'::text NOT NULL,
    event_type text DEFAULT 'email_performance'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    campaign_id text,
    campaign_name text,
    date_day date,
    delivered integer,
    unique_opens integer,
    unique_clicks integer,
    placed_order_count integer,
    unsubscribe_count integer,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_klaviyo_email_performance_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_klaviyo_email_performance_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_klaviyo_email_performance OWNER TO postgres;

--
-- Name: raw_meta_ads_daily; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_meta_ads_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'meta'::text NOT NULL,
    event_type text DEFAULT 'ads_daily'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    campaign_id text,
    adset_id text,
    ad_id text,
    date_start date,
    date_stop date,
    impressions integer,
    clicks integer,
    spend_raw text,
    currency text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_meta_ads_daily_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_meta_ads_daily_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_meta_ads_daily OWNER TO postgres;

--
-- Name: raw_shiprocket_shipments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_shiprocket_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'shiprocket'::text NOT NULL,
    event_type text DEFAULT 'shipment'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    shipment_id text NOT NULL,
    order_id text,
    status text,
    courier_name text,
    delivery_pincode text,
    delivery_city text,
    delivery_state text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_shiprocket_shipments_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_shiprocket_shipments_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_shiprocket_shipments OWNER TO postgres;

--
-- Name: raw_shopify_customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_shopify_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'shopify'::text NOT NULL,
    event_type text DEFAULT 'customer'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    shopify_customer_id text NOT NULL,
    email text,
    first_name text,
    last_name text,
    orders_count integer,
    total_spent_raw text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_shopify_customers_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_shopify_customers_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_shopify_customers OWNER TO postgres;

--
-- Name: raw_shopify_line_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_shopify_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'shopify'::text NOT NULL,
    event_type text DEFAULT 'line_item'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    shopify_order_id text NOT NULL,
    line_item_id text NOT NULL,
    product_id text,
    variant_id text,
    sku text,
    title text,
    quantity integer,
    price_raw text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_shopify_line_items_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_shopify_line_items_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_shopify_line_items OWNER TO postgres;

--
-- Name: raw_shopify_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_shopify_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'shopify'::text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    shopify_order_id text NOT NULL,
    order_number text,
    financial_status text,
    fulfillment_status text,
    email text,
    first_name text,
    last_name text,
    total_price text,
    subtotal_price text,
    total_discounts text,
    total_tax text,
    total_price_raw text,
    currency text,
    created_at text,
    updated_at text,
    closed_at text,
    cancelled_at text,
    tags text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_shopify_orders_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_shopify_orders_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_shopify_orders OWNER TO postgres;

--
-- Name: raw_shopify_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_shopify_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'shopify'::text NOT NULL,
    event_type text DEFAULT 'product'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    shopify_product_id text NOT NULL,
    title text,
    product_type text,
    status text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_shopify_products_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_shopify_products_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_shopify_products OWNER TO postgres;

--
-- Name: raw_unicommerce_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_unicommerce_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'unicommerce'::text NOT NULL,
    event_type text DEFAULT 'product'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    sku_code text,
    item_type_sku text,
    category text,
    mrp_raw text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_unicommerce_products_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_unicommerce_products_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_unicommerce_products OWNER TO postgres;

--
-- Name: raw_woocommerce_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_woocommerce_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lawful_basis text NOT NULL,
    purpose_code text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_event_id text NOT NULL,
    vendor text DEFAULT 'woocommerce'::text NOT NULL,
    event_type text DEFAULT 'order'::text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    woo_order_id text NOT NULL,
    status text,
    customer_email text,
    customer_phone text,
    billing_first_name text,
    billing_last_name text,
    billing_city text,
    billing_state text,
    billing_postcode text,
    shipping_first_name text,
    shipping_last_name text,
    shipping_city text,
    shipping_state text,
    shipping_postcode text,
    total_raw text,
    currency text,
    raw_payload jsonb NOT NULL,
    CONSTRAINT raw_woocommerce_orders_lawful_basis_check CHECK ((lawful_basis = ANY (ARRAY['owner_brand_controller'::text, 'data_principal_consent'::text, 'legitimate_interest'::text]))),
    CONSTRAINT raw_woocommerce_orders_purpose_code_check CHECK ((purpose_code = ANY (ARRAY['analytics_performance'::text, 'logistics_tracking'::text, 'email_performance'::text, 'catalog_sync'::text])))
);


ALTER TABLE public.raw_woocommerce_orders OWNER TO postgres;

--
-- Name: subject_erasure_request; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject_erasure_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    customer_ref text NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    notice_window_ends_at timestamp with time zone NOT NULL,
    executed_at timestamp with time zone,
    count_zero_verified_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    failure_reason text,
    requested_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notice_window_is_48h CHECK ((notice_window_ends_at = (requested_at + '48:00:00'::interval))),
    CONSTRAINT subject_erasure_request_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'notice_window_ended'::text, 'executing'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.subject_erasure_request OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    job_role text,
    system_role public.system_role DEFAULT 'USER'::public.system_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: workspace_ad_campaign_classifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_ad_campaign_classifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    platform text NOT NULL,
    campaign_id text NOT NULL,
    intent text NOT NULL,
    campaign_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_ad_campaign_classifications FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_ad_campaign_classifications OWNER TO postgres;

--
-- Name: workspace_cogs_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_cogs_settings (
    workspace_id uuid NOT NULL,
    override_all_cogs_bp integer DEFAULT 0 NOT NULL,
    fallback_cogs_bp integer DEFAULT 0 NOT NULL,
    cogs_markup_bp integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_cogs_settings FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_cogs_settings OWNER TO postgres;

--
-- Name: workspace_costs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    cost_type public.workspace_cost_type NOT NULL,
    name text,
    amount_mu bigint NOT NULL,
    is_percent boolean DEFAULT false NOT NULL,
    currency_code text,
    billing_mode public.workspace_cost_billing_mode DEFAULT 'MONTHLY'::public.workspace_cost_billing_mode NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_costs FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_costs OWNER TO postgres;

--
-- Name: workspace_festivals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_festivals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    color text DEFAULT '#F59E0B'::text NOT NULL,
    expected_multiplier_bp integer DEFAULT 15000 NOT NULL,
    regions text[] DEFAULT '{}'::text[] NOT NULL,
    categories text[] DEFAULT '{}'::text[] NOT NULL,
    is_template boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_festivals FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_festivals OWNER TO postgres;

--
-- Name: workspace_identity_salt; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_identity_salt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    salt_version text NOT NULL,
    salt_enc bytea,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deactivated_at timestamp with time zone
);

ALTER TABLE ONLY public.workspace_identity_salt FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_identity_salt OWNER TO postgres;

--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.workspace_role DEFAULT 'VIEWER'::public.workspace_role NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_members FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_members OWNER TO postgres;

--
-- Name: workspace_metric_goals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_metric_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    metric_name text NOT NULL,
    period_type public.goal_period_type NOT NULL,
    period_start date NOT NULL,
    goal_value bigint NOT NULL,
    goal_unit public.goal_unit NOT NULL,
    goal_type public.goal_value_type NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_metric_goals FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_metric_goals OWNER TO postgres;

--
-- Name: workspace_misc_expenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspace_misc_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    amount_mu bigint NOT NULL,
    currency_code text DEFAULT 'INR'::text NOT NULL,
    effective_start_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_misc_expenses FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspace_misc_expenses OWNER TO postgres;

--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    industry text,
    monthly_revenue text,
    store_url text,
    platform public.store_platform DEFAULT 'SHOPIFY'::public.store_platform NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    logo_url text,
    plan public.subscription_plan DEFAULT 'FREE'::public.subscription_plan NOT NULL,
    tax_percent_bp integer DEFAULT 0 NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    founder_salary_currency text,
    founder_salary_monthly_mu bigint,
    skip_zero_sales_orders boolean DEFAULT false NOT NULL,
    skipped_shopify_order_tags text[] DEFAULT '{}'::text[] NOT NULL,
    product_data_source text DEFAULT 'SHOPIFY'::text NOT NULL,
    multi_currency_blocked boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.workspaces FORCE ROW LEVEL SECURITY;


ALTER TABLE public.workspaces OWNER TO postgres;

--
-- Name: COLUMN workspaces.multi_currency_blocked; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.workspaces.multi_currency_blocked IS 'TRUE when the workspace has orders in more than one currency code. When TRUE, CM1/CM2/CM3 are BLOCKED (NULL) for that workspace because summing AED+INR is arithmetically invalid. Set by the nightly check_multi_currency_drift job (P1-A). Ruling G: multi-currency CM guard.';


--
--



--
-- Name: ai_insights ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_workspace_id_vendor_campaign_id_sp_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_workspace_id_vendor_campaign_id_sp_key UNIQUE (workspace_id, vendor, campaign_id, spend_date);


--
-- Name: connector_connections connector_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_pkey PRIMARY KEY (id);


--
-- Name: connector_connections connector_connections_workspace_id_vendor_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_workspace_id_vendor_key UNIQUE (workspace_id, vendor);


--
-- Name: connector_credentials connector_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_pkey PRIMARY KEY (workspace_id, vendor);


--
-- Name: connector_cursor connector_cursor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_cursor
    ADD CONSTRAINT connector_cursor_pkey PRIMARY KEY (id);


--
-- Name: connector_cursor connector_cursor_workspace_id_vendor_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_cursor
    ADD CONSTRAINT connector_cursor_workspace_id_vendor_key UNIQUE (workspace_id, vendor);


--
-- Name: connector_definitions connector_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_definitions
    ADD CONSTRAINT connector_definitions_pkey PRIMARY KEY (vendor);


--
-- Name: connector_identity_map connector_identity_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_identity_map
    ADD CONSTRAINT connector_identity_map_pkey PRIMARY KEY (vendor, external_identity);


--
-- Name: connector_line_item_facts_hot connector_line_item_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_line_item_facts_hot
    ADD CONSTRAINT connector_line_item_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_line_item_facts_hot connector_line_item_facts_workspace_id_vendor_vendor_order__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_line_item_facts_hot
    ADD CONSTRAINT connector_line_item_facts_workspace_id_vendor_vendor_order__key UNIQUE (workspace_id, vendor, vendor_order_id, vendor_line_id);


--
-- Name: connector_oauth_states connector_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_oauth_states
    ADD CONSTRAINT connector_oauth_states_pkey PRIMARY KEY (state_hash);


--
-- Name: connector_order_facts_hot connector_order_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_order_facts_hot
    ADD CONSTRAINT connector_order_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_order_facts_hot connector_order_facts_workspace_id_vendor_vendor_order_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_order_facts_hot
    ADD CONSTRAINT connector_order_facts_workspace_id_vendor_vendor_order_id_key UNIQUE (workspace_id, vendor, vendor_order_id);


--
-- Name: connector_product_facts connector_product_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_product_facts connector_product_facts_workspace_id_vendor_vendor_product__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_workspace_id_vendor_vendor_product__key UNIQUE (workspace_id, vendor, vendor_product_id);


--
-- Name: connector_refund_facts connector_refund_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_refund_facts connector_refund_facts_workspace_id_vendor_vendor_refund_li_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_workspace_id_vendor_vendor_refund_li_key UNIQUE (workspace_id, vendor, vendor_refund_line_id);


--
-- Name: connector_shipment_facts connector_shipment_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_shipment_facts connector_shipment_facts_ws_vendor_ship_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_ws_vendor_ship_key UNIQUE (workspace_id, vendor, vendor_shipment_id);


--
-- Name: connector_vendors connector_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_vendors
    ADD CONSTRAINT connector_vendors_pkey PRIMARY KEY (code);


--
-- Name: customer_pii customer_pii_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_pii
    ADD CONSTRAINT customer_pii_pkey PRIMARY KEY (id);


--
-- Name: customer_pii customer_pii_workspace_id_customer_ref_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_pii
    ADD CONSTRAINT customer_pii_workspace_id_customer_ref_key UNIQUE (workspace_id, customer_ref);


--
-- Name: customer_pii customer_pii_workspace_id_source_vendor_vendor_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_pii
    ADD CONSTRAINT customer_pii_workspace_id_source_vendor_vendor_customer_id_key UNIQUE (workspace_id, source_vendor, vendor_customer_id);


--
-- Name: identity_cluster_edges identity_cluster_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_edges
    ADD CONSTRAINT identity_cluster_edges_pkey PRIMARY KEY (id);


--
-- Name: identity_cluster_edges identity_cluster_edges_workspace_id_node_a_node_b_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_edges
    ADD CONSTRAINT identity_cluster_edges_workspace_id_node_a_node_b_key UNIQUE (workspace_id, node_a, node_b);


--
-- Name: identity_cluster_registry identity_cluster_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_registry
    ADD CONSTRAINT identity_cluster_registry_pkey PRIMARY KEY (id);


--
-- Name: identity_cluster_registry identity_cluster_registry_workspace_id_min_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_registry
    ADD CONSTRAINT identity_cluster_registry_workspace_id_min_label_key UNIQUE (workspace_id, min_label);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: key_destruction_ledger key_destruction_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.key_destruction_ledger
    ADD CONSTRAINT key_destruction_ledger_pkey PRIMARY KEY (id);


--
-- Name: marketing_actions marketing_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.marketing_actions
    ADD CONSTRAINT marketing_actions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: subject_erasure_request one_active_erasure_per_subject; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_erasure_request
    ADD CONSTRAINT one_active_erasure_per_subject UNIQUE NULLS NOT DISTINCT (workspace_id, customer_ref, status);


--
-- Name: pii_purge_log pii_purge_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pii_purge_log
    ADD CONSTRAINT pii_purge_log_pkey PRIMARY KEY (id);


--
-- Name: raw_event_transform_state raw_event_transform_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_event_transform_state
    ADD CONSTRAINT raw_event_transform_state_pkey PRIMARY KEY (workspace_id, vendor, event_type);


--
-- Name: raw_google_ads_daily raw_google_ads_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_google_ads_daily
    ADD CONSTRAINT raw_google_ads_daily_pkey PRIMARY KEY (id);


--
-- Name: raw_google_ads_daily raw_google_ads_daily_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_google_ads_daily
    ADD CONSTRAINT raw_google_ads_daily_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_klaviyo_email_performance raw_klaviyo_email_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_klaviyo_email_performance
    ADD CONSTRAINT raw_klaviyo_email_performance_pkey PRIMARY KEY (id);


--
-- Name: raw_klaviyo_email_performance raw_klaviyo_email_performance_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_klaviyo_email_performance
    ADD CONSTRAINT raw_klaviyo_email_performance_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_meta_ads_daily raw_meta_ads_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_meta_ads_daily
    ADD CONSTRAINT raw_meta_ads_daily_pkey PRIMARY KEY (id);


--
-- Name: raw_meta_ads_daily raw_meta_ads_daily_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_meta_ads_daily
    ADD CONSTRAINT raw_meta_ads_daily_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_shiprocket_shipments raw_shiprocket_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shiprocket_shipments
    ADD CONSTRAINT raw_shiprocket_shipments_pkey PRIMARY KEY (id);


--
-- Name: raw_shiprocket_shipments raw_shiprocket_shipments_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shiprocket_shipments
    ADD CONSTRAINT raw_shiprocket_shipments_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_shopify_customers raw_shopify_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_customers
    ADD CONSTRAINT raw_shopify_customers_pkey PRIMARY KEY (id);


--
-- Name: raw_shopify_customers raw_shopify_customers_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_customers
    ADD CONSTRAINT raw_shopify_customers_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_shopify_line_items raw_shopify_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_line_items
    ADD CONSTRAINT raw_shopify_line_items_pkey PRIMARY KEY (id);


--
-- Name: raw_shopify_line_items raw_shopify_line_items_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_line_items
    ADD CONSTRAINT raw_shopify_line_items_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_shopify_orders raw_shopify_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_orders
    ADD CONSTRAINT raw_shopify_orders_pkey PRIMARY KEY (id);


--
-- Name: raw_shopify_orders raw_shopify_orders_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_orders
    ADD CONSTRAINT raw_shopify_orders_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_shopify_products raw_shopify_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_products
    ADD CONSTRAINT raw_shopify_products_pkey PRIMARY KEY (id);


--
-- Name: raw_shopify_products raw_shopify_products_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_shopify_products
    ADD CONSTRAINT raw_shopify_products_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_unicommerce_products raw_unicommerce_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_unicommerce_products
    ADD CONSTRAINT raw_unicommerce_products_pkey PRIMARY KEY (id);


--
-- Name: raw_unicommerce_products raw_unicommerce_products_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_unicommerce_products
    ADD CONSTRAINT raw_unicommerce_products_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: raw_woocommerce_orders raw_woocommerce_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_woocommerce_orders
    ADD CONSTRAINT raw_woocommerce_orders_pkey PRIMARY KEY (id);


--
-- Name: raw_woocommerce_orders raw_woocommerce_orders_workspace_id_vendor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_woocommerce_orders
    ADD CONSTRAINT raw_woocommerce_orders_workspace_id_vendor_event_id_key UNIQUE (workspace_id, vendor_event_id);


--
-- Name: subject_erasure_request subject_erasure_request_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_erasure_request
    ADD CONSTRAINT subject_erasure_request_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_ad_campaign_classifications workspace_ad_campaign_classif_workspace_id_platform_campaig_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_ad_campaign_classifications
    ADD CONSTRAINT workspace_ad_campaign_classif_workspace_id_platform_campaig_key UNIQUE (workspace_id, platform, campaign_id);


--
-- Name: workspace_ad_campaign_classifications workspace_ad_campaign_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_ad_campaign_classifications
    ADD CONSTRAINT workspace_ad_campaign_classifications_pkey PRIMARY KEY (id);


--
-- Name: workspace_cogs_settings workspace_cogs_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_cogs_settings
    ADD CONSTRAINT workspace_cogs_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_costs workspace_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_costs
    ADD CONSTRAINT workspace_costs_pkey PRIMARY KEY (id);


--
-- Name: workspace_festivals workspace_festivals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_festivals
    ADD CONSTRAINT workspace_festivals_pkey PRIMARY KEY (id);


--
-- Name: workspace_festivals workspace_festivals_workspace_id_name_start_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_festivals
    ADD CONSTRAINT workspace_festivals_workspace_id_name_start_date_key UNIQUE (workspace_id, name, start_date);


--
-- Name: workspace_identity_salt workspace_identity_salt_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_identity_salt
    ADD CONSTRAINT workspace_identity_salt_pkey PRIMARY KEY (id);


--
-- Name: workspace_identity_salt workspace_identity_salt_workspace_id_salt_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_identity_salt
    ADD CONSTRAINT workspace_identity_salt_workspace_id_salt_version_key UNIQUE (workspace_id, salt_version);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_user_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_workspace_id_key UNIQUE (user_id, workspace_id);


--
-- Name: workspace_metric_goals workspace_metric_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_metric_goals
    ADD CONSTRAINT workspace_metric_goals_pkey PRIMARY KEY (id);


--
-- Name: workspace_metric_goals workspace_metric_goals_workspace_id_metric_name_period_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_metric_goals
    ADD CONSTRAINT workspace_metric_goals_workspace_id_metric_name_period_type_key UNIQUE (workspace_id, metric_name, period_type, period_start);


--
-- Name: workspace_misc_expenses workspace_misc_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_misc_expenses
    ADD CONSTRAINT workspace_misc_expenses_pkey PRIMARY KEY (id);


--
-- Name: workspace_misc_expenses workspace_misc_expenses_workspace_id_name_effective_start_d_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_misc_expenses
    ADD CONSTRAINT workspace_misc_expenses_workspace_id_name_effective_start_d_key UNIQUE (workspace_id, name, effective_start_date);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: ai_insights_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_insights_expires_idx ON public.ai_insights USING btree (expires_at);


--
-- Name: ai_insights_ws_page_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ai_insights_ws_page_idx ON public.ai_insights USING btree (workspace_id, page, date_from, date_to);


--
-- Name: audit_log_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_user_idx ON public.audit_log USING btree (user_id, created_at DESC);


--
-- Name: audit_log_ws_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX audit_log_ws_idx ON public.audit_log USING btree (workspace_id, created_at DESC);


--
-- Name: connector_ad_spend_facts_ws_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_ad_spend_facts_ws_date_idx ON public.connector_ad_spend_facts USING btree (workspace_id, spend_date);


--
-- Name: connector_connections_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_connections_workspace_idx ON public.connector_connections USING btree (workspace_id);


--
-- Name: connector_cursor_ws_vendor_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_cursor_ws_vendor_idx ON public.connector_cursor USING btree (workspace_id, vendor);


--
-- Name: connector_line_item_facts_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_line_item_facts_order_idx ON public.connector_line_item_facts_hot USING btree (workspace_id, vendor, vendor_order_id);


--
-- Name: connector_line_item_facts_product_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_line_item_facts_product_idx ON public.connector_line_item_facts_hot USING btree (workspace_id, vendor, vendor_product_id);


--
-- Name: connector_oauth_states_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_oauth_states_expires_idx ON public.connector_oauth_states USING btree (expires_at);


--
-- Name: connector_oauth_states_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_oauth_states_workspace_idx ON public.connector_oauth_states USING btree (workspace_id);


--
-- Name: connector_order_facts_hot_raw_event_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_order_facts_hot_raw_event_id_idx ON public.connector_order_facts_hot USING btree (raw_event_id) WHERE (raw_event_id IS NOT NULL);


--
-- Name: connector_order_facts_ws_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_order_facts_ws_idx ON public.connector_order_facts_hot USING btree (workspace_id, processed_at);


--
-- Name: connector_refund_facts_prod_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_refund_facts_prod_idx ON public.connector_refund_facts USING btree (workspace_id, vendor_product_id);


--
-- Name: connector_shipment_facts_ws_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX connector_shipment_facts_ws_idx ON public.connector_shipment_facts USING btree (workspace_id, shipped_at);


--
-- Name: customer_pii_cluster_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_pii_cluster_id_idx ON public.customer_pii USING btree (workspace_id, identity_cluster_id) WHERE (identity_cluster_id IS NOT NULL);


--
-- Name: customer_pii_email_hash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_pii_email_hash_idx ON public.customer_pii USING btree (workspace_id, email_hash) WHERE (email_hash IS NOT NULL);


--
-- Name: customer_pii_phone_hash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_pii_phone_hash_idx ON public.customer_pii USING btree (workspace_id, phone_hash) WHERE (phone_hash IS NOT NULL);


--
-- Name: customer_pii_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX customer_pii_workspace_idx ON public.customer_pii USING btree (workspace_id, last_seen_at DESC);


--
-- Name: ice_workspace_node_a_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ice_workspace_node_a_idx ON public.identity_cluster_edges USING btree (workspace_id, node_a);


--
-- Name: ice_workspace_node_b_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ice_workspace_node_b_idx ON public.identity_cluster_edges USING btree (workspace_id, node_b);


--
-- Name: icr_workspace_cluster_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX icr_workspace_cluster_idx ON public.identity_cluster_registry USING btree (workspace_id, cluster_id);


--
-- Name: icr_workspace_min_label_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX icr_workspace_min_label_idx ON public.identity_cluster_registry USING btree (workspace_id, min_label);


--
-- Name: idx_raw_event_transform_state_ws; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_raw_event_transform_state_ws ON public.raw_event_transform_state USING btree (workspace_id, vendor, event_type);


--
-- Name: invitations_token_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invitations_token_idx ON public.invitations USING btree (token);


--
-- Name: invitations_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invitations_workspace_idx ON public.invitations USING btree (workspace_id);


--
-- Name: kdl_dek_key_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX kdl_dek_key_id_idx ON public.key_destruction_ledger USING btree (dek_key_id);


--
-- Name: kdl_erasure_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX kdl_erasure_idx ON public.key_destruction_ledger USING btree (erasure_id);


--
-- Name: marketing_actions_ws_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX marketing_actions_ws_date_idx ON public.marketing_actions USING btree (workspace_id, action_date);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, read, created_at DESC);


--
-- Name: notifications_ws_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX notifications_ws_idx ON public.notifications USING btree (workspace_id, created_at DESC);


--
-- Name: pii_purge_log_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX pii_purge_log_workspace_idx ON public.pii_purge_log USING btree (workspace_id, run_at DESC);


--
-- Name: raw_google_ads_daily_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_google_ads_daily_ws_ingested_idx ON public.raw_google_ads_daily USING btree (workspace_id, ingested_at);


--
-- Name: raw_klaviyo_email_performance_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_klaviyo_email_performance_ws_ingested_idx ON public.raw_klaviyo_email_performance USING btree (workspace_id, ingested_at);


--
-- Name: raw_meta_ads_daily_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_meta_ads_daily_ws_ingested_idx ON public.raw_meta_ads_daily USING btree (workspace_id, ingested_at);


--
-- Name: raw_shiprocket_shipments_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_shiprocket_shipments_ws_ingested_idx ON public.raw_shiprocket_shipments USING btree (workspace_id, ingested_at);


--
-- Name: raw_shopify_customers_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_shopify_customers_ws_ingested_idx ON public.raw_shopify_customers USING btree (workspace_id, ingested_at);


--
-- Name: raw_shopify_line_items_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_shopify_line_items_ws_ingested_idx ON public.raw_shopify_line_items USING btree (workspace_id, ingested_at);


--
-- Name: raw_shopify_orders_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_shopify_orders_ws_ingested_idx ON public.raw_shopify_orders USING btree (workspace_id, ingested_at);


--
-- Name: raw_shopify_products_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_shopify_products_ws_ingested_idx ON public.raw_shopify_products USING btree (workspace_id, ingested_at);


--
-- Name: raw_unicommerce_products_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_unicommerce_products_ws_ingested_idx ON public.raw_unicommerce_products USING btree (workspace_id, ingested_at);


--
-- Name: raw_woocommerce_orders_ws_ingested_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX raw_woocommerce_orders_ws_ingested_idx ON public.raw_woocommerce_orders USING btree (workspace_id, ingested_at);


--
-- Name: ser_customer_ref_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ser_customer_ref_idx ON public.subject_erasure_request USING btree (workspace_id, customer_ref);


--
-- Name: ser_workspace_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ser_workspace_status_idx ON public.subject_erasure_request USING btree (workspace_id, status, requested_at DESC);


--
-- Name: wis_workspace_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX wis_workspace_active_idx ON public.workspace_identity_salt USING btree (workspace_id, is_active) WHERE (is_active = true);


--
-- Name: wis_workspace_one_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX wis_workspace_one_active_idx ON public.workspace_identity_salt USING btree (workspace_id) WHERE (is_active = true);


--
-- Name: workspace_costs_ws_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workspace_costs_ws_idx ON public.workspace_costs USING btree (workspace_id, cost_type, effective_from, effective_to);


--
-- Name: workspace_festivals_ws_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workspace_festivals_ws_date_idx ON public.workspace_festivals USING btree (workspace_id, start_date);


--
-- Name: workspace_members_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);


--
-- Name: workspace_members_workspace_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX workspace_members_workspace_idx ON public.workspace_members USING btree (workspace_id);


--
-- Name: key_destruction_ledger kdl_worm_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER kdl_worm_guard BEFORE DELETE OR UPDATE ON public.key_destruction_ledger FOR EACH ROW EXECUTE FUNCTION public.key_destruction_ledger_worm_guard();


--
-- Name: ai_insights ai_insights_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_log audit_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_connections connector_connections_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_connections connector_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_credentials connector_credentials_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_credentials connector_credentials_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_definitions connector_definitions_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_definitions
    ADD CONSTRAINT connector_definitions_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_line_item_facts_hot connector_line_item_facts_hot_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_line_item_facts_hot
    ADD CONSTRAINT connector_line_item_facts_hot_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_line_item_facts_hot connector_line_item_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_line_item_facts_hot
    ADD CONSTRAINT connector_line_item_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_oauth_states connector_oauth_states_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_oauth_states
    ADD CONSTRAINT connector_oauth_states_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_oauth_states connector_oauth_states_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_oauth_states
    ADD CONSTRAINT connector_oauth_states_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_order_facts_hot connector_order_facts_hot_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_order_facts_hot
    ADD CONSTRAINT connector_order_facts_hot_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_order_facts_hot connector_order_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_order_facts_hot
    ADD CONSTRAINT connector_order_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_product_facts connector_product_facts_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_product_facts connector_product_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_refund_facts connector_refund_facts_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_vendor_fk FOREIGN KEY (vendor) REFERENCES public.connector_vendors(code);


--
-- Name: connector_shipment_facts connector_shipment_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: customer_pii customer_pii_source_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_pii
    ADD CONSTRAINT customer_pii_source_vendor_fk FOREIGN KEY (source_vendor) REFERENCES public.connector_vendors(code);


--
-- Name: customer_pii customer_pii_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_pii
    ADD CONSTRAINT customer_pii_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: identity_cluster_edges identity_cluster_edges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_edges
    ADD CONSTRAINT identity_cluster_edges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: identity_cluster_registry identity_cluster_registry_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identity_cluster_registry
    ADD CONSTRAINT identity_cluster_registry_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_id_fkey FOREIGN KEY (invited_by_id) REFERENCES public.users(id);


--
-- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: key_destruction_ledger key_destruction_ledger_erasure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.key_destruction_ledger
    ADD CONSTRAINT key_destruction_ledger_erasure_id_fkey FOREIGN KEY (erasure_id) REFERENCES public.subject_erasure_request(id) ON DELETE RESTRICT;


--
-- Name: marketing_actions marketing_actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.marketing_actions
    ADD CONSTRAINT marketing_actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_actions marketing_actions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.marketing_actions
    ADD CONSTRAINT marketing_actions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: raw_event_transform_state raw_event_transform_state_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.raw_event_transform_state
    ADD CONSTRAINT raw_event_transform_state_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subject_erasure_request subject_erasure_request_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_erasure_request
    ADD CONSTRAINT subject_erasure_request_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subject_erasure_request subject_erasure_request_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_erasure_request
    ADD CONSTRAINT subject_erasure_request_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: workspace_ad_campaign_classifications workspace_ad_campaign_classifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_ad_campaign_classifications
    ADD CONSTRAINT workspace_ad_campaign_classifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_cogs_settings workspace_cogs_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_cogs_settings
    ADD CONSTRAINT workspace_cogs_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_costs workspace_costs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_costs
    ADD CONSTRAINT workspace_costs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_festivals workspace_festivals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_festivals
    ADD CONSTRAINT workspace_festivals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_identity_salt workspace_identity_salt_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_identity_salt
    ADD CONSTRAINT workspace_identity_salt_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_metric_goals workspace_metric_goals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_metric_goals
    ADD CONSTRAINT workspace_metric_goals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_misc_expenses workspace_misc_expenses_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspace_misc_expenses
    ADD CONSTRAINT workspace_misc_expenses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: ai_insights; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_ad_spend_facts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_ad_spend_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_credentials; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_cursor; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_cursor ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_definitions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_line_item_facts_hot; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_line_item_facts_hot ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_oauth_states; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_order_facts_hot; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_order_facts_hot ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_product_facts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_product_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_refund_facts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_refund_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_shipment_facts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.connector_shipment_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_pii; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.customer_pii ENABLE ROW LEVEL SECURITY;

--
-- Name: identity_cluster_edges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.identity_cluster_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: identity_cluster_registry; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.identity_cluster_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_actions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.marketing_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_event_transform_state; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_event_transform_state ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_google_ads_daily; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_google_ads_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_klaviyo_email_performance; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_klaviyo_email_performance ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_meta_ads_daily; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_meta_ads_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_shiprocket_shipments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_shiprocket_shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_shopify_customers; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_shopify_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_shopify_line_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_shopify_line_items ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_shopify_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_shopify_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_shopify_products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_shopify_products ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_unicommerce_products; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_unicommerce_products ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_woocommerce_orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.raw_woocommerce_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_definitions read_all_definitions; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY read_all_definitions ON public.connector_definitions FOR SELECT USING (true);


--
-- Name: users superadmin_only; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_only ON public.users USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_connections superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.connector_connections USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_credentials superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.connector_credentials USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_oauth_states superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.connector_oauth_states USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: invitations superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.invitations USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: workspace_members superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.workspace_members USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: workspaces superadmin_rows; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY superadmin_rows ON public.workspaces USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_ad_campaign_classifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_ad_campaign_classifications ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_cogs_settings; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_cogs_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_costs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_festivals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_festivals ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_identity_salt; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_identity_salt ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_metric_goals; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_metric_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_misc_expenses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspace_misc_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_insights ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.ai_insights USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_ad_spend_facts ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_ad_spend_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_connections ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_connections USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_credentials ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_credentials USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_cursor ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_cursor USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: connector_line_item_facts_hot ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_line_item_facts_hot USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_oauth_states ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_oauth_states USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_order_facts_hot ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_order_facts_hot USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_product_facts ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_product_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_refund_facts ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_refund_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_shipment_facts ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.connector_shipment_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: customer_pii ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.customer_pii USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: identity_cluster_edges ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.identity_cluster_edges USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: identity_cluster_registry ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.identity_cluster_registry USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: invitations ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.invitations USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: marketing_actions ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.marketing_actions USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: raw_event_transform_state ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_event_transform_state USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: raw_google_ads_daily ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_google_ads_daily USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_klaviyo_email_performance ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_klaviyo_email_performance USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_meta_ads_daily ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_meta_ads_daily USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_shiprocket_shipments ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_shiprocket_shipments USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_shopify_customers ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_shopify_customers USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_shopify_line_items ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_shopify_line_items USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_shopify_orders ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_shopify_orders USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_shopify_products ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_shopify_products USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_unicommerce_products ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_unicommerce_products USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: raw_woocommerce_orders ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.raw_woocommerce_orders USING ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid)) WITH CHECK ((workspace_id = (current_setting('app.workspace_id'::text, true))::uuid));


--
-- Name: workspace_ad_campaign_classifications ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_ad_campaign_classifications USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_cogs_settings ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_cogs_settings USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_costs ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_costs USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_festivals ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_festivals USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_identity_salt ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_identity_salt USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_members ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_members USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_metric_goals ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_metric_goals USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_misc_expenses ws_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_isolation ON public.workspace_misc_expenses USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: audit_log ws_or_user_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_or_user_isolation ON public.audit_log USING ((((workspace_id IS NOT NULL) AND (workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) OR ((workspace_id IS NULL) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))) WITH CHECK ((((workspace_id IS NOT NULL) AND (workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) OR ((workspace_id IS NULL) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))));


--
-- Name: notifications ws_or_user_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_or_user_isolation ON public.notifications USING ((((workspace_id IS NOT NULL) AND (workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) OR ((workspace_id IS NULL) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid)))) WITH CHECK ((((workspace_id IS NOT NULL) AND (workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) OR ((workspace_id IS NULL) AND (user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::uuid))));


--
-- Name: workspaces ws_self_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ws_self_isolation ON public.workspaces USING ((id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO rls_app;
GRANT USAGE ON SCHEMA public TO svc_core;
GRANT USAGE ON SCHEMA public TO svc_ingestion;
GRANT USAGE ON SCHEMA public TO svc_analytics_ro;


--
-- Name: FUNCTION purge_closed_order_pii(p_workspace_id uuid, p_retention_days integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.purge_closed_order_pii(p_workspace_id uuid, p_retention_days integer) FROM PUBLIC;


--
--



--
-- Name: TABLE ai_insights; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_insights TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_insights TO svc_core;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_log TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_log TO svc_core;


--
-- Name: TABLE connector_ad_spend_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_ad_spend_facts TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_ad_spend_facts TO svc_core;


--
-- Name: TABLE connector_connections; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_connections TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_connections TO svc_core;


--
-- Name: TABLE connector_credentials; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_credentials TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_credentials TO svc_core;


--
-- Name: TABLE connector_cursor; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_cursor TO rls_app;


--
-- Name: TABLE connector_definitions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_definitions TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_definitions TO svc_core;


--
-- Name: TABLE connector_identity_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_identity_map TO rls_app;
GRANT SELECT ON TABLE public.connector_identity_map TO svc_ingestion;


--
-- Name: TABLE connector_line_item_facts_hot; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_line_item_facts_hot TO rls_app;


--
-- Name: TABLE connector_line_item_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_line_item_facts TO rls_app;


--
-- Name: TABLE connector_oauth_states; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_oauth_states TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_oauth_states TO svc_core;


--
-- Name: TABLE connector_order_facts_hot; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_order_facts_hot TO rls_app;


--
-- Name: TABLE connector_order_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_order_facts TO rls_app;


--
-- Name: TABLE connector_product_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_product_facts TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_product_facts TO svc_core;


--
-- Name: TABLE connector_refund_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_refund_facts TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_refund_facts TO svc_core;


--
-- Name: TABLE connector_shipment_facts; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_shipment_facts TO rls_app;


--
-- Name: TABLE connector_vendors; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.connector_vendors TO rls_app;


--
-- Name: TABLE customer_pii; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_pii TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_pii TO svc_core;


--
-- Name: TABLE identity_cluster_edges; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.identity_cluster_edges TO rls_app;


--
-- Name: TABLE identity_cluster_registry; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.identity_cluster_registry TO rls_app;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO svc_core;


--
-- Name: TABLE key_destruction_ledger; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.key_destruction_ledger TO rls_app;


--
-- Name: TABLE marketing_actions; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.marketing_actions TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.marketing_actions TO svc_core;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO svc_core;


--
-- Name: TABLE pii_purge_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pii_purge_log TO rls_app;


--
-- Name: TABLE raw_event_transform_state; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_event_transform_state TO rls_app;


--
-- Name: TABLE raw_google_ads_daily; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_google_ads_daily TO rls_app;


--
-- Name: TABLE raw_klaviyo_email_performance; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_klaviyo_email_performance TO rls_app;


--
-- Name: TABLE raw_meta_ads_daily; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_meta_ads_daily TO rls_app;


--
-- Name: TABLE raw_shiprocket_shipments; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_shiprocket_shipments TO rls_app;


--
-- Name: TABLE raw_shopify_customers; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_shopify_customers TO rls_app;


--
-- Name: TABLE raw_shopify_line_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_shopify_line_items TO rls_app;


--
-- Name: TABLE raw_shopify_orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_shopify_orders TO rls_app;


--
-- Name: TABLE raw_shopify_products; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_shopify_products TO rls_app;


--
-- Name: TABLE raw_unicommerce_products; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_unicommerce_products TO rls_app;


--
-- Name: TABLE raw_woocommerce_orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.raw_woocommerce_orders TO rls_app;


--
-- Name: TABLE subject_erasure_request; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subject_erasure_request TO rls_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO svc_core;


--
-- Name: TABLE workspace_ad_campaign_classifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_ad_campaign_classifications TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_ad_campaign_classifications TO svc_core;


--
-- Name: TABLE workspace_cogs_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_cogs_settings TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_cogs_settings TO svc_core;


--
-- Name: TABLE workspace_costs; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_costs TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_costs TO svc_core;


--
-- Name: TABLE workspace_festivals; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_festivals TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_festivals TO svc_core;


--
-- Name: TABLE workspace_identity_salt; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_identity_salt TO rls_app;


--
-- Name: TABLE workspace_members; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_members TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_members TO svc_core;


--
-- Name: TABLE workspace_metric_goals; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_metric_goals TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_metric_goals TO svc_core;


--
-- Name: TABLE workspace_misc_expenses; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_misc_expenses TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_misc_expenses TO svc_core;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspaces TO rls_app;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspaces TO svc_core;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,TRUNCATE,UPDATE ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO rls_app;


--
-- PostgreSQL database dump complete
--



-- =============================================================================
-- C3 FIX (audit P1): subject_erasure_request is workspace-scoped but the legacy
-- migration set shipped it WITHOUT row-level security. Add the canonical
-- fail-closed ws_isolation + superadmin policies (ENABLE + FORCE), identical to
-- every other workspace-scoped table. Closes the conformance C3 gap at the source.
-- =============================================================================
ALTER TABLE public.subject_erasure_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.subject_erasure_request FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON public.subject_erasure_request USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));
CREATE POLICY superadmin_rows ON public.subject_erasure_request USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));

-- =============================================================================
-- Lock down the PII purge function (was in 31-status-gated-purge.sql; pg_dump
-- does not emit function REVOKEs). Only the superuser scheduler may invoke it;
-- rls_app must go through the SECURITY DEFINER path, never call it directly.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.purge_closed_order_pii(uuid, integer) FROM PUBLIC;
