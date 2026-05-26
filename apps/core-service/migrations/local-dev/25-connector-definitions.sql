-- =============================================================================
-- 25-connector-definitions.sql — Brain integration registry (the spine of the
-- 100+ integrations design Founder asked for on 2026-05-26).
--
-- The registry is the single source of truth for "what integrations exist".
-- UI dropdowns, capability checks, OAuth bootstrap, and rate-limit / polling
-- config all read from here. Adding a new integration = INSERT a row + ALTER
-- the connector_vendor enum + write a transform. No fact-table changes.
--
-- Why an enum and a registry both?
--   • enum (connector_vendor) gives PG referential integrity on fact tables
--     (an order can't be FROM a vendor that doesn't exist) — cheap to ALTER.
--   • registry (connector_definitions) gives runtime config (capabilities,
--     OAuth shape, polling cadence) without code changes.
--   The pair lets us stay typed without freezing the integration list.
--
-- Plan: docs/data-architecture-plan-v2.md §7 (Integration registry — extensibility).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.connector_definitions (
  vendor              connector_vendor PRIMARY KEY,           -- enum FK (typed)
  display_name        text             NOT NULL,              -- "Shopify", "Meta Ads"
  category            text             NOT NULL,              -- ecom|ads|email|3pl|payments|crm|attribution|erp|bi|other
  capabilities        jsonb            NOT NULL DEFAULT '{}', -- { orders, line_items, products, ad_spend, shipments, refunds, email, customers }
  oauth_config        jsonb            NOT NULL DEFAULT '{}', -- { auth_url, token_url, scopes, redirect_uri_env }
  api_config          jsonb            NOT NULL DEFAULT '{}', -- { base_url, version, rate_limit_rps }
  polling_cadence_min int              NOT NULL DEFAULT 60,   -- minutes between syncs
  is_active           boolean          NOT NULL DEFAULT true, -- soft-disable without deleting history
  created_at          timestamptz      NOT NULL DEFAULT now(),
  updated_at          timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT category_known CHECK (category IN
    ('ecom','ads','email','3pl','payments','crm','attribution','erp','bi','other'))
);

COMMENT ON TABLE  public.connector_definitions IS
  'Integration registry — UI / ingestion / OAuth all read this. New integration = INSERT here + ALTER enum.';

COMMENT ON COLUMN public.connector_definitions.capabilities IS
  'jsonb of booleans per fact-type: { "orders": true, "line_items": true, ... }';

-- ---------------------------------------------------------------------------
-- RLS — definitions are GLOBAL (not workspace-scoped). All authenticated users
-- can read; only superuser writes (Brain ops). RLS is enabled but with a
-- read-all-authenticated policy + a write-only-superuser policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.connector_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_definitions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_all_definitions ON public.connector_definitions;
CREATE POLICY read_all_definitions ON public.connector_definitions
  FOR SELECT
  USING (true);                                                -- no workspace filter; global registry

GRANT SELECT                         ON public.connector_definitions TO rls_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.connector_definitions TO postgres;

-- ---------------------------------------------------------------------------
-- Seed the 7 current integrations. Idempotent (ON CONFLICT UPDATE).
-- ---------------------------------------------------------------------------
INSERT INTO public.connector_definitions
  (vendor, display_name, category, capabilities, oauth_config, api_config, polling_cadence_min)
VALUES
  ('SHOPIFY', 'Shopify', 'ecom',
    '{"orders":true,"line_items":true,"products":true,"customers":true,"refunds":true,"variants":true}'::jsonb,
    '{"auth_url":"https://{shop}.myshopify.com/admin/oauth/authorize","token_url":"https://{shop}.myshopify.com/admin/oauth/access_token","scopes":["read_orders","read_products","read_customers"],"redirect_uri_env":"SHOPIFY_REDIRECT_URI"}'::jsonb,
    '{"base_url":"https://{shop}.myshopify.com/admin/api","version":"2024-10","rate_limit_rps":2}'::jsonb,
    60),

  ('META', 'Meta Ads', 'ads',
    '{"ad_spend":true,"campaigns":true,"creatives":true,"funnel":true}'::jsonb,
    '{"auth_url":"https://www.facebook.com/dialog/oauth","token_url":"https://graph.facebook.com/oauth/access_token","scopes":["ads_read","ads_management","business_management"],"redirect_uri_env":"META_REDIRECT_URI"}'::jsonb,
    '{"base_url":"https://graph.facebook.com","version":"v19.0","rate_limit_rps":2}'::jsonb,
    180),

  ('GOOGLE', 'Google Ads', 'ads',
    '{"ad_spend":true,"campaigns":true,"funnel":true}'::jsonb,
    '{"auth_url":"https://accounts.google.com/o/oauth2/v2/auth","token_url":"https://oauth2.googleapis.com/token","scopes":["https://www.googleapis.com/auth/adwords"],"redirect_uri_env":"GOOGLE_ADS_REDIRECT_URI"}'::jsonb,
    '{"base_url":"https://googleads.googleapis.com","version":"v17","rate_limit_rps":1}'::jsonb,
    180),

  ('SHIPROCKET', 'Shiprocket', '3pl',
    '{"shipments":true,"rto":true,"couriers":true}'::jsonb,
    '{"auth_url":null,"token_url":"https://apiv2.shiprocket.in/v1/external/auth/login","scopes":[],"redirect_uri_env":null,"auth_kind":"basic"}'::jsonb,
    '{"base_url":"https://apiv2.shiprocket.in/v1/external","version":"v1","rate_limit_rps":1}'::jsonb,
    120),

  ('WOOCOMMERCE', 'WooCommerce', 'ecom',
    '{"orders":true,"line_items":true,"products":true,"customers":true,"refunds":true}'::jsonb,
    '{"auth_url":"https://{site}/wc-auth/v1/authorize","token_url":null,"scopes":["read"],"redirect_uri_env":"WOO_REDIRECT_URI","auth_kind":"key_secret"}'::jsonb,
    '{"base_url":"https://{site}/wp-json/wc","version":"v3","rate_limit_rps":2}'::jsonb,
    120),

  ('UNICOMMERCE', 'Unicommerce', 'erp',
    '{"orders":true,"products":true,"inventory":true,"shipments":true}'::jsonb,
    '{"auth_url":null,"token_url":"https://{tenant}.unicommerce.com/oauth/token","scopes":[],"redirect_uri_env":null,"auth_kind":"oauth2_client_credentials"}'::jsonb,
    '{"base_url":"https://{tenant}.unicommerce.com/services/rest/v1","version":"v1","rate_limit_rps":1}'::jsonb,
    180),

  ('KLAVIYO', 'Klaviyo', 'email',
    '{"email_sends":true,"events":true,"campaigns":true,"profiles":true}'::jsonb,
    '{"auth_url":"https://www.klaviyo.com/oauth/authorize","token_url":"https://a.klaviyo.com/oauth/token","scopes":["events:read","campaigns:read","profiles:read"],"redirect_uri_env":"KLAVIYO_REDIRECT_URI"}'::jsonb,
    '{"base_url":"https://a.klaviyo.com/api","version":"2024-10-15","rate_limit_rps":3}'::jsonb,
    240)
ON CONFLICT (vendor) DO UPDATE SET
  display_name         = EXCLUDED.display_name,
  category             = EXCLUDED.category,
  capabilities         = EXCLUDED.capabilities,
  oauth_config         = EXCLUDED.oauth_config,
  api_config           = EXCLUDED.api_config,
  polling_cadence_min  = EXCLUDED.polling_cadence_min,
  updated_at           = now();

-- Verification
SELECT vendor, category, polling_cadence_min,
       jsonb_object_keys(capabilities) AS cap
  FROM public.connector_definitions
 ORDER BY category, vendor, cap;
