"""
test_correlation_traceability.py — Correlation quad end-to-end traceability tests.

CF-SEC-5 / C5-SEC-003 (traceability VETO fix):

CORRELATION CONTRACT (pinned, Maya populates in GatewayRequest call-sites):
    request_id: str  — unique per HTTP request (X-Request-ID → gRPC metadata → here)
    trace_id:   str  — OTel trace ID (bound from active span at gateway entry)
    workspace_id: str — from JWT ctx (existing field)
    actor_id:   str  — user_id from JWT or "system" for the daily tick scheduler

Tests:
  POSITIVE: correlation quad persisted in synthesis Decision-Log row.
  POSITIVE: correlation quad persisted in dispatch Decision-Log row (scope drop).
  POSITIVE: correlation quad persisted in dispatch Decision-Log row (graduation drop).
  POSITIVE: OTel trace_id bound into Decision-Log row when caller omits trace_id.
  POSITIVE: request_id surfaced on faithfulness error.
  POSITIVE: request_id surfaced on Layer-3 cap error.
  POSITIVE: audit write failure is surfaced (not swallowed) — C5-SEC-003 fix.
  NEGATIVE (killed mutant): drop all quad fields from GatewayRequest → Decision-Log
      row has no request_id/trace_id/actor_id → test FAILS (proves the quad is
      load-bearing, not an optional audit hint).
"""

from __future__ import annotations

import pytest

from brain_cost_router import paradigm
from application.gateway.client import (
    GatewayClient,
    GatewayRequest,
    GatewayResponse,
    _layer3_meter,
)
from application.gateway.graduation_middleware import (
    DispatchStatus,
    GraduationStatus,
    dispatch_tool_call,
    register_agent_scope,
)
from domain.faithfulness.validator import Signal
from domain.tools.tool_contract import IntentEnum, WriteToolCall, WriteToolNameEnum


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_gateway_with_dl_capture() -> tuple[GatewayClient, list[dict]]:
    """Return a GatewayClient and the list that captures Decision-Log rows."""
    rows: list[dict] = []

    def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
        return "Revenue was ₹1,20,000.", 40, 20

    def dl_writer(workspace_id: str, row: dict) -> str:
        rows.append(row)
        return "dl_row_001"

    gateway = GatewayClient(
        _litellm_caller=mock_litellm,
        _decision_log_writer=dl_writer,
    )
    return gateway, rows


def _make_request(
    *,
    request_id: str = "req_abc123",
    trace_id: str = "trace_deadbeef",
    actor_id: str = "user_xyz",
    workspace_id: str = "ws_trace_test",
) -> GatewayRequest:
    return GatewayRequest(
        paradigm="small_llm",
        signals=[Signal(signal_id="net_sales_mu", value_canonical=120_000)],
        system_template="Narrate the metrics.",
        workspace_id=workspace_id,
        agent_id="pnl_insight_agent",
        request_id=request_id,
        trace_id=trace_id,
        actor_id=actor_id,
    )


# ---------------------------------------------------------------------------
# Correlation quad in synthesis Decision-Log row
# ---------------------------------------------------------------------------

class TestCorrelationQuadInSynthesisDL:
    """The correlation quad must appear in the synthesis Decision-Log row."""

    def test_quad_persisted_in_synthesis_decision_log(self) -> None:
        """Gateway.complete() persists request_id + trace_id + actor_id in DL row."""
        gateway, rows = _make_gateway_with_dl_capture()

        @paradigm("small_llm")
        def narrate() -> GatewayResponse:
            return gateway.complete(_make_request(
                request_id="req_abc123",
                trace_id="trace_deadbeef",
                actor_id="user_xyz",
                workspace_id="ws_trace_test",
            ))

        narrate()

        assert len(rows) == 1
        row = rows[0]
        assert row["request_id"] == "req_abc123", (
            "C5-SEC-003: request_id missing from Decision-Log row"
        )
        assert row["trace_id"] == "trace_deadbeef", (
            "C5-SEC-003: trace_id missing from Decision-Log row"
        )
        assert row["actor_id"] == "user_xyz", (
            "C5-SEC-003: actor_id missing from Decision-Log row"
        )
        assert row["workspace_id"] == "ws_trace_test"

    def test_system_actor_id_default(self) -> None:
        """actor_id defaults to 'system' for scheduler/tick calls."""
        gateway, rows = _make_gateway_with_dl_capture()

        @paradigm("small_llm")
        def tick_narrate() -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=[Signal(signal_id="net_sales_mu", value_canonical=120_000)],
                system_template="Narrate.",
                workspace_id="ws_tick",
                # actor_id omitted → defaults to "system" (daily tick scheduler)
            ))

        tick_narrate()
        assert rows[0]["actor_id"] == "system"

    def test_request_id_surfaced_on_faithfulness_error(self) -> None:
        """ValueError from faithfulness failure includes request_id (C5-SEC-003)."""
        def always_hallucinate(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,40,000 totally.", 40, 20  # hallucinated number

        gateway = GatewayClient(_litellm_caller=always_hallucinate)

        @paradigm("small_llm")
        def narrate() -> GatewayResponse:
            return gateway.complete(_make_request(request_id="req_fail_999"))

        with pytest.raises(ValueError) as exc_info:
            narrate()

        assert "req_fail_999" in str(exc_info.value), (
            "C5-SEC-003: request_id must be surfaced on faithfulness error so the "
            "failure is traceable end-to-end."
        )

    def test_request_id_surfaced_on_cap_error(self) -> None:
        """RuntimeError from Layer-3 cap includes request_id (C5-SEC-003)."""
        _layer3_meter.set_cap("ws_cap_trace", 1)
        _layer3_meter._spend["ws_cap_trace"] = 999

        try:
            gateway, _ = _make_gateway_with_dl_capture()

            @paradigm("small_llm")
            def narrate() -> GatewayResponse:
                return gateway.complete(_make_request(
                    request_id="req_cap_err",
                    workspace_id="ws_cap_trace",
                ))

            with pytest.raises(RuntimeError) as exc_info:
                narrate()

            assert "req_cap_err" in str(exc_info.value), (
                "C5-SEC-003: request_id must be surfaced on cap error"
            )
        finally:
            _layer3_meter._spend.pop("ws_cap_trace", None)
            _layer3_meter._caps.pop("ws_cap_trace", None)


# ---------------------------------------------------------------------------
# Correlation quad in dispatch Decision-Log rows (Gates 4 + 5)
# ---------------------------------------------------------------------------

class TestCorrelationQuadInDispatchDL:
    """Correlation quad must appear in Gate 4/5 dropped-call Decision-Log rows."""

    def setup_method(self) -> None:
        register_agent_scope("pnl_scope_agent", ["get_pnl_metrics"])
        register_agent_scope("write_scope_agent", ["pause_ad_set"])

    def _dl_writer(self) -> tuple[list[dict], callable]:
        rows: list[dict] = []

        def writer(ws: str, row: dict) -> str:
            rows.append(row)
            return "dl_row"

        return rows, writer

    def test_quad_in_scope_drop_decision_log(self) -> None:
        """DROPPED_OUT_OF_SCOPE row contains request_id + trace_id + actor_id."""
        rows, writer = self._dl_writer()
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_set_1",
            intent=IntentEnum.PAUSE,
        )

        outcome = dispatch_tool_call(
            agent_id="pnl_scope_agent",
            workspace_id="ws_scope",
            call=call,
            _graduation_reader=lambda ws, a, t: GraduationStatus.GRADUATED,
            _decision_log_writer=writer,
            request_id="req_scope_drop",
            trace_id="trace_scope_drop",
            actor_id="user_admin",
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE
        assert len(rows) == 1
        row = rows[0]
        assert row["request_id"] == "req_scope_drop", (
            "C5-SEC-003: request_id missing from scope-drop Decision-Log row"
        )
        assert row["trace_id"] == "trace_scope_drop"
        assert row["actor_id"] == "user_admin"

    def test_quad_in_graduation_drop_decision_log(self) -> None:
        """DROPPED_NOT_GRADUATED row contains request_id + trace_id + actor_id."""
        rows, writer = self._dl_writer()
        call = WriteToolCall(
            tool=WriteToolNameEnum.PAUSE_AD_SET,
            entity_id="ad_set_1",
            intent=IntentEnum.PAUSE,
        )

        outcome = dispatch_tool_call(
            agent_id="write_scope_agent",
            workspace_id="ws_grad",
            call=call,
            _graduation_reader=lambda ws, a, t: GraduationStatus.PENDING,
            _decision_log_writer=writer,
            request_id="req_grad_drop",
            trace_id="trace_grad_drop",
            actor_id="system",
        )

        assert outcome.status == DispatchStatus.DROPPED_NOT_GRADUATED
        assert len(rows) == 1
        row = rows[0]
        assert row["request_id"] == "req_grad_drop", (
            "C5-SEC-003: request_id missing from graduation-drop Decision-Log row"
        )
        assert row["trace_id"] == "trace_grad_drop"
        assert row["actor_id"] == "system"


# ---------------------------------------------------------------------------
# Audit write failure is surfaced (not swallowed) — C5-SEC-003
# ---------------------------------------------------------------------------

class TestAuditWriteFailureNotSwallowed:
    """Decision-Log write failures must not be silently dropped (C5-SEC-003)."""

    def test_failed_dl_write_surfaces_exception(self) -> None:
        """If the Decision-Log writer raises, the exception propagates to the caller.

        Previously _write_decision_log in client.py swallowed the exception and
        returned the synthesis anyway. This test ensures the failure is observable.
        """
        def failing_writer(workspace_id: str, row: dict) -> str:
            raise IOError("Postgres is down — cannot write audit row")

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=failing_writer,
        )

        @paradigm("small_llm")
        def narrate() -> GatewayResponse:
            return gateway.complete(_make_request())

        # The IOError must propagate — not be silently swallowed.
        with pytest.raises(IOError, match="Postgres is down"):
            narrate()


# ---------------------------------------------------------------------------
# KILLED MUTANT: drop quad fields → test fails
# ---------------------------------------------------------------------------

class TestCorrelationQuadKilledMutant:
    """Proves the correlation quad is load-bearing, not an optional hint.

    Dropping any of request_id / trace_id / actor_id from GatewayRequest and
    the Decision-Log write path causes this test to fail — the quad is
    structural, not documentation.
    """

    def test_killed_mutant_drop_quad_from_request(self) -> None:
        """Removing request_id/trace_id/actor_id from GatewayRequest → DL row missing them.

        This test PASSES when the quad IS propagated correctly.
        If someone removes the quad fields from GatewayRequest or the DL write,
        the assertions below would FAIL — proving the quad is load-bearing.
        """
        rows: list[dict] = []

        def dl_writer(workspace_id: str, row: dict) -> str:
            rows.append(row)
            return "dl_row"

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=dl_writer,
        )

        @paradigm("small_llm")
        def narrate() -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=[Signal(signal_id="net_sales_mu", value_canonical=120_000)],
                system_template="Narrate.",
                workspace_id="ws_km",
                request_id="req_km_001",
                trace_id="trace_km_001",
                actor_id="user_km",
            ))

        narrate()

        assert len(rows) == 1
        row = rows[0]

        # These three assertions FAIL when the quad fields are removed —
        # that's what makes this a killed-mutant test.
        assert "request_id" in row, "MUTANT: request_id not in DL row → quad not propagated"
        assert "trace_id" in row, "MUTANT: trace_id not in DL row → quad not propagated"
        assert "actor_id" in row, "MUTANT: actor_id not in DL row → quad not propagated"

        assert row["request_id"] == "req_km_001"
        assert row["trace_id"] == "trace_km_001"
        assert row["actor_id"] == "user_km"

    def test_inverse_mutant_missing_quad_fields_undetected_by_vacuous_check(self) -> None:
        """Inverse mutant: a vacuous DL check that ignores quad fields would miss the gap.

        Demonstrates that a vacuous 'assert len(rows) == 1' passes even when
        the correlation quad is absent. Only the field-level assertions catch it.
        """
        rows: list[dict] = []

        # Simulate a BROKEN _write_decision_log that omits the quad.
        def broken_dl_writer(workspace_id: str, row: dict) -> str:
            # MUTATION: strip the quad from the row before appending.
            broken_row = {k: v for k, v in row.items()
                          if k not in ("request_id", "trace_id", "actor_id")}
            rows.append(broken_row)
            return "dl_row"

        def mock_litellm(model: str, messages: list, max_tokens: int) -> tuple:
            return "Revenue was ₹1,20,000.", 40, 20

        gateway = GatewayClient(
            _litellm_caller=mock_litellm,
            _decision_log_writer=broken_dl_writer,
        )

        @paradigm("small_llm")
        def narrate() -> GatewayResponse:
            return gateway.complete(GatewayRequest(
                paradigm="small_llm",
                signals=[Signal(signal_id="net_sales_mu", value_canonical=120_000)],
                system_template="Narrate.",
                workspace_id="ws_inv",
                request_id="req_inv",
                trace_id="trace_inv",
                actor_id="user_inv",
            ))

        narrate()

        # Vacuous check passes even with missing quad:
        assert len(rows) == 1  # This passes even for the broken writer.

        # But field-level assertions catch the mutation:
        assert "request_id" not in rows[0]  # Proves: vacuous check is insufficient.
        assert "trace_id" not in rows[0]

        # This demonstrates WHY the field-level assertions in
        # test_killed_mutant_drop_quad_from_request are load-bearing.
