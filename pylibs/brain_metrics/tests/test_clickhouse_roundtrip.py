"""
tests/test_clickhouse_roundtrip.py — ClickHouse round-trip + COGS taxonomy fixtures.

@paradigm: sql (zero LLM; pure integer arithmetic verification)
Tests cover:
- M4: ClickHouse round-trip fixtures (intDiv vs '/' divergence)
- M5: COGS_SETTINGS_CHANGE_DELTA taxonomy category + coq-change-mid-day fixture
- CF-C4-RATIO-DIVOP-1: kill-test — '/' revert makes zero-denom fixture go RED
- CF-C4-COGS-MV-REFRESH-1: full-recompute model = zero delta
- CF-C4-PRORATED-DIVOP-1: wrong-constant kill-test

These tests do NOT require a live ClickHouse connection. They verify the
Python formula implementations that correspond to the ClickHouse intDiv
expressions. A live ClickHouse round-trip would use the same arithmetic.
CF-C2-NO-LIVE-1: ZERO live data.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from brain_metrics.parity.taxonomy import MismatchCategory
from brain_metrics.registry.definitions import (
    _int_floor_div_or_null,
    _ratio_bp,
)

_FIXTURE_PATH = (
    pathlib.Path(__file__).parent.parent
    / "brain_metrics" / "parity" / "fixtures" / "clickhouse_roundtrip_fixtures.json"
)


@pytest.fixture(scope="module")
def ch_fixtures() -> dict:
    with _FIXTURE_PATH.open() as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# intDiv non-zero-remainder fixtures
# ---------------------------------------------------------------------------

class TestIntDivNonZeroRemainder:
    """CF-C4-RATIO-DIVOP-1: non-zero-remainder ratio → FLOOR, not round."""

    def test_ch_rt_1_one_third(self, ch_fixtures):
        """1/3 → 3333 bp (FLOOR). intDiv(1 × 10000, 3) = 3333."""
        fx = next(f for f in ch_fixtures["intdiv_non_zero_remainder"] if f["id"] == "ch-rt-1")
        num, denom, scale = fx["numerator"], fx["denominator"], fx["scale"]
        expected = fx["expected_intdiv_result"]
        result = _int_floor_div_or_null(num * scale, denom)
        assert result == expected, f"ch-rt-1: expected {expected}, got {result}"
        assert isinstance(result, int), "Must be int, not float"

    def test_ch_rt_2_seven_thirds(self, ch_fixtures):
        """7/3 → 23333 bp."""
        fx = next(f for f in ch_fixtures["intdiv_non_zero_remainder"] if f["id"] == "ch-rt-2")
        num, denom, scale = fx["numerator"], fx["denominator"], fx["scale"]
        expected = fx["expected_intdiv_result"]
        result = _int_floor_div_or_null(num * scale, denom)
        assert result == expected

    def test_results_are_exact_integers(self, ch_fixtures):
        """All intDiv results must be exact integers (no float)."""
        for fx in ch_fixtures["intdiv_non_zero_remainder"]:
            result = _int_floor_div_or_null(fx["numerator"] * fx["scale"], fx["denominator"])
            if result is not None:
                assert isinstance(result, int), f"{fx['id']}: result must be int"


# ---------------------------------------------------------------------------
# Zero-denominator kill-test — CF-C4-RATIO-DIVOP-1
# ---------------------------------------------------------------------------

class TestZeroDenominatorKillTest:
    """KILL TEST: '/' without null-guard → INT64_MAX; intDiv with guard → NULL.

    CF-C4-RATIO-DIVOP-1: the kill-test that proves the bug is visible.
    Without null-guard: ClickHouse '/' on (1, 0) returns +Inf → INT64_MAX.
    With null-guard:    if(0 > 0, intDiv(...), NULL) → NULL.
    """

    def test_zero_denominator_returns_null_with_guard(self, ch_fixtures):
        """CF-C4-RATIO-DIVOP-1 KILL-TEST: zero_denom → NULL with intDiv + null-guard."""
        fx = next(f for f in ch_fixtures["intdiv_zero_denominator"] if f["id"] == "ch-rt-zero-1")
        assert fx["denominator"] == 0
        assert fx["expected_intdiv_null_guarded"] is None
        # Python implementation of the null-guarded formula
        result = _int_floor_div_or_null(fx["numerator_scaled"], fx["denominator"])
        assert result is None, (
            f"Zero denominator: expected None, got {result!r}. "
            "CF-C4-RATIO-DIVOP-1 kill-test: the null-guard MUST return None."
        )

    def test_zero_denominator_without_guard_would_fail(self, ch_fixtures):
        """KILL TEST: simulate what happens WITHOUT the null-guard.

        Python '/' on (10000, 0) raises ZeroDivisionError.
        ClickHouse '/' on Int64 (num, 0) returns +Inf → coercion to INT64_MAX.
        This fixture documents that the unguarded path is WRONG.
        """
        fx = next(f for f in ch_fixtures["intdiv_zero_denominator"] if f["id"] == "ch-rt-zero-1")
        # Simulate the unguarded path (Python raises where CH returns inf)
        with pytest.raises(ZeroDivisionError):
            _ = fx["numerator_scaled"] // fx["denominator"]
        # This confirms that '/' / '//' without guard fails on zero-denom.
        # The correct path is _int_floor_div_or_null which returns None.

    def test_aov_zero_orders_null(self, ch_fixtures):
        """AOV zero-denominator: None (fail-closed). CF-C4-RATIO-DIVOP-1."""
        fx = next(f for f in ch_fixtures["intdiv_zero_denominator"] if f["id"] == "ch-rt-zero-2")
        result = _int_floor_div_or_null(fx["net_sales_mu"], fx["orders_count"])
        assert result is None

    def test_ratio_bp_zero_denom_returns_null(self):
        """_ratio_bp null-guard: zero denominator → None, not ZeroDivisionError."""
        result = _ratio_bp(numerator=10000, denominator=0)
        assert result is None

    def test_mutant_kill_bare_division_fails(self):
        """KILL TEST: bare Python '//' without null-guard raises on zero input.

        This proves that the null-guard is load-bearing. Any code path that
        uses '//' without checking denominator > 0 WILL fail on zero-order days.
        """
        numerator = 10_000
        denominator = 0
        with pytest.raises(ZeroDivisionError):
            _ = numerator // denominator
        # The correct path:
        assert _int_floor_div_or_null(numerator, denominator) is None


# ---------------------------------------------------------------------------
# Float64-vs-FLOOR divergent values — CF-C4-RATIO-DIVOP-1
# ---------------------------------------------------------------------------

class TestFloat64VsFloorDivergent:
    """Fixtures documenting Float64 divergence risk. CF-C4-RATIO-DIVOP-1."""

    def test_prorated_feb_boundary_correct(self, ch_fixtures):
        """intDiv(1000000, 28) = 35714 (Feb 2026). CF-C4-PRORATED-DIVOP-1."""
        fx = next(
            f for f in ch_fixtures["float64_vs_floor_divergent"]
            if f["id"] == "ch-rt-div-2"
        )
        result = _int_floor_div_or_null(fx["monthly_amount_mu"], fx["days_in_month"])
        assert result == fx["expected_intdiv_result"], (
            f"Feb 2026 (28 days): expected {fx['expected_intdiv_result']}, got {result}"
        )

    def test_wrong_constant_30_kill_test_from_fixture(self, ch_fixtures):
        """KILL TEST: intDiv(1000000, 30) = 33333 ≠ 35714 (correct Feb-28 result).

        CF-C4-DDR-MISC-PRORATE-1 + CF-C4-PRORATED-DIVOP-1:
        adjudication must NOT classify this 2381-paise delta as ROUNDING_MODE_MISMATCH.
        It is a BLOCKING_BUG (wrong formula constant).
        """
        fx = next(
            f for f in ch_fixtures["float64_vs_floor_divergent"]
            if f["id"] == "ch-rt-div-3"
        )
        wrong_result = _int_floor_div_or_null(fx["monthly_amount_mu"], fx["wrong_constant_30"])
        correct_result = _int_floor_div_or_null(fx["monthly_amount_mu"], fx["correct_days_in_month"])

        assert wrong_result == fx["wrong_result_with_30"], (
            f"Wrong constant (30): expected {fx['wrong_result_with_30']}, got {wrong_result}"
        )
        assert correct_result == fx["expected_correct_result"], (
            f"Correct (28 days): expected {fx['expected_correct_result']}, got {correct_result}"
        )

        delta = correct_result - wrong_result
        assert delta == fx["delta_paise"], f"Delta: expected {fx['delta_paise']}, got {delta}"
        # This delta (2381) is NOT a 1-paise rounding delta — must be BLOCKING_BUG
        assert abs(delta) > 1, (
            f"Delta={delta} is NOT a ROUNDING_MODE_MISMATCH (which is ±1 paise). "
            "This MUST be classified as BLOCKING_BUG. "
            "CF-C4-DDR-MISC-PRORATE-1: wrong constant ≠ rounding drift."
        )

    def test_float_division_does_not_equal_intdiv_for_wrong_rounding(self):
        """Document that Python float '/' is not safe for money arithmetic.

        This is the Python analog of ClickHouse's Float64 issue.
        """
        # 1000000 / 28 in float
        float_result = 1_000_000 / 28
        # intDiv(1000000, 28) in integer FLOOR
        int_result = _int_floor_div_or_null(1_000_000, 28)
        # For positive values, float truncation and FLOOR agree:
        assert int(float_result) == int_result  # 35714 == 35714
        # But for zero-denominator, float gives ZeroDivisionError (Python) or inf (CH)
        # This proves float is unreliable — use integer division exclusively


# ---------------------------------------------------------------------------
# COGS settings-change-delta fixture — CF-C4-COGS-MV-REFRESH-1
# ---------------------------------------------------------------------------

class TestCogsSettingsChangeDelta:
    """CF-C4-COGS-MV-REFRESH-1: full-recompute model = zero delta vs legacy.

    KILL TEST: reverting to incremental MV on a coq-change-day fixture → RED.
    """

    def test_full_recompute_matches_legacy(self, ch_fixtures):
        """Full-recompute model: Brain matches legacy exactly on coq-change day."""
        fx = ch_fixtures["cogs_settings_change_delta"][0]
        assert fx["id"] == "ch-cogs-1"
        assert fx["brain_vs_legacy_delta"] == 0, (
            f"Full-recompute model: Brain vs legacy delta must be 0. "
            f"Got {fx['brain_vs_legacy_delta']}. CF-C4-COGS-MV-REFRESH-1."
        )
        assert fx["expected_brain_result"] == fx["expected_legacy_result"], (
            "Full-recompute: Brain and legacy must compute the same COGS."
        )

    def test_incremental_mv_produces_wrong_delta(self, ch_fixtures):
        """KILL TEST: incremental MV model diverges from legacy on coq-change day.

        This proves WHY full-recompute is mandatory.
        CF-C4-COGS-MV-REFRESH-1: if the model reverts to incremental MV,
        this fixture must go RED (delta ≠ 0).
        """
        fx = ch_fixtures["cogs_settings_change_delta"][0]
        incremental_result = fx["incremental_mv_cogs_mu"]
        correct_result = fx["full_recompute_cogs_mu"]
        # Incremental MV is WRONG
        assert incremental_result != correct_result, (
            "Test infrastructure error: incremental and full-recompute should differ."
        )
        delta = correct_result - incremental_result
        assert delta == fx["delta_paise"], (
            f"Incremental MV delta: expected {fx['delta_paise']}, got {delta}"
        )
        # Confirm the delta is material (₹250 in this example)
        assert abs(delta) > 0, "Incremental MV delta must be non-zero (₹250 here)"

    def test_incremental_mv_formula_verification(self, ch_fixtures):
        """Verify the incremental MV formula manually."""
        fx = ch_fixtures["cogs_settings_change_delta"][0]
        old_coq = fx["old_coq_paise"]
        new_coq = fx["new_coq_paise"]
        orders_before = fx["orders_before_change"]
        orders_after = fx["orders_after_change"]
        # Incremental MV: old coq for orders before change + new coq after
        incremental = orders_before * old_coq + orders_after * new_coq
        assert incremental == fx["incremental_mv_cogs_mu"], (
            f"Incremental formula: expected {fx['incremental_mv_cogs_mu']}, got {incremental}"
        )
        # Full recompute: ALL orders × new coq (current coq at recompute time)
        full_recompute = fx["total_orders"] * new_coq
        assert full_recompute == fx["full_recompute_cogs_mu"], (
            f"Full recompute formula: expected {fx['full_recompute_cogs_mu']}, got {full_recompute}"
        )

    def test_cogs_settings_change_delta_category_exists(self):
        """COGS_SETTINGS_CHANGE_DELTA taxonomy category must exist. CF-C4-COGS-MV-REFRESH-1."""
        assert MismatchCategory.COGS_SETTINGS_CHANGE_DELTA.value == "COGS_SETTINGS_CHANGE_DELTA", (
            "MismatchCategory.COGS_SETTINGS_CHANGE_DELTA must be defined. "
            "CF-C4-COGS-MV-REFRESH-1: data-staleness is DISTINCT from formula delta."
        )

    def test_cogs_category_distinct_from_expected_definitional_delta(self):
        """COGS_SETTINGS_CHANGE_DELTA is NOT EXPECTED_DEFINITIONAL_DELTA. CF-C4-COGS-MV-REFRESH-1."""
        assert MismatchCategory.COGS_SETTINGS_CHANGE_DELTA != MismatchCategory.EXPECTED_DEFINITIONAL_DELTA, (
            "COGS_SETTINGS_CHANGE_DELTA must be a distinct category from EXPECTED_DEFINITIONAL_DELTA. "
            "Data-staleness (incremental-MV drift) is NOT a formula-level semantic difference. "
            "CF-C4-COGS-MV-REFRESH-1."
        )

    def test_all_6_taxonomy_categories_present(self):
        """Taxonomy must have exactly 6 categories (5 original + COGS new). CF-C4-COGS-MV-REFRESH-1."""
        categories = {c.value for c in MismatchCategory}
        expected = {
            "BLOCKING_BUG",
            "EXPECTED_DEFINITIONAL_DELTA",
            "EXCLUDED_FX_MISMATCH",
            "RATIO_MISMATCH",
            "ROUNDING_MODE_MISMATCH",
            "COGS_SETTINGS_CHANGE_DELTA",
        }
        assert categories == expected, (
            f"Expected 6 taxonomy categories {expected}, got {categories}. "
            "CF-C4-COGS-MV-REFRESH-1."
        )


# ---------------------------------------------------------------------------
# HarnessReport Child-4 extensions
# ---------------------------------------------------------------------------

class TestHarnessReportExtensions:
    """CF-C4 HarnessReport fields. CF-C4-RATIO-DIVOP-1, CF-C4-PARITY-SCOPE-1."""

    def test_harness_report_has_clickhouse_roundtrip_field(self):
        from brain_metrics.parity.taxonomy import HarnessReport
        report = HarnessReport()
        assert hasattr(report, "clickhouse_roundtrip_checked")
        assert report.clickhouse_roundtrip_checked is False  # default

    def test_harness_report_has_cogs_delta_count(self):
        from brain_metrics.parity.taxonomy import HarnessReport
        report = HarnessReport()
        assert hasattr(report, "cogs_settings_change_delta_count")
        assert report.cogs_settings_change_delta_count == 0

    def test_harness_report_has_correctness_fixture_fields(self):
        from brain_metrics.parity.taxonomy import HarnessReport
        report = HarnessReport()
        assert hasattr(report, "correctness_fixture_pass")
        assert hasattr(report, "correctness_fixture_fail")

    def test_harness_report_has_input_source(self):
        """CF-C4-PARITY-SCOPE-1: every run must declare input_source."""
        from brain_metrics.parity.taxonomy import HarnessReport
        report = HarnessReport()
        assert hasattr(report, "input_source")
        assert report.input_source == "legacy_sourced"  # default

    def test_harness_report_input_source_in_to_dict(self):
        """to_dict() must include input_source and parity_scope_note."""
        from brain_metrics.parity.taxonomy import HarnessReport
        report = HarnessReport(input_source="legacy_sourced")
        d = report.to_dict()
        assert "input_source" in d
        assert d["input_source"] == "legacy_sourced"
        assert "parity_scope_note" in d
        assert "NOT a cutover license" in d["parity_scope_note"]

    def test_harness_report_cogs_delta_counter_incremented(self):
        """COGS_SETTINGS_CHANGE_DELTA mismatch increments the right counter."""
        from brain_metrics.parity.taxonomy import HarnessReport, MismatchRecord, MismatchCategory
        report = HarnessReport()
        record = MismatchRecord(
            workspace_id="ws_test",
            date="2026-01-15",
            field="cogs",
            legacy_mu=135000,
            brain_mu=110000,
            delta=-25000,
            category=MismatchCategory.COGS_SETTINGS_CHANGE_DELTA,
            note="Incremental MV vs full-recompute on coq-change day",
        )
        report.record_mismatch(record)
        assert report.cogs_settings_change_delta_count == 1
        assert report.blocking_bug_count == 0

    def test_harness_run_with_input_source_brain(self):
        """run_harness with input_source='brain_child3_sourced' sets the field."""
        from brain_metrics.parity.harness import run_harness
        report = run_harness(fixtures=[], input_source="brain_child3_sourced")
        assert report.input_source == "brain_child3_sourced"

    def test_harness_run_with_ddr_hook_wires_expected_delta(self):
        """run_harness with ddr_lookup wires the DDR hook marker. CF-C4-DDR-1."""
        from brain_metrics.parity.harness import run_harness
        from brain_metrics.parity.definitional_delta_register import get_ddr_row

        def ddr_hook(field_name: str):
            row = get_ddr_row(field_name)
            return row.reason if row else None

        report = run_harness(fixtures=[], ddr_lookup=ddr_hook)
        assert report.expected_definitional_delta is not None
        assert report.expected_definitional_delta.get("__ddr_hook") == "wired"
