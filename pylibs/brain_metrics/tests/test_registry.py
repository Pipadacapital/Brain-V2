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
        parity_gap_ids = {"true_cm2_mu", "pamer_bp", "amer_bp", "ltv_cac_bp"}
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
            "cm3_mu", "true_cm2_mu", "pamer_bp", "amer_bp", "ltv_cac_bp",
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

class TestPamerAmerCorrectnessFixtures:
    """paMER + aMER Brain-native metrics. parity_gap:true. CF-C4-DDR-TRUE-CM2-1."""

    def test_pamer_bp_worked_example(self):
        """paMER = CM2 / Ad Spend in bp. 8000000/5000000 = 1.6x = 16000 bp."""
        f = METRIC_REGISTRY["pamer_bp"].formula_py
        result = f(cm2_mu=8_000_000, total_ad_spend_mu=5_000_000)
        # intDiv(8000000 × 10000, 5000000) = intDiv(80000000000, 5000000) = 16000
        assert result == 16_000

    def test_pamer_zero_ad_spend_returns_null(self):
        f = METRIC_REGISTRY["pamer_bp"].formula_py
        assert f(cm2_mu=8_000_000, total_ad_spend_mu=0) is None

    def test_amer_bp_worked_example(self):
        """aMER = True CM2 / Ad Spend in bp. 6620000/5000000 ≈ 1.324x = 13240 bp."""
        f = METRIC_REGISTRY["amer_bp"].formula_py
        result = f(true_cm2_mu=6_620_000, total_ad_spend_mu=5_000_000)
        # intDiv(6620000 × 10000, 5000000) = intDiv(66200000000, 5000000) = 13240
        assert result == 13_240

    def test_amer_zero_ad_spend_returns_null(self):
        f = METRIC_REGISTRY["amer_bp"].formula_py
        assert f(true_cm2_mu=6_620_000, total_ad_spend_mu=0) is None

    def test_amer_lt_pamer_when_rto_positive(self):
        """aMER must be ≤ paMER (RTO provisioning reduces profitability)."""
        pamer_f = METRIC_REGISTRY["pamer_bp"].formula_py
        amer_f = METRIC_REGISTRY["amer_bp"].formula_py
        pamer = pamer_f(cm2_mu=8_000_000, total_ad_spend_mu=5_000_000)
        amer = amer_f(true_cm2_mu=6_620_000, total_ad_spend_mu=5_000_000)
        assert amer <= pamer, f"aMER ({amer}) must be ≤ paMER ({pamer})"

    def test_parity_class_pamer(self):
        assert METRIC_REGISTRY["pamer_bp"].parity_class == "correctness_fixture"

    def test_parity_class_amer(self):
        assert METRIC_REGISTRY["amer_bp"].parity_class == "correctness_fixture"


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
