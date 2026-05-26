--
-- PostgreSQL database dump
--

\restrict AzgD70cwvPwJa8T8FIRMPvFDkJDsxck4U2FsErt9LTuJiV6KnFAgsGmi3WiDQC0

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
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgres_fdw; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgres_fdw WITH SCHEMA public;


--
-- Name: EXTENSION postgres_fdw; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgres_fdw IS 'foreign-data wrapper for remote PostgreSQL servers';


--
-- Name: connector_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_status AS ENUM (
    'NOT_CONNECTED',
    'CONNECTED',
    'TOKEN_EXPIRED',
    'ERROR',
    'DISCONNECTED'
);


--
-- Name: connector_vendor; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connector_vendor AS ENUM (
    'SHOPIFY',
    'META',
    'GOOGLE',
    'SHIPROCKET'
);


--
-- Name: invitation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invitation_status AS ENUM (
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'REVOKED'
);


--
-- Name: store_platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.store_platform AS ENUM (
    'SHOPIFY',
    'WOOCOMMERCE'
);


--
-- Name: system_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.system_role AS ENUM (
    'SUPERADMIN',
    'USER'
);


--
-- Name: workspace_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_role AS ENUM (
    'OWNER',
    'ADMIN',
    'MANAGER',
    'ANALYST',
    'VIEWER'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: connector_ad_spend_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_ad_spend_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
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


--
-- Name: connector_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
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


--
-- Name: connector_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_credentials (
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
    credential_enc bytea NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_credentials FORCE ROW LEVEL SECURITY;


--
-- Name: connector_line_item_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_line_item_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
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

ALTER TABLE ONLY public.connector_line_item_facts FORCE ROW LEVEL SECURITY;


--
-- Name: connector_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_oauth_states (
    state_hash text NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
    user_id uuid NOT NULL,
    shop_domain text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_oauth_states FORCE ROW LEVEL SECURITY;


--
-- Name: connector_order_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_order_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
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
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_order_facts FORCE ROW LEVEL SECURITY;


--
-- Name: connector_product_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_product_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
    vendor_product_id text NOT NULL,
    title text,
    product_type text,
    status text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    cost_mu bigint
);

ALTER TABLE ONLY public.connector_product_facts FORCE ROW LEVEL SECURITY;


--
-- Name: connector_refund_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_refund_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
    vendor_order_id text NOT NULL,
    vendor_refund_id text NOT NULL,
    vendor_refund_line_id text NOT NULL,
    sku text,
    quantity bigint,
    subtotal_mu bigint,
    tax_mu bigint,
    processed_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.connector_refund_facts FORCE ROW LEVEL SECURITY;


--
-- Name: connector_shipment_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_shipment_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    vendor public.connector_vendor NOT NULL,
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

ALTER TABLE ONLY public.connector_shipment_facts FORCE ROW LEVEL SECURITY;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
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
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspaces FORCE ROW LEVEL SECURITY;


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_workspace_id_vendor_campaign_id_sp_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_workspace_id_vendor_campaign_id_sp_key UNIQUE (workspace_id, vendor, campaign_id, spend_date);


--
-- Name: connector_connections connector_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_pkey PRIMARY KEY (id);


--
-- Name: connector_connections connector_connections_workspace_id_vendor_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_workspace_id_vendor_key UNIQUE (workspace_id, vendor);


--
-- Name: connector_credentials connector_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_pkey PRIMARY KEY (workspace_id, vendor);


--
-- Name: connector_line_item_facts connector_line_item_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_line_item_facts
    ADD CONSTRAINT connector_line_item_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_line_item_facts connector_line_item_facts_workspace_id_vendor_vendor_order__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_line_item_facts
    ADD CONSTRAINT connector_line_item_facts_workspace_id_vendor_vendor_order__key UNIQUE (workspace_id, vendor, vendor_order_id, vendor_line_id);


--
-- Name: connector_oauth_states connector_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_oauth_states
    ADD CONSTRAINT connector_oauth_states_pkey PRIMARY KEY (state_hash);


--
-- Name: connector_order_facts connector_order_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_order_facts
    ADD CONSTRAINT connector_order_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_order_facts connector_order_facts_workspace_id_vendor_vendor_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_order_facts
    ADD CONSTRAINT connector_order_facts_workspace_id_vendor_vendor_order_id_key UNIQUE (workspace_id, vendor, vendor_order_id);


--
-- Name: connector_product_facts connector_product_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_product_facts connector_product_facts_workspace_id_vendor_vendor_product__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_workspace_id_vendor_vendor_product__key UNIQUE (workspace_id, vendor, vendor_product_id);


--
-- Name: connector_refund_facts connector_refund_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_refund_facts connector_refund_facts_workspace_id_vendor_vendor_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_workspace_id_vendor_vendor_refund_id_key UNIQUE (workspace_id, vendor, vendor_refund_id, vendor_refund_line_id);


--
-- Name: connector_shipment_facts connector_shipment_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_pkey PRIMARY KEY (id);


--
-- Name: connector_shipment_facts connector_shipment_facts_workspace_id_vendor_vendor_shipmen_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_workspace_id_vendor_vendor_shipmen_key UNIQUE (workspace_id, vendor, vendor_shipment_id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_user_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_workspace_id_key UNIQUE (user_id, workspace_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: connector_ad_spend_facts_ws_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_ad_spend_facts_ws_date_idx ON public.connector_ad_spend_facts USING btree (workspace_id, spend_date);


--
-- Name: connector_connections_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_connections_workspace_idx ON public.connector_connections USING btree (workspace_id);


--
-- Name: connector_line_item_facts_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_line_item_facts_order_idx ON public.connector_line_item_facts USING btree (workspace_id, vendor, vendor_order_id);


--
-- Name: connector_line_item_facts_prod_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_line_item_facts_prod_idx ON public.connector_line_item_facts USING btree (workspace_id, vendor_product_id);


--
-- Name: connector_oauth_states_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_oauth_states_expires_idx ON public.connector_oauth_states USING btree (expires_at);


--
-- Name: connector_oauth_states_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_oauth_states_workspace_idx ON public.connector_oauth_states USING btree (workspace_id);


--
-- Name: connector_order_facts_cust_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_order_facts_cust_idx ON public.connector_order_facts USING btree (workspace_id, customer_ref, processed_at);


--
-- Name: connector_order_facts_ws_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_order_facts_ws_idx ON public.connector_order_facts USING btree (workspace_id, processed_at);


--
-- Name: connector_refund_facts_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_refund_facts_order_idx ON public.connector_refund_facts USING btree (workspace_id, vendor, vendor_order_id);


--
-- Name: connector_shipment_facts_orderref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_shipment_facts_orderref_idx ON public.connector_shipment_facts USING btree (workspace_id, vendor_order_ref);


--
-- Name: connector_shipment_facts_ws_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connector_shipment_facts_ws_idx ON public.connector_shipment_facts USING btree (workspace_id, status_bucket);


--
-- Name: invitations_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_token_idx ON public.invitations USING btree (token);


--
-- Name: invitations_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_workspace_idx ON public.invitations USING btree (workspace_id);


--
-- Name: workspace_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);


--
-- Name: workspace_members_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_workspace_idx ON public.workspace_members USING btree (workspace_id);


--
-- Name: connector_ad_spend_facts connector_ad_spend_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_ad_spend_facts
    ADD CONSTRAINT connector_ad_spend_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_connections connector_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_connections
    ADD CONSTRAINT connector_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_credentials connector_credentials_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_credentials
    ADD CONSTRAINT connector_credentials_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_line_item_facts connector_line_item_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_line_item_facts
    ADD CONSTRAINT connector_line_item_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_oauth_states connector_oauth_states_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_oauth_states
    ADD CONSTRAINT connector_oauth_states_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_order_facts connector_order_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_order_facts
    ADD CONSTRAINT connector_order_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_product_facts connector_product_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_product_facts
    ADD CONSTRAINT connector_product_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_refund_facts connector_refund_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_refund_facts
    ADD CONSTRAINT connector_refund_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: connector_shipment_facts connector_shipment_facts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_shipment_facts
    ADD CONSTRAINT connector_shipment_facts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitations invitations_invited_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_id_fkey FOREIGN KEY (invited_by_id) REFERENCES public.users(id);


--
-- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: connector_ad_spend_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_ad_spend_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_line_item_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_line_item_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_order_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_order_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_product_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_product_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_refund_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_refund_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_shipment_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.connector_shipment_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: users superadmin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_only ON public.users USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_connections superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.connector_connections USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_credentials superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.connector_credentials USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: connector_oauth_states superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.connector_oauth_states USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: invitations superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.invitations USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: workspace_members superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.workspace_members USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: workspaces superadmin_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY superadmin_rows ON public.workspaces USING ((current_setting('app.is_superadmin'::text, true) = 'true'::text)) WITH CHECK ((current_setting('app.is_superadmin'::text, true) = 'true'::text));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: connector_ad_spend_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_ad_spend_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_connections ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_connections USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_credentials ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_credentials USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_line_item_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_line_item_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_oauth_states ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_oauth_states USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_order_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_order_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_product_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_product_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_refund_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_refund_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: connector_shipment_facts ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.connector_shipment_facts USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: invitations ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.invitations USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_members ws_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_isolation ON public.workspace_members USING ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspaces ws_self_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ws_self_isolation ON public.workspaces USING ((id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid));


--
-- PostgreSQL database dump complete
--

\unrestrict AzgD70cwvPwJa8T8FIRMPvFDkJDsxck4U2FsErt9LTuJiV6KnFAgsGmi3WiDQC0

