"""
query.py — Brand Fingerprint pgvector query primitive.

@paradigm: sql  (vector-search + aggregate query — no LLM)

CF-C5-MEMORY-1: Memory-Layer queries are READ-ONLY and extend existing memory.*
    / ai.* schemas.  No new memory store is created.

ANONYMITY DESIGN (C5-SEC-001 fix):
    Cross-brand benchmarks MUST NOT return identifiable per-brand data.
    The source is ai.cross_brand_pattern (a pre-aggregated cohort table,
    populated by an aggregate job, NOT read through the brand_fingerprint
    RLS policy).  ai.cross_brand_pattern has a CHECK constraint:
        brand_count >= MIN_K_CROSS_BRAND (5)
    guaranteeing k-anonymity at the storage layer.

    query_cross_brand_cohort() reads ONLY from ai.cross_brand_pattern:
      - Returns a CrossBrandAggregate (cohort medians/percentiles).
      - NEVER returns workspace_id or per-brand metrics.
      - If brand_count < MIN_K_CROSS_BRAND (should be impossible given CHECK,
        but double-enforced) → returns None (caller treats as no data).

    RLS reconciliation:
        memory.brand_fingerprint is RLS-scoped per workspace (workspace_id =
        current_setting('app.workspace_id')).  Cross-brand reads do NOT go
        through brand_fingerprint — they read ai.cross_brand_pattern which is
        populated by a background aggregate job running as a SECURITY DEFINER
        function and writing only cohorts of ≥5 brands.  This closes the
        RLS-vs-cross-brand contradiction: no RLS relaxation is needed.

16-dim Brand Fingerprint vector (for build_brand_fingerprint only — own-brand):
    [0]  cm2_pct_bp        — CM2% basis points (e.g. 2000 = 20%)
    [1]  cm3_pct_bp        — CM3% basis points
    [2]  rto_rate_bp       — RTO % basis points
    [3]  prepaid_rate_bp   — Prepaid % basis points
    [4]  aov_mu_log10_x100 — log10(AOV in paise) × 100 (range scale)
    [5]  ad_spend_pct_bp   — Ad spend % of net sales
    [6]  nc_pct_bp         — New customer % basis points
    [7]  cogs_pct_bp       — COGS% basis points
    [8]  orders_log10_x100 — log10(monthly orders) × 100
    [9]  revenue_log10_x100
    [10] cm1_pct_bp
    [11] net_profit_pct_bp
    [12] mer_x100          — MER × 100 (e.g. 350 = 3.5x)
    [13] refund_rate_bp
    [14] conversion_rate_bp
    [15] sku_count_log10_x100
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from brain_cost_router import paradigm

logger = logging.getLogger(__name__)

# Minimum cohort size for cross-brand benchmark queries (CF-C5-MEMORY-1).
# ai.cross_brand_pattern enforces this with a CHECK constraint.
# query_cross_brand_cohort() double-enforces it in Python.
MIN_K_CROSS_BRAND = 5


# ---------------------------------------------------------------------------
# Cross-brand aggregate result (ANONYMOUS — no workspace_id, no per-brand row)
# C5-SEC-001 fix: replaced SimilarBrandResult (identifiable) with cohort aggregate.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CrossBrandAggregate:
    """Anonymized cohort aggregate from ai.cross_brand_pattern.

    ALL values are cohort-level statistics (median / pXX) over ≥MIN_K_CROSS_BRAND
    brands.  No workspace_id.  No per-brand row.  Safe to include in any prompt.

    brand_count: number of brands in the cohort (always ≥ MIN_K_CROSS_BRAND).
    cohort_label: category/region descriptor for the cohort (e.g. "fashion_india").
    cm2_pct_bp_p50: median CM2% in basis points across the cohort.
    cm3_pct_bp_p50: median CM3% in basis points.
    rto_rate_bp_p50: median RTO% in basis points.
    """
    brand_count: int               # ≥ MIN_K_CROSS_BRAND (enforced)
    cohort_label: str              # category+region descriptor
    cm2_pct_bp_p50: int | None     # cohort median CM2% bp
    cm3_pct_bp_p50: int | None     # cohort median CM3% bp
    rto_rate_bp_p50: int | None    # cohort median RTO% bp


# ---------------------------------------------------------------------------
# Cross-brand cohort query (ANONYMOUS aggregate source)
# ---------------------------------------------------------------------------

@paradigm("sql")
def query_cross_brand_cohort(
    workspace_id: str,
    cohort_label: str,
    *,
    _conn: Any = None,
) -> CrossBrandAggregate | None:
    """Query the anonymized cross-brand cohort aggregate from ai.cross_brand_pattern.

    @paradigm: sql — aggregate query against a pre-aggregated table, no LLM.
    C5-SEC-001 fix: reads from ai.cross_brand_pattern (cohort aggregates,
    NO workspace_id, NO per-brand row) — NOT from memory.brand_fingerprint.

    ai.cross_brand_pattern is populated by a background aggregate job
    (SECURITY DEFINER) that writes only cohorts of ≥MIN_K_CROSS_BRAND brands.
    This avoids the RLS contradiction: no RLS relaxation is needed.

    k-anonymity guarantee:
      - ai.cross_brand_pattern has CHECK (brand_count >= 5) at storage.
      - This function double-checks: brand_count < MIN_K_CROSS_BRAND → None.
      - If cohort not found → None (graceful degradation; narration proceeds
        without cross-brand context — it is advisory, not required).

    Args:
        workspace_id: the requesting workspace (telemetry/audit only;
            NOT in the WHERE clause — the aggregate table has no per-brand row).
        cohort_label: cohort identifier (e.g. "fashion_india_mid").
            Resolved by the PnlContextBuilder from the workspace's category/region.
        _conn: (test injection) DB connection.  None → graceful degradation.

    Returns:
        CrossBrandAggregate with cohort-level statistics, or None if no data.
        NEVER returns workspace_id or per-brand metrics.
    """
    if not workspace_id or not workspace_id.strip():
        logger.error(
            "query_cross_brand_cohort: falsy workspace_id=%r — refusing. "
            "CF-C5-MEMORY-1.",
            workspace_id,
        )
        return None

    if _conn is None:
        logger.debug(
            "query_cross_brand_cohort: no connection (workspace_id=%r). "
            "Memory Layer context skipped — graceful degradation.",
            workspace_id,
        )
        return None

    # Query ai.cross_brand_pattern — cohort aggregates only.
    # This table has NO workspace_id column; NO per-brand row.
    # brand_count CHECK >= MIN_K_CROSS_BRAND enforced at storage.
    query_sql = """
        SELECT
            brand_count,
            cohort_label,
            cm2_pct_bp_p50,
            cm3_pct_bp_p50,
            rto_rate_bp_p50
        FROM ai.cross_brand_pattern
        WHERE cohort_label = $1
        ORDER BY computed_at DESC
        LIMIT 1
    """.strip()

    try:
        rows = _conn.fetch(query_sql, cohort_label)
    except Exception as exc:
        logger.warning(
            "query_cross_brand_cohort: DB error (workspace_id=%r cohort=%r): %s. "
            "Returning None — Memory Layer graceful degradation.",
            workspace_id,
            cohort_label,
            exc,
        )
        return None

    if not rows:
        logger.debug(
            "query_cross_brand_cohort: no cohort data for label=%r (workspace_id=%r). "
            "Memory Layer context skipped.",
            cohort_label,
            workspace_id,
        )
        return None

    row = rows[0]
    brand_count = int(row["brand_count"])

    # Double-enforce k-anonymity: storage CHECK should prevent this, but we
    # guard at the Python layer as well (defense in depth).
    if brand_count < MIN_K_CROSS_BRAND:
        logger.warning(
            "query_cross_brand_cohort: cohort brand_count=%d < MIN_K=%d for "
            "label=%r (workspace_id=%r). Refusing to return — anonymity not met. "
            "CF-C5-MEMORY-1 / C5-SEC-001.",
            brand_count,
            MIN_K_CROSS_BRAND,
            cohort_label,
            workspace_id,
        )
        return None  # k-anonymity not met → return EMPTY, never leak partial cohort

    return CrossBrandAggregate(
        brand_count=brand_count,
        cohort_label=str(row["cohort_label"]),
        cm2_pct_bp_p50=row["cm2_pct_bp_p50"],
        cm3_pct_bp_p50=row["cm3_pct_bp_p50"],
        rto_rate_bp_p50=row["rto_rate_bp_p50"],
    )


@paradigm("sql")
def build_brand_fingerprint(
    cm2_pct_bp: int,
    cm3_pct_bp: int,
    rto_rate_bp: int | None,
    prepaid_rate_bp: int | None,
    aov_mu: int | None,
    ad_spend_pct_bp: int,
    nc_pct_bp: int | None,
    cogs_pct_bp: int,
    total_orders: int,
    net_sales_mu: int,
    cm1_pct_bp: int,
    net_profit_pct_bp: int,
    mer_x100: int | None,
    refund_rate_bp: int | None,
    conversion_rate_bp: int | None,
    sku_count: int | None,
    *,
    workspace_id: str = "unknown",
) -> list[float]:
    """Build a 16-dim Brand Fingerprint embedding from canonical metric values.

    @paradigm: sql — pure integer arithmetic + log scaling, no LLM.
    CF-C5-MEMORY-1: this is the embedding that is stored in
    memory.brand_fingerprint and queried for cross-brand benchmarks.

    Returns a 16-element float list for pgvector storage.
    All inputs are canonical integers (basis points or minor units).
    """
    import math

    def log10_x100(v: int | None) -> float:
        if v is None or v <= 0:
            return 0.0
        return math.log10(v) * 100.0

    def safe(v: int | None, default: float = 0.0) -> float:
        return float(v) if v is not None else default

    return [
        safe(cm2_pct_bp),
        safe(cm3_pct_bp),
        safe(rto_rate_bp),
        safe(prepaid_rate_bp),
        log10_x100(aov_mu),
        safe(ad_spend_pct_bp),
        safe(nc_pct_bp),
        safe(cogs_pct_bp),
        log10_x100(total_orders),
        log10_x100(net_sales_mu),
        safe(cm1_pct_bp),
        safe(net_profit_pct_bp),
        safe(mer_x100),
        safe(refund_rate_bp),
        safe(conversion_rate_bp),
        log10_x100(sku_count),
    ]
