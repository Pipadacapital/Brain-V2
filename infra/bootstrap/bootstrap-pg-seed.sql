-- =============================================================================
-- Brain — registry SEED for the bootstrap (reference data, not user data).
--
-- The schema-only bootstrap (pg_dump -s) carries no rows. These two registry
-- tables MUST be seeded or the app can't resolve connectors (connectors.initiate
-- reads connector_definitions.oauth_config; vendor TEXT columns FK to
-- connector_vendors.code). Recovered verbatim from the retired migrations
-- (25-connector-definitions.sql + 32-vendor-text-fk.sql). Idempotent (ON CONFLICT).
-- connector_vendors first (it is the FK target of connector_definitions.vendor).
-- =============================================================================

INSERT INTO connector_vendors (code, archetype) VALUES
  ('SHOPIFY',     'ecom'),
  ('META',        'ads'),
  ('GOOGLE',      'ads'),
  ('SHIPROCKET',  'logistics'),
  ('WOOCOMMERCE', 'ecom'),
  ('UNICOMMERCE', 'erp'),
  ('KLAVIYO',     'email')
ON CONFLICT (code) DO UPDATE SET archetype = EXCLUDED.archetype;

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
