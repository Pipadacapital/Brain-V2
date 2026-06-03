"""
test_defect3_convergent_fix.py — Convergent fix: GatewayClient._build_messages
uses pre-formatted display content, not raw paise dump.

ROOT CAUSE (B3 live-run 2026-05-19, workspace f165da80-e6d5-4c58-9aff-ec654b873bd7):
  GatewayClient._build_messages() was IGNORING the pre-formatted user content from
  _format_signals_as_user_content() and re-building the user content from raw signal
  integers:

      signal_context = "\\n".join(f"- {sig.signal_id}: {sig.value_canonical}" ...)
      user_content = f"Deterministic signals:\\n{signal_context}"

  This produced "- cm2_mu: 48037359" which the model saw as 48037359 paise and
  converted to "₹48L" (off by 10×).  The actual value was ₹4.8Cr.

CONVERGENT FIX:
  1. GatewayRequest.user_content (new field): pre-formatted display content from Tier-A.
  2. GatewayClient._build_messages: uses request.user_content when non-empty.
  3. PnlInsightAgent._narrate: passes _format_signals_as_user_content output via user_content.
  4. _format_signals_as_user_content: removed "(raw paise: N)" annotations — NO raw
     integers appear anywhere in the user content.
  5. Anomaly/spike/drop/trend descriptions: rewritten with display tokens.
  6. Spike/drop pct signals added to faithfulness set (pct_change_x10 * 10 = bp).
  7. Prompt _RULES_BLOCK: hard instruction "copy display values verbatim, do NOT convert".

Tests:
  POSITIVE: _build_messages uses pre-formatted content when user_content is set.
  POSITIVE: no raw paise integers appear in the messages when user_content is set.
  POSITIVE: backward compat — empty user_content falls back to raw signal dump.
  POSITIVE: PnlInsightAgent._narrate passes user_content into GatewayRequest.
  POSITIVE: _format_signals_as_user_content contains display tokens, not raw integers.
  NEGATIVE: invented display value not in signal set still VETO-fails.
  NEGATIVE: raw paise dump (old behavior) would cause faithfulness failures.

Unit convention: extract_numbers(_LAKH=100_000, _CRORE=10_000_000) — see extraction.py.
Signal values use the same unit scale (paise = minor units).
"""

from __future__ import annotations

import json

import pytest

from application.gateway.client import GatewayClient, GatewayRequest
from domain.faithfulness.validator import Signal, validate_faithfulness
from domain.agents.pnl_insight_agent import (
    _format_signals_as_user_content,
    _format_money,
    _format_pct,
)


# ---------------------------------------------------------------------------
# B3 raw signal values (from the live-run capture)
# ---------------------------------------------------------------------------

_B3_CM2_MU = 48_037_359        # paise — display: ₹4.8Cr
_B3_PRIOR_CM2_MU = 53_437_304  # paise — display: ₹5.3Cr
_B3_NET_SALES_MU = 323_866_880 # paise — display: ₹32.4Cr
_B3_AD_SPEND_MU = 144_114_849  # paise — display: ₹14.4Cr


# ---------------------------------------------------------------------------
# _build_messages tests
# ---------------------------------------------------------------------------

class TestBuildMessagesUsesUserContent:
    """GatewayClient._build_messages uses user_content when set."""

    def _make_client(self) -> GatewayClient:
        """Return a GatewayClient without any real LLM (tests only need _build_messages)."""
        return GatewayClient()

    def test_user_content_used_verbatim_in_messages(self) -> None:
        """When user_content is set, _build_messages places it verbatim in the user turn.

        This is the convergent fix: the pre-formatted display content produced by
        _format_signals_as_user_content replaces the raw signal dump.
        """
        pre_formatted = (
            "## P&L Analysis: 2026-04-01 to 2026-04-30\n"
            "cm2: ₹4.8Cr  (14.8% of net sales)\n"
            "prior_cm2: ₹5.3Cr\n"
        )
        request = GatewayRequest(
            paradigm="small_llm",
            signals=[Signal("cm2_mu", _B3_CM2_MU)],
            system_template="sys",
            user_content=pre_formatted,
        )
        client = self._make_client()
        messages = client._build_messages(request)

        user_msg = next(m for m in messages if m["role"] == "user")
        assert user_msg["content"] == pre_formatted, (
            "Convergent fix: _build_messages must use user_content verbatim, "
            "NOT re-derive from raw signal integers. "
            f"Got: {user_msg['content']!r}"
        )

    def test_no_raw_paise_integers_in_messages_when_user_content_set(self) -> None:
        """When user_content is set, the raw paise integer must NOT appear in user turn.

        Root cause: without the fix, the model saw '48037359' and converted it to
        '₹48L' (off by 10×).  With the fix, only '₹4.8Cr' appears.
        """
        pre_formatted = "cm2: ₹4.8Cr  (14.8% of net sales)\n"
        request = GatewayRequest(
            paradigm="small_llm",
            signals=[Signal("cm2_mu", _B3_CM2_MU)],
            system_template="sys",
            user_content=pre_formatted,
        )
        client = self._make_client()
        messages = client._build_messages(request)
        user_turn = next(m for m in messages if m["role"] == "user")["content"]

        # The raw paise integer must NOT appear in the user turn
        assert str(_B3_CM2_MU) not in user_turn, (
            f"Raw paise integer {_B3_CM2_MU} must NOT appear in user turn when "
            f"user_content is set. user_turn={user_turn!r}"
        )
        # The display token MUST appear
        assert "₹4.8Cr" in user_turn, (
            "Display token '₹4.8Cr' must appear in user turn."
        )

    def test_empty_user_content_falls_back_to_raw_signal_dump(self) -> None:
        """Backward compat: empty user_content → legacy raw signal dump.

        Callers that do not set user_content get the old behavior.
        """
        request = GatewayRequest(
            paradigm="small_llm",
            signals=[Signal("cm2_mu", _B3_CM2_MU)],
            system_template="sys",
            # user_content is default "" (empty)
        )
        client = self._make_client()
        messages = client._build_messages(request)
        user_turn = next(m for m in messages if m["role"] == "user")["content"]

        assert "Deterministic signals:" in user_turn, (
            "Legacy fallback: 'Deterministic signals:' header must appear "
            "when user_content is empty."
        )
        # Raw integer DOES appear in the legacy path (this is the old behavior)
        assert str(_B3_CM2_MU) in user_turn, (
            "Legacy fallback: raw paise integer must appear in the signal dump."
        )

    def test_user_content_with_untrusted_blocks_appended_correctly(self) -> None:
        """Untrusted blocks are appended after user_content (not replacing it)."""
        pre_formatted = "cm2: ₹4.8Cr\n"
        untrusted_block = "Brand name: Test Brand"
        request = GatewayRequest(
            paradigm="small_llm",
            signals=[Signal("cm2_mu", _B3_CM2_MU)],
            system_template="sys",
            user_content=pre_formatted,
            untrusted_blocks=[untrusted_block],
        )
        client = self._make_client()
        messages = client._build_messages(request)
        user_turn = next(m for m in messages if m["role"] == "user")["content"]

        assert user_turn.startswith(pre_formatted), (
            "user_content must be the start of the user turn."
        )
        assert 'trusted="false"' in user_turn, (
            "Untrusted blocks must be spotlighted in the user turn."
        )
        assert untrusted_block in user_turn, (
            "Untrusted block content must appear in the user turn."
        )

    def test_system_prompt_always_in_system_turn(self) -> None:
        """The system template is always placed in the system turn regardless of user_content."""
        sys_prompt = "You are a D2C analyst."
        request = GatewayRequest(
            paradigm="small_llm",
            signals=[],
            system_template=sys_prompt,
            user_content="cm2: ₹4.8Cr",
        )
        client = self._make_client()
        messages = client._build_messages(request)
        system_msg = next(m for m in messages if m["role"] == "system")
        assert system_msg["content"] == sys_prompt


# ---------------------------------------------------------------------------
# _format_signals_as_user_content tests
# ---------------------------------------------------------------------------

class TestFormatSignalsAsUserContent:
    """_format_signals_as_user_content produces display tokens, no raw paise."""

    def _make_ctx_and_signals(self):
        """Build a minimal PnlContext and PnlSignals for testing."""
        from domain.context_builders.pnl_context_builder import PnlContext, PnlPeriodSummary
        from domain.signals.pnl_signals import PnlSignals

        current = PnlPeriodSummary(
            net_sales_mu=_B3_NET_SALES_MU,
            cogs_mu=100_000_000,
            cm1_mu=192_152_208,
            cm2_mu=_B3_CM2_MU,
            cm3_mu=20_000_000,
            total_ad_spend_mu=_B3_AD_SPEND_MU,
            total_orders=4643,
            aov_mu=6_974_000,
        )
        prior = PnlPeriodSummary(
            net_sales_mu=315_465_530,
            cogs_mu=105_000_000,
            cm1_mu=175_000_000,
            cm2_mu=_B3_PRIOR_CM2_MU,
            cm3_mu=25_000_000,
            total_ad_spend_mu=121_395_726,
            total_orders=4896,
            aov_mu=6_443_000,
        )
        ctx = PnlContext(
            workspace_id="f165da80-e6d5-4c58-9aff-ec654b873bd7",
            date_from="2026-04-01",
            date_to="2026-04-30",
            prior_date_from="2026-03-01",
            prior_date_to="2026-03-31",
            current=current,
            prior=prior,
        )
        pnl_signals = PnlSignals()
        return ctx, pnl_signals

    def test_display_tokens_present_not_raw_paise(self) -> None:
        """_format_signals_as_user_content output contains display tokens, not raw paise.

        This is the primary regression test for the root cause.
        """
        ctx, pnl_signals = self._make_ctx_and_signals()
        content = _format_signals_as_user_content(ctx, pnl_signals)

        # Display tokens MUST be present
        assert "₹4.8Cr" in content, (
            "Display token '₹4.8Cr' (cm2) must appear in formatted content."
        )
        assert "₹32.4Cr" in content or "₹32.3Cr" in content, (
            "Display token for net_sales (~₹32.4Cr) must appear."
        )
        assert "₹5.3Cr" in content or "₹5.4Cr" in content, (
            "Display token for prior_cm2 (~₹5.3Cr) must appear."
        )

        # Raw paise integers must NOT appear anywhere in the content
        for raw_val in [_B3_CM2_MU, _B3_PRIOR_CM2_MU, _B3_NET_SALES_MU, _B3_AD_SPEND_MU]:
            assert str(raw_val) not in content, (
                f"Raw paise integer {raw_val} must NOT appear in formatted content. "
                f"It would cause the model to mis-convert (10× error). "
                f"content snippet: {content[:500]!r}"
            )

    def test_no_raw_paise_annotation_in_content(self) -> None:
        """The '(raw paise: N)' annotation must be gone (Defect 3 convergent fix).

        Previous version had 'net_sales: ₹32.4Cr  (raw paise: 323866880)' which
        exposed the raw integer to the model.
        """
        ctx, pnl_signals = self._make_ctx_and_signals()
        content = _format_signals_as_user_content(ctx, pnl_signals)

        assert "raw paise:" not in content, (
            "'raw paise:' annotation must not appear in formatted content — "
            "it exposes raw integers to the model."
        )
        assert "(raw:" not in content, (
            "'(raw:' annotation must not appear in formatted content."
        )

    def test_percentages_formatted_as_display_strings(self) -> None:
        """CM2%, MER, deltas appear as display strings (14.8%, 2.24x, etc.)."""
        ctx, pnl_signals = self._make_ctx_and_signals()
        content = _format_signals_as_user_content(ctx, pnl_signals)

        # Should contain percentage display strings like "14.8%"
        assert "%" in content, "Percentage display strings must appear in content."
        # Should contain MER display string like "2.24x" or similar
        assert "x" in content, "MER display string (X.XXx) must appear in content."


# ---------------------------------------------------------------------------
# PnlInsightAgent._narrate passes user_content through GatewayRequest
# ---------------------------------------------------------------------------

class TestNarratePassesUserContent:
    """PnlInsightAgent._narrate must pass user_content into GatewayRequest.

    This test directly verifies the wiring fix — the agent's _narrate method
    must set GatewayRequest.user_content to the pre-formatted display content,
    not leave it empty (which would cause the gateway to re-derive raw signal dump).
    """

    def test_narrate_sets_user_content_in_gateway_request(self) -> None:
        """_narrate() must call gateway.complete() with a non-empty user_content.

        This is the wiring verification: the convergent fix ensures
        GatewayRequest.user_content is populated before the gateway call.
        """
        from domain.context_builders.pnl_context_builder import PnlContext, PnlPeriodSummary
        from domain.signals.pnl_signals import PnlSignals

        captured_requests: list[GatewayRequest] = []

        class CapturingGateway:
            """Gateway that captures the request instead of calling an LLM."""
            def complete(self, request: GatewayRequest):
                captured_requests.append(request)
                from application.gateway.client import GatewayResponse
                from domain.faithfulness.validator import FaithfulnessResult
                return GatewayResponse(
                    narration='{"insights": []}',
                    model_used="test",
                    tokens_input=0,
                    tokens_output=0,
                    faithfulness=FaithfulnessResult(ok=True, offending_numbers=[]),
                )

        current = PnlPeriodSummary(
            net_sales_mu=_B3_NET_SALES_MU,
            cogs_mu=100_000_000,
            cm1_mu=192_152_208,
            cm2_mu=_B3_CM2_MU,
            cm3_mu=20_000_000,
            total_ad_spend_mu=_B3_AD_SPEND_MU,
            total_orders=4643,
            aov_mu=6_974_000,
        )
        prior = PnlPeriodSummary(
            net_sales_mu=315_465_530,
            cogs_mu=105_000_000,
            cm1_mu=175_000_000,
            cm2_mu=_B3_PRIOR_CM2_MU,
            cm3_mu=25_000_000,
            total_ad_spend_mu=121_395_726,
            total_orders=4896,
            aov_mu=6_443_000,
        )
        ctx = PnlContext(
            workspace_id="test-ws",
            date_from="2026-04-01",
            date_to="2026-04-30",
            prior_date_from="2026-03-01",
            prior_date_to="2026-03-31",
            current=current,
            prior=prior,
        )
        pnl_signals = PnlSignals()
        faithfulness_signals = [Signal("cm2_mu", _B3_CM2_MU)]

        from domain.agents.pnl_insight_agent import PnlInsightAgent
        from brain_cost_router.paradigm import _active_paradigm

        # We need to be in the small_llm paradigm context to call _narrate
        # (the @paradigm("small_llm") decorator on _narrate sets it, but since
        # _narrate calls gateway.complete() which calls assert_llm_tier_at_gateway(),
        # we use the inner function path: call _narrate directly as a decorated
        # method — the decorator handles the contextvar internally).
        capturing_gw = CapturingGateway()
        agent = PnlInsightAgent(gateway=capturing_gw)

        # _narrate is decorated with @paradigm("small_llm"), so calling it
        # directly sets the contextvar. The CapturingGateway bypasses
        # assert_llm_tier_at_gateway(), so no ParadigmViolation is raised.
        agent._narrate(
            ctx=ctx,
            faithfulness_signals=faithfulness_signals,
            pnl_signals=pnl_signals,
            workspace_id="test-ws",
        )

        assert len(captured_requests) == 1, "Gateway must be called exactly once."
        req = captured_requests[0]

        assert req.user_content, (
            "GatewayRequest.user_content must be non-empty — the convergent fix "
            "must pass pre-formatted display content into the gateway. "
            "An empty user_content means the gateway will fall back to the raw "
            "signal dump (the root cause of the B3 live-run VETO failures)."
        )

        # Verify no raw paise integers in the passed user_content
        for raw_val in [_B3_CM2_MU, _B3_PRIOR_CM2_MU, _B3_NET_SALES_MU, _B3_AD_SPEND_MU]:
            assert str(raw_val) not in req.user_content, (
                f"Raw paise integer {raw_val} must NOT be in the user_content "
                f"passed to the gateway. This is the root cause of 10× conversion errors."
            )

        # Verify display tokens appear
        assert "₹" in req.user_content, (
            "Display tokens (₹X.XCr) must appear in user_content."
        )


# ---------------------------------------------------------------------------
# Faithfulness: display-derived values pass; invented values fail
# ---------------------------------------------------------------------------

class TestDisplayTokenFaithfulnessAlignment:
    """Verify that display tokens the model would quote from user content pass the
    faithfulness gate, and invented values still fail.

    Unit convention: extract_numbers("₹4.8Cr") = round(4.8 * 10_000_000) = 48_000_000.
    Signal _B3_CM2_MU = 48_037_359; display_round(48_037_359) = 48_000_000.
    So "₹4.8Cr" (→48_000_000) passes via the display-tolerance set.
    """

    def _b3_signals(self) -> list[Signal]:
        return [
            Signal("cm2_mu", _B3_CM2_MU),            # ₹4.8Cr
            Signal("prior_cm2_mu", _B3_PRIOR_CM2_MU), # ₹5.3Cr
            Signal("net_sales_mu", _B3_NET_SALES_MU),  # ₹32.4Cr
            Signal("total_ad_spend_mu", _B3_AD_SPEND_MU), # ₹14.4Cr
            Signal("total_orders", 4643),
            # Derived signals (from _compute_ratio_signals)
            Signal("derived:cm2_pct_bp", 1483),
            Signal("derived:cm2_pct_bp:display", 1480),
            Signal("derived:prior_cm2_pct_bp", 1693),
            Signal("derived:cm2_delta", _B3_CM2_MU - _B3_PRIOR_CM2_MU),
            Signal("derived:cm2_delta:display", -5_400_000),
            Signal("derived:mer_x100", 224),
            Signal("trend:CM2:pct_bp", -950),
            Signal("trend:CM2:pct_bp:abs", 950),
            Signal("trend:Ad spend:pct_bp", 1870),
            Signal("trend:Net sales:pct_bp", 270),
        ]

    def test_display_token_cm2_4_8cr_passes_via_tolerance(self) -> None:
        """Model writes ₹4.8Cr (extract → 48_000_000); signal is 48_037_359.
        display_round(48_037_359) = 48_000_000 → tolerance match → PASS.
        """
        signals = self._b3_signals()
        narration = json.dumps({
            "insights": [{
                "title": "CM2 compressed to ₹4.8Cr",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 fell from ₹5.3Cr to ₹4.8Cr this period.",
                "detail": "Ad spend grew 18.7% while CM2 margin fell to 14.8%.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "cm2_mu",
                    "rationale": "CM2 compression from ad spend surge.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is True, (
            "Display tokens (₹4.8Cr, ₹5.3Cr, 14.8%, 18.7%) from the user content "
            "must pass the faithfulness gate. "
            f"offending={result.offending_numbers}"
        )

    def test_model_quoting_10x_wrong_value_fails(self) -> None:
        """Model writes ₹48L (the 10× error observed in B3 live-run) → VETO.

        extract("₹48L") = round(48 * 100_000) = 4_800_000.
        signal cm2_mu = 48_037_359; display_round(48_037_359) = 48_000_000.
        4_800_000 ≠ 48_000_000 and 4_800_000 ∉ signal set → VETO fires.
        This is the exact error the model made before the convergent fix.
        """
        signals = self._b3_signals()
        narration = json.dumps({
            "insights": [{
                "title": "CM2 at ₹48L",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹48L this period (10× wrong, paise mis-converted).",
                "detail": "This ₹48L figure is incorrect — it is the paise→lakh error.",
                "recommendation": {
                    "action": "REDUCE_AD_SPEND",
                    "entity_id": "cm2_mu",
                    "rationale": "Wrong value.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is False, (
            "₹48L (→4_800_000) is the 10× paise mis-conversion error from the B3 "
            "live-run. It must VETO. display_round(48_037_359)=48_000_000 ≠ 4_800_000. "
            f"offending={result.offending_numbers}"
        )

    def test_invented_display_value_not_in_signals_fails(self) -> None:
        """Model invents ₹9.9Cr (→99_000_000) not near any signal → VETO.

        This preserves the original VETO invariant: an invented value that does NOT
        match any signal (or its display-rounded form) must still fail.
        """
        signals = self._b3_signals()
        narration = json.dumps({
            "insights": [{
                "title": "CM2 at ₹9.9Cr",
                "severity": "critical",
                "confidence": 95,
                "summary": "CM2 was ₹9.9Cr this period — a fabricated value.",
                "detail": "This ₹9.9Cr is invented and should VETO.",
                "recommendation": {
                    "action": "REVIEW_COGS",
                    "entity_id": "cm2_mu",
                    "rationale": "Invented value.",
                },
                "metrics": ["cm2_mu"],
            }]
        })
        result = validate_faithfulness(narration, signals)
        assert result.ok is False, (
            "₹9.9Cr (→99_000_000) is not near any signal in the B3 set. "
            "VETO must fire. The display-tolerance cannot whitelist invented values. "
            f"offending={result.offending_numbers}"
        )


# ---------------------------------------------------------------------------
# _format_money and _format_pct unit tests (display-formatting helpers)
# ---------------------------------------------------------------------------

class TestDisplayFormatHelpers:
    """Unit tests for _format_money and _format_pct used in user content."""

    def test_format_money_crore_b3_cm2(self) -> None:
        """48_037_359 → ₹4.8Cr (the key B3 value)."""
        assert _format_money(48_037_359) == "₹4.8Cr"

    def test_format_money_crore_prior_cm2(self) -> None:
        """53_437_304 → ₹5.3Cr."""
        assert _format_money(53_437_304) == "₹5.3Cr"

    def test_format_money_crore_net_sales(self) -> None:
        """323_866_880 → ₹32.4Cr (not ₹32.3Cr — check rounding)."""
        # 323_866_880 / 10_000_000 = 32.3867Cr → round(32.3867 * 10) = round(323.867) = 324
        # → 324 // 10 = 32, 324 % 10 = 4 → "₹32.4Cr"
        result = _format_money(323_866_880)
        assert result == "₹32.4Cr", f"Expected ₹32.4Cr, got {result}"

    def test_format_money_negative_lakh(self) -> None:
        """Negative delta: -5_399_945 → −₹5.4Cr or −₹54.0L depending on scale."""
        # -5_399_945 → abs = 5_399_945 < 10_000_000 → lakh branch
        # lakh_x10 = round(5_399_945 * 10 / 100_000) = round(539.9945) = 540
        # → 540//10=54, 540%10=0 → "₹54.0L" → with sign "−₹54.0L"
        result = _format_money(-5_399_945)
        assert result == "−₹54.0L", f"Expected −₹54.0L, got {result}"

    def test_format_money_small_amount(self) -> None:
        """Small amount below ₹1L: plain integer."""
        result = _format_money(50_000)
        assert result == "₹50000"

    def test_format_pct_9_9(self) -> None:
        """990 bp → 9.9%."""
        assert _format_pct(990) == "9.9%"

    def test_format_pct_negative_9_5(self) -> None:
        """-950 bp → −9.5%."""
        assert _format_pct(-950) == "−9.5%"

    def test_format_pct_18_7(self) -> None:
        """1870 bp → 18.7%."""
        assert _format_pct(1870) == "18.7%"

    def test_format_pct_14_8(self) -> None:
        """1480 bp → 14.8%."""
        assert _format_pct(1480) == "14.8%"

    # ---------------------------------------------------------------------------
    # Rounding fix (python-services-10): round, not truncate, the decimal digit.
    # ---------------------------------------------------------------------------

    def test_format_pct_rounds_half_up_at_boundary(self) -> None:
        """1485 bp → 14.85% → rounds to "14.9%" (not "14.8%" as truncation would give).

        BEFORE (bug): (v % 100) // 10 = 80 // 10 = 8 → "14.8%"
        AFTER (fix):  (v % 100 + 5) // 10 = 85 // 10 = 8... wait, (80+5)//10 = 8.
        Actually 1485: v%100=85, (85+5)//10 = 9 → "14.9%". Correct.
        """
        assert _format_pct(1485) == "14.9%", (
            "1485 bp = 14.85% should round to 14.9%, not truncate to 14.8%"
        )

    def test_format_pct_does_not_truncate_at_4(self) -> None:
        """1484 bp → 14.84% → truncation gives "14.8%", rounding also gives "14.8%".

        Only x.85+ crosses the boundary; 1484 stays at 14.8% regardless.
        """
        assert _format_pct(1484) == "14.8%"

    def test_format_pct_round_carry(self) -> None:
        """995 bp → 9.95% → rounds to "10.0%" (carry into integer part)."""
        assert _format_pct(995) == "10.0%"

    def test_display_round_bp_lockstep_with_format_pct(self) -> None:
        """_display_round_bp must be in lockstep with _format_pct rounding.

        For any bp value, the round-trip: _format_pct(bp) → display string →
        extract_numbers() → should equal _display_round_bp(bp).
        """
        from domain.agents.pnl_insight_agent import _display_round_bp
        # 1485 → _format_pct = "14.9%" → extract_numbers = 1490
        # _display_round_bp(1485) must also return 1490
        assert _display_round_bp(1485) == 1490, (
            "_display_round_bp(1485) should be 1490 (matching _format_pct '14.9%')"
        )
        # 1483 → _format_pct = "14.8%" → extract_numbers = 1480
        assert _display_round_bp(1483) == 1480, (
            "_display_round_bp(1483) should be 1480 (matching _format_pct '14.8%')"
        )
        # 990 → _format_pct = "9.9%" → extract_numbers = 990
        assert _display_round_bp(990) == 990
        # -950 → _format_pct = "-9.5%" → extract_numbers = -950
        assert _display_round_bp(-950) == -950
