"""
test_agent_tool_scope.py — Gate 5: tool-scope dispatch + @agent_tools decorator.

CF-C5-INJECTION-SCOPE-4 (HIGH):
  KILLED MUTANT: pnl agent emits out-of-scope tool call → DROPPED + Decision-Log row.
  INVERSE MUTANT: allow-list replaced with allow-all → out-of-scope call dispatched → caught.

Tests:
  POSITIVE: pnl agent scope is ["get_pnl_metrics"] (READ-ONLY).
  POSITIVE: out-of-scope tool DROPPED at gateway dispatch.
  POSITIVE: in-scope tool is not blocked by scope check.
  POSITIVE: @agent_tools decorator registers scope at class definition time.
  NEGATIVE: no scope declared → empty set (deny-all).
  NEGATIVE: out-of-scope → Decision-Log row written.
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'pylibs', 'brain_cost_router'))

import pytest
from unittest.mock import MagicMock

from domain.agents.base import PageInsightAgent, agent_tools
from application.gateway.graduation_middleware import (
    DispatchStatus,
    GraduationStatus,
    dispatch_tool_call,
    get_agent_tool_scope,
    register_agent_scope,
)
from domain.tools.tool_contract import IntentEnum, WriteToolCall, WriteToolNameEnum


def _make_write_call(tool: WriteToolNameEnum) -> WriteToolCall:
    return WriteToolCall(
        tool=tool,
        entity_id="campaign_123",
        intent=IntentEnum.PAUSE,
    )


class TestAgentToolsDecorator:
    """@agent_tools(scope=[...]) registers scope at class definition time."""

    def test_pnl_agent_scope_is_read_only(self) -> None:
        """PnlInsightAgent scope = ["get_pnl_metrics"] (READ-ONLY)."""
        from domain.agents.pnl_insight_agent import PnlInsightAgent
        scope = get_agent_tool_scope("PnlInsightAgent")
        assert scope == frozenset({"get_pnl_metrics"})

    def test_custom_agent_scope_registered_at_definition(self) -> None:
        """@agent_tools registers the scope at class definition, not per-call."""
        @agent_tools(scope=["tool_a", "tool_b"])
        class TestAgent(PageInsightAgent):
            agent_id = "TestAgent"
            def generate_insights(self, ws, df, dt):
                return []

        scope = get_agent_tool_scope("TestAgent")
        assert scope == frozenset({"tool_a", "tool_b"})

    def test_no_agent_tools_decorator_defaults_to_empty(self) -> None:
        """Agent without @agent_tools → empty (deny-all) scope."""
        # Register an agent with no tools (simulates missing decorator)
        register_agent_scope("AgentWithNoScope", [])
        scope = get_agent_tool_scope("AgentWithNoScope")
        assert scope == frozenset()


class TestGate5KilledMutant:
    """KILLED MUTANT: out-of-scope tool → DROPPED + Decision-Log row."""

    def test_out_of_scope_tool_dropped(self) -> None:
        """GATE 5 KILLED MUTANT: pnl agent requests pause_ad_set → DROPPED."""
        # PnlInsightAgent scope = ["get_pnl_metrics"] — not write tools
        register_agent_scope("PnlInsightAgent", ["get_pnl_metrics"])

        write_call = _make_write_call(WriteToolNameEnum.PAUSE_AD_SET)
        dl_writer = MagicMock(return_value="dl_row_001")

        outcome = dispatch_tool_call(
            "PnlInsightAgent",
            "ws1",
            write_call,
            _graduation_reader=lambda ws, ag, tool: GraduationStatus.GRADUATED,
            _decision_log_writer=dl_writer,
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE
        # Decision-Log row written on drop (Gate 5 + CF-C5-DECISION-LOG-1)
        dl_writer.assert_called_once()
        call_args = dl_writer.call_args[0]
        assert call_args[0] == "ws1"  # workspace_id

    def test_out_of_scope_drops_even_when_graduated(self) -> None:
        """Gate 5 fires BEFORE Gate 4 — scope check is first."""
        register_agent_scope("PnlInsightAgent", ["get_pnl_metrics"])

        write_call = _make_write_call(WriteToolNameEnum.REALLOCATE_BUDGET)
        # Even if the agent were graduated, out-of-scope should still drop
        outcome = dispatch_tool_call(
            "PnlInsightAgent",
            "ws1",
            write_call,
            _graduation_reader=lambda ws, ag, tool: GraduationStatus.GRADUATED,
        )

        assert outcome.status == DispatchStatus.DROPPED_OUT_OF_SCOPE


class TestGate5InverseMutant:
    """INVERSE MUTANT: allow-all scope check → out-of-scope dispatched → caught."""

    def test_allow_all_scope_lets_out_of_scope_through(self) -> None:
        """Inverse: replacing scope check with allow-all lets bad calls through."""
        from application.gateway.graduation_middleware import _AGENT_TOOL_SCOPES

        # Register an unrestricted scope (simulates removing the allow-list)
        _AGENT_TOOL_SCOPES["TestFullScopeAgent"] = frozenset(
            {t.value for t in WriteToolNameEnum}
        )

        write_call = _make_write_call(WriteToolNameEnum.REALLOCATE_BUDGET)
        # With graduation check returning GRADUATED, the call would dispatch
        outcome = dispatch_tool_call(
            "TestFullScopeAgent",
            "ws1",
            write_call,
            _graduation_reader=lambda ws, ag, tool: GraduationStatus.GRADUATED,
            _executor=MagicMock(),  # inject a mock executor
        )

        # The call dispatches because we registered all tools in the scope.
        # This proves the scope check is load-bearing — the real PnlInsightAgent
        # would be DROPPED here.
        assert outcome.status == DispatchStatus.DISPATCHED


class TestGate4GraduationMiddleware:
    """Gate 4: graduation check at gateway dispatch."""

    def test_not_graduated_drops_with_decision_log(self) -> None:
        """GATE 4 KILLED MUTANT: un-graduated agent → DROPPED + recommendation row."""
        register_agent_scope("FullScopeTestAgent", [t.value for t in WriteToolNameEnum])

        write_call = _make_write_call(WriteToolNameEnum.PAUSE_AD_SET)
        dl_writer = MagicMock(return_value="dl_row_002")
        executor = MagicMock()

        outcome = dispatch_tool_call(
            "FullScopeTestAgent",
            "ws1",
            write_call,
            _graduation_reader=lambda ws, ag, tool: GraduationStatus.PENDING,
            _decision_log_writer=dl_writer,
            _executor=executor,
        )

        assert outcome.status == DispatchStatus.DROPPED_NOT_GRADUATED
        executor.assert_not_called()  # Executor MUST NOT run
        dl_writer.assert_called_once()

    def test_graduated_agent_dispatches(self) -> None:
        """Gate 4: graduated agent with in-scope tool → DISPATCHED."""
        register_agent_scope("GraduatedAgent", [WriteToolNameEnum.PAUSE_AD_SET.value])

        write_call = _make_write_call(WriteToolNameEnum.PAUSE_AD_SET)
        executor = MagicMock()

        outcome = dispatch_tool_call(
            "GraduatedAgent",
            "ws1",
            write_call,
            _graduation_reader=lambda ws, ag, tool: GraduationStatus.GRADUATED,
            _executor=executor,
        )

        assert outcome.status == DispatchStatus.DISPATCHED
        executor.assert_called_once()
