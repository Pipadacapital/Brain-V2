"""
definitional_delta_register.py — 9-field Definitional-Delta Register (DDR).

@paradigm: sql (zero LLM; pure data + structural enforcement)
Justified: the DDR is a machine-readable governance artifact; the only logic
it contains is the two structural sign-off enforcement rules. No inference path.
CF-C4-DDR-1 (EXPANDED 6→9 fields).

This file is the CANONICAL machine-readable register. The parity harness hook
at taxonomy.py:166 reads from this register. The human-readable counterpart
(definitional_delta_register.md) is Rohan's Stage-6 signable artifact.

9 fields per row (CF-C4-DDR-1):
  1. legacy_formula        — file:line in compute-daily.ts / pnl.ts / analytics-sync.ts
  2. brain_formula         — registry definition id (from registry/definitions.py)
  3. reason                — why the delta is expected (wrong-by-design vs genuine bug)
  4. shadow_compare_classification — how the harness classifies this delta
  5. delta_direction_and_magnitude — sanity-check the expected divergence
  6. business_impact       — downstream blast radius
  7. parity_gap            — bool: True = Brain-native, no legacy comparand
  8. child_dependency      — str|None: row NOT signable until this child's gate is GREEN
  9. formula_snapshot      — EXACT formula at sign-off (not a mutable id pointer)

STRUCTURAL SIGN-OFF RULES (enforced in code, §4 of synthesis):
  Rule 1: A parity_gap:True row can NEVER be signed as "shadow-compare GREEN".
          It has no legacy shadow; it goes to the correctness-fixture gate.
  Rule 2: A row with a non-null child_dependency can NEVER be signed before
          that dependency's gate is GREEN.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# Shadow compare classification constants
# (must match MismatchCategory in taxonomy.py + any new categories)
# ---------------------------------------------------------------------------

EXPECTED_DEFINITIONAL_DELTA = "EXPECTED_DEFINITIONAL_DELTA"
COGS_SETTINGS_CHANGE_DELTA = "COGS_SETTINGS_CHANGE_DELTA"
BLOCKING_BUG = "BLOCKING_BUG"
CORRECTNESS_FIXTURE = "CORRECTNESS_FIXTURE"  # for parity_gap:True rows


# ---------------------------------------------------------------------------
# DDR Row dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DDRRow:
    """One row in the Definitional-Delta Register.

    CF-C4-DDR-1: 9 fields. Frozen (immutable): the register is a stable
    governance artifact — rows are added, never mutated post-sign-off.

    Fields 1–6 from original 6-field schema (Child-2 intake).
    Fields 7–9 are NEW per CF-C4-DDR-1 (synthesis §4).
    """

    # 1. Legacy formula — file:line reference
    legacy_formula: str

    # 2. Brain formula — registry definition id
    brain_formula: str

    # 3. Reason — plain-language explanation
    reason: str

    # 4. Shadow compare classification (use constants above)
    shadow_compare_classification: str

    # 5. Delta direction and magnitude
    delta_direction_and_magnitude: str

    # 6. Business impact — downstream blast radius
    business_impact: str

    # 7. parity_gap: True = Brain-native, no legacy comparand → correctness_fixture gate
    #    STRUCTURAL RULE 1: parity_gap:True rows can NEVER be signed as shadow GREEN.
    parity_gap: bool

    # 8. child_dependency: str|None — row NOT signable until dependency gate is GREEN.
    #    STRUCTURAL RULE 2: non-null child_dependency rows blocked from sign-off.
    child_dependency: Optional[str]

    # 9. formula_snapshot: EXACT formula expression captured at sign-off.
    #    Not a mutable id pointer — a post-sign-off definition amendment cannot
    #    silently change what Rohan signed.
    formula_snapshot: str

    def assert_signable(self) -> None:
        """Assert this row is eligible for Rohan's Stage-6 signature.

        STRUCTURAL SIGN-OFF RULES (CF-C4-DDR-1 / synthesis §4):
        Rule 1: parity_gap:True rows route to correctness-fixture gate,
                NEVER to shadow-compare. Signing them as "shadow GREEN"
                is a structural error (they have no legacy shadow).
        Rule 2: non-null child_dependency rows cannot be signed until
                that dependency's gate is GREEN.

        Raises:
            SignOffBlockedError: if either rule is violated.
        """
        if self.parity_gap:
            raise SignOffBlockedError(
                f"DDR row '{self.brain_formula}' has parity_gap=True. "
                "This metric has NO legacy comparand. It must be routed "
                "to the correctness-fixture gate — Rohan's sign-off must "
                "explicitly acknowledge no legacy shadow. "
                "NEVER sign a parity_gap row as shadow-compare GREEN. "
                "CF-C4-DDR-1 Rule 1."
            )
        if self.child_dependency is not None:
            raise SignOffBlockedError(
                f"DDR row '{self.brain_formula}' has child_dependency="
                f"'{self.child_dependency}'. This row is NOT signable until "
                f"the '{self.child_dependency}' gate is GREEN. "
                "Signing this row before the dependency is resolved would "
                "commit to a comparison that cannot yet be exercised. "
                "CF-C4-DDR-1 Rule 2."
            )


class SignOffBlockedError(Exception):
    """Raised when assert_signable() detects a structural sign-off violation.

    CF-C4-DDR-1 structural enforcement:
    - Rule 1: parity_gap:True rows must NEVER be signed as shadow-compare GREEN.
    - Rule 2: non-null child_dependency rows cannot be signed before the dependency.
    """


# ---------------------------------------------------------------------------
# Day-one rows (CF-C4-DDR-1 / architecture plan §10)
# ---------------------------------------------------------------------------

_ROW_CM2 = DDRRow(
    # Legacy: compute-daily.ts:234 (daily path — canonical)
    # Divergent: pnl.ts:195 (lagged shipping — range aggregate)
    legacy_formula="compute-daily.ts:234 (cm2 = cm1 - totalAdSpend); divergent path pnl.ts:195 (lagged range)",
    brain_formula="cm2_mu",
    reason=(
        "Brain canonicalizes on compute-daily.ts daily path. "
        "The pnl.ts:195 path is a range-aggregate (lagged shipping cost attribution) "
        "that diverges from the daily compute-daily path on high-RTO / fast-shipping days. "
        "Brain's CM2 = CM1 − Total Ad Spend using daily integers."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Brain slightly higher when pnl.ts lags shipping attribution. "
        "Magnitude: 0–5% of total ad spend on high-shipping days. "
        "Direction: Brain_cm2 >= legacy_cm2 on days where pnl.ts defers costs."
    ),
    business_impact=(
        "CM2 is the primary decision metric for ad spend efficiency. "
        "Small delta (<5%) on range aggregates; daily comparand is correct. "
        "Brands see slightly different CM2% when using the PnL page vs Analytics."
    ),
    parity_gap=False,
    child_dependency=None,
    formula_snapshot="cm2_mu = cm1_mu - total_ad_spend_mu (integer subtraction, paise)",
)

_ROW_CM1 = DDRRow(
    # Legacy CANONICAL: compute-daily.ts:187 (cm1 = netSales - cogs - shipping - packaging - website)
    # Legacy DIVERGENT: waterfall.ts:987 (cm1 = revenueAfterTaxShipping - cogs - varCosts - rto)
    # Phase-2 slice-2 (feat-pnl-cm-waterfall). Closes the TS<->Python cm1_mu divergence.
    legacy_formula=(
        "compute-daily.ts:187 (cm1 = netSales - cogs - shipping - packaging - website); "
        "divergent path waterfall.ts:987 (cm1 = revenueAfterTaxShipping - cogs - varCosts - rto)"
    ),
    brain_formula="cm1_mu",
    reason=(
        "Brain canonicalizes CM1 on the compute-daily daily path: "
        "cm1_mu = net_revenue_mu - cogs_mu - variable_costs_mu (variable_costs = shipping + "
        "packaging + website charges). TWO things this row pins: "
        "(1) The legacy /waterfall page folds RTO charges AND tax/shipping into the CM1 base; "
        "Brain does NOT fold RTO into CM1 (that would double-count against the CM2-level RTO "
        "provision). The honest RTO adjustment lives at CM2 via the Brain-native true_cm2_mu "
        "(parity_gap:true, _ROW_TRUE_CM2) — the correct place. "
        "(2) HISTORICAL CORRECTNESS NOTE: before slice-2 the TypeScript registry cm1_mu was "
        "net_revenue - cogs (COGS-only), silently diverging from the Python cm1_mu and from "
        "legacy compute-daily.ts:187. The shadow_compare gate compares structural fields and "
        "golden decimal-conversion vectors, NOT formula text, so the divergence shipped "
        "unnoticed (same root cause as the feat-metric-engine-olap-split Shreya H-1 bounce). "
        "Slice-2 added variable_costs_mu to the TS registry, corrected cm1_mu to the 3-arg "
        "honest form (byte-identical to Python), and added a cross-language formula anchor "
        "fixture so the gate now bites. This row is the governance record of that correction."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "vs compute-daily canonical: delta = 0 (Brain matches the daily path exactly). "
        "vs the /waterfall page path: Brain_cm1 >= waterfall_cm1 because waterfall subtracts "
        "RTO charges (and tax/shipping) inside CM1; Brain defers RTO to true_cm2_mu. "
        "Magnitude = the RTO charge total + the tax/shipping the waterfall page nets into CM1. "
        "Worked anchor: net_revenue=779000p, cogs=200000p, variable_costs=50000p -> "
        "cm1 = 779000 - 200000 - 50000 = 529000p (integer paise)."
    ),
    business_impact=(
        "CM1 (gross contribution after COGS + variable fulfilment costs) is the head of the "
        "CM ladder feeding CM2 -> CM3 -> True-CM2. The pre-slice-2 COGS-only TS cm1_mu "
        "OVERSTATED CM1 by the full variable-cost line on every workspace that displayed the "
        "TS-derived ladder — materially inflating perceived contribution. The correction makes "
        "the /pnl and /waterfall pages honest and consistent with the analytics rollup."
    ),
    parity_gap=False,
    child_dependency=None,
    formula_snapshot=(
        "cm1_mu = net_revenue_mu - cogs_mu - variable_costs_mu (integer subtraction, paise); "
        "variable_costs_mu = shipping_mu + packaging_mu + website_charges_mu; "
        "ClickHouse: toInt64(net_revenue_mu - cogs_mu - variable_costs_mu). "
        "RTO is NOT in CM1 — RTO provision applied at CM2 via true_cm2_mu."
    ),
)

_ROW_MISC_PRORATED = DDRRow(
    # Legacy: compute-daily.ts:236-243 (monthlyAmt / getDaysInMonth(dateAtNoonUtc))
    # CF-C4-DDR-MISC-PRORATE-1: Feb-boundary example; adjudication discipline.
    legacy_formula="compute-daily.ts:236-243 (monthlyAmt / getDaysInMonth(dateAtNoonUtc))",
    brain_formula="misc_expenses_prorated_mu",
    reason=(
        "Brain uses intDiv(monthly_amount_mu, toDaysInMonth(date)) — integer FLOOR division. "
        "Legacy used JS float division stored as Postgres Decimal (ROUND_HALF_UP). "
        "The delta is Postgres ROUND_HALF_UP vs Brain ROUND_HALF_EVEN on .X45 midpoints "
        "(systematic 1-paise drift). This is NOT a Float64 coercion artifact. "
        "CF-C4-PRORATED-DIVOP-1 + CF-C4-DDR-MISC-PRORATE-1. "
        "IMPORTANT — adjudication discipline (CF-C4-DDR-MISC-PRORATE-1): "
        "before stamping EXPECTED_DEFINITIONAL_DELTA, the reviewer MUST ask "
        "'Is Brain's toDaysInMonth(date) correct for this date?' "
        "A wrong-constant bug (e.g. hardcoded 30 instead of toDaysInMonth) "
        "must NOT be hidden behind the ROUNDING_MODE_MISMATCH label. "
        "Feb-boundary example: 2026-02-15 → 28 days (not 30, not 29). "
        "2024-02-15 (leap year) → 29 days (not 28, not 30)."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Feb boundary example (CF-C4-DDR-MISC-PRORATE-1): "
        "monthly_amount = ₹10,000 (1000000 paise). "
        "Feb 2026 (28 days): intDiv(1000000, 28) = 35714 paise/day (₹357.14). "
        "Feb 2024 (29 days, leap): intDiv(1000000, 29) = 34482 paise/day (₹344.82). "
        "March 2026 (31 days): intDiv(1000000, 31) = 32258 paise/day (₹322.58). "
        "A hardcoded 30 gives intDiv(1000000, 30) = 33333 — WRONG for Feb and 31-day months. "
        "ROUNDING_MODE_MISMATCH drift: at most 1 paise on .X45 midpoints; non-blocking."
    ),
    business_impact=(
        "cm3 = cm2 - misc_expenses_prorated. The proration drift is 0–1 paise/day. "
        "Annual impact: <₹365 across all misc expenses combined. Not material to decisions. "
        "The wrong-constant bug (hardcoded 30) is MATERIAL on Feb boundary: "
        "delta = 33333 - 35714 = -2381 paise = ₹23.81/day — a real bug, NOT a rounding delta."
    ),
    parity_gap=False,
    child_dependency=None,
    formula_snapshot=(
        "misc_expenses_prorated_mu = intDiv(monthly_amount_mu, toDaysInMonth(date)); "
        "ClickHouse: if(toDaysInMonth(date) > 0, intDiv(monthly_amount_mu, toDaysInMonth(date)), NULL)"
    ),
)

_ROW_COGS = DDRRow(
    # Legacy: compute-daily.ts (nightly full recompute, uses current coq at run time)
    # CF-C4-COGS-MV-REFRESH-1: Brain uses scheduled full daily recompute (not incremental MV)
    legacy_formula="compute-daily.ts (nightly full recompute via resolveLineItemCogs + coqMap)",
    brain_formula="cogs_mu",
    reason=(
        "Brain uses a scheduled full daily recompute keyed on (workspace_id, date). "
        "This matches legacy exactly: on a coq-settings-change day, the full recompute "
        "uses the CURRENT coq for ALL line items (not a split old/new). "
        "An incremental MV would be WRONG: it would use old coq for events before the "
        "change and new coq after — permanently wrong delta that could be mislabeled "
        "EXPECTED_DEFINITIONAL_DELTA. CF-C4-COGS-MV-REFRESH-1."
    ),
    shadow_compare_classification=COGS_SETTINGS_CHANGE_DELTA,
    delta_direction_and_magnitude=(
        "Zero delta on full-recompute model vs legacy (both use current coq at run time). "
        "Incremental-MV model would diverge on coq-settings-change days: "
        "delta = (new_coq - old_coq) × line_items_before_change_time."
    ),
    business_impact=(
        "COGS feeds CM1→CM2→CM3 ladder. A wrong COGS on coq-change day "
        "silently corrupts all downstream margins. Full-recompute eliminates this risk."
    ),
    parity_gap=False,
    child_dependency=None,
    formula_snapshot=(
        "cogs_mu = SUM(resolveLineItemCogs(item, coqMap, cogsSettings)) per line item, "
        "scheduled full daily recompute at (workspace_id, date), integer per-item paise."
    ),
)

_ROW_TRUE_CM2 = DDRRow(
    # Legacy: NONE — compute-daily.ts stops at cm2 line 234 (no trueCm2 / rtoProvision)
    # CF-C4-DDR-TRUE-CM2-1: parity_gap:True; correctness-fixture gate; worked example.
    legacy_formula="NONE — compute-daily.ts stops at cm2 (line 234); no trueCm2 / rtoProvision field",
    brain_formula="true_cm2_mu",
    reason=(
        "True-CM2 is a Brain-native metric with NO legacy comparand. "
        "The legacy system does not provision for RTO reversal costs. "
        "Brain's True CM2 = CM2 − RTO Provision, where: "
        "  rto_provision_mu = intDiv(rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu), "
        "                            total_orders_count). "
        "Rationale: reversal cost per returned order is proportional to "
        "the cost base (ad spend + fulfillment + COGS) / order volume. "
        "This metric must be verified by a correctness-fixture gate (worked example), "
        "NEVER by a shadow-compare gate (there is no legacy value to compare against). "
        "Rohan's Stage-6 sign-off must explicitly acknowledge no legacy shadow."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Not applicable — no legacy comparand. "
        "True CM2 < CM2 always (RTO provision is a non-negative cost). "
        "Worked example (CF-C4-DDR-TRUE-CM2-1): "
        "  total_orders=120, rto_orders=18 (15% RTO), "
        "  total_ad_spend=₹50,000, variable_costs=₹12,000, cogs=₹30,000, "
        "  cm2=₹80,000. "
        "  cost_base = 5000000+1200000+3000000 = 9200000 paise. "
        "  rto_provision = intDiv(18×9200000, 120) = intDiv(165600000, 120) = 1380000 paise. "
        "  true_cm2 = 8000000 - 1380000 = 6620000 paise (₹66,200). "
        "  True CM2 margin = 6620000/8000000 = 82.75% of CM2."
    ),
    business_impact=(
        "True CM2 is a more conservative profitability signal for high-RTO categories. "
        "A 15% RTO reduces CM2 by ~17% in the worked example. "
        "For brands with 20%+ RTO (common in fashion/impulse-buy D2C), "
        "the difference between CM2 and True CM2 is strategically material."
    ),
    parity_gap=True,   # Brain-native: STRUCTURAL RULE 1 applies
    child_dependency=None,
    formula_snapshot=(
        "true_cm2_mu = cm2_mu - intDiv("
        "rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu), "
        "total_orders_count); "
        "NULL when total_orders_count <= 0. "
        "ClickHouse: if(total_orders_count > 0, toInt64(cm2_mu - intDiv("
        "rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), "
        "total_orders_count)), NULL)"
    ),
)

_ROW_REALIZED_REVENUE = DDRRow(
    # Legacy: NONE — compute-daily.ts stops at the daily revenue figure; it never
    # subtracts post-sale reversals (cancellations / RTO / refunds) from revenue.
    # Phase-2 slice-1 (feat-store-order-fact-layer). CF-C2-realized-1.
    legacy_formula="NONE — compute-daily.ts has no realized-revenue field (no post-sale reversal subtraction from daily revenue)",
    brain_formula="realized_revenue_mu",
    reason=(
        "Realized Revenue is a Brain-native metric with NO legacy comparand — it is "
        "the honest billing base. Realized = Net Revenue − Cancelled − RTO-reversed − "
        "Refunded. The legacy system reports daily net revenue but never deducts post-sale "
        "reversals from it, so a high-cancel / high-RTO day shows legacy revenue that was "
        "never actually realized. This metric must be verified by a correctness-fixture "
        "worked example, NEVER by a shadow-compare gate (there is no legacy value to "
        "compare against). Rohan's Stage-6 sign-off must explicitly acknowledge no legacy "
        "shadow. Note: this slice subtracts the reversal aggregates as facts; per-SKU GST "
        "feeds the net_revenue_mu upstream via the India RegionAdapter (total_tax_mu DDR row)."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Not applicable — no legacy comparand. "
        "realized_revenue_mu <= net_revenue_mu always (reversals are non-negative). "
        "Worked example (CF-C2-realized-1): "
        "net_revenue=4960000p (₹49,600), cancelled=120000p, rto_reversed=300000p, "
        "refunded=80000p → realized = 4960000 − 120000 − 300000 − 80000 = 4460000p (₹44,600). "
        "Realized margin = 4460000/4960000 = 89.9% of reported net revenue on this day."
    ),
    business_impact=(
        "Realized Revenue is the honest %-of-GMV billing base and the trustworthy top of "
        "the contribution-margin ladder. For high-RTO / high-cancel Indian-D2C brands the "
        "gap between reported net revenue and realized revenue is strategically material — "
        "billing or CM math on un-realized revenue overstates health. This metric makes the "
        "reversal leak visible at the top of the /store ladder."
    ),
    parity_gap=True,  # Brain-native: STRUCTURAL RULE 1 applies (no shadow-compare GREEN)
    child_dependency=None,
    formula_snapshot=(
        "realized_revenue_mu = net_revenue_mu - cancelled_revenue_mu "
        "- rto_reversed_revenue_mu - refunded_revenue_mu (integer subtraction, paise); "
        "ClickHouse: toInt64(net_revenue_mu - cancelled_revenue_mu "
        "- rto_reversed_revenue_mu - refunded_revenue_mu)"
    ),
)

# _ROW_PAMER DECOMMISSIONED (Phase-2 slice-4, feat-marketing-acquisition).
# pamer_bp (= cm2/total_ad_spend) was a Child-4 pre-build with NO legacy comparand.
# It was never consumed by any page and conflated "profit-adjusted MER" with the real
# legacy aMER. Removed from both registries; see _ROW_PAMER_DECOMMISSION (informational)
# in the .md register for the audit trail. No DDRRow object remains for pamer_bp.

# aMER REDEFINED to legacy ground truth (slice-4). Previously (Child-4) it was
# true_cm2/total_ad_spend with no legacy comparand. Legacy aMER = new-customer revenue
# / ACQUISITION-CLASSIFIED ad spend (marketing-efficiency.ts:25-28; ads-spend.ts:82-84).
_ROW_AMER = DDRRow(
    legacy_formula=(
        "marketing-efficiency.ts:25-28 — aMer = newCustomerRevenue / acquisitionAdSpend "
        "where acquisitionAdSpend is the acquisition campaign-intent bucket ONLY "
        "(ads-spend.ts:82-84; unclassified/brand/non_acquisition EXCLUDED)."
    ),
    brain_formula="amer_bp",
    reason=(
        "REDEFINED from the Child-4 placeholder (true_cm2/total_ad_spend) to the legacy "
        "semantics: aMER = new_customer_revenue_mu / acquisition_ad_spend_mu (basis points). "
        "The denominator is acquisition-classified spend ONLY (its own def "
        "acquisition_ad_spend_mu) — NOT total_ad_spend_mu. This is the load-bearing "
        "correction (Rohan Stage-1 finding + persona Concern 1). correctness_fixture: "
        "amer_bp = intDiv(new_customer_revenue_mu × 10000, acquisition_ad_spend_mu)."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Brain integerizes the legacy float (Math.round(nc_rev/acq_spend×100)/100) to a "
        "single FLOOR-to-bp. Worked anchor (CF-S4-AMER-1): nc_revenue=₹60,000 (6000000 paise), "
        "acquisition_ad_spend=₹40,000 (4000000 paise) — note total spend may be ₹100,000 but "
        "only ₹40,000 is acquisition-classified. amer_bp = intDiv(6000000×10000, 4000000) = "
        "15000 bp = 1.50x. A 'use total_ad_spend (10000000)' mutant yields 6000 bp — KILLED."
    ),
    business_impact=(
        "aMER is THE new-customer acquisition-efficiency decision metric. Using total spend "
        "instead of acquisition-classified spend understates aMER for any brand that classifies "
        "campaigns, mis-flagging healthy acquisition as unprofitable."
    ),
    parity_gap=True,
    child_dependency=None,
    formula_snapshot=(
        "amer_bp = intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu); "
        "NULL if acquisition_ad_spend_mu <= 0"
    ),
)

# MER numerator-basis reconciliation (slice-4). Legacy mer = storeNetRevenue/totalAdSpend.
# Child-4 PY mer_bp used net_sales_mu; reconciled to net_revenue_mu (the slice-1 /store rung)
# for cross-surface consistency (MER on /acquisition == /store net revenue ÷ spend).
_ROW_MER_BASIS = DDRRow(
    legacy_formula=(
        "marketing-efficiency.ts:21-24 — mer = storeNetRevenue / totalAdSpend; "
        "storeNetRevenue from ads-spend.ts:fetchStoreNetRevenueForPeriod "
        "(net-of-tax minus refund share, analytics+gap-fill reconciled)."
    ),
    brain_formula="mer_bp",
    reason=(
        "Brain MER numerator = net_revenue_mu (the slice-1 store net-revenue rung) so the "
        "/acquisition MER equals the /store net revenue for the same range (cross-surface "
        "consistency; persona Concern 3). Child-4 used net_sales_mu — reconciled to net_revenue_mu."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Numerator basis change net_sales_mu → net_revenue_mu (net_revenue = net_net_tax + "
        "shipping_revenue). Worked anchor (CF-S4-MER-1): net_revenue=₹120,000 (12000000 paise), "
        "total_ad_spend=₹100,000 (10000000 paise) → intDiv(12000000×10000, 10000000) = 12000 bp = 1.20x."
    ),
    business_impact=(
        "MER must visibly match the /store net revenue figure or operators distrust the number. "
        "Numerator-basis drift between surfaces erodes trust in the whole workbench."
    ),
    parity_gap=False,  # legacy comparand EXISTS (storeNetRevenue/totalAdSpend) — expected definitional delta, not a no-comparand fixture
    child_dependency=None,
    formula_snapshot=(
        "mer_bp = intDiv(net_revenue_mu * 10000, total_ad_spend_mu); NULL if total_ad_spend_mu <= 0"
    ),
)

# New-customer revenue / CM2 / per-NC (slice-4). Connector-sourced first-order facts;
# unmeasurable pre-Child-3 (mirrors _ROW_TOTAL_TAX). Per-order tax uses per-SKU GST (never blended).
_ROW_NC_REVENUE_CM2 = DDRRow(
    legacy_formula=(
        "acquisition/compute.ts:384-423 — per-NC-order: newCustomerRevenue += totalPrice - "
        "totalTax - orderShareRefunds (RTO excluded); ncCm2 = totalPrice - cogs - perOrder("
        "shipping+packaging+website+adSpend) - refundShare (RTO→0); blendedCac = totalAdSpend/"
        "newCustomers; cm2PerNc = totalNcCm2/newCustomers. New customer = first order in range."
    ),
    brain_formula="new_customer_revenue_mu / nc_cm2_mu / cm2_per_nc_mu / acquisition_ad_spend_mu",
    reason=(
        "Connector-sourced first-order facts + per-order COGS/variable/adSpend allocation + "
        "refund share + RTO exclusion + per-SKU GST tax (NEVER blended). The use-case assembles; "
        "the registry rungs are passthrough aggregates. Unmeasurable pre-Child-3 connector cutover."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "child_dependency: child-3-shopify-connector — not signable until the connector gate is "
        "GREEN (Rule 2; mirrors _ROW_TOTAL_TAX). Anchors: cac_mu ₹500 (10000000/200); "
        "cm2_per_nc_mu ₹100 (2000000/200)."
    ),
    business_impact=(
        "New-customer CM2/revenue are the acquisition-quality core. Per-order per-SKU tax (not "
        "blended) keeps the India GST-2.0 honesty; RTO exclusion keeps CM2 honest."
    ),
    parity_gap=False,
    child_dependency="child-3-shopify-connector",
    formula_snapshot=(
        "new_customer_revenue_mu = SUM per-NC-order (totalPrice - totalTax - refundShare), RTO->0; "
        "nc_cm2_mu = SUM per-NC-order (price - cogs - perOrderVariable - perOrderAdSpend - refundShare), RTO->0; "
        "cm2_per_nc_mu = intDiv(nc_cm2_mu, new_customers_count); "
        "acquisition_ad_spend_mu = SUM spend where campaign intent == 'acquisition'"
    ),
)

_ROW_LTV_CAC = DDRRow(
    legacy_formula="NONE — LTV:CAC is Brain-native; no legacy comparand",
    brain_formula="ltv_cac_bp",
    reason=(
        "LTV:CAC ratio = Customer Lifetime Value / Customer Acquisition Cost (basis points). "
        "Brain-native metric — the legacy system does not compute LTV. "
        "LTV is computed by lifecycle-service (Child-5 pipeline). "
        "CAC = intDiv(total_ad_spend_mu, new_customers_count). "
        "Correctness fixture: ltv_cac_bp = intDiv(ltv_mu × 10000, cac_mu)."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Not applicable — no legacy comparand. "
        "Example: LTV=₹3,000 (300000 paise), CAC=₹1,000 (100000 paise). "
        "ltv_cac_bp = intDiv(300000×10000, 100000) = intDiv(3000000000, 100000) = 30000 bp = 3.0x."
    ),
    business_impact=(
        "LTV:CAC > 30000 (3.0x) is the standard SaaS-analog health benchmark for D2C. "
        "Brain uses this to flag acquisition efficiency vs retention investment trade-offs. "
        "High LTV:CAC justifies increased ad spend; low LTV:CAC signals over-acquisition."
    ),
    parity_gap=True,
    child_dependency=None,
    formula_snapshot="ltv_cac_bp = intDiv(ltv_mu * 10000, cac_mu); NULL if cac_mu <= 0",
)

_ROW_TOTAL_TAX = DDRRow(
    # Legacy: analytics-sync.ts:42-43,208,256 — ShopifyQL `taxes` DAY-LEVEL aggregate
    # Brain: SUM(event-level per-SKU GST-2.0 line tax via RegionAdapter India)
    # CF-C4-DDR-GST-TAX-1: child_dependency: child-3-shopify-connector
    legacy_formula=(
        "analytics-sync.ts:42-43 (ShopifyQL: SHOW taxes TIMESERIES day); "
        "analytics-sync.ts:208 (taxes = Number(row['taxes'] ?? 0)); "
        "analytics-sync.ts:256 (total_tax: row['taxes'])"
    ),
    brain_formula="total_tax_mu",
    reason=(
        "DIFFERENT INGEST PIPELINES — this is the highest-risk wrong-but-signed delta. "
        "Legacy: ShopifyQL `taxes` field is a DAY-LEVEL aggregate from the Shopify "
        "analytics API (not per-order, not per-SKU line item). "
        "Brain: SUM(event-level per-SKU GST-2.0 line tax via RegionAdapter India). "
        "Different granularity: ShopifyQL aggregates across ALL tax types; "
        "Brain applies per-SKU rates (0%, 5%, 12%, 18% GST slabs). "
        "CF-C4-DDR-GST-TAX-1: NOT signable or measurable pre-Child-3 ingest. "
        "While shadowing on legacy-sourced data, this delta is UNMEASURABLE. "
        "total_tax_mu feeds Net-Net-Tax → Net Revenue → CM1 → whole ladder. "
        "A wrong-but-signed value here silently corrupts ALL downstream metrics."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "CF-C4-DDR-GST-TAX-1 magnitude estimate: "
        "Homogeneous-SKU workspace (all 18% GST or all 0%): delta ~0–2%. "
        "Mixed slab workspace (mix of 0%/5%/12%/18% SKUs): delta ~5–10%. "
        "Direction: Brain may be higher or lower depending on SKU mix vs aggregate. "
        "Cannot be measured until Child-3 provides per-SKU event-level tax data."
    ),
    business_impact=(
        "total_tax_mu flows into: Net-Net-Tax → Net Revenue → CM1 → CM2 → CM3. "
        "A 5% tax delta on a ₹5,00,000/day GMV workspace = ₹25,000/day error in CM1. "
        "This is MATERIAL. Row NOT signable until Child-3 gate is GREEN."
    ),
    parity_gap=False,
    child_dependency="child-3-shopify-connector",  # STRUCTURAL RULE 2 applies
    formula_snapshot=(
        "total_tax_mu = SUM(event-level per-SKU GST-2.0 line tax) via RegionAdapter India; "
        "pending Child-3 connector ingest of per-SKU line-item tax data"
    ),
)

_ROW_FX = DDRRow(
    # Legacy: workspace-costs.ts:9-21 / pnl.ts:11-17 (EXCHANGE_RATES INR:83.5)
    # CF-C4-DDR-FX-RESTATEMENT-1: shadow-phase Brain uses same static 83.5 rate
    legacy_formula=(
        "workspace-costs.ts:9-21 (EXCHANGE_RATES: {USD:1, INR:83.5, ...}); "
        "pnl.ts:11-17 (convertCurrency using same EXCHANGE_RATES)"
    ),
    brain_formula="FX_SHADOW_RATE_INR_PER_USD (registry constant = 8350 paise/USD)",
    reason=(
        "During the Child-4 shadow phase, Brain's metric MV MUST use the same static "
        "rate as legacy (INR:83.5 per USD) so the shadow-compare is not contaminated "
        "by two simultaneous FX changes (the expected rate delta AND a wrong placeholder). "
        "Live-rate conversion activates only once workspace-cost entries are migrated "
        "to primary-currency-at-entry (Child-3 workspace-cost-currency-migration). "
        "CF-C4-DDR-FX-RESTATEMENT-1: shadow-phase rate pin = 83.5 / 8350 paise per USD."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Shadow phase: delta = 0 (Brain uses same rate as legacy). "
        "Post-Child-3: delta = (live_rate - 83.5) × foreign_cost_mu / 8350. "
        "Direction: Brain higher if INR strengthens (< 83.5); lower if weakens (> 83.5). "
        "Magnitude: immaterial if all costs already in INR; material only for USD/EUR-denominated costs."
    ),
    business_impact=(
        "Workspace costs in non-INR currencies are converted to INR before CM computation. "
        "A 5% FX rate change on a ₹50,000/month USD-denominated cost = ₹2,500/month delta. "
        "Row NOT signable until Child-3 workspace-cost-currency-migration gate is GREEN."
    ),
    parity_gap=False,
    child_dependency="child-3-workspace-cost-currency-migration",  # STRUCTURAL RULE 2
    formula_snapshot=(
        "FX_SHADOW_RATE_INR_PER_USD = 8350 paise per USD (= ₹83.50); "
        "matches legacy workspace-costs.ts EXCHANGE_RATES {INR: 83.5}; "
        "live-rate conversion held for Child-3"
    ),
)

_ROW_BLENDED_ROAS = DDRRow(
    # Legacy: compute-daily.ts (schema:879-880, blendedRoas = netSales / totalAdSpend)
    legacy_formula="compute-daily.ts schema:879-880 (blendedRoas = netSales / totalAdSpend)",
    brain_formula="blended_roas_x100",
    reason=(
        "ROAS is a display-only metric at Brain. CM2-first paradigm: "
        "ROAS is NEVER a decision metric. Documented divergence: "
        "Legacy uses JS float division; Brain uses intDiv(net_sales_mu × 100, total_ad_spend_mu). "
        "The ×100 scale gives 2 decimal places of ROAS (e.g. 247 = ROAS 2.47x). "
        "display_only:True enforced in the registry."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Brain ROAS is integer FLOOR, legacy is float round-to-2dp. "
        "Delta: at most 0.01x (1 unit in ×100 representation). Non-material for display. "
        "Direction: Brain ≤ legacy (FLOOR vs ROUND)."
    ),
    business_impact="Display only. Non-blocking. Not used for any Brain decision.",
    parity_gap=False,
    child_dependency=None,
    formula_snapshot=(
        "blended_roas_x100 = intDiv(net_sales_mu * 100, total_ad_spend_mu); "
        "display_only:True; CM2-first — ROAS never a decision metric"
    ),
)

_ROW_ACOS = DDRRow(
    legacy_formula="compute-daily.ts:247 (acos = (totalAdSpend / netSales) × 10000 / 100)",
    brain_formula="acos_bp",
    reason=(
        "ACOS is display-only at Brain (CM2-first). "
        "Brain: intDiv(total_ad_spend_mu × 10000, net_sales_mu) — basis points. "
        "Legacy: Math.round((totalAdSpend / netSales) × 10000) / 100 — percent with 2dp. "
        "Different representation scale (bp vs percent)."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Representation difference: Brain in bp, legacy in percent. "
        "After normalizing: delta at most 1 bp from FLOOR vs ROUND. Non-material."
    ),
    business_impact="Display only. Non-blocking. Not used for any Brain decision.",
    parity_gap=False,
    child_dependency=None,
    formula_snapshot=(
        "acos_bp = intDiv(total_ad_spend_mu * 10000, net_sales_mu); "
        "display_only:True; CM2-first — ACOS never a decision metric"
    ),
)


_ROW_BREAKEVEN_COD_RTO = DDRRow(
    # Phase-2 slice-3 (feat-rto-cod-economics). Legacy: cod-prepaid-analytics.ts:218-231.
    # Rohan/persona Concern-1: the slice table's naive r*=M/(M+C) is WRONG; Brain ports the FULL formula.
    legacy_formula=(
        "cod-prepaid-analytics.ts:218-231 "
        "(numerator = V*P + (COD_fee - PG_fee) + P*(S+RS); denominator = V + S + RS; "
        "rCodBe = numerator/denominator; valid only if 0<=rCodBe<=1; "
        "PG_fee = V*(gatewayFeePercent/100))"
    ),
    brain_formula="breakeven_cod_rto_rate_bp",
    reason=(
        "Brain canonicalizes the FULL legacy COD break-even RTO rate, NOT the naive M/(M+C) form "
        "that appeared in the ratified slice table. The naive form is a degenerate special case and "
        "would mis-advise COD-vs-prepaid policy — a top India-D2C margin lever. Brain computes the "
        "exact legacy formula in INTEGER paise with a SINGLE final FLOOR-to-bp (no chained float), "
        "so TS and Python are byte-identical. parity_gap:true (Brain canonical integer form; the "
        "legacy float result is not a byte comparand). Routed to the correctness-fixture gate with a "
        "cross-language worked anchor that FAILS the naive M/(M+C) and PASSES the full form — the "
        "slice-2 verify-the-verifier lesson applied. Rohan's Stage-6 sign-off must acknowledge no "
        "legacy byte shadow. When the result is outside [0, 10000] bp the use-case surfaces the "
        "legacy breakEvenNote instead of a rate; the registry value is the raw bp."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Not applicable — no legacy byte comparand (legacy is float, Brain is integer-canonical). "
        "WORKED ANCHOR (CF-S3-BREAKEVEN-1): aov_mu=150000 (₹1500), prepaid_rto_rate_bp=500 (5%), "
        "cod_fee_mu=3000 (₹30), gateway_fee_bp=200 (2%), return_shipping_mu=8000 (₹80), restocking_mu=0. "
        "pg_fee = intDiv(150000*200, 10000) = 3000. "
        "num_scaled = 150000*500 + (3000-3000)*10000 + 500*(8000+0) = 75000000 + 0 + 4000000 = 79000000. "
        "denom = 150000 + 8000 + 0 = 158000. "
        "breakeven_cod_rto_rate_bp = intDiv(79000000, 158000) = 500 bp (5.00%). "
        "The naive M/(M+C) would yield ~95% — the anchor distinguishes the two formulas."
    ),
    business_impact=(
        "Break-even COD RTO rate is the decision threshold for COD-vs-prepaid policy: above r* prepaid "
        "is more profitable at the current AOV and fees. For high-RTO Indian-D2C brands this is the "
        "single largest controllable margin lever. A wrong (naive) formula would systematically "
        "mis-advise the COD discount / prepaid-nudge strategy."
    ),
    parity_gap=True,  # STRUCTURAL RULE 1: correctness-fixture gate, never shadow GREEN
    child_dependency=None,
    formula_snapshot=(
        "breakeven_cod_rto_rate_bp = intDiv("
        "aov_mu * prepaid_rto_rate_bp "
        "+ (cod_fee_mu - intDiv(aov_mu * gateway_fee_bp, 10000)) * 10000 "
        "+ prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu), "
        "aov_mu + return_shipping_mu + restocking_mu); "
        "NULL when (aov_mu + return_shipping_mu + restocking_mu) <= 0. "
        "ClickHouse: if((aov_mu + return_shipping_mu + restocking_mu) > 0, intDiv(aov_mu * prepaid_rto_rate_bp "
        "+ (cod_fee_mu - intDiv(aov_mu * gateway_fee_bp, 10000)) * 10000 "
        "+ prepaid_rto_rate_bp * (return_shipping_mu + restocking_mu), "
        "aov_mu + return_shipping_mu + restocking_mu), NULL)"
    ),
)

_ROW_PINCODE_RELIABILITY = DDRRow(
    # Phase-2 slice-3. Legacy float: pincode-intelligence.ts:60-66 (calcProfitabilityScore).
    legacy_formula=(
        "pincode-intelligence.ts:60-66 "
        "(clamp(0,100, 100 - rtoRate*2 - codRate*0.5 + repeatRate*0.5 + (aov/1000)*10); "
        "rates in percent points, aov in rupees — FLOAT)"
    ),
    brain_formula="pincode_reliability_score",
    reason=(
        "Brain integerizes the legacy float profitability score to a deterministic CENTI-POINT score "
        "(0..10000 = 0.00..100.00), so TS and Python are byte-identical (the legacy float coefficients "
        "0.5 and aov/1000 are TS<->Python drift risk — persona Concern-2). Inputs are rates in bp "
        "(=pp*100) and aov in paise. parity_gap:true (Brain-native integer canonical; the legacy float "
        "is not a byte comparand). Routed to the correctness-fixture gate with a worked anchor. "
        "aov-term derivation: legacy (aov_rupees/1000)*10 POINTS = aov_rupees/100 points = aov_rupees "
        "centi-points; aov_rupees = intDiv(aov_mu, 100) ⇒ term_cp = intDiv(aov_mu, 100). "
        "Rohan's Stage-6 sign-off must acknowledge no legacy byte shadow."
    ),
    shadow_compare_classification=CORRECTNESS_FIXTURE,
    delta_direction_and_magnitude=(
        "Not applicable — no legacy byte comparand (legacy float vs Brain integer centi-points). "
        "WORKED ANCHOR (CF-S3-PINCODE-1): rto_bp=1800 (18%), cod_bp=6000 (60%), repeat_bp=2000 (20%), "
        "aov_mu=150000 (₹1500). "
        "raw = 10000 - 1800*2 - intDiv(6000,2) + intDiv(2000,2) + intDiv(150000,100) "
        "= 10000 - 3600 - 3000 + 1000 + 1500 = 5900 centi-points (= 59.00). clamp(0,10000) -> 5900. "
        "Legacy float check: 100 - 18*2 - 60*0.5 + 20*0.5 + (1500/1000)*10 "
        "= 100 - 36 - 30 + 10 + 15 = 59.00 -> matches (×100 = 5900)."
    ),
    business_impact=(
        "Pincode reliability ranks delivery destinations by RTO risk / COD load / repeat loyalty / AOV. "
        "It drives serviceability and COD-gating decisions per pincode — a direct RTO-leak control. "
        "A drifting float score would rank pincodes inconsistently across the web and analytics surfaces."
    ),
    parity_gap=True,  # STRUCTURAL RULE 1
    child_dependency=None,
    formula_snapshot=(
        "pincode_reliability_score = clamp(0, 10000, "
        "10000 - rto_bp*2 - intDiv(cod_bp,2) + intDiv(repeat_bp,2) + intDiv(aov_mu,100)); "
        "centi-points (×100 of legacy 0..100); inputs: rates in bp, aov in paise. "
        "ClickHouse: greatest(0, least(10000, toInt64(10000 - rto_bp * 2 - intDiv(cod_bp, 2) "
        "+ intDiv(repeat_bp, 2) + intDiv(aov_mu, 100))))"
    ),
)

_ROW_RTO_COST_VALUE = DDRRow(
    # Phase-2 slice-3. Legacy: shiprocket-charges.ts (rtoChargesFromRaw / shiprocketRtoRevenueLost).
    # Connector-sourced per-shipment charges/value — unmeasurable pre-Child-3 (mirrors _ROW_TOTAL_TAX).
    # Covers BOTH rto_cost_mu (keyed here) and its sibling rto_revenue_lost_mu (same ingest dependency).
    legacy_formula=(
        "shiprocket-charges.ts (rtoChargesFromRaw -> rto_cost_mu; "
        "shiprocketRtoRevenueLost -> rto_revenue_lost_mu); rto-analytics.ts:114-144 sums per RTO shipment"
    ),
    brain_formula="rto_cost_mu",
    reason=(
        "rto_cost_mu (SUM of per-RTO-shipment charges) and its sibling rto_revenue_lost_mu (SUM of RTO "
        "order/COD value) are CONNECTOR-SOURCED aggregates extracted from Shiprocket raw_json. They are "
        "NOT computable until the Child-3 connector cutover provides per-shipment charge/value data — "
        "exactly like total_tax_mu's per-SKU dependency. During the shadow phase these values are "
        "unmeasurable; the row is NOT signable until the child-3-shopify-connector gate is GREEN "
        "(STRUCTURAL RULE 2). The Brain definitions are passthrough money aggregates (toInt64 of the "
        "summed paise) — never silently float-matched."
    ),
    shadow_compare_classification=EXPECTED_DEFINITIONAL_DELTA,
    delta_direction_and_magnitude=(
        "Unmeasurable pre-Child-3 (no per-shipment charge/value ingest yet). "
        "Once Child-3 is GREEN: Brain = SUM(integer paise per RTO shipment); legacy = float "
        "Math.round(sum*100)/100. Expected delta: sub-paise FLOOR-vs-ROUND rounding only. "
        "rto_revenue_lost_mu shares this row's dependency and rounding behavior."
    ),
    business_impact=(
        "RTO cost and revenue-lost are the money headline of /rto-analytics and /logistics — the "
        "explicit ₹ size of the RTO leak. A wrong-but-signed value here would understate or overstate "
        "the single largest controllable margin leak. NOT signable until Child-3 connector gate is GREEN."
    ),
    parity_gap=False,
    child_dependency="child-3-shopify-connector",  # STRUCTURAL RULE 2 applies
    formula_snapshot=(
        "rto_cost_mu = toInt64(SUM(rtoChargesFromRaw(shipment.raw_json))) over RTO shipments; "
        "rto_revenue_lost_mu = toInt64(SUM(shiprocketRtoRevenueLost(shipment))) over RTO shipments; "
        "connector-sourced; pending Child-3 per-shipment charge/value ingest."
    ),
)


# ---------------------------------------------------------------------------
# The canonical register (ordered by waterfall / priority)
# ---------------------------------------------------------------------------

DEFINITIONAL_DELTA_REGISTER: dict[str, DDRRow] = {
    "cm1_mu":                    _ROW_CM1,
    "cm2_mu":                    _ROW_CM2,
    "misc_expenses_prorated_mu": _ROW_MISC_PRORATED,
    "cogs_mu":                   _ROW_COGS,
    "true_cm2_mu":               _ROW_TRUE_CM2,
    "realized_revenue_mu":       _ROW_REALIZED_REVENUE,
    # pamer_bp DECOMMISSIONED (slice-4) — no DDRRow; audit trail in the .md register.
    "amer_bp":                   _ROW_AMER,
    "ltv_cac_bp":                _ROW_LTV_CAC,
    "total_tax_mu":              _ROW_TOTAL_TAX,
    "fx_restatement":            _ROW_FX,
    "blended_roas_x100":         _ROW_BLENDED_ROAS,
    "acos_bp":                   _ROW_ACOS,
    # Phase-2 slice-3 (feat-rto-cod-economics)
    "breakeven_cod_rto_rate_bp": _ROW_BREAKEVEN_COD_RTO,
    "pincode_reliability_score": _ROW_PINCODE_RELIABILITY,
    "rto_cost_mu":               _ROW_RTO_COST_VALUE,
    # Phase-2 slice-4 (feat-marketing-acquisition): marketing efficiency reconciled to legacy
    "mer_bp":                    _ROW_MER_BASIS,
    "new_customer_revenue_mu":   _ROW_NC_REVENUE_CM2,
}


def get_ddr_row(brain_formula_id: str) -> Optional[DDRRow]:
    """Look up a DDR row by brain_formula id.

    Returns None if no DDR row is registered for this metric
    (i.e. no expected definitional delta — treated as exact equality expected).
    """
    return DEFINITIONAL_DELTA_REGISTER.get(brain_formula_id)


def is_parity_gap(brain_formula_id: str) -> bool:
    """True if the metric has parity_gap:True (Brain-native, no legacy comparand).

    STRUCTURAL RULE 1 gate: parity_gap:True metrics must NEVER be compared
    against legacy via shadow-compare. Route to correctness-fixture gate.
    CF-C4-DDR-1.
    """
    row = get_ddr_row(brain_formula_id)
    return row is not None and row.parity_gap


def is_child_dependency_blocked(brain_formula_id: str) -> bool:
    """True if this metric's DDR row has an unresolved child_dependency.

    STRUCTURAL RULE 2 gate: rows with non-null child_dependency cannot be
    signed until the named dependency's gate is GREEN.
    CF-C4-DDR-1.
    """
    row = get_ddr_row(brain_formula_id)
    return row is not None and row.child_dependency is not None


def get_parity_gap_metrics() -> list[str]:
    """Return all metric ids with parity_gap:True (Brain-native, no legacy shadow)."""
    return [
        metric_id
        for metric_id, row in DEFINITIONAL_DELTA_REGISTER.items()
        if row.parity_gap
    ]


def get_child_dependency_blocked_metrics() -> list[str]:
    """Return all metric ids with non-null child_dependency (not yet signable)."""
    return [
        metric_id
        for metric_id, row in DEFINITIONAL_DELTA_REGISTER.items()
        if row.child_dependency is not None
    ]
