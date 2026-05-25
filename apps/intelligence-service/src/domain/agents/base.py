"""
domain/agents/base.py — PageInsightAgent base class + @agent_tools decorator.

VETO GATE 5 (CF-C5-INJECTION-SCOPE-4):
  Per-agent tool allow-list declared STATICALLY at the agent-class definition
  via @agent_tools(scope=[...]). Verified at instantiation. Enforced at
  gateway dispatch (graduation_middleware.dispatch_tool_call).

  This kills the legacy pattern of passing the FULL tool list per call
  (legacy: `tools: AI_TOOLS` at `module/ai/chat/index.ts:61`).

  The SCOPE CHECK in dispatch_tool_call reads the registered allow-list from
  graduation_middleware._AGENT_TOOL_SCOPES — it is set at class definition time,
  not per-call. A live call cannot override the allow-list.

Agent ↔ gateway contract (LOCKED from §handoff-seam):
  Agent calls GatewayClient.complete(request) — NEVER LiteLLM directly.
  The agent constructs GatewayRequest with:
    - paradigm (from @paradigm on the narrate method)
    - signals (from compute_signals — Tier-A, NO LLM)
    - system_template (static Brain-authored template)
    - untrusted_blocks (pre-processed by injection preprocessor)
    - workspace_id (from JWT ctx)
    - filters_hash (for deterministic cache)
"""

from __future__ import annotations

import functools
import logging
from typing import Any, Callable, Sequence, TypeVar

from application.gateway.graduation_middleware import register_agent_scope

logger = logging.getLogger(__name__)

C = TypeVar("C", bound=type)


def agent_tools(*, scope: list[str]) -> Callable[[C], C]:
    """Declare the static tool allow-list for an agent class.

    Usage:
        @agent_tools(scope=["get_pnl_metrics"])
        class PnlInsightAgent(PageInsightAgent): ...

    The scope list is immutable after decoration. The agent's class-level
    attribute `_tool_scope` is set to frozenset(scope).
    graduation_middleware.register_agent_scope() is called at decoration time
    so the dispatch layer has the allow-list before any instance is created.

    CF-C5-INJECTION-SCOPE-4: scope declared at class definition, not per-call.
    Any out-of-scope tool-call is DROPPED at gateway dispatch.
    """
    def decorator(cls: C) -> C:
        agent_id: str = getattr(cls, "agent_id", cls.__name__)
        frozen_scope: frozenset[str] = frozenset(scope)

        # Register with the dispatch layer at class-definition time.
        register_agent_scope(agent_id, list(frozen_scope))

        # Set as a class-level attribute (read by dispatch + tests).
        cls._tool_scope = frozen_scope  # type: ignore[attr-defined]

        return cls
    return decorator


class PageInsightAgent:
    """Base class for page-insight agents.

    Each concrete subclass must:
    1. Be decorated with @agent_tools(scope=[...]) (Gate 5).
    2. Set class-level `agent_id: str`.
    3. Implement `build_context()` with @paradigm("sql").
    4. Implement `compute_signals()` with @paradigm("sql").
    5. Call `self.gateway.complete()` for narration (Gate 1 enforcement point).

    CF-C5-SCOPE-SPLIT-1: 5a pnl agent is READ-ONLY (scope=["get_pnl_metrics"]).
    Write tools are defined (Iron-Law, Gate 3) but not in any 5a agent's scope.
    """

    agent_id: str = "page_insight_agent"
    _tool_scope: frozenset[str] = frozenset()

    def __init__(
        self,
        *,
        gateway: Any,  # GatewayClient
    ) -> None:
        """
        Args:
            gateway: a GatewayClient instance. The agent MUST NOT hold a
                     reference to litellm or any LLM SDK directly.
                     CF-BN-NOLEGACY-1 + CF-C5-PARADIGM-IMPL-1.
        """
        self.gateway = gateway
        # Verify scope was declared via @agent_tools (not the default empty set).
        if not self._tool_scope and self.__class__.__name__ != "PageInsightAgent":
            logger.warning(
                "PageInsightAgent subclass %s has no @agent_tools scope declared. "
                "CF-C5-INJECTION-SCOPE-4: apply @agent_tools(scope=[...]) to the class.",
                self.__class__.__name__,
            )
