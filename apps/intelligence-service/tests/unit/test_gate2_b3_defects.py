"""
test_gate2_b3_defects.py — Three B3 live-run defect regression tests.

Workspace f165da80-e6d5-4c58-9aff-ec654b873bd7, date 2026-05-19.

Defect 1: Markdown fence breaks JSON parser → strict fallback → false VETO
  on confidence/year even after the structural-fields fix.
Defect 2: Percentage unit mismatch (pct_x10 stored as 99, extracted as 990 bp).
Defect 3: Money rounding + derived numbers (MER, CM2%, deltas) not in signals.

Unit convention (extraction.py defines the canonical unit):
  extract_numbers("₹1.2L") = round(1.2 * 100_000) = 120_000
  extract_numbers("₹1.2Cr") = round(1.2 * 10_000_000) = 12_000_000
  Signal.value_canonical must use this same unit so set-compare works.

Each defect has POSITIVE tests (faithful brief PASSES) and NEGATIVE tests
(invented/contradicted values still FAIL — the VETO guard is preserved).
"""

from __future__ import annotations

import json

import pytest

from domain.faithfulness.extraction import extract_numbers
from domain.faithfulness.validator import (
    FaithfulnessResult,
    Signal,
    _display_round_paise,
    _build_display_tolerance_set,
    _strip_markdown_fence,
    validate_faithfulness,
)


# ---------------------------------------------------------------------------
# DEFECT 1 — Markdown fence regression tests
# ---------------------------------------------------------------------------

class TestDefect1MarkdownFence:
    """Defect 1: model wraps output in ```json … ``` despite Rule 10.

    Before fix: _extract_narrative_text returns None → strict fallback →
      confidence 95/92 and year 2026 appear as offending_numbers in a genuine
      faithful brief.
    After fix: fence stripped → JSON path used → _STRUCTURAL_ALLOWED applied →
      structural numbers pass, metric hallucinations still fail.
    """

    # -----------------------------------------------------------------------
    # Positive: fenced faithful brief MUST pass
    # -----------------------------------------------------------------------

    def test_json_fenced_faithful_brief_passes(self) -> None:
        """```json … ``` fence must be stripped; faithful brief PASSES.

        This is the exact symptom of Defect 1 in the B3 live run.
        Signal values in extractor units: extract('₹1.2L') = 120_000.
        """
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=1_200_000),   # ₹12L
            Signal(signal_id="cm2_mu", value_canonical=480_000),           # ₹4.8L
            Signal(signal_id="total_ad_spend_mu", value_canonical=144_000),  # ₹1.44L
        ]
        inner = json.dumps({
            "insights": [{
                "title": "CM2 declined despite net sales growth",
                "severity": "critical",
                "confidence": 95,
                "summary": "Net sales grew while CM2 declined.",
                "detail": "In the period ending 2026-05-19, ad spend surged.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "total_ad_spend_mu",
                    "rationale": "Reallocate budget.",
                },
                "metrics": ["cm2_mu", "net_sales_mu"],
            }]
        })
        fenced = f"```json\n{inner}\n```"
        result = validate_faithfulness(fenced, signals)
        assert result.ok is True, (
            "Defect 1: fenced JSON must be stripped before parse; "
            "confidence=95 is structural and must not VETO. "
            f"offending={result.offending_numbers}"
        )

    def test_json_fenced_without_language_tag_passes(self) -> None:
        """Plain ``` fence (no 'json' tag) is also stripped."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        inner = json.dumps({
            "insights": [{
                "title": "Sales healthy",
                "severity": "positive",
                "confidence": 88,
                "summary": "Net sales were approximately ₹1.2L.",
                "detail": "Revenue steady.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "All good.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        fenced = f"```\n{inner}\n```"
        result = validate_faithfulness(fenced, signals)
        assert result.ok is True, (
            f"Plain ``` fence must be stripped. offending={result.offending_numbers}"
        )

    def test_unfenced_json_still_passes(self) -> None:
        """Non-fenced JSON (normal model output) still passes — no regression."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        narration = json.dumps({
            "insights": [{
                "title": "Sales healthy",
                "severity": "positive",
                "confidence": 88,
                "summary": "Net sales were approximately ₹1.2L.",
                "detail": "Revenue steady.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "All good.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, f"offending={result.offending_numbers}"

    def test_confidence_95_in_fenced_json_passes(self) -> None:
        """confidence=95 inside a fenced JSON must NOT VETO (structural field).

        Before Defect 1 fix: fence → parse failure → strict fallback → 95 not
        in signal set → VETO.  After fix: fence stripped → JSON path →
        _STRUCTURAL_ALLOWED applied → confidence 95 passes.
        """
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        inner = json.dumps({
            "insights": [{
                "title": "Sales healthy",
                "severity": "positive",
                "confidence": 95,
                "summary": "Net sales were approximately ₹1.2L.",
                "detail": "Revenue on 2026-05-19 was good.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "On track.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        fenced = f"```json\n{inner}\n```"
        result = validate_faithfulness(fenced, signals)
        assert result.ok is True, (
            "confidence=95 is structural; year 2026 and date ordinals are structural. "
            "Fenced JSON must go through JSON path with _STRUCTURAL_ALLOWED. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # Negative: hallucination inside a fenced JSON MUST still fail
    # -----------------------------------------------------------------------

    def test_hallucinated_metric_inside_fence_fails(self) -> None:
        """Defect 1 guard preserved: hallucination inside ```json … ``` VETO fires.

        Signal cm2 = ₹5.0L (500_000 in extractor units).
        Model hallucinates ₹9.9L (990_000 in extractor units).
        990_000 ≠ 500_000; display_round(500_000) = 500_000 ≠ 990_000 → VETO.
        """
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=500_000),  # ₹5.0L
        ]
        inner = json.dumps({
            "insights": [{
                "title": "CM2 Anomaly",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9L, significantly above expectations.",
                "detail": "The ₹9.9L CM2 value is a fabricated number.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Verify inputs.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        fenced = f"```json\n{inner}\n```"
        result = validate_faithfulness(fenced, signals)
        assert result.ok is False, (
            "Hallucination ₹9.9L (990_000) is not signal 500_000 or its display "
            "tolerance (500_000). VETO must fire even inside a fence. "
            f"offending={result.offending_numbers}"
        )

    def test_contradicted_metric_inside_fence_fails(self) -> None:
        """Contradicted value in fenced JSON fails (₹1.4L when signal is ₹1.2L).

        extract("₹1.4L") = 140_000; signal = 120_000; display_round(120_000) = 120_000.
        140_000 ≠ 120_000 → VETO.
        """
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        inner = json.dumps({
            "insights": [{
                "title": "Sales Miss",
                "severity": "warning",
                "confidence": 90,
                "summary": "Net sales reached ₹1.4L, missing the ₹1.2L target.",
                "detail": "Sales were ₹1.4L vs prior ₹1.2L.",
                "recommendation": {
                    "action": "MONITOR_RTO",
                    "entity_id": "net_sales_mu",
                    "rationale": "Investigate.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        fenced = f"```json\n{inner}\n```"
        result = validate_faithfulness(fenced, signals)
        # ₹1.4L → 140_000; signal is 120_000 → not matching → VETO
        assert result.ok is False, (
            "₹1.4L (140_000) is not in signal set {120_000}; VETO must fire. "
            f"offending={result.offending_numbers}"
        )


# ---------------------------------------------------------------------------
# _strip_markdown_fence unit tests
# ---------------------------------------------------------------------------

class TestStripMarkdownFence:
    """Unit tests for the fence-stripping helper."""

    def test_strips_json_fence(self) -> None:
        stripped = _strip_markdown_fence("```json\n{\"a\":1}\n```")
        assert stripped == '{"a":1}'

    def test_strips_plain_fence(self) -> None:
        stripped = _strip_markdown_fence("```\n{\"a\":1}\n```")
        assert stripped == '{"a":1}'

    def test_no_fence_unchanged(self) -> None:
        s = '{"a": 1}'
        assert _strip_markdown_fence(s) == s

    def test_trailing_whitespace_handled(self) -> None:
        stripped = _strip_markdown_fence("```json\n{\"a\":1}\n```  ")
        assert stripped == '{"a":1}'

    def test_brace_slicing_fallback(self) -> None:
        """Non-fence preamble: slices from first '{' to last '}'."""
        s = 'Here is the JSON: {"a":1}'
        stripped = _strip_markdown_fence(s)
        assert '{"a":1}' in stripped  # must contain the JSON object

    def test_empty_string(self) -> None:
        assert _strip_markdown_fence("") == ""

    def test_strip_fence_then_json_parses(self) -> None:
        """Stripped result must be valid JSON."""
        import json
        inner = '{"insights": []}'
        fenced = f"```json\n{inner}\n```"
        stripped = _strip_markdown_fence(fenced)
        parsed = json.loads(stripped)
        assert parsed == {"insights": []}


# ---------------------------------------------------------------------------
# DEFECT 2 — Percentage unit mismatch (pct_x10 vs basis points)
# ---------------------------------------------------------------------------

class TestDefect2PctUnitMismatch:
    """Defect 2: trend pct signals were emitted as pct_x10 (percent * 10,
    e.g. 9.9% → 99) but extract_numbers converts "9.9%" → 990 bp.
    After fix: signals are emitted as basis points (pct_change_x10 * 10 = 990).

    The agent now emits Signal("trend:CM2:pct_bp", 990) for a 9.9% trend.
    """

    # -----------------------------------------------------------------------
    # Positive: pct narrated with correct bp signal PASSES
    # -----------------------------------------------------------------------

    def test_9_9_pct_trend_passes_with_bp_signal(self) -> None:
        """9.9% in narration + signal 990 bp (basis points) → PASS.

        This is the Defect 2 exact scenario: trend was 9.9% (pct_change_x10=99),
        old signal was 99, extract_numbers("9.9%") = 990.  With the fix, signal
        is emitted as 990 bp and the gate passes.
        """
        # extract("₹1.2L") = 120_000 → use that for cm1_mu
        signals = [
            Signal(signal_id="cm1_mu", value_canonical=120_000),  # ₹1.2L
            Signal(signal_id="trend:CM1:pct_bp", value_canonical=990),  # 9.9% = 990 bp
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM1 grew 9.9% period-over-period",
                "severity": "positive",
                "confidence": 92,
                "summary": "CM1 expanded 9.9% to ₹1.2L this period.",
                "detail": "CM1 grew 9.9% over the prior period.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm1_mu",
                    "rationale": "Strong CM1 growth; maintain current strategy.",
                },
                "metrics": ["cm1_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "Defect 2: 9.9% → 990 bp must match signal 990. "
            f"offending={result.offending_numbers}"
        )

    def test_18_7_pct_ad_spend_growth_passes(self) -> None:
        """18.7% ad spend growth (= 1870 bp) passes with correct bp signal."""
        signals = [
            Signal(signal_id="total_ad_spend_mu", value_canonical=118_700),
            Signal(signal_id="trend:Ad spend:pct_bp", value_canonical=1870),
        ]
        narration = json.dumps({
            "insights": [{
                "title": "Ad spend surged 18.7%",
                "severity": "warning",
                "confidence": 90,
                "summary": "Ad spend increased 18.7% this period.",
                "detail": "Ad spend grew 18.7% period-over-period.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "total_ad_spend_mu",
                    "rationale": "18.7% growth outpaces sales.",
                },
                "metrics": ["total_ad_spend_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "18.7% → 1870 bp must match signal 1870. "
            f"offending={result.offending_numbers}"
        )

    def test_negative_9_5_pct_decline_passes(self) -> None:
        """−9.5% CM2 decline passes when the agent emits both −950 and 950.

        extract_numbers("declined 9.5%") = [950] (positive — no explicit sign).
        extract_numbers("declined −9.5%") = [-950] (with explicit minus).
        The agent emits both pct_bp (-950) and pct_bp:abs (950) so either
        form of narration passes.
        """
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=480_000),
            Signal(signal_id="trend:CM2:pct_bp", value_canonical=-950),
            Signal(signal_id="trend:CM2:pct_bp:abs", value_canonical=950),  # unsigned form
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 declined 9.5%",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 declined 9.5% despite net sales growth.",
                "detail": "CM2 fell 9.5% vs prior period.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "cm2_mu",
                    "rationale": "Ad spend growth outpaced sales.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "−9.5% → −950 bp must match signal −950. "
            f"offending={result.offending_numbers}"
        )

    def test_2_7_pct_net_sales_growth_passes(self) -> None:
        """2.7% net sales growth (= 270 bp) passes."""
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=324_000),
            Signal(signal_id="trend:Net sales:pct_bp", value_canonical=270),
        ]
        narration = json.dumps({
            "insights": [{
                "title": "Net sales grew 2.7%",
                "severity": "positive",
                "confidence": 88,
                "summary": "Net sales grew 2.7% this period.",
                "detail": "Net sales grew 2.7% period-over-period.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "Modest growth.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "2.7% → 270 bp must match signal 270. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # Negative: wrong unit / invented pct FAILS
    # -----------------------------------------------------------------------

    def test_old_pct_x10_signal_not_matching_9_9_pct(self) -> None:
        """Regression guard: if signal is 99 (old pct_x10 unit), 9.9% STILL fails.

        The agent must emit 990 (bp), not 99 (pct_x10).
        This test documents the pre-fix state.
        """
        signals = [
            Signal(signal_id="cm1_mu", value_canonical=120_000),
            Signal(signal_id="trend:CM1:pct_x10", value_canonical=99),  # OLD — wrong unit
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM1 grew 9.9%",
                "severity": "positive",
                "confidence": 88,
                "summary": "CM1 grew 9.9% this period.",
                "detail": "9.9% growth in CM1.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm1_mu",
                    "rationale": "Strong growth.",
                },
                "metrics": ["cm1_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        # 9.9% → 990 bp; signal is 99 (pct_x10 unit); 990 ∉ {99, ...} → VETO
        assert result.ok is False, (
            "Signal 99 (pct_x10 unit) must NOT match 9.9% (990 bp). "
            "This confirms the Defect 2 fix is needed and correct. "
            f"offending={result.offending_numbers}"
        )

    def test_invented_pct_fails(self) -> None:
        """Invented 17% growth (= 1700 bp) with no matching signal FAILS.

        17% → 1700 bp is NOT a signal (990 bp) and NOT a benchmark threshold.
        """
        signals = [
            Signal(signal_id="cm1_mu", value_canonical=120_000),
            Signal(signal_id="trend:CM1:pct_bp", value_canonical=990),  # 9.9%
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM1 grew 17%",
                "severity": "positive",
                "confidence": 88,
                "summary": "CM1 grew 17% this period.",
                "detail": "Strong 17% growth.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "cm1_mu",
                    "rationale": "Maintain.",
                },
                "metrics": ["cm1_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        # 17% → 1700 bp; not in signal set or benchmark thresholds → VETO
        assert result.ok is False, (
            "17% → 1700 bp is not a signal (990 bp) or benchmark threshold; VETO must fire. "
            f"offending={result.offending_numbers}"
        )


# ---------------------------------------------------------------------------
# DEFECT 3 — Money rounding + derived signals
# ---------------------------------------------------------------------------

class TestDefect3MoneyRoundingAndDerived:
    """Defect 3: the model converts signal values to ₹X.XL/₹X.XCr itself and
    gets the magnitude wrong (10× error in B3 live run).
    Fix (a): Tier-A pre-computes display strings and emits derived signals.
    Fix (b): validator allows display-rounded forms of signal values.

    Unit convention: extract_numbers uses _LAKH=100_000, _CRORE=10_000_000.
    Signal values must use the same units.
    """

    # -----------------------------------------------------------------------
    # _display_round_paise unit tests
    # -----------------------------------------------------------------------

    def test_display_round_lakh(self) -> None:
        """Signal 534_373 (₹5.34L in extractor units) → display ₹5.3L → 530_000."""
        # 534_373 / 100_000 = 5.34373L → lakh_x10 = round(53.4373) = 53
        # display_canonical = 53 * 10_000 = 530_000
        result = _display_round_paise(534_373)
        assert result == 530_000, f"Expected 530_000, got {result}"

    def test_display_round_crore_territory(self) -> None:
        """Signal 32_386_688 (₹32.4Cr in extractor units) → display ₹32.4Cr → 324_000_000."""
        # 32_386_688 >= 10_000_000 → crore branch
        # 32_386_688 / 10_000_000 = 3.2387Cr → crore_x10 = round(32.387) = 32
        # display_canonical = 32 * 1_000_000 = 32_000_000
        result = _display_round_paise(32_386_688)
        assert result == 32_000_000, f"Expected 32_000_000, got {result}"

    def test_display_round_exact_lakh(self) -> None:
        """Signal 120_000 (₹1.2L exactly) → display_round = 120_000 (no change)."""
        result = _display_round_paise(120_000)
        # 120_000 / 100_000 = 1.2L → lakh_x10 = 12 → display = 12 * 10_000 = 120_000
        assert result == 120_000

    def test_display_round_below_lakh_returns_none(self) -> None:
        """Values < 100_000 get None (ratio/bp — no tolerance)."""
        assert _display_round_paise(990) is None    # basis points (9.9%)
        assert _display_round_paise(99) is None     # pct_x10
        assert _display_round_paise(1870) is None   # 18.7% bp

    def test_display_round_negative(self) -> None:
        """Negative signal → negative display-rounded form."""
        result = _display_round_paise(-534_373)
        assert result == -530_000

    def test_display_round_crore_large(self) -> None:
        """Signal 53_437_304 (₹5.3Cr in extractor units) → display ₹5.3Cr → 53_000_000."""
        # 53_437_304 >= 10_000_000 → crore branch
        # 53_437_304 / 10_000_000 = 5.3437Cr → crore_x10 = round(53.437) = 53
        # display_canonical = 53 * 1_000_000 = 53_000_000
        result = _display_round_paise(53_437_304)
        assert result == 53_000_000, f"Expected 53_000_000, got {result}"

    # -----------------------------------------------------------------------
    # _build_display_tolerance_set unit tests
    # -----------------------------------------------------------------------

    def test_tolerance_set_includes_display_form_for_lakh(self) -> None:
        """Signal 534_373 → tolerance set includes 530_000."""
        signals = frozenset([534_373, 990])
        tol = _build_display_tolerance_set(signals)
        assert 530_000 in tol
        # 990 is bp (< 100_000) → no display form added
        assert len([x for x in tol if x == 990]) == 0

    def test_tolerance_set_excludes_bp_values(self) -> None:
        """Ratio/bp values < 100_000 do not get tolerance entries."""
        signals = frozenset([990, 1870, 1480])
        tol = _build_display_tolerance_set(signals)
        assert len(tol) == 0  # all are bp/ratio values

    def test_tolerance_set_for_crore_signal(self) -> None:
        """Signal 53_437_304 (₹5.3Cr) → tolerance includes 53_000_000."""
        signals = frozenset([53_437_304])
        tol = _build_display_tolerance_set(signals)
        assert 53_000_000 in tol

    # -----------------------------------------------------------------------
    # Positive: display-rounded money matches real signal PASSES
    # -----------------------------------------------------------------------

    def test_display_rounded_lakh_passes_against_nearby_signal(self) -> None:
        """₹5.3L in narration (= 530_000 extracted) matches signal 534_373
        via display tolerance: display_round(534_373) = 530_000 → PASSES.

        This is the core of Defect 3b: the model correctly quotes ₹5.3L for
        a signal of 534_373; extract gives 530_000; tolerance bridges the gap.
        """
        signals = [Signal(signal_id="cm2_mu", value_canonical=534_373)]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 Analysis",
                "severity": "warning",
                "confidence": 90,
                "summary": "CM2 was ₹5.3L this period.",
                "detail": "CM2 of ₹5.3L represents the period contribution margin.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Investigate margin.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "₹5.3L extracted as 530_000; display_round(534_373) = 530_000 → PASS. "
            f"offending={result.offending_numbers}"
        )

    def test_display_rounded_crore_passes(self) -> None:
        """₹5.3Cr in narration (= 53_000_000 extracted) matches signal 53_437_304
        via display tolerance: display_round(53_437_304) = 53_000_000 → PASSES.
        """
        signals = [Signal(signal_id="cm2_mu", value_canonical=53_437_304)]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 at ₹5.3Cr",
                "severity": "warning",
                "confidence": 90,
                "summary": "CM2 was ₹5.3Cr this period.",
                "detail": "CM2 of ₹5.3Cr is the contribution margin.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Investigate margin.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "₹5.3Cr extracted as 53_000_000; display_round(53_437_304) = 53_000_000 → PASS. "
            f"offending={result.offending_numbers}"
        )

    def test_derived_cm2_pct_signal_passes(self) -> None:
        """CM2% as a derived basis-point signal passes when narrated faithfully.

        Tier-A computes CM2% = (cm2_mu / net_sales_mu) × 10000 bp.
        e.g. cm2=14_800_000, net_sales=100_000_000 → cm2_pct = 1480 bp = 14.8%.
        """
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=14_800_000),
            Signal(signal_id="net_sales_mu", value_canonical=100_000_000),
            Signal(signal_id="derived:cm2_pct_bp", value_canonical=1480),
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 margin at 14.8%",
                "severity": "warning",
                "confidence": 92,
                "summary": "CM2 margin is 14.8%, near the 15% warning threshold.",
                "detail": "CM2 represents 14.8% margin.",
                "recommendation": {
                    "action": "REVIEW_VARIABLE_COSTS",
                    "entity_id": "cm2_mu",
                    "rationale": "Margin approaching warning level.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "14.8% → 1480 bp must match derived:cm2_pct_bp signal 1480. "
            f"offending={result.offending_numbers}"
        )

    def test_delta_signal_passes_when_narrated(self) -> None:
        """Period delta narrated faithfully passes when delta signal is emitted.

        cm2 = 480_000 (= ₹4.8L in extractor units), prior_cm2 = 530_000 (₹5.3L)
        delta = -50_000 (= −₹5.0L)
        extract('−₹5.0L') = -500_000? No: extract('₹5.0L') = 500_000, with '−'
        prefix → -500_000.  But delta is -50_000.

        Use a delta that is exact in lakh display:
        cm2 = 480_000, prior_cm2 = 530_000, delta = -50_000
        display_round(-50_000): 50_000 < 100_000 → None (exact)
        extract('−₹50,000') would give 50000 or the text form.
        This is messy. Use simpler exact values:

        cm2 = 500_000 (₹5.0L), prior = 550_000 (₹5.5L), delta = -50_000 exact.
        display_round(-50_000) = None (< 100_000) → plain integer.
        Narrate as '−₹50000' (plain) → extract gives 50000 or -50000.
        Actually extract_numbers('-₹50000') — let's use the signal directly.

        Simpler: use delta that is exactly a lakh multiple.
        delta = -100_000 (−₹1.0L), display '−₹1.0L' → extract(-100_000) exact.
        """
        delta = -100_000  # −₹1.0L exact; display_round = -100_000
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=400_000),      # ₹4.0L
            Signal(signal_id="prior_cm2_mu", value_canonical=500_000), # ₹5.0L
            Signal(signal_id="derived:cm2_delta", value_canonical=delta),
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 fell −₹1.0L",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 fell by −₹1.0L this period.",
                "detail": "CM2 declined from ₹5.0L to ₹4.0L, a drop of −₹1.0L.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "cm2_mu",
                    "rationale": "Reduce ad spend.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "Delta signal −100_000 (−₹1.0L exact) must match when model quotes −₹1.0L. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # Negative: invented metric value MUST fail (VETO guard preserved)
    # -----------------------------------------------------------------------

    def test_invented_lakh_value_not_near_any_signal_fails(self) -> None:
        """₹9.9L in narration with no signal near 990_000 → VETO.

        Signal is ₹5.0L (500_000). Model invents ₹9.9L (990_000).
        display_round(500_000) = 500_000 ≠ 990_000 → VETO must fire.
        """
        signals = [
            Signal(signal_id="cm2_mu", value_canonical=500_000),  # ₹5.0L
        ]
        narration = json.dumps({
            "insights": [{
                "title": "CM2 Anomaly",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9L this period.",
                "detail": "The ₹9.9L CM2 figure is higher than expected.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Verify COGS.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        # ₹9.9L → 990_000; signal is 500_000; display_round(500_000) = 500_000
        # 990_000 ≠ 500_000 → VETO
        assert result.ok is False, (
            "₹9.9L (990_000) is not signal 500_000 or its display-round (500_000). "
            "VETO must fire. "
            f"offending={result.offending_numbers}"
        )

    def test_invented_crore_value_fails(self) -> None:
        """₹1.5Cr invented (15_000_000) when signal is ₹3.2Cr (32_000_000) → VETO."""
        signals = [
            Signal(signal_id="net_sales_mu", value_canonical=32_000_000),  # ₹3.2Cr
        ]
        narration = json.dumps({
            "insights": [{
                "title": "Sales at ₹1.5Cr",
                "severity": "positive",
                "confidence": 88,
                "summary": "Net sales reached ₹1.5Cr this period.",
                "detail": "Revenue of ₹1.5Cr is below prior period.",
                "recommendation": {
                    "action": "NO_ACTION",
                    "entity_id": "net_sales_mu",
                    "rationale": "Monitor.",
                },
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        # ₹1.5Cr → 15_000_000; signal is 32_000_000
        # display_round(32_000_000): 32_000_000 >= 10_000_000 → crore
        # crore_x10 = round(32_000_000 * 10 / 10_000_000) = round(32) = 32
        # display = 32 * 1_000_000 = 32_000_000 ≠ 15_000_000 → VETO
        assert result.ok is False, (
            "₹1.5Cr (15_000_000) != signal ₹3.2Cr (32_000_000); VETO must fire. "
            f"offending={result.offending_numbers}"
        )

    # -----------------------------------------------------------------------
    # Full B3-style brief with all three defect fixes PASSES
    # -----------------------------------------------------------------------

    def test_full_b3_style_brief_with_all_defect_fixes_passes(self) -> None:
        """Full B3-style brief passes once all three defects are fixed.

        Signal values use the extractor's unit (_LAKH=100_000, _CRORE=10_000_000).
        The B3 issue's signal values (53437304, 323866880, etc.) are in this unit.
        Correct display strings (after Defect 3a Tier-A fix):
          53_437_304 → ₹5.3Cr  (5.34 crore in extractor units)
          48_037_359 → ₹4.8Cr  (4.80 crore)
          323_866_880 → ₹32.4Cr (32.39 crore)
          192_152_208 → ₹19.2Cr

        Wrapped in markdown fence (Defect 1 test).
        Percentage changes in bp signals (Defect 2 test).
        Display-rounded money via tolerance (Defect 3 test).
        """
        signals = [
            # Raw signal values from the B3 issue
            Signal("cm2_mu", 48_037_359),            # → display ₹4.8Cr
            Signal("prior_cm2_mu", 53_437_304),       # → display ₹5.3Cr
            Signal("net_sales_mu", 323_866_880),      # → display ₹32.4Cr
            Signal("prior_net_sales_mu", 315_465_530),# → display ₹31.5Cr
            Signal("total_ad_spend_mu", 144_114_849), # → display ₹14.4Cr
            Signal("prior_total_ad_spend_mu", 121_395_726),  # → display ₹12.1Cr
            Signal("cm1_mu", 192_152_208),            # → display ₹19.2Cr
            # Derived signals (Defect 3a — Tier-A emits these).
            # Both exact bp and display-rounded bp are emitted by _emit_pct().
            Signal("derived:cm2_pct_bp", 1483),          # exact ≈14.8%
            Signal("derived:cm2_pct_bp:display", 1480),  # display-rounded (14.8%)
            Signal("derived:prior_cm2_pct_bp", 1693),
            Signal("derived:prior_cm2_pct_bp:display", 1690),  # 16.9%
            Signal("derived:cm1_pct_bp", 5931),
            Signal("derived:cm1_pct_bp:display", 5930),  # won't appear in narration
            Signal("trend:CM2:pct_bp", -950),         # −9.5% → −950 bp
            Signal("trend:CM2:pct_bp:abs", 950),      # for "9.5%" without explicit sign
            Signal("trend:CM1:pct_bp", 990),          # +9.9% → 990 bp
            Signal("trend:Ad spend:pct_bp", 1870),    # +18.7% → 1870 bp
            Signal("trend:Net sales:pct_bp", 270),    # +2.7% → 270 bp
            Signal("derived:mer_x100", 225),          # MER 2.25x (extract gives [2] → structural)
            Signal("derived:prior_mer_x100", 260),    # prior MER 2.60x
            # Delta signal for cm2 (Defect 3a)
            Signal("derived:cm2_delta", -5_399_945),  # exact delta
            # display_round(-5_399_945): 5_399_945 < 10_000_000 → lakh
            # lakh_x10 = round(5_399_945 * 10 / 100_000) = round(539.9945) = 540
            # display = 540 * 10_000 = 5_400_000
            Signal("derived:cm2_delta:display", -5_400_000),  # display-rounded delta
        ]

        # Brief with correct display values (Defect 3a: Tier-A supplies these).
        # Uses ₹5.3Cr / ₹4.8Cr not ₹53.4L (the 10× error from the live model).
        # Wrapped in ```json fence (Defect 1).
        inner_json = json.dumps({
            "insights": [
                {
                    "title": "CM2 declined 9.5% despite 2.7% net sales growth",
                    "severity": "critical",
                    "confidence": 95,
                    "summary": (
                        "CM2 fell from ₹5.3Cr to ₹4.8Cr while net sales grew "
                        "from ₹31.5Cr to ₹32.4Cr; ad spend surged 18.7%."
                    ),
                    "detail": (
                        "Ad spend increased 18.7% from ₹12.1Cr to ₹14.4Cr. "
                        "CM1 expanded 9.9% to ₹19.2Cr, but CM2 margin fell to "
                        "14.8% (prior: 16.9%). "
                        "The ratio of ad spend growth (18.7%) to sales growth (2.7%) is concerning."
                    ),
                    "recommendation": {
                        "action": "REDUCE_AD_SPEND",
                        "entity_id": "total_ad_spend_mu",
                        "rationale": "Reallocate 15% of ad budget to improve CM2 margin.",
                    },
                    "metrics": ["cm2_mu", "total_ad_spend_mu", "net_sales_mu", "cm1_mu"],
                },
                {
                    "title": "Ad spend efficiency (MER) degraded to 2.25x",
                    "severity": "warning",
                    "confidence": 92,
                    "summary": (
                        "MER declined from 2.60x to 2.25x, "
                        "below the 2.5x warning threshold."
                    ),
                    "detail": (
                        "MER of 2.25x is below the warning threshold of 2.5x. "
                        "Prior period MER was 2.60x."
                    ),
                    "recommendation": {
                        "action": "REDUCE_AD_SPEND",
                        "entity_id": "total_ad_spend_mu",
                        "rationale": "MER below warning benchmark.",
                    },
                    "metrics": ["total_ad_spend_mu", "net_sales_mu"],
                },
            ]
        })
        fenced = f"```json\n{inner_json}\n```"

        result = validate_faithfulness(fenced, signals)
        assert result.ok is True, (
            "Full B3-style brief must PASS once all three defects are fixed:\n"
            "  Defect 1: fence stripped → JSON path used.\n"
            "  Defect 2: pct signals in bp (990, −950, 1870, 270) match narrated %.\n"
            "  Defect 3: display-rounded money (₹4.8Cr, ₹5.3Cr etc.) + derived.\n"
            f"offending={result.offending_numbers}"
        )

    def test_invented_metric_in_b3_style_brief_fails(self) -> None:
        """B3-style brief with ONE invented metric (₹9.9Cr for CM2) FAILS.

        Signal cm2_mu = 48_037_359 (₹4.8Cr).
        Model invents ₹9.9Cr (99_000_000 extracted).
        display_round(48_037_359): 48_037_359 >= 10_000_000 → crore
          crore_x10 = round(48_037_359 * 10 / 10_000_000) = round(48.04) = 48
          display = 48 * 1_000_000 = 48_000_000 ≠ 99_000_000 → VETO.
        """
        signals = [
            Signal("cm2_mu", 48_037_359),
            Signal("trend:CM2:pct_bp", -950),
            Signal("derived:cm2_pct_bp", 1483),
        ]
        inner_json = json.dumps({
            "insights": [{
                "title": "CM2 was ₹9.9Cr",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9Cr this period, a fabricated value.",
                "detail": "The ₹9.9Cr CM2 figure is not from the signal data.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Investigate.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        fenced = f"```json\n{inner_json}\n```"
        result = validate_faithfulness(fenced, signals)
        # ₹9.9Cr → 99_000_000; signal is 48_037_359
        # display_round(48_037_359) = 48_000_000 ≠ 99_000_000 → VETO
        assert result.ok is False, (
            "₹9.9Cr (99_000_000) is not the display-rounded form of 48_037_359 (₹4.8Cr). "
            "VETO must fire. "
            f"offending={result.offending_numbers}"
        )
