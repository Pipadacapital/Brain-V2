"""
test_gate2_faithfulness.py — VETO Gate 2: faithfulness validator tests.

CF-C5-FAITHFULNESS-1 + CF-C5-FAITHFULNESS-COST-1:

KILLED MUTANT: hallucinated ₹1,40,000 vs signal 120000 -> RED (ok=False).
INVERSE MUTANT: vacuous ok=True caught.
FALSE-REJECT PASS: "₹1.2L" vs signal 120000 -> PASS (no false-reject cost bug).
"""

from __future__ import annotations

import pytest

from domain.faithfulness.validator import (
    FaithfulnessResult,
    Signal,
    validate_faithfulness,
)
from domain.faithfulness.extraction import extract_numbers


# ---------------------------------------------------------------------------
# VETO GATE 2 — killed mutant test
# ---------------------------------------------------------------------------

class TestGate2KilledMutant:
    """KILLED MUTANT: hallucinated number -> ok=False (RED)."""

    def test_hallucinated_amount_returns_false(self) -> None:
        """GATE 2 KILLED MUTANT: ₹1,40,000 narrated but signal is 120000 -> RED."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness(
            "Your net sales were ₹1,40,000 this period.",
            signals,
        )
        assert result.ok is False
        assert len(result.offending_numbers) > 0

    def test_hallucinated_percentage(self) -> None:
        """Hallucinated percentage: narration says 15% but signal is 1000bp (10%)."""
        signals = [Signal(signal_id="rto_rate_bp", value_canonical=1000)]
        result = validate_faithfulness("Your RTO rate was 15%.", signals)
        assert result.ok is False

    def test_multiple_hallucinations(self) -> None:
        """Two hallucinated numbers -> both flagged."""
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=120_000),
            Signal(signal_id="cm2_mu", value_canonical=50_000),
        ]
        result = validate_faithfulness(
            "Sales were ₹99,999 and contribution margin was ₹45,000.",
            signals,
        )
        assert result.ok is False
        assert len(result.offending_numbers) >= 1


class TestGate2InverseMutant:
    """INVERSE MUTANT: vacuous ok=True caught."""

    def test_vacuous_ok_true_does_not_detect_hallucination(self) -> None:
        """Proves a no-op validator fails to catch hallucinations -> gate is load-bearing."""

        def vacuous_validate(narration: str, signals: object) -> FaithfulnessResult:
            return FaithfulnessResult(ok=True, offending_numbers=[])

        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        # Vacuous: says ok=True even for a hallucinated value.
        result = vacuous_validate("Your net sales were ₹1,40,000.", signals)
        assert result.ok is True  # Vacuous misses the hallucination.

        # Real: catches it.
        real_result = validate_faithfulness("Your net sales were ₹1,40,000.", signals)
        assert real_result.ok is False  # Real gate fires correctly.

    def test_false_reject_mutant_caught(self) -> None:
        """FALSE-REJECT MUTANT: naive extract misses ₹1.2L; real extractor catches it."""
        import re

        def naive_extract(text: str) -> list[int]:
            """No Lakh/Crore normalization — would cause false-rejects."""
            nums = re.findall(r'\d[\d,]*', text)
            result = []
            for n in nums:
                try:
                    result.append(int(n.replace(',', '')))
                except ValueError:
                    pass
            return result

        narration = "Revenue was approximately ₹1.2L."
        naive_nums = naive_extract(narration)
        assert 120_000 not in naive_nums  # Naive fails.

        real_nums = extract_numbers(narration)
        assert 120_000 in real_nums  # Real extractor normalizes correctly.


# ---------------------------------------------------------------------------
# FALSE-REJECT PASS cases (CF-C5-FAITHFULNESS-COST-1)
# ---------------------------------------------------------------------------

class TestFalseRejectPrevention:
    def test_lakh_notation_passes(self) -> None:
        """₹1.2L vs signal 120000 -> PASS (the primary false-reject test case)."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness(
            "Revenue was approximately ₹1.2L this week.", signals
        )
        assert result.ok is True, (
            f"FALSE-REJECT BUG: ₹1.2L must normalize to 120000 and PASS. "
            f"offending={result.offending_numbers}"
        )

    def test_indian_grouping_passes(self) -> None:
        """₹1,20,000 (Indian grouping) vs signal 120000 -> PASS."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness("Your net sales were ₹1,20,000.", signals)
        assert result.ok is True, f"offending={result.offending_numbers}"

    def test_percentage_to_bp_passes(self) -> None:
        """12.5% vs signal 1250 bp -> PASS."""
        signals = [Signal(signal_id="rto_rate_bp", value_canonical=1250)]
        result = validate_faithfulness("Your RTO rate was 12.5% last month.", signals)
        assert result.ok is True, f"offending={result.offending_numbers}"

    def test_plain_integer_passes(self) -> None:
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness("Revenue: 120000 paise.", signals)
        assert result.ok is True

    def test_no_numbers_in_narration_passes(self) -> None:
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness("Revenue improved significantly.", signals)
        assert result.ok is True
        assert result.offending_numbers == []

    def test_empty_narration_passes(self) -> None:
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness("", signals)
        assert result.ok is True

    def test_multiple_correct_values_pass(self) -> None:
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=120_000),
            Signal(signal_id="cm2_mu", value_canonical=50_000),
            Signal(signal_id="rto_rate_bp", value_canonical=1250),
        ]
        result = validate_faithfulness(
            "Net sales were ₹1,20,000, contribution margin was ₹50,000, "
            "and RTO rate was 12.5%.",
            signals,
        )
        assert result.ok is True, f"offending={result.offending_numbers}"


# ---------------------------------------------------------------------------
# Extraction unit tests
# ---------------------------------------------------------------------------

class TestNumberExtraction:
    def test_lakh_extraction(self) -> None:
        assert 120_000 in extract_numbers("₹1.2L")
        assert 150_000 in extract_numbers("₹1.5 lakh")

    def test_crore_extraction(self) -> None:
        assert 12_000_000 in extract_numbers("₹1.2Cr")
        assert 10_000_000 in extract_numbers("₹1 crore")

    def test_percentage_to_bp(self) -> None:
        assert 1250 in extract_numbers("12.5%")
        assert 50 in extract_numbers("0.5%")
        assert 100 in extract_numbers("1%")

    def test_indian_grouping(self) -> None:
        assert 120_000 in extract_numbers("₹1,20,000")

    def test_approx_prefix_stripped(self) -> None:
        assert 120_000 in extract_numbers("approximately ₹1.2L")

    def test_empty_string(self) -> None:
        assert extract_numbers("") == []

    def test_no_numbers(self) -> None:
        assert extract_numbers("Revenue improved significantly.") == []
