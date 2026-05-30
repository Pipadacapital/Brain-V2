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

# ---------------------------------------------------------------------------
# Waterfall revenue-ladder deduction steps (Wave-1 parity, 2026-05-30)
# Complete the 16-step CM waterfall to match legacy waterfall.ts exactly.
# Byte-identical pairs with packages/lib-metrics/src/registry/definitions.ts.
# ---------------------------------------------------------------------------

# ── Returns (Refunds) ──────────────────────────────────────────────────────
# Legacy: waterfall.ts "Refunds" = total_returns from Shopify analytics daily.
# MetricRow column: returns_mu. shadow_compare: Shopify analytics daily comparand.
def _returns_mu(returns_mu: int) -> int:
    """Returns in minor units: total Shopify refunds for the period. Passthrough aggregate."""
    return returns_mu


returns_mu = MetricDefinition(
    id="returns_mu",
    kind="money",
    unit="mu",
    formula_py=_returns_mu,
    clickhouse_sql="toInt64(returns_mu)",
    parity_class="shadow_compare",
)


# ── Shipping Outbound Cost ─────────────────────────────────────────────────
# Shiprocket forward charges + COD charges (NOT shipping_revenue_mu which is Shopify income).
# Legacy: waterfall.ts:951 — shippingOutbound = forwardCharges + codCharges.
# Passed as an explicit workspace-scoped input (not in the daily MV — Shiprocket source).
def _shipping_outbound_mu(forward_charges_mu: int, cod_charges_mu: int) -> int:
    """Shipping outbound cost = Shiprocket forward charges + COD charges. @paradigm: sql."""
    return forward_charges_mu + cod_charges_mu


shipping_outbound_mu = MetricDefinition(
    id="shipping_outbound_mu",
    kind="money",
    unit="mu",
    formula_py=_shipping_outbound_mu,
    clickhouse_sql="toInt64(forward_charges_mu + cod_charges_mu)",
    parity_class="shadow_compare",
)


# ── Gross Revenue After Deductions ─────────────────────────────────────────
# Intermediate waterfall subtotal after removing all revenue-side deductions.
# Legacy: waterfall.ts:985 "Revenue After Tax & Shipping" = revenueAfterTaxShipping
#   = gross_sales − discounts − refunds − tax − shippingOutbound.
# NOTE: Brain CM1 uses net_revenue_mu (different base — DDR _ROW_CM1 documents the delta).
def _gross_revenue_after_deductions_mu(
    gross_sales_mu: int,
    total_discount_mu: int,
    returns_mu: int,
    total_tax_mu: int,
    shipping_outbound_mu: int,
) -> int:
    """Gross Revenue After Deductions = grossSales − discounts − returns − tax − shippingOutbound.

    @paradigm: sql — integer subtraction, no float.
    Legacy: waterfall.ts revenueAfterTaxShipping (the CM1 base in the legacy waterfall page).
    Brain CM1 uses a different base (net_revenue_mu); DDR _ROW_CM1 pins the delta.
    """
    return (
        gross_sales_mu
        - total_discount_mu
        - returns_mu
        - total_tax_mu
        - shipping_outbound_mu
    )


gross_revenue_after_deductions_mu = MetricDefinition(
    id="gross_revenue_after_deductions_mu",
    kind="money",
    unit="mu",
    formula_py=_gross_revenue_after_deductions_mu,
    clickhouse_sql=(
        "toInt64(gross_sales_mu - total_discount_mu - returns_mu "
        "- total_tax_mu - shipping_outbound_mu)"
    ),
    parity_class="shadow_compare",
)


# ── Founder's Salary ────────────────────────────────────────────────────────
# Prorated founder monthly salary allocated to the period (workspace setting).
# Legacy: waterfall.ts:845-864 — allocated as (monthly / daysInMonth) × overlapDays.
# Passed as an explicit workspace-scoped input (not in the daily MV — from settings).
def _founder_salary_mu(founder_salary_mu: int) -> int:
    """Founder's salary: prorated monthly salary for the period. Passthrough."""
    return founder_salary_mu


founder_salary_mu = MetricDefinition(
    id="founder_salary_mu",
    kind="money",
    unit="mu",
    formula_py=_founder_salary_mu,
    clickhouse_sql="toInt64(founder_salary_mu)",
    parity_class="shadow_compare",
)


# ── Net Profit ────────────────────────────────────────────────────────────
# CM3 minus founder's prorated salary. Legacy: waterfall.ts:993 netProfit = cm3 - founder.
def _net_profit_mu(cm3_mu: int, founder_salary_mu: int) -> int:
    """Net Profit = CM3 − Founder's Salary. @paradigm: sql — integer subtraction."""
    return cm3_mu - founder_salary_mu


net_profit_mu = MetricDefinition(
    id="net_profit_mu",
    kind="money",
    unit="mu",
    formula_py=_net_profit_mu,
    clickhouse_sql="toInt64(cm3_mu - founder_salary_mu)",
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

# ---------------------------------------------------------------------------
# Phase-2 slice-4 (feat-marketing-acquisition): marketing efficiency RECONCILED
# to legacy (lib/metrics/marketing-efficiency.ts + lib/acquisition/compute.ts).
# pamer_bp DECOMMISSIONED — it had NO legacy comparand (cm2/total_spend was invented
# in Child-4). amer_bp REDEFINED to the legacy semantics below. DDR _ROW_AMER_REDEF.
# ---------------------------------------------------------------------------

def _amer_bp(new_customer_revenue_mu: int, acquisition_ad_spend_mu: int) -> int | None:
    """aMER = new-customer revenue / ACQUISITION-CLASSIFIED ad spend in basis points.

    Legacy: marketing-efficiency.ts:25-28 (aMer = newCustomerRevenue/acquisitionAdSpend).
    The denominator is the acquisition campaign-intent bucket ONLY (ads-spend.ts) —
    unclassified/brand/non_acquisition spend is EXCLUDED (conservative). This is the
    load-bearing correction vs the Child-4 placeholder (true_cm2/total_spend).

    @paradigm: sql — integer FLOOR. No float. None when acquisition spend == 0.
    """
    return _ratio_bp(new_customer_revenue_mu, acquisition_ad_spend_mu)


amer_bp = MetricDefinition(
    id="amer_bp",
    kind="ratio",
    unit="bp",
    formula_py=_amer_bp,
    clickhouse_sql=(
        "if(acquisition_ad_spend_mu > 0, "
        "intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true — redefined from Child-4 placeholder
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ---------------------------------------------------------------------------
# LTV:CAC (Brain-native — parity_gap:true)
# ---------------------------------------------------------------------------
# LTV:CAC ratio = Customer Lifetime Value / Customer Acquisition Cost
# Phase-2 slice-5 (feat-cohorts-ltv) CORRECTION (Rohan Stage-1 Finding 4): the LTV input
# (ltv_mu) is the COHORT CUMULATIVE REALIZED CM3 at a horizon (cohort_ltv_mu) — NOT a
# "cumulative CM2" curve. Legacy cohorts use CM3 (cm2 − misc); the prior comment naming
# CM2 was the wrong rung. The RATIO formula below is correct and unchanged; only the
# input-rung documentation is fixed. cac_mu is the slice-4 blended CAC.
# Formula: ltv_cac_bp = intDiv(ltv_mu × 10000, cac_mu)
# parity_gap:true — no legacy comparand (Brain integer-paise ratio).

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

# ── MER (Marketing Efficiency Ratio = Net Revenue / Total Ad Spend) ───────
# RECONCILED (slice-4): numerator is net_revenue_mu (the slice-1 /store net-revenue
# rung) so /acquisition MER == /store net revenue for the same range. Legacy:
# marketing-efficiency.ts:21-24 (mer = storeNetRevenue/totalAdSpend). Child-4 used
# net_sales_mu — reconciled to net_revenue_mu. DDR _ROW_MER_BASIS.
def _mer_bp(net_revenue_mu: int, total_ad_spend_mu: int) -> int | None:
    """MER = store net revenue / Total Ad Spend in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    """
    return _ratio_bp(net_revenue_mu, total_ad_spend_mu)


mer_bp = MetricDefinition(
    id="mer_bp",
    kind="ratio",
    unit="bp",
    formula_py=_mer_bp,
    clickhouse_sql=(
        "if(total_ad_spend_mu > 0, "
        "intDiv(net_revenue_mu * 10000, total_ad_spend_mu), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)


# ── New-customer revenue / CM2 / per-NC / acquisition spend (slice-4) ──────
# Passthrough money aggregates ported from acquisition/compute.ts. The per-order
# RTO/tax/refund-share exclusion + acquisition classification live in the use-case +
# the connector; these defs are the registry-traceable rungs. DDR _ROW_NC_REVENUE_CM2.

def _new_customer_revenue_mu(new_customer_revenue_mu: int) -> int:
    """New-customer revenue (paise): SUM per-NC-order (price − tax − refundShare), RTO→0.

    Legacy: acquisition/compute.ts:402-403. Per-order tax uses per-SKU GST (never blended).
    @paradigm: sql — passthrough aggregate.
    """
    return new_customer_revenue_mu


new_customer_revenue_mu = MetricDefinition(
    id="new_customer_revenue_mu",
    kind="money",
    unit="mu",
    formula_py=_new_customer_revenue_mu,
    clickhouse_sql="toInt64(new_customer_revenue_mu)",
    parity_class="shadow_compare",
)


def _nc_cm2_mu(nc_cm2_mu: int) -> int:
    """New-customer CM2 (paise): SUM per-NC-order CM2, RTO→0. acquisition/compute.ts:394,400."""
    return nc_cm2_mu


nc_cm2_mu = MetricDefinition(
    id="nc_cm2_mu",
    kind="money",
    unit="mu",
    formula_py=_nc_cm2_mu,
    clickhouse_sql="toInt64(nc_cm2_mu)",
    parity_class="shadow_compare",
)


def _cm2_per_nc_mu(nc_cm2_mu: int, new_customers_count: int) -> int | None:
    """CM2 per new customer (paise) = nc_cm2_mu / new_customers_count. compute.ts:429.

    @paradigm: sql — integer FLOOR; None on zero new customers.
    """
    return _int_floor_div_or_null(nc_cm2_mu, new_customers_count)


cm2_per_nc_mu = MetricDefinition(
    id="cm2_per_nc_mu",
    kind="money",
    unit="mu",
    formula_py=_cm2_per_nc_mu,
    clickhouse_sql=(
        "if(new_customers_count > 0, "
        "intDiv(nc_cm2_mu, new_customers_count), NULL)"
    ),
    parity_class="shadow_compare",
)


def _acquisition_ad_spend_mu(acquisition_ad_spend_mu: int) -> int:
    """Acquisition-classified ad spend (paise) — the aMER denominator. ads-spend.ts.

    DISTINCT from total_ad_spend_mu: only campaigns with resolved intent=='acquisition'.
    @paradigm: sql — passthrough aggregate.
    """
    return acquisition_ad_spend_mu


acquisition_ad_spend_mu = MetricDefinition(
    id="acquisition_ad_spend_mu",
    kind="money",
    unit="mu",
    formula_py=_acquisition_ad_spend_mu,
    clickhouse_sql="toInt64(acquisition_ad_spend_mu)",
    parity_class="shadow_compare",
)

# ── CAC Payback Period — DECOMMISSIONED (Phase-2 slice-5, feat-cohorts-ltv) ──
# The prior `cac_payback_months = intDiv(cac_mu, monthly_cm2_mu)` was a SPECULATIVE
# PRE-BUILD (PY-only; never in the TS registry; never had cross-language parity; no
# consumer). It does NOT match the legacy payback. Legacy payback (cohorts/compute.ts:
# 610-652) is a CUMULATIVE BUCKET-WALK WITH INTERPOLATION over the per-cohort M1..M12
# incremental realized-CM3 curve — NOT a flat CAC ÷ monthly-CM2 ratio. A flat ratio
# diverges from legacy on any non-flat retention curve.
#
# Same decommission class as slice-4's pamer_bp (phantom, wrong formula, no comparand).
# Rohan Stage-1 Finding 3. The REAL payback is computed in the cohorts use-case
# (CohortMatrixQuery) — it is an iterative array-walk, not a fixed-arity single
# expression, so it does NOT fit the MetricDefinition formula contract; it is
# anchored by a non-vacuous use-case correctness fixture + DDR row _ROW_CAC_PAYBACK.
# Removed from METRIC_REGISTRY below.

# ── Cohort cumulative LTV (realized CM3 at horizon) — parity_gap:true ────────
# The cohort cumulative realized-CM3 value that feeds ltv_cac_bp. This is the LTV
# rung for the LTV:CAC decision metric. Rohan Stage-1 Finding 1 + 4: cohorts use
# CM3 (cm2 − misc), NOT CM2; and ltv_cac_bp's input is THIS cumulative CM3, not a
# CM2 curve. Brain-native: legacy is a float cumulative; integer-paise here is the
# canonical Brain form. parity_gap:true → correctness_fixture + DDR _ROW_COHORT_LTV.
#
# The cumulative sum itself is iterative (foR + Σ incr 1..H); the registry def pins
# the SINGLE-STEP accumulation identity: ltv_at_step = prev_ltv_mu + incr_cm3_mu.
# The use-case walks it; the gate checks the step identity is integer-additive.
# WORKED ANCHOR (CF-S5-LTV-CUM-1): prev=1500000µ, incr=300000µ → 1800000µ.
def _cohort_ltv_mu(prev_ltv_mu: int, incr_cm3_mu: int) -> int:
    """Cohort cumulative realized CM3 step: prev + this-bucket incremental CM3.

    @paradigm: sql — integer addition; no float. parity_gap:true (Brain-native).
    """
    return prev_ltv_mu + incr_cm3_mu


cohort_ltv_mu = MetricDefinition(
    id="cohort_ltv_mu",
    kind="money",
    unit="mu",
    formula_py=_cohort_ltv_mu,
    clickhouse_sql="toInt64(prev_ltv_mu + incr_cm3_mu)",
    parity_class="correctness_fixture",  # parity_gap:true — Brain-native integer cumulative
    scale=1,
)

# ── Repeat rate (basis points) — shadow_compare ─────────────────────────────
# Distinct repeat customers ÷ new customers, in bp. Covers rr90 (90-day window) and
# the bucketed repeat metric. Legacy comparand exists (cohorts/compute.ts:589-608
# rr90 = count90/newCustomers; LTV repeat_rate = distinct-set.size/n). shadow_compare.
# Rohan Stage-1 spec (cohorts repeat family + LTV repeat_rate metric).
# WORKED ANCHOR (CF-S5-RR90-1): 3 of 10 new customers repeat within 90d →
#   intDiv(3 × 10000, 10) = 3000 bp (30.00%). A "÷ total-orders (say 25)" mutant →
#   intDiv(3×10000,25)=1200bp — KILLED.
def _repeat_rate_bp(repeat_customers: int, new_customers: int) -> int | None:
    """Repeat rate = repeat customers / new customers in basis points.

    @paradigm: sql — integer FLOOR. NULL on zero new customers.
    """
    return _ratio_bp(repeat_customers, new_customers)


repeat_rate_bp = MetricDefinition(
    id="repeat_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_repeat_rate_bp,
    clickhouse_sql=(
        "if(new_customers > 0, "
        "intDiv(repeat_customers * 10000, new_customers), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,  # CF-C6-ROAS-DISPLAY-CONTRACT-1
)

# ---------------------------------------------------------------------------
# Catalog / inventory / first-product cascade (Phase-2 slice-6: feat-catalog-inventory)
# Byte-identical pairs with packages/lib-metrics/src/registry/definitions.ts.
#
# LEGACY GROUND TRUTH (read at Stage 1, NOT the slice-table shorthand — Rohan Findings):
#   - Products metric is CM1 (= revenue−cogs−variableCost), NOT per-SKU CM2 → REUSE cm1_mu;
#     product AOV reuses aov_mu. No SKU-grain CM2 exists; product_cm1_mu/sku_cm2_mu = phantom.
#   - Inventory has sellThrough + daysLeft, NOT a turnover ratio (lib/inventory-constants.ts).
#   - First-product "second order rate" = (#cust ≥2 lifetime orders)/cohort over an observation
#     window — NOT slice-5 repeat_rate_bp (rr90 = repeat-within-90d/new-customers).
#
# SCALE DDR DELTA: legacy emits percent (sell-through 1-decimal; cascade rate 0-100). Brain
#   canonicalizes on bp (×100 of legacy) — registered in the DDR, NOT silently float-matched.
# ---------------------------------------------------------------------------

# ── Inventory sell-through (basis points) ──────────────────────────────────
# = sales365 / (sales365 + currentInventory). Legacy computeSellThrough returns
# round(sales/(sales+inv)*1000)/10 (1-decimal percent); Brain = bp (FLOOR). NULL-guard
# on (sales365+inv) <= 0.
# WORKED ANCHOR (CF-S6-INV-SELLTHRU-1): sales365=300, inv=100 → intDiv(300*10000,400)=7500bp
#   (75.00%). A "÷ inventory only" mutant → intDiv(300*10000,100)=30000bp — KILLED.
def _inventory_sell_through_bp(sales365: int, current_inventory: int) -> int | None:
    """Inventory sell-through = sales365 / (sales365 + inventory) in basis points.

    @paradigm: sql — integer FLOOR. NULL on non-positive (sales365 + inventory).
    """
    return _ratio_bp(sales365, sales365 + current_inventory)


inventory_sell_through_bp = MetricDefinition(
    id="inventory_sell_through_bp",
    kind="ratio",
    unit="bp",
    formula_py=_inventory_sell_through_bp,
    clickhouse_sql=(
        "if((sales365 + current_inventory) > 0, "
        "intDiv(sales365 * 10000, sales365 + current_inventory), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,
)


# ── Inventory days-left (estimated days of cover) — velocity-window CASCADE ──
# Legacy computeDaysLeft: first NON-ZERO window wins (L30→L90→L180→L360).
#   inv<=0 → 0 ; avgDaily = qtyLwin/win ; avgDaily<=0 → 999999 (INFINITE sentinel) ;
#   else → round(inv/avgDaily). Integer-exact half-up: round(inv*win/qty).
# WORKED ANCHOR (CF-S6-INV-DAYSLEFT-1): inv=30, L30=0, L90=90 → win 90, qty 90 →
#   round(30*90/90)=30. A "always use L360" mutant on L360=0 → 999999 — KILLED.
# WORKED ANCHOR (CF-S6-INV-DAYSLEFT-INF-1): inv=50, all windows 0 → 999999.
_INVENTORY_INFINITE_DAYS = 999999


def _inventory_days_left(
    current_inventory: int,
    qty_l30: int,
    qty_l90: int,
    qty_l180: int,
    qty_l360: int,
) -> int:
    """Estimated days of cover via the first non-zero velocity window. @paradigm: sql.

    Integer-exact half-up round of inv/avgDaily where avgDaily = qty/window:
        round(inv*window/qty) = (inv*window*2 + qty) // (qty*2)  (half-up, positive ints).
    """
    if current_inventory <= 0:
        return 0
    q = 0
    w = 0
    if qty_l30 > 0:
        q, w = qty_l30, 30
    elif qty_l90 > 0:
        q, w = qty_l90, 90
    elif qty_l180 > 0:
        q, w = qty_l180, 180
    elif qty_l360 > 0:
        q, w = qty_l360, 360
    if q <= 0:
        return _INVENTORY_INFINITE_DAYS
    return (current_inventory * w * 2 + q) // (q * 2)


inventory_days_left = MetricDefinition(
    id="inventory_days_left",
    kind="count",
    unit="count",
    formula_py=_inventory_days_left,
    clickhouse_sql=(
        "multiIf(current_inventory <= 0, 0, "
        "qty_l30 > 0, intDiv(current_inventory * 30 * 2 + qty_l30, qty_l30 * 2), "
        "qty_l90 > 0, intDiv(current_inventory * 90 * 2 + qty_l90, qty_l90 * 2), "
        "qty_l180 > 0, intDiv(current_inventory * 180 * 2 + qty_l180, qty_l180 * 2), "
        "qty_l360 > 0, intDiv(current_inventory * 360 * 2 + qty_l360, qty_l360 * 2), "
        "999999)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true — Brain-native cascade
    scale=1,
)


# ── First-product second-order rate (basis points) ─────────────────────────
# = (#cust ≥2 lifetime orders) / cohortSize. Legacy first-product-cascade.ts secondOrderRate
# (100 × c2 / n, percent 0-100); Brain = bp. NOT slice-5 repeat_rate_bp. NULL-guard cohort<=0.
# WORKED ANCHOR (CF-S6-FP-2ND-1): 3 of 8 cohort have ≥2 → intDiv(3*10000,8)=3750bp (37.50%).
#   A "÷ orders(20) not customers" mutant → intDiv(3*10000,20)=1500bp — KILLED.
def _first_product_second_order_rate_bp(
    customers_with_2plus: int, cohort_customers: int
) -> int | None:
    """First-product second-order rate = customers with >=2 orders / cohort, in bp.

    @paradigm: sql — integer FLOOR. NULL on zero cohort customers.
    """
    return _ratio_bp(customers_with_2plus, cohort_customers)


first_product_second_order_rate_bp = MetricDefinition(
    id="first_product_second_order_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_first_product_second_order_rate_bp,
    clickhouse_sql=(
        "if(cohort_customers > 0, "
        "intDiv(customers_with_2plus * 10000, cohort_customers), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,
)


# ── Goal attainment (basis points) + directional RAG band — Phase-2 slice-7 ──
# Goal attainment = how close the actual is to the goal, in bp.
#   goal_attainment_bp = FLOOR(actual * 10000 / goal_value)   (NULL-guard goal_value == 0)
# The DIRECTION-AWARE band (compute_goal_rag) is a CLASSIFICATION computed in the use-case,
# NOT a numeric metric def — exactly as inventory `status` / pareto `grade` (slice 6).
#
# LEGACY GROUND TRUTH (lib/metrics/goals.ts — Rohan Stage-1 Finding 1; the slice-table's flat
# "≥95% green" is ONLY the higher-better case):
#   higher-better:  actual >= goal*0.95 → green ; >= goal*0.80 → amber ; else red
#   lower-better:   actual <= goal*1.05 → green ; <= goal*1.20 → amber ; else red
# Direction by goal_higher_better(goal_type, metric_higher_better):
#   MINIMUM → higher-better ; MAXIMUM → lower-better ; TARGET → metric's registry default.
#
# WORKED ANCHOR (CF-S7-GOAL-ATTAIN-1): actual=9200, goal=10000 → FLOOR(9200*10000/10000)=9200bp
#   (92.00%). A "÷ actual" (wrong-denominator) mutant → FLOOR(9200*10000/9200)=10000bp — KILLED.
def _goal_attainment_bp(actual: int, goal_value: int) -> int | None:
    """Goal attainment = actual / goal in bp. @paradigm: sql — integer FLOOR. NULL on goal==0."""
    return _ratio_bp(actual, goal_value)


goal_attainment_bp = MetricDefinition(
    id="goal_attainment_bp",
    kind="ratio",
    unit="bp",
    formula_py=_goal_attainment_bp,
    clickhouse_sql="if(goal_value != 0, intDiv(actual * 10000, goal_value), NULL)",
    parity_class="shadow_compare",
    scale=10000,
)


def compute_goal_rag(actual: int, goal: int, higher_better: bool) -> str:
    """Direction-aware Goal RAG band (legacy computeGoalRag). Integer-exact via ×100 thresholds.

    higher-better: actual*100 >= goal*95 → 'green' ; >= goal*80 → 'amber' ; else 'red'
    lower-better:  actual*100 <= goal*105 → 'green' ; <= goal*120 → 'amber' ; else 'red'

    This MUST byte-match the TS computeGoalRag. A "treat-all-as-higher-better" mutant flips a
    lower-better goal (CAC at 120% of goal) red→green and is KILLED by the lower-better anchor.
    """
    if goal <= 0:
        return ("green" if actual >= 0 else "red") if higher_better else "green"
    a = actual * 100
    if higher_better:
        if a >= goal * 95:
            return "green"
        if a >= goal * 80:
            return "amber"
        return "red"
    if a <= goal * 105:
        return "green"
    if a <= goal * 120:
        return "amber"
    return "red"


def goal_higher_better(goal_type: str, metric_higher_better: bool) -> bool:
    """Resolve goal direction (legacy higherBetterForGoal).

    MINIMUM → higher-better ; MAXIMUM → lower-better ; TARGET → the metric's intrinsic direction.
    """
    if goal_type == "MINIMUM":
        return True
    if goal_type == "MAXIMUM":
        return False
    return metric_higher_better


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


# ---------------------------------------------------------------------------
# Lifecycle + Timings + Email/SMS performance (Phase-2 slice-8: feat-lifecycle-timings-email)
# READ/ANALYTICS ONLY — REPORTING on past performance, NEVER an outbound send.
# Byte-identical pairs with packages/lib-metrics/src/registry/definitions.ts.
#
# LEGACY GROUND TRUTH (read at Stage 1, NOT the slice-table shorthand — Rohan Findings;
# the standing lesson bit an 8th time):
#   F1. Lifecycle is NOT classic RFM. lib/metrics/customer-lifecycle.ts classifies
#       new/active/at_risk/churned from recency (calendar days since last order) vs the
#       workspace's EMPIRICAL repeat-gap percentiles p40/p80 (churn-thresholds.ts), with
#       fixed fallbacks 45/120 when <20 gaps. NO recency/frequency/monetary quintile SCORING
#       exists. "RFM scores/segments" would be a phantom. The classifier + the p40/p80
#       percentile are use-case logic (LifecycleStatesQuery), like compute_goal_rag — NOT a
#       registry scalar. Monetary enters only as revenue-by-bucket attribution.
#   F2. Timings is NOT "best hours/days" (best_send_time). lib/timings/compute.ts computes
#       INTER-ORDER GAP intervals (days 1→2, 2→3, 3→4 median/mean) + 2nd/3rd/4th repeat % +
#       reactivationDays = 0.8 × median(1→2 gap). NO hour-of-day / day-of-week analysis.
#       best_send_time is a phantom (5th decommission-before-birth lineage:
#       pamer_bp/cac_payback_months/product_cm1_mu/festival_lift).
#   F3. Timings 2nd-order% is a WINDOWED first-order cohort (all-product), DISTINCT from
#       slice-6 first_product_second_order_rate_bp (lifetime ≥2 / per-first-product cohort).
#       De-conflated — NOT reused.
#   F4. email_cm2_mu is a PHANTOM (6th decommission-before-birth). lib/email-performance/
#       compute.ts computes NO CM2 — only revenue + open/click/rev-per-recipient/rev-per-open/
#       unsub/spam rates from Klaviyo emailPerformance rows. There is no margin attribution to
#       email. Port revenue + the rates only.
#
# COMPLIANCE BOUNDARY (epic flag, Shreya S4): zero outbound-channel surface. sendDate is a
# READ column on already-sent Klaviyo rows. open/click/revenue = REPORTING, not sending.
# ---------------------------------------------------------------------------

# ── Reactivation window (days) — Brain-native integerized ──────────────────
# Legacy lib/timings/compute.ts: REACTIVATION_PCT_OF_1TO2 = 0.8; reactivationDays =
#   0.8 × typical(1→2 gap). Brain integer half-up: round(0.8 × median_days) =
#   (median_days * 8 + 5) // 10  (half-up, positive ints; median_days already integer days).
# This is the recommended re-engagement timing, NOT a send trigger. correctness_fixture
# (Brain-native integerized; legacy float is not a byte comparand). NULL on median<=0.
# WORKED ANCHOR (CF-S8-REACT-1): median_1to2=30 → (30*8+5)//10 = 245//10 = 24 days.
#   A "× whole interval (no 0.8)" mutant → 30 — KILLED.
def _reactivation_window_days(median_1to2_days: int) -> int | None:
    """Recommended reactivation window = 0.8 × median 1→2 gap (days), integer half-up.

    @paradigm: sql — integer arithmetic only. NULL when median_1to2_days <= 0.
    Brain-native integerized (legacy 0.8 float factor) → correctness_fixture + DDR.
    REPORTING/recommendation only — never triggers an outbound send (compliance boundary).
    """
    if median_1to2_days <= 0:
        return None
    return (median_1to2_days * 8 + 5) // 10  # round(0.8 × m), half-up


reactivation_window_days = MetricDefinition(
    id="reactivation_window_days",
    kind="count",
    unit="count",
    formula_py=_reactivation_window_days,
    clickhouse_sql=(
        "if(median_1to2_days > 0, intDiv(median_1to2_days * 8 + 5, 10), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true — Brain-native integerized 0.8 factor
    scale=1,
)


# ── Email open rate (basis points) ─────────────────────────────────────────
# Legacy lib/email-performance/compute.ts: openRate = unique_opens / delivered (0 if del=0).
# Klaviyo emailPerformance rows are an EXACT integer comparand → shadow_compare. Brain = bp FLOOR.
# WORKED ANCHOR (CF-S8-EMAIL-OPEN-1): unique_opens=450, delivered=1000 →
#   intDiv(450*10000,1000)=4500bp (45.00%). A "÷ unique_opens (rev-per-open denominator)"
#   mutant → intDiv(450*10000,450)=10000bp — KILLED.
def _email_open_rate_bp(unique_opens: int, delivered: int) -> int | None:
    """Email open rate = unique_opens / delivered in bp. @paradigm: sql — FLOOR. NULL on delivered<=0."""
    return _ratio_bp(unique_opens, delivered)


email_open_rate_bp = MetricDefinition(
    id="email_open_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_email_open_rate_bp,
    clickhouse_sql="if(delivered > 0, intDiv(unique_opens * 10000, delivered), NULL)",
    parity_class="shadow_compare",
    scale=10000,
)


# ── Email click rate (basis points) ────────────────────────────────────────
# Legacy: clickRate = unique_clicks / delivered. shadow_compare. Brain = bp FLOOR.
# WORKED ANCHOR (CF-S8-EMAIL-CLICK-1): unique_clicks=120, delivered=1000 →
#   intDiv(120*10000,1000)=1200bp (12.00%). A "÷ unique_opens not delivered" mutant
#   (delivered=1000, opens=450) → intDiv(120*10000,450)=2666bp — KILLED.
def _email_click_rate_bp(unique_clicks: int, delivered: int) -> int | None:
    """Email click rate = unique_clicks / delivered in bp. @paradigm: sql — FLOOR. NULL on delivered<=0."""
    return _ratio_bp(unique_clicks, delivered)


email_click_rate_bp = MetricDefinition(
    id="email_click_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_email_click_rate_bp,
    clickhouse_sql="if(delivered > 0, intDiv(unique_clicks * 10000, delivered), NULL)",
    parity_class="shadow_compare",
    scale=10000,
)


# ── Email revenue per recipient (minor units) ──────────────────────────────
# Legacy: revenuePerRecipient = revenue / delivered (0 if del=0). revenue is a Klaviyo-synced
# money column → BIGINT minor units. shadow_compare. Brain = intDiv(revenue_mu, delivered).
# WORKED ANCHOR (CF-S8-EMAIL-RPR-1): revenue_mu=5000000 (₹50,000), delivered=1000 →
#   intDiv(5000000,1000)=5000µ (₹50.00 per recipient). A "÷ unique_opens (rev-per-open)"
#   mutant (opens=450) → intDiv(5000000,450)=11111µ — KILLED.
def _email_revenue_per_recipient_mu(revenue_mu: int, delivered: int) -> int | None:
    """Email revenue per recipient = revenue / delivered in minor units.

    @paradigm: sql — integer FLOOR. NULL on delivered<=0. revenue is attributed past
    performance (REPORTING) — never a send. shadow_compare (Klaviyo comparand exists).
    """
    return _int_floor_div_or_null(revenue_mu, delivered)


email_revenue_per_recipient_mu = MetricDefinition(
    id="email_revenue_per_recipient_mu",
    kind="money",
    unit="mu",
    formula_py=_email_revenue_per_recipient_mu,
    clickhouse_sql="if(delivered > 0, intDiv(revenue_mu, delivered), NULL)",
    parity_class="shadow_compare",
    scale=1,
)


# ---------------------------------------------------------------------------
# RTO / COD / Logistics / Pincode economics (Phase-2 slice-3: feat-rto-cod-economics)
# The single largest controllable Indian-D2C margin leak. rto_rate_bp / prepaid_rate_bp
# are REUSED from Child-4 — these are the COST / ECONOMICS layer on top.
# Byte-identical pairs with packages/lib-metrics/src/registry/definitions.ts.
# ---------------------------------------------------------------------------

# ── RTO Cost (SUM of per-RTO-shipment charges) ─────────────────────────────
def _rto_cost_mu(rto_cost_mu: int) -> int:
    """RTO cost: sum of per-RTO-shipment charges (Shiprocket-sourced). Passthrough aggregate."""
    return rto_cost_mu


rto_cost_mu = MetricDefinition(
    id="rto_cost_mu",
    kind="money",
    unit="mu",
    formula_py=_rto_cost_mu,
    clickhouse_sql="toInt64(rto_cost_mu)",
    parity_class="shadow_compare",
)


# ── RTO Revenue Lost (SUM of RTO shipment order/COD value) ─────────────────
def _rto_revenue_lost_mu(rto_revenue_lost_mu: int) -> int:
    """RTO revenue lost: sum of RTO shipment order/COD value. Passthrough aggregate."""
    return rto_revenue_lost_mu


rto_revenue_lost_mu = MetricDefinition(
    id="rto_revenue_lost_mu",
    kind="money",
    unit="mu",
    formula_py=_rto_revenue_lost_mu,
    clickhouse_sql="toInt64(rto_revenue_lost_mu)",
    parity_class="shadow_compare",
)


# ── COD Realization Rate (delivered COD orders / total COD orders) ─────────
def _cod_realization_rate_bp(cod_delivered: int, cod_orders: int) -> int | None:
    """COD realization = delivered COD orders / total COD orders in basis points.

    @paradigm: sql — integer FLOOR. CF-C4-RATIO-DIVOP-1.
    Legacy: cod-prepaid-analytics.ts:187 (codDelivered/codOrders). Comparand exists → shadow_compare.
    """
    return _ratio_bp(cod_delivered, cod_orders)


cod_realization_rate_bp = MetricDefinition(
    id="cod_realization_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_cod_realization_rate_bp,
    clickhouse_sql=(
        "if(cod_orders > 0, "
        "intDiv(cod_delivered * 10000, cod_orders), NULL)"
    ),
    parity_class="shadow_compare",
    scale=10000,
)


# ── Break-even COD RTO Rate — FULL legacy formula (NOT naive M/(M+C)) ──────
# Legacy: cod-prepaid-analytics.ts:218-231.
#   pg_fee_mu  = intDiv(aov_mu * gateway_fee_bp, 10000)          (V·gatewayPct)
#   num_scaled = aov_mu * prepaid_rto_rate_bp                    (V·P·10000; P in bp)
#              + (cod_fee_mu - pg_fee_mu) * 10000                ((COD_fee − PG_fee)·10000)
#              + prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu)  (P·(S+RS)·10000)
#   denom      = aov_mu + return_shipping_mu + restocking_mu
#   breakeven_cod_rto_rate_bp = intDiv(num_scaled, denom) if denom > 0 else None  (already ×10000 ⇒ bp)
# SINGLE final FLOOR-to-bp; integer paise throughout. parity_gap:true → correctness_fixture + DDR.
# WORKED ANCHOR (CF-S3-BREAKEVEN-1): aov=150000, P=500bp, cod_fee=3000, gateway=200bp, S=8000, RS=0
#   → pg_fee=intDiv(150000*200,10000)=3000; num_scaled = 150000*500 + (3000-3000)*10000
#     + 500*(8000+0) = 75000000 + 0 + 4000000 = 79000000; denom = 158000;
#     breakeven = intDiv(79000000, 158000) = 500 bp (5.00%). (Naive M/(M+C) ~ 95% — distinguished.)
def _breakeven_cod_rto_rate_bp(
    aov_mu: int,
    prepaid_rto_rate_bp: int,
    cod_fee_mu: int,
    gateway_fee_bp: int,
    return_shipping_mu: int,
    restocking_mu: int,
) -> int | None:
    """Break-even COD RTO rate in basis points (FULL legacy formula).

    @paradigm: sql — integer FLOOR, single final FLOOR-to-bp, no chained float.
    parity_gap:true — Brain canonical; legacy float not a byte comparand.
    Returns None when (aov + S + RS) <= 0 (caller surfaces breakEvenNote).
    """
    denom = aov_mu + return_shipping_mu + restocking_mu
    if denom <= 0:
        return None
    pg_fee_mu = (aov_mu * gateway_fee_bp) // 10000  # intDiv FLOOR
    num_scaled = (
        aov_mu * prepaid_rto_rate_bp
        + (cod_fee_mu - pg_fee_mu) * 10000
        + prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu)
    )
    return num_scaled // denom  # SINGLE final FLOOR-to-bp


breakeven_cod_rto_rate_bp = MetricDefinition(
    id="breakeven_cod_rto_rate_bp",
    kind="ratio",
    unit="bp",
    formula_py=_breakeven_cod_rto_rate_bp,
    clickhouse_sql=(
        "if((aov_mu + return_shipping_mu + restocking_mu) > 0, "
        "intDiv(aov_mu * prepaid_rto_rate_bp + (cod_fee_mu - intDiv(aov_mu * gateway_fee_bp, 10000)) * 10000 "
        "+ prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu), "
        "aov_mu + return_shipping_mu + restocking_mu), NULL)"
    ),
    parity_class="correctness_fixture",  # parity_gap:true — Brain canonical, no byte comparand
    scale=10000,
)


# ── Pincode Reliability Score — Brain-native integerized (centi-points 0..10000) ──
# Legacy float: pincode-intelligence.ts:60-66
#   clamp(0,100, 100 − rtoRate·2 − codRate·0.5 + repeatRate·0.5 + (aov/1000)·10)
#   (rtoRate/codRate/repeatRate in PERCENT POINTS; aov in RUPEES)
# Brain integer form (inputs: rates in bp = pp×100, aov in paise):
#   raw_cp = 10000 - rto_bp*2 - intDiv(cod_bp,2) + intDiv(repeat_bp,2) + intDiv(aov_mu,100)
#   pincode_reliability_score = clamp(0, 10000, raw_cp)   (centi-points; ×100 of legacy 0..100)
# aov term derivation: legacy (aov_r/1000)·10 POINTS = aov_r/100 points = aov_r centi-pts;
#   aov_r = aov_mu/100 ⇒ term_cp = intDiv(aov_mu,100).
# WORKED ANCHOR (CF-S3-PINCODE-1): rto_bp=1800, cod_bp=6000, repeat_bp=2000, aov_mu=150000 →
#   raw = 10000 - 3600 - 3000 + 1000 + 1500 = 5900 (= 59.00). clamp → 5900.
def _pincode_reliability_score(
    rto_bp: int,
    cod_bp: int,
    repeat_bp: int,
    aov_mu: int,
) -> int:
    """Pincode reliability score in centi-points (0..10000). Brain-native integerized.

    @paradigm: sql — integer arithmetic only, deterministic, clamped.
    parity_gap:true — correctness_fixture; DDR pins the exact form.
    """
    raw = (
        10000
        - rto_bp * 2
        - cod_bp // 2
        + repeat_bp // 2
        + aov_mu // 100
    )
    return max(0, min(10000, raw))


pincode_reliability_score = MetricDefinition(
    id="pincode_reliability_score",
    kind="count",
    unit="count",
    formula_py=_pincode_reliability_score,
    clickhouse_sql=(
        "greatest(0, least(10000, toInt64(10000 - rto_bp * 2 - intDiv(cod_bp, 2) "
        "+ intDiv(repeat_bp, 2) + intDiv(aov_mu, 100))))"
    ),
    parity_class="correctness_fixture",  # parity_gap:true — Brain-native integerized score
)


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
    "gross_sales_mu":                       gross_sales_mu,
    "total_discount_mu":                    total_discount_mu,
    "total_tax_mu":                         total_tax_mu,
    "net_sales_mu":                         net_sales_mu,
    "net_revenue_mu":                       net_revenue_mu,
    "realized_revenue_mu":                  realized_revenue_mu,
    # Waterfall revenue-ladder deduction steps (Wave-1 parity, 2026-05-30)
    "returns_mu":                           returns_mu,
    "shipping_outbound_mu":                 shipping_outbound_mu,
    "gross_revenue_after_deductions_mu":    gross_revenue_after_deductions_mu,
    "founder_salary_mu":                    founder_salary_mu,
    "net_profit_mu":                        net_profit_mu,
    # Cost components
    "cogs_mu":                              cogs_mu,
    "variable_costs_mu":                    variable_costs_mu,
    # CM waterfall
    "cm1_mu":                    cm1_mu,
    "total_ad_spend_mu":         total_ad_spend_mu,
    "cm2_mu":                    cm2_mu,
    "misc_expenses_prorated_mu": misc_expenses_prorated_mu,
    "cm3_mu":                    cm3_mu,
    # Brain-native (parity_gap:true — correctness_fixture)
    # pamer_bp DECOMMISSIONED (slice-4) — no legacy comparand. amer_bp redefined to legacy.
    "true_cm2_mu":               true_cm2_mu,
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
    # Marketing efficiency (slice-4 reconciled to legacy)
    "mer_bp":                    mer_bp,
    "cac_mu":                    cac_mu,
    # cac_payback_months DECOMMISSIONED (slice-5) — phantom flat ratio; real payback is
    # the cumulative bucket-walk in CohortMatrixQuery (DDR _ROW_CAC_PAYBACK).
    "new_customer_revenue_mu":   new_customer_revenue_mu,
    "nc_cm2_mu":                 nc_cm2_mu,
    "cm2_per_nc_mu":             cm2_per_nc_mu,
    "acquisition_ad_spend_mu":   acquisition_ad_spend_mu,
    # Phase-2 slice-3 (feat-rto-cod-economics): RTO/COD/logistics/pincode economics
    "rto_cost_mu":               rto_cost_mu,
    "rto_revenue_lost_mu":       rto_revenue_lost_mu,
    "cod_realization_rate_bp":   cod_realization_rate_bp,
    "breakeven_cod_rto_rate_bp": breakeven_cod_rto_rate_bp,
    "pincode_reliability_score": pincode_reliability_score,
    # Phase-2 slice-5 (feat-cohorts-ltv): cohorts + LTV. cohort_ltv_mu feeds ltv_cac_bp
    # (cumulative CM3, not CM2); repeat_rate_bp covers rr90 + LTV repeat_rate.
    "cohort_ltv_mu":             cohort_ltv_mu,
    "repeat_rate_bp":            repeat_rate_bp,
    # Phase-2 slice-6 (feat-catalog-inventory): inventory + first-product cascade.
    # (product CM1 reuses cm1_mu; product AOV reuses aov_mu — no phantom duplicates.)
    "inventory_sell_through_bp":          inventory_sell_through_bp,
    "inventory_days_left":                inventory_days_left,
    "first_product_second_order_rate_bp": first_product_second_order_rate_bp,
    # Phase-2 slice-7 (feat-finance-settings-goals): goal attainment (directional RAG band is a
    # use-case classification, NOT a registry metric). festival_lift DECOMMISSIONED before birth
    # (no legacy comparand — Rohan Stage-1 Finding 2).
    "goal_attainment_bp":                 goal_attainment_bp,
    # Phase-2 slice-8 (feat-lifecycle-timings-email): READ/ANALYTICS ONLY (no outbound surface).
    # Lifecycle classification + p40/p80 percentile are use-case logic (LifecycleStatesQuery),
    # NOT registry scalars (Finding 1). best_send_time (Finding 2) + email_cm2_mu (Finding 4)
    # DECOMMISSIONED before birth — no legacy comparand. Timings 2nd-order% is windowed cohort,
    # distinct from slice-6 first_product_second_order_rate_bp (Finding 3) — NOT reused.
    "reactivation_window_days":           reactivation_window_days,
    "email_open_rate_bp":                 email_open_rate_bp,
    "email_click_rate_bp":                email_click_rate_bp,
    "email_revenue_per_recipient_mu":     email_revenue_per_recipient_mu,
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
