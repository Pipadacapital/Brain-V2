"""
test_faithfulness_corrective_retry.py — Tests for the corrective-retry gate and new
derived ratio signals (ACOS, MER %-change).

Last-mile faithfulness fix (2026-06-03):
  The offending_numbers on live runs were DERIVED RATIOS the model computed that
  Tier-A never supplied: MER %-change ("−13.5%"), ACOS ("≈44.6%"),
  CM%-of-net-sales, z-scores.

Three coordinated changes tested here:

1. CORRECTIVE RETRY (client.py::_call_with_faithfulness):
   - (a) retry succeeds when attempt-1 drops the offending number.
   - (b) retry STILL fails (ValueError raised) if attempt-1 reproduces a bad number
         — VETO is preserved.
   - (c) the correction turn message shape: assistant turn = bad narration,
         user turn = explicit correction listing offending numbers.

2. NEW RATIO SIGNALS (pnl_insight_agent.py::_compute_ratio_signals):
   - (c) ACOS and MER %-change are present in the allowed signal set and a
         verbatim-quoted "44.6%" passes.
   - (d) existing B3-style brief tests still pass (non-regression).

Test naming convention:
  test_corrective_retry_* → change #1 tests
  test_ratio_signals_*    → change #2 tests
"""

from __future__ import annotations

import json

import pytest

from brain_cost_router import paradigm
from application.gateway.client import (
    GatewayClient,
    GatewayRequest,
    GatewayResponse,
)
from domain.faithfulness.validator import Signal, validate_faithfulness
from domain.agents.pnl_insight_agent import _compute_ratio_signals, _format_pct


# ---------------------------------------------------------------------------
# Helpers / shared fixtures
# ---------------------------------------------------------------------------

def _make_period_summary(
    net_sales_mu: int = 100_000_000,
    cm1_mu: int = 59_300_000,
    cm2_mu: int = 14_800_000,
    cm3_mu: int = 8_000_000,
    total_ad_spend_mu: int = 44_600_000,
    total_orders: int = 500,
    aov_mu: int = 200_000,
):
    """Build a minimal PnlPeriodSummary-compatible namespace for _compute_ratio_signals."""
    from types import SimpleNamespace
    return SimpleNamespace(
        net_sales_mu=net_sales_mu,
        cm1_mu=cm1_mu,
        cm2_mu=cm2_mu,
        cm3_mu=cm3_mu,
        total_ad_spend_mu=total_ad_spend_mu,
        total_orders=total_orders,
        aov_mu=aov_mu,
    )


def _gateway_with_mock(mock_fn) -> GatewayClient:
    return GatewayClient(_litellm_caller=mock_fn)


# ---------------------------------------------------------------------------
# 1. CORRECTIVE RETRY tests
# ---------------------------------------------------------------------------

class TestCorrectiveRetry:
    """Tests for _call_with_faithfulness corrective-turn logic."""

    # -----------------------------------------------------------------------
    # (a) Corrective retry succeeds when attempt-1 drops the offending number
    # -----------------------------------------------------------------------

    def test_corrective_retry_succeeds_when_attempt1_drops_offending_number(self) -> None:
        """Attempt 0 emits a derived ratio (−1350 bp); attempt 1 drops it → PASS.

        Simulates the live MER %-change case: attempt 0 writes
        "(−13.5% efficiency loss)" which the gate catches; the corrective turn
        tells the model to drop it; attempt 1 rewrites without the number.
        """
        signals = [Signal("net_sales_mu", 323_866_880)]  # ₹32.4Cr
        call_count = [0]
        captured_messages: list[list[dict]] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            captured_messages.append(messages)
            if call_count[0] == 1:
                # Attempt 0: model writes the derived MER %-change number
                bad_json = json.dumps({
                    "insights": [{
                        "title": "MER declined",
                        "severity": "warning",
                        "confidence": 88,
                        "summary": "Net sales were ₹32.4Cr. MER declined (−13.5% efficiency loss).",
                        "detail": "Ad spend efficiency dropped −13.5% vs prior period.",
                        "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                           "rationale": "Reduce budget."},
                        "metrics": ["net_sales_mu"],
                    }]
                })
                return bad_json, 100, 50
            else:
                # Attempt 1 (after correction): model rewrites without the bad number
                good_json = json.dumps({
                    "insights": [{
                        "title": "MER declined",
                        "severity": "warning",
                        "confidence": 88,
                        "summary": "Net sales were ₹32.4Cr. MER declined vs prior period.",
                        "detail": "Ad spend efficiency dropped vs prior period; review spend allocation.",
                        "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                           "rationale": "Reduce budget."},
                        "metrics": ["net_sales_mu"],
                    }]
                })
                return good_json, 120, 55

        gateway = _gateway_with_mock(mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                agent_id="pnl_test",
            ))

        result = narrate(workspace_id="ws_corrective_ok")
        assert result.faithfulness.ok is True
        assert call_count[0] == 2  # attempt 0 + 1 corrective retry

    # -----------------------------------------------------------------------
    # (b) Corrective retry STILL fails (raises) if attempt-1 reproduces bad number
    # -----------------------------------------------------------------------

    def test_corrective_retry_raises_if_attempt1_reproduces_bad_number(self) -> None:
        """VETO preserved: if attempt-1 still emits the offending number, ValueError raised.

        CF-C5-FAITHFULNESS-1: the gate must fire even after the correction turn.
        An invented value that survives the correction turn is a hard VETO.
        """
        signals = [Signal("net_sales_mu", 323_866_880)]  # ₹32.4Cr
        call_count = [0]

        def mock_litellm_always_bad(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            # Both attempts emit the same derived number (−1350 bp for −13.5%)
            bad_json = json.dumps({
                "insights": [{
                    "title": "MER declined",
                    "severity": "warning",
                    "confidence": 88,
                    "summary": "Net sales were ₹32.4Cr. MER declined (−13.5% efficiency loss).",
                    "detail": "MER fell −13.5% from prior period.",
                    "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                       "rationale": "Reduce budget."},
                    "metrics": ["net_sales_mu"],
                }]
            })
            return bad_json, 100, 50

        gateway = _gateway_with_mock(mock_litellm_always_bad)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                agent_id="pnl_test",
            ))

        with pytest.raises(ValueError, match="Faithfulness validation failed"):
            narrate(workspace_id="ws_corrective_fail")

        assert call_count[0] == 2  # attempt 0 + 1 corrective retry (then raises)

    # -----------------------------------------------------------------------
    # (c) Correction turn message shape
    # -----------------------------------------------------------------------

    def test_correction_turn_message_shape(self) -> None:
        """The correction turn must be an assistant+user pair appended to original messages.

        Shape:
          messages[0]: system
          messages[1]: user (original)
          messages[2]: assistant (bad narration from attempt 0)
          messages[3]: user (correction instruction with offending_numbers listed)
        """
        signals = [Signal("net_sales_mu", 323_866_880)]
        call_count = [0]
        captured_retry_messages: list[list[dict]] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            if call_count[0] == 1:
                bad_json = json.dumps({
                    "insights": [{
                        "title": "Test",
                        "severity": "warning",
                        "confidence": 88,
                        "summary": "MER changed by −13.5%.",
                        "detail": "Efficiency loss of −13.5%.",
                        "recommendation": {"action": "NO_ACTION", "entity_id": "x",
                                           "rationale": "none"},
                        "metrics": ["net_sales_mu"],
                    }]
                })
                return bad_json, 100, 50
            else:
                # Capture the retry messages before returning
                captured_retry_messages.append(messages)
                good_json = json.dumps({
                    "insights": [{
                        "title": "Test",
                        "severity": "warning",
                        "confidence": 88,
                        "summary": "Net sales were ₹32.4Cr.",
                        "detail": "Revenue steady.",
                        "recommendation": {"action": "NO_ACTION", "entity_id": "x",
                                           "rationale": "none"},
                        "metrics": ["net_sales_mu"],
                    }]
                })
                return good_json, 120, 55

        gateway = _gateway_with_mock(mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate the signals.",
                workspace_id=workspace_id,
                agent_id="pnl_test",
            ))

        narrate(workspace_id="ws_shape")

        # The retry was called with 4 messages
        assert len(captured_retry_messages) == 1
        retry_msgs = captured_retry_messages[0]
        assert len(retry_msgs) == 4, (
            f"Expected 4 messages (system + user + assistant + correction), got {len(retry_msgs)}"
        )
        assert retry_msgs[0]["role"] == "system"
        assert retry_msgs[1]["role"] == "user"
        assert retry_msgs[2]["role"] == "assistant", "Bad narration must be in assistant turn"
        assert retry_msgs[3]["role"] == "user", "Correction instruction must be in user turn"

        # The correction instruction must reference the offending numbers
        correction_content = retry_msgs[3]["content"]
        assert "NOT in the provided data" in correction_content
        assert "Rewrite the brief" in correction_content
        # Offending number −1350 should be listed (−13.5% → -1350 bp)
        assert "1350" in correction_content or "-1350" in correction_content, (
            f"Correction message must list the offending number. Got: {correction_content!r}"
        )

    # -----------------------------------------------------------------------
    # (d) Original messages unchanged for attempt 0 (no regression)
    # -----------------------------------------------------------------------

    def test_original_messages_used_for_attempt0(self) -> None:
        """Attempt 0 must use the original messages, not the corrective turn."""
        signals = [Signal("net_sales_mu", 120_000)]
        captured_attempt0_messages: list[list[dict]] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            captured_attempt0_messages.append(list(messages))
            return "Net sales were ₹1.2L.", 50, 30

        gateway = _gateway_with_mock(mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
            ))

        narrate(workspace_id="ws_attempt0")
        # Only one call (passed faithfulness), original 2-message shape
        assert len(captured_attempt0_messages) == 1
        assert len(captured_attempt0_messages[0]) == 2  # system + user only


# ---------------------------------------------------------------------------
# 2. RATIO SIGNAL tests (ACOS + MER %-change)
# ---------------------------------------------------------------------------

class TestRatioSignals:
    """Tests for the new ACOS and MER %-change signals from _compute_ratio_signals."""

    def _compute(self, cur_kwargs=None, pri_kwargs=None):
        """Helper: build period summaries and return _compute_ratio_signals output."""
        cur = _make_period_summary(**(cur_kwargs or {}))
        pri = _make_period_summary(**(pri_kwargs or {}))
        return _compute_ratio_signals(cur, pri)

    def _signal_ids(self, signals):
        return {s.signal_id for s in signals}

    # -----------------------------------------------------------------------
    # (c) ACOS signal is present and verbatim-quoted value passes gate
    # -----------------------------------------------------------------------

    def test_acos_signal_present_in_allowed_set(self) -> None:
        """ACOS = ad_spend / net_sales is computed and emitted as derived:acos_bp."""
        # net_sales=100M, ad_spend=44.6M → ACOS = 44.6% = 4460 bp
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:acos_bp" in ids, (
            f"ACOS signal must be emitted. Signal IDs: {ids}"
        )
        acos_signal = next(s for s in signals if s.signal_id == "derived:acos_bp")
        # ACOS = 44_600_000 * 10000 // 100_000_000 = 4460 bp = 44.6%
        assert acos_signal.value_canonical == 4460, (
            f"Expected 4460 bp (44.6%), got {acos_signal.value_canonical}"
        )

    def test_acos_verbatim_quote_passes_faithfulness_gate(self) -> None:
        """A brief quoting '44.6%' for ACOS passes when derived:acos_bp=4460 is in signals.

        extract_numbers('44.6%') = round(44.6 * 100) = 4460 bp.
        The derived:acos_bp signal (4460) must be in the allowed set so the gate passes.
        """
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,
        )
        ratio_signals = _compute_ratio_signals(cur, pri)
        # Add a money signal for net_sales so the model has something to quote
        all_signals = [
            Signal("net_sales_mu", 100_000_000),
            *ratio_signals,
        ]

        narration = json.dumps({
            "insights": [{
                "title": "ACOS at 44.6%",
                "severity": "warning",
                "confidence": 88,
                "summary": "Net sales were ₹10.0Cr with ACOS at 44.6%.",
                "detail": "ACOS of 44.6% is above the 40% critical benchmark.",
                "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                   "rationale": "Reduce ad spend to lower ACOS."},
                "metrics": ["net_sales_mu"],
            }]
        })
        result = validate_faithfulness(narration, all_signals)
        assert result.ok is True, (
            "44.6% → 4460 bp must match derived:acos_bp signal 4460. "
            f"offending={result.offending_numbers}"
        )

    def test_prior_acos_signal_present(self) -> None:
        """Prior period ACOS (derived:prior_acos_bp) is also emitted."""
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,  # 36_000_000 * 10000 // 90_000_000 = 4000 bp = 40%
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:prior_acos_bp" in ids, (
            f"Prior ACOS signal must be emitted. IDs: {ids}"
        )
        prior_acos_sig = next(s for s in signals if s.signal_id == "derived:prior_acos_bp")
        assert prior_acos_sig.value_canonical == 4000, (
            f"Expected 4000 bp (40.0%), got {prior_acos_sig.value_canonical}"
        )

    # -----------------------------------------------------------------------
    # MER %-change signal
    # -----------------------------------------------------------------------

    def test_mer_pct_change_signal_present(self) -> None:
        """MER %-change is computed and emitted as derived:mer_pct_change_bp."""
        # cur: MER = 100M / 44.6M ≈ 2.24x → mer_x100 = 224
        # pri: MER = 90M / 36M = 2.50x → mer_x100 = 250
        # %-change = (224 * 10000 // 250) − 10000 = 8960 − 10000 = −1040 bp ≈ −10.4%
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:mer_pct_change_bp" in ids, (
            f"MER %-change signal must be emitted. IDs: {ids}"
        )

    def test_mer_pct_change_signal_negative_when_mer_declines(self) -> None:
        """MER %-change is negative when current MER < prior MER."""
        # cur_mer_x100 < pri_mer_x100 → negative %-change
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,  # MER ≈ 2.24x
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,  # MER = 2.50x
        )
        signals = _compute_ratio_signals(cur, pri)
        pct_sig = next(
            (s for s in signals if s.signal_id == "derived:mer_pct_change_bp"), None
        )
        assert pct_sig is not None
        assert pct_sig.value_canonical < 0, (
            f"MER %-change must be negative when MER declines. Got {pct_sig.value_canonical}"
        )

    def test_mer_pct_change_passes_faithfulness_gate(self) -> None:
        """A brief quoting the MER %-change verbatim passes when the signal is in the set.

        This is the exact '−13.5%' live-run scenario: the signal must exist
        AND its display-rounded form must be in the allowed set so the gate passes.
        """
        # MER cur: 323_866_880 / 144_114_849 ≈ 2.25x → mer_x100 = 224
        # MER pri: 315_465_530 / 121_395_726 ≈ 2.60x → mer_x100 = 259
        # %-change = (224 * 10000 // 259) - 10000 = 8649 - 10000 = -1351 bp ≈ -13.5%
        cur = _make_period_summary(
            net_sales_mu=323_866_880,
            cm1_mu=192_152_208,
            cm2_mu=48_037_359,
            cm3_mu=20_000_000,
            total_ad_spend_mu=144_114_849,
        )
        pri = _make_period_summary(
            net_sales_mu=315_465_530,
            cm1_mu=180_000_000,
            cm2_mu=53_437_304,
            cm3_mu=22_000_000,
            total_ad_spend_mu=121_395_726,
        )
        ratio_signals = _compute_ratio_signals(cur, pri)
        # The exact MER %-change bp
        pct_sig = next(
            (s for s in ratio_signals if s.signal_id == "derived:mer_pct_change_bp"), None
        )
        assert pct_sig is not None

        # Build the full signal set with money signals too
        all_signals = [
            Signal("net_sales_mu", cur.net_sales_mu),
            Signal("total_ad_spend_mu", cur.total_ad_spend_mu),
            *ratio_signals,
        ]

        # The display-rounded form of pct_sig.value_canonical (in bp)
        # _format_pct(pct_sig.value_canonical) gives the display string
        pct_display = _format_pct(pct_sig.value_canonical)

        # Build a narration that quotes the display string verbatim
        narration = json.dumps({
            "insights": [{
                "title": "MER efficiency declined",
                "severity": "warning",
                "confidence": 90,
                "summary": f"MER declined {pct_display} vs prior period.",
                "detail": f"Ad spend efficiency loss of {pct_display} is concerning.",
                "recommendation": {"action": "REDUCE_AD_SPEND", "entity_id": "total_ad_spend_mu",
                                   "rationale": "Reduce budget."},
                "metrics": ["total_ad_spend_mu"],
            }]
        })
        result = validate_faithfulness(narration, all_signals)
        assert result.ok is True, (
            f"MER %-change {pct_display} (bp={pct_sig.value_canonical}) must pass faithfulness gate. "
            f"offending={result.offending_numbers}"
        )

    def test_mer_pct_change_not_emitted_when_prior_ad_spend_zero(self) -> None:
        """MER %-change is not emitted when prior ad spend is zero (no division)."""
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=0,  # zero → skip MER %-change
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:mer_pct_change_bp" not in ids, (
            "MER %-change must NOT be emitted when prior ad_spend is 0"
        )

    def test_acos_not_emitted_when_net_sales_zero(self) -> None:
        """ACOS is not emitted when net_sales is zero (no division)."""
        cur = _make_period_summary(
            net_sales_mu=0,  # zero → skip ACOS
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            total_ad_spend_mu=36_000_000,
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:acos_bp" not in ids, (
            "ACOS must NOT be emitted when current net_sales is 0"
        )

    # -----------------------------------------------------------------------
    # Non-regression: existing B3-style ratios still work
    # -----------------------------------------------------------------------

    def test_existing_cm2_pct_signal_still_present(self) -> None:
        """Regression: CM2% signal still emitted after adding ACOS/MER %-change."""
        cur = _make_period_summary(
            net_sales_mu=100_000_000,
            cm2_mu=14_800_000,
            total_ad_spend_mu=44_600_000,
        )
        pri = _make_period_summary(
            net_sales_mu=90_000_000,
            cm2_mu=15_000_000,
            total_ad_spend_mu=36_000_000,
        )
        signals = _compute_ratio_signals(cur, pri)
        ids = {s.signal_id for s in signals}
        assert "derived:cm2_pct_bp" in ids, "CM2% signal must still be emitted"
        assert "derived:mer_x100" in ids, "MER signal must still be emitted"
        assert "derived:cm2_delta" in ids, "CM2 delta signal must still be emitted"
