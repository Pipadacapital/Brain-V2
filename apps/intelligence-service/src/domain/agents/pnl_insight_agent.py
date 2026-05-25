"""
pnl_insight_agent.py — The 5a vertical slice: pnl page-insight agent.

@paradigm: MIXED
    - build_context + compute_signals → @paradigm("sql") Tier-A
    - narrate (gateway call) → @paradigm("small_llm") Tier-B (ONE gateway call)
CF-C5-SCOPE-SPLIT-1: this is the 5a vertical (non-chat, READ-ONLY scope).
CF-C5-INJECTION-SCOPE-4: @agent_tools(scope=["get_pnl_metrics"]) — READ-ONLY.
    The pnl agent CANNOT reach any write tool. Gate 5 enforces this at dispatch.
CF-C5-PINCODE-TOKEN-CAP-1: context token ceiling asserted at construction.
CF-C5-RECOMMEND-ONLY-1: recommendation-only (graduation not yet GRADUATED).

C5-SEC-003 (fix) — Correlation quad population:
    The GatewayRequest built in _narrate() carries the full correlation quad:
        request_id: passed in from the caller (Kafka envelope / gRPC metadata).
            For the daily-tick scheduler path, "system" is the canonical value.
        trace_id: derived from the live OTel span at call time.
        workspace_id: from JWT ctx (Child-1 claim) — already present.
        actor_id: user_id from JWT, or "system" for the daily tick scheduler.
    These fields propagate into the Decision-Log row written by the gateway
    middleware, making every synthesis traceable end-to-end.

VETO surfaces (all from Vikram's gateway — Maya's agent only calls complete()):
    Gate 1: @paradigm contextvar enforced at gateway dispatch boundary.
    Gate 2: faithfulness validated by gateway middleware BEFORE response returned.
    Gate 4: graduation middleware DROPS any write-tool call (none possible here).
    Gate 5: out-of-scope tool-call DROPPED (pnl scope = ["get_pnl_metrics"] only).

Pattern-B (5b seam, designed now):
    The pnl agent produces ONE synthesis call (no fan-out).
    Prior-LLM-output fencing is NOT needed for 5a (no prior narration in the
    context). The Pattern-B seam is in the preprocessor (5b Morning-Brief).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from brain_cost_router import paradigm
from opentelemetry import trace as otel_trace

from application.gateway.client import GatewayRequest, GatewayResponse
from domain.agents.base import PageInsightAgent, agent_tools
from domain.agents.prompts.pnl_system_prompt import PNL_SYSTEM_PROMPT
from domain.context_builders.pnl_context_builder import (
    PnlContext,
    build_pnl_context,
    context_to_signals,
)
from domain.faithfulness.validator import Signal
from domain.injection.preprocessor import build_untrusted_blocks, render_untrusted_section
from domain.signals.pnl_signals import (
    DailyRow,
    PnlSignals,
    PnlSummary,
    compute_pnl_signals,
)

logger = logging.getLogger(__name__)
_tracer = otel_trace.get_tracer("brain.intelligence_service.pnl_agent")


# ---------------------------------------------------------------------------
# PnlInsightAgent — the 5a vertical
# ---------------------------------------------------------------------------

@agent_tools(scope=["get_pnl_metrics"])
class PnlInsightAgent(PageInsightAgent):
    """P&L page-insight agent (5a vertical slice).

    READ-ONLY scope: get_pnl_metrics only.
    The gateway DROPS any tool-call not in ["get_pnl_metrics"] (Gate 5).
    This agent CANNOT reach any write tool (PAUSE_AD_SET, REALLOCATE_BUDGET, etc.).

    Flow:
        1. build_pnl_context()    → @paradigm("sql") Tier-A signals
        2. compute_pnl_signals()  → @paradigm("sql") Tier-A anomaly/trend
        3. assemble_user_content()→ typed signal values (NO free text)
        4. gateway.complete()     → @paradigm("small_llm") ONE Haiku call
        5. parse_insights()       → InsightItem[] from JSON response
        6. Decision-Log written by gateway middleware (not by agent)

    CF-C5-DECISION-LOG-1: the Decision-Log row is written by the gateway's
        _write_decision_log() method — NOT directly by this agent.
        The agent is recommendation-only until graduated.
    """

    agent_id: str = "PnlInsightAgent"
    MAX_CONTEXT_TOKENS: int = 1_800

    def __init__(
        self,
        *,
        gateway: Any,
        _query_gateway: Any = None,
    ) -> None:
        """
        Args:
            gateway: GatewayClient instance (or MockGatewayClient in tests).
                     The agent MUST NOT hold any direct LLM SDK reference.
            _query_gateway: (test injection) query_metrics callable dict.
        """
        super().__init__(gateway=gateway)
        self._query_gateway = _query_gateway

    @paradigm("sql")
    def _build_context(
        self,
        workspace_id: str,
        date_from: str,
        date_to: str,
    ) -> PnlContext:
        """Build P&L context from Child-4 metric rows.

        @paradigm: sql — CF-C5-PARADIGM-MIXED-1.
        MUST NOT call gateway.complete() (Gate 1 would raise ParadigmViolation).
        """
        return build_pnl_context(
            workspace_id,
            date_from,
            date_to,
            _query_gateway=self._query_gateway,
        )

    @paradigm("sql")
    def _compute_signals(
        self,
        ctx: PnlContext,
        workspace_id: str,
    ) -> tuple[list[Signal], PnlSignals]:
        """Compute deterministic signals and build the full Signal list.

        @paradigm: sql — anomaly/spike/trend are statistics, not LLM.
        Returns (signals_for_faithfulness, pnl_signals_for_prompt).
        """
        # Build daily rows for signal computation
        daily_rows = _daily_rows_from_daily_signals(ctx.daily_signals)

        pnl_summary = PnlSummary(
            net_sales_mu=ctx.current.net_sales_mu,
            cm1_mu=ctx.current.cm1_mu,
            cm2_mu=ctx.current.cm2_mu,
            cm3_mu=ctx.current.cm3_mu,
            total_ad_spend_mu=ctx.current.total_ad_spend_mu,
            total_orders=ctx.current.total_orders,
            aov_mu=ctx.current.aov_mu,
        )
        prior_pnl_summary = PnlSummary(
            net_sales_mu=ctx.prior.net_sales_mu,
            cm1_mu=ctx.prior.cm1_mu,
            cm2_mu=ctx.prior.cm2_mu,
            cm3_mu=ctx.prior.cm3_mu,
            total_ad_spend_mu=ctx.prior.total_ad_spend_mu,
            total_orders=ctx.prior.total_orders,
        )

        pnl_signals = compute_pnl_signals(
            daily_rows,
            pnl_summary,
            prior_pnl_summary,
            workspace_id=workspace_id,
        )

        # Full signal set for the faithfulness gate
        faithfulness_signals = context_to_signals(ctx)

        # Add signal anomaly/trend values to the faithfulness set
        for anomaly in pnl_signals.anomalies:
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"anomaly:{anomaly.metric}:{anomaly.date}:value", anomaly.value_mu),
                Signal(f"anomaly:{anomaly.metric}:{anomaly.date}:avg", anomaly.expected_avg_mu),
            ]

        for trend in pnl_signals.trends:
            faithfulness_signals = [
                *faithfulness_signals,
                Signal(f"trend:{trend.metric}:current", trend.current_value_mu),
                Signal(f"trend:{trend.metric}:prior", trend.prior_value_mu),
                Signal(f"trend:{trend.metric}:pct_x10", trend.pct_change_x10),
            ]

        return faithfulness_signals, pnl_signals

    @paradigm("small_llm")
    def _narrate(
        self,
        ctx: PnlContext,
        faithfulness_signals: list[Signal],
        pnl_signals: PnlSignals,
        workspace_id: str,
        brand_name: str | None = None,
        *,
        request_id: str = "system",
        actor_id: str = "system",
    ) -> GatewayResponse:
        """Call the gateway for ONE Haiku narration.

        @paradigm: small_llm — the ONLY LLM call in the pnl vertical.
        CF-C5-PARADIGM-MIXED-1: MUST NOT compute any numbers here.
        CF-C5-INJECTION-SPOTLIGHT-7: operator-entered strings fenced.

        C5-SEC-003 fix — Correlation quad:
            request_id and actor_id are propagated from generate_insights() into
            GatewayRequest, which writes them into the Decision-Log row.
            trace_id is derived from the active OTel span at this call site so
            every synthesis row is correlatable back to the telemetry backend.
        """
        # C5-SEC-003: bind trace_id from the active OTel span at call time.
        otel_ctx = otel_trace.get_current_span().get_span_context()
        trace_id = (
            format(otel_ctx.trace_id, "032x") if otel_ctx.is_valid else ""
        )

        # Build untrusted blocks (operator-entered strings, spotlighted)
        blocks = build_untrusted_blocks(
            brand_name=brand_name,
            goal_labels=[(f"goal_{g.metric_id}", g.label) for g in ctx.goals],
            workspace_id=workspace_id,
        )
        untrusted_section = render_untrusted_section(blocks)

        # Build user content (typed signal values only — no free text)
        user_content = _format_signals_as_user_content(ctx, pnl_signals)
        if untrusted_section:
            user_content = f"{user_content}\n\n{untrusted_section}"

        request = GatewayRequest(
            paradigm="small_llm",
            signals=faithfulness_signals,
            system_template=PNL_SYSTEM_PROMPT,
            untrusted_blocks=[untrusted_section] if untrusted_section else [],
            workspace_id=workspace_id,
            agent_id=self.agent_id,
            filters_hash=ctx.filters_hash,
            max_tokens=512,
            # C5-SEC-003: correlation quad — propagated into Decision-Log row.
            request_id=request_id,
            trace_id=trace_id,
            actor_id=actor_id,
        )
        return self.gateway.complete(request)

    def generate_insights(
        self,
        workspace_id: str,
        date_from: str,
        date_to: str,
        *,
        request_id: str = "system",
        actor_id: str = "system",
    ) -> list[Any]:
        """Generate P&L page insights (the full 5a vertical).

        Tier-A (sql): context → signals
        Tier-B (small_llm): gateway narration → parse InsightItem[]
        Gate 2 (faithfulness): enforced by gateway middleware
        Gate 1 (paradigm): enforced at gateway dispatch boundary
        Decision-Log: written by gateway middleware

        C5-SEC-003 fix — Correlation quad:
            request_id: unique identifier from Kafka envelope / gRPC metadata.
                Use "system" for the daily-tick scheduler path (no human in loop).
            actor_id: user_id from JWT, or "system" for the daily tick.
            workspace_id is the third quad member (always present).
            trace_id is derived inside _narrate() from the active OTel span.

        Returns list[InsightItem]-shaped dicts (JSON-parsed from LLM response).
        """
        # --- Tier-A: context + signals ---
        ctx = self._build_context(workspace_id, date_from, date_to)

        # Token ceiling assertion (CF-C5-PINCODE-TOKEN-CAP-1)
        self._assert_token_ceiling(ctx.estimated_tokens)

        faithfulness_signals, pnl_signals = self._compute_signals(ctx, workspace_id)

        # --- Tier-B: narration ---
        response = self._narrate(
            ctx, faithfulness_signals, pnl_signals, workspace_id,
            request_id=request_id,
            actor_id=actor_id,
        )

        # --- Parse InsightItem[] from JSON response ---
        insights = _parse_insights_from_json(response.narration)

        logger.info(
            "PnlInsightAgent: generated %d insights for workspace_id=%r "
            "model=%r tokens_in=%d tokens_out=%d faithfulness=%s cached=%s",
            len(insights),
            workspace_id,
            response.model_used,
            response.tokens_input,
            response.tokens_output,
            response.faithfulness.ok,
            response.cached,
        )

        return insights


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _daily_rows_from_daily_signals(daily_signals: list[Signal]) -> list[DailyRow]:
    """Reconstruct DailyRow list from context's daily signals.

    Daily signals are stored as "daily:<date>:<metric>:<value>" IDs.
    We group by date and reconstruct the DailyRow.
    """
    by_date: dict[str, dict[str, int]] = {}
    for sig in daily_signals:
        parts = sig.signal_id.split(":")
        if len(parts) >= 3 and parts[0] == "daily":
            date_str, metric = parts[1], parts[2]
            by_date.setdefault(date_str, {})[metric] = sig.value_canonical

    rows: list[DailyRow] = []
    for date_str, metrics in sorted(by_date.items()):
        rows.append(DailyRow(
            date=date_str,
            net_sales_mu=metrics.get("net_sales_mu", 0),
            cogs_mu=metrics.get("cogs_mu", 0),
            cm1_mu=metrics.get("cm1_mu", 0),
            cm2_mu=metrics.get("cm2_mu", 0),
            cm3_mu=metrics.get("cm3_mu", 0),
            total_ad_spend_mu=metrics.get("total_ad_spend_mu", 0),
        ))
    return rows


def _format_signals_as_user_content(
    ctx: PnlContext,
    pnl_signals: PnlSignals,
) -> str:
    """Format typed signal values as the user-turn content.

    CF-C5-INJECTION-SPOTLIGHT-7: ONLY canonical integer values here.
    No operator-entered text in the instruction region.
    """
    lines = [
        f"## P&L Analysis: {ctx.date_from} to {ctx.date_to}",
        f"Prior period: {ctx.prior_date_from} to {ctx.prior_date_to}",
        "",
        "### Period Summary (all values in paise / basis points)",
        f"net_sales_mu: {ctx.current.net_sales_mu}",
        f"cogs_mu: {ctx.current.cogs_mu}",
        f"cm1_mu: {ctx.current.cm1_mu}",
        f"cm2_mu: {ctx.current.cm2_mu}",
        f"cm3_mu: {ctx.current.cm3_mu}",
        f"total_ad_spend_mu: {ctx.current.total_ad_spend_mu}",
        f"total_orders: {ctx.current.total_orders}",
        "",
        "### Prior Period",
        f"prior_net_sales_mu: {ctx.prior.net_sales_mu}",
        f"prior_cm2_mu: {ctx.prior.cm2_mu}",
        f"prior_cm3_mu: {ctx.prior.cm3_mu}",
        f"prior_total_ad_spend_mu: {ctx.prior.total_ad_spend_mu}",
        "",
    ]

    if pnl_signals.anomalies:
        lines.append("### Statistical Anomalies (z≥2.0)")
        for a in pnl_signals.anomalies:
            lines.append(a.description)
        lines.append("")

    if pnl_signals.spikes or pnl_signals.drops:
        lines.append("### Spikes/Drops (±25% day-over-day)")
        for s in pnl_signals.spikes:
            lines.append(s.description)
        for d in pnl_signals.drops:
            lines.append(d.description)
        lines.append("")

    if pnl_signals.trends:
        lines.append("### Period-over-Period Trends")
        for t in pnl_signals.trends:
            lines.append(t.description)
        lines.append("")

    return "\n".join(lines)


def _parse_insights_from_json(narration: str) -> list[dict]:
    """Parse InsightItem[] from the LLM JSON response.

    The system prompt instructs the LLM to return valid JSON only.
    Returns an empty list if parsing fails (graceful degradation).
    """
    try:
        data = json.loads(narration)
        insights = data.get("insights", []) if isinstance(data, dict) else []
        return insights[:5]  # max 5 insights
    except (json.JSONDecodeError, TypeError, AttributeError):
        logger.warning(
            "PnlInsightAgent: failed to parse JSON from LLM response. "
            "narration_preview=%r",
            narration[:200],
        )
        return []
