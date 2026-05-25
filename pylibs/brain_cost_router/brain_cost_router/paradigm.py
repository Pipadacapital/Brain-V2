"""
paradigm.py — the executable @paradigm decorator.

CF-C5-PARADIGM-IMPL-1 (CRITICAL): replaces the 4-line docstring stub.

MECHANISM — the contextvar gate:
  A ContextVar[str] ("_active_paradigm") is set to the declared tier on
  function entry. GatewayClient.complete() reads this var at its dispatch
  boundary; if the active tier is "sql", "ml", or unset -> ParadigmViolation.

  This makes "no Tier-A (sql/ml) compute path may reach the LLM gateway"
  a STRUCTURAL runtime invariant:
    - A context_builder decorated @paradigm("sql") that calls the gateway
      trips at runtime — in a unit test, no grep required.
    - A 5b agent decorated @paradigm("small_llm") that calls the gateway
      passes — because small_llm is an LLM tier.

TELEMETRY — CF-C5-COST-AUDIT-1:
  One paradigm_distribution OTel counter event is emitted per invocation
  (tier, workspace_id, agent_id, latency_ms_bucket).

USAGE:
    from brain_cost_router import paradigm

    @paradigm("sql")
    def build_pnl_context(workspace_id: str, ...) -> ...:
        ...   # MAY NOT call GatewayClient.complete()

    @paradigm("small_llm")
    async def narrate(gateway: GatewayClient, ...) -> ...:
        ...   # MAY call GatewayClient.complete()
"""

from __future__ import annotations

import contextvars
import functools
import time
from typing import Callable, Literal, TypeVar

from .errors import ParadigmViolation
from .telemetry import emit_paradigm_distribution

# ---------------------------------------------------------------------------
# The four cost tiers (LOCKED in §A0.2).
# Priority: sql > ml > small_llm >> frontier_llm (1:100:1000:10000 cost ratio).
# ---------------------------------------------------------------------------

Paradigm = Literal["sql", "ml", "small_llm", "frontier_llm"]

_LLM_TIERS: frozenset[str] = frozenset({"small_llm", "frontier_llm"})
_TIER_A: frozenset[str] = frozenset({"sql", "ml"})

# ---------------------------------------------------------------------------
# The contextvar — one active tier per async / sync call context.
# Unset (MISSING) means "no paradigm declared" which is treated as Tier-A
# at the dispatch boundary (fail-closed: unknown tier cannot reach LLM).
# ---------------------------------------------------------------------------

_active_paradigm: contextvars.ContextVar[str] = contextvars.ContextVar(
    "_active_paradigm",
    default="__unset__",
)

F = TypeVar("F", bound=Callable)  # type: ignore[type-arg]


# ---------------------------------------------------------------------------
# Public API — current_paradigm() used by GatewayClient at dispatch boundary.
# ---------------------------------------------------------------------------

def current_paradigm() -> str:
    """Return the paradigm tier active in the current call context.

    Returns "__unset__" if no @paradigm decorator is active in the call stack.
    The gateway treats "__unset__" as a Tier-A violation (fail-closed).
    """
    return _active_paradigm.get()


def assert_llm_tier_at_gateway() -> None:
    """Called by GatewayClient.complete() at the dispatch boundary.

    Raises ParadigmViolation if the active paradigm is not an LLM tier.
    This is the ENFORCEMENT POINT — the gate that makes the invariant structural.

    CF-C5-PARADIGM-IMPL-1: the only path to the LLM; if a sql/ml decorated
    function ever reaches here it is caught at runtime (unit test or production).
    """
    tier = _active_paradigm.get()
    if tier not in _LLM_TIERS:
        raise ParadigmViolation(active_tier=tier)


# ---------------------------------------------------------------------------
# The decorator itself.
# ---------------------------------------------------------------------------

def paradigm(tier: Paradigm) -> Callable[[F], F]:
    """Declare + enforce the cost tier of a compute path.

    Runtime: tags the active call-context with `tier`; emits one
    paradigm_distribution telemetry event per invocation (workspace_id from
    the call's ctx, tier, latency_ms). SQL > ML > small_llm >> frontier_llm.

    ENFORCEMENT (the gate): a function decorated sql|ml that, anywhere in its
    synchronous call graph, reaches the LLM gateway dispatch boundary
    (GatewayClient.complete) raises ParadigmViolation. The gateway's
    dispatch entry asserts `current_paradigm() in {"small_llm","frontier_llm"}`
    via a contextvar set by this decorator — a deterministic path that calls
    the gateway trips the assertion. Structural, not grep.

    Args:
        tier: one of "sql" | "ml" | "small_llm" | "frontier_llm".

    Returns:
        A decorator that wraps the target function, sets the contextvar, emits
        telemetry, and restores the previous tier on exit.
    """
    if tier not in ("sql", "ml", "small_llm", "frontier_llm"):
        raise ValueError(
            f"@paradigm: unknown tier '{tier}'. "
            "Must be one of: sql, ml, small_llm, frontier_llm. "
            "CF-C5-PARADIGM-IMPL-1."
        )

    def decorator(fn: F) -> F:
        fn_name: str = getattr(fn, "__qualname__", getattr(fn, "__name__", "?"))

        @functools.wraps(fn)  # type: ignore[arg-type]
        def sync_wrapper(*args: object, **kwargs: object) -> object:
            token = _active_paradigm.set(tier)
            t0 = time.monotonic()
            try:
                result = fn(*args, **kwargs)
                return result
            except ParadigmViolation as exc:
                # Re-raise with the function name for better diagnostics.
                raise ParadigmViolation(active_tier=exc.active_tier, fn_name=fn_name) from None
            finally:
                elapsed_ms = (time.monotonic() - t0) * 1000.0
                # Resolve workspace_id from kwargs if present (best-effort).
                ws_id = str(kwargs.get("workspace_id", "unknown"))
                agent_id = str(kwargs.get("agent_id", "unknown"))
                emit_paradigm_distribution(
                    tier=tier,
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    latency_ms=elapsed_ms,
                )
                _active_paradigm.reset(token)

        @functools.wraps(fn)  # type: ignore[arg-type]
        async def async_wrapper(*args: object, **kwargs: object) -> object:
            token = _active_paradigm.set(tier)
            t0 = time.monotonic()
            try:
                result = await fn(*args, **kwargs)  # type: ignore[misc]
                return result
            except ParadigmViolation as exc:
                raise ParadigmViolation(active_tier=exc.active_tier, fn_name=fn_name) from None
            finally:
                elapsed_ms = (time.monotonic() - t0) * 1000.0
                ws_id = str(kwargs.get("workspace_id", "unknown"))
                agent_id = str(kwargs.get("agent_id", "unknown"))
                emit_paradigm_distribution(
                    tier=tier,
                    workspace_id=ws_id,
                    agent_id=agent_id,
                    latency_ms=elapsed_ms,
                )
                _active_paradigm.reset(token)

        import asyncio
        if asyncio.iscoroutinefunction(fn):
            return async_wrapper  # type: ignore[return-value]
        return sync_wrapper  # type: ignore[return-value]

    return decorator
