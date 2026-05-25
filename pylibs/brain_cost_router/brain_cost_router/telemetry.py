"""
telemetry.py — paradigm_distribution + faithfulness_retry_total emitters.

CF-C5-COST-AUDIT-1: emit one paradigm_distribution counter per invocation so
the per-workspace cost mix (sql/ml/small_llm/frontier_llm vs the 85/12/2.5/0.5
target) is observable WITHOUT examining code.

CF-C5-FAITHFULNESS-COST-1: emit faithfulness_retry_total so false-reject rate
(the C3 cost-bug) is alarmed before it burns multiple frontier calls per synthesis.

OTel counter interface — the sink (MeterProvider) is configured in
intelligence-service bootstrap; this module only creates/records the metric.
Standalone (no MeterProvider) -> falls back to a no-op meter transparently.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from opentelemetry import metrics as otel_metrics

if TYPE_CHECKING:
    pass

_meter = otel_metrics.get_meter("brain.cost_router", version="0.1.0")

# CF-C5-COST-AUDIT-1
_paradigm_distribution_counter = _meter.create_counter(
    name="paradigm_distribution",
    description=(
        "Total invocations per cost tier. Labels: tier, workspace_id, agent_id. "
        "Alarmed when frontier_llm % drifts above 0.5% target. CF-C5-COST-AUDIT-1."
    ),
    unit="invocations",
)

# CF-C5-FAITHFULNESS-COST-1
_faithfulness_retry_counter = _meter.create_counter(
    name="faithfulness_retry_total",
    description=(
        "Total faithfulness validation retries. A retry burns a second LLM call. "
        "Alarmed when retry_rate > 20%. CF-C5-FAITHFULNESS-COST-1."
    ),
    unit="retries",
)


def emit_paradigm_distribution(
    *,
    tier: str,
    workspace_id: str,
    agent_id: str = "unknown",
    latency_ms: float = 0.0,
) -> None:
    """Emit one paradigm_distribution event for the current call.

    Called by the @paradigm decorator AFTER each successful invocation so
    Stage-6 can query: "did any sql/ml path emit a gateway call?" (must be zero).

    Args:
        tier: one of "sql" | "ml" | "small_llm" | "frontier_llm".
        workspace_id: from the call context (JWT claim, Child-1 contract).
        agent_id: the agent class name or "unknown" for non-agent callers.
        latency_ms: wall-clock ms for the decorated function.
    """
    _paradigm_distribution_counter.add(
        1,
        attributes={
            "tier": tier,
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "latency_ms_bucket": _latency_bucket(latency_ms),
        },
    )


def emit_faithfulness_retry(
    *,
    workspace_id: str,
    agent_id: str = "unknown",
    retry_number: int = 1,
) -> None:
    """Emit one faithfulness_retry_total event.

    Called by the gateway faithfulness middleware when a retry is triggered
    (narration contained a number not present in the signal set).
    Max 1 retry per synthesis (CF-C5-FAITHFULNESS-1 bounded retry).

    Args:
        workspace_id: the active workspace scope.
        agent_id: the agent that triggered the retry.
        retry_number: 1-based retry index (currently always 1 — bounded).
    """
    _faithfulness_retry_counter.add(
        1,
        attributes={
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "retry_number": str(retry_number),
        },
    )


def _latency_bucket(ms: float) -> str:
    """Coarse latency bucket for the paradigm_distribution counter."""
    if ms < 50:
        return "<50ms"
    if ms < 200:
        return "<200ms"
    if ms < 1000:
        return "<1s"
    if ms < 5000:
        return "<5s"
    return ">=5s"
