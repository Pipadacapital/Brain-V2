"""
test_harness.py — Integration tests for the parity harness engine.

Tests:
- Golden fixture set → PASS (zero divergences)
- Injected 1-paise drift → FIRST_DIVERGENCE fires with correct shape
- ROUNDING_MODE_MISMATCH classification for division-derived .X45 midpoint
- expected_definitional_delta hook present and unpopulated
- High-volume COGS accumulation fixture documented
"""

import pytest

from brain_metrics.convert import decimal_to_minor_units
from brain_metrics.parity.harness import run_harness
from brain_metrics.parity.taxonomy import (
    MismatchCategory,
    MismatchRecord,
    classify_mismatch,
    re_derive_legacy_via_brain_path,
    _decimal_to_minor_units_round_half_up,
    DIVISION_DERIVED_FIELDS,
    HarnessReport,
)


# ---------------------------------------------------------------------------
# 1. Golden fixture PASS test
# ---------------------------------------------------------------------------

class TestHarnessGoldenFixturePass:
    """The harness must PASS (zero BLOCKING_BUGs) on the golden fixture set."""

    def test_golden_fixtures_pass(self):
        report = run_harness()
        assert report.is_pass, (
            f"Golden fixture harness FAILED with {report.blocking_bug_count} BLOCKING_BUG(s). "
            f"First divergence: {report.first_divergence}. "
            f"Full report: {report.to_dict()}"
        )

    def test_golden_fixtures_zero_blocking_bugs(self):
        report = run_harness()
        assert report.blocking_bug_count == 0

    def test_golden_fixtures_checks_fields(self):
        report = run_harness()
        assert report.fields_checked > 0, "Harness must check at least one field"

    def test_report_has_required_fields(self):
        report = run_harness()
        d = report.to_dict()
        # CF-C2-RECON-TAXONOMY-1: rounding_mode_mismatches_count must be present
        assert "rounding_mode_mismatches_count" in d
        # expected_definitional_delta hook must be present (UNPOPULATED this child)
        assert "expected_definitional_delta" in d

    def test_golden_fixtures_rmm_classifier_fires(self):
        """Prove the RMM classification branch is genuinely reachable on the golden fixture set.

        CF-C2-RECON-TAXONOMY-1 F2 fix: the golden fixtures include 2 real .X45 midpoint
        cases (rmm-1: '357.145' miscExpensesProrated, rmm-2: '4642.845' cm3) with
        brain_expected_mu set to the ROUND_HALF_UP value, triggering the RMM classifier.
        This test proves the re-derivation rule is live (not dead code) in the golden run.
        """
        report = run_harness()
        assert report.rounding_mode_mismatches_count == 2, (
            f"Expected 2 ROUNDING_MODE_MISMATCH records from golden fixtures (rmm-1, rmm-2), "
            f"got {report.rounding_mode_mismatches_count}. "
            "The RMM re-derivation rule must fire on real .X45 midpoint fixtures. "
            "CF-C2-RECON-TAXONOMY-1 (F2 fix: tautology removed, ROUND_HALF_UP path is live)."
        )
        assert report.blocking_bug_count == 0, (
            "RMM fixtures must not be counted as BLOCKING_BUG — the anti-phantom-freeze "
            "purpose of CF-C2-RECON-TAXONOMY-1 is to prevent these from freezing live recon."
        )
        assert report.is_pass, "Harness must PASS (is_pass=True) when all mismatches are RMM."


# ---------------------------------------------------------------------------
# 2. Injected drift → FIRST_DIVERGENCE detection
# ---------------------------------------------------------------------------

class TestInjectedDriftFirstDivergence:
    """Inject a deliberate 1-paise drift and assert FIRST_DIVERGENCE fires."""

    def _build_minimal_fixtures(self):
        """A single clean fixture for clean/drift comparison."""
        return [
            {
                "id": "inject-test-1",
                "workspace_id": "ws_inject_test",
                "date": "2026-01-01",
                "field": "netSales",
                "amount": "1234.56",
                "subunit_multiplier": 100,
                "expected_minor_units": 123456,
            }
        ]

    def test_clean_fixture_passes(self):
        fixtures = self._build_minimal_fixtures()
        report = run_harness(fixtures=fixtures)
        assert report.is_pass
        assert report.blocking_bug_count == 0
        assert report.first_divergence is None

    def test_injected_drift_fires_first_divergence(self):
        fixtures = self._build_minimal_fixtures()
        # Inject a 1-paise drift: change legacy amount to give 123457 (wrong by 1)
        inject = {
            "id": "inject-test-1",
            "workspace_id": "ws_inject_test",
            "field": "netSales",
            "drifted_legacy": "1234.57",  # legacy is off by 1 paise
        }
        report = run_harness(fixtures=fixtures, inject_drift=inject)
        assert not report.is_pass, "Harness must FAIL when drift is injected"
        assert report.blocking_bug_count > 0
        assert report.first_divergence is not None

    def test_first_divergence_shape(self):
        """FIRST_DIVERGENCE must have the correct {workspace_id, date, field, delta} shape."""
        fixtures = self._build_minimal_fixtures()
        inject = {
            "id": "inject-test-1",
            "workspace_id": "ws_inject_test",
            "field": "netSales",
            "drifted_legacy": "1234.57",
        }
        report = run_harness(fixtures=fixtures, inject_drift=inject)
        fd = report.first_divergence
        assert fd is not None
        assert fd.workspace_id == "ws_inject_test"
        assert fd.date == "2026-01-01"
        assert fd.field == "netSales"
        # brain_mu = 123456, legacy (drifted) = 123457, delta = -1
        assert fd.delta != 0
        assert fd.category == MismatchCategory.BLOCKING_BUG

    def test_first_divergence_json_shape(self):
        """The JSON serialization must include the 6 required fields."""
        fixtures = self._build_minimal_fixtures()
        inject = {
            "id": "inject-test-1",
            "workspace_id": "ws_inject_test",
            "field": "netSales",
            "drifted_legacy": "1234.57",
        }
        report = run_harness(fixtures=fixtures, inject_drift=inject)
        d = report.to_dict()
        assert d["first_divergence"] is not None
        fd = d["first_divergence"]
        required_keys = {"workspace_id", "date", "field", "legacy_mu", "brain_mu", "delta", "category"}
        assert required_keys.issubset(set(fd.keys()))


# ---------------------------------------------------------------------------
# 3. ROUNDING_MODE_MISMATCH classification (CF-C2-RECON-TAXONOMY-1)
# ---------------------------------------------------------------------------
#
# Two-path model (F2 fix — tautology removed):
#
#   Path A — Brain canonical (ROUND_HALF_EVEN): decimal_to_minor_units()
#       Used by harness pre-check and classify_mismatch for legacy_mu.
#
#   Path B — Legacy Postgres (ROUND_HALF_UP): re_derive_legacy_via_brain_path()
#       Used by classify_mismatch to decide RMM vs BLOCKING_BUG.
#
# On a .X45 midpoint "4642.845" × 100 = 464284.5:
#   ROUND_HALF_EVEN → 464284   (Path A)
#   ROUND_HALF_UP   → 464285   (Path B)
#
# Scenario: brain_mu = 464285 (Brain DB stores ROUND_HALF_UP value from legacy import).
#   harness pre-check: 464284 ≠ 464285 → calls classify_mismatch
#   classify_mismatch: legacy_mu=464284, delta=+1, re_derive=464285 == brain_mu → RMM ✓
#
# Scenario: brain_mu = 464284 (Brain uses ROUND_HALF_EVEN throughout).
#   harness pre-check: 464284 == 464284 → PASS, no mismatch recorded.
#   (No phantom freeze: the 464284 Brain value matches harness expectation.)
#
# ---------------------------------------------------------------------------

class TestRoundingModeMismatch:
    """CF-C2-RECON-TAXONOMY-1: verify RMM re-derivation rule is genuinely reachable
    and correctly fail-safe. Tests prove both directions:
      (a) phantom .X45 RMM classified as ROUNDING_MODE_MISMATCH (not BLOCKING_BUG)
      (b) genuine value bug still classified as BLOCKING_BUG (fail-safe)
      (c) non-division-derived field never excused as RMM
    """

    # ------------------------------------------------------------------
    # Unit tests for the ROUND_HALF_UP helper
    # ------------------------------------------------------------------

    def test_round_half_up_helper_x45_midpoint(self):
        """_decimal_to_minor_units_round_half_up must round .X45 midpoints UP."""
        # 4642.845 × 100 = 464284.5 → ROUND_HALF_UP → 464285
        assert _decimal_to_minor_units_round_half_up("4642.845", 100) == 464285

    def test_round_half_up_helper_x35_midpoint(self):
        """Control: 4642.835 × 100 = 464283.5 → ROUND_HALF_UP → 464284."""
        assert _decimal_to_minor_units_round_half_up("4642.835", 100) == 464284

    def test_round_half_up_differs_from_round_half_even_on_x45(self):
        """The two paths diverge on the .X45 midpoint — making RMM reachable."""
        legacy_path = _decimal_to_minor_units_round_half_up("4642.845", 100)  # 464285
        brain_path = decimal_to_minor_units("4642.845", 100)                   # 464284
        assert legacy_path != brain_path, (
            "ROUND_HALF_UP and ROUND_HALF_EVEN must differ on .X45 midpoint; "
            "if they agree the RMM branch is unreachable."
        )
        assert legacy_path == 464285
        assert brain_path == 464284

    def test_round_half_up_agrees_with_round_half_even_on_exact(self):
        """On non-midpoint values both paths agree (control: no phantom divergence)."""
        exact = "4642.84"  # 4642.84 × 100 = 464284.0 — exact, no tie
        assert _decimal_to_minor_units_round_half_up(exact, 100) == decimal_to_minor_units(exact, 100) == 464284

    def test_round_half_up_helper_rejects_non_string(self):
        """ROUND_HALF_UP helper must enforce str input (consistent with convert.py)."""
        with pytest.raises(TypeError):
            _decimal_to_minor_units_round_half_up(4642.845, 100)  # type: ignore[arg-type]

    # ------------------------------------------------------------------
    # Unit tests for re_derive_legacy_via_brain_path
    # ------------------------------------------------------------------

    def test_re_derive_uses_round_half_up(self):
        """re_derive_legacy_via_brain_path must return ROUND_HALF_UP of the stored decimal."""
        assert re_derive_legacy_via_brain_path("4642.845", 100) == 464285

    def test_re_derive_differs_from_decimal_to_minor_units_on_x45(self):
        """re_derive (ROUND_HALF_UP) must differ from decimal_to_minor_units (ROUND_HALF_EVEN)
        on a .X45 midpoint. If they agree, the RMM branch is unreachable — the tautology
        that F2 found and this fix corrects."""
        rdmu = re_derive_legacy_via_brain_path("4642.845", 100)   # ROUND_HALF_UP → 464285
        dtmu = decimal_to_minor_units("4642.845", 100)             # ROUND_HALF_EVEN → 464284
        assert rdmu != dtmu, (
            "re_derive_legacy_via_brain_path must be DISTINCT from decimal_to_minor_units. "
            "If they return the same value on .X45 midpoints, the RMM branch "
            "in classify_mismatch can never fire (F2 tautology)."
        )

    # ------------------------------------------------------------------
    # Direction 1: phantom .X45 divergence → ROUNDING_MODE_MISMATCH
    # ------------------------------------------------------------------

    def test_x45_midpoint_division_derived_classified_rmm(self):
        """
        Core anti-phantom-freeze test (CF-C2-RECON-TAXONOMY-1).

        Scenario: legacy stored "4642.845" in a Decimal column.
        During import, Brain stored the value using the legacy ROUND_HALF_UP path
        → brain_mu = 464285.
        Harness canonical path (ROUND_HALF_EVEN): legacy_mu = 464284 ≠ 464285.
        re_derive (ROUND_HALF_UP) = 464285 == brain_mu.

        Expected: ROUNDING_MODE_MISMATCH (NOT BLOCKING_BUG).
        Without the F2 fix, the old re_derive used ROUND_HALF_EVEN → returned 464284
        ≠ 464285 → BLOCKING_BUG (phantom freeze). The fix makes re_derive use
        ROUND_HALF_UP so 464285 == brain_mu → correctly classified as RMM.
        """
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="miscExpensesProrated",
            legacy_stored_decimal="4642.845",
            brain_mu=464285,   # ROUND_HALF_UP result: Brain stored legacy-path value
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.ROUNDING_MODE_MISMATCH, (
            f"Expected ROUNDING_MODE_MISMATCH but got {record.category}. "
            "The .X45 phantom delta must NOT freeze the live reconciliation. "
            "CF-C2-RECON-TAXONOMY-1."
        )
        assert record.legacy_mu == 464284   # ROUND_HALF_EVEN (Brain canonical path)
        assert record.brain_mu == 464285    # ROUND_HALF_UP (legacy path)
        assert record.delta == 1

    def test_x45_midpoint_cm3_classified_rmm(self):
        """cm3 field (also in DIVISION_DERIVED_FIELDS) classifies RMM on .X45 midpoint."""
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="cm3",
            legacy_stored_decimal="4642.845",
            brain_mu=464285,
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.ROUNDING_MODE_MISMATCH

    def test_negative_x45_midpoint_classified_rmm(self):
        """Negative .X45 midpoint (refund scenario) also classifies RMM, not BLOCKING_BUG."""
        # "-4642.845" × 100 = -464284.5
        # ROUND_HALF_UP on negative (rounds away from zero): -464285
        # ROUND_HALF_EVEN: -464284 (nearest even)
        re_derive_result = re_derive_legacy_via_brain_path("-4642.845", 100)
        brain_canonical = decimal_to_minor_units("-4642.845", 100)
        assert re_derive_result != brain_canonical, (
            "Negative .X45 midpoint must also diverge between ROUND_HALF_UP and ROUND_HALF_EVEN."
        )
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="miscExpensesProrated",
            legacy_stored_decimal="-4642.845",
            brain_mu=re_derive_result,   # ROUND_HALF_UP value
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.ROUNDING_MODE_MISMATCH

    def test_rmm_note_contains_diagnostic_info(self):
        """ROUNDING_MODE_MISMATCH record note must contain enough info to diagnose."""
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="miscExpensesProrated",
            legacy_stored_decimal="4642.845",
            brain_mu=464285,
            subunit_multiplier=100,
        )
        assert "ROUND_HALF_UP" in record.note
        assert "CF-C2-RECON-TAXONOMY-1" in record.note

    # ------------------------------------------------------------------
    # Direction 2: genuine value bug → BLOCKING_BUG (fail-safe)
    # ------------------------------------------------------------------

    def test_genuine_bug_still_blocking_bug(self):
        """
        Fail-safe test: a genuine value error on a division-derived field must
        still classify as BLOCKING_BUG (re_derive ≠ brain_mu → not explained by RMM).

        brain_mu = 464290 (wrong by +6; unrelated to rounding).
        re_derive (ROUND_HALF_UP) = 464285 ≠ 464290 → BLOCKING_BUG.
        """
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="miscExpensesProrated",
            legacy_stored_decimal="4642.845",
            brain_mu=464290,   # genuine bug: off by 6, not explained by rounding
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.BLOCKING_BUG, (
            f"Expected BLOCKING_BUG but got {record.category}. "
            "A real arithmetic bug must never be suppressed into RMM. "
            "CF-C2-RECON-TAXONOMY-1 fail-safe."
        )

    def test_off_by_two_not_rmm(self):
        """A delta of 2 on a .X45 midpoint cannot be a rounding artifact (max rounding delta = 1)."""
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="cm3",
            legacy_stored_decimal="4642.845",
            brain_mu=464286,   # off by 2 from ROUND_HALF_EVEN result (464284)
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.BLOCKING_BUG, (
            "delta=2 cannot be a pure rounding-mode artifact. Must be BLOCKING_BUG."
        )

    def test_non_midpoint_division_derived_field_is_blocking_bug(self):
        """For a non-.X45 value (exact, no rounding tie), re_derive == legacy_mu
        and both == brain_mu (if correct). A genuine error is BLOCKING_BUG."""
        # "4642.84" × 100 = 464284.0 (exact — both RHU and RHE give 464284)
        # If Brain has 464286 (bug), re_derive = 464284 ≠ 464286 → BLOCKING_BUG
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="miscExpensesProrated",
            legacy_stored_decimal="4642.84",
            brain_mu=464286,
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.BLOCKING_BUG

    # ------------------------------------------------------------------
    # Direction 3: non-division-derived field is NEVER excused as RMM
    # ------------------------------------------------------------------

    def test_non_division_field_x45_is_blocking_bug(self):
        """
        Even if the value is a .X45 midpoint, a non-division-derived field
        (e.g. "netSales") must classify as BLOCKING_BUG, never ROUNDING_MODE_MISMATCH.
        The RMM excusal applies ONLY to DIVISION_DERIVED_FIELDS.
        """
        record = classify_mismatch(
            workspace_id="ws_rmm_test",
            date="2026-01-15",
            field="netSales",               # NOT in DIVISION_DERIVED_FIELDS
            legacy_stored_decimal="4642.845",
            brain_mu=464285,               # same brain_mu that gives RMM on a division field
            subunit_multiplier=100,
        )
        assert record.category == MismatchCategory.BLOCKING_BUG, (
            "netSales is not a division-derived field. The RMM excusal must not apply. "
            "This ensures non-division fields are never silently excused."
        )
        assert "netSales" not in DIVISION_DERIVED_FIELDS

    def test_direct_money_column_not_rmm_excused(self):
        """Direct money columns (not in DIVISION_DERIVED_FIELDS) are always BLOCKING_BUG
        on mismatch, even with a .X45 midpoint value."""
        for direct_field in ["netSales", "grossSales", "discounts", "shipping"]:
            record = classify_mismatch(
                workspace_id="ws_rmm_test",
                date="2026-01-15",
                field=direct_field,
                legacy_stored_decimal="4642.845",
                brain_mu=464285,
                subunit_multiplier=100,
            )
            assert record.category == MismatchCategory.BLOCKING_BUG, (
                f"Field '{direct_field}' must not be RMM-excused (not division-derived)."
            )

    def test_division_derived_fields_enumeration(self):
        """Confirm the DIVISION_DERIVED_FIELDS enumeration is present and non-empty."""
        assert "miscExpensesProrated" in DIVISION_DERIVED_FIELDS
        assert "cm3" in DIVISION_DERIVED_FIELDS
        assert len(DIVISION_DERIVED_FIELDS) >= 2

    # ------------------------------------------------------------------
    # HarnessReport accumulator and golden fixture tests
    # ------------------------------------------------------------------

    def test_rmm_fixture_passes_in_harness(self):
        """The golden fixture harness must pass (zero blocking bugs)."""
        report = run_harness()
        assert report.is_pass

    def test_rounding_mode_mismatch_category_in_report(self):
        """HarnessReport accumulator correctly counts RMM records (not BLOCKING_BUG)."""
        report = HarnessReport()
        record = MismatchRecord(
            workspace_id="ws_test",
            date="2026-01-01",
            field="miscExpensesProrated",
            legacy_mu=464284,
            brain_mu=464285,
            delta=1,
            category=MismatchCategory.ROUNDING_MODE_MISMATCH,
        )
        report.record_mismatch(record)
        assert report.rounding_mode_mismatches_count == 1
        assert report.blocking_bug_count == 0
        assert report.is_pass  # ROUNDING_MODE_MISMATCH does NOT block cutover

    def test_blocking_bug_blocks_pass(self):
        """A BLOCKING_BUG mismatch must cause is_pass == False."""
        report = HarnessReport()
        record = MismatchRecord(
            workspace_id="ws_test",
            date="2026-01-01",
            field="netSales",
            legacy_mu=123456,
            brain_mu=123457,
            delta=1,
            category=MismatchCategory.BLOCKING_BUG,
        )
        report.record_mismatch(record)
        assert report.blocking_bug_count == 1
        assert not report.is_pass

    def test_rmm_classify_via_run_harness_injection(self):
        """End-to-end test: inject a .X45 midpoint for a division-derived field
        and confirm it is classified ROUNDING_MODE_MISMATCH via run_harness.

        Supplies a fixture with field='miscExpensesProrated', amount="4642.845",
        brain_expected_mu=464285 (ROUND_HALF_UP). The harness detects
        legacy_mu(ROUND_HALF_EVEN=464284) != brain_mu(464285) → classify_mismatch
        → re_derive(ROUND_HALF_UP)=464285 == brain_mu → ROUNDING_MODE_MISMATCH.
        """
        fixtures = [
            {
                "id": "rmm-end-to-end-1",
                "workspace_id": "ws_rmm_e2e",
                "date": "2026-01-15",
                "field": "miscExpensesProrated",
                "amount": "4642.845",
                "subunit_multiplier": 100,
                "expected_minor_units": 464285,   # ROUND_HALF_UP value — triggers RMM
            }
        ]
        report = run_harness(fixtures=fixtures)
        assert report.rounding_mode_mismatches_count == 1, (
            f"Expected 1 ROUNDING_MODE_MISMATCH, got {report.rounding_mode_mismatches_count}. "
            f"Blocking bugs: {report.blocking_bug_count}. "
            "The .X45 phantom delta on a division-derived field must not freeze live recon."
        )
        assert report.blocking_bug_count == 0, (
            "ROUNDING_MODE_MISMATCH must not be counted as BLOCKING_BUG."
        )
        assert report.is_pass, (
            "Harness must PASS (is_pass=True) when only RMM mismatches are present."
        )

    def test_genuine_bug_via_run_harness_injection(self):
        """End-to-end fail-safe: inject a genuine bug on a division-derived field
        and confirm it is classified BLOCKING_BUG (not silently excused as RMM).

        brain_mu=464290 is +6 from ROUND_HALF_EVEN and +5 from ROUND_HALF_UP —
        re_derive(ROUND_HALF_UP)=464285 ≠ 464290 → BLOCKING_BUG.
        """
        fixtures = [
            {
                "id": "blocking-bug-e2e-1",
                "workspace_id": "ws_bug_e2e",
                "date": "2026-01-15",
                "field": "miscExpensesProrated",
                "amount": "4642.845",
                "subunit_multiplier": 100,
                "expected_minor_units": 464290,   # genuine bug value
            }
        ]
        report = run_harness(fixtures=fixtures)
        assert report.blocking_bug_count == 1, (
            "A genuine arithmetic bug must be caught as BLOCKING_BUG even on a "
            "division-derived field. The RMM excusal must never suppress a real error."
        )
        assert report.rounding_mode_mismatches_count == 0
        assert not report.is_pass

    def test_non_division_field_via_run_harness_injection(self):
        """End-to-end: inject a .X45 midpoint for netSales (non-division field)
        and confirm it is BLOCKING_BUG, not RMM-excused."""
        fixtures = [
            {
                "id": "non-division-e2e-1",
                "workspace_id": "ws_non_div_e2e",
                "date": "2026-01-15",
                "field": "netSales",             # NOT a division-derived field
                "amount": "4642.845",
                "subunit_multiplier": 100,
                "expected_minor_units": 464285,  # same brain_mu that gives RMM on division field
            }
        ]
        report = run_harness(fixtures=fixtures)
        assert report.blocking_bug_count == 1, (
            "netSales is not a division-derived field. Its .X45 delta must be "
            "BLOCKING_BUG, never silently excused as ROUNDING_MODE_MISMATCH."
        )
        assert report.rounding_mode_mismatches_count == 0
        assert not report.is_pass


# ---------------------------------------------------------------------------
# 4. expected_definitional_delta hook — present but unpopulated
# ---------------------------------------------------------------------------

class TestExpectedDefinitionalDeltaHook:
    """CF-C2-SCOPE-DEFER-1: hook present, unpopulated. Child 4 populates."""

    def test_hook_present_in_report(self):
        report = run_harness()
        assert hasattr(report, "expected_definitional_delta")

    def test_hook_unpopulated(self):
        """The hook must be None/null this child (Child 4 populates)."""
        report = run_harness()
        assert report.expected_definitional_delta is None, (
            "expected_definitional_delta hook must be unpopulated this child. "
            "Child 4 wires the Definitional-Delta Register. CF-C2-SCOPE-DEFER-1."
        )

    def test_hook_in_json_output(self):
        report = run_harness()
        d = report.to_dict()
        assert "expected_definitional_delta" in d
        assert d["expected_definitional_delta"] is None


# ---------------------------------------------------------------------------
# 5. High-volume COGS accumulation (CF-C2-FLOAT-COGS-1)
# ---------------------------------------------------------------------------

class TestHighVolumeCogsAccumulation:
    """Verify the Brain per-item integer path is exact (CF-C2-FLOAT-COGS-1)."""

    def test_per_item_conversion_exact(self):
        # Each coq="123.4567" item converts to 12346 paise (ROUND_HALF_EVEN)
        per_item = decimal_to_minor_units("123.4567", 100)
        assert per_item == 12346

    def test_brain_sum_exact(self):
        # 10001 items × 12346 paise = 123472346 paise (Brain path)
        per_item = decimal_to_minor_units("123.4567", 100)
        brain_total = per_item * 10001
        assert brain_total == 123472346

    def test_brain_total_differs_from_float_accumulation(self):
        """Brain's integer path gives a different total than float accumulation.
        This is the KNOWN artifact documented in CF-C2-FLOAT-COGS-1.
        Brain is CORRECT; float accumulation is the legacy anti-pattern.
        """
        import math
        float_total = float("123.4567") * 100 * 10001
        float_rounded = math.floor(float_total + 0.5)

        per_item = decimal_to_minor_units("123.4567", 100)
        brain_total = per_item * 10001

        # They differ because Brain rounds per-item; float accumulates fractional paise.
        # This is the documented CF-C2-FLOAT-COGS-1 artifact, NOT a Brain bug.
        assert brain_total != float_rounded
        assert brain_total == 123472346
        assert float_rounded == 123469046

    def test_golden_cogs_fixture_is_documented(self):
        """The golden fixture file contains the COGS accumulation fixture."""
        import json
        import pathlib
        fixture_path = pathlib.Path(__file__).parent.parent / "brain_metrics" / "parity" / "fixtures" / "golden_fixtures.json"
        data = json.loads(fixture_path.read_text())
        assert "high_volume_cogs" in data
        cogs = data["high_volume_cogs"]
        assert len(cogs) > 0
        assert cogs[0]["n_items"] == 10001
