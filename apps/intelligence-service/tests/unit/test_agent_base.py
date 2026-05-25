"""
test_agent_base.py — Agent base class + @agent_tools decorator tests.

CF-C5-INJECTION-SCOPE-4: static allow-list registered at class definition.
"""

from __future__ import annotations

import pytest

from application.gateway.graduation_middleware import get_agent_tool_scope
from domain.agents.base import PageInsightAgent, agent_tools


class TestAgentToolsDecorator:
    def test_scope_registered_at_class_definition(self) -> None:
        """@agent_tools registers the scope at class-definition time."""

        @agent_tools(scope=["get_pnl_metrics"])
        class MyPnlAgent(PageInsightAgent):
            agent_id = "my_pnl_agent"

        scope = get_agent_tool_scope("my_pnl_agent")
        assert "get_pnl_metrics" in scope
        assert "pause_ad_set" not in scope

    def test_read_only_scope_is_frozen(self) -> None:
        """The scope is a frozenset — immutable after decoration."""

        @agent_tools(scope=["get_pnl_metrics"])
        class MyReadOnlyAgent(PageInsightAgent):
            agent_id = "my_readonly_agent"

        scope = get_agent_tool_scope("my_readonly_agent")
        assert isinstance(scope, frozenset)

    def test_empty_scope_agent_has_no_tools(self) -> None:
        """Agent with empty scope allows no tools."""

        @agent_tools(scope=[])
        class EmptyScopeAgent(PageInsightAgent):
            agent_id = "empty_scope_agent"

        scope = get_agent_tool_scope("empty_scope_agent")
        assert len(scope) == 0

    def test_agent_class_attribute_set(self) -> None:
        """@agent_tools sets _tool_scope on the class."""

        @agent_tools(scope=["get_pnl_metrics"])
        class AttrTestAgent(PageInsightAgent):
            agent_id = "attr_test_agent"

        assert hasattr(AttrTestAgent, "_tool_scope")
        assert "get_pnl_metrics" in AttrTestAgent._tool_scope

    def test_agent_instance_stores_gateway(self) -> None:
        """Agent instance holds a reference to the gateway (not litellm directly)."""

        @agent_tools(scope=["get_pnl_metrics"])
        class GwAgent(PageInsightAgent):
            agent_id = "gw_agent"

        mock_gateway = object()
        agent = GwAgent(gateway=mock_gateway)
        assert agent.gateway is mock_gateway
