"""
test_gate2_faithfulness.py — VETO Gate 2: faithfulness validator tests.

CF-C5-FAITHFULNESS-1 + CF-C5-FAITHFULNESS-COST-1:

B3 LIVE-RUN DEFECT (CF-C5-FAITHFULNESS-1):
  The original validator ran extract_numbers() on the full raw JSON returned
  by the model (InsightItem[] schema).  This captured structural integers that
  are NOT metric data claims:
    - confidence: 95/88/92  → JSON schema field (0-100 self-assessment)
    - 2000, 1500 bp          → benchmark thresholds the prompt tells the model to cite
    - 2026, 29, 5, 9, 12    → calendar date tokens written in detail/summary fields
  None of these are fabricated metric values; the gate was rejecting real outputs.

Fix (in validator.py):
  - Parse the JSON; validate only free-text claim fields (title/summary/detail/rationale).
  - Extend the allowed set with: confidence 0-100, benchmark bp values, calendar
    date tokens (years 2020-2030, ordinals 1-31).
  - Hallucination guard PRESERVED: a fabricated metric value in any narrative field
    still produces ok=False.

Test coverage:
  NEGATIVE (hallucinated metric MUST fail): TestGate2KilledMutant + B3-specific JSON.
  POSITIVE (structural numbers in faithful brief MUST pass): TestB3LiveRunFix.
  FALSE-REJECT PASS (₹1.2L notation): TestFalseRejectPrevention.
  INVERSE MUTANT: TestGate2InverseMutant.
"""

from __future__ import annotations

import json

import pytest

from domain.faithfulness.validator import (
    FaithfulnessResult,
    Signal,
    _extract_narrative_text,
    validate_faithfulness,
)
from domain.faithfulness.extraction import extract_numbers


# ---------------------------------------------------------------------------
# VETO GATE 2 — killed mutant tests (negative — hallucination MUST fail)
# ---------------------------------------------------------------------------

class TestGate2KilledMutant:
    """KILLED MUTANT: hallucinated number -> ok=False (RED)."""

    def test_hallucinated_amount_plain_text_returns_false(self) -> None:
        """GATE 2 KILLED MUTANT: ₹1,40,000 narrated but signal is 120000 -> RED.
        Plain text (non-JSON) path — falls back to full-string validation.
        """
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        result = validate_faithfulness(
            "Your net sales were ₹1,40,000 this period.",
            signals,
        )
        assert result.ok is False
        assert len(result.offending_numbers) > 0

    def test_hallucinated_amount_in_json_narrative_fails(self) -> None:
        """GATE 2 B3 FIX: hallucinated metric in JSON narrative field -> ok=False.

        Signal says net_sales is 120000 (₹1.2L); model writes ₹1.4L in summary.
        The fix must still catch this: 140000 is not in the signal set.
        """
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        # Fabricated value (₹1.4L = 140000) in the summary field
        bad_json = json.dumps({
            "insights": [{
                "title": "Net Sales Below Expectation",
                "severity": "warning",
                "confidence": 88,
                "summary": "Net sales reached ₹1.4L, missing the ₹1.2L target.",
                "detail": "Sales on 2026-05-19 totalled ₹1.4L.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "net_sales_mu",
                    "rationale": "Investigate the gap between actual and reported sales.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(bad_json, signals)
        assert result.ok is False, (
            "VETO gate must fire: ₹1.4L (140000) is not a signal value. "
            f"offending={result.offending_numbers}"
        )

    def test_hallucinated_percentage_in_json_fails(self) -> None:
        """Hallucinated percentage in JSON narrative: signal is 1000bp (10%), model says 17%.

        Note: 15% (1500 bp) is in _BENCHMARK_BP_ALLOWED (it is a CM2 warning
        threshold the prompt explicitly tells the model to cite).  We use 17%
        (1700 bp) which is NOT a signal value AND NOT a benchmark threshold —
        the gate must still fire for this fabricated value.
        """
        signals = [Signal(signal_id="rto_rate_bp", value_canonical=1000)]
        bad_json = json.dumps({
            "insights": [{
                "title": "RTO Rate Elevated",
                "severity": "warning",
                "confidence": 90,
                "summary": "Your RTO rate was 17% last month.",
                "detail": "The 17% RTO rate is higher than the reported signal.",
                "recommendation": {
                    "action": "MONITOR_RTO",
                    "entity_id": "rto_rate_bp",
                    "rationale": "Check 17% calculation.",
                },
                "metrics": ["rto_rate_bp"],
            }]
        })
        result = validate_faithfulness(bad_json, signals)
        assert result.ok is False, (
            "17% -> 1700 bp is NOT a signal value or a benchmark threshold; "
            f"gate must fire. offending={result.offending_numbers}"
        )

    def test_hallucinated_percentage_plain_text_fails(self) -> None:
        """Plain-text path: fabricated 17% when signal is 1000bp (10%) must fail.

        17% → 1700 bp is NOT a signal value AND NOT a benchmark threshold from
        _BENCHMARKS_BLOCK (benchmark thresholds are 15%, 25%, 40%, etc.).
        _BENCHMARK_BP_ALLOWED is applied on the plain-text fallback path, but
        1700 is not in that set — the gate must still fire for invented data.

        Note: 15% (1500 bp) IS now whitelisted as a benchmark threshold
        (_BENCHMARK_BP_ALLOWED: CM2% warning <15%).  Use 17% to prove the VETO
        still fires for non-benchmark invented values on the fallback path.
        """
        signals = [Signal(signal_id="rto_rate_bp", value_canonical=1000)]
        result = validate_faithfulness("Your RTO rate was 17% last month.", signals)
        assert result.ok is False, (
            "Plain-text fallback: 17% → 1700 bp is not a signal (1000 bp) or "
            "a benchmark threshold; gate must fire. "
            f"offending={result.offending_numbers}"
        )

    def test_hallucinated_lakh_in_json_narrative_fails(self) -> None:
        """Model writes ₹9.9L in narrative when no signal equals 990000."""
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=500_000),
            Signal(signal_id="net_sales_mu", value_canonical=1_200_000),
        ]
        bad_json = json.dumps({
            "insights": [{
                "title": "CM2 Anomaly",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9L, significantly below net sales of ₹12L.",
                "detail": "The ₹9.9L CM2 value does not match our records.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Verify COGS inputs.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(bad_json, signals)
        assert result.ok is False, (
            "₹9.9L -> 990000 is not in signals {500000, 1200000}; gate must fire. "
            f"offending={result.offending_numbers}"
        )

    def test_multiple_hallucinations_plain_text(self) -> None:
        """Two hallucinated numbers -> both flagged (plain text path)."""
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


# ---------------------------------------------------------------------------
# B3 LIVE-RUN FIX TESTS (positive — structural numbers MUST now PASS)
# CF-C5-FAITHFULNESS-1 defect fix, workspace f165da80-e6d5-4c58-9aff-ec654b873bd7
# ---------------------------------------------------------------------------

class TestB3LiveRunFix:
    """Tests for the B3 live-run defect: structural JSON numbers must not VETO.

    These tests reproduce the exact classes of numbers that tripped the gate
    on 2026-05-19:
      - confidence: 95, 88, 92 (JSON schema field)
      - 2000, 1500 bp (benchmark thresholds the prompt told the model to cite)
      - 2026, 29, 5 (calendar date tokens in detail/summary text)
    """

    # Shared real signals for this test class
    _SIGNALS = [
        Signal(signal_id="net_sales_mu", value_canonical=1_200_000),  # ₹12L
        Signal(signal_id="cm2_mu", value_canonical=300_000),           # ₹3L
        Signal(signal_id="cm2_pct_bp", value_canonical=2500),          # 25%
        Signal(signal_id="total_ad_spend_mu", value_canonical=200_000),
    ]

    def _make_insight_json(
        self,
        confidence: int = 88,
        summary: str = "CM2 is ₹3L, at 25% margin.",
        detail: str = "In the period ending 2026-05-19, CM2 margin is 25%.",
    ) -> str:
        return json.dumps({
            "insights": [{
                "title": "CM2 Healthy",
                "severity": "positive",
                "confidence": confidence,
                "summary": summary,
                "detail": detail,
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm2_mu",
                    "rationale": "No action needed at current margin.",
                },
                "metrics": ["cm2_mu"],
            }]
        })

    def test_confidence_95_in_json_passes(self) -> None:
        """confidence=95 in JSON schema field must NOT trip the VETO gate.

        B3 defect: the old validator extracted '95' from the JSON blob and
        checked it against signals — 95 is not a signal value → false VETO.
        Fix: confidence field is excluded from narrative validation.
        """
        narration = self._make_insight_json(confidence=95)
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, (
            "confidence=95 is a structural schema field, not a data claim. "
            f"offending={result.offending_numbers}"
        )

    def test_confidence_88_in_json_passes(self) -> None:
        """confidence=88 in JSON schema field must NOT trip the VETO gate."""
        narration = self._make_insight_json(confidence=88)
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, f"offending={result.offending_numbers}"

    def test_confidence_92_in_json_passes(self) -> None:
        """confidence=92 in JSON schema field must NOT trip the VETO gate."""
        narration = self._make_insight_json(confidence=92)
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, f"offending={result.offending_numbers}"

    def test_benchmark_threshold_20pct_in_narrative_passes(self) -> None:
        """20% benchmark threshold (= 2000 bp) in narrative text must NOT VETO.

        The _BENCHMARKS_BLOCK explicitly tells the model: "critical <20%".
        After extract_numbers() 20% -> 2000 bp.  This must be in the allowed set.
        """
        narration = json.dumps({
            "insights": [{
                "title": "CM2 Below Critical Threshold",
                "severity": "critical",
                "confidence": 90,
                "summary": "CM2 margin dropped below the critical 20% threshold.",
                "detail": "CM2 margin is now at the critical benchmark of 20%.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "cm2_mu",
                    "rationale": "CM2 is at the critical 20% benchmark level.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, (
            "20% benchmark threshold (2000 bp) is in _BENCHMARKS_BLOCK; "
            "the prompt told the model to cite it. Must not VETO. "
            f"offending={result.offending_numbers}"
        )

    def test_benchmark_threshold_15pct_in_narrative_passes(self) -> None:
        """15% benchmark threshold (= 1500 bp) in narrative text must NOT VETO.

        _BENCHMARKS_BLOCK: CM2%: warning <15%.
        """
        narration = json.dumps({
            "insights": [{
                "title": "CM2 Near Warning Threshold",
                "severity": "warning",
                "confidence": 85,
                "summary": "CM2 is approaching the 15% warning threshold.",
                "detail": "Maintain CM2 above the 15% warning level.",
                "recommendation": {
                    "action": "REVIEW_VARIABLE_COSTS",
                    "entity_id": "cm2_mu",
                    "rationale": "Prevent CM2 drop below 15% benchmark.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, (
            "15% (1500 bp) is a prompt-injected benchmark threshold. Must not VETO. "
            f"offending={result.offending_numbers}"
        )

    def test_calendar_date_2026_in_narrative_passes(self) -> None:
        """Year 2026 in detail text must NOT VETO.

        B3 defect: the old validator extracted '2026' from the JSON blob.
        2026 is not a signal value → false VETO.
        """
        narration = self._make_insight_json(
            detail="In the period ending 2026-05-19, CM2 was ₹3L (25% margin)."
        )
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, (
            "Calendar year 2026 in detail text is not a data claim. "
            f"offending={result.offending_numbers}"
        )

    def test_calendar_day_ordinal_in_narrative_passes(self) -> None:
        """Day ordinals (5, 9, 12, 29) in detail text must NOT VETO."""
        narration = self._make_insight_json(
            detail=(
                "From May 5 to May 29, CM2 improved from 25% to a peak on May 12. "
                "The 9-day trailing trend shows ₹3L CM2."
            )
        )
        result = validate_faithfulness(narration, self._SIGNALS)
        assert result.ok is True, (
            "Day ordinals 5, 9, 12, 29 are calendar tokens, not data claims. "
            f"offending={result.offending_numbers}"
        )

    def test_full_b3_style_faithful_brief_passes(self) -> None:
        """Full realistic B3-style brief with all structural numbers PASSES.

        Reproduces the exact scenario from workspace f165da80-e6d5-4c58-9aff-
        ec654b873bd7, date 2026-05-19.  The brief is faithful (every metric
        number matches a signal); structural numbers (confidence, benchmarks,
        dates) must not cause VETO.
        """
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=1_200_000),
            Signal(signal_id="cm2_mu", value_canonical=300_000),
            Signal(signal_id="cm2_pct_bp", value_canonical=2500),
            Signal(signal_id="total_ad_spend_mu", value_canonical=200_000),
            Signal(signal_id="rto_rate_bp", value_canonical=1000),
        ]
        narration = json.dumps({
            "insights": [
                {
                    "title": "CM2 Healthy at 25%",
                    "severity": "positive",
                    "confidence": 92,
                    "summary": (
                        "Net sales of ₹12L drove CM2 of ₹3L (25% margin) on 2026-05-19."
                    ),
                    "detail": (
                        "CM2 margin of 25% is well above the 15% warning threshold. "
                        "Ad spend of ₹2L maintained MER above benchmark. "
                        "RTO rate of 10% is within the acceptable range."
                    ),
                    "recommendation": {
                        "action": "NO_ACTION",
                        "entity_id": "cm2_mu",
                        "rationale": "CM2 is above the 20% critical threshold; no action needed.",
                    },
                    "metrics": ["cm2_mu", "net_sales_mu"],
                },
                {
                    "title": "RTO Rate at Warning Level",
                    "severity": "warning",
                    "confidence": 88,
                    "summary": "RTO rate is 10%, approaching the warning threshold.",
                    "detail": (
                        "On 2026-05-19, RTO rate was 10%. Monitor against the "
                        "15% warning threshold. Year-to-date average is below 2026 target."
                    ),
                    "recommendation": {
                        "action": "MONITOR_RTO",
                        "entity_id": "rto_rate_bp",
                        "rationale": "Keep RTO below the 15% warning level.",
                    },
                    "metrics": ["rto_rate_bp"],
                },
            ]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "B3 faithful brief must PASS. Every metric number (₹12L=1200000, "
            "₹3L=300000, 25%=2500bp, ₹2L=200000, 10%=1000bp) is a real signal. "
            "Structural numbers (confidence 92/88, benchmarks 15%/20%, year 2026, "
            "date token 19) must not cause VETO. "
            f"offending={result.offending_numbers}"
        )


# ---------------------------------------------------------------------------
# INVERSE MUTANT: vacuous ok=True caught
# ---------------------------------------------------------------------------

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

        # Real: catches it (plain text path).
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

    def test_json_hallucination_not_whitelisted_by_structural_allowed(self) -> None:
        """The structural allowed set cannot whitelist an arbitrary hallucinated number.

        A large metric value (e.g. 990000) is NOT in _CONFIDENCE_RANGE (0-100),
        NOT in _BENCHMARK_BP_ALLOWED, NOT in _CALENDAR_YEARS (2020-2030),
        NOT in _DAY_MONTH_ORDINALS (1-31).  It must still VETO.
        """
        signals = [Signal(signal_id="cm2_mu", value_canonical=500_000)]
        bad_json = json.dumps({
            "insights": [{
                "title": "CM2 Check",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9L this period.",
                "detail": "The ₹9.9L figure is above expectations.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm2_mu",
                    "rationale": "All good.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(bad_json, signals)
        assert result.ok is False, (
            "990000 (₹9.9L) is not in signal set or structural allowed set; VETO must fire."
        )


# ---------------------------------------------------------------------------
# _extract_narrative_text unit tests
# ---------------------------------------------------------------------------

class TestExtractNarrativeText:
    """Unit tests for the JSON parsing helper."""

    def test_extracts_free_text_fields(self) -> None:
        """title, summary, detail, rationale are extracted; confidence/action/metrics excluded."""
        payload = json.dumps({
            "insights": [{
                "title": "Good margin",
                "severity": "positive",
                "confidence": 92,
                "summary": "CM2 is ₹3L.",
                "detail": "Details here.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm2_mu",
                    "rationale": "No action needed.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        text = _extract_narrative_text(payload)
        assert text is not None
        assert "Good margin" in text
        assert "CM2 is ₹3L" in text
        assert "Details here" in text
        assert "No action needed" in text
        # Structural fields NOT in narrative text
        assert "92" not in text  # confidence
        assert "NO_ACTION" not in text  # action enum
        assert "cm2_mu" not in text  # metric id

    def test_returns_none_for_invalid_json(self) -> None:
        """Non-JSON narration returns None (triggers full-string fallback)."""
        result = _extract_narrative_text("not json at all")
        assert result is None

    def test_returns_none_for_plain_text(self) -> None:
        """Plain text narration returns None."""
        result = _extract_narrative_text("Revenue was ₹1.2L.")
        assert result is None

    def test_returns_empty_string_for_empty_insights(self) -> None:
        """JSON with no insights returns empty string."""
        result = _extract_narrative_text(json.dumps({"insights": []}))
        assert result == ""


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

    def test_lakh_notation_in_json_narrative_passes(self) -> None:
        """₹1.2L in JSON summary field vs signal 120000 -> PASS."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        narration = json.dumps({
            "insights": [{
                "title": "Sales Healthy",
                "severity": "positive",
                "confidence": 88,
                "summary": "Net sales were approximately ₹1.2L this week.",
                "detail": "Revenue of ₹1.2L is on target.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "Revenue is on track.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            f"FALSE-REJECT BUG: ₹1.2L in JSON narrative must normalize and PASS. "
            f"offending={result.offending_numbers}"
        )


# ---------------------------------------------------------------------------
# Benchmark whitelist tests (task: whitelist _BENCHMARK_BP_ALLOWED on BOTH paths)
# ---------------------------------------------------------------------------

class TestBenchmarkWhitelist:
    """Tests for _BENCHMARK_BP_ALLOWED whitelisted on both JSON and fallback paths.

    The live Morning Brief VETO was firing on benchmark threshold numbers the
    prompt explicitly instructs the model to cite (e.g. 'ACOS exceeds critical
    benchmark of >40%' → 4000 bp; 'MER below 2.5x warning' → 2 already in
    ordinals; 'CM2% below warning benchmark of 25%' → 2500 bp).

    Fix (2026-06-03): _BENCHMARK_BP_ALLOWED is applied on BOTH the JSON-narrative
    path (already via _STRUCTURAL_ALLOWED) AND the plain-text fallback path.
    Also adds MER x100 forms: 400 (4x), 250 (2.5x), 150 (1.5x).

    Canonical forms confirmed via extract_numbers():
      '40%'  → [4000]   '2.5x' → [2] (in ordinals) / x100 form: 250
      '25%'  → [2500]   '4x'   → [4] (in ordinals) / x100 form: 400
      '15%'  → [1500]   '1.5x' → [1] (in ordinals) / x100 form: 150
    """

    # -----------------------------------------------------------------------
    # (a) JSON-narrative path: ACOS >40% benchmark passes
    # -----------------------------------------------------------------------
    def test_acos_40pct_benchmark_in_json_passes(self) -> None:
        """'ACOS exceeds the critical benchmark of >40%' → 4000 bp.

        4000 is in _BENCHMARK_BP_ALLOWED (ACOS critical threshold).
        Must PASS on the JSON-narrative path.
        """
        signals = [Signal("derived:acos_bp", 4460)]  # actual ACOS 44.6%
        narration = json.dumps({
            "insights": [{
                "title": "ACOS above critical benchmark",
                "severity": "critical",
                "confidence": 88,
                "summary": "ACOS exceeds the critical benchmark of >40%, indicating excessive ad spend.",
                "detail": "ACOS crossed the critical threshold of 40% this period.",
                "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                   "rationale": "Reduce spend to lower ACOS."},
                "metrics": ["derived:acos_bp"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "4000 bp (40% benchmark) is in _BENCHMARK_BP_ALLOWED; must not VETO. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # (b) JSON-narrative path: MER <2.5x benchmark passes
    # -----------------------------------------------------------------------
    def test_mer_2_5x_benchmark_in_json_passes(self) -> None:
        """'MER below the warning benchmark of 2.5x' — extract_numbers('2.5x') = [2].

        2 is in _DAY_MONTH_ORDINALS (1–31), so it passes regardless.
        This test confirms no regression — the phrasing that caused live failures passes.
        Also covers the x100 form 250 (in _BENCHMARK_BP_ALLOWED).
        """
        signals = [Signal("derived:mer_x100", 224)]  # MER 2.24x
        narration = json.dumps({
            "insights": [{
                "title": "MER below warning threshold",
                "severity": "warning",
                "confidence": 85,
                "summary": "MER 2.24x is below the warning benchmark of 2.5x.",
                "detail": "MER declined below the 2.5x warning benchmark this period.",
                "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                   "rationale": "Improve MER above 2.5x warning level."},
                "metrics": ["derived:mer_x100"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "MER 2.5x benchmark phrasing must PASS (2 is in ordinals; 224 is a signal). "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # (c) JSON-narrative path: CM2% 25% benchmark passes
    # -----------------------------------------------------------------------
    def test_cm2_25pct_benchmark_in_json_passes(self) -> None:
        """CM2 margin 14.8% below warning benchmark of 25% → 2500 bp for the benchmark.

        2500 is in _BENCHMARK_BP_ALLOWED (CM2% good threshold).
        1480 is the actual CM2 margin signal value.

        Note: phrasing uses 'CM2 margin' not 'CM2%' — the string 'CM2%' causes
        extract_numbers to pick up '2%' → 200 bp from the percentage regex.
        A model narrating the live brief writes 'CM2 margin', not 'CM2%', so
        this phrasing is realistic.
        """
        signals = [
            Signal("derived:cm2_pct_bp", 1480),  # actual CM2% 14.8%
            Signal("derived:cm2_pct_bp:display", 1480),
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 margin below warning benchmark",
                "severity": "warning",
                "confidence": 90,
                "summary": "CM2 margin at 14.8% is below the warning benchmark of 25%.",
                "detail": "CM2 margin at 14.8% is well below the 25% good threshold.",
                "recommendation": {"action": "REVIEW_VARIABLE_COSTS", "entity_id": "cm2_mu",
                                   "rationale": "Improve CM2 toward the 25% benchmark."},
                "metrics": ["derived:cm2_pct_bp"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "2500 bp (25% benchmark) and 1480 bp (actual signal) must both pass. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # (d) Fallback path: benchmark threshold passes when JSON parse fails
    # -----------------------------------------------------------------------
    def test_benchmark_threshold_on_fallback_path_passes(self) -> None:
        """Plain-text narration citing a benchmark threshold must PASS.

        On the fallback path (non-JSON output), _BENCHMARK_BP_ALLOWED is now
        applied.  A model that outputs plain text with a benchmark citation
        (e.g. 'ACOS exceeds 40% benchmark') must not VETO on the threshold.
        """
        signals = [Signal("derived:acos_bp", 4460)]  # actual ACOS 44.6%
        # Plain text (not JSON) — triggers the fallback path
        narration = "ACOS exceeds the critical benchmark of 40%, indicating ad spend is too high."
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "Fallback path: 40% → 4000 bp is in _BENCHMARK_BP_ALLOWED; must not VETO. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # (d) Fabricated workspace data still FAILS (VETO preserved)
    # -----------------------------------------------------------------------
    def test_fabricated_workspace_metric_still_fails(self) -> None:
        """A fabricated workspace metric value (not in signals or benchmarks) still FAILS.

        Signal is net_sales = ₹4.8Cr (48_000_000).  Model invents ₹9.9Cr
        (99_000_000).  99_000_000 is NOT a benchmark constant.  VETO must fire.
        This confirms whitelisting benchmarks does NOT weaken the VETO against
        fabricated DATA.
        """
        signals = [Signal("net_sales_mu", 48_000_000)]  # ₹4.8Cr
        narration = json.dumps({
            "insights": [{
                "title": "Net sales at ₹9.9Cr",
                "severity": "warning",
                "confidence": 88,
                "summary": "Net sales were ₹9.9Cr this period.",
                "detail": "Revenue of ₹9.9Cr exceeds the 40% benchmark for CM1.",
                "recommendation": {"action": "NO_ACTION", "entity_id": "net_sales_mu",
                                   "rationale": "Monitor."},
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is False, (
            "99_000_000 (₹9.9Cr) is neither a signal value nor a benchmark constant. "
            "VETO must fire. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # MER x100 form (250, 400, 150) in _BENCHMARK_BP_ALLOWED
    # -----------------------------------------------------------------------
    def test_mer_x100_benchmark_250_passes(self) -> None:
        """MER x100 form 250 (= 2.5x warning) passes when cited in narrative.

        If the model writes 'MER x100 = 250 (warning threshold)' or similar,
        extract_numbers('250') = [250].  250 is in _BENCHMARK_BP_ALLOWED.
        """
        signals = [Signal("derived:mer_x100", 224)]  # actual MER 2.24x
        narration = json.dumps({
            "insights": [{
                "title": "MER below warning",
                "severity": "warning",
                "confidence": 88,
                "summary": "MER is 2.24x, below the warning threshold of 2.5x (250 in index).",
                "detail": "MER index is 224 vs warning threshold of 250.",
                "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                   "rationale": "Improve MER."},
                "metrics": ["derived:mer_x100"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "250 (MER x100 warning benchmark) is in _BENCHMARK_BP_ALLOWED; must not VETO. "
            "224 (actual MER signal) is in signal set. "
            f"offending={result.offending_numbers}"
        )


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
