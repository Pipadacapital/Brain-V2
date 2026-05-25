"""
tests/test_registry.py — Tests for the Python metric registry (Child 4, Track M).

@paradigm: sql (zero LLM; pure integer arithmetic verification)
Tests cover:
- M1: MetricDefinition structure + revenue ladder formulas (byte-identity contract)
- M2: True-CM2 + paMER/aMER/ltv_cac correctness fixtures (parity_gap:true)
- CF-C4-RATIO-DIVOP-1: every ratio formula uses integer FLOOR (no float)
- CF-C4-PRORATED-DIVOP-1: misc_expenses_prorated Feb-boundary
- Display-only enforcement: blended_roas_x100 / acos_bp
- Registry completeness + get_metric error path
"""

from __future__ import annotations

import pytest

from brain_metrics.registry import MetricDefinition, METRIC_REGISTRY, get_metric
from brain_metrics.registry.definitions import (
    _int_floor_div_or_null,
    _ratio_bp,
    FX_SHADOW_RATE_INR_PER_USD,
    compute_goal_rag,
    goal_higher_better,
)


# ---------------------------------------------------------------------------
# MetricDefinition structure tests (M1)
# ---------------------------------------------------------------------------

class TestMetricDefinitionStructure:
    """Every registered metric has the correct shape. CF-C4-DDR-1."""

    def test_all_metrics_have_required_fields(self):
        for mid, m in METRIC_REGISTRY.items():
            assert isinstance(m, MetricDefinition), f"{mid} is not a MetricDefinition"
            assert isinstance(m.id, str) and m.id, f"{mid}: id must be non-empty str"
            assert m.kind in ("money", "ratio", "count"), f"{mid}: invalid kind"
            assert m.unit in ("mu", "bp", "count"), f"{mid}: invalid unit"
            assert callable(m.formula_py), f"{mid}: formula_py must be callable"
            assert isinstance(m.clickhouse_sql, str) and m.clickhouse_sql, f"{mid}: clickhouse_sql required"
            assert m.parity_class in ("shadow_compare", "correctness_fixture"), f"{mid}: invalid parity_class"

    def test_registry_id_matches_key(self):
        for mid, m in METRIC_REGISTRY.items():
            assert m.id == mid, f"Registry key {mid!r} != MetricDefinition.id {m.id!r}"

    def test_display_only_metrics(self):
        """blended_roas_x100 and acos_bp must be display_only:True. CM2-first."""
        assert METRIC_REGISTRY["blended_roas_x100"].display_only is True
        assert METRIC_REGISTRY["acos_bp"].display_only is True

    def test_display_only_not_decision_metrics(self):
        """All other money/ratio metrics are NOT display_only."""
        for mid, m in METRIC_REGISTRY.items():
            if mid not in ("blended_roas_x100", "acos_bp"):
                assert m.display_only is False, f"{mid} should NOT be display_only"

    def test_parity_gap_metrics_are_correctness_fixture(self):
        """parity_gap metrics must use correctness_fixture gate. CF-C4-DDR-1 Rule 1."""
        parity_gap_ids = {
            "true_cm2_mu", "amer_bp", "ltv_cac_bp",
            # Phase-2 slice-3 (feat-rto-cod-economics): Brain-native econ canon
            "breakeven_cod_rto_rate_bp", "pincode_reliability_score",
        }
        for mid in parity_gap_ids:
            m = METRIC_REGISTRY[mid]
            assert m.parity_class == "correctness_fixture", (
                f"{mid} is a parity_gap metric and MUST use correctness_fixture gate, "
                f"not shadow_compare. CF-C4-DDR-1 Rule 1."
            )

    def test_clickhouse_sql_no_bare_division(self):
        """No MV expression may use bare '/' for integer division. CF-C4-RATIO-DIVOP-1.

        Every division in clickhouse_sql must use intDiv() with null-guard.
        Bare '/' returns Float64 on Int64 in ClickHouse — NOT integer FLOOR.
        """
        for mid, m in METRIC_REGISTRY.items():
            sql = m.clickhouse_sql
            # Allow '/' only inside intDiv(...) or as part of a non-division token
            # The rule: no standalone integer division using '/'; must use intDiv
            # We check: any metric whose SQL contains division must use intDiv
            if "/" in sql and "intDiv" not in sql:
                # Allow if it's just a comment or description (none should have this)
                pytest.fail(
                    f"Metric {mid!r}: clickhouse_sql contains '/' without intDiv. "
                    "This produces Float64 coercion in ClickHouse (not integer FLOOR). "
                    "CF-C4-RATIO-DIVOP-1: every division must use intDiv + null-guard."
                )

    def test_clickhouse_sql_ratio_metrics_have_null_guard(self):
        """Ratio metrics must have 'if(' null-guard in their ClickHouse SQL. CF-C4-RATIO-DIVOP-1."""
        ratio_metrics = [mid for mid, m in METRIC_REGISTRY.items() if m.unit == "bp"]
        for mid in ratio_metrics:
            sql = METRIC_REGISTRY[mid].clickhouse_sql
            assert "if(" in sql or "NULL" in sql, (
                f"Ratio metric {mid!r}: clickhouse_sql lacks null-guard. "
                "CF-C4-RATIO-DIVOP-1: zero-denominator days must return NULL, "
                "never inf or INT64_MAX."
            )

    def test_get_metric_success(self):
        m = get_metric("cm2_mu")
        assert m.id == "cm2_mu"
        assert m.kind == "money"

    def test_get_metric_unknown_raises(self):
        with pytest.raises(KeyError, match="not found in METRIC_REGISTRY"):
            get_metric("nonexistent_metric_id")

    def test_registry_contains_full_cm_waterfall(self):
        """All required CM waterfall metrics present."""
        required = [
            "gross_sales_mu", "total_discount_mu", "total_tax_mu",
            "net_sales_mu", "net_revenue_mu", "cogs_mu", "variable_costs_mu",
            "cm1_mu", "total_ad_spend_mu", "cm2_mu", "misc_expenses_prorated_mu",
            "cm3_mu", "true_cm2_mu", "amer_bp", "ltv_cac_bp",
            "blended_roas_x100", "acos_bp", "rto_rate_bp", "prepaid_rate_bp",
            "aov_mu", "conversion_rate_bp",
        ]
        for mid in required:
            assert mid in METRIC_REGISTRY, f"Required metric {mid!r} missing from registry"


# ---------------------------------------------------------------------------
# Revenue ladder formula tests (M1 — positive + negative)
# ---------------------------------------------------------------------------

class TestRevenueLadderFormulas:
    """Formula correctness for the revenue waterfall."""

    def test_net_sales_mu(self):
        f = METRIC_REGISTRY["net_sales_mu"].formula_py
        assert f(gross_sales_mu=1000000, total_discount_mu=50000) == 950000
        # Negative: no sales
        assert f(gross_sales_mu=0, total_discount_mu=0) == 0
        # Heavy discounting
        assert f(gross_sales_mu=500000, total_discount_mu=600000) == -100000

    def test_net_revenue_mu(self):
        f = METRIC_REGISTRY["net_revenue_mu"].formula_py
        assert f(net_sales_mu=950000, total_tax_mu=171000) == 779000  # ~18% GST
        assert f(net_sales_mu=0, total_tax_mu=0) == 0

    def test_cm1_mu(self):
        f = METRIC_REGISTRY["cm1_mu"].formula_py
        # 779000 - 200000 - 50000 = 529000
        assert f(net_revenue_mu=779000, cogs_mu=200000, variable_costs_mu=50000) == 529000
        # Negative CM1 (loss-making)
        assert f(net_revenue_mu=100000, cogs_mu=200000, variable_costs_mu=50000) == -150000

    def test_cm2_mu(self):
        f = METRIC_REGISTRY["cm2_mu"].formula_py
        assert f(cm1_mu=529000, total_ad_spend_mu=100000) == 429000
        # CM2 goes negative
        assert f(cm1_mu=50000, total_ad_spend_mu=200000) == -150000

    def test_cm3_mu(self):
        f = METRIC_REGISTRY["cm3_mu"].formula_py
        assert f(cm2_mu=429000, misc_expenses_prorated_mu=35714) == 393286

    def test_variable_costs_mu(self):
        f = METRIC_REGISTRY["variable_costs_mu"].formula_py
        assert f(shipping_mu=20000, packaging_mu=15000, website_charges_mu=5000) == 40000
        assert f(shipping_mu=0, packaging_mu=0, website_charges_mu=0) == 0

    def test_total_ad_spend_mu(self):
        f = METRIC_REGISTRY["total_ad_spend_mu"].formula_py
        assert f(meta_ad_spend_mu=60000, google_ad_spend_mu=40000) == 100000
        assert f(meta_ad_spend_mu=0, google_ad_spend_mu=0) == 0


# ---------------------------------------------------------------------------
# Phase-2 slice-3: RTO/COD/pincode economics cross-language anchors (NON-VACUOUS).
# These MIRROR the TS anchors in packages/lib-metrics/src/registry/registry.test.ts byte-for-byte.
# The break-even anchor BITES the slice-table's naive r*=M/(M+C): the FULL legacy formula
# returns 500bp on these inputs (the naive form would return ~9493bp).
# ---------------------------------------------------------------------------

class TestSlice3RtoCodPincodeEconomics:
    """feat-rto-cod-economics registry anchors. Byte-identical to the TS anchors."""

    def test_rto_cost_and_revenue_lost_passthrough(self):
        assert METRIC_REGISTRY["rto_cost_mu"].formula_py(rto_cost_mu=4_480_000) == 4_480_000
        assert METRIC_REGISTRY["rto_revenue_lost_mu"].formula_py(
            rto_revenue_lost_mu=33_200_000
        ) == 33_200_000

    def test_cod_realization_rate_bp(self):
        f = METRIC_REGISTRY["cod_realization_rate_bp"].formula_py
        # 612 / 800 = 0.765 → 7650 bp
        assert f(cod_delivered=612, cod_orders=800) == 7650
        # 2/3 FLOOR
        assert f(cod_delivered=2, cod_orders=3) == 6666
        # zero COD orders → NULL
        assert f(cod_delivered=0, cod_orders=0) is None

    def test_breakeven_cod_rto_rate_bp_full_formula_kills_naive(self):
        """CF-S3-BREAKEVEN-1: FULL legacy formula = 500bp; the naive M/(M+C) would be ~9493bp."""
        f = METRIC_REGISTRY["breakeven_cod_rto_rate_bp"].formula_py
        result = f(
            aov_mu=150_000,
            prepaid_rto_rate_bp=500,
            cod_fee_mu=3_000,
            gateway_fee_bp=200,
            return_shipping_mu=8_000,
            restocking_mu=0,
        )
        assert result == 500, f"expected 500bp from the full formula, got {result}"
        # The naive M/(M+C) (M=aov, C=return_shipping) = intDiv(150000*10000, 158000) = 9493 — DIFFERENT.
        assert result != 9493

    def test_breakeven_moves_with_gateway_fee(self):
        f = METRIC_REGISTRY["breakeven_cod_rto_rate_bp"].formula_py
        base = f(aov_mu=150_000, prepaid_rto_rate_bp=500, cod_fee_mu=3_000,
                 gateway_fee_bp=200, return_shipping_mu=8_000, restocking_mu=0)
        higher = f(aov_mu=150_000, prepaid_rto_rate_bp=500, cod_fee_mu=3_000,
                   gateway_fee_bp=400, return_shipping_mu=8_000, restocking_mu=0)
        assert higher != base

    def test_breakeven_zero_denominator_null(self):
        f = METRIC_REGISTRY["breakeven_cod_rto_rate_bp"].formula_py
        assert f(aov_mu=0, prepaid_rto_rate_bp=500, cod_fee_mu=3_000,
                 gateway_fee_bp=200, return_shipping_mu=0, restocking_mu=0) is None

    def test_pincode_reliability_score_integer_form_kills_float(self):
        """CF-S3-PINCODE-1: integer centi-point score = 5900 (= 59.00). Matches the legacy float ×100."""
        f = METRIC_REGISTRY["pincode_reliability_score"].formula_py
        result = f(rto_bp=1_800, cod_bp=6_000, repeat_bp=2_000, aov_mu=150_000)
        assert result == 5900, f"expected 5900 centi-points, got {result}"

    def test_pincode_reliability_clamps(self):
        f = METRIC_REGISTRY["pincode_reliability_score"].formula_py
        assert f(rto_bp=9_000, cod_bp=9_000, repeat_bp=0, aov_mu=0) == 0
        assert f(rto_bp=0, cod_bp=0, repeat_bp=10_000, aov_mu=100_000_000) == 10000

    def test_pincode_reliability_moves_with_each_term(self):
        f = METRIC_REGISTRY["pincode_reliability_score"].formula_py
        base = f(rto_bp=1_800, cod_bp=6_000, repeat_bp=2_000, aov_mu=150_000)
        assert f(rto_bp=1_900, cod_bp=6_000, repeat_bp=2_000, aov_mu=150_000) != base
        assert f(rto_bp=1_800, cod_bp=6_200, repeat_bp=2_000, aov_mu=150_000) != base
        assert f(rto_bp=1_800, cod_bp=6_000, repeat_bp=2_200, aov_mu=150_000) != base
        assert f(rto_bp=1_800, cod_bp=6_000, repeat_bp=2_000, aov_mu=160_000) != base


# ---------------------------------------------------------------------------
# Misc expenses prorated — CF-C4-PRORATED-DIVOP-1 + CF-C4-DDR-MISC-PRORATE-1
# ---------------------------------------------------------------------------

class TestMiscExpensesProrated:
    """Feb-boundary worked examples + wrong-constant kill-test. CF-C4-PRORATED-DIVOP-1."""

    def test_feb_2026_28_days(self):
        """Feb 2026 = 28 days. intDiv(1000000, 28) = 35714."""
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        result = f(monthly_amount_mu=1000000, days_in_month=28)
        assert result == 35714, (
            f"Feb 2026 (28 days): expected 35714, got {result}. "
            "CF-C4-PRORATED-DIVOP-1: intDiv(1000000, 28) = 35714."
        )

    def test_feb_2024_29_days_leap_year(self):
        """Feb 2024 (leap) = 29 days. intDiv(1000000, 29) = 34482."""
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        result = f(monthly_amount_mu=1000000, days_in_month=29)
        assert result == 34482, (
            f"Feb 2024 (leap, 29 days): expected 34482, got {result}. "
            "CF-C4-PRORATED-DIVOP-1: intDiv(1000000, 29) = 34482."
        )

    def test_march_2026_31_days(self):
        """March 2026 = 31 days. intDiv(1000000, 31) = 32258."""
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        result = f(monthly_amount_mu=1000000, days_in_month=31)
        assert result == 32258, (
            f"March 2026 (31 days): expected 32258, got {result}. "
            "CF-C4-PRORATED-DIVOP-1: intDiv(1000000, 31) = 32258."
        )

    def test_wrong_constant_30_kill_test(self):
        """KILL TEST: hardcoded 30 is WRONG for February.

        CF-C4-DDR-MISC-PRORATE-1: adjudication must NOT let this bug hide
        as ROUNDING_MODE_MISMATCH. Delta = 35714 - 33333 = 2381 paise (₹23.81/day).
        This is a BLOCKING_BUG, NOT a rounding delta.
        """
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        wrong_result = f(monthly_amount_mu=1000000, days_in_month=30)  # wrong constant
        correct_result = f(monthly_amount_mu=1000000, days_in_month=28)  # Feb correct
        # The wrong result must NOT equal the correct result
        assert wrong_result != correct_result, "Test infrastructure broken: wrong==correct"
        assert wrong_result == 33333, f"intDiv(1000000, 30) = 33333, got {wrong_result}"
        assert correct_result == 35714, f"intDiv(1000000, 28) = 35714, got {correct_result}"
        delta = correct_result - wrong_result
        assert delta == 2381, (
            f"Delta between correct(28 days) and wrong(30 days) = {delta}. "
            "Expected 2381 paise (₹23.81/day). CF-C4-DDR-MISC-PRORATE-1."
        )

    def test_zero_days_returns_null(self):
        """Zero days_in_month returns None (fail-closed). CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        assert f(monthly_amount_mu=1000000, days_in_month=0) is None

    def test_negative_days_returns_null(self):
        """Negative days_in_month returns None (fail-closed)."""
        f = METRIC_REGISTRY["misc_expenses_prorated_mu"].formula_py
        assert f(monthly_amount_mu=1000000, days_in_month=-1) is None


# ---------------------------------------------------------------------------
# True-CM2 worked example — CF-C4-DDR-TRUE-CM2-1 (M2)
# ---------------------------------------------------------------------------

class TestTrueCm2CorrectnessFixture:
    """True-CM2 correctness fixture. parity_gap:true. CF-C4-DDR-TRUE-CM2-1.

    Verified against the worked example in registry/definitions.py:
    total_orders=120, rto_orders=18, total_ad_spend=₹50k,
    variable_costs=₹12k, cogs=₹30k, cm2=₹80k.
    Expected: true_cm2 = 6620000 paise (₹66,200).
    """

    def test_worked_example(self):
        f = METRIC_REGISTRY["true_cm2_mu"].formula_py
        result = f(
            cm2_mu=8_000_000,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        # cost_base = 5000000 + 1200000 + 3000000 = 9200000
        # rto_provision = intDiv(18 × 9200000, 120) = intDiv(165600000, 120) = 1380000
        # true_cm2 = 8000000 - 1380000 = 6620000
        assert result == 6_620_000, (
            f"True-CM2 worked example: expected 6620000 (₹66,200), got {result}. "
            "CF-C4-DDR-TRUE-CM2-1."
        )

    def test_rto_provision_formula_components(self):
        """Verify cost_base and rto_provision individually."""
        rto_orders = 18
        total_ad_spend_mu = 5_000_000
        variable_costs_mu = 1_200_000
        cogs_mu = 3_000_000
        total_orders_count = 120

        cost_base = total_ad_spend_mu + variable_costs_mu + cogs_mu
        assert cost_base == 9_200_000, f"cost_base: expected 9200000, got {cost_base}"

        rto_provision = (rto_orders * cost_base) // total_orders_count
        assert rto_provision == 1_380_000, f"rto_provision: expected 1380000, got {rto_provision}"

    def test_zero_rto_equals_cm2(self):
        """Zero RTO → True CM2 = CM2 exactly."""
        f = METRIC_REGISTRY["true_cm2_mu"].formula_py
        result = f(
            cm2_mu=8_000_000,
            rto_orders=0,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        assert result == 8_000_000

    def test_zero_orders_count_returns_null(self):
        """Zero total_orders_count → None (fail-closed). CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["true_cm2_mu"].formula_py
        result = f(
            cm2_mu=8_000_000,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=0,
        )
        assert result is None, "Zero orders_count must return None, not divide-by-zero"

    def test_true_cm2_less_than_cm2(self):
        """True CM2 < CM2 always (RTO provision is a non-negative cost)."""
        f = METRIC_REGISTRY["true_cm2_mu"].formula_py
        result = f(
            cm2_mu=8_000_000,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        assert result <= 8_000_000

    def test_100_percent_rto(self):
        """100% RTO: all orders return → true_cm2 = cm2 − full_cost_base."""
        f = METRIC_REGISTRY["true_cm2_mu"].formula_py
        # All 120 orders return
        result = f(
            cm2_mu=8_000_000,
            rto_orders=120,  # 100% RTO
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        # rto_provision = intDiv(120 × 9200000, 120) = 9200000
        # true_cm2 = 8000000 - 9200000 = -1200000 (negative — big loss)
        assert result == -1_200_000

    def test_parity_class_is_correctness_fixture(self):
        """True-CM2 must be correctness_fixture, not shadow_compare. CF-C4-DDR-1 Rule 1."""
        m = METRIC_REGISTRY["true_cm2_mu"]
        assert m.parity_class == "correctness_fixture"


# ---------------------------------------------------------------------------
# paMER / aMER correctness fixtures (M2)
# ---------------------------------------------------------------------------

class TestMarketingEfficiencyReconciledToLegacy:
    """MER / aMER / CAC reconciled to legacy (slice-4). pamer_bp DECOMMISSIONED.

    aMER = new_customer_revenue / ACQUISITION-classified ad spend (NOT total spend).
    Legacy: marketing-efficiency.ts:25-28 + ads-spend.ts:82-84.
    """

    def test_pamer_decommissioned(self):
        """pamer_bp had no legacy comparand — removed from the registry (slice-4)."""
        assert "pamer_bp" not in METRIC_REGISTRY

    def test_mer_bp_worked_example(self):
        """MER = net_revenue / total_ad_spend in bp. 12000000/10000000 = 1.20x = 12000 bp."""
        f = METRIC_REGISTRY["mer_bp"].formula_py
        result = f(net_revenue_mu=12_000_000, total_ad_spend_mu=10_000_000)
        assert result == 12_000

    def test_mer_zero_ad_spend_returns_null(self):
        f = METRIC_REGISTRY["mer_bp"].formula_py
        assert f(net_revenue_mu=12_000_000, total_ad_spend_mu=0) is None

    def test_amer_bp_worked_example_acquisition_split(self):
        """aMER = nc_revenue / ACQUISITION spend. 6000000/4000000 = 1.50x = 15000 bp.

        The acquisition bucket (₹40k) is LESS than total spend (₹100k) — the load-bearing
        legacy semantics (Rohan Stage-1 finding + persona Concern 1).
        """
        f = METRIC_REGISTRY["amer_bp"].formula_py
        result = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=4_000_000)
        assert result == 15_000

    def test_amer_kill_use_total_spend_mutant(self):
        """The 'use total_ad_spend' mutant (10000000) yields 6000, NOT the canon 15000."""
        f = METRIC_REGISTRY["amer_bp"].formula_py
        canon = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=4_000_000)
        mutant = f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=10_000_000)
        assert canon == 15_000
        assert mutant == 6_000
        assert canon != mutant, "aMER must use acquisition-classified spend, not total spend"

    def test_amer_zero_acquisition_spend_returns_null(self):
        f = METRIC_REGISTRY["amer_bp"].formula_py
        assert f(new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=0) is None

    def test_cac_mu_worked_example(self):
        """Blended CAC = total_ad_spend / new_customers. 10000000/200 = 50000p (₹500)."""
        f = METRIC_REGISTRY["cac_mu"].formula_py
        assert f(total_ad_spend_mu=10_000_000, new_customers_count=200) == 50_000

    def test_cac_mu_zero_customers_returns_null(self):
        f = METRIC_REGISTRY["cac_mu"].formula_py
        assert f(total_ad_spend_mu=10_000_000, new_customers_count=0) is None

    def test_cm2_per_nc_worked_example(self):
        """CM2 per NC = nc_cm2 / new_customers. 2000000/200 = 10000p (₹100)."""
        f = METRIC_REGISTRY["cm2_per_nc_mu"].formula_py
        assert f(nc_cm2_mu=2_000_000, new_customers_count=200) == 10_000

    def test_cm2_per_nc_zero_customers_returns_null(self):
        f = METRIC_REGISTRY["cm2_per_nc_mu"].formula_py
        assert f(nc_cm2_mu=2_000_000, new_customers_count=0) is None

    def test_parity_class_amer(self):
        assert METRIC_REGISTRY["amer_bp"].parity_class == "correctness_fixture"

    def test_parity_class_mer_cac_shadow(self):
        assert METRIC_REGISTRY["mer_bp"].parity_class == "shadow_compare"
        assert METRIC_REGISTRY["cac_mu"].parity_class == "shadow_compare"


# ---------------------------------------------------------------------------
# LTV:CAC correctness fixture (M2)
# ---------------------------------------------------------------------------

class TestLtvCacCorrectnessFixture:
    """LTV:CAC ratio. parity_gap:true. CF-C4-DDR-TRUE-CM2-1."""

    def test_ltv_cac_worked_example(self):
        """LTV=₹3,000 (300000p), CAC=₹1,000 (100000p). ltv_cac = 3.0x = 30000 bp."""
        f = METRIC_REGISTRY["ltv_cac_bp"].formula_py
        result = f(ltv_mu=300_000, cac_mu=100_000)
        # intDiv(300000 × 10000, 100000) = intDiv(3000000000, 100000) = 30000
        assert result == 30_000

    def test_ltv_cac_below_3x(self):
        """LTV:CAC < 3.0x is a warning signal."""
        f = METRIC_REGISTRY["ltv_cac_bp"].formula_py
        result = f(ltv_mu=200_000, cac_mu=100_000)
        assert result == 20_000  # 2.0x

    def test_ltv_cac_zero_cac_returns_null(self):
        f = METRIC_REGISTRY["ltv_cac_bp"].formula_py
        assert f(ltv_mu=300_000, cac_mu=0) is None

    def test_parity_class(self):
        assert METRIC_REGISTRY["ltv_cac_bp"].parity_class == "correctness_fixture"


# ---------------------------------------------------------------------------
# Ratio integer FLOOR tests — CF-C4-RATIO-DIVOP-1
# ---------------------------------------------------------------------------

class TestRatioIntegerFloor:
    """All ratio formulas use integer FLOOR, not float. CF-C4-RATIO-DIVOP-1."""

    def test_rto_rate_bp_non_zero_remainder(self):
        """1/3 → intDiv(10000, 3) = 3333 (FLOOR, not 3333.33...)."""
        f = METRIC_REGISTRY["rto_rate_bp"].formula_py
        result = f(rto_orders=1, total_shipments=3)
        assert result == 3333, f"Expected 3333 (FLOOR), got {result}"
        assert isinstance(result, int), "Must be int, not float"

    def test_rto_rate_bp_zero_denominator_returns_null(self):
        """Zero shipments → None (fail-closed). CF-C4-RATIO-DIVOP-1 kill-test."""
        f = METRIC_REGISTRY["rto_rate_bp"].formula_py
        result = f(rto_orders=1, total_shipments=0)
        assert result is None, (
            f"Zero total_shipments must return None (not inf/INT64_MAX). "
            f"Got {result!r}. CF-C4-RATIO-DIVOP-1."
        )

    def test_rto_rate_bp_zero_rto(self):
        """Zero RTO orders → 0 bp."""
        f = METRIC_REGISTRY["rto_rate_bp"].formula_py
        assert f(rto_orders=0, total_shipments=100) == 0

    def test_aov_zero_orders_returns_null(self):
        """Zero orders → None (fail-closed). CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["aov_mu"].formula_py
        assert f(net_sales_mu=1_000_000, orders_count=0) is None

    def test_aov_normal(self):
        """AOV = intDiv(net_sales, orders)."""
        f = METRIC_REGISTRY["aov_mu"].formula_py
        # intDiv(1000000, 120) = 8333 (FLOOR of 8333.33...)
        assert f(net_sales_mu=1_000_000, orders_count=120) == 8333

    def test_blended_roas_x100_zero_ad_spend_returns_null(self):
        """Zero ad spend → None. CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["blended_roas_x100"].formula_py
        assert f(net_sales_mu=1_000_000, total_ad_spend_mu=0) is None

    def test_blended_roas_x100_worked_example(self):
        """ROAS = net_sales/ad_spend × 100. intDiv(1000000 × 100, 500000) = 200 = 2.00x."""
        f = METRIC_REGISTRY["blended_roas_x100"].formula_py
        result = f(net_sales_mu=1_000_000, total_ad_spend_mu=500_000)
        assert result == 200

    def test_acos_bp_zero_net_sales_returns_null(self):
        """Zero net sales → None. CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["acos_bp"].formula_py
        assert f(total_ad_spend_mu=100_000, net_sales_mu=0) is None

    def test_prepaid_rate_bp_floor(self):
        """prepaid_rate = intDiv(80 × 10000, 120) = intDiv(800000, 120) = 6666 (FLOOR of 6666.67)."""
        f = METRIC_REGISTRY["prepaid_rate_bp"].formula_py
        result = f(prepaid_orders=80, total_orders=120)
        assert result == 6666, f"Expected 6666 (FLOOR), got {result}"

    def test_conversion_rate_bp_floor(self):
        """conversion_rate = intDiv(50 × 10000, 3000) = intDiv(500000, 3000) = 166 (FLOOR)."""
        f = METRIC_REGISTRY["conversion_rate_bp"].formula_py
        result = f(orders_count=50, sessions=3000)
        assert result == 166, f"Expected 166 (FLOOR), got {result}"

    def test_no_formula_returns_float(self):
        """Verify none of the integer formulas return a float. CF-C4-RATIO-DIVOP-1."""
        # Test all registered formulas with simple integer inputs
        test_cases: list[tuple[str, dict]] = [
            ("net_sales_mu", {"gross_sales_mu": 1000000, "total_discount_mu": 50000}),
            ("cm1_mu", {"net_revenue_mu": 800000, "cogs_mu": 200000, "variable_costs_mu": 50000}),
            ("cm2_mu", {"cm1_mu": 550000, "total_ad_spend_mu": 100000}),
            ("rto_rate_bp", {"rto_orders": 5, "total_shipments": 50}),
            ("prepaid_rate_bp", {"prepaid_orders": 60, "total_orders": 100}),
        ]
        for mid, kwargs in test_cases:
            f = METRIC_REGISTRY[mid].formula_py
            result = f(**kwargs)
            if result is not None:
                assert isinstance(result, int), (
                    f"Metric {mid!r}: formula returned {type(result).__name__!r} ({result!r}), "
                    "expected int. Money/ratio formulas must return integers. "
                    "CF-C4-RATIO-DIVOP-1."
                )


# ---------------------------------------------------------------------------
# Integer floor/null-guard helper tests
# ---------------------------------------------------------------------------

class TestIntFloorHelpers:
    """Direct tests of _int_floor_div_or_null and _ratio_bp. CF-C4-RATIO-DIVOP-1."""

    def test_int_floor_div_positive(self):
        assert _int_floor_div_or_null(10, 3) == 3  # FLOOR(3.33)
        assert _int_floor_div_or_null(9, 3) == 3   # exact
        assert _int_floor_div_or_null(1, 3) == 0   # FLOOR(0.33)

    def test_int_floor_div_zero_denominator_null(self):
        assert _int_floor_div_or_null(100, 0) is None

    def test_int_floor_div_negative_denominator_null(self):
        assert _int_floor_div_or_null(100, -1) is None

    def test_ratio_bp_non_zero_remainder(self):
        """1/3 → 3333 bp (FLOOR). Not 3334 (not ROUND)."""
        result = _ratio_bp(1, 3)
        assert result == 3333

    def test_ratio_bp_zero_denominator_null(self):
        assert _ratio_bp(100, 0) is None

    def test_ratio_bp_exact(self):
        """25% = 2500 bp (exact)."""
        assert _ratio_bp(1, 4) == 2500

    def test_ratio_bp_returns_int(self):
        result = _ratio_bp(7, 3)
        assert isinstance(result, int)


# ---------------------------------------------------------------------------
# FX shadow-rate constant
# ---------------------------------------------------------------------------

def test_fx_shadow_rate_matches_legacy():
    """FX shadow rate must match legacy workspace-costs.ts:INR:83.5.

    CF-C4-DDR-FX-RESTATEMENT-1: shadow-phase Brain uses the same static rate.
    FX_SHADOW_RATE_INR_PER_USD = 8350 paise = ₹83.50 per USD.
    """
    assert FX_SHADOW_RATE_INR_PER_USD == 8350, (
        f"FX_SHADOW_RATE_INR_PER_USD should be 8350 (₹83.50), got {FX_SHADOW_RATE_INR_PER_USD}. "
        "Must match legacy workspace-costs.ts EXCHANGE_RATES {INR: 83.5}. "
        "CF-C4-DDR-FX-RESTATEMENT-1."
    )


# ---------------------------------------------------------------------------
# Phase-2 slice-6 (feat-catalog-inventory): inventory + first-product cascade.
# NON-VACUOUS anchors — every positive case is paired with a killed mutant.
# Byte-identity twin: packages/lib-metrics/src/registry/registry.test.ts (slice-6 block).
# ---------------------------------------------------------------------------

class TestSliceSixInventorySellThrough:
    """inventory_sell_through_bp = sales365 / (sales365 + inventory) in bp. shadow_compare."""

    def test_worked_example_cf_s6_inv_sellthru_1(self):
        """sales365=300, inv=100 → intDiv(300×10000, 400) = 7500bp (75.00%)."""
        f = METRIC_REGISTRY["inventory_sell_through_bp"].formula_py
        assert f(sales365=300, current_inventory=100) == 7500

    def test_kill_divide_by_inventory_only_mutant(self):
        """A '÷ inventory only' mutant → intDiv(300×10000,100)=30000bp — must DIFFER from canon."""
        f = METRIC_REGISTRY["inventory_sell_through_bp"].formula_py
        canon = f(sales365=300, current_inventory=100)
        mutant = _ratio_bp(300, 100)  # the wrong denominator
        assert canon == 7500
        assert mutant == 30000
        assert canon != mutant

    def test_zero_denominator_returns_null(self):
        """sales365=0 and inv=0 → None (fail-closed). CF-C4-RATIO-DIVOP-1."""
        f = METRIC_REGISTRY["inventory_sell_through_bp"].formula_py
        assert f(sales365=0, current_inventory=0) is None

    def test_full_sell_through_when_no_inventory(self):
        """All sold, none on hand → 10000bp (100%)."""
        f = METRIC_REGISTRY["inventory_sell_through_bp"].formula_py
        assert f(sales365=500, current_inventory=0) == 10000

    def test_parity_class_shadow(self):
        assert METRIC_REGISTRY["inventory_sell_through_bp"].parity_class == "shadow_compare"


class TestSliceSixInventoryDaysLeft:
    """inventory_days_left = first non-zero velocity window cascade. correctness_fixture."""

    def test_worked_example_cf_s6_daysleft_1_cascade_falls_through(self):
        """inv=30, L30=0, L90=90 → window falls to L90, qty 90 → round(30×90/90)=30."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        assert f(current_inventory=30, qty_l30=0, qty_l90=90, qty_l180=0, qty_l360=0) == 30

    def test_kill_always_l360_mutant(self):
        """An 'always L360' mutant on L360=0 → 999999, not 30 — KILLED."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        canon = f(current_inventory=30, qty_l30=0, qty_l90=90, qty_l180=0, qty_l360=0)
        # The 'always L360' mutant would see qty=0 → infinite sentinel.
        mutant_infinite = 999999
        assert canon == 30
        assert canon != mutant_infinite

    def test_cf_s6_daysleft_inf_stock_no_velocity(self):
        """inv=50, all windows 0 → 999999 (INFINITE sentinel)."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        assert f(current_inventory=50, qty_l30=0, qty_l90=0, qty_l180=0, qty_l360=0) == 999999

    def test_zero_inventory_returns_zero_not_infinite(self):
        """inv<=0 → 0 days left (out of stock), NEVER the infinite sentinel."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        assert f(current_inventory=0, qty_l30=10, qty_l90=0, qty_l180=0, qty_l360=0) == 0
        assert f(current_inventory=-5, qty_l30=10, qty_l90=0, qty_l180=0, qty_l360=0) == 0

    def test_l30_preferred_over_later_windows(self):
        """L30 wins when non-zero: inv=60, L30=30 → round(60×30/30)=60 (not the L360 read)."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        assert f(current_inventory=60, qty_l30=30, qty_l90=900, qty_l180=0, qty_l360=0) == 60

    def test_half_up_rounding(self):
        """round(inv×w/q) half-up: inv=10, L30=4 → 10×30/4 = 75.0 → 75 (exact)."""
        f = METRIC_REGISTRY["inventory_days_left"].formula_py
        assert f(current_inventory=10, qty_l30=4, qty_l90=0, qty_l180=0, qty_l360=0) == 75
        # inv=7, L30=2 → 7×30/2 = 105.0 exact → 105
        assert f(current_inventory=7, qty_l30=2, qty_l90=0, qty_l180=0, qty_l360=0) == 105

    def test_parity_class_correctness_fixture(self):
        assert METRIC_REGISTRY["inventory_days_left"].parity_class == "correctness_fixture"


class TestSliceSixFirstProductSecondOrderRate:
    """first_product_second_order_rate_bp = custWith2plus / cohort in bp. shadow_compare.

    NOT slice-5 repeat_rate_bp (rr90). Different window + cohort semantics.
    """

    def test_worked_example_cf_s6_fp_2nd_1(self):
        """3 of 8 cohort have >=2 orders → intDiv(3×10000, 8) = 3750bp (37.50%)."""
        f = METRIC_REGISTRY["first_product_second_order_rate_bp"].formula_py
        assert f(customers_with_2plus=3, cohort_customers=8) == 3750

    def test_kill_divide_by_orders_mutant(self):
        """A '÷ orders(20) not customers(8)' mutant → 1500bp — KILLED."""
        f = METRIC_REGISTRY["first_product_second_order_rate_bp"].formula_py
        canon = f(customers_with_2plus=3, cohort_customers=8)
        mutant = f(customers_with_2plus=3, cohort_customers=20)
        assert canon == 3750
        assert mutant == 1500
        assert canon != mutant

    def test_zero_cohort_returns_null(self):
        """Empty cohort → None (fail-closed)."""
        f = METRIC_REGISTRY["first_product_second_order_rate_bp"].formula_py
        assert f(customers_with_2plus=0, cohort_customers=0) is None

    def test_zero_repeaters(self):
        """No one re-ordered → 0bp."""
        f = METRIC_REGISTRY["first_product_second_order_rate_bp"].formula_py
        assert f(customers_with_2plus=0, cohort_customers=50) == 0

    def test_is_distinct_from_repeat_rate_bp(self):
        """The cascade rate is a SEPARATE metric id from slice-5 repeat_rate_bp (no conflation)."""
        assert "first_product_second_order_rate_bp" in METRIC_REGISTRY
        assert "repeat_rate_bp" in METRIC_REGISTRY
        assert (
            METRIC_REGISTRY["first_product_second_order_rate_bp"].id
            != METRIC_REGISTRY["repeat_rate_bp"].id
        )


# ---------------------------------------------------------------------------
# Phase-2 slice-7 (feat-finance-settings-goals): goal attainment + directional RAG.
# NON-VACUOUS anchors — every positive case is paired with a killed mutant.
# Byte-identity twin: packages/lib-metrics/src/registry/registry.test.ts (slice-7 block).
# ---------------------------------------------------------------------------

class TestSliceSevenGoalAttainment:
    """goal_attainment_bp = actual / goal in bp. shadow_compare."""

    def test_worked_example_cf_s7_goal_attain_1(self):
        """actual=9200, goal=10000 → intDiv(9200×10000,10000) = 9200bp (92.00%)."""
        f = METRIC_REGISTRY["goal_attainment_bp"].formula_py
        assert f(actual=9200, goal_value=10000) == 9200

    def test_kill_divide_by_actual_mutant(self):
        """A '÷ actual' (wrong-denominator) mutant → intDiv(9200×10000,9200)=10000bp — KILLED."""
        f = METRIC_REGISTRY["goal_attainment_bp"].formula_py
        canon = f(actual=9200, goal_value=10000)
        mutant = _ratio_bp(9200, 9200)  # the wrong denominator
        assert canon == 9200
        assert mutant == 10000
        assert canon != mutant

    def test_zero_goal_returns_null(self):
        f = METRIC_REGISTRY["goal_attainment_bp"].formula_py
        assert f(actual=5000, goal_value=0) is None

    def test_parity_class_shadow(self):
        assert METRIC_REGISTRY["goal_attainment_bp"].parity_class == "shadow_compare"


class TestSliceSevenDirectionalRag:
    """compute_goal_rag — directional band (the slice-table's flat rule is only higher-better)."""

    def test_higher_better_bands(self):
        # >=95% green, >=80% amber, else red.
        assert compute_goal_rag(9800, 10000, True) == "green"
        assert compute_goal_rag(9500, 10000, True) == "green"   # boundary
        assert compute_goal_rag(9200, 10000, True) == "amber"
        assert compute_goal_rag(8000, 10000, True) == "amber"   # boundary
        assert compute_goal_rag(7000, 10000, True) == "red"

    def test_lower_better_bands(self):
        # <=105% green, <=120% amber, else red (INVERTED).
        assert compute_goal_rag(10000, 10000, False) == "green"
        assert compute_goal_rag(10500, 10000, False) == "green"  # boundary
        assert compute_goal_rag(12000, 10000, False) == "amber"  # boundary
        assert compute_goal_rag(12100, 10000, False) == "red"

    def test_kill_all_higher_better_mutant_on_cac(self):
        """CAC@120% of goal: directional → amber. The 'all-higher-better' mutant → green. KILLED."""
        directional = compute_goal_rag(12000, 10000, False)   # lower-better
        mutant = compute_goal_rag(12000, 10000, True)         # treat-all-higher-better
        assert directional == "amber"
        assert mutant == "green"
        assert directional != mutant

    def test_goal_higher_better_resolution(self):
        # MINIMUM → higher-better, MAXIMUM → lower-better, TARGET → metric default.
        assert goal_higher_better("MINIMUM", False) is True
        assert goal_higher_better("MAXIMUM", True) is False
        assert goal_higher_better("TARGET", True) is True
        assert goal_higher_better("TARGET", False) is False

    def test_festival_lift_is_not_in_registry(self):
        """Finding 2: festival learned-lift is a phantom — NEVER registered."""
        assert "festival_lift" not in METRIC_REGISTRY
        assert "festival_lift_factor" not in METRIC_REGISTRY

    def test_parity_class_shadow(self):
        assert METRIC_REGISTRY["first_product_second_order_rate_bp"].parity_class == "shadow_compare"
