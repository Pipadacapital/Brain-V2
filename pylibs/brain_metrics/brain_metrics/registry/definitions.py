"""
registry/definitions.py — Canonical metric definitions for Brain.

@paradigm: sql (pure integer arithmetic; no float in money/ratio; no LLM)
Justified: every metric is a deterministic formula. The Python formulas are
byte-identical to the TS counterpart in packages/lib-metrics/src/registry/.
Money stored as _mu BIGINT; ratios as _bp INT32 FLOOR(×10,000); counts INT64.
CF-C4-DDR-1, CF-C4-RATIO-DIVOP-1.

DO NOT import floating-point math anywhere in this file.
DO NOT call any LLM or ML model from this file.
Formula callables receive integer minor-unit inputs and return integers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

MetricKind = Literal["money", "ratio", "count"]
MetricUnit = Literal["mu", "bp", "count"]
ParityClass = Literal["shadow_compare", "correctness_fixture"]

# Integer FLOOR basis-points scale (matches ratio_to_basis_points / ratioToBasisPoints)
_BP_SCALE = 10_000


# ---------------------------------------------------------------------------
# MetricDefinition — byte-identity pair with TS MetricDefinition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MetricDefinition:
    """A single canonical metric definition.

    Byte-identity contract (CF-C4-DDR-1):
    - `id` maps 1:1 to the TS registry id (snake_case Python ↔ camelCase TS)
    - `formula_py` must produce the same integer as `formula_ts` for any input
    - `clickhouse_sql` is the MV expression that materializes the metric
    - `parity_class` determines which gate verifies this metric:
        * "shadow_compare"      — exact-equality vs legacy value in parity harness
        * "correctness_fixture" — Brain-native (parity_gap:true); no legacy comparand;
                                  verified by a worked-example correctness fixture gate

    CF-C6-ROAS-DISPLAY-CONTRACT-1: `scale` field (Child 6, additive).
    The display layer computes displayValue = rawValue / scale:
        10000 = basis-points metric (_bp)
        100   = ×100 integer (blended_roas_x100 — display /100 → "2.50×")
        1     = money (_mu) or count (use formatMoney for money)
    Byte-identity pair: same value in TS registry types.ts.
    The parity gate (check-metrics-parity.sh) asserts scale byte-identity.
    """

    id: str
    kind: MetricKind
    unit: MetricUnit
    formula_py: Callable[..., int]
    clickhouse_sql: str
    display_only: bool = False
    parity_class: ParityClass = "shadow_compare"
    # CF-C6-ROAS-DISPLAY-CONTRACT-1: additive field; default=1 preserves parity for
    # metrics defined before Child 6. Must be set explicitly for bp/x100 metrics.
    scale: Literal[10000, 100, 1] = 1

    def __repr__(self) -> str:
        return (
            f"MetricDefinition(id={self.id!r}, kind={self.kind!r}, "
            f"unit={self.unit!r}, display_only={self.display_only}, "
            f"parity_class={self.parity_class!r})"
        )


# ---------------------------------------------------------------------------
# Formula helpers — pure integer arithmetic, zero float
# ---------------------------------------------------------------------------

def _int_floor_div_or_null(numerator: int, denominator: int) -> int | None:
    """Integer FLOOR division with fail-closed null on zero denominator.

    @paradigm: sql
    Mirrors: if(<denom> > 0, intDiv(<num>, <denom>), NULL) in ClickHouse.
    NEVER use Python '/' (returns float). Always use '//' or this helper.
    CF-C4-RATIO-DIVOP-1.
    """
    if denominator <= 0:
        return None
    return numerator // denominator  # Python '//' is integer FLOOR


def _ratio_bp(numerator: int, denominator: int) -> int | None:
    """Compute FLOOR(numerator × 10,000 / denominator) basis points, null-guarded.

    @paradigm: sql — integer FLOOR, no float.
    Matches ratio_to_basis_points but null-safe for ClickHouse parity.
    CF-C4-RATIO-DIVOP-1.
    """
    return _int_floor_div_or_null(numerator * _BP_SCALE, denominator)


# ---------------------------------------------------------------------------
# Revenue Ladder (§4 / plan §4a)
# Each step: Python formula + ClickHouse MV expression (intDiv + null-guard)
# ---------------------------------------------------------------------------

# ── Gross Sales ───────────────────────────────────────────────────────────
# Legacy: compute-daily.ts — dailyRow.grossSales (Shopify gross_sales field)
# Brain:  SUM(shopify_line_item.price_mu) — same economic event
def _gross_sales_mu(gross_sales_mu: int) -> int:
    """Gross sales: sum of Shopify line item prices (before discounts/tax)."""
    return gross_sales_mu


gross_sales_mu = MetricDefinition(
    id="gross_sales_mu",
    kind="money",
    unit="mu",
    formula_py=_gross_sales_mu,
    clickhouse_sql="toInt64(gross_sales_mu)",  # passthrough; sourced from raw layer
    parity_class="shadow_compare",
)

# ── Total Discount ─────────────────────────────────────────────────────────
def _total_discount_mu(total_discount_mu: int) -> int:
    """Total discounts applied (positive value representing reduction)."""
    return total_discount_mu


total_discount_mu = MetricDefinition(
    id="total_discount_mu",
    kind="money",
    unit="mu",
    formula_py=_total_discount_mu,
    clickhouse_sql="toInt64(total_discount_mu)",
    parity_class="shadow_compare",
)

# ── Total Tax (Net-Net-Tax step) ───────────────────────────────────────────
# Legacy: analytics-sync.ts:42-43,208,256 — ShopifyQL `taxes` DAY-LEVEL aggregate
# Brain:  SUM(event-level per-SKU GST-2.0 line tax via RegionAdapter India)
# DDR row: total_tax_mu — child_dependency: child-3-shopify-connector
# @parity_class: shadow_compare (once Child-3 is complete)
def _total_tax_mu(total_tax_mu: int) -> int:
    """Total tax: Brain = per-SKU event-level GST-2.0 tax sum (RegionAdapter India).
    Legacy = ShopifyQL day-level aggregate. DIFFERENT INGEST PATHS.
    CF-C4-DDR-GST-TAX-1: not signable/measurable pre-Child-3.
    """
    return total_tax_mu


total_tax_mu = MetricDefinition(
    id="total_tax_mu",
    kind="money",
    unit="mu",
    formula_py=_total_tax_mu,
    clickhouse_sql="toInt64(total_tax_mu)",
    parity_class="shadow_compare",
)

# ── Net Sales ──────────────────────────────────────────────────────────────
# Net Sales = Gross Sales - Discounts (legacy compute-daily.ts uses netSales
# from Shopify directly; Brain derives from components for ladder integrity)
def _net_sales_mu(gross_sales_mu: int, total_discount_mu: int) -> int:
    """Net Sales = Gross Sales − Total Discount (pre-tax revenue base).
    Brain canonical: integer subtraction, no float.
    """
    return gross_sales_mu - total_discount_mu


net_sales_mu = MetricDefinition(
    id="net_sales_mu",
    kind="money",
    unit="mu",
    formula_py=_net_sales_mu,
    clickhouse_sql="toInt64(gross_sales_mu - total_discount_mu)",
    parity_class="shadow_compare",
)

# ── Net Revenue (Net Sales − Tax) ─────────────────────────────────────────
# This is the base for CM1. Legacy: netSales from Shopify (already net of discount).
def _net_revenue_mu(net_sales_mu: int, total_tax_mu: int) -> int:
    """Net Revenue = Net Sales − Total Tax.
    Feeds: CM1 = Net Revenue − COGS − Variable Costs.
    """
    return net_sales_mu - total_tax_mu


net_revenue_mu = MetricDefinition(
    id="net_revenue_mu",
    kind="money",
    unit="mu",
    formula_py=_net_revenue_mu,
    clickhouse_sql="toInt64(net_sales_mu - total_tax_mu)",
    parity_class="shadow_compare",
)

# ── Realized Revenue (honest billing base — Brain-native, NO legacy comparand) ──
# Phase-2 slice-1 (feat-store-order-fact-layer). Realized revenue survives the
# post-sale reversals that legacy "net revenue" ignores: cancellations, RTO
# reversals, and refunds. compute-daily.ts stops at the daily revenue figure and
# never subtracts post-sale reversals — so there is NO legacy comparand.
# parity_gap:true → correctness_fixture gate. DDR row _ROW_REALIZED_REVENUE pins
# the formula. clickhouse_sql MUST be byte-identical (whitespace-normalized) to
# the TS counterpart in packages/lib-metrics/src/registry/definitions.ts.
#
# WORKED EXAMPLE (CF-C2-realized-1):
#   net_revenue_mu          = 4_960_000   (₹49,600)
#   cancelled_revenue_mu    =   120_000   (₹1,200)
#   rto_reversed_revenue_mu =   300_000   (₹3,000)
#   refunded_revenue_mu     =    80_000   (₹800)
#   realized_revenue_mu = 4_960_000 − 120_000 − 300_000 − 80_000 = 4_460_000 (₹44,600)
def _realized_revenue_mu(
    net_revenue_mu: int,
    cancelled_revenue_mu: int,
    rto_reversed_revenue_mu: int,
    refunded_revenue_mu: int,
) -> int:
    """Realized Revenue = Net Revenue − Cancelled − RTO-reversed − Refunded.

    @paradigm: sql — integer subtraction, no float, no LLM.
    parity_gap:true — Brain-native; routed to correctness-fixture gate.
    """
    return (
        net_revenue_mu
        - cancelled_revenue_mu
        - rto_reversed_revenue_mu
        - refunded_revenue_mu
    )


realized_revenue_mu = MetricDefinition(
    id="realized_revenue_mu",
    kind="money",
    unit="mu",
    formula_py=_realized_revenue_mu,
    clickhouse_sql=(
        "toInt64(net_revenue_mu - cancelled_revenue_mu "
        "- rto_reversed_revenue_mu - refunded_revenue_mu)"
    ),
    display_only=False,
    parity_class="correctness_fixture",  # parity_gap:true — no legacy comparand
)

# ── COGS ──────────────────────────────────────────────────────────────────
# Legacy: compute-daily.ts — sum of resolveLineItemCogs() per line item (float)
# Brain: SUM(line_item_mu × coq_rate) — integer per-item, full daily recompute
# CF-C4-COGS-MV-REFRESH-1: scheduled full daily recompute, NOT incremental MV
def _cogs_mu(cogs_mu: int) -> int:
    """COGS: per-line-item integer computation, full daily recompute.
    CF-C4-COGS-MV-REFRESH-1: NOT an incremental MV (would be wrong on coq-settings-change).
    """
    return cogs_mu


cogs_mu = MetricDefinition(
    id="cogs_mu",
    kind="money",
    unit="mu",
    formula_py=_cogs_mu,
    clickhouse_sql="toInt64(cogs_mu)",  # sourced from full-recompute scheduled job
    parity_class="shadow_compare",
)

# ── Variable Costs (Shipping + Packaging + Website) ───────────────────────
def _variable_costs_mu(shipping_mu: int, packaging_mu: int, website_charges_mu: int) -> int:
    """Variable costs: shipping + packaging + website charges."""
    return shipping_mu + packaging_mu + website_charges_mu


variable_costs_mu = MetricDefinition(
    id="variable_costs_mu",
    kind="money",
    unit="mu",
    formula_py=_variable_costs_mu,
    clickhouse_sql="toInt64(shipping_mu + packaging_mu + website_charges_mu)",
    parity_class="shadow_compare",
)

# ── CM1 (Contribution Margin 1) ───────────────────────────────────────────
# Legacy: compute-daily.ts:187 — cm1 = netSales - cogs - shipping - packaging - websiteCharges
# Brain: Net Revenue − COGS − Variable Costs (integer)
def _cm1_mu(net_revenue_mu: int, cogs_mu: int, variable_costs_mu: int) -> int:
    """CM1 = Net Revenue − COGS − Variable Costs.
    Legacy reference: compute-daily.ts:187 (cm1 = netSales - cogs - shipping - packaging - website).
    Brain uses net_revenue (post-tax) rather than netSales; feeds DDR row.
    """
    return net_revenue_mu - cogs_mu - variable_costs_mu


cm1_mu = MetricDefinition(
    id="cm1_mu",
    kind="money",
    unit="mu",
    formula_py=_cm1_mu,
    clickhouse_sql="toInt64(net_revenue_mu - cogs_mu - variable_costs_mu)",
    parity_class="shadow_compare",
)

# ── Total Ad Spend ─────────────────────────────────────────────────────────
# Legacy: compute-daily.ts:233 — totalAdSpend = metaAdSpend + googleAdSpend
def _total_ad_spend_mu(meta_ad_spend_mu: int, google_ad_spend_mu: int) -> int:
    """Total ad spend = Meta + Google ad spend (integer sum)."""
    return meta_ad_spend_mu + google_ad_spend_mu


total_ad_spend_mu = MetricDefinition(
    id="total_ad_spend_mu",
    kind="money",
    unit="mu",
    formula_py=_total_ad_spend_mu,
    clickhouse_sql="toInt64(meta_ad_spend_mu + google_ad_spend_mu)",
    parity_class="shadow_compare",
)

# ── CM2 ────────────────────────────────────────────────────────────────────
# Legacy: compute-daily.ts:234 — cm2 = cm1 - totalAdSpend
# CANONICAL path: daily compute-daily.ts. Divergent path: pnl.ts:195 (lagged).
# DDR row: cm2_mu — parity_gap:false, EXPECTED_DEFINITIONAL_DELTA (lagged shipping).
def _cm2_mu(cm1_mu: int, total_ad_spend_mu: int) -> int:
    """CM2 = CM1 − Total Ad Spend.
    Legacy reference: compute-daily.ts:234.
    Brain canonicalizes on the daily path (NOT pnl.ts lagged shipping).
    DDR row: cm2_mu, EXPECTED_DEFINITIONAL_DELTA.
    """
    return cm1_mu - total_ad_spend_mu


cm2_mu = MetricDefinition(
    id="cm2_mu",
    kind="money",
    unit="mu",
    formula_py=_cm2_mu,
    clickhouse_sql="toInt64(cm1_mu - total_ad_spend_mu)",
    parity_class="shadow_compare",
)

# ── Misc Expenses Prorated ─────────────────────────────────────────────────
# Legacy: compute-daily.ts:236-243 — monthlyAmt / getDaysInMonth(dateAtNoonUtc)
# Brain: intDiv(monthly_amount_mu, toDaysInMonth(date)) — NEVER a '30' constant
# CF-C4-PRORATED-DIVOP-1: integer division; Feb-boundary correct.
def _misc_expenses_prorated_mu(monthly_amount_mu: int, days_in_month: int) -> int | None:
    """Misc expenses prorated = intDiv(monthly_amount_mu, days_in_month).

    @paradigm: sql — integer FLOOR division. NEVER use '/' here.
    CF-C4-PRORATED-DIVOP-1: days_in_month comes from toDaysInMonth(date) —
    NEVER a constant 30. Feb = 28 or 29 (leap year), not 30.
    ROUNDING_MODE_MISMATCH: the Postgres ROUND_HALF_UP path produces
    a 1-paise drift on .X45 midpoints. This is an EXPECTED delta,
    NOT a Float64 coercion artifact. See taxonomy.py DIVISION_DERIVED_FIELDS.

    Args:
        monthly_amount_mu: monthly cost in minor units (integer BIGINT)
        days_in_month: calendar days in the month from toDaysInMonth(date)
            (28, 29, 30, or 31 — NEVER a hardcoded constant)

    Returns:
        int: prorated daily cost in minor units (FLOOR), or None if days_in_month <= 0.
    """
    return _int_floor_div_or_null(monthly_amount_mu, days_in_month)


misc_expenses_prorated_mu = MetricDefinition(
    id="misc_expenses_prorated_mu",
    kind="money",
    unit="mu",
    formula_py=_misc_expenses_prorated_mu,
    # CF-C4-PRORATED-DIVOP-1: intDiv + toDaysInMonth(date) — NEVER '/'; NEVER '30'
    clickhouse_sql=(
        "if(toDaysInMonth(date) > 0, "
        "intDiv(monthly_amount_mu, toDaysInMonth(date)), "
        "NULL)"
    ),
    parity_class="shadow_compare",
)

# ── CM3 ────────────────────────────────────────────────────────────────────
# Legacy: compute-daily.ts:245 — cm3 = cm2 - miscExpensesProrated
def _cm3_mu(cm2_mu: int, misc_expenses_prorated_mu: int) -> int:
    """CM3 = CM2 − Misc Expenses Prorated.
    Legacy reference: compute-daily.ts:245.
    """
    return cm2_mu - misc_expenses_prorated_mu


cm3_mu = MetricDefinition(
    id="cm3_mu",
    kind="money",
    unit="mu",
    formula_py=_cm3_mu,
    clickhouse_sql="toInt64(cm2_mu - misc_expenses_prorated_mu)",
    parity_class="shadow_compare",
)

# ---------------------------------------------------------------------------
# True-CM2 (RTO-Provisioned) — Brain-native, NO legacy comparand
# CF-C4-DDR-TRUE-CM2-1 / parity_gap:true / parity_class:"correctness_fixture"
# ---------------------------------------------------------------------------
#
# TRUE-CM2 FORMULA (pinned IN FULL per CF-C4-DDR-TRUE-CM2-1):
#
#   true_cm2_mu = cm2_mu − rto_provision_mu
#
#   where:
#     rto_provision_mu = intDiv(
#         rto_orders × average_rto_reversal_cost_mu,
#         1
#     )
#     = rto_orders × average_rto_reversal_cost_mu
#
#   average_rto_reversal_cost_mu = intDiv(
#       (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#       total_orders_count
#   )
#   (cost-per-order × expected RTO reversal volume)
#
#   Simplified full form:
#     rto_provision_mu = intDiv(
#         rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#         total_orders_count
#     )
#
#   true_cm2_mu = cm2_mu − intDiv(
#       rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#       total_orders_count
#   )
#
# WORKED EXAMPLE (CF-C4-DDR-TRUE-CM2-1 — synthetic Sugandh Lok-style date):
#   Date: 2026-01-15 (31 days in month)
#   total_orders_count   = 120
#   rto_orders           = 18    (15% RTO rate)
#   total_ad_spend_mu    = 50_000_00   (₹50,000 = 5000000 paise)
#   variable_costs_mu    = 12_000_00   (₹12,000 = 1200000 paise)
#   cogs_mu              = 30_000_00   (₹30,000 = 3000000 paise)
#   cm2_mu               = 80_000_00   (₹80,000 = 8000000 paise)
#
#   total_cost_base_mu = 5000000 + 1200000 + 3000000 = 9200000 paise
#   rto_provision_mu   = intDiv(18 × 9200000, 120)
#                      = intDiv(165600000, 120)
#                      = 1380000  (₹13,800 — FLOOR, no remainder here)
#   true_cm2_mu        = 8000000 − 1380000 = 6620000 paise (₹66,200)
#
#   Legacy comparand: NONE (compute-daily.ts stops at cm2 line 234).
#   This metric is BRAIN-NATIVE; routed to correctness-fixture gate.
#   Rohan's Stage-6 sign-off must explicitly acknowledge no legacy shadow.

def _true_cm2_mu(
    cm2_mu: int,
    rto_orders: int,
    total_ad_spend_mu: int,
    variable_costs_mu: int,
    cogs_mu: int,
    total_orders_count: int,
) -> int | None:
    """True CM2 = CM2 − RTO Provision.

    @paradigm: sql — integer FLOOR arithmetic. No float. No LLM.
    CF-C4-DDR-TRUE-CM2-1: parity_gap:true. NO legacy comparand.
    Routed to correctness-fixture gate, NOT shadow-compare.

    RTO Provision = intDiv(
        rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
        total_orders_count
    )

    This provisions the expected reversal cost for returns-in-transit:
    - rto_orders: shiprocket RTO count for the day
    - cost_base: total cost that must be reversed per returned order
    - total_orders_count: order denominator for per-order cost

    Args:
        cm2_mu:              CM2 in minor units (paise)
        rto_orders:          shiprocket RTO order count (integer)
        total_ad_spend_mu:   total ad spend in minor units
        variable_costs_mu:   variable costs (shipping+packaging+website) in minor units
        cogs_mu:             COGS in minor units
        total_orders_count:  total orders count (denominator)

    Returns:
        int: True CM2 in minor units (paise), or None if total_orders_count <= 0.

    Worked example (synthetic):
        rto_orders=18, total_ad_spend_mu=5000000, variable_costs_mu=1200000,
        cogs_mu=3000000, total_orders_count=120, cm2_mu=8000000
        → rto_provision = intDiv(18 × 9200000, 120) = intDiv(165600000, 120) = 1380000
        → true_cm2_mu = 8000000 − 1380000 = 6620000 paise (₹66,200)
    """
    if total_orders_count <= 0:
        return None
    cost_base_mu = total_ad_spend_mu + variable_costs_mu + cogs_mu
    rto_provision_mu = (rto_orders * cost_base_mu) // total_orders_count  # intDiv (FLOOR)
    return cm2_mu - rto_provision_mu


true_cm2_mu = MetricDefinition(
    id="true_cm2_mu",
    kind="money",
    unit="mu",
    formula_py=_true_cm2_mu,
    clickhouse_sql=(
        "if(total_orders_count > 0, "
        "toInt64(cm2_mu - intDiv("
        "rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), "
        "total_orders_count"
        ")), NULL)"
    ),
    display_only=False,
    parity_class="correctness_fixture",  # parity_gap:true — no legacy comparand
)

# ---------------------------------------------------------------------------
# Marketing Efficiency Ratios (Brain-native: paMER, aMER — parity_gap:true)
# ---------------------------------------------------------------------------
#
# paMER (performance-adjusted MER): CM2 / Total Ad Spend
#   Indicates how many ₹ of CM2 each ad rupee generates.
#   paMER_bp = intDiv(cm2_mu × 10000, total_ad_spend_mu)
#
# aMER (adjusted MER = True CM2 / Total Ad Spend):
#   Adjusts MER for RTO provisioning. More conservative than paMER.
#   aMER_bp = intDiv(true_cm2_mu × 10000, total_ad_spend_mu)
#
# Neither has a legacy comparand in compute-daily.ts.
# parity_gap:true → correctness_fixture gate.

def _pamer_bp(cm2_mu: int, total_ad_spend_mu: int) -> int | None:
    """paMER = CM2 / Total Ad Spend in basis points.

    @paradigm: sql — integer FLOOR. No float.
    parity_gap:true — Brain-native metric, no legacy comparand.

    Returns:
        int: paMER in bp (e.g. 16000 = 1.6x = 160%), or None if no ad spend.
    """
    return _ratio_bp(cm2_mu, total_ad_spend_mu)


pamer_bp = MetricDefinition(
    id="pamer_bp",
    kind="ratio",
    unit="bp",
    formula_py=_pamer_bp,
    clickhouse_sql=(
        "if(total_ad_spend_mu > 0, "
        "intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)


def _amer_bp(true_cm2_mu: int, total_ad_spend_mu: int) -> int | None:
    """aMER = True CM2 / Total Ad Spend in basis points.

    @paradigm: sql — integer FLOOR. No float.
    parity_gap:true — Brain-native metric, no legacy comparand.

    Returns:
        int: aMER in bp, or None if no ad spend.
    """
    if true_cm2_mu is None:
        return None
    return _ratio_bp(true_cm2_mu, total_ad_spend_mu)


amer_bp = MetricDefinition(
    id="amer_bp",
    kind="ratio",
    unit="bp",
    formula_py=_amer_bp,
    clickhouse_sql=(
        "if(total_ad_spend_mu > 0 AND total_orders_count > 0, "
        "intDiv("
        "  (cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count))"
        "  * 10000, total_ad_spend_mu"
        "), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ---------------------------------------------------------------------------
# LTV:CAC (Brain-native — parity_gap:true)
# ---------------------------------------------------------------------------
# LTV:CAC ratio = Customer Lifetime Value / Customer Acquisition Cost
# LTV is computed by the lifecycle-service (not this child).
# Here we register the ratio definition for the parity gate.
# Formula: ltv_cac_bp = intDiv(ltv_mu × 10000, cac_mu)
# parity_gap:true — no legacy comparand.

def _ltv_cac_bp(ltv_mu: int, cac_mu: int) -> int | None:
    """LTV:CAC ratio in basis points.

    @paradigm: sql — integer FLOOR. No float.
    parity_gap:true — Brain-native metric, no legacy comparand.

    Returns:
        int: LTV:CAC in bp (e.g. 30000 = 3.0x), or None if CAC is zero.
    """
    return _ratio_bp(ltv_mu, cac_mu)


ltv_cac_bp = MetricDefinition(
    id="ltv_cac_bp",
    kind="ratio",
    unit="bp",
    formula_py=_ltv_cac_bp,
    clickhouse_sql=(
        "if(cac_mu > 0, intDiv(ltv_mu * 10000, cac_mu), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ---------------------------------------------------------------------------
# Display-only ratios (ROAS / ACOS) — display_only:true
# CF-C4 plan: ROAS is never a decision metric (CM2-first). Display only.
# parity_class: shadow_compare (these exist in legacy compute-daily.ts:247-248)
# ---------------------------------------------------------------------------

def _blended_roas_x100(net_sales_mu: int, total_ad_spend_mu: int) -> int | None:
    """Blended ROAS = Net Sales / Ad Spend (×100, display only).

    display_only:true — ROAS is NEVER a decision metric at Brain. CM2-first.
    Legacy reference: compute-daily.ts schema:879-880.
    @paradigm: sql — integer FLOOR (×100 scale, not ×10000).
    """
    return _int_floor_div_or_null(net_sales_mu * 100, total_ad_spend_mu)


blended_roas_x100 = MetricDefinition(
    id="blended_roas_x100",
    kind="ratio",
    unit="bp",  # stored as integer ×100 (not BP scale, but integer ratio)
    formula_py=_blended_roas_x100,
    clickhouse_sql=(
        "if(total_ad_spend_mu > 0, "
        "intDiv(net_sales_mu * 100, total_ad_spend_mu), NULL)"
    ),
    display_only=True,  # CM2-first; ROAS never a decision metric
    parity_class="shadow_compare",
    # CF-C6-ROAS-DISPLAY-CONTRACT-1: scale=100 → display /100 → "2.50×" (NOT /10000 → "0.025%")
    scale=100,
)


def _acos_bp(total_ad_spend_mu: int, net_sales_mu: int) -> int | None:
    """ACOS = Ad Spend / Net Sales in basis points (display only).

    display_only:true — ROAS is NEVER a decision metric at Brain. CM2-first.
    Legacy reference: compute-daily.ts:247.
    """
    return _ratio_bp(total_ad_spend_mu, net_sales_mu)


acos_bp = MetricDefinition(
    id="acos_bp",
    kind="ratio",
    unit="bp",
    formula_py=_acos_bp,
    clickhouse_sql=(
        "if(net_sales_mu > 0, "
        "intDiv(total_ad_spend_mu * 10000, net_sales_mu), NULL)"
    ),
    display_only=True,  # CM2-first; ACOS never a decision metric
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1: bp → scale=10000
)

# ---------------------------------------------------------------------------
# COD / RTO metrics
# ---------------------------------------------------------------------------

def _rto_rate_bp(rto_orders: int, total_shipments: int) -> int | None:
    """RTO rate = RTO orders / Total shipments in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1: intDiv + null-guard.
    Zero-denominator day (no shipments) → NULL (never inf or Int-max).
    """
    return _ratio_bp(rto_orders, total_shipments)


rto_rate_bp = MetricDefinition(
    id="rto_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_rto_rate_bp,
    clickhouse_sql=(
        "if(total_shipments > 0, "
        "intDiv(rto_orders * 10000, total_shipments), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)


def _prepaid_rate_bp(prepaid_orders: int, total_orders: int) -> int | None:
    """Prepaid rate = Prepaid orders / Total orders in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    """
    return _ratio_bp(prepaid_orders, total_orders)


prepaid_rate_bp = MetricDefinition(
    id="prepaid_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_prepaid_rate_bp,
    clickhouse_sql=(
        "if(total_orders > 0, "
        "intDiv(prepaid_orders * 10000, total_orders), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ── AOV (Average Order Value) ──────────────────────────────────────────────
def _aov_mu(net_sales_mu: int, orders_count: int) -> int | None:
    """AOV = Net Sales / Orders Count in minor units.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    """
    return _int_floor_div_or_null(net_sales_mu, orders_count)


aov_mu = MetricDefinition(
    id="aov_mu",
    kind="money",
    unit="mu",
    formula_py=_aov_mu,
    clickhouse_sql=(
        "if(orders_count > 0, "
        "intDiv(net_sales_mu, orders_count), NULL)"
    ),
    parity_class="shadow_compare",
)

# ── Conversion Rate ────────────────────────────────────────────────────────
def _conversion_rate_bp(orders_count: int, sessions: int) -> int | None:
    """Conversion rate = Orders / Sessions in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    """
    return _ratio_bp(orders_count, sessions)


conversion_rate_bp = MetricDefinition(
    id="conversion_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_conversion_rate_bp,
    clickhouse_sql=(
        "if(sessions > 0, "
        "intDiv(orders_count * 10000, sessions), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ── CAC (Customer Acquisition Cost) ───────────────────────────────────────
def _cac_mu(total_ad_spend_mu: int, new_customers_count: int) -> int | None:
    """CAC = Total Ad Spend / New Customers in minor units.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    """
    return _int_floor_div_or_null(total_ad_spend_mu, new_customers_count)


cac_mu = MetricDefinition(
    id="cac_mu",
    kind="money",
    unit="mu",
    formula_py=_cac_mu,
    clickhouse_sql=(
        "if(new_customers_count > 0, "
        "intDiv(total_ad_spend_mu, new_customers_count), NULL)"
    ),
    parity_class="shadow_compare",
)

# ── MER (Marketing Efficiency Ratio = Net Sales / Total Ad Spend) ─────────
def _mer_bp(net_sales_mu: int, total_ad_spend_mu: int) -> int | None:
    """MER = Net Sales / Total Ad Spend in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    Note: paMER (CM2/AdSpend) is the Brain-preferred metric; MER is provided
    for reference / legacy comparison.
    """
    return _ratio_bp(net_sales_mu, total_ad_spend_mu)


mer_bp = MetricDefinition(
    id="mer_bp",
    kind="ratio",
    unit="bp",
    formula_py=_mer_bp,
    clickhouse_sql=(
        "if(total_ad_spend_mu > 0, "
        "intDiv(net_sales_mu * 10000, total_ad_spend_mu), NULL)"
    ),
    parity_class="shadow_compare",
)

# ── CAC Payback Period (months) — integer months ───────────────────────────
def _cac_payback_months(cac_mu: int, monthly_cm2_mu: int) -> int | None:
    """CAC Payback = CAC / Monthly CM2 (integer months, FLOOR).

    @paradigm: sql — integer FLOOR.
    """
    if cac_mu is None or monthly_cm2_mu is None:
        return None
    return _int_floor_div_or_null(cac_mu, monthly_cm2_mu)


cac_payback_months = MetricDefinition(
    id="cac_payback_months",
    kind="count",
    unit="count",
    formula_py=_cac_payback_months,
    clickhouse_sql=(
        "if(monthly_cm2_mu > 0, "
        "intDiv(cac_mu, monthly_cm2_mu), NULL)"
    ),
    parity_class="shadow_compare",
)

# ---------------------------------------------------------------------------
# Goal RAG (Red/Amber/Green) — count of metrics at each band
# Not a money/ratio metric; count type.
# ---------------------------------------------------------------------------
def _goal_rag_count(
    goal_red_count: int,
    goal_amber_count: int,
    goal_green_count: int,
) -> dict[str, int]:
    """Goal RAG distribution: count of metrics at each status band.

    Returns a dict for report use; not a scalar metric.
    parity_class: shadow_compare (the band definitions are in goal_type.py).
    """
    return {
        "red": goal_red_count,
        "amber": goal_amber_count,
        "green": goal_green_count,
    }


# ── FX Rate (shadow-phase static rate — matches legacy EXCHANGE_RATES) ────
# workspace-costs.ts:9-21 / pnl.ts:11-17: EXCHANGE_RATES INR:83.5
# Brain shadow phase: MUST use the same static 83.5 rate as legacy.
# CF-C4-DDR-FX-RESTATEMENT-1: live-rate conversion held for Child-3.
FX_SHADOW_RATE_INR_PER_USD: int = 8350  # ₹83.50 = 8350 paise per USD


# ---------------------------------------------------------------------------
# METRIC_REGISTRY — the canonical flat registry, ordered by waterfall
# ---------------------------------------------------------------------------

METRIC_REGISTRY: dict[str, MetricDefinition] = {
    # Revenue ladder
    "gross_sales_mu":            gross_sales_mu,
    "total_discount_mu":         total_discount_mu,
    "total_tax_mu":              total_tax_mu,
    "net_sales_mu":              net_sales_mu,
    "net_revenue_mu":            net_revenue_mu,
    "realized_revenue_mu":       realized_revenue_mu,
    # Cost components
    "cogs_mu":                   cogs_mu,
    "variable_costs_mu":         variable_costs_mu,
    # CM waterfall
    "cm1_mu":                    cm1_mu,
    "total_ad_spend_mu":         total_ad_spend_mu,
    "cm2_mu":                    cm2_mu,
    "misc_expenses_prorated_mu": misc_expenses_prorated_mu,
    "cm3_mu":                    cm3_mu,
    # Brain-native (parity_gap:true — correctness_fixture)
    "true_cm2_mu":               true_cm2_mu,
    "pamer_bp":                  pamer_bp,
    "amer_bp":                   amer_bp,
    "ltv_cac_bp":                ltv_cac_bp,
    # Display-only ratios (CM2-first; ROAS/ACOS never decision metrics)
    "blended_roas_x100":         blended_roas_x100,
    "acos_bp":                   acos_bp,
    # Operational metrics
    "rto_rate_bp":               rto_rate_bp,
    "prepaid_rate_bp":           prepaid_rate_bp,
    "aov_mu":                    aov_mu,
    "conversion_rate_bp":        conversion_rate_bp,
    # Marketing efficiency
    "mer_bp":                    mer_bp,
    "cac_mu":                    cac_mu,
    "cac_payback_months":        cac_payback_months,
}


def get_metric(metric_id: str) -> MetricDefinition:
    """Look up a metric by id. Raises KeyError if not registered.

    Args:
        metric_id: canonical snake_case metric id.

    Returns:
        MetricDefinition for the requested metric.

    Raises:
        KeyError: if metric_id is not in the registry.
    """
    if metric_id not in METRIC_REGISTRY:
        raise KeyError(
            f"Metric {metric_id!r} not found in METRIC_REGISTRY. "
            f"Known metrics: {sorted(METRIC_REGISTRY.keys())}. "
            "Add it to registry/definitions.py if this is a new metric."
        )
    return METRIC_REGISTRY[metric_id]
