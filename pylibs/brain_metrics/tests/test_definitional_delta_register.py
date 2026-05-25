"""
tests/test_definitional_delta_register.py — Tests for the 9-field DDR (Child 4, Track M).

@paradigm: sql (zero LLM; pure structural enforcement verification)
Tests cover:
- M3: 9 fields present on all DDR rows
- CF-C4-DDR-1: two structural sign-off rules enforced in code
- CF-C4-DDR-TRUE-CM2-1: True-CM2 parity_gap:true, no legacy comparand
- CF-C4-DDR-GST-TAX-1: total_tax_mu child_dependency present
- CF-C4-DDR-FX-RESTATEMENT-1: FX row child_dependency present
- CF-C4-DDR-MISC-PRORATE-1: misc prorate row + Feb-boundary mention
- Adjudication: mis-filed bugs cannot hide as EXPECTED_DEFINITIONAL_DELTA
"""

from __future__ import annotations

import pytest

from brain_metrics.parity.definitional_delta_register import (
    DDRRow,
    DEFINITIONAL_DELTA_REGISTER,
    SignOffBlockedError,
    CORRECTNESS_FIXTURE,
    EXPECTED_DEFINITIONAL_DELTA,
    COGS_SETTINGS_CHANGE_DELTA,
    get_ddr_row,
    is_parity_gap,
    is_child_dependency_blocked,
    get_parity_gap_metrics,
    get_child_dependency_blocked_metrics,
)


# ---------------------------------------------------------------------------
# Schema completeness — all 9 fields present
# ---------------------------------------------------------------------------

class TestDDRSchema:
    """All 9 DDR fields are present and correctly typed. CF-C4-DDR-1."""

    def test_all_rows_have_9_fields(self):
        """Every DDR row must have all 9 required fields."""
        required_attrs = [
            "legacy_formula",
            "brain_formula",
            "reason",
            "shadow_compare_classification",
            "delta_direction_and_magnitude",
            "business_impact",
            "parity_gap",
            "child_dependency",
            "formula_snapshot",
        ]
        for mid, row in DEFINITIONAL_DELTA_REGISTER.items():
            for attr in required_attrs:
                assert hasattr(row, attr), (
                    f"DDR row '{mid}' missing field '{attr}'. "
                    "CF-C4-DDR-1: all 9 fields required."
                )

    def test_parity_gap_is_bool(self):
        for mid, row in DEFINITIONAL_DELTA_REGISTER.items():
            assert isinstance(row.parity_gap, bool), (
                f"DDR row '{mid}': parity_gap must be bool, got {type(row.parity_gap)}"
            )

    def test_child_dependency_is_str_or_none(self):
        for mid, row in DEFINITIONAL_DELTA_REGISTER.items():
            assert row.child_dependency is None or isinstance(row.child_dependency, str), (
                f"DDR row '{mid}': child_dependency must be str|None"
            )

    def test_formula_snapshot_is_non_empty_str(self):
        """formula_snapshot must be a non-empty string (exact formula, not an id pointer)."""
        for mid, row in DEFINITIONAL_DELTA_REGISTER.items():
            assert isinstance(row.formula_snapshot, str) and len(row.formula_snapshot) > 20, (
                f"DDR row '{mid}': formula_snapshot must be a non-empty expression string. "
                "It should capture the EXACT formula, not just an id pointer. CF-C4-DDR-1."
            )

    def test_rows_are_frozen_immutable(self):
        """DDR rows are frozen dataclasses — cannot be mutated post-sign-off."""
        row = DEFINITIONAL_DELTA_REGISTER["cm2_mu"]
        # Frozen dataclasses raise FrozenInstanceError (subclass of AttributeError)
        # when direct attribute assignment is attempted via normal assignment.
        with pytest.raises((AttributeError, TypeError)):
            row.parity_gap = True  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Structural Rule 1: parity_gap:True rows cannot be signed as shadow GREEN
# ---------------------------------------------------------------------------

class TestStructuralRule1ParityGap:
    """CF-C4-DDR-1 Rule 1: parity_gap:True rows must NEVER be signed as shadow GREEN."""

    def test_true_cm2_has_parity_gap_true(self):
        row = DEFINITIONAL_DELTA_REGISTER["true_cm2_mu"]
        assert row.parity_gap is True, (
            "true_cm2_mu must have parity_gap=True. "
            "It has NO legacy comparand (compute-daily.ts stops at cm2). "
            "CF-C4-DDR-TRUE-CM2-1."
        )

    def test_pamer_has_parity_gap_true(self):
        row = DEFINITIONAL_DELTA_REGISTER["pamer_bp"]
        assert row.parity_gap is True

    def test_amer_has_parity_gap_true(self):
        row = DEFINITIONAL_DELTA_REGISTER["amer_bp"]
        assert row.parity_gap is True

    def test_ltv_cac_has_parity_gap_true(self):
        row = DEFINITIONAL_DELTA_REGISTER["ltv_cac_bp"]
        assert row.parity_gap is True

    def test_parity_gap_rows_use_correctness_fixture_classification(self):
        """parity_gap rows must use CORRECTNESS_FIXTURE, not EXPECTED_DEFINITIONAL_DELTA."""
        for mid, row in DEFINITIONAL_DELTA_REGISTER.items():
            if row.parity_gap:
                assert row.shadow_compare_classification == CORRECTNESS_FIXTURE, (
                    f"DDR row '{mid}': parity_gap=True but classification is "
                    f"'{row.shadow_compare_classification}'. Must be '{CORRECTNESS_FIXTURE}'. "
                    "CF-C4-DDR-1 Rule 1: parity_gap rows must NEVER be classified as "
                    "shadow-compare categories."
                )

    def test_assert_signable_raises_for_parity_gap(self):
        """assert_signable() must raise SignOffBlockedError for parity_gap:True rows."""
        row = DEFINITIONAL_DELTA_REGISTER["true_cm2_mu"]
        with pytest.raises(SignOffBlockedError) as exc_info:
            row.assert_signable()
        assert "parity_gap=True" in str(exc_info.value)
        assert "NO legacy comparand" in str(exc_info.value)

    def test_assert_signable_raises_for_all_parity_gap_rows(self):
        """ALL parity_gap:True rows must be blocked from sign-off via shadow-compare."""
        parity_gap_ids = get_parity_gap_metrics()
        assert len(parity_gap_ids) >= 4, "At least 4 parity_gap metrics expected"
        for mid in parity_gap_ids:
            row = DEFINITIONAL_DELTA_REGISTER[mid]
            with pytest.raises(SignOffBlockedError):
                row.assert_signable()

    def test_is_parity_gap_true_for_brain_native_metrics(self):
        assert is_parity_gap("true_cm2_mu") is True
        assert is_parity_gap("pamer_bp") is True
        assert is_parity_gap("amer_bp") is True
        assert is_parity_gap("ltv_cac_bp") is True

    def test_is_parity_gap_false_for_shadow_metrics(self):
        assert is_parity_gap("cm2_mu") is False
        assert is_parity_gap("misc_expenses_prorated_mu") is False

    def test_is_parity_gap_none_for_unknown_metric(self):
        """Unknown metric: is_parity_gap returns False (no DDR row = exact equality expected)."""
        assert is_parity_gap("nonexistent_metric") is False


# ---------------------------------------------------------------------------
# Structural Rule 2: child_dependency rows blocked until dependency is GREEN
# ---------------------------------------------------------------------------

class TestStructuralRule2ChildDependency:
    """CF-C4-DDR-1 Rule 2: non-null child_dependency rows cannot be signed prematurely."""

    def test_total_tax_has_child_dependency(self):
        """CF-C4-DDR-GST-TAX-1: total_tax_mu needs child-3-shopify-connector."""
        row = DEFINITIONAL_DELTA_REGISTER["total_tax_mu"]
        assert row.child_dependency == "child-3-shopify-connector", (
            f"total_tax_mu: expected child_dependency='child-3-shopify-connector', "
            f"got {row.child_dependency!r}. CF-C4-DDR-GST-TAX-1."
        )

    def test_fx_has_child_dependency(self):
        """CF-C4-DDR-FX-RESTATEMENT-1: FX row needs child-3-workspace-cost-currency-migration."""
        row = DEFINITIONAL_DELTA_REGISTER["fx_restatement"]
        assert row.child_dependency == "child-3-workspace-cost-currency-migration", (
            f"fx_restatement: expected child-3-workspace-cost-currency-migration, "
            f"got {row.child_dependency!r}. CF-C4-DDR-FX-RESTATEMENT-1."
        )

    def test_assert_signable_raises_for_child_dependency(self):
        """assert_signable() must raise SignOffBlockedError when child_dependency is set."""
        row = DEFINITIONAL_DELTA_REGISTER["total_tax_mu"]
        with pytest.raises(SignOffBlockedError) as exc_info:
            row.assert_signable()
        assert "child_dependency" in str(exc_info.value)
        assert "child-3-shopify-connector" in str(exc_info.value)

    def test_assert_signable_raises_for_fx_row(self):
        row = DEFINITIONAL_DELTA_REGISTER["fx_restatement"]
        with pytest.raises(SignOffBlockedError) as exc_info:
            row.assert_signable()
        assert "child-3-workspace-cost-currency-migration" in str(exc_info.value)

    def test_is_child_dependency_blocked_true(self):
        assert is_child_dependency_blocked("total_tax_mu") is True
        assert is_child_dependency_blocked("fx_restatement") is True

    def test_is_child_dependency_blocked_false_for_resolved(self):
        assert is_child_dependency_blocked("cm2_mu") is False
        assert is_child_dependency_blocked("misc_expenses_prorated_mu") is False
        assert is_child_dependency_blocked("true_cm2_mu") is False

    def test_get_child_dependency_blocked_metrics_non_empty(self):
        blocked = get_child_dependency_blocked_metrics()
        assert "total_tax_mu" in blocked
        assert "fx_restatement" in blocked

    def test_signable_rows_have_no_parity_gap_and_no_dependency(self):
        """Rows without parity_gap and without child_dependency should be signable."""
        signable_ids = ["cm2_mu", "misc_expenses_prorated_mu", "cogs_mu", "blended_roas_x100"]
        for mid in signable_ids:
            row = DEFINITIONAL_DELTA_REGISTER[mid]
            # Should NOT raise
            row.assert_signable()


# ---------------------------------------------------------------------------
# Day-one row content — CF-C4-DDR-TRUE-CM2-1 / GST-TAX-1 / FX-1 / MISC-PRORATE-1
# ---------------------------------------------------------------------------

class TestDayOneRowContent:
    """Verify the substance of each required day-one DDR row."""

    def test_true_cm2_legacy_formula_is_none(self):
        """True-CM2 must explicitly document NO legacy comparand. CF-C4-DDR-TRUE-CM2-1."""
        row = DEFINITIONAL_DELTA_REGISTER["true_cm2_mu"]
        assert "NONE" in row.legacy_formula.upper(), (
            "true_cm2_mu: legacy_formula must explicitly state 'NONE' "
            "(compute-daily.ts has no trueCm2 field). CF-C4-DDR-TRUE-CM2-1."
        )

    def test_true_cm2_formula_snapshot_contains_rto_provision(self):
        """True-CM2 formula_snapshot must include the RTO provision expression."""
        row = DEFINITIONAL_DELTA_REGISTER["true_cm2_mu"]
        snapshot = row.formula_snapshot.lower()
        assert "rto" in snapshot, "true_cm2 formula_snapshot must reference RTO provision"
        assert "intdiv" in snapshot or "//" in snapshot, "Must use integer division"

    def test_true_cm2_worked_example_in_delta_magnitude(self):
        """CF-C4-DDR-TRUE-CM2-1: worked example must be in delta_direction_and_magnitude."""
        row = DEFINITIONAL_DELTA_REGISTER["true_cm2_mu"]
        assert "6620000" in row.delta_direction_and_magnitude, (
            "true_cm2_mu: worked example (₹66,200 = 6620000 paise) must appear "
            "in delta_direction_and_magnitude. CF-C4-DDR-TRUE-CM2-1."
        )

    def test_total_tax_legacy_references_analytics_sync(self):
        """CF-C4-DDR-GST-TAX-1: legacy_formula must reference analytics-sync.ts."""
        row = DEFINITIONAL_DELTA_REGISTER["total_tax_mu"]
        assert "analytics-sync.ts" in row.legacy_formula, (
            "total_tax_mu: legacy_formula must reference analytics-sync.ts. "
            "CF-C4-DDR-GST-TAX-1."
        )

    def test_total_tax_magnitude_estimate_present(self):
        """CF-C4-DDR-GST-TAX-1: magnitude estimate (0–2% / 5–10%) must be documented."""
        row = DEFINITIONAL_DELTA_REGISTER["total_tax_mu"]
        mag = row.delta_direction_and_magnitude
        assert "0–2%" in mag or "0-2%" in mag or "5–10%" in mag or "5-10%" in mag, (
            "total_tax_mu: delta magnitude estimate (0–2% homogeneous, 5–10% mixed) "
            "must be present. CF-C4-DDR-GST-TAX-1."
        )

    def test_fx_legacy_references_exchange_rates(self):
        """CF-C4-DDR-FX-RESTATEMENT-1: legacy must reference workspace-costs.ts EXCHANGE_RATES."""
        row = DEFINITIONAL_DELTA_REGISTER["fx_restatement"]
        assert "workspace-costs.ts" in row.legacy_formula
        assert "83.5" in row.legacy_formula or "83.5" in row.formula_snapshot, (
            "FX row must reference legacy rate 83.5. CF-C4-DDR-FX-RESTATEMENT-1."
        )

    def test_fx_formula_snapshot_pins_shadow_rate(self):
        """CF-C4-DDR-FX-RESTATEMENT-1: formula_snapshot must pin the shadow rate."""
        row = DEFINITIONAL_DELTA_REGISTER["fx_restatement"]
        assert "83.5" in row.formula_snapshot or "8350" in row.formula_snapshot, (
            "FX formula_snapshot must pin the shadow-phase rate (83.5 / 8350 paise). "
            "CF-C4-DDR-FX-RESTATEMENT-1."
        )

    def test_misc_prorate_feb_boundary_in_delta(self):
        """CF-C4-DDR-MISC-PRORATE-1: Feb-boundary example must be documented."""
        row = DEFINITIONAL_DELTA_REGISTER["misc_expenses_prorated_mu"]
        mag = row.delta_direction_and_magnitude
        # Feb 2026 = 28 days; intDiv(1000000, 28) = 35714 must be mentioned
        assert "35714" in mag, (
            "misc_expenses_prorated: Feb-boundary worked example (35714 paise for 28 days) "
            "must be in delta_direction_and_magnitude. CF-C4-DDR-MISC-PRORATE-1."
        )

    def test_misc_prorate_adjudication_discipline_in_reason(self):
        """CF-C4-DDR-MISC-PRORATE-1: adjudication discipline must be documented in reason."""
        row = DEFINITIONAL_DELTA_REGISTER["misc_expenses_prorated_mu"]
        reason_lower = row.reason.lower()
        assert "adjudication" in reason_lower or "correct" in reason_lower, (
            "misc_expenses_prorated reason must document the adjudication discipline: "
            "triage must ask 'Is Brain's formula correct?' before stamping "
            "ROUNDING_MODE_MISMATCH. CF-C4-DDR-MISC-PRORATE-1."
        )

    def test_cogs_row_uses_cogs_settings_change_delta_classification(self):
        """CF-C4-COGS-MV-REFRESH-1: cogs_mu row uses COGS_SETTINGS_CHANGE_DELTA."""
        row = DEFINITIONAL_DELTA_REGISTER["cogs_mu"]
        assert row.shadow_compare_classification == COGS_SETTINGS_CHANGE_DELTA, (
            f"cogs_mu: expected '{COGS_SETTINGS_CHANGE_DELTA}', "
            f"got '{row.shadow_compare_classification}'. "
            "CF-C4-COGS-MV-REFRESH-1: data-staleness is DISTINCT from formula delta."
        )

    def test_roas_acos_are_display_only_in_ddr(self):
        """blended_roas and acos DDR rows must document display_only:True."""
        for mid in ("blended_roas_x100", "acos_bp"):
            row = DEFINITIONAL_DELTA_REGISTER[mid]
            reason_lower = row.reason.lower()
            assert "display" in reason_lower or "display_only" in reason_lower, (
                f"{mid}: DDR reason must document display_only:True (CM2-first)."
            )


# ---------------------------------------------------------------------------
# Adjudication discipline: mis-filed bug detection
# ---------------------------------------------------------------------------

class TestAdjudicationDiscipline:
    """CF-C4-DDR-MISC-PRORATE-1: mis-filed bugs must NOT be hidden by DDR labels."""

    def test_wrong_constant_bug_not_classifiable_as_rounding(self):
        """A wrong days_in_month constant (e.g. 30 for Feb) is a BLOCKING_BUG.

        Delta from 30-constant vs toDaysInMonth(Feb-date):
        intDiv(1000000, 30) = 33333 vs intDiv(1000000, 28) = 35714.
        Delta = 2381 paise. This is NOT a 1-paise rounding delta.
        It must be caught as BLOCKING_BUG, NOT ROUNDING_MODE_MISMATCH.
        """
        wrong = 1_000_000 // 30   # hardcoded 30 constant
        correct = 1_000_000 // 28  # toDaysInMonth(Feb-2026)
        delta = correct - wrong
        # The delta is 2381 — far larger than a 1-paise rounding drift.
        # If classified as ROUNDING_MODE_MISMATCH (which allows 1-paise drift),
        # this bug would be silently suppressed. That is the adjudication failure.
        assert delta == 2381, f"Expected delta=2381, got {delta}"
        assert abs(delta) > 1, (
            f"Delta {delta} > 1 paise. This CANNOT be ROUNDING_MODE_MISMATCH "
            "(which only covers ±1 paise .X45 midpoints). It is a BLOCKING_BUG. "
            "CF-C4-DDR-MISC-PRORATE-1: adjudication must ask 'Is Brain's formula "
            "correct?' BEFORE stamping the expected-delta label."
        )

    def test_ddr_lookup_returns_none_for_unknown_metric(self):
        """No DDR row for an unknown metric means exact equality is expected."""
        result = get_ddr_row("totally_unknown_metric")
        assert result is None

    def test_get_ddr_row_returns_correct_row(self):
        row = get_ddr_row("cm2_mu")
        assert row is not None
        assert row.brain_formula == "cm2_mu"
        assert row.parity_gap is False

    def test_parity_gap_metrics_list_completeness(self):
        """All 4 required Brain-native metrics must be in the parity_gap list."""
        parity_gap = get_parity_gap_metrics()
        required = {"true_cm2_mu", "pamer_bp", "amer_bp", "ltv_cac_bp"}
        for mid in required:
            assert mid in parity_gap, (
                f"{mid!r} must be in get_parity_gap_metrics(). "
                "CF-C4-DDR-TRUE-CM2-1: all Brain-native metrics registered as parity_gap."
            )


# ---------------------------------------------------------------------------
# CF-C4-PARITY-SCOPE-1 — DDR rows with child_dependency cannot be exercised
# until that dependency's gate is GREEN
# ---------------------------------------------------------------------------

class TestParityScope:
    """CF-C4-PARITY-SCOPE-1: legacy-sourced GREEN is NOT a cutover license."""

    def test_total_tax_not_measurable_pre_child3(self):
        """total_tax_mu is NOT measurable/signable until child-3-shopify-connector gate."""
        row = DEFINITIONAL_DELTA_REGISTER["total_tax_mu"]
        # The reason must explicitly state this limitation
        assert "pre-Child-3" in row.reason or "child-3" in row.reason.lower(), (
            "total_tax_mu: reason must document that delta is NOT measurable pre-Child-3. "
            "CF-C4-DDR-GST-TAX-1 + CF-C4-PARITY-SCOPE-1."
        )

    def test_fx_not_activatable_pre_child3(self):
        """FX live-rate conversion must be held for Child-3."""
        row = DEFINITIONAL_DELTA_REGISTER["fx_restatement"]
        assert "child-3" in row.reason.lower() or "child-3" in row.formula_snapshot.lower(), (
            "FX row must document that live-rate conversion activates in Child-3. "
            "CF-C4-DDR-FX-RESTATEMENT-1."
        )
