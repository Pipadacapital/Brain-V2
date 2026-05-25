"""
errors.py — brain_cost_router public exceptions.

CF-C5-PARADIGM-IMPL-1: ParadigmViolation is raised when a function decorated
@paradigm("sql") or @paradigm("ml") has a call-graph path that reaches the LLM
gateway dispatch boundary (GatewayClient.complete). The gateway reads the
active contextvar and raises this at the dispatch boundary — structurally
un-bypassable (not a grep, not an advisory check).
"""

from __future__ import annotations


class ParadigmViolation(RuntimeError):
    """Raised when a Tier-A compute path (sql/ml) reaches the LLM gateway.

    The @paradigm decorator sets a ContextVar[Paradigm] on the active call
    context. GatewayClient.complete() reads it at the dispatch boundary; if the
    active tier is "sql", "ml", or unset -> this exception is raised immediately.

    This makes "no Tier-A surface may silently grow an LLM call" a structural
    runtime invariant, not a code-review concern.
    """

    def __init__(self, active_tier: str, fn_name: str = "") -> None:
        self.active_tier = active_tier
        self.fn_name = fn_name
        detail = f" (in '{fn_name}')" if fn_name else ""
        super().__init__(
            f"ParadigmViolation: tier '{active_tier}'{detail} may NOT reach the "
            "LLM gateway dispatch boundary. Only 'small_llm' and 'frontier_llm' "
            "tiers are permitted to call GatewayClient.complete(). "
            "CF-C5-PARADIGM-IMPL-1."
        )
