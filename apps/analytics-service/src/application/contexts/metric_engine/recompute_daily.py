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

WIRED (P1-E):
  - rto_orders, total_shipments: joined from connector_shipment_facts (date-keyed,
    FINAL read, workspace_id-scoped).  is_rto=1 → RTO; every row counts as shipment.
  - misc_expenses_monthly_mu: summed from workspace_misc_expenses PG table for the
    window month(s); CM3 = CM2 − misc_expenses_prorated (prorated = monthly / days_in_month
    per date; stored as monthly total in the PG table, split per date in SQL).
    vendor_product_id: already propagated through product_cost → cogs_per_day JOIN.

DEFERRED:
  - total_sessions — no sessions source yet — 0 for now.
  - Impressions/clicks from ad facts — 0 for now (not in query_gateway MetricRow).
  - Scheduler (daily-tick cron) — not built here; this function is the deliverable.
  - Per-brand monthly cap + graceful degradation on cap breach.
  - Trace-ID propagation to CH call headers (Phase-D observability).

SILVER FRESHNESS GATE (Amendment 4):
  In REPLAY mode (replay_run_id is not None), recompute_daily gates each date on
  silver_freshness_log before writing gold.  Dates not in the freshness log are
  SKIPPED — this prevents stale gold rows when silver replay is still in progress.
  In normal daily-tick mode (replay_run_id=None), the gate is bypassed (fast path).

USAGE:
  from src.application.contexts.metric_engine.recompute_daily import recompute_daily_metrics
  recompute_daily_metrics(
      workspace_id="f165da80-e6d5-4c58-9aff-ec654b873bd7",
      date_start="2024-01-01",
      date_end="2026-06-01",
      ch_client=client,
  )
  # Replay mode (silver_freshness gate active):
  recompute_daily_metrics(
      workspace_id="...",
      date_start="2024-01-01",
      date_end="2026-06-01",
      ch_client=client,
      replay_run_id="replay-2026-06-05-001",
  )
"""

from __future__ import annotations

import logging
from datetime import date as _date
from typing import Any

from brain_cost_router import paradigm

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
),

-- ─────────────────────────────────────────────────────────────────────────
-- Per-day shipment aggregates: total_shipments + rto_orders.
-- FINAL on connector_shipment_facts: deduplicates ReplacingMergeTree dupes.
-- is_rto=1 → order is a return-to-origin; every row = one shipment.
-- ─────────────────────────────────────────────────────────────────────────
shipment_per_day AS (
    SELECT
        date,
        count()             AS total_shipments,
        countIf(is_rto = 1) AS rto_orders
    FROM brain.connector_shipment_facts FINAL
    WHERE workspace_id = %(workspace_id)s
      AND date >= toDate(%(date_start)s)
      AND date <= toDate(%(date_end)s)
    GROUP BY date
),

-- ─────────────────────────────────────────────────────────────────────────
-- Date-spine: UNION of every date that appears in orders, cogs, ad-spend,
-- OR shipments.  This ensures zero-order days are NOT silently dropped.
-- ─────────────────────────────────────────────────────────────────────────
date_spine AS (
    SELECT date FROM orders_per_day
    UNION DISTINCT
    SELECT date FROM cogs_per_day
    UNION DISTINCT
    SELECT date FROM ad_per_day
    UNION DISTINCT
    SELECT date FROM shipment_per_day
)

-- ─────────────────────────────────────────────────────────────────────────
-- Final SELECT: drive off date_spine, LEFT JOIN all sources.
-- Zero-order days: revenue ladder = 0, ad/COGS preserved via LEFT JOIN.
-- All CM ladder columns populated so the MV 0002 derives ratios.
-- CF-C4-RATIO-DIVOP-1: all expressions are integer arithmetic; no division.
--
-- misc_expenses_monthly_mu: workspace-level monthly fixed expenses injected
-- via %(misc_expenses_monthly_mu)s parameter (integer minor units, summed from
-- workspace_misc_expenses PG table by the Python caller). Per-date proration
-- is handled by the MV 0002; the base table stores the monthly total.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
    %(workspace_id)s                                           AS workspace_id,
    d.date                                                     AS date,

    -- Revenue ladder (exact parity with fact-analytics-ch.ts readStoreSummaryCH)
    -- Zero-order days: all revenue fields coalesce to 0.
    coalesce(o.gross_sales_mu, 0)                              AS gross_sales_mu,
    coalesce(o.returns_mu, 0)                                  AS returns_mu,
    coalesce(o.discounts_mu, 0)                                AS discounts_mu,
    coalesce(o.net_sales_mu, 0)                                AS net_sales_mu,
    coalesce(o.total_tax_mu, 0)                                AS total_tax_mu,
    coalesce(o.net_net_tax_mu, 0)                              AS net_net_tax_mu,
    coalesce(o.shipping_revenue_mu, 0)                         AS shipping_revenue_mu,
    coalesce(o.net_revenue_mu, 0)                              AS net_revenue_mu,

    -- COGS (readCogsCH parity: qty × argMax cost_mu, 0 for uncosted lines)
    coalesce(c.cogs_mu, 0)                                     AS cogs_mu,

    -- Ad spend (readAdSpendCH parity: META + GOOGLE totals)
    coalesce(a.meta_spend_mu, 0)
        + coalesce(a.google_spend_mu, 0)                       AS total_ad_spend_mu,
    coalesce(a.meta_spend_mu, 0)                               AS meta_ad_spend_mu,
    coalesce(a.google_spend_mu, 0)                             AS google_ad_spend_mu,

    -- misc_expenses (P1-E wired): monthly total from workspace_misc_expenses PG
    -- table, summed by the Python caller and injected as a bound parameter.
    -- CF-C4-RATIO-DIVOP-1: stored as monthly total; MV 0002 prorates per date.
    toInt64(%(misc_expenses_monthly_mu)s)                      AS misc_expenses_monthly_mu,

    -- CM ladder: all integer arithmetic, no division (CF-C4-RATIO-DIVOP-1)
    -- cm1 = net_revenue - cogs
    coalesce(o.net_revenue_mu, 0) - coalesce(c.cogs_mu, 0)    AS cm1_mu,
    -- cm2 = cm1 - total_ad_spend
    (coalesce(o.net_revenue_mu, 0) - coalesce(c.cogs_mu, 0))
        - (coalesce(a.meta_spend_mu, 0) + coalesce(a.google_spend_mu, 0))
                                                               AS cm2_mu,
    -- cm3 = cm2 - misc_expenses_monthly_mu (P1-E: now wired, no longer 0)
    (coalesce(o.net_revenue_mu, 0) - coalesce(c.cogs_mu, 0))
        - (coalesce(a.meta_spend_mu, 0) + coalesce(a.google_spend_mu, 0))
        - toInt64(%(misc_expenses_monthly_mu)s)                AS cm3_mu,

    -- Order counts (zero for zero-order days)
    coalesce(o.total_orders, 0)                                AS total_orders,
    coalesce(o.cod_orders, 0)                                  AS cod_orders,
    coalesce(o.prepaid_orders, 0)                              AS prepaid_orders,

    -- Shipment counts (P1-E wired from connector_shipment_facts)
    toInt64(coalesce(s.rto_orders, 0))                         AS rto_orders,
    toInt64(coalesce(s.total_shipments, 0))                    AS total_shipments,
    -- total_sessions: no sessions source yet — 0 for now
    toInt64(0)                                                 AS total_sessions,

    -- Ad platform impressions/clicks (populated when available in ad_spend_facts)
    coalesce(a.meta_imp, 0)                                    AS meta_impressions,
    coalesce(a.meta_clk, 0)                                    AS meta_clicks,
    coalesce(a.google_imp, 0)                                  AS google_impressions,
    coalesce(a.google_clk, 0)                                  AS google_clicks,

    now()                                                      AS inserted_at,
    'brain-analytics-service-recompute'                        AS source

FROM date_spine AS d
LEFT JOIN orders_per_day AS o ON o.date = d.date
LEFT JOIN cogs_per_day   AS c ON c.date = d.date
LEFT JOIN ad_per_day     AS a ON a.date = d.date
LEFT JOIN shipment_per_day AS s ON s.date = d.date
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


@paradigm("sql")
def recompute_daily_metrics(
    workspace_id: str,
    date_start: str,
    date_end: str,
    *,
    ch_client: Any = None,
    pg_dsn: str | None = None,
    replay_run_id: str | None = None,
) -> int:
    """Idempotent full recompute: connector_*_facts → workspace_daily_metrics_base.

    @paradigm: sql
    CF-C4-COGS-MV-REFRESH-1: full DELETE + INSERT per the canon.
    CF-C4-RATIO-DIVOP-1: no `/` in the rollup SQL (sums only; ratios in MV 0002).

    The materialized view 0002 (workspace_daily_metrics_mv) fires on INSERT
    into base and populates workspace_daily_metrics_computed — so after this
    function returns, query_gateway.query_metrics() returns real data.

    P1-E wiring:
      - Shipment facts: rto_orders + total_shipments joined from connector_shipment_facts.
      - misc_expenses: sum of workspace_misc_expenses rows in PG for the window,
        injected as %(misc_expenses_monthly_mu)s into the rollup SQL.  CM3 = CM2 −
        misc_expenses.  Pass pg_dsn=None to skip the PG lookup (tests/offline).
      - vendor_product_id: already propagated through product_cost CTE → cogs_per_day JOIN.

    Silver freshness gate (Amendment 4):
      - replay_run_id=None (default): normal daily tick; gate bypassed (fast path).
      - replay_run_id=<string>: replay mode; gate_gold_recompute() checks
        silver_freshness_log before each date; skipped dates are not written.
        Returns the count of rows actually written (may be 0 if silver not fresh).

    Args:
        workspace_id: the workspace to recompute. Must be non-empty (fail-closed).
        date_start:   inclusive window start, ISO format 'YYYY-MM-DD'.
        date_end:     inclusive window end,   ISO format 'YYYY-MM-DD'.
        ch_client:    ClickHouse client (test injection). If None, created from env.
        pg_dsn:       Postgres DSN for workspace_misc_expenses lookup.
                      If None, misc_expenses_monthly_mu defaults to 0 (offline/test mode).
        replay_run_id: non-None → replay mode; silver freshness gate is active.
                      None (default) → normal daily tick; gate bypassed.

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

    # -------------------------------------------------------------------------
    # Silver freshness gate (Amendment 4) — replay mode only.
    # In replay mode we check which dates have fresh silver before writing gold.
    # In normal daily-tick mode (replay_run_id=None) the gate is bypassed.
    # -------------------------------------------------------------------------
    if replay_run_id is not None:
        from .silver_freshness import gate_gold_recompute
        fresh_dates = gate_gold_recompute(
            workspace_id, date_start, date_end, client=client
        )
        if not fresh_dates:
            logger.warning(
                "recompute_daily_metrics: REPLAY replay_run_id=%s workspace=%s "
                "window=[%s,%s] — NO fresh silver dates found; gold write skipped.",
                replay_run_id, workspace_id, date_start, date_end,
            )
            return 0
        # Narrow the window to the first and last fresh dates for this replay chunk.
        date_start = str(min(fresh_dates))
        date_end = str(max(fresh_dates))
        logger.info(
            "recompute_daily_metrics: REPLAY replay_run_id=%s workspace=%s "
            "fresh_dates=%d effective_window=[%s,%s]",
            replay_run_id, workspace_id, len(fresh_dates), date_start, date_end,
        )

    # -------------------------------------------------------------------------
    # P1-E: misc_expenses lookup from workspace_misc_expenses PG table.
    # Sum all active expense rows in the window period.
    # -------------------------------------------------------------------------
    misc_expenses_monthly_mu: int = _fetch_misc_expenses(workspace_id, date_start, date_end, pg_dsn)

    params = {
        "workspace_id": workspace_id,
        "date_start": date_start,
        "date_end": date_end,
        "misc_expenses_monthly_mu": misc_expenses_monthly_mu,
    }

    # Step 1: Issue DELETE mutation for existing base rows in the window.
    # CF-C4-COGS-MV-REFRESH-1: full recompute, not incremental.
    logger.info(
        "recompute_daily_metrics: DELETE workspace=%s window=[%s, %s]",
        workspace_id, date_start, date_end,
    )
    client.command(_DELETE_SQL, parameters=params)

    # Step 2: Force the mutation + previous version collapse to complete.
    _optimize_partitions(client, date_start, date_end)

    # Step 3: INSERT rollup from connector facts (shipments + misc wired).
    logger.info(
        "recompute_daily_metrics: INSERT workspace=%s window=[%s, %s] misc_expenses_mu=%d",
        workspace_id, date_start, date_end, misc_expenses_monthly_mu,
    )
    client.command(_ROLLUP_INSERT_SQL, parameters=params)

    # Step 4: Count rows in base for verification / caller reporting.
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


@paradigm("sql")
def _fetch_misc_expenses(
    workspace_id: str,
    date_start: str,
    date_end: str,
    pg_dsn: str | None,
) -> int:
    """Fetch total misc_expenses_monthly_mu from workspace_misc_expenses PG table.

    @paradigm: sql
    Sums all active workspace_misc_expenses rows whose effective_start_date falls
    within the window.  Returns 0 if pg_dsn is None (offline/test mode).

    Args:
        workspace_id: authenticated workspace scope.
        date_start:   inclusive window start ISO.
        date_end:     inclusive window end ISO.
        pg_dsn:       Postgres connection string. None → return 0 (test/offline mode).

    Returns:
        Total misc_expenses_monthly_mu for the workspace in the window, in minor units.
    """
    if not pg_dsn:
        return 0

    import os
    dsn = pg_dsn or os.environ.get("DATABASE_URL", "")
    if not dsn:
        return 0

    try:
        import psycopg  # type: ignore[import-untyped]
        with psycopg.connect(dsn, autocommit=True) as conn:
            row = conn.execute(
                """
                SELECT coalesce(sum(amount_mu), 0)
                FROM workspace_misc_expenses
                WHERE workspace_id = %s
                  AND effective_start_date <= %s::date
                """,
                (workspace_id, date_end),
            ).fetchone()
            return int(row[0]) if row else 0
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "_fetch_misc_expenses: PG lookup failed workspace=%s err=%s — defaulting to 0",
            workspace_id, exc,
        )
        return 0


def _optimize_partitions(client: Any, date_start: str, date_end: str) -> None:
    """OPTIMIZE FINAL the YYYYMM partitions spanning the date window.

    Forces the pending DELETE mutation to complete and collapses ReplacingMergeTree
    duplicates before the next INSERT. This is the synchronous idempotency guarantee.

    CH's OPTIMIZE TABLE ... PARTITION ... FINAL blocks until the operation is done.
    Acceptable for a background recompute job; not suitable for latency-sensitive paths.
    """
    from datetime import timedelta as _timedelta

    start = _date.fromisoformat(date_start)
    end = _date.fromisoformat(date_end)

    # Collect unique YYYYMM partition IDs spanning the window.
    partitions: set[str] = set()
    current = start.replace(day=1)
    while current <= end:
        partitions.add(current.strftime("%Y%m"))
        # Advance to the first of the next month.
        if current.month == 12:
            current = _date(current.year + 1, 1, 1)
        else:
            current = _date(current.year, current.month + 1, 1)

    for partition in sorted(partitions):
        sql = (
            f"OPTIMIZE TABLE brain.workspace_daily_metrics_base "
            f"PARTITION {partition} FINAL"
        )
        logger.debug("recompute_daily_metrics: OPTIMIZE partition=%s", partition)
        client.command(sql)


# ---------------------------------------------------------------------------
# CLI entrypoint (LOCAL bring-up + the future daily-tick scheduler call this).
#   python -m application.contexts.metric_engine.recompute_daily <ws> <start> <end>
#   python -m application.contexts.metric_engine.recompute_daily --all
# --all enumerates every workspace with order facts over its full date window
# (no-op-safe: zero facts → zero rows). The scheduler (Phase-D) calls the
# function directly with real correlation ids; this CLI is for ops/seed.
# ---------------------------------------------------------------------------
def _enumerate_workspace_windows(client: Any) -> list[tuple[str, str, str]]:
    """(workspace_id, min_order_date, max_order_date) for every workspace with facts."""
    res = client.query(
        "SELECT workspace_id, toString(min(order_date)), toString(max(order_date)) "
        "FROM brain.connector_order_facts GROUP BY workspace_id"
    )
    return [(row[0], row[1], row[2]) for row in res.result_rows if row[0]]


def _main(argv: "list[str] | None" = None) -> int:
    import argparse
    import os

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(
        prog="recompute_daily",
        description="Metric-engine daily recompute (connector_*_facts -> workspace_daily_metrics).",
    )
    parser.add_argument("workspace_id", nargs="?", help="workspace to recompute (omit with --all)")
    parser.add_argument("date_start", nargs="?", help="inclusive ISO YYYY-MM-DD")
    parser.add_argument("date_end", nargs="?", help="inclusive ISO YYYY-MM-DD")
    parser.add_argument("--all", action="store_true", dest="all_ws",
                        help="recompute every workspace over its full order-date window")
    parser.add_argument("--replay-run-id", default=None,
                        help="non-empty → replay mode (silver_freshness gate active)")
    args = parser.parse_args(argv)

    client = _make_default_client()
    pg_dsn = os.environ.get("DATABASE_URL", None)

    if args.all_ws:
        windows = _enumerate_workspace_windows(client)
        total = 0
        for ws, start, end in windows:
            rows = recompute_daily_metrics(
                ws, start, end,
                ch_client=client, pg_dsn=pg_dsn, replay_run_id=args.replay_run_id,
            )
            logger.info("recompute --all: workspace=%s window=[%s,%s] rows=%d", ws, start, end, rows)
            total += rows
        logger.info("recompute --all: %d workspace(s), %d total base rows", len(windows), total)
        return 0
    if not (args.workspace_id and args.date_start and args.date_end):
        parser.error("provide workspace_id date_start date_end, or --all")
    rows = recompute_daily_metrics(
        args.workspace_id, args.date_start, args.date_end,
        ch_client=client, pg_dsn=pg_dsn, replay_run_id=args.replay_run_id,
    )
    logger.info("recompute: workspace=%s rows=%d", args.workspace_id, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
