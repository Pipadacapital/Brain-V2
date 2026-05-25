-- 0001_base_workspace_daily_metrics.sql
-- ClickHouse base/raw layer for Brain metric engine.
--
-- @paradigm: sql
-- CF-C4-RATIO-DIVOP-1: NO `/` operator anywhere in this file.
-- CF-C4-RESIDENCY-1: apply ONLY on a ClickHouse cluster in ap-south-1.
--
-- STATUS: RUNBOOK-GATED — NOT APPLIED THIS CHILD.
-- See migrations/clickhouse/README.md for Stage-8 apply procedure.
-- ZERO live DDL execution this child (HOLD-AT-READ-FLIP).
--
-- Workspace-partitioned base table. Every metric MV reads from this table.
-- Ordering by (workspace_id, date) enables efficient per-workspace range scans.
--
-- All money columns: BIGINT (Int64) minor units (µ).
-- All ratio columns: Int32 basis points (bp = FLOOR(ratio × 10000)).
-- All count columns: Int64.

CREATE TABLE IF NOT EXISTS brain.workspace_daily_metrics_base
(
    -- Partition / sort key
    workspace_id        String          NOT NULL,
    date                Date            NOT NULL,

    -- Revenue ladder (Gross → Net → Net-Net-Tax → Net Revenue)
    gross_sales_mu              Int64   DEFAULT 0,
    returns_mu                  Int64   DEFAULT 0,
    discounts_mu                Int64   DEFAULT 0,
    net_sales_mu                Int64   DEFAULT 0,       -- gross_sales - returns - discounts
    total_tax_mu                Int64   DEFAULT 0,       -- SUM(event-level per-SKU GST via RegionAdapter India)
    net_net_tax_mu              Int64   DEFAULT 0,       -- net_sales - total_tax_mu
    shipping_revenue_mu         Int64   DEFAULT 0,
    net_revenue_mu              Int64   DEFAULT 0,       -- net_net_tax + shipping_revenue

    -- Cost ladder
    cogs_mu                     Int64   DEFAULT 0,       -- scheduled full daily recompute (CF-C4-COGS-MV-REFRESH-1)
    total_ad_spend_mu           Int64   DEFAULT 0,
    meta_ad_spend_mu            Int64   DEFAULT 0,
    google_ad_spend_mu          Int64   DEFAULT 0,
    misc_expenses_monthly_mu    Int64   DEFAULT 0,       -- raw monthly amount; prorated in MV

    -- CM ladder (raw inputs; ratios computed in MV)
    cm1_mu                      Int64   DEFAULT 0,       -- net_revenue - cogs
    cm2_mu                      Int64   DEFAULT 0,       -- cm1 - total_ad_spend
    cm3_mu                      Int64   DEFAULT 0,       -- cm2 - misc_expenses_prorated

    -- COD / RTO counts
    total_orders                Int64   DEFAULT 0,
    cod_orders                  Int64   DEFAULT 0,
    prepaid_orders              Int64   DEFAULT 0,
    rto_orders                  Int64   DEFAULT 0,
    total_shipments             Int64   DEFAULT 0,

    -- Sessions / conversions
    total_sessions              Int64   DEFAULT 0,

    -- Ad platform raw (for CTR/CPC/CPM)
    meta_impressions            Int64   DEFAULT 0,
    meta_clicks                 Int64   DEFAULT 0,
    google_impressions          Int64   DEFAULT 0,
    google_clicks               Int64   DEFAULT 0,

    -- FX (shadow phase: static 83.5 per CF-C4-DDR-FX-RESTATEMENT-1)
    fx_rate_inr_x100            Int64   DEFAULT 8350,   -- 83.50 × 100; INT to avoid float column

    -- Audit
    inserted_at                 DateTime DEFAULT now(),
    source                      String   DEFAULT 'brain-analytics-service'
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(date)
ORDER BY (workspace_id, date)
SETTINGS index_granularity = 8192;
