"""
tests/fakes/gateway_fakes.py — Deterministic fakes for B1 full-pipeline tests.

These fakes allow the COMPLETE agent pipeline (context → signals → narrate →
gateway → faithfulness → InsightItems) to run with NO real LLM and NO real DB.

Design invariant:
    FakeGateway.complete(req) returns a GatewayResponse whose narration is
    built ONLY from canonical values present in req.signals — so Gate 2
    (faithfulness set-compare) PASSES deterministically.

    FakeQueryGateway.query_metrics(...) returns canned MetricRow objects so
    build_pnl_context produces non-trivial signals (non-zero, trend-detectable).

@paradigm: sql (test toolchain — no ML, no LLM, no external deps)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any


# ---------------------------------------------------------------------------
# FakeQueryGateway — satisfies _query_gateway contract in build_pnl_context
# ---------------------------------------------------------------------------

@dataclass
class _FakeMetricRow:
    """Minimal MetricRow duck-type matching what pnl_context_builder accesses.

    Fields read by _aggregate_summary and _build_daily_signals:
        net_sales_mu, cogs_mu, cm1_mu, cm2_mu, cm3_mu,
        total_ad_spend_mu, aov_mu, date
    """
    date: str
    net_sales_mu: int
    cogs_mu: int
    cm1_mu: int
    cm2_mu: int
    cm3_mu: int
    total_ad_spend_mu: int
    aov_mu: int


@dataclass
class _FakeDateRange:
    """Minimal DateRange duck-type for build_pnl_context."""
    start: date
    end: date


def _make_metric_rows(start: date, end: date, base_mu: int = 100_000) -> list[_FakeMetricRow]:
    """Generate one row per day in [start, end] with deterministic values.

    Values are non-zero and vary slightly so trend/anomaly detection produces
    meaningful (non-empty) signal sets for the faithfulness gate to work with.
    """
    rows = []
    delta = (end - start).days
    for i in range(delta + 1):
        d = start.replace(day=start.day)
        from datetime import timedelta
        current_date = start + timedelta(days=i)
        # Vary net_sales slightly per day for realistic signal variance
        factor = base_mu + (i * 2_000)
        rows.append(_FakeMetricRow(
            date=current_date.isoformat(),
            net_sales_mu=factor,
            cogs_mu=factor // 3,
            cm1_mu=factor // 2,
            cm2_mu=factor // 3,
            cm3_mu=factor // 4,
            total_ad_spend_mu=factor // 6,
            aov_mu=factor // 10 if factor > 0 else 1000,
        ))
    return rows


class FakeQueryGateway:
    """Fake query gateway satisfying the _query_gateway dict contract.

    Returns canned MetricRow-like objects so build_pnl_context produces
    non-trivial, non-zero signals that pass through the full pipeline.

    Usage:
        fake_qg = FakeQueryGateway()
        metric_source = fake_qg.as_metric_source()
        agent = PnlInsightAgent(gateway=..., _query_gateway=metric_source)
    """

    def query_metrics(
        self,
        workspace_id: str,
        definition_id: str,
        date_range: Any,
    ) -> list[_FakeMetricRow]:
        """Return canned rows for any workspace/definition/range combination.

        Produces 5 rows per call (enough for trend detection; well within the
        30-row MAX_DAILY_ROWS ceiling in pnl_context_builder).
        """
        from datetime import timedelta
        start = date_range.start if hasattr(date_range, "start") else date.today()
        end = date_range.end if hasattr(date_range, "end") else date.today()
        # Cap to 5 rows max to keep token estimates small and deterministic
        rows = _make_metric_rows(start, end, base_mu=100_000)
        return rows[:5]

    def as_metric_source(self) -> dict:
        """Return the dict {"query_metrics": ..., "DateRange": ...} expected by
        build_pnl_context's _query_gateway parameter.
        """
        return {
            "query_metrics": self.query_metrics,
            "DateRange": _FakeDateRange,
        }


# ---------------------------------------------------------------------------
# FakeGateway — satisfies GatewayClient.complete() contract
# ---------------------------------------------------------------------------

class FakeGateway:
    """Deterministic fake GatewayClient.

    complete(req) returns a GatewayResponse whose narration is a valid JSON
    string built ONLY from canonical signal values in req.signals — so Gate 2
    faithfulness set-compare PASSES unconditionally.

    The JSON shape matches the InsightItem schema the agent's
    _parse_insights_from_json expects (from pnl_system_prompt output schema):
    {"insights": [{title, severity, confidence, summary, detail, recommendation, metrics}]}

    Gate 1 (paradigm): FakeGateway bypasses assert_llm_tier_at_gateway() by
    implementing complete() directly without calling assert_llm_tier_at_gateway.
    This is intentional for tests — the real gateway's Gate 1 is exercised by
    test_gate1_paradigm.py; this fake focuses on the end-to-end pipeline shape.

    Gate 2 (faithfulness): enforced. The narration contains ONLY values that are
    in req.signals (first signal's value_canonical), so validate_faithfulness passes.
    """

    def complete(self, request: Any) -> Any:
        """Return a deterministic GatewayResponse passing faithfulness gate.

        Narration strategy: produce a JSON InsightItem[] whose narration TEXT
        contains ONLY values that appear in request.signals.  The faithfulness
        gate does a set-compare of every integer it extracts from the narration
        string against the signal value set — so:
          1. We build the "allowed set" from request.signals.
          2. We pick ref_value = first non-zero signal value (for prose text).
          3. All JSON numeric fields are OMITTED from the faithfulness-checked
             portion: instead we emit confidence/impact as strings or use the
             signal values themselves.
          4. The JSON is structured as plain text in summary/detail that only
             mentions ref_value — which is guaranteed in the signal set.

        This makes Gate 2 (faithfulness) pass unconditionally for any input
        signal set while still returning a parseable InsightItem JSON.
        """
        from application.gateway.client import GatewayResponse
        from domain.faithfulness.validator import FaithfulnessResult, validate_faithfulness

        # Build the canonical value set from the request's signals.
        canonical_values = {s.value_canonical for s in request.signals}
        # All non-zero signal values in sorted order (deterministic)
        nonzero_values = sorted(v for v in canonical_values if v != 0)
        # ref_value: the first non-zero signal value (used in prose text)
        ref_value = nonzero_values[0] if nonzero_values else 0

        # Build the narration as a JSON string where every extracted integer
        # is present in request.signals.  Strategy:
        #   - prose (summary, detail): reference ONLY ref_value
        #   - confidence: expressed as a string ("high") to avoid injecting an
        #     arbitrary integer (e.g. 85) that might not be in signals
        #   - confidence_display_pct: use ref_value clamped to [0,100] range IF
        #     a small value is in the signal set, otherwise omit from JSON
        #   - expected_impact.revenue_mu + cm2_mu: use ref_value (it is in signals)
        #   - No other numeric fields in the JSON

        # Clamp to get a confidence value that IS in the signal set.
        # If ref_value <= 100 we can use it as confidence_display_pct.
        # Otherwise we just don't include it (proto default = 0, which is fine).
        small_signals = sorted(v for v in canonical_values if 0 < v <= 100)
        confidence_pct = small_signals[0] if small_signals else None

        insight: dict = {
            "title": "CM2 trend detected in period",
            "severity": "warning",
            # Do NOT include "confidence" as a bare integer — use only values
            # that are in the signal set (or omit numeric confidence entirely).
            "summary": f"Net sales were {ref_value} paise in the analysis period.",
            "detail": (
                f"Period net sales reached {ref_value} paise. "
                "CM2 compression observed. Manual review recommended."
            ),
            "recommendation": {
                # Must be a key in the servicer's action_map (lowercase snake_case).
                "action": "review_manually",
                "entity_id": "pnl-period",
                "rationale": "CM2 decline warrants a COGS audit.",
            },
            "expected_impact": {
                # Use ref_value for cm2_mu (it IS in signals).
                # revenue_mu uses ref_value too — also in signals.
                "revenue_mu": ref_value,
                "cm2_mu": ref_value,
                "currency_code": "INR",
                "impact_label": "Preserve CM2",
            },
            "risk": "medium",
            "metrics": ["net_sales_mu", "cm2_mu"],
        }
        # Only add confidence_display_pct if we have a small signal value for it.
        if confidence_pct is not None:
            insight["confidence_display_pct"] = confidence_pct
            insight["confidence"] = confidence_pct

        insights_payload = {"insights": [insight]}
        narration = json.dumps(insights_payload)

        # Validate faithfulness: every number extracted from the narration string
        # must be in request.signals.  This is the live Gate 2 check.
        faith_result = validate_faithfulness(narration, request.signals)

        # If faithfulness still fails (should not happen with above design),
        # fall back to a narration with only the ref_value in text and no
        # numeric JSON fields at all — a minimal faithful response.
        if not faith_result.ok:
            minimal = {
                "insights": [
                    {
                        "title": "CM2 trend detected in period",
                        "severity": "warning",
                        "summary": f"Net sales totalled {ref_value} paise.",
                        "detail": f"Period net sales: {ref_value} paise.",
                        "recommendation": {
                            "action": "review_manually",
                            "entity_id": "pnl-period",
                            "rationale": "Review recommended.",
                        },
                        "expected_impact": {
                            "revenue_mu": ref_value,
                            "cm2_mu": ref_value,
                            "currency_code": "INR",
                            "impact_label": "Preserve CM2",
                        },
                        "risk": "medium",
                    }
                ]
            }
            narration = json.dumps(minimal)
            faith_result = validate_faithfulness(narration, request.signals)
            if not faith_result.ok:
                # Absolute last resort: no numeric content at all
                narration = '{"insights": [{"title": "CM2 compression", "severity": "warning", "summary": "CM2 compression observed.", "detail": "Review recommended.", "recommendation": {"action": "review_manually", "entity_id": "pnl", "rationale": "Review."}, "expected_impact": {"currency_code": "INR", "impact_label": "Preserve CM2"}, "risk": "medium"}]}'
                faith_result = FaithfulnessResult(ok=True, offending_numbers=[])

        return GatewayResponse(
            narration=narration,
            model_used="fake/deterministic-v1",
            tokens_input=len(narration) // 4,
            tokens_output=len(narration) // 4,
            faithfulness=faith_result,
            cached=False,
            cost_mu=0,
        )

    def _write_decision_log_noop(self, *args: Any, **kwargs: Any) -> None:
        pass
