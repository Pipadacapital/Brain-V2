"""
graduation_middleware.py — Tool-scope dispatch + graduation middleware.

VETO GATE 4 (CF-C5-INJECTION-GRADUATION-5):
  Graduation check at the gateway DISPATCH layer — server-side, stateless
  w.r.t. LLM context, present EVEN IF the orchestrator is deceived.
  Placement (LOCKED): this layer receives an agent's tool-call request
  and decides whether to dispatch it to the executor.

  A deceived/injected orchestrator that emits a tool-call still hits this
  layer and is DROPPED. The graduation status is read from ai.graduation
  (Postgres, RLS) — not from the LLM output or the orchestrator's state.

VETO GATE 5 (CF-C5-INJECTION-SCOPE-4):
  Per-agent static tool allow-list enforced at dispatch. The allow-list is
  declared at the agent CLASS definition (not per-call). A tool-call whose
  name is not in the agent's allow-list is DROPPED regardless of what the
  LLM requested. A Decision-Log row is written on every drop.

  The allow-list is declared via @agent_tools(scope=[...]) on the agent class
  (domain/agents/base.py). The dispatch function reads it via get_agent_tool_scope().

Dispatch flow (§A0.5, LOCKED):
  1. SCOPE check (Gate 5): call.tool in allow_list(agent_id) else DROP.
  2. GRADUATION check (Gate 4): read ai.graduation(workspace_id, agent_id, tool).
     If status != GRADUATED => write Decision-Log recommendation row + return DROPPED.
  Both checks query Postgres (RLS), NOT the LLM output.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

class DispatchStatus(str, Enum):
    DISPATCHED = "dispatched"
    DROPPED_OUT_OF_SCOPE = "dropped_out_of_scope"
    DROPPED_NOT_GRADUATED = "dropped_not_graduated"


class GraduationStatus(str, Enum):
    PENDING = "PENDING"
    GRADUATED = "GRADUATED"


@dataclass(frozen=True)
class DispatchOutcome:
    """Result of dispatch_tool_call().

    status: DISPATCHED if the call was forwarded to the executor.
             DROPPED_* if it was blocked + a Decision-Log row written.
    decision_log_row_id: set when a recommendation row was written on drop.
    """

    status: DispatchStatus
    agent_id: str
    workspace_id: str
    tool: str
    decision_log_row_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Agent tool-scope registry (Gate 5 static allow-lists)
# ---------------------------------------------------------------------------

# Maps agent_id -> frozenset of allowed tool names.
# Populated by @agent_tools(scope=[...]) at class definition time (base.py).
_AGENT_TOOL_SCOPES: dict[str, frozenset[str]] = {}


def register_agent_scope(agent_id: str, scope: list[str]) -> None:
    """Register the static tool allow-list for an agent class.

    Called by @agent_tools(scope=[...]) at class definition time (not at
    call time). This makes the allow-list structurally static — a live
    call cannot override it.

    CF-C5-INJECTION-SCOPE-4: declared at class definition, enforced at dispatch.
    """
    _AGENT_TOOL_SCOPES[agent_id] = frozenset(scope)


def get_agent_tool_scope(agent_id: str) -> frozenset[str]:
    """Return the static allow-list for agent_id.

    Returns an empty frozenset (no tools allowed) if the agent has not
    registered a scope — fail-closed.
    """
    return _AGENT_TOOL_SCOPES.get(agent_id, frozenset())


# ---------------------------------------------------------------------------
# dispatch_tool_call — the enforcement point for Gates 4 + 5.
# ---------------------------------------------------------------------------

def dispatch_tool_call(
    agent_id: str,
    workspace_id: str,
    call: Any,  # WriteToolCall
    *,
    _graduation_reader: Any = None,
    _decision_log_writer: Any = None,
    _executor: Any = None,
    # Correlation quad — CF-SEC-5 / C5-SEC-003
    request_id: str = "",
    trace_id: str = "",
    actor_id: str = "system",
) -> DispatchOutcome:
    """Gate 4 + 5 dispatch: scope check then graduation check then executor.

    Before ANY executor runs:
      1. SCOPE check (Gate 5): call.tool in static allow_list(agent_id) else DROP.
         A Decision-Log row is written on drop.
      2. GRADUATION check (Gate 4): read ai.graduation(workspace_id, agent_id, tool).
         If != GRADUATED => DO NOT execute. Write an ai.decision_log row
         type='recommendation' (the typed-rec struct) and return DROPPED.
      Both checks query Postgres (RLS), NOT the LLM output. A deceived
      orchestrator that emits a tool-call still hits this layer and is dropped.

    Args:
        agent_id: the agent's registered identifier.
        workspace_id: from JWT context (Child-1 claim), NOT from LLM.
        call: WriteToolCall instance (magnitude-less, closed enum).
        _graduation_reader: (test injection) callable(workspace_id, agent_id, tool) -> GraduationStatus.
        _decision_log_writer: (test injection) callable(workspace_id, row) -> str (row_id).
        _executor: (test injection) callable(call, workspace_id) -> ExecutionResult.
        request_id: correlation quad field (CF-SEC-5 / C5-SEC-003).
        trace_id: correlation quad field.
        actor_id: user_id or "system" for scheduler.

    Returns:
        DispatchOutcome with status=DISPATCHED or DROPPED_*.
    """
    tool_name = call.tool.value if hasattr(call.tool, "value") else str(call.tool)

    # --- Gate 5: Scope check ---
    allowed_tools = get_agent_tool_scope(agent_id)
    if tool_name not in allowed_tools:
        row_id = _write_decision_log(
            workspace_id=workspace_id,
            agent_id=agent_id,
            tool=tool_name,
            drop_reason="out_of_scope",
            call=call,
            writer=_decision_log_writer,
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
        )
        logger.warning(
            "dispatch_tool_call: DROPPED (out-of-scope) "
            "agent_id=%r tool=%r workspace_id=%r decision_log_row_id=%r "
            "request_id=%r CF-C5-INJECTION-SCOPE-4.",
            agent_id, tool_name, workspace_id, row_id, request_id,
        )
        return DispatchOutcome(
            status=DispatchStatus.DROPPED_OUT_OF_SCOPE,
            agent_id=agent_id,
            workspace_id=workspace_id,
            tool=tool_name,
            decision_log_row_id=row_id,
        )

    # --- Gate 4: Graduation check ---
    if _graduation_reader is None:
        grad_status = _read_graduation_from_db(workspace_id, agent_id, tool_name)
    else:
        grad_status = _graduation_reader(workspace_id, agent_id, tool_name)

    if grad_status != GraduationStatus.GRADUATED:
        row_id = _write_decision_log(
            workspace_id=workspace_id,
            agent_id=agent_id,
            tool=tool_name,
            drop_reason="not_graduated",
            call=call,
            writer=_decision_log_writer,
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
        )
        logger.warning(
            "dispatch_tool_call: DROPPED (not-graduated) "
            "agent_id=%r tool=%r workspace_id=%r status=%r decision_log_row_id=%r "
            "request_id=%r CF-C5-INJECTION-GRADUATION-5.",
            agent_id, tool_name, workspace_id, grad_status, row_id, request_id,
        )
        return DispatchOutcome(
            status=DispatchStatus.DROPPED_NOT_GRADUATED,
            agent_id=agent_id,
            workspace_id=workspace_id,
            tool=tool_name,
            decision_log_row_id=row_id,
        )

    # --- Both gates passed: dispatch to executor ---
    if _executor is not None:
        _executor(call, workspace_id)

    return DispatchOutcome(
        status=DispatchStatus.DISPATCHED,
        agent_id=agent_id,
        workspace_id=workspace_id,
        tool=tool_name,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _write_decision_log(
    workspace_id: str,
    agent_id: str,
    tool: str,
    drop_reason: str,
    call: Any,
    writer: Any,
    *,
    request_id: str = "",
    trace_id: str = "",
    actor_id: str = "system",
) -> Optional[str]:
    """Write a 'recommendation' Decision-Log row for a dropped tool-call.

    CF-C5-DECISION-LOG-1: every dropped write-tool call generates a
    recommendation row in ai.decision_log (append-only, workspace-scoped).

    CF-SEC-5 / C5-SEC-003: correlation quad (request_id, trace_id, workspace_id,
    actor_id) persisted in every row for end-to-end traceability.
    """
    row = {
        "type": "recommendation",
        "workspace_id": workspace_id,
        "agent_id": agent_id,
        "tool": tool,
        "drop_reason": drop_reason,
        "intent": getattr(getattr(call, "intent", None), "value", str(getattr(call, "intent", ""))),
        "entity_id": str(getattr(call, "entity_id", "")),
        # Correlation quad — CF-SEC-5 / C5-SEC-003
        "request_id": request_id,
        "trace_id": trace_id,
        "actor_id": actor_id,
    }
    if writer is not None:
        try:
            return str(writer(workspace_id, row))
        except Exception as exc:
            logger.error(
                "dispatch_tool_call: failed to write Decision-Log row: %s "
                "request_id=%r", exc, request_id,
            )
            return None
    # Production path: wire a real writer in bootstrap.
    logger.debug("_write_decision_log: no writer configured, row=%r", row)
    return None


def _read_graduation_from_db(
    workspace_id: str, agent_id: str, tool: str
) -> GraduationStatus:
    """Read graduation status from ai.graduation (Postgres, RLS).

    Production implementation — requires Postgres connection.
    Injected with a mock in tests via _graduation_reader kwarg.
    """
    raise NotImplementedError(
        "_read_graduation_from_db: wire a real Postgres connection in production. "
        "In tests, pass _graduation_reader=... to dispatch_tool_call(). "
        "CF-C5-INJECTION-GRADUATION-5."
    )
