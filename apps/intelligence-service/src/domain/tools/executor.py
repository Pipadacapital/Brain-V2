"""
executor.py — Iron-Law executor (VETO Gate 3).

CF-C5-INJECTION-EXECUTOR-2 (CRITICAL): magnitude is sourced server-side from
ai.workspace_action_cap at execution time. The LLM arg CANNOT contain a
magnitude (WriteToolCall schema rejects/drops it — see tool_contract.py).

Per-call cap: per_call_max_mu from ai.workspace_action_cap.
Per-day aggregate cap: sum of today's executed magnitudes for (workspace_id, tool);
  if sum + this > daily_max => reject.

5a context: execute_write_tool is NOT reached at runtime (graduation middleware
DROPS all write-tool calls for un-graduated agents — Gate 4). The contract +
caps are BUILT now so graduation never opens an undefended path. The pnl agent's
scope is read-only — write tools are exercised by unit tests only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Optional


@dataclass(frozen=True)
class WorkspaceActionCap:
    """Server-side magnitude cap for a (workspace_id, tool) pair.

    Sourced from ai.workspace_action_cap (Postgres, under RLS).
    CF-C5-INJECTION-EXECUTOR-2: money is BIGINT minor-units, never float.
    """

    workspace_id: str
    tool: str
    per_call_max_mu: int  # BIGINT minor-units — max magnitude per single call
    per_day_max_mu: int   # BIGINT minor-units — max aggregate magnitude per day


class ExecutionStatus(str, Enum):
    EXECUTED = "executed"
    REJECTED_PER_CALL_CAP = "rejected_per_call_cap"
    REJECTED_PER_DAY_CAP = "rejected_per_day_cap"


@dataclass(frozen=True)
class ExecutionResult:
    """Result of execute_write_tool().

    executed_magnitude_mu is set only when status=EXECUTED.
    It reflects the SERVER-SIDE resolved magnitude — NEVER the LLM arg.
    """

    status: ExecutionStatus
    executed_magnitude_mu: Optional[int]  # None if rejected
    workspace_id: str
    tool: str
    entity_id: str
    intent: str


def resolve_magnitude(
    intent: str,
    cap: WorkspaceActionCap,
    *,
    requested_fraction_bp: int = 10_000,
) -> int:
    """Resolve magnitude from intent + server-side cap.

    PAUSE: magnitude = 0 (no spend change).
    INCREASE/DECREASE: magnitude = floor(per_call_max_mu * requested_fraction_bp / 10_000).
      Default fraction is 10_000 bp = 100% of cap (current behaviour).
      When intent-to-magnitude mapping gains granularity (e.g. "increase by 50%")
      the fraction is set < 10_000. A fraction > 10_000 still returns at most
      per_call_max_mu (clamped), which is how the per-call cap check fires.

    requested_fraction_bp: basis-points fraction of the per-call cap.
      10_000 bp = 100% (default). BIGINT arithmetic — no float.

    The LLM emits only the intent (PAUSE/INCREASE/DECREASE).
    The magnitude is ALWAYS sourced server-side here — never from LLM args.
    CF-C5-INJECTION-EXECUTOR-2.
    """
    from .tool_contract import IntentEnum

    intent_enum = IntentEnum(intent)
    if intent_enum == IntentEnum.PAUSE:
        return 0
    # Integer-only arithmetic: cap × fraction_bp // 10_000.
    # Fraction > 10_000 bp will produce a magnitude that exceeds per_call_max_mu,
    # which is exactly what makes the per-call cap check non-vacuous for future
    # fine-grained intent mappings. No float anywhere.
    return int(cap.per_call_max_mu * requested_fraction_bp // 10_000)


def execute_write_tool(
    call: Any,  # WriteToolCall — typed as Any to avoid circular import in tests
    workspace_id: str,  # from JWT ctx, not LLM
    *,
    _cap_reader: Any = None,
    _daily_aggregate_reader: Any = None,
    _daily_aggregate_writer: Any = None,
    _requested_fraction_bp: int = 10_000,
) -> ExecutionResult:
    """Execute a write tool call with server-side magnitude enforcement.

    Magnitude is read from ai.workspace_action_cap (Postgres, RLS) — NEVER
    from the LLM's tool-call args. Per-day aggregate cap enforced here.

    Args:
        call: a WriteToolCall instance. Its schema has NO magnitude field.
              Any attempt to inject amount_mu in the JSON was silently dropped
              by Pydantic at parse time.
        workspace_id: from the JWT context (Child-1 claim), NOT from the LLM.
        _cap_reader: (test injection) callable(workspace_id, tool) -> WorkspaceActionCap.
        _daily_aggregate_reader: (test injection) callable(workspace_id, tool, day) -> int.
        _daily_aggregate_writer: (test injection) callable(workspace_id, tool, day, mu) -> None.
        _requested_fraction_bp: bp fraction of per_call_max_mu to resolve as magnitude.
            Default 10_000 bp = 100% (full cap). Values > 10_000 produce magnitude > cap
            so the per-call gate fires — used in tests to prove the check is load-bearing.

    Returns:
        ExecutionResult with status=EXECUTED and the server-side magnitude,
        or status=REJECTED_* if a cap was exceeded.

    CF-C5-INJECTION-EXECUTOR-2: the executed_magnitude_mu in the result is
    ALWAYS the server-side value from the cap record, never a value from `call`.
    """
    tool_name = call.tool.value if hasattr(call.tool, "value") else str(call.tool)
    entity_id = str(call.entity_id)
    intent = call.intent.value if hasattr(call.intent, "value") else str(call.intent)

    # --- Read the server-side cap (Postgres ai.workspace_action_cap, RLS) ---
    if _cap_reader is None:
        cap = _read_cap_from_db(workspace_id, tool_name)
    else:
        cap = _cap_reader(workspace_id, tool_name)

    # --- Resolve magnitude server-side ---
    magnitude_mu = resolve_magnitude(intent, cap, requested_fraction_bp=_requested_fraction_bp)

    # --- Per-call cap check ---
    if magnitude_mu > cap.per_call_max_mu:
        return ExecutionResult(
            status=ExecutionStatus.REJECTED_PER_CALL_CAP,
            executed_magnitude_mu=None,
            workspace_id=workspace_id,
            tool=tool_name,
            entity_id=entity_id,
            intent=intent,
        )

    # --- Per-day aggregate cap check ---
    today = date.today()
    if _daily_aggregate_reader is None:
        today_sum_mu = _read_daily_aggregate(workspace_id, tool_name, today)
    else:
        today_sum_mu = _daily_aggregate_reader(workspace_id, tool_name, today)

    if today_sum_mu + magnitude_mu > cap.per_day_max_mu:
        return ExecutionResult(
            status=ExecutionStatus.REJECTED_PER_DAY_CAP,
            executed_magnitude_mu=None,
            workspace_id=workspace_id,
            tool=tool_name,
            entity_id=entity_id,
            intent=intent,
        )

    # --- Execute and record ---
    if _daily_aggregate_writer is not None:
        _daily_aggregate_writer(workspace_id, tool_name, today, magnitude_mu)

    return ExecutionResult(
        status=ExecutionStatus.EXECUTED,
        executed_magnitude_mu=magnitude_mu,  # SERVER-SIDE value, never LLM arg
        workspace_id=workspace_id,
        tool=tool_name,
        entity_id=entity_id,
        intent=intent,
    )


# ---------------------------------------------------------------------------
# Default DB readers (production path — injected in tests)
# ---------------------------------------------------------------------------

def _read_cap_from_db(workspace_id: str, tool: str) -> WorkspaceActionCap:
    """Read workspace action cap from ai.workspace_action_cap (Postgres, RLS).

    Production implementation — requires Postgres connection.
    Injected with a mock in tests via _cap_reader kwarg.
    """
    raise NotImplementedError(
        "_read_cap_from_db: wire a real Postgres connection in production. "
        "In tests, pass _cap_reader=... to execute_write_tool(). "
        "CF-C5-INJECTION-EXECUTOR-2."
    )


def _read_daily_aggregate(workspace_id: str, tool: str, day: date) -> int:
    """Read today's sum of executed magnitudes for (workspace_id, tool).

    Production implementation — requires Postgres connection.
    """
    raise NotImplementedError(
        "_read_daily_aggregate: wire a real Postgres connection in production. "
        "In tests, pass _daily_aggregate_reader=... to execute_write_tool()."
    )
