"""
brain_cost_router — executable cost-tier routing primitives.

CF-C5-PARADIGM-IMPL-1: This package provides the @paradigm decorator, the
contextvar enforcement mechanism, and the paradigm_distribution telemetry
emitter. See paradigm.py for the full LOCKED signature from §A0.2.

Paradigm priority: SQL > ML > small_llm >> frontier_llm (1:100:1000:10000).
Paradigms small_llm and frontier_llm are model-agnostic, gateway-routed policy
tiers — resolved to the cheapest model passing the tier's eval bar at runtime.

Public surface:
    paradigm(tier)              — the decorator (import and apply)
    current_paradigm()          — read the active tier (used by GatewayClient)
    assert_llm_tier_at_gateway()— enforcement point in GatewayClient.complete()
    ParadigmViolation           — raised when sql/ml reaches the gateway
    Paradigm                    — the Literal type for type-checking
"""

from .errors import ParadigmViolation
from .paradigm import (
    Paradigm,
    assert_llm_tier_at_gateway,
    current_paradigm,
    paradigm,
)
from .telemetry import emit_faithfulness_retry, emit_paradigm_distribution

__all__ = [
    "paradigm",
    "current_paradigm",
    "assert_llm_tier_at_gateway",
    "ParadigmViolation",
    "Paradigm",
    "emit_paradigm_distribution",
    "emit_faithfulness_retry",
]
