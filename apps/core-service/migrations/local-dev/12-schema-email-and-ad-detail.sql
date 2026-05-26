-- =============================================================================
-- Phase 1 — D6 (email_send), D7a (ad_creative), D7b (ad_funnel).
-- Design: docs/data-architecture-plan.md §3.5, §3.6.
-- =============================================================================

-- D6 — email/SMS send-day grain (Klaviyo today; future Mailchimp etc.).
CREATE TABLE IF NOT EXISTS connector_email_send_facts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor              connector_vendor NOT NULL,           -- KLAVIYO (future MAILCHIMP)
  source_type         TEXT NOT NULL,                        -- 'campaign' | 'flow'
  vendor_resource_id  TEXT NOT NULL,                        -- klaviyo campaign/flow id
  name                TEXT NOT NULL,
  channel             TEXT NOT NULL,                        -- 'email' | 'sms'
  send_date           DATE NOT NULL,
  delivered           INT NOT NULL DEFAULT 0,
  unique_opens        INT NOT NULL DEFAULT 0,
  unique_clicks       INT NOT NULL DEFAULT 0,
  orders              INT NOT NULL DEFAULT 0,
  revenue_mu          BIGINT NOT NULL DEFAULT 0,
  currency_code       TEXT,
  unsubscribes        INT NOT NULL DEFAULT 0,
  spam_complaints     INT NOT NULL DEFAULT 0,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, source_type, vendor_resource_id, send_date)
);
CREATE INDEX IF NOT EXISTS connector_email_send_facts_ws_date_idx
  ON connector_email_send_facts (workspace_id, send_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_email_send_facts TO rls_app;

-- D7a — ad creative (ad-day grain; Meta today). avg_watch_sec stored × 100 to avoid float.
CREATE TABLE IF NOT EXISTS connector_ad_creative_facts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor               connector_vendor NOT NULL,         -- META (future GOOGLE)
  ad_account_id        TEXT NOT NULL,
  ad_id                TEXT NOT NULL,
  ad_name              TEXT,
  campaign_id          TEXT,
  campaign_name        TEXT,
  adset_id             TEXT,
  adset_name           TEXT,
  date                 DATE NOT NULL,
  impressions          BIGINT NOT NULL DEFAULT 0,
  clicks               BIGINT NOT NULL DEFAULT 0,
  spend_mu             BIGINT NOT NULL DEFAULT 0,
  video_3s_views       INT,
  video_thruplay       INT NOT NULL DEFAULT 0,
  avg_watch_sec_x100   INT NOT NULL DEFAULT 0,
  video_p25            INT NOT NULL DEFAULT 0,
  video_p50            INT NOT NULL DEFAULT 0,
  video_p75            INT NOT NULL DEFAULT 0,
  video_p95            INT NOT NULL DEFAULT 0,
  conversions          INT NOT NULL DEFAULT 0,
  revenue_mu           BIGINT NOT NULL DEFAULT 0,
  currency_code        TEXT NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, ad_account_id, ad_id, date)
);
CREATE INDEX IF NOT EXISTS connector_ad_creative_facts_ws_date_idx
  ON connector_ad_creative_facts (workspace_id, date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_ad_creative_facts TO rls_app;

-- D7b — ad funnel (campaign-stage-day grain; Google today). Conversions × 1000 (Google fractional).
CREATE TABLE IF NOT EXISTS connector_ad_funnel_facts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vendor               connector_vendor NOT NULL,        -- GOOGLE (future META)
  customer_id          TEXT NOT NULL,                     -- google ads account id
  campaign_id          TEXT NOT NULL,
  date                 DATE NOT NULL,
  stage                TEXT NOT NULL,                     -- 'add_to_cart' | 'checkout_initiated' | 'purchase'
  conversions_x1000    BIGINT NOT NULL DEFAULT 0,
  conversion_value_mu  BIGINT NOT NULL DEFAULT 0,
  currency_code        TEXT NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, vendor, customer_id, campaign_id, date, stage)
);
CREATE INDEX IF NOT EXISTS connector_ad_funnel_facts_ws_date_idx
  ON connector_ad_funnel_facts (workspace_id, date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON connector_ad_funnel_facts TO rls_app;
