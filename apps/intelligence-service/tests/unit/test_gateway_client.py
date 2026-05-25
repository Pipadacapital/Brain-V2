"""
test_gateway_client.py — LLM gateway client tests.

CF-C5-PARADIGM-IMPL-1: Gate 1 enforcement at dispatch boundary.
CF-C5-FAITHFULNESS-1: Gate 2 faithfulness middleware in gateway.
CF-C5-LAYER3-CAP-1: Layer-3 monthly cap meter.
CF-C5-RESIDENCY-1: India-resident routing assertion.
CF-C5-CACHE-STRATEGY-1: filtersHash cache + semantic cache stub.

NO real LLM calls — all tests use mocked gateway client.
"""

from __future__ import annotations

import pytest

from brain_cost_router import ParadigmViolation, paradigm
from application.gateway.client import (
    GatewayClient,
    GatewayRequest,
    GatewayResponse,
    assert_india_residency,
    _filters_cache,
    _layer3_meter,
)
from domain.faithfulness.validator import Signal


# ---------------------------------------------------------------------------
# Gate 1: paradigm enforcement at gateway dispatch boundary
# ---------------------------------------------------------------------------

class TestGatewayGate1Enforcement:
    """Gate 1: @paradigm("sql") reaching GatewayClient.complete() -> ParadigmViolation."""

    def test_sql_tier_calling_gateway_raises(self) -> None:
        """A @paradigm("sql") function that calls gateway.complete() -> violation."""
        gateway = GatewayClient()

        @paradigm("sql")
        def bad_context_builder(workspace_id: str) -> None:
            # This simulates a context_builder incorrectly calling the gateway.
            request = GatewayRequest(
                paradigm="sql",
                signals=[],
                system_template="sys",
                workspace_id=workspace_id,
            )
            gateway.complete(request)

        with pytest.raises(ParadigmViolation) as exc_info:
            bad_context_builder(workspace_id="ws_test")

        assert exc_info.value.active_tier == "sql"

    def test_small_llm_tier_passes_gateway_dispatch(self) -> None:
        """@paradigm("small_llm") function calling gateway -> passes the dispatch gate."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 50, 30

        gateway = GatewayClient(_litellm_caller=mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            request = GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate the following metrics.",
                workspace_id=workspace_id,
                agent_id="pnl_insight_agent",
            )
            return gateway.complete(request)

        result = narrate(workspace_id="ws_test")
        assert result.narration == "Revenue was ₹1,20,000."
        assert result.faithfulness.ok is True


# ---------------------------------------------------------------------------
# Faithfulness middleware in gateway
# ---------------------------------------------------------------------------

class TestGatewayFaithfulnessMiddleware:
    """Gate 2: faithfulness validation in the gateway response path."""

    def test_faithful_narration_passes(self) -> None:
        """LLM output matches signal values -> faithfulness.ok=True."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Net sales were ₹1,20,000 this week.", 40, 20

        gateway = GatewayClient(_litellm_caller=mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
            ))

        result = narrate(workspace_id="ws_faith")
        assert result.faithfulness.ok is True

    def test_hallucinated_narration_retried_then_fails(self) -> None:
        """LLM output contains hallucinated number -> 1 retry then ValueError."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        call_count = [0]

        def mock_litellm_always_hallucinate(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            return "Net sales were ₹1,40,000 which is amazing.", 40, 20

        gateway = GatewayClient(_litellm_caller=mock_litellm_always_hallucinate)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
            ))

        with pytest.raises(ValueError, match="Faithfulness validation failed"):
            narrate(workspace_id="ws_faith")

        # Should have been called exactly 2 times (1 attempt + 1 retry).
        assert call_count[0] == 2

    def test_faithfulness_succeeds_on_retry(self) -> None:
        """First attempt fails faithfulness, retry succeeds."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        call_count = [0]

        def mock_litellm_retry_ok(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            if call_count[0] == 1:
                return "Net sales were ₹1,40,000.", 40, 20  # Fail
            return "Net sales were ₹1,20,000.", 40, 20  # Pass on retry

        gateway = GatewayClient(_litellm_caller=mock_litellm_retry_ok)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
            ))

        result = narrate(workspace_id="ws_retry")
        assert result.narration == "Net sales were ₹1,20,000."
        assert result.faithfulness.ok is True
        assert call_count[0] == 2  # 1 fail + 1 retry


# ---------------------------------------------------------------------------
# Layer-3 cap
# ---------------------------------------------------------------------------

class TestLayer3Cap:
    def test_cap_exceeded_raises_runtime_error(self) -> None:
        """Layer-3 monthly cap exceeded -> RuntimeError."""
        # Set a very low cap.
        _layer3_meter.set_cap("ws_cap_test", 100)  # 100 paise = ₹1
        # Simulate the workspace having already spent 200 paise.
        _layer3_meter._spend["ws_cap_test"] = 200

        signals = [Signal(signal_id="x", value_canonical=1)]

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was 1.", 10, 5

        gateway = GatewayClient(_litellm_caller=mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
            ))

        with pytest.raises(RuntimeError, match="Layer-3 monthly LLM cap exceeded"):
            narrate(workspace_id="ws_cap_test")

        # Cleanup
        del _layer3_meter._spend["ws_cap_test"]
        if "ws_cap_test" in _layer3_meter._caps:
            del _layer3_meter._caps["ws_cap_test"]


# ---------------------------------------------------------------------------
# filtersHash cache
# ---------------------------------------------------------------------------

class TestFiltersHashCache:
    def test_cache_hit_returns_cached_response(self) -> None:
        """filtersHash cache: second call with same hash returns cached result."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        call_count = [0]

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            return "Revenue was ₹1,20,000.", 40, 20

        gateway = GatewayClient(_litellm_caller=mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str, fh: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                filters_hash=fh,
            ))

        # First call: cache miss -> LLM called.
        r1 = narrate(workspace_id="ws_cache", fh="hash_abc123")
        assert call_count[0] == 1
        assert r1.cached is False

        # Second call: cache hit -> LLM NOT called.
        r2 = narrate(workspace_id="ws_cache", fh="hash_abc123")
        assert call_count[0] == 1  # LLM not called again.
        assert r2.cached is True
        assert r2.narration == "Revenue was ₹1,20,000."

    def test_different_workspace_does_not_share_cache(self) -> None:
        """Workspace-scoped cache: different workspace -> separate cache entries."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        call_count = [0]

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            call_count[0] += 1
            return "Revenue was ₹1,20,000.", 40, 20

        gateway = GatewayClient(_litellm_caller=mock_litellm)

        @paradigm("small_llm")
        def narrate(workspace_id: str, fh: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                filters_hash=fh,
            ))

        # Two different workspaces with the same hash -> two LLM calls.
        r1 = narrate(workspace_id="ws_X", fh="same_hash")
        r2 = narrate(workspace_id="ws_Y", fh="same_hash")
        assert call_count[0] == 2  # Both missed cache -> cross-tenant isolation.


# ---------------------------------------------------------------------------
# Decision-Log write middleware
# ---------------------------------------------------------------------------

class TestDecisionLogMiddleware:
    def test_decision_log_written_on_every_synthesis(self) -> None:
        """Every gateway.complete() call writes a Decision-Log row."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        dl_rows: list[dict] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        def mock_dl_writer(workspace_id: str, row: dict) -> str:
            dl_rows.append(row)
            return "dl_row_001"

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=mock_dl_writer,
        )

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                agent_id="pnl_insight_agent",
            ))

        narrate(workspace_id="ws_dl")
        assert len(dl_rows) == 1
        row = dl_rows[0]
        assert row["type"] == "insight"
        assert row["workspace_id"] == "ws_dl"
        assert row["agent_id"] == "pnl_insight_agent"
        assert row["faithfulness_ok"] is True

    def test_decision_log_contains_correlation_quad(self) -> None:
        """C5-SEC-003: Decision-Log row must carry the full correlation quad.

        request_id + trace_id + workspace_id + actor_id must ALL be present
        so every synthesis row is traceable end-to-end.  This is the killed
        mutant for C5-SEC-003 traceability.
        """
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        dl_rows: list[dict] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        def mock_dl_writer(workspace_id: str, row: dict) -> str:
            dl_rows.append(row)
            return "dl_row_c5sec003"

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=mock_dl_writer,
        )

        @paradigm("small_llm")
        def narrate(workspace_id: str) -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                agent_id="pnl_insight_agent",
                # Correlation quad — C5-SEC-003
                request_id="req-abc-123",
                trace_id="trace-xyz-789",
                actor_id="user-jatin",
            ))

        narrate(workspace_id="ws_trace_test")
        assert len(dl_rows) == 1
        row = dl_rows[0]
        # workspace_id was already there
        assert row["workspace_id"] == "ws_trace_test"
        # C5-SEC-003: request_id, trace_id, actor_id must be in the row
        assert "request_id" in row, "C5-SEC-003: request_id missing from Decision-Log row"
        assert "trace_id" in row, "C5-SEC-003: trace_id missing from Decision-Log row"
        assert "actor_id" in row, "C5-SEC-003: actor_id missing from Decision-Log row"
        assert row["request_id"] == "req-abc-123"
        assert row["actor_id"] == "user-jatin"

    def test_decision_log_daily_tick_uses_system_actor(self) -> None:
        """Daily-tick path: actor_id defaults to 'system', request_id to 'system'."""
        signals = [Signal(signal_id="net_sales_mu", value_canonical=120_000)]
        dl_rows: list[dict] = []

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        def mock_dl_writer(workspace_id: str, row: dict) -> str:
            dl_rows.append(row)
            return "dl_row_tick"

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=mock_dl_writer,
        )

        @paradigm("small_llm")
        def narrate_tick(workspace_id: str) -> GatewayResponse:
            # No request_id/actor_id: defaults = "system" for daily tick
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=signals,
                system_template="Narrate.",
                workspace_id=workspace_id,
                agent_id="pnl_insight_agent",
            ))

        narrate_tick(workspace_id="ws_tick")
        assert len(dl_rows) == 1
        row = dl_rows[0]
        # Default values must be "system" for the scheduler path
        assert row["actor_id"] == "system"
        assert row["request_id"] == ""  # empty string is the no-request default


# ---------------------------------------------------------------------------
# India residency assertion
# ---------------------------------------------------------------------------

class TestIndiaResidencyAssertion:
    def test_wrong_postgres_region_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_REGION != ap-south-1 -> EnvironmentError."""
        monkeypatch.setenv("POSTGRES_REGION", "us-east-1")
        with pytest.raises(EnvironmentError, match="India residency violation"):
            assert_india_residency()

    def test_correct_region_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_REGION=ap-south-1 -> no error."""
        monkeypatch.setenv("POSTGRES_REGION", "ap-south-1")
        assert_india_residency()  # Should not raise.

    def test_unset_region_passes_for_5a(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """POSTGRES_REGION unset -> accepted for 5a build (tripwire HELD for 5b)."""
        monkeypatch.delenv("POSTGRES_REGION", raising=False)
        assert_india_residency()  # Should not raise for 5a surface.
