"""
recompute_daily.py — Daily metric-engine rollup: connector_*_facts → workspace_daily_metrics_base.

@paradigm: sql
CF-C4-RATIO-DIVOP-1: No `/` operators on metric columns (sums only — division is in the MV).
CF-C4-COGS-MV-REFRESH-1: Scheduled full daily recompute (DELETE + INSERT). Not incremental.
CF-C4-RESIDENCY-1: Must run on a ClickHouse cluster in ap-south-1 in production.

PURPOSE:
  Populate brain.workspace_daily_metrics_base with per-(workspace_id, date) P&L rollups
  derived from the connector_*_facts source tables. The materialized view 0002
  (workspace_daily_metrics_mv) fires on INSERT into base and auto-derives _computed
  with ratio columns (CM1/CM2/CM3/AOV/aCoS/ROAS etc.). query_gateway.query_metrics()
  reads workspace_daily_metrics_computed — so after recompute, it returns real data.

IDEMPOTENCY:
  workspace_daily_metrics_base uses ReplacingMergeTree(inserted_at). On re-run, the
  new INSERT produces rows with a fresh inserted_at — ReplacingMergeTree keeps the
  latest version per (workspace_id, date) ORDER BY key. FINAL reads (e.g. in the MV
  and COUNT queries) see only the latest version.

  The DELETE before INSERT is a lightweight mutation to avoid unbounded version
  accumulation on each recompute. We wait for the DELETE mutation to finish via
  OPTIMIZE TABLE ... PARTITION ... FINAL before counting, ensuring the count query
  sees a clean state.

  Important: ALTER TABLE ... DELETE is async in CH MergeTree. We issue it and then
  OPTIMIZE FINAL on the affected partition to force immediate collapse. The INSERT
  then proceeds into a clean partition. This produces a deterministic row count
  on any subsequent re-run.

PARITY:
  Mirrors the TS fact-analytics-ch.ts readers exactly:
  - CANCELLED_OK filter: cancelled_at IS NULL AND lower(financial_status) NOT IN ('voided','refunded')
  - net_sales_mu = gross_sales_mu - discount_mu  (tax NOT subtracted here; matches phase8-ch-backfill.sql)
  - net_net_tax_mu = net_sales_mu - total_tax_mu
  - net_revenue_mu = net_net_tax_mu + shipping_mu
  - COGS resolve rule: if override_bp > 0: override; elif cost_mu > 0: line qty×cost_mu; else fallback (0)
    In recompute context: no settings override/fallback, so we apply: qty × argMax(cost_mu, version)
    from connector_product_facts. Lines with no costed product contribute 0 (matches readCogsCH).
  - Ad spend: vendor='META' → meta_ad_spend_mu; vendor='GOOGLE' → google_ad_spend_mu.
  - COD/prepaid: payment_method='COD' vs 'Prepaid' (matches readCodPrepaidCH).

DEFERRED (follow-up tasks — note in code):
  - RTO/total_shipments (connector_shipment_facts daily join) — 0 for now.
  - total_sessions — no sessions source yet — 0 for now.
  - Impressions/clicks from ad facts — 0 for now (not in query_gateway MetricRow).
  - misc_expenses_monthly_mu — 0 for now; workspace settings injection is Phase-D.
  - Scheduler (daily-tick cron) — not built here; this function is the deliverable.
  - Per-brand monthly cap + graceful degradation on cap breach.
  - Trace-ID propagation to CH call headers (Phase-D observability).

USAGE:
  from src.application.contexts.metric_engine.recompute_daily import recompute_daily_metrics
  recompute_daily_metrics(
      workspace_id="f165da80-e6d5-4c58-9aff-ec654b873bd7",
      date_start="2024-01-01",
      date_end="2026-06-01",
      ch_client=client,
  )
"""

from __future__ import annotations

import logging
from typing import Any

# Re-use the shared client factory from the query gateway rather than importing
# clickhouse_connect directly. CF-C4-SINGLE-WRITER-GREP-2 mandates that raw
# clickhouse_connect.get_client calls exist ONLY in query_gateway.py.
from ....infrastructure.clickhouse.query_gateway import _make_default_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Realized order filter — mirrors CANCELLED_OK in fact-analytics-ch.ts.
# Must be byte-identical to the TS reader predicate for parity.
# ---------------------------------------------------------------------------
_CANCELLED_OK = (
    "cancelled_at IS NULL "
    "AND lower(coalesce(financial_status, '')) NOT IN ('voided', 'refunded')"
)


# ---------------------------------------------------------------------------
# The rollup INSERT … SELECT
#
# Aggregates per (workspace_id, order_date) from connector_order_facts,
# connector_line_item_facts, connector_product_facts, connector_ad_spend_facts.
#
# All arithmetic uses integer SUM only — no `/` on metric columns.
# CF-C4-RATIO-DIVOP-1: division is in the MV 0002, not here.
#
# COGS resolve rule (mirrors readCogsCH, no settings override/fallback):
#   sum(li.quantity * coalesce(pf.cost_mu, 0))
#   where pf.cost_mu comes from argMax(cost_mu, version) per (vendor_product_id).
#   Lines with no product fact → 0 (same as readCogsCH LEFT JOIN with 0 coalesce).
#
# Ad spend aggregated per date from connector_ad_spend_facts (vendor='META'/'GOOGLE').
# Joined to the orders CTE on (workspace_id, date) — left join so order days with
# no ad spend still produce rows.
#
# COD/prepaid: payment_method='COD' (realized orders only); 'Prepaid' otherwise.
# Mirrors readCodPrepaidCH.
# ---------------------------------------------------------------------------

_ROLLUP_INSERT_SQL = """
INSERT INTO brain.workspace_daily_metrics_base
(
    workspace_id,
    date,
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
    misc_expenses_monthly_mu,
    cm1_mu,
    cm2_mu,
    cm3_mu,
    total_orders,
    cod_orders,
    prepaid_orders,
    rto_orders,
    total_shipments,
    total_sessions,
    meta_impressions,
    meta_clicks,
    google_impressions,
    google_clicks,
    inserted_at,
    source
)
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE on CH 24.8 compatibility: CH 24.8 raises ILLEGAL_AGGREGATION when a
-- column alias matches a source column name AND is used in a computed aggregate
-- in the SAME SELECT (e.g. `sum(gross_sales_mu) AS gross_sales_mu` alongside
-- `sum(gross_sales_mu - discount_mu)`). The fix is a two-level subquery pattern:
--   inner: aggregate with neutral aliases (gross_mu, disc_mu, etc.)
--   outer: rename + derive ladder columns via arithmetic on the inner aliases.
-- This is CH 24.8-specific; CH 24.9+ / CH Cloud does not have this restriction.
-- ─────────────────────────────────────────────────────────────────────────────
WITH

-- ─────────────────────────────────────────────────────────────────────────
-- Latest product cost per (workspace_id, vendor, vendor_product_id).
-- Same argMax pattern as readCogsCH and readProductPerformanceCH.
-- ─────────────────────────────────────────────────────────────────────────
product_cost AS (
    SELECT
        workspace_id,
        vendor,
        vendor_product_id,
        argMax(cost_mu, version) AS cost_mu
    FROM brain.connector_product_facts
    WHERE workspace_id = %(workspace_id)s
    GROUP BY workspace_id, vendor, vendor_product_id
),

-- ─────────────────────────────────────────────────────────────────────────
-- Per-day COGS: sum( li.quantity × resolved_cost_mu ) per order_date.
-- LEFT JOIN product_cost → uncosted lines contribute 0 (readCogsCH parity).
-- FINAL on connector_line_item_facts: deduplicates ReplacingMergeTree dupes.
-- ─────────────────────────────────────────────────────────────────────────
cogs_per_day AS (
    SELECT
        li.order_date                                      AS date,
        sum(li.quantity * coalesce(pf.cost_mu, 0))        AS cogs_mu
    FROM brain.connector_line_item_facts AS li FINAL
    LEFT JOIN product_cost AS pf
        ON  pf.workspace_id      = li.workspace_id
        AND pf.vendor            = li.vendor
        AND pf.vendor_product_id = li.vendor_product_id
    WHERE li.workspace_id = %(workspace_id)s
      AND li.order_date >= toDate(%(date_start)s)
      AND li.order_date <= toDate(%(date_end)s)
    GROUP BY li.order_date
),

-- ─────────────────────────────────────────────────────────────────────────
-- Per-day ad spend by vendor (META + GOOGLE), with impressions/clicks.
-- date column is the spend date in connector_ad_spend_facts.
-- ─────────────────────────────────────────────────────────────────────────
ad_per_day AS (
    SELECT
        date,
        sumIf(spend_mu,    vendor = 'META')         AS meta_spend_mu,
        sumIf(spend_mu,    vendor = 'GOOGLE')       AS google_spend_mu,
        sumIf(impressions, vendor = 'META')         AS meta_imp,
        sumIf(clicks,      vendor = 'META')         AS meta_clk,
        sumIf(impressions, vendor = 'GOOGLE')       AS google_imp,
        sumIf(clicks,      vendor = 'GOOGLE')       AS google_clk
    FROM brain.connector_ad_spend_facts
    WHERE workspace_id = %(workspace_id)s
      AND date >= toDate(%(date_start)s)
      AND date <= toDate(%(date_end)s)
    GROUP BY date
),

-- ─────────────────────────────────────────────────────────────────────────
-- Per-day order aggregates: raw aggregates with neutral aliases to avoid
-- the CH 24.8 ILLEGAL_AGGREGATION alias-collision bug (see note above).
-- Realized filter: CANCELLED_OK (cancelled_at IS NULL + financial_status guard).
-- COD/prepaid: payment_method = 'COD' vs 'Prepaid' (readCodPrepaidCH parity).
-- FINAL on connector_order_facts: deduplicates ReplacingMergeTree dupes.
-- ─────────────────────────────────────────────────────────────────────────
orders_raw AS (
    SELECT
        order_date                                  AS date,
        sum(gross_sales_mu)                         AS gross_mu,
        sum(discount_mu)                            AS disc_mu,
        sum(tax_mu)                                 AS tax_mu,
        sum(shipping_mu)                            AS ship_mu,
        count()                                     AS total_orders,
        countIf(payment_method = 'COD')             AS cod_orders,
        countIf(payment_method = 'Prepaid')         AS prepaid_orders
    FROM brain.connector_order_facts FINAL
    WHERE workspace_id = %(workspace_id)s
      AND order_date >= toDate(%(date_start)s)
      AND order_date <= toDate(%(date_end)s)
      AND {CANCELLED_OK}
    GROUP BY order_date
),

-- ─────────────────────────────────────────────────────────────────────────
-- Derive the revenue ladder from raw order aggregates.
-- net_sales = gross - discount (tax NOT subtracted here; phase8 contract).
-- net_net_tax = net_sales - tax.
-- net_revenue = net_net_tax + shipping.
-- ─────────────────────────────────────────────────────────────────────────
orders_per_day AS (
    SELECT
        date,
        gross_mu                                    AS gross_sales_mu,
        toInt64(0)                                  AS returns_mu,
        disc_mu                                     AS discounts_mu,
        gross_mu - disc_mu                          AS net_sales_mu,
        tax_mu                                      AS total_tax_mu,
        (gross_mu - disc_mu) - tax_mu               AS net_net_tax_mu,
        ship_mu                                     AS shipping_revenue_mu,
        (gross_mu - disc_mu - tax_mu) + ship_mu     AS net_revenue_mu,
        total_orders,
        cod_orders,
        prepaid_orders
    FROM orders_raw
)

-- ─────────────────────────────────────────────────────────────────────────
-- Final SELECT: join orders × cogs × ad_spend on date.
-- All CM ladder columns populated so the MV 0002 derives ratios.
-- CF-C4-RATIO-DIVOP-1: all expressions are integer arithmetic; no division.
-- DEFERRED (rto_orders, total_shipments, total_sessions): 0 for now.
-- DEFERRED (misc_expenses_monthly_mu): 0 for now (Phase-D settings injection).
-- ─────────────────────────────────────────────────────────────────────────
SELECT
    %(workspace_id)s                                           AS workspace_id,
    o.date                                                     AS date,

    -- Revenue ladder (exact parity with fact-analytics-ch.ts readStoreSummaryCH)
    o.gross_sales_mu,
    o.returns_mu,
    o.discounts_mu,
    o.net_sales_mu,
    o.total_tax_mu,
    o.net_net_tax_mu,
    o.shipping_revenue_mu,
    o.net_revenue_mu,

    -- COGS (readCogsCH parity: qty × argMax cost_mu, 0 for uncosted lines)
    coalesce(c.cogs_mu, 0)                                     AS cogs_mu,

    -- Ad spend (readAdSpendCH parity: META + GOOGLE totals)
    coalesce(a.meta_spend_mu, 0)
        + coalesce(a.google_spend_mu, 0)                       AS total_ad_spend_mu,
    coalesce(a.meta_spend_mu, 0)                               AS meta_ad_spend_mu,
    coalesce(a.google_spend_mu, 0)                             AS google_ad_spend_mu,

    -- misc_expenses: 0 placeholder (Phase-D workspace-settings injection)
    toInt64(0)                                                 AS misc_expenses_monthly_mu,

    -- CM ladder: all integer arithmetic, no division (CF-C4-RATIO-DIVOP-1)
    -- cm1 = net_revenue - cogs
    o.net_revenue_mu - coalesce(c.cogs_mu, 0)                  AS cm1_mu,
    -- cm2 = cm1 - total_ad_spend
    (o.net_revenue_mu - coalesce(c.cogs_mu, 0))
        - (coalesce(a.meta_spend_mu, 0) + coalesce(a.google_spend_mu, 0))
                                                               AS cm2_mu,
    -- cm3 = cm2 (misc_expenses_monthly_mu is 0; MV recomputes from base anyway)
    (o.net_revenue_mu - coalesce(c.cogs_mu, 0))
        - (coalesce(a.meta_spend_mu, 0) + coalesce(a.google_spend_mu, 0))
                                                               AS cm3_mu,

    -- Order counts
    o.total_orders,
    o.cod_orders,
    o.prepaid_orders,

    -- DEFERRED: rto_orders, total_shipments (shipment join Phase-D)
    toInt64(0)                                                 AS rto_orders,
    toInt64(0)                                                 AS total_shipments,
    -- DEFERRED: total_sessions (no sessions source yet)
    toInt64(0)                                                 AS total_sessions,

    -- Ad platform impressions/clicks (populated when available in ad_spend_facts)
    coalesce(a.meta_imp, 0)                                    AS meta_impressions,
    coalesce(a.meta_clk, 0)                                    AS meta_clicks,
    coalesce(a.google_imp, 0)                                  AS google_impressions,
    coalesce(a.google_clk, 0)                                  AS google_clicks,

    now()                                                      AS inserted_at,
    'brain-analytics-service-recompute'                        AS source

FROM orders_per_day AS o
LEFT JOIN cogs_per_day  AS c ON c.date = o.date
LEFT JOIN ad_per_day    AS a ON a.date = o.date
""".replace("{CANCELLED_OK}", _CANCELLED_OK)


# ---------------------------------------------------------------------------
# DELETE statement — removes existing base rows for the workspace + window.
# Plain MergeTree → ALTER TABLE ... DELETE for idempotent full-recompute.
# ---------------------------------------------------------------------------
_DELETE_SQL = """
ALTER TABLE brain.workspace_daily_metrics_base
DELETE WHERE workspace_id = %(workspace_id)s
  AND date >= toDate(%(date_start)s)
  AND date <= toDate(%(date_end)s)
"""


def recompute_daily_metrics(
    workspace_id: str,
    date_start: str,
    date_end: str,
    *,
    ch_client: Any = None,
) -> int:
    """Idempotent full recompute: connector_*_facts → workspace_daily_metrics_base.

    @paradigm: sql
    CF-C4-COGS-MV-REFRESH-1: full DELETE + INSERT per the canon.
    CF-C4-RATIO-DIVOP-1: no `/` in the rollup SQL (sums only; ratios in MV 0002).

    The materialized view 0002 (workspace_daily_metrics_mv) fires on INSERT
    into base and populates workspace_daily_metrics_computed — so after this
    function returns, query_gateway.query_metrics() returns real data.

    Args:
        workspace_id: the workspace to recompute. Must be non-empty (fail-closed).
        date_start: inclusive window start, ISO format 'YYYY-MM-DD'.
        date_end:   inclusive window end,   ISO format 'YYYY-MM-DD'.
        ch_client:  ClickHouse client (test injection). If None, created from env.

    Returns:
        Row count inserted into workspace_daily_metrics_base.

    Raises:
        ValueError: if workspace_id is falsy.
        EnvironmentError: if CLICKHOUSE_HOST missing and ch_client not injected.
    """
    if not workspace_id or not workspace_id.strip():
        raise ValueError(
            "recompute_daily_metrics: workspace_id must not be empty. "
            "CF-C4-QUERY-SCOPE-ISOLATION-1."
        )

    client = ch_client if ch_client is not None else _make_default_client()
    params = {
        "workspace_id": workspace_id,
        "date_start": date_start,
        "date_end": date_end,
    }

    # Step 1: Issue DELETE mutation for existing base rows in the window.
    # CF-C4-COGS-MV-REFRESH-1: full recompute, not incremental.
    # ALTER TABLE ... DELETE is async in CH MergeTree. We follow it with an
    # OPTIMIZE FINAL on the affected partitions to force immediate merge/dedup
    # before the INSERT, ensuring idempotency (ReplacingMergeTree model).
    logger.info(
        "recompute_daily_metrics: DELETE workspace=%s window=[%s, %s]",
        workspace_id, date_start, date_end,
    )
    client.command(_DELETE_SQL, parameters=params)

    # Step 2: Force the mutation + previous version collapse to complete.
    # OPTIMIZE TABLE FINAL on each affected YYYYMM partition flushes the
    # delete mutation and collapses ReplacingMergeTree versions synchronously.
    # This makes the subsequent INSERT see a clean slate (true idempotency).
    _optimize_partitions(client, date_start, date_end)

    # Step 3: INSERT rollup from connector facts.
    logger.info(
        "recompute_daily_metrics: INSERT workspace=%s window=[%s, %s]",
        workspace_id, date_start, date_end,
    )
    client.command(_ROLLUP_INSERT_SQL, parameters=params)

    # Step 4: Count rows in base for verification / caller reporting.
    # Use FINAL to respect ReplacingMergeTree deduplication semantics.
    count_result = client.query(
        "SELECT count() FROM brain.workspace_daily_metrics_base FINAL "
        "WHERE workspace_id = %(workspace_id)s "
        "AND date >= toDate(%(date_start)s) "
        "AND date <= toDate(%(date_end)s)",
        parameters=params,
    )
    row_count: int = count_result.result_rows[0][0] if count_result.result_rows else 0

    logger.info(
        "recompute_daily_metrics: DONE workspace=%s window=[%s, %s] rows_in_base=%d",
        workspace_id, date_start, date_end, row_count,
    )
    return row_count


def _optimize_partitions(client: Any, date_start: str, date_end: str) -> None:
    """OPTIMIZE FINAL the YYYYMM partitions spanning the date window.

    Forces the pending DELETE mutation to complete and collapses ReplacingMergeTree
    duplicates before the next INSERT. This is the synchronous idempotency guarantee.

    CH's OPTIMIZE TABLE ... PARTITION ... FINAL blocks until the operation is done.
    Acceptable for a background recompute job; not suitable for latency-sensitive paths.
    """
    from datetime import date as _date, timedelta as _timedelta

    start = _date.fromisoformat(date_start)
    end = _date.fromisoformat(date_end)

    # Collect unique YYYYMM partition IDs spanning the window.
    partitions: set[str] = set()
    current = start.replace(day=1)
    while current <= end:
        partitions.add(current.strftime("%Y%m"))
        # Advance to the first of the next month.
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1, day=1)
        else:
            current = current.replace(month=current.month + 1, day=1)

    for partition in sorted(partitions):
        sql = (
            f"OPTIMIZE TABLE brain.workspace_daily_metrics_base "
            f"PARTITION {partition} FINAL"
        )
        logger.debug("recompute_daily_metrics: OPTIMIZE partition=%s", partition)
        client.command(sql)
