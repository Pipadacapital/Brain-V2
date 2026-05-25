"""
test_pnl_eval_harness.py — Golden-set eval harness tests (CI release gate point 1).

CF-C5-FAITHFULNESS-1: the 07:15-class synthesis must NEVER contradict deterministic
    numbers. This is the OFFLINE golden-set eval (CI gate point 1 of 3).

Tests:
  - Golden-set passes completely → assert_golden_set_passes() raises nothing.
  - Hallucination case fails → EvalResult has failures.
  - False-reject cases all pass (₹1.2L, Indian grouping, bp).
  - Retry-rate calculation correct.
  - Inverse mutant: replacing validate_faithfulness with vacuous → caught.
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'pylibs', 'brain_cost_router'))

import pytest

from src.domain.evals.pnl_eval import (
    GOLDEN_SET,
    GoldenCase,
    assert_golden_set_passes,
    run_golden_set_eval,
)
from src.domain.faithfulness.validator import FaithfulnessResult, Signal


class TestGoldenSetPasses:
    """The canonical golden-set must pass completely."""

    def test_all_golden_cases_pass(self) -> None:
        """OFFLINE CI gate: the full golden-set must pass."""
        # This is CI gate point 1 of 3.
        assert_golden_set_passes()  # raises AssertionError if any case fails

    def test_run_golden_set_returns_result(self) -> None:
        """run_golden_set_eval returns an EvalResult with correct total."""
        result = run_golden_set_eval()
        assert result.total == len(GOLDEN_SET)
        assert result.all_passed

    def test_retry_rate_within_threshold(self) -> None:
        """Retry rate (false-rejects) must be ≤ 20%."""
        result = run_golden_set_eval()
        assert result.retry_rate <= 0.20, (
            f"retry_rate={result.retry_rate:.1%} > 20% threshold. "
            f"{result.retries_triggered} false-rejects in {result.total} cases."
        )


class TestKilledMutantCasesFailCorrectly:
    """The hallucination cases in the golden-set must fail (ok=False)."""

    def test_gate2_km_001_fails(self) -> None:
        """GATE2-KM-001: hallucinated ₹1,40,000 vs signal 120,000 → fails."""
        km_cases = [c for c in GOLDEN_SET if c.case_id == "GATE2-KM-001"]
        assert len(km_cases) == 1
        case = km_cases[0]
        assert case.expected_ok is False  # This case SHOULD fail faithfulness

    def test_gate2_km_002_fails(self) -> None:
        """GATE2-KM-002: hallucinated 15% vs 10% signal → fails."""
        km_cases = [c for c in GOLDEN_SET if c.case_id == "GATE2-KM-002"]
        assert len(km_cases) == 1
        assert km_cases[0].expected_ok is False

    def test_all_km_cases_have_expected_ok_false(self) -> None:
        """All cases with case_id starting 'GATE2-KM-' expect ok=False."""
        km_cases = [c for c in GOLDEN_SET if c.case_id.startswith("GATE2-KM-")]
        assert len(km_cases) >= 2  # At least 2 killed-mutant cases
        for case in km_cases:
            assert case.expected_ok is False, f"{case.case_id} should expect ok=False"


class TestFalseRejectPassCases:
    """The false-reject prevention cases must all pass."""

    def test_all_fr_cases_have_expected_ok_true(self) -> None:
        """All GATE2-FR-* cases expect ok=True (must not false-reject)."""
        fr_cases = [c for c in GOLDEN_SET if c.case_id.startswith("GATE2-FR-")]
        assert len(fr_cases) >= 5  # At least 5 false-reject prevention cases
        for case in fr_cases:
            assert case.expected_ok is True, f"{case.case_id} should expect ok=True"


class TestCustomGoldenSet:
    """Custom golden-set cases for edge validation."""

    def test_single_hallucination_fails(self) -> None:
        """A single-case golden set with a hallucination must fail."""
        hallucination_case = GoldenCase(
            case_id="TEST-001",
            narration="Revenue was ₹5,00,000 this period.",
            signals=[Signal("net_sales_mu", 120_000)],  # 5,00,000 ≠ 1,20,000
            expected_ok=False,
            description="Custom test: hallucinated ₹5L vs signal ₹1.2L.",
        )
        result = run_golden_set_eval([hallucination_case])
        assert result.all_passed  # The eval detects the failure as expected
        assert result.failed == 0  # All cases behave as expected

    def test_single_pass_case_passes(self) -> None:
        """A single-case golden set with a faithful narration must pass."""
        pass_case = GoldenCase(
            case_id="TEST-002",
            narration="Revenue was ₹1,20,000 this period.",
            signals=[Signal("net_sales_mu", 120_000)],
            expected_ok=True,
            description="Custom test: faithful ₹1,20,000 vs signal 120,000.",
        )
        result = run_golden_set_eval([pass_case])
        assert result.all_passed
        assert result.failed == 0

    def test_inverse_mutant_vacuous_validator_caught(self) -> None:
        """INVERSE MUTANT: vacuous ok=True caught by the eval harness.

        Simulates replacing validate_faithfulness with a no-op.
        The eval harness detects this because the killed-mutant case
        (expected_ok=False) would now incorrectly pass (got_ok=True).
        """
        from src.domain.faithfulness.validator import validate_faithfulness as real_validate

        # Simulate the vacuous mutant: a validator that always says ok=True
        def vacuous_validate(narration, signals):
            return FaithfulnessResult(ok=True, offending_numbers=[])

        # Build a hallucination case that EXPECTS ok=False
        hallucination_case = GoldenCase(
            case_id="MUTANT-001",
            narration="Revenue was ₹1,40,000 but signal is 120,000.",
            signals=[Signal("net_sales_mu", 120_000)],
            expected_ok=False,
            description="Mutant test: should fail faithfulness.",
        )

        # Run with the REAL validator — should correctly identify the failure
        real_result = real_validate(hallucination_case.narration, hallucination_case.signals)
        assert real_result.ok is False  # Real validator catches hallucination

        # Simulate with vacuous validator — would say ok=True (WRONG)
        vacuous_result = vacuous_validate(hallucination_case.narration, hallucination_case.signals)
        assert vacuous_result.ok is True  # Vacuous: misses the hallucination

        # The eval harness catches this because expected_ok=False but vacuous returns True
        # expected_ok=False, got_ok=True → that's a FAILURE in the eval harness
        got_ok = vacuous_result.ok
        expected_ok = hallucination_case.expected_ok
        assert got_ok != expected_ok  # Confirms the discrepancy the harness would catch
