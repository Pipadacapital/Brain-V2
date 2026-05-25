"""
test_gate4_gate5_dispatch.py — VETO Gates 4 + 5: graduation + scope dispatch.

VETO GATE 4 (CF-C5-INJECTION-GRADUATION-5):
  KILLED MUTANT: un-graduated agent emitting a write-call (orchestrator bypassed)
    -> DROPPED + Decision-Log recommendation row written.
  INVERSE MUTANT: moving graduation check to orchestrator (removing from dispatch)
    -> bypassed-orchestrator test dispatches the tool -> caught.

VETO GATE 5 (CF-C5-INJECTION-SCOPE-4):
  KILLED MUTANT: pnl agent requesting pause_ad_set (out of scope) -> DROPPED
    + Decision-Log row written.
  INVERSE MUTANT: replace allow-list check with `return True` -> out-of-scope
    call dispatches -> caught.
"""

from __future__ import annotations

import pytest

from application.gateway.graduation_middleware import (
    DispatchStatus,
    GraduationStatus,
    dispatch_tool_call,
    get_agent_tool_scope,
    register_agent_scope,
)
from domain.tools.tool_contract import IntentEnum, WriteToolCall, WriteToolNameEnum


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_pnl_call(tool: WriteToolNameEnum = WriteToolNameEnum.PAUSE_AD_SET) -> WriteToolCall:
    return WriteToolCall(
        tool=tool,
        entity_id="ad_set_123",
        intent=IntentEnum.PAUSE,
    )


def _graduated_reader(ws: str, agent: str, tool: str) -> GraduationStatus:
    return GraduationStatus.GRADUATED


def _not_graduated_reader(ws: str, agent: str, tool: str) -> GraduationStatus:
    return GraduationStatus.PENDING


def _dl_writer(ws: str, row: dict) -> str:
    return f"dl_row_{ws}"


# ---------------------------------------------------------------------------
# Setup: register agent scopes for tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def register_test_scopes() -> None:
    """Register test agent scopes before each test."""
    register_agent_scope("pnl_insight_agent", ["get_pnl_metrics"])
    register_agent_scope("write_capable_agent", [
        "pause_ad_set", "reallocate_budget", "get_pnl_metrics"
    ])


# ---------------------------------------------------------------------------
# VETO GATE 5 — killed mutant (scope)
# ---------------------------------------------------------------------------

class TestGate5KilledMutant:
    """KILLED MUTANT: pnl agent requesting pause_ad_set -> DROPPED."""

    def test_out_of_scope_tool_call_dropped(self) -> None:
        """GATE 5 KILLED MUTANT: pnl agent (scope=[get_pnl_metrics]) requests
        pause_ad_set -> DROPPED + Decision-Log row written."""
        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)

        outcome = dispatch_tool_call(
            agent_id="pnl_insight_agent",
            workspace_id="ws_A",
            call=call,
            _graduation_reader=_graduated_reader,
            _decision_log_writer=_dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE
        assert outcome.decision_log_row_id is not None
        assert "ws_A" in outcome.decision_log_row_id

    def test_out_of_scope_reallocate_budget_dropped(self) -> None:
        """Reallocate_budget is also out of pnl agent's scope -> DROPPED."""
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_1",
            intent=IntentEnum.INCREASE,
        )

        outcome = dispatch_tool_call(
            agent_id="pnl_insight_agent",
            workspace_id="ws_A",
            call=call,
            _graduation_reader=_graduated_reader,
            _decision_log_writer=_dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE

    def test_in_scope_tool_proceeds_to_graduation_check(self) -> None:
        """A tool that IS in scope passes the scope gate (proceeds to graduation)."""
        # get_pnl_metrics is in pnl_insight_agent scope — but it's not a WriteToolNameEnum.
        # Use write_capable_agent which has pause_ad_set in scope.
        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)

        outcome = dispatch_tool_call(
            agent_id="write_capable_agent",
            workspace_id="ws_A",
            call=call,
            _graduation_reader=_graduated_reader,  # graduated
            _decision_log_writer=_dl_writer,
        )

        # In-scope + graduated -> DISPATCHED.
        assert outcome.status == DispatchStatus.DISPATCHED


class TestGate5InverseMutant:
    """INVERSE MUTANT: replace allow-list check with return True -> out-of-scope dispatches."""

    def test_inverse_allow_all_bypasses_scope_gate(self) -> None:
        """Proves a vacuous allow-list check fails to enforce scope."""
        # Simulate the vacuous (mutant) dispatch that always allows all tools.
        def vacuous_dispatch(agent_id: str, workspace_id: str, call: WriteToolCall) -> DispatchStatus:
            # No scope check — always dispatched.
            return DispatchStatus.DISPATCHED

        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)
        # Vacuous dispatch lets the out-of-scope call through.
        result = vacuous_dispatch("pnl_insight_agent", "ws_A", call)
        assert result == DispatchStatus.DISPATCHED  # Vacuous: no enforcement.

        # Real dispatch DROPS the out-of-scope call.
        real_outcome = dispatch_tool_call(
            agent_id="pnl_insight_agent",
            workspace_id="ws_A",
            call=call,
            _graduation_reader=_graduated_reader,
            _decision_log_writer=_dl_writer,
        )
        assert real_outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE  # Real enforces.


# ---------------------------------------------------------------------------
# VETO GATE 4 — killed mutant (graduation)
# ---------------------------------------------------------------------------

class TestGate4KilledMutant:
    """KILLED MUTANT: un-graduated write-call (orchestrator bypassed) -> DROPPED."""

    def test_un_graduated_write_call_dropped(self) -> None:
        """GATE 4 KILLED MUTANT: agent not graduated -> DROPPED + Decision-Log row.

        Simulates a deceived orchestrator that emits a write-tool call without
        checking graduation. The gateway dispatch layer STILL blocks it.
        """
        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)

        outcome = dispatch_tool_call(
            agent_id="write_capable_agent",  # In scope, but NOT graduated.
            workspace_id="ws_B",
            call=call,
            _graduation_reader=_not_graduated_reader,  # PENDING, not graduated
            _decision_log_writer=_dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_NOT_GRADUATED
        assert outcome.decision_log_row_id is not None

    def test_deceived_orchestrator_bypassed_still_dropped(self) -> None:
        """Even if the orchestrator self-check is bypassed, the gateway blocks."""
        # The graduation_reader simulates reading from DB (Postgres, RLS).
        # The orchestrator's self-check is irrelevant here — we're calling
        # dispatch_tool_call directly with PENDING status.
        call = WriteToolCall(
            tool=WriteToolNameEnum.REALLOCATE_BUDGET,
            entity_id="campaign_x",
            intent=IntentEnum.INCREASE,
        )

        # Orchestrator "bypassed" — calls dispatch_tool_call directly.
        outcome = dispatch_tool_call(
            agent_id="write_capable_agent",
            workspace_id="ws_B",
            call=call,
            _graduation_reader=_not_graduated_reader,  # Gateway reads PENDING from DB.
            _decision_log_writer=_dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_NOT_GRADUATED


class TestGate4InverseMutant:
    """INVERSE MUTANT: moving graduation check to orchestrator -> bypassed -> caught."""

    def test_inverse_orchestrator_only_check_bypassable(self) -> None:
        """Proves an orchestrator-only check can be bypassed; gateway check cannot."""

        # Simulate orchestrator-only graduation check (the WRONG placement).
        class OrchestatorOnlyDispatch:
            def dispatch(
                self,
                agent_id: str,
                workspace_id: str,
                call: WriteToolCall,
                orchestrator_graduation_ok: bool,
            ) -> DispatchStatus:
                # WRONG: trusts the orchestrator's graduation result.
                if orchestrator_graduation_ok:
                    return DispatchStatus.DISPATCHED
                return DispatchStatus.DROPPED_NOT_GRADUATED

        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)
        orch_dispatch = OrchestatorOnlyDispatch()

        # A deceived orchestrator passes graduation_ok=True.
        result = orch_dispatch.dispatch("write_capable_agent", "ws_B", call,
                                        orchestrator_graduation_ok=True)
        assert result == DispatchStatus.DISPATCHED  # Bypass SUCCEEDS.

        # The REAL gateway dispatch reads from DB — orchestrator bypass fails.
        real_outcome = dispatch_tool_call(
            agent_id="write_capable_agent",
            workspace_id="ws_B",
            call=call,
            _graduation_reader=_not_graduated_reader,  # DB says PENDING.
            _decision_log_writer=_dl_writer,
        )
        assert real_outcome.status == DispatchStatus.DROPPED_NOT_GRADUATED


# ---------------------------------------------------------------------------
# Positive: graduated + in-scope -> DISPATCHED
# ---------------------------------------------------------------------------

class TestDispatchPositive:
    def test_graduated_in_scope_dispatched(self) -> None:
        """In-scope + graduated + executor called -> DISPATCHED."""
        executed: list[str] = []

        def mock_executor(call: WriteToolCall, workspace_id: str) -> None:
            executed.append(workspace_id)

        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)

        outcome = dispatch_tool_call(
            agent_id="write_capable_agent",
            workspace_id="ws_C",
            call=call,
            _graduation_reader=_graduated_reader,
            _decision_log_writer=_dl_writer,
            _executor=mock_executor,
        )

        assert outcome.status == DispatchStatus.DISPATCHED
        assert "ws_C" in executed  # Executor was actually called.

    def test_scope_registered_at_decoration_time(self) -> None:
        """The agent tool scope is static — registered at class definition."""
        scope = get_agent_tool_scope("pnl_insight_agent")
        assert "get_pnl_metrics" in scope
        assert "pause_ad_set" not in scope
        assert "reallocate_budget" not in scope

    def test_unknown_agent_has_empty_scope(self) -> None:
        """Unknown agent -> empty scope -> fail-closed (all tools dropped)."""
        call = _make_pnl_call(WriteToolNameEnum.PAUSE_AD_SET)

        outcome = dispatch_tool_call(
            agent_id="unknown_agent_xyz",
            workspace_id="ws_D",
            call=call,
            _graduation_reader=_graduated_reader,
            _decision_log_writer=_dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE
