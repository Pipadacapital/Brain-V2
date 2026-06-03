-- 0002_mv_computed_ratios.sql
-- Materialized View: computed ratio columns over the base layer.
--
-- migrate: skip — RUNBOOK-GATED, Stage-8 legacy metric-engine lineage applied by a
--   separate Founder-gated runbook (see README.md), not the local/CI migrator.
-- @paradigm: sql
-- CF-C4-RATIO-DIVOP-1: EVERY division uses intDiv() + explicit null-guard.
--                       ZERO `/` operators on metric columns.
-- CF-C4-PRORATED-DIVOP-1: misc_expenses_prorated_mu uses toDaysInMonth(date), NEVER a 30 constant.
-- LOCAL-CH-COMPAT: toDaysInMonth() requires CH 24.9+. On local CH 24.8 dev, substitute:
--   dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1))
--   which is semantically identical. Prod CH Cloud is 24.9+; use toDaysInMonth() there.
-- CF-C4-COGS-MV-REFRESH-1: cogs_mu is NOT computed here; it is populated by scheduled full
--                            daily recompute (see cogs_mu column in base table). This MV only
--                            reads cogs_mu as-is from the base; it does NOT derive it incrementally.
--
-- STATUS: RUNBOOK-GATED — NOT APPLIED THIS CHILD.
-- See migrations/clickhouse/README.md for Stage-8 apply procedure.

-- Target table for the MV output (stores computed ratios alongside base metrics).
CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_computed
(
    workspace_id                String      NOT NULL,
    date                        Date        NOT NULL,

    -- Pass-through money (from base)
    gross_sales_mu              Int64,
    returns_mu                  Int64,
    discounts_mu                Int64,
    net_sales_mu                Int64,
    total_tax_mu                Int64,
    net_net_tax_mu              Int64,
    shipping_revenue_mu         Int64,
    net_revenue_mu              Int64,
    cogs_mu                     Int64,
    total_ad_spend_mu           Int64,
    meta_ad_spend_mu            Int64,
    google_ad_spend_mu          Int64,
    cm1_mu                      Int64,
    cm2_mu                      Int64,

    -- CF-C4-PRORATED-DIVOP-1: prorated misc_expenses using toDaysInMonth(date)
    -- NEVER divide by 30 constant — correct calendar-aware proration.
    misc_expenses_prorated_mu   Nullable(Int64),

    cm3_mu                      Int64,

    -- Ratio metrics (basis points = FLOOR(ratio × 10000), CF-C4-RATIO-DIVOP-1)
    -- All use: if(<denom> > 0, intDiv(<num>, <denom>), NULL)

    -- RTO rate: rto_orders / total_shipments
    rto_rate_bp                 Nullable(Int32),

    -- Prepaid rate: prepaid_orders / total_orders
    prepaid_rate_bp             Nullable(Int32),

    -- Conversion rate: total_orders / total_sessions
    conversion_rate_bp          Nullable(Int32),

    -- AOV: net_sales_mu / total_orders (money unit, not bp)
    aov_mu                      Nullable(Int64),

    -- aCoS: total_ad_spend_mu * 10000 / net_sales_mu (bp; display_only=true per registry)
    acos_bp                     Nullable(Int32),

    -- Blended ROAS: net_sales_mu * 100 / total_ad_spend_mu
    -- display_only=true — ROAS is never a Brain decision metric (CM2-first)
    blended_roas_x100           Nullable(Int32),

    -- Meta channel ratios
    meta_ctr_bp                 Nullable(Int32),   -- meta_clicks / meta_impressions * 10000
    meta_cpc_mu                 Nullable(Int64),   -- meta_ad_spend_mu / meta_clicks
    meta_cpm_mu                 Nullable(Int64),   -- meta_ad_spend_mu * 1000 / meta_impressions

    -- Google channel ratios
    google_ctr_bp               Nullable(Int32),   -- google_clicks / google_impressions * 10000
    google_avg_cpc_mu           Nullable(Int64),   -- google_ad_spend_mu / google_clicks

    -- Audit
    computed_at                 DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;


-- ─────────────────────────────────────────────────────────────────────────────
-- Materialized View definition
-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANT: This MV fires on INSERT into the base table.
-- cogs_mu is read from base as-is (full-recompute model; NOT incrementally derived here).
-- Every ratio uses: if(<denom> > 0, intDiv(<num>, <denom>), NULL)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS brain.workspace_daily_metrics_mv
TO brain.workspace_daily_metrics_computed
AS
SELECT
    workspace_id,
    date,

    -- Pass-through money fields
    gross_sales_mu,
    returns_mu,
    discounts_mu,
    net_sales_mu,
    total_tax_mu,
    net_net_tax_mu,
    shipping_revenue_mu,
    net_revenue_mu,
    cogs_mu,
    total_ad_spend_mu,
    meta_ad_spend_mu,
    google_ad_spend_mu,
    cm1_mu,
    cm2_mu,

    -- CF-C4-PRORATED-DIVOP-1: calendar-aware proration over days-in-month.
    -- LOCAL-CH-COMPAT: dateDiff('day', toStartOfMonth, +1 month) == toDaysInMonth(date),
    -- and works on BOTH CH 24.8 (local dev) and 24.9+ (prod) — so one migration applies
    -- everywhere. (toDaysInMonth() alone fails on 24.8 with UNKNOWN_FUNCTION.)
    -- days-in-month('2026-02-15') = 28; days-in-month('2026-03-15') = 31.
    -- NEVER: intDiv(misc_expenses_monthly_mu, 30) — wrong for Feb, Jan, etc.
    if(dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1)) > 0,
       intDiv(misc_expenses_monthly_mu, dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1))), NULL)
        AS misc_expenses_prorated_mu,

    -- cm3 = cm2 - misc_expenses_prorated
    -- Carry NULL if misc is NULL (zero-monthly-cost workspace avoids NULLs in practice)
    cm2_mu - if(dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1)) > 0,
                intDiv(misc_expenses_monthly_mu, dateDiff('day', toStartOfMonth(date), addMonths(toStartOfMonth(date), 1))), 0)
        AS cm3_mu,

    -- RTO rate (CF-C4-RATIO-DIVOP-1, Pattern A)
    if(total_shipments > 0, intDiv(rto_orders * 10000, total_shipments), NULL)
        AS rto_rate_bp,

    -- Prepaid rate (CF-C4-RATIO-DIVOP-1, Pattern A)
    if(total_orders > 0, intDiv(prepaid_orders * 10000, total_orders), NULL)
        AS prepaid_rate_bp,

    -- Conversion rate (CF-C4-RATIO-DIVOP-1, Pattern A)
    if(total_sessions > 0, intDiv(total_orders * 10000, total_sessions), NULL)
        AS conversion_rate_bp,

    -- AOV (CF-C4-RATIO-DIVOP-1, Pattern B — money unit, not bp)
    if(total_orders > 0, intDiv(net_sales_mu, total_orders), NULL)
        AS aov_mu,

    -- aCoS: total_ad_spend / net_sales as bp (display_only=true, CF-C4-RATIO-DIVOP-1)
    if(net_sales_mu > 0, intDiv(total_ad_spend_mu * 10000, net_sales_mu), NULL)
        AS acos_bp,

    -- Blended ROAS ×100 (display_only=true; ROAS is never a Brain decision metric)
    -- Expressed as integer ×100: 250 = 2.50x ROAS
    if(total_ad_spend_mu > 0, intDiv(net_sales_mu * 100, total_ad_spend_mu), NULL)
        AS blended_roas_x100,

    -- Meta CTR (CF-C4-RATIO-DIVOP-1, Pattern A)
    if(meta_impressions > 0, intDiv(meta_clicks * 10000, meta_impressions), NULL)
        AS meta_ctr_bp,

    -- Meta CPC (CF-C4-RATIO-DIVOP-1, Pattern B)
    if(meta_clicks > 0, intDiv(meta_ad_spend_mu, meta_clicks), NULL)
        AS meta_cpc_mu,

    -- Meta CPM — spend per 1000 impressions (CF-C4-RATIO-DIVOP-1, Pattern B; multiply num by 1000)
    if(meta_impressions > 0, intDiv(meta_ad_spend_mu * 1000, meta_impressions), NULL)
        AS meta_cpm_mu,

    -- Google CTR (CF-C4-RATIO-DIVOP-1, Pattern A)
    if(google_impressions > 0, intDiv(google_clicks * 10000, google_impressions), NULL)
        AS google_ctr_bp,

    -- Google avg CPC (CF-C4-RATIO-DIVOP-1, Pattern B)
    if(google_clicks > 0, intDiv(google_ad_spend_mu, google_clicks), NULL)
        AS google_avg_cpc_mu

FROM brain.workspace_daily_metrics_base;
