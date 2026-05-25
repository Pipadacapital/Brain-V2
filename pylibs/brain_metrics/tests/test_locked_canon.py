"""
tests/test_locked_canon.py — LOCKED CANON contract tests (Child 4 Bounce-Fix).

@paradigm: sql (zero LLM; pure contract assertion)
Justified: these tests encode the ONE canonical formula for each Brain-native
decision metric. They are the Python-side half of the TS↔Python parity gate
contract. Vikram's real parity gate (check-metrics-parity.sh extension) must
enforce the SAME contract on the TS side. Any deviation in TS definitions.ts
from the formulas pinned here is a canon violation.

Context: Shreya (Stage 4 BOUNCE H-1) + Tanvi (F2) found that the TS registry,
Python registry, and DDR formula_snapshot disagreed on 4 Brain-native decision
metrics. This file pins the CANONICAL formula for each and provides:
  1. Positive tests: Python registry formula is canonical.
  2. Anti-divergence tests: assert the id/unit/scale contract Vikram must match.
  3. Worked-example cross-checks: numeric contract the parity gate will enforce.

Canon sources:
  - canon/TECH/03_metrics_engine.md §0.2 (CM waterfall), §0.3 (marketing efficiency)
  - skills/metric-engine/SKILL.md (paMER = CM2 basis; LTV:CAC = CM2 per order)
  - Architecture plan §10 DDR (true_cm2, pamer, amer, ltv_cac formula definitions)
  - DDR formula_snapshot fields in definitional_delta_register.py

LOCKED CANON FORMULA TABLE (Vikram aligns TS to this; parity gate enforces this):
  See the table in 08b-bounce-fix-report-maya.md.
"""

from __future__ import annotations

import pytest

from brain_metrics.registry import METRIC_REGISTRY, get_metric
from brain_metrics.parity.definitional_delta_register import (
    DEFINITIONAL_DELTA_REGISTER,
    get_ddr_row,
)


# ---------------------------------------------------------------------------
# SECTION 1 — true_cm2_mu LOCKED CANON
#
# CANONICAL formula (canon/TECH/03 §0.2 + arch plan §10 CF-C4-DDR-TRUE-CM2-1):
#   true_cm2_mu = cm2_mu - intDiv(
#       rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#       total_orders_count
#   )
#
# WHY: cost-base-proportional RTO provision. The reversal cost per returned
# order = total cost base / order volume. This is the Brain-native formula
# signed by Rohan in the DDR.
#
# WHAT THE TS REGISTRY DID WRONG (Shreya H-1):
#   formula_ts: (cm2_mu, rto_orders, avg_rto_cost_per_order_mu) =>
#     cm2_mu - (rto_orders × avg_rto_cost_per_order_mu)
#   — flat per-order configured cost. Different inputs, different math.
#   avg_rto_cost_per_order_mu is NOT an input to the Brain-native formula.
#
# VIKRAM MUST ALIGN TS TO:
#   formula_ts: (cm2_mu, rto_orders, total_ad_spend_mu, variable_costs_mu,
#                cogs_mu, total_orders_count) => BigInt
#   clickhouse_sql: "if(total_orders_count > 0, toInt64(cm2_mu - intDiv(
#     rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#     total_orders_count)), NULL)"
# ---------------------------------------------------------------------------

class TestLockedCanonTrueCm2:
    """LOCKED CANON for true_cm2_mu. CF-C4-DDR-TRUE-CM2-1."""

    def test_id_is_true_cm2_mu(self):
        """Canonical id is 'true_cm2_mu'. No other id is valid."""
        m = get_metric("true_cm2_mu")
        assert m.id == "true_cm2_mu", (
            "CANON VIOLATION: true_cm2 id must be 'true_cm2_mu'. "
            "CF-C4-DDR-TRUE-CM2-1."
        )

    def test_kind_is_money(self):
        m = get_metric("true_cm2_mu")
        assert m.kind == "money"

    def test_unit_is_mu(self):
        m = get_metric("true_cm2_mu")
        assert m.unit == "mu", (
            "CANON VIOLATION: true_cm2 unit must be 'mu' (minor units / paise). "
        )

    def test_parity_class_is_correctness_fixture(self):
        m = get_metric("true_cm2_mu")
        assert m.parity_class == "correctness_fixture"

    def test_formula_uses_cost_base_proportional_provision(self):
        """CANONICAL: RTO provision = intDiv(rto_orders × cost_base, total_orders_count).

        The cost_base = total_ad_spend_mu + variable_costs_mu + cogs_mu.
        This is NOT a flat per-order configured cost (avg_rto_cost_per_order_mu).
        CF-C4-DDR-TRUE-CM2-1.
        """
        f = get_metric("true_cm2_mu").formula_py
        # Worked example (arch plan §10):
        # cost_base = 5000000 + 1200000 + 3000000 = 9200000
        # rto_provision = intDiv(18 × 9200000, 120) = 1380000
        # true_cm2 = 8000000 - 1380000 = 6620000
        result = f(
            cm2_mu=8_000_000,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        assert result == 6_620_000, (
            f"CANON VIOLATION: true_cm2_mu worked example. "
            f"Expected 6620000 (cost-base-proportional RTO provision), got {result}. "
            "The flat-per-order formula (rto_orders × avg_rto_cost_per_order_mu) "
            "is NOT canonical. Canon: intDiv(rto_orders × cost_base, total_orders_count). "
            "CF-C4-DDR-TRUE-CM2-1."
        )

    def test_flat_per_order_formula_is_not_canonical(self):
        """KILL TEST: the TS 'flat per-order configured cost' formula produces a DIFFERENT
        result than the canonical cost-base-proportional formula.

        If avg_rto_cost_per_order_mu = 5000µ (₹50), flat formula gives:
          cm2 - (18 × 5000) = 8000000 - 90000 = 7910000µ ≠ 6620000µ (canonical)

        This test confirms the two formulas diverge and the canonical result is 6620000.
        """
        # Flat-per-order computation (what TS wrongly had)
        cm2_mu = 8_000_000
        rto_orders = 18
        avg_rto_cost_configured = 5_000  # ₹50 per RTO (made-up configured value)
        flat_formula_result = cm2_mu - (rto_orders * avg_rto_cost_configured)
        # = 8000000 - 90000 = 7910000

        # Canonical formula result
        f = get_metric("true_cm2_mu").formula_py
        canonical_result = f(
            cm2_mu=cm2_mu,
            rto_orders=rto_orders,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        # = 6620000

        assert flat_formula_result != canonical_result, (
            "Test infrastructure error: flat and canonical results are identical, "
            "but they should diverge."
        )
        assert canonical_result == 6_620_000, f"Expected 6620000, got {canonical_result}"
        assert flat_formula_result == 7_910_000, (
            f"Flat formula (rto_orders × configured_cost) = {flat_formula_result}. "
            "This is NOT canonical. The TS registry had this formula — it is wrong. "
            "Vikram must align TS to the cost-base-proportional formula."
        )

    def test_clickhouse_sql_uses_cost_base_proportional(self):
        """canonical ClickHouse SQL must reference rto_orders * (ad_spend + var + cogs)."""
        sql = get_metric("true_cm2_mu").clickhouse_sql
        assert "rto_orders" in sql
        assert "total_ad_spend_mu" in sql
        assert "variable_costs_mu" in sql
        assert "cogs_mu" in sql
        assert "total_orders_count" in sql
        assert "intDiv" in sql
        # Must NOT reference a configured per-order cost parameter
        assert "avg_rto_cost_per_order_mu" not in sql, (
            "CANON VIOLATION: clickhouse_sql must not reference 'avg_rto_cost_per_order_mu'. "
            "The canonical formula uses cost_base / total_orders_count, not a configured cost."
        )

    def test_ddr_formula_snapshot_is_cost_base_proportional(self):
        """DDR formula_snapshot must document the cost-base-proportional formula."""
        row = get_ddr_row("true_cm2_mu")
        assert row is not None
        snapshot = row.formula_snapshot.lower()
        assert "rto_orders" in snapshot
        assert "total_orders_count" in snapshot, (
            "DDR formula_snapshot must reference total_orders_count (the denominator). "
            "If it only says 'rto_orders × avg_rto_cost' it is the wrong formula."
        )


# ---------------------------------------------------------------------------
# SECTION 2 — pamer_bp LOCKED CANON
#
# CANONICAL formula (canon/TECH/03 §0.3 + skills/metric-engine/SKILL.md):
#   paMER = "profit-adjusted MER (CM2 basis)"
#   pamer_bp = intDiv(cm2_mu × 10000, total_ad_spend_mu)
#   = FLOOR(CM2 / Total Ad Spend × 10000) basis points
#
# WHAT THE TS REGISTRY DID WRONG (Shreya H-1):
#   formula_ts: (total_ad_spend_mu, net_revenue_mu) =>
#     ratioToBasisPoints(total_ad_spend_mu, net_revenue_mu)
#   = FLOOR(ad_spend / net_revenue × 10000)
#   — RECIPROCAL of canonical + uses net_revenue instead of CM2.
#   The TS formula also had a docstring "paMER = total_ad_spend / net_revenue"
#   directly contradicting the Python docstring "paMER = CM2 / Total Ad Spend".
#
# ECONOMIC MEANING:
#   Canonical: How many ₹ of CM2 per ₹ of ad spend? (higher=better efficiency)
#   TS-wrong:  What % of net revenue was spent on ads? (that is aCoS-like, not paMER)
#
# VIKRAM MUST ALIGN TS TO:
#   formula_ts: (cm2_mu: bigint, total_ad_spend_mu: bigint): number =>
#     ratioToBasisPoints(cm2_mu, total_ad_spend_mu)
#   clickhouse_sql: "if(total_ad_spend_mu > 0, intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)"
# ---------------------------------------------------------------------------

class TestLockedCanonPamerDecommissioned:
    """LOCKED CANON UPDATE (slice-4): pamer_bp DECOMMISSIONED.

    The Child-4 pamer_bp (= cm2/total_ad_spend) had NO legacy comparand — it was an
    invented "profit-adjusted MER" that never matched the legacy acquisition surface and
    was never consumed by any page. Rohan's slice-4 Stage-1 review removed it from both
    registries. The canon now LOCKS its ABSENCE.
    """

    def test_pamer_not_in_registry(self):
        with pytest.raises(KeyError):
            get_metric("pamer_bp")

    def test_pamer_has_no_ddr_row(self):
        assert get_ddr_row("pamer_bp") is None


# ---------------------------------------------------------------------------
# SECTION 3 — amer_bp LOCKED CANON
#
# CANONICAL formula (arch plan §10 DDR + plan §17 M2):
#   aMER = True CM2 / Total Ad Spend (basis points)
#   amer_bp = intDiv(true_cm2_mu × 10000, total_ad_spend_mu)
#
# WHAT THE TS REGISTRY DID WRONG (Shreya H-1):
#   formula_ts: (total_ad_spend_mu, gross_sales_mu) =>
#     ratioToBasisPoints(total_ad_spend_mu, gross_sales_mu)
#   = FLOOR(ad_spend / gross_sales × 10000)
#   — Different metric entirely (ad-spend-to-gross-sales %, not True-CM2 efficiency).
#   TS docstring: "aMER = total_ad_spend / gross_sales"
#   Python docstring: "aMER = True CM2 / Total Ad Spend"
#
# ECONOMIC MEANING:
#   Canonical: How many ₹ of True-CM2 (RTO-adjusted margin) per ₹ of ad spend?
#              aMER < paMER always (RTO provision reduces True CM2 below CM2)
#   TS-wrong:  What % of gross revenue was ad spend? (inverted, gross basis)
#              This is closer to ACOS than aMER.
#
# VIKRAM MUST ALIGN TS TO:
#   formula_ts: (true_cm2_mu: bigint, total_ad_spend_mu: bigint): number =>
#     ratioToBasisPoints(true_cm2_mu, total_ad_spend_mu)
#   clickhouse_sql: "if(total_ad_spend_mu > 0 AND total_orders_count > 0, intDiv(
#     (cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu),
#      total_orders_count)) * 10000, total_ad_spend_mu), NULL)"
# ---------------------------------------------------------------------------

class TestLockedCanonAmer:
    """LOCKED CANON for amer_bp (slice-4 RECONCILED to legacy).

    aMER = new_customer_revenue / ACQUISITION-CLASSIFIED ad spend (basis points).
    Legacy: marketing-efficiency.ts:25-28 (aMer = newCustomerRevenue/acquisitionAdSpend);
    the denominator is the acquisition campaign-intent bucket ONLY (ads-spend.ts:82-84).
    NOT the Child-4 placeholder (true_cm2/total_ad_spend).
    """

    def test_id_is_amer_bp(self):
        m = get_metric("amer_bp")
        assert m.id == "amer_bp", "Canonical id is 'amer_bp'."

    def test_unit_is_bp(self):
        m = get_metric("amer_bp")
        assert m.unit == "bp", (
            "CANON VIOLATION: amer unit must be 'bp' (basis points, scale ×10000)."
        )

    def test_parity_class_is_correctness_fixture(self):
        m = get_metric("amer_bp")
        assert m.parity_class == "correctness_fixture"

    def test_formula_is_nc_revenue_over_acquisition_spend(self):
        """CANONICAL (slice-4): aMER = nc_revenue / acquisition_ad_spend (×10000 bp).

        Worked anchor with a classification split: nc_revenue=₹60,000 (6000000p),
        acquisition_ad_spend=₹40,000 (4000000p) — note total spend may be ₹100,000 but only
        ₹40,000 is acquisition-classified. aMER = intDiv(6000000×10000, 4000000) = 15000 bp = 1.50x.
        """
        f = get_metric("amer_bp").formula_py
        result = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=4_000_000)
        assert result == 15_000, (
            f"CANON VIOLATION: amer_bp worked example. Expected 15000 bp (1.50x). Got {result}. "
            "aMER = nc_revenue / ACQUISITION-classified spend, NOT true_cm2/total_spend."
        )

    def test_amer_kill_use_total_spend_mutant(self):
        """KILL TEST: using total_ad_spend (10000000) instead of the acquisition bucket
        (4000000) gives 6000 bp, NOT the canon 15000 bp. The load-bearing legacy correction.
        """
        f = get_metric("amer_bp").formula_py
        canon = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=4_000_000)
        mutant = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=10_000_000)
        assert canon == 15_000
        assert mutant == 6_000
        assert canon != mutant, (
            "CANON VIOLATION: aMER must use acquisition-classified spend, not total spend."
        )

    def test_amer_zero_acquisition_spend_returns_null(self):
        f = get_metric("amer_bp").formula_py
        assert f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=0) is None, (
            "aMER must return None when acquisition_ad_spend=0. CF-C4-RATIO-DIVOP-1."
        )

    def test_clickhouse_sql_is_nc_revenue_over_acquisition_spend(self):
        sql = get_metric("amer_bp").clickhouse_sql
        assert "new_customer_revenue_mu" in sql, "amer_bp SQL numerator must be new_customer_revenue_mu"
        assert "acquisition_ad_spend_mu" in sql, "amer_bp SQL denominator must be acquisition_ad_spend_mu"
        assert "intDiv" in sql, "amer_bp sql must use intDiv (integer FLOOR)"
        # Must NOT use total_ad_spend or true_cm2 (the Child-4 placeholder basis)
        assert "true_cm2" not in sql, (
            "CANON VIOLATION: amer_bp must NOT use true_cm2 (the Child-4 placeholder)."
        )
        # numerator before denominator inside intDiv(...)
        intdiv_content = sql[sql.index("intDiv("):]
        assert intdiv_content.find("new_customer_revenue_mu") < intdiv_content.find("acquisition_ad_spend_mu")

    def test_ddr_formula_snapshot_documents_acquisition_denominator(self):
        row = get_ddr_row("amer_bp")
        assert row is not None
        snapshot = row.formula_snapshot
        assert "new_customer_revenue_mu" in snapshot
        assert "acquisition_ad_spend_mu" in snapshot


# ---------------------------------------------------------------------------
# SECTION 4 — ltv_cac LOCKED CANON
#
# CANONICAL: id='ltv_cac_bp', unit='bp', scale=×10000
#   ltv_cac_bp = intDiv(ltv_mu × 10000, cac_mu)
#   Example: LTV=₹3,000 (300000p), CAC=₹1,000 (100000p)
#     ltv_cac_bp = intDiv(300000 × 10000, 100000) = 30000 bp = 3.0x
#
# WHAT THE TS REGISTRY DID WRONG (Shreya H-1):
#   id: 'ltv_cac_x100', unit: 'x100', scale: ×100
#   formula_ts: intDiv(ltv_mu × 100, cac_mu)
#   Example: ltv_cac_x100 = intDiv(300000 × 100, 100000) = 300
#   — For the same 3.0× LTV:CAC:
#     TS returns 300 (×100 scale),  Python returns 30000 (×10000 bp scale)
#     These are NOT byte-identical.
#
# WHY bp IS CANONICAL:
#   Brain's ratio convention is UNIFORMLY basis-points (×10000) across all metrics.
#   rto_rate_bp, prepaid_rate_bp, conversion_rate_bp, pamer_bp, amer_bp, acos_bp
#   are ALL ×10000. ltv_cac must follow the same convention.
#   The ×100 scale (x100) is an isolated deviation — inconsistent with the convention.
#
# VIKRAM MUST ALIGN TS TO:
#   id: 'ltv_cac_bp' (NOT 'ltv_cac_x100')
#   unit: 'bp' (NOT 'x100')
#   formula_ts: (ltv_mu: bigint, cac_mu: bigint): number =>
#     ratioToBasisPoints(ltv_mu, cac_mu)
#   clickhouse_sql: "if(cac_mu > 0, intDiv(ltv_mu * 10000, cac_mu), NULL)"
# ---------------------------------------------------------------------------

class TestLockedCanonLtvCac:
    """LOCKED CANON for ltv_cac_bp. id='ltv_cac_bp', unit='bp', scale=×10000."""

    def test_canonical_id_is_ltv_cac_bp(self):
        """Canonical id is 'ltv_cac_bp', NOT 'ltv_cac_x100'.

        The TS registry used 'ltv_cac_x100' — this is a canon violation.
        Vikram must rename the TS definition to id='ltv_cac_bp'.
        """
        m = get_metric("ltv_cac_bp")  # must not raise KeyError
        assert m.id == "ltv_cac_bp", (
            "CANON VIOLATION: LTV:CAC canonical id is 'ltv_cac_bp', not 'ltv_cac_x100'. "
            "All Brain ratio metrics use the '_bp' suffix (×10000 basis points)."
        )

    def test_wrong_id_not_in_python_registry(self):
        """'ltv_cac_x100' must NOT exist in the Python registry."""
        assert "ltv_cac_x100" not in METRIC_REGISTRY, (
            "CANON VIOLATION: 'ltv_cac_x100' must not be in the Python registry. "
            "The canonical id is 'ltv_cac_bp'. "
            "If this metric appears in Python as 'ltv_cac_x100', the registry is wrong."
        )

    def test_unit_is_bp(self):
        m = get_metric("ltv_cac_bp")
        assert m.unit == "bp", (
            "CANON VIOLATION: ltv_cac unit must be 'bp' (basis points, ×10000), "
            "NOT 'x100' (×100). Brain's ratio convention is uniform basis-points."
        )

    def test_scale_is_10000(self):
        """CANONICAL: scale = ×10000 (basis points). NOT ×100.

        For a 3.0× LTV:CAC:
          bp scale (canonical): 30000 (= 3.0 × 10000)
          x100 scale (TS wrong): 300 (= 3.0 × 100)
        """
        f = get_metric("ltv_cac_bp").formula_py
        # LTV=₹3,000 (300000p), CAC=₹1,000 (100000p) → 3.0× LTV:CAC
        result = f(ltv_mu=300_000, cac_mu=100_000)
        assert result == 30_000, (
            f"CANON VIOLATION: ltv_cac for 3.0× must be 30000 bp. Got {result}. "
            "If result=300, the scale is ×100 (wrong). Canonical scale is ×10000 (bp)."
        )

    def test_x100_scale_is_wrong(self):
        """KILL TEST: ×100 scale gives 300 for a 3.0× LTV:CAC — NOT canonical.

        The canonical result (×10000 bp) is 30000.
        The wrong TS result (×100) is 300.
        """
        f = get_metric("ltv_cac_bp").formula_py
        result = f(ltv_mu=300_000, cac_mu=100_000)

        wrong_x100 = (300_000 * 100) // 100_000  # = 300 (the TS formula)
        canonical_x10000 = result  # = 30000

        assert canonical_x10000 != wrong_x100, (
            "Test infrastructure error: ×100 and ×10000 results must differ."
        )
        assert canonical_x10000 == 30_000, (
            f"Canonical (×10000): expected 30000, got {canonical_x10000}."
        )
        assert wrong_x100 == 300, (
            f"Wrong TS scale (×100): expected 300, got {wrong_x100}. "
            "Vikram must update TS from ×100 to ×10000 (bp convention)."
        )

    def test_ltv_cac_zero_cac_returns_null(self):
        f = get_metric("ltv_cac_bp").formula_py
        assert f(ltv_mu=300_000, cac_mu=0) is None

    def test_ddr_registers_ltv_cac_as_bp(self):
        """DDR must register 'ltv_cac_bp', NOT 'ltv_cac_x100'."""
        row = get_ddr_row("ltv_cac_bp")
        assert row is not None, (
            "DDR must have a row for 'ltv_cac_bp'. "
            "If this fails, the DDR key is wrong (was 'ltv_cac_x100')."
        )
        assert row.parity_gap is True
        assert "ltv_cac_bp" in row.formula_snapshot, (
            "DDR formula_snapshot must reference 'ltv_cac_bp' id. "
            "CF-C4-DDR-TRUE-CM2-1."
        )


# ---------------------------------------------------------------------------
# SECTION 5 — Cross-metric invariants (the parity gate CONTRACT)
#
# These are the numeric contracts the real TS↔Python parity gate must enforce.
# Vikram's check-metrics-parity.sh extension must verify these for the 4 metrics.
# ---------------------------------------------------------------------------

class TestCanonCrossMetricInvariants:
    """Cross-metric invariants that hold across the 4 locked canon metrics."""

    def test_true_cm2_le_cm2(self):
        """INVARIANT: true_cm2_mu ≤ cm2_mu (RTO provision is non-negative)."""
        f = get_metric("true_cm2_mu").formula_py
        cm2 = 8_000_000
        true_cm2 = f(
            cm2_mu=cm2,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        assert true_cm2 is not None
        assert true_cm2 <= cm2, (
            f"True-CM2 ({true_cm2}) must be ≤ CM2 ({cm2}). "
            "RTO provision is always non-negative."
        )

    def test_amer_uses_acquisition_denominator_not_total(self):
        """INVARIANT (slice-4): aMER uses the acquisition-classified spend bucket, which is
        ≤ total spend, so aMER computed with total spend understates the true aMER."""
        f = get_metric("amer_bp").formula_py
        amer_acq = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=4_000_000)
        amer_total = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=10_000_000)
        assert amer_acq is not None and amer_total is not None
        assert amer_acq > amer_total, (
            f"aMER on acquisition spend ({amer_acq}) must exceed aMER on total spend ({amer_total}) "
            "when acquisition spend < total spend. Using total spend understates aMER."
        )

    def test_brain_native_metrics_in_ddr_as_parity_gap(self):
        """The Brain-native parity_gap metrics are in the DDR (pamer_bp decommissioned slice-4)."""
        for mid in ("true_cm2_mu", "amer_bp", "ltv_cac_bp"):
            row = get_ddr_row(mid)
            assert row is not None, f"DDR row missing for {mid!r}"
            assert row.parity_gap is True, f"{mid}: parity_gap must be True"

    def test_parity_gap_metrics_use_bp_or_mu_scale(self):
        """All 4 Brain-native decision metrics use standard Brain scale conventions.

        true_cm2_mu → unit='mu' (money)
        pamer_bp    → unit='bp' (×10000)
        amer_bp     → unit='bp' (×10000)
        ltv_cac_bp  → unit='bp' (×10000)

        No Brain decision metric uses 'x100' scale (that is a display convention only,
        used for blended_roas_x100 which is display_only:True).
        """
        expected = {
            "true_cm2_mu": "mu",
            # pamer_bp DECOMMISSIONED (slice-4)
            "amer_bp":     "bp",
            "ltv_cac_bp":  "bp",
        }
        for mid, expected_unit in expected.items():
            m = get_metric(mid)
            assert m.unit == expected_unit, (
                f"CANON VIOLATION: {mid} unit={m.unit!r}, expected {expected_unit!r}. "
                "Brain ratio convention: decision metrics use 'bp' (×10000). "
                "The TS used 'x100' for ltv_cac — that is the wrong scale."
            )

    def test_x100_scale_only_on_display_only_metrics(self):
        """The 'x100' unit/scale is ONLY used for display-only metrics (blended_roas_x100).

        No decision metric uses x100. This test will fail if any non-display-only metric
        is registered with unit='x100' (as the TS had with ltv_cac_x100).
        """
        for mid, m in METRIC_REGISTRY.items():
            if not m.display_only:
                # Python registry currently uses "bp" not "x100" for ratio metrics
                # unit='x100' should never appear on a non-display-only metric
                assert m.unit != "x100", (
                    f"CANON VIOLATION: non-display-only metric {mid!r} has unit='x100'. "
                    "Brain convention: decision metrics use 'bp' (×10000), not 'x100' (×100). "
                    "The TS had ltv_cac_x100 as a decision metric — wrong convention."
                )
        # But display_only metrics can use 'x100' (blended_roas_x100 does in TS)
        # Python uses "bp" for blended_roas_x100 — that is also acceptable (different from TS)
        # The key invariant is: decision metrics never use x100.


# ---------------------------------------------------------------------------
# SECTION 6 — Parity gate contract summary (the contract Vikram's gate enforces)
#
# This section documents (as code comments + a data structure) the EXACT
# per-metric contract the real TS↔Python parity gate must verify.
# The gate cannot just check directory presence or fixture byte-identity —
# it must verify per-metric id/unit/clickhouse_sql equality.
# ---------------------------------------------------------------------------

# The locked canon contract (id → (unit, scale_factor, canonical_formula_description))
# This is what Vikram's extended check-metrics-parity.sh must assert:
LOCKED_CANON_PARITY_GATE_CONTRACT = {
    "true_cm2_mu": {
        "kind": "money",
        "unit": "mu",
        "scale": 1,
        "formula_description": (
            "cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), "
            "total_orders_count)"
        ),
        "inputs": ["cm2_mu", "rto_orders", "total_ad_spend_mu", "variable_costs_mu",
                   "cogs_mu", "total_orders_count"],
        "worked_example": {
            "cm2_mu": 8_000_000, "rto_orders": 18, "total_ad_spend_mu": 5_000_000,
            "variable_costs_mu": 1_200_000, "cogs_mu": 3_000_000, "total_orders_count": 120,
            "expected_result": 6_620_000,
        },
        "ts_wrong_formula": (
            "cm2_mu - (rto_orders × avg_rto_cost_per_order_mu) — flat configured per-order cost"
        ),
    },
    # pamer_bp DECOMMISSIONED (slice-4) — no legacy comparand; removed from the contract.
    "amer_bp": {
        "kind": "ratio",
        "unit": "bp",
        "scale": 10_000,
        "formula_description": (
            "intDiv(new_customer_revenue_mu * 10000, acquisition_ad_spend_mu)"
        ),
        "inputs": ["new_customer_revenue_mu", "acquisition_ad_spend_mu"],
        "worked_example": {
            "new_customer_revenue_mu": 6_000_000, "acquisition_ad_spend_mu": 4_000_000,
            "expected_result": 15_000,  # 1.50x — acquisition-classified spend (₹40k), not total (₹100k)
        },
        "ts_wrong_formula": (
            "intDiv(new_customer_revenue_mu * 10000, total_ad_spend_mu) "
            "— uses total spend instead of the acquisition-classified bucket (slice-4 landmine)"
        ),
    },
    "ltv_cac_bp": {
        "kind": "ratio",
        "unit": "bp",
        "scale": 10_000,
        "formula_description": "intDiv(ltv_mu * 10000, cac_mu)",
        "inputs": ["ltv_mu", "cac_mu"],
        "worked_example": {
            "ltv_mu": 300_000, "cac_mu": 100_000,
            "expected_result": 30_000,  # 3.0x
        },
        "ts_wrong_id": "ltv_cac_x100",
        "ts_wrong_unit": "x100",
        "ts_wrong_scale": 100,
        "ts_wrong_formula": (
            "intDiv(ltv_mu * 100, cac_mu) — wrong scale (×100 not ×10000)"
        ),
    },
}


class TestLockedCanonContractStructure:
    """Verify the locked canon contract data structure is self-consistent."""

    def test_contract_covers_divergent_metrics(self):
        """The contract must cover the divergent metrics (pamer_bp decommissioned slice-4)."""
        required = {"true_cm2_mu", "amer_bp", "ltv_cac_bp"}
        assert required.issubset(set(LOCKED_CANON_PARITY_GATE_CONTRACT.keys())), (
            f"Contract missing metrics. Required: {required}"
        )

    def test_contract_worked_examples_match_python_registry(self):
        """Each worked example in the contract must be verified by the Python registry."""
        for mid, contract in LOCKED_CANON_PARITY_GATE_CONTRACT.items():
            we = contract["worked_example"]
            expected = we["expected_result"]
            inputs = {k: v for k, v in we.items() if k != "expected_result"}
            f = get_metric(mid).formula_py
            result = f(**inputs)
            assert result == expected, (
                f"CANON CONTRACT ERROR for {mid}: worked example gives {result}, "
                f"expected {expected}. The contract or the Python formula is wrong."
            )

    def test_ltv_cac_ts_wrong_formula_is_documented(self):
        """The TS wrong formula for ltv_cac is documented in the contract."""
        contract = LOCKED_CANON_PARITY_GATE_CONTRACT["ltv_cac_bp"]
        assert "ltv_cac_x100" in contract.get("ts_wrong_id", ""), (
            "Contract must document the wrong TS id 'ltv_cac_x100'."
        )
        assert contract.get("ts_wrong_unit") == "x100"
        assert contract.get("ts_wrong_scale") == 100

    def test_pamer_decommissioned_not_in_contract(self):
        """pamer_bp DECOMMISSIONED (slice-4) — no longer in the locked-canon contract."""
        assert "pamer_bp" not in LOCKED_CANON_PARITY_GATE_CONTRACT

    def test_amer_ts_wrong_formula_documented(self):
        contract = LOCKED_CANON_PARITY_GATE_CONTRACT["amer_bp"]
        assert "total_ad_spend" in contract["ts_wrong_formula"], (
            "Contract must document the 'use total spend' wrong formula (slice-4 landmine)."
        )

    def test_true_cm2_ts_wrong_formula_documented(self):
        contract = LOCKED_CANON_PARITY_GATE_CONTRACT["true_cm2_mu"]
        assert "avg_rto_cost_per_order_mu" in contract["ts_wrong_formula"] or \
               "flat" in contract["ts_wrong_formula"].lower(), (
            "Contract must document the flat-per-order wrong formula."
        )
