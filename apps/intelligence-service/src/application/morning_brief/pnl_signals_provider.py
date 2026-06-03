"""
application/morning_brief/pnl_signals_provider.py — Real signals provider for GetMorningBrief.

@paradigm: MIXED
    - Date-window derivation + provider wiring:  @paradigm("sql")
    - generate_insights() call-through:           MIXED (sql Tier-A + small_llm Tier-B)
      The Tier-B (small_llm) portion is owned by PnlInsightAgent._narrate() — this
      module does not change the paradigm, only sets up and delegates.

B1 SCOPE (Morning Brief Tier-B wiring):
    This is the ONLY wiring added in B1. It connects GetMorningBrief → the real
    PnlInsightAgent pipeline (Tier-A signals + Tier-B narration through GatewayClient +
    all 5 VETO gates) via a Callable[(workspace_id, date_str) -> list[dict]] that the
    servicer already has a DI seam for.

DI contract:
    PnlInsightSignalsProvider(gateway, metric_source) → provider callable
    - gateway:       GatewayClient (or FakeGateway in tests)
    - metric_source: dict {"query_metrics": callable, "DateRange": type}
      matching what build_pnl_context expects from _query_gateway.
      This is an in-process adapter — avoids a full cross-service gRPC client for B1.

Date window:
    Given a date string "YYYY-MM-DD" (the brief's as_of date), the provider derives
    a trailing-30-day window: [as_of - 29 days, as_of] as current period.
    This matches the legacy morning brief convention and stays within the 1,800t
    context ceiling (MAX_DAILY_ROWS = 30 in pnl_context_builder.py).

Correlation quad:
    request_id and actor_id default to "system" for this daily-tick-style path.
    The daily-tick scheduler (Phase-D) will pass real IDs when it calls the provider.
    These propagate into every Decision-Log row via the agent → gateway pipeline.

TODO (Phase-D seam — DO NOT build yet):
    - Daily-tick scheduler wires real request_id/actor_id per Kafka envelope.
    - Fan-out to all 15 agents (cross-agent orchestration).
    - ai.insight_cache table for cached brief reads.
    - Redis-backed filtersHash cache.
    - Cross-agent narrative (AICMO/AICOO/AICFO fan-out → Sonnet synthesis).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from brain_cost_router import paradigm

logger = logging.getLogger(__name__)


class PnlInsightSignalsProvider:
    """Real signals provider: builds PnlInsightAgent and calls generate_insights().

    This is the DI callable injected into IntelligenceServiceAdapter._signals_provider.
    Calling an instance returns list[dict] (InsightItem-shaped dicts) consumable by
    _domain_item_to_proto.

    @paradigm: MIXED — date derivation is sql; the agent pipeline delegates to
               @paradigm("sql") Tier-A and @paradigm("small_llm") Tier-B internally.

    Constructor deps (NEVER hardcoded singletons):
        gateway:       GatewayClient — the LiteLLM gateway instance.
        metric_source: dict {"query_metrics": callable, "DateRange": type}
                       matching build_pnl_context's _query_gateway contract.
    """

    def __init__(self, *, gateway: Any, metric_source: Any) -> None:
        """
        Args:
            gateway:       GatewayClient (or FakeGateway in tests). Must implement
                           .complete(GatewayRequest) -> GatewayResponse.
            metric_source: dict with keys "query_metrics" and "DateRange".
                           query_metrics(workspace_id, definition_id, DateRange) -> list[MetricRow]
                           DateRange: dataclass(start: date, end: date)
        """
        self._gateway = gateway
        self._metric_source = metric_source

    @paradigm("sql")
    def _derive_date_window(self, date_str: str) -> tuple[str, str]:
        """Derive a trailing-30-day window from the as_of date string.

        @paradigm: sql — pure date arithmetic, no LLM.

        Returns (date_from, date_to) as ISO strings. If date_str is empty or
        unparseable, falls back to today as the anchor date (graceful degradation).
        """
        try:
            as_of = date.fromisoformat(date_str) if date_str else date.today()
        except (ValueError, TypeError):
            logger.warning(
                "PnlInsightSignalsProvider: unparseable date_str=%r, "
                "falling back to today.",
                date_str,
            )
            as_of = date.today()

        # Trailing 30-day window: [as_of - 29, as_of]
        date_from = as_of - timedelta(days=29)
        return date_from.isoformat(), as_of.isoformat()

    def __call__(self, workspace_id: str, date_str: str) -> list[dict]:
        """Invoke the full PnlInsightAgent pipeline and return InsightItem dicts.

        @paradigm: MIXED — delegates to PnlInsightAgent.generate_insights() which
                   is sql (Tier-A) + small_llm (Tier-B) with all 5 VETO gates.

        PII/NEVERLOG: workspace_id is logged at DEBUG only; no narration text logged.

        Args:
            workspace_id: authenticated workspace (from the gRPC request).
            date_str:     ISO "YYYY-MM-DD" as_of date from the gRPC request.

        Returns:
            list[dict] of InsightItem-shaped dicts (from _parse_insights_from_json).
            Empty list on graceful degradation (no crash path).
        """
        logger.debug(
            "PnlInsightSignalsProvider: workspace_id=%r date_str=%r",
            workspace_id,
            date_str,
        )

        # Lazy import avoids circular deps and keeps the module importable in tests
        # without the full domain layer wired.
        from domain.agents.pnl_insight_agent import PnlInsightAgent

        date_from, date_to = self._derive_date_window(date_str)

        agent = PnlInsightAgent(
            gateway=self._gateway,
            _query_gateway=self._metric_source,
        )

        insights = agent.generate_insights(
            workspace_id,
            date_from,
            date_to,
            # Correlation quad: "system" for the daily-tick / on-demand brief path.
            # Phase-D daily-tick scheduler will pass real request_id/actor_id.
            request_id="system",
            actor_id="system",
        )

        logger.debug(
            "PnlInsightSignalsProvider: generated %d insights workspace_id=%r",
            len(insights),
            workspace_id,
        )
        return insights


def build_pnl_signals_provider(
    *,
    gateway: Any,
    metric_source: Any,
) -> PnlInsightSignalsProvider:
    """Factory: build and return a PnlInsightSignalsProvider.

    Used by start_intelligence_grpc_server to construct the provider
    when both deps are configured (MORNING_BRIEF_LIVE + ANTHROPIC_API_KEY).

    Args:
        gateway:       GatewayClient instance.
        metric_source: dict {"query_metrics": callable, "DateRange": type}.

    Returns:
        Callable PnlInsightSignalsProvider instance.
    """
    return PnlInsightSignalsProvider(gateway=gateway, metric_source=metric_source)
