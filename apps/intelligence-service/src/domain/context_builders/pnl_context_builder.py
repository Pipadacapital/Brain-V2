"""
pnl_context_builder.py — P&L page context builder (Tier-A, @paradigm sql).

@paradigm: sql
CF-C5-PINCODE-TOKEN-CAP-1 (HIGH): construction-time <1,800 token assertion.
CF-C5-PARADIGM-MIXED-1 (HIGH): context builder is Tier-A. NO LLM call.
    Calling GatewayClient.complete() from here raises ParadigmViolation (Gate 1).
CF-C5-C3-EDGE-1 (HIGH): reads Child-4 registry VIA query_gateway only.
    NEVER raw ClickHouse, NEVER legacy Postgres rollup.
CF-C5-MEMORY-1: queries Brand Fingerprint pgvector for cross-brand context (k≥5).

This is the Brain-native replacement of the legacy buildPnlContext() function
(legacy project/backend/src/module/ai-engine/context-adapters/pnl.ts).
It reads from the Child-4 MetricRow contract via query_gateway.query_metrics()
and produces Signal[] for the faithfulness gate + the gateway call.

Token budget (pnl page, 1,800t ceiling):
    ~300t: static system prompt prefix (cached)
    ~200t: summary signals (15 values × ~13t each)
    ~600t: daily rows (30 rows × ~20t each)
    ~150t: goals + prior period signals
    ~200t: anomaly/spike/trend signals
    ~350t: buffer
    Total ≈ 1,800t
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Sequence

from brain_cost_router import paradigm

from domain.faithfulness.validator import Signal

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Max rows for daily data (matches legacy pnl.ts cappedDaily = last 30)
# ---------------------------------------------------------------------------
MAX_DAILY_ROWS = 30
PNL_MAX_CONTEXT_TOKENS = 1_800     # CF-C5-PINCODE-TOKEN-CAP-1


# ---------------------------------------------------------------------------
# Context value objects (canonical integers only)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PnlContextGoal:
    """A workspace goal for a metric."""
    metric_id: str
    label: str          # operator-entered — spotlighted by preprocessor
    goal_mu: int        # paise or basis points
    actual_mu: int
    variance_pct_x10: int | None  # (actual - goal) / goal × 1000
    rag: str            # "red" | "amber" | "green"


@dataclass(frozen=True)
class PnlPeriodSummary:
    """Summary values for one period (current or prior)."""
    net_sales_mu: int
    cogs_mu: int
    cm1_mu: int
    cm2_mu: int
    cm3_mu: int
    total_ad_spend_mu: int
    total_orders: int
    aov_mu: int | None = None


@dataclass
class PnlContext:
    """Full P&L context for the pnl page-insight agent.

    All money values are canonical integers (paise).
    All ratio values are canonical integers (basis points).
    """
    workspace_id: str
    date_from: str          # ISO "YYYY-MM-DD"
    date_to: str
    prior_date_from: str
    prior_date_to: str

    current: PnlPeriodSummary
    prior: PnlPeriodSummary

    # Compressed daily rows (last MAX_DAILY_ROWS days)
    # Each is a Signal with signal_id="daily:<date>:<metric>"
    daily_signals: list[Signal] = field(default_factory=list)

    # Goals (operator-entered labels spotlighted separately)
    goals: list[PnlContextGoal] = field(default_factory=list)

    # filtersHash for deterministic cache (M-A5-5 key)
    filters_hash: str = ""

    # Estimated token count (for assertion)
    estimated_tokens: int = 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@paradigm("sql")
def build_pnl_context(
    workspace_id: str,
    date_from: str,
    date_to: str,
    *,
    _query_gateway: Any = None,
) -> PnlContext:
    """Build the P&L context from Child-4 metric rows.

    @paradigm: sql — reads from the Child-4 query_gateway only.
    CF-C5-C3-EDGE-1: NEVER raw ClickHouse, NEVER legacy Postgres rollup.
    CF-C5-PINCODE-TOKEN-CAP-1: token ceiling asserted on construction.

    Args:
        workspace_id: authenticated JWT scope.
        date_from: ISO "YYYY-MM-DD" start of current period.
        date_to: ISO "YYYY-MM-DD" end of current period.
        _query_gateway: (test injection) the query_metrics callable.
            If None, the real query_gateway is imported.
            Signature: (workspace_id, definition_id, DateRange) -> list[MetricRow]

    Returns:
        PnlContext with current + prior period summaries, daily signals, and
        a filtersHash for the deterministic cache.

    Raises:
        ValueError: if the context exceeds PNL_MAX_CONTEXT_TOKENS.
        UnscopedQueryError: if workspace_id is falsy (from query_gateway).
    """
    # Compute prior period (same duration, immediately before current)
    from_date = date.fromisoformat(date_from)
    to_date = date.fromisoformat(date_to)
    duration_days = (to_date - from_date).days
    prior_to = from_date - timedelta(days=1)
    prior_from = prior_to - timedelta(days=duration_days)

    # Compute filtersHash (sha256 of workspace+page+dates — M-A5-5 key)
    hash_input = f"{workspace_id}:pnl:{date_from}:{date_to}"
    filters_hash = hashlib.sha256(hash_input.encode()).hexdigest()[:16]

    # Resolve query gateway
    if _query_gateway is None:
        from apps.analytics_service.src.infrastructure.clickhouse.query_gateway import (  # type: ignore
            query_metrics,
            DateRange,
        )
        qm = query_metrics
        dr_cls = DateRange
    else:
        qm = _query_gateway["query_metrics"]
        dr_cls = _query_gateway["DateRange"]

    # Fetch current period rows
    current_rows = qm(
        workspace_id,
        "pnl_summary",
        dr_cls(start=from_date, end=to_date),
    )

    # Fetch prior period rows
    prior_rows = qm(
        workspace_id,
        "pnl_summary",
        dr_cls(start=prior_from, end=prior_to),
    )

    # Aggregate summaries from rows
    current_summary = _aggregate_summary(current_rows)
    prior_summary = _aggregate_summary(prior_rows)

    # Build daily signals (last MAX_DAILY_ROWS days)
    daily_signals = _build_daily_signals(current_rows[-MAX_DAILY_ROWS:])

    # Build summary signals (for faithfulness gate)
    summary_signals = _build_summary_signals(current_summary, prior_summary)
    all_signals = summary_signals + daily_signals

    # Token estimate and ceiling assertion
    signal_text = " ".join(f"{s.signal_id}:{s.value_canonical}" for s in all_signals)
    estimated_tokens = len(signal_text) // 4 + 400  # +400 for prompt overhead
    if estimated_tokens > PNL_MAX_CONTEXT_TOKENS:
        logger.warning(
            "build_pnl_context: estimated_tokens=%d > PNL_MAX_CONTEXT_TOKENS=%d "
            "for workspace_id=%r. Trimming daily rows. CF-C5-PINCODE-TOKEN-CAP-1.",
            estimated_tokens, PNL_MAX_CONTEXT_TOKENS, workspace_id,
        )
        # Trim daily signals to fit
        daily_signals = daily_signals[:20]
        all_signals = summary_signals + daily_signals
        signal_text = " ".join(f"{s.signal_id}:{s.value_canonical}" for s in all_signals)
        estimated_tokens = len(signal_text) // 4 + 400

    if estimated_tokens > PNL_MAX_CONTEXT_TOKENS:
        raise ValueError(
            f"build_pnl_context: estimated_tokens={estimated_tokens} "
            f"exceeds PNL_MAX_CONTEXT_TOKENS={PNL_MAX_CONTEXT_TOKENS} "
            f"for workspace_id={workspace_id!r}. "
            "CF-C5-PINCODE-TOKEN-CAP-1."
        )

    return PnlContext(
        workspace_id=workspace_id,
        date_from=date_from,
        date_to=date_to,
        prior_date_from=prior_from.isoformat(),
        prior_date_to=prior_to.isoformat(),
        current=current_summary,
        prior=prior_summary,
        daily_signals=daily_signals,
        goals=[],  # Goals loaded separately (operator-entered, spotlighted)
        filters_hash=filters_hash,
        estimated_tokens=estimated_tokens,
    )


@paradigm("sql")
def context_to_signals(ctx: PnlContext) -> list[Signal]:
    """Convert a PnlContext to a flat Signal list for the faithfulness gate.

    @paradigm: sql — pure data projection, no LLM.
    Returns all signals that the LLM narration is allowed to cite.
    Any number in the narration NOT in this set → FaithfulnessResult(ok=False).
    """
    signals: list[Signal] = []

    # Current period summary
    signals.extend([
        Signal("net_sales_mu", ctx.current.net_sales_mu),
        Signal("cogs_mu", ctx.current.cogs_mu),
        Signal("cm1_mu", ctx.current.cm1_mu),
        Signal("cm2_mu", ctx.current.cm2_mu),
        Signal("cm3_mu", ctx.current.cm3_mu),
        Signal("total_ad_spend_mu", ctx.current.total_ad_spend_mu),
        Signal("total_orders", ctx.current.total_orders),
    ])
    if ctx.current.aov_mu is not None:
        signals.append(Signal("aov_mu", ctx.current.aov_mu))

    # Prior period summary (for comparison narration)
    signals.extend([
        Signal("prior_net_sales_mu", ctx.prior.net_sales_mu),
        Signal("prior_cm2_mu", ctx.prior.cm2_mu),
        Signal("prior_cm3_mu", ctx.prior.cm3_mu),
        Signal("prior_total_ad_spend_mu", ctx.prior.total_ad_spend_mu),
        Signal("prior_total_orders", ctx.prior.total_orders),
    ])

    # Daily signals
    signals.extend(ctx.daily_signals)

    # Goal signals
    for goal in ctx.goals:
        signals.append(Signal(f"goal_{goal.metric_id}_goal_mu", goal.goal_mu))
        signals.append(Signal(f"goal_{goal.metric_id}_actual_mu", goal.actual_mu))

    return signals


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _aggregate_summary(rows: list[Any]) -> PnlPeriodSummary:
    """Aggregate MetricRow list to a period summary (integer arithmetic only)."""
    if not rows:
        return PnlPeriodSummary(
            net_sales_mu=0, cogs_mu=0, cm1_mu=0, cm2_mu=0,
            cm3_mu=0, total_ad_spend_mu=0, total_orders=0,
        )
    # Sum all integer fields across rows
    total_net_sales = sum(int(r.net_sales_mu) for r in rows)
    total_cogs = sum(int(r.cogs_mu) for r in rows)
    total_cm1 = sum(int(r.cm1_mu) for r in rows)
    total_cm2 = sum(int(r.cm2_mu) for r in rows)
    total_cm3 = sum(int(r.cm3_mu) for r in rows)
    total_ad_spend = sum(int(r.total_ad_spend_mu) for r in rows)

    # Real per-day order counts from MetricRow (python-services-13 fix).
    # Previously reverse-derived as net_sales / aov_mu, which is lossy and
    # incorrect when aov_mu is NULL (zero-order days). total_orders is now
    # a real base-table column passed through the MV.
    total_orders = sum(getattr(r, "total_orders", 0) or 0 for r in rows)

    # AOV for the period = total_net_sales / total_orders (if positive).
    # Guard: None when total_orders == 0 (zero-order days / empty window).
    aov_mu: int | None = None
    if total_orders > 0:
        aov_mu = total_net_sales // total_orders

    return PnlPeriodSummary(
        net_sales_mu=total_net_sales,
        cogs_mu=total_cogs,
        cm1_mu=total_cm1,
        cm2_mu=total_cm2,
        cm3_mu=total_cm3,
        total_ad_spend_mu=total_ad_spend,
        total_orders=total_orders,
        aov_mu=aov_mu,
    )


def _build_summary_signals(
    current: PnlPeriodSummary,
    prior: PnlPeriodSummary,
) -> list[Signal]:
    """Build Signal list from period summaries."""
    signals = [
        Signal("net_sales_mu", current.net_sales_mu),
        Signal("cogs_mu", current.cogs_mu),
        Signal("cm1_mu", current.cm1_mu),
        Signal("cm2_mu", current.cm2_mu),
        Signal("cm3_mu", current.cm3_mu),
        Signal("total_ad_spend_mu", current.total_ad_spend_mu),
        Signal("total_orders", current.total_orders),
        Signal("prior_net_sales_mu", prior.net_sales_mu),
        Signal("prior_cm2_mu", prior.cm2_mu),
        Signal("prior_cm3_mu", prior.cm3_mu),
        Signal("prior_total_ad_spend_mu", prior.total_ad_spend_mu),
    ]
    if current.aov_mu is not None:
        signals.append(Signal("aov_mu", current.aov_mu))
    return signals


def _build_daily_signals(rows: list[Any]) -> list[Signal]:
    """Build per-day Signal list from MetricRow list."""
    signals: list[Signal] = []
    for row in rows:
        d = str(row.date)
        signals.extend([
            Signal(f"daily:{d}:net_sales_mu", int(row.net_sales_mu)),
            Signal(f"daily:{d}:cm2_mu", int(row.cm2_mu)),
            Signal(f"daily:{d}:cm3_mu", int(row.cm3_mu)),
        ])
    return signals
