"""calendar_report_query.py — CalendarReportQuery use-case (Phase 2, slice 7).

@paradigm: sql (deterministic integer aggregation over period buckets + boolean RAG; zero LLM/ML)

The Calendar Report period grid (day/week/month) of revenue/cm3/spend/mer/amer/cac/aov per
period WITH marketing-action overlays (manual + Klaviyo) and per-cell DIRECTIONAL goal RAG —
ported Brain-native from legacy routes/workspaces/calendar-report.ts + lib/metrics/calendar-report.ts
onto the slice-1..6 foundation.

ROHAN STAGE-1 FINDING 3 — the calendar report is a PERIOD GRID with OVERLAYS, NOT a festival surface:
  Legacy computeCalendarReport buckets daily {revenue, cm3, totalSpend, mer, amer, cac, aov,
  newCustomers} into day/week/month rows, attaches marketing-action overlays per cell, and
  computes per-cell goal RAG from PRORATED goals:
    - ratio goals (mer/amer/cac): NOT prorated — same target every period.
    - money/count goals (revenue/cm3/aov*/newCustomers): prorated (weekly = /7, monthly = /days-in-month).
  This composes the slice-1 revenue, slice-2 cm3, slice-4 mer/amer/cac primitives — NO new metric.
  The per-cell RAG reuses the slice-7 directional compute_goal_rag (same band as /settings/goals).

Money in BIGINT minor units; ratios in bp; the directional RAG is identical to GoalAttainmentQuery.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    compute_goal_rag as _compute_goal_rag,
    goal_higher_better as _goal_higher_better,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)
from .goal_attainment_query import GOAL_METRIC_HIGHER_BETTER

# Marketing-action types (legacy MARKETING_ACTION_TYPES).
MARKETING_ACTION_TYPES = (
    "email_campaign", "sms_campaign", "promotion", "product_launch",
    "influencer", "ad_creative_change", "external_event", "sale_event",
)

# Ratio goal metrics are NOT prorated across the period (legacy RATIO_METRICS).
_RATIO_GOAL_METRICS = frozenset({"mer", "amer", "cac"})
_VALID_GRAIN = ("day", "week", "month")


@dataclass(frozen=True)
class CalendarActionFact:
    """A marketing-action overlay for a day (manual or Klaviyo-synced; read-only)."""

    id: str
    action_date: str           # ISO yyyy-mm-dd
    action_type: str
    action_name: str
    notes: str | None = None
    source: str = "manual"     # manual | klaviyo


@dataclass(frozen=True)
class CalendarGoalFact:
    """A stored goal applicable to the calendar (period-typed, integer-scaled)."""

    metric_name: str           # revenue | cm3 | mer | amer | cac | aov | new_customers
    period_type: str           # DAILY | WEEKLY | MONTHLY
    goal_value: int            # mu / bp / count
    goal_type: str             # MINIMUM | MAXIMUM | TARGET


@dataclass(frozen=True)
class CalendarPeriodFact:
    """Pre-aggregated metrics for one calendar period bucket (mu / bp / count)."""

    period_key: str
    label: str
    days_in_period: int        # for money/count goal proration
    revenue_mu: int
    cm3_mu: int
    total_spend_mu: int
    new_customers: int
    mer_bp: int | None
    amer_bp: int | None
    cac_mu: int | None
    aov_mu: int | None


@dataclass(frozen=True)
class CalendarReportFacts:
    periods: tuple[CalendarPeriodFact, ...] = field(default_factory=tuple)
    actions: tuple[CalendarActionFact, ...] = field(default_factory=tuple)
    goals: tuple[CalendarGoalFact, ...] = field(default_factory=tuple)
    currency_code: str = "INR"


@dataclass(frozen=True)
class CalendarCell:
    actual: int | None
    goal: int | None
    rag: str | None            # green | amber | red | None (no goal)


@dataclass(frozen=True)
class CalendarActionRow:
    id: str
    action_date: str
    action_type: str
    action_name: str
    notes: str | None
    source: str


@dataclass(frozen=True)
class CalendarReportRow:
    period_key: str
    label: str
    actions: tuple[CalendarActionRow, ...]
    revenue: CalendarCell
    cm3: CalendarCell
    total_spend_mu: int
    mer: CalendarCell
    amer: CalendarCell
    new_customers: CalendarCell
    cac: CalendarCell
    aov: CalendarCell


@dataclass(frozen=True)
class CalendarReportResult:
    workspace_id: str
    grain: str
    currency_code: str
    rows: tuple[CalendarReportRow, ...]
    total_rows: int


def _prorated_goal(metric: str, goal: CalendarGoalFact, days_in_period: int) -> int:
    """Prorate a money/count goal to the period; ratio goals are NOT prorated (legacy)."""
    if metric in _RATIO_GOAL_METRICS:
        return goal.goal_value
    if goal.period_type == "DAILY":
        return goal.goal_value * max(1, days_in_period)
    if goal.period_type == "WEEKLY":
        # weekly goal scaled to the bucket's day count (legacy gv/7 per day).
        return (goal.goal_value * max(1, days_in_period)) // 7
    # MONTHLY: gv/days-in-month per day → for the bucket, scale by days_in_period.
    # legacy uses getDaysInMonth; here days_in_period carries the bucket span and the goal is
    # a monthly target, so per-bucket goal = gv * days_in_period / 30 (canonical 30-day month
    # for integer determinism; the exact-month nuance is a documented DDR note).
    return (goal.goal_value * max(1, days_in_period)) // 30


def _cell(
    metric: str,
    actual: int | None,
    goals_by_metric: dict[str, CalendarGoalFact],
    days_in_period: int,
) -> CalendarCell:
    goal = goals_by_metric.get(metric)
    if goal is None or actual is None:
        return CalendarCell(actual=actual, goal=None, rag=None)
    period_goal = _prorated_goal(metric, goal, days_in_period)
    metric_hb = GOAL_METRIC_HIGHER_BETTER.get(metric, True)
    higher_better = _goal_higher_better(goal.goal_type, metric_hb)
    rag = _compute_goal_rag(actual, period_goal, higher_better)
    return CalendarCell(actual=actual, goal=period_goal, rag=rag)


class CalendarReportQuery:
    """Assemble the calendar report period grid with overlays + per-cell directional RAG."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: CalendarReportFacts,
        *,
        grain: str = "day",
        _client: object | None = None,
    ) -> CalendarReportResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "CalendarReportQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        grain = grain if grain in _VALID_GRAIN else "day"

        # Fail-closed scoped read (observability + tenancy choke). The grid reuses the
        # slice-1 net_revenue_mu primitive — NOT a new metric.
        query_metrics(workspace_id, "net_revenue_mu", date_range, _client=_client)

        # De-dupe goals by metric (calendar uses one applicable goal per metric).
        goals_by_metric: dict[str, CalendarGoalFact] = {}
        for g in facts.goals:
            goals_by_metric.setdefault(g.metric_name, g)

        # Group actions by date for overlay attachment.
        actions_by_date: dict[str, list[CalendarActionFact]] = {}
        for a in facts.actions:
            actions_by_date.setdefault(a.action_date, []).append(a)

        rows: list[CalendarReportRow] = []
        for p in facts.periods:
            # Period actions: legacy attaches by the dates in the bucket; here the period_key
            # IS the bucket date for day grain; week/month buckets carry pre-grouped actions.
            day_actions = actions_by_date.get(p.period_key, [])
            action_rows = tuple(
                CalendarActionRow(
                    id=a.id,
                    action_date=a.action_date,
                    action_type=a.action_type,
                    action_name=a.action_name,
                    notes=a.notes,
                    source=a.source,
                )
                for a in day_actions
            )
            d = p.days_in_period
            rows.append(
                CalendarReportRow(
                    period_key=p.period_key,
                    label=p.label,
                    actions=action_rows,
                    revenue=_cell("revenue", p.revenue_mu, goals_by_metric, d),
                    cm3=_cell("cm3", p.cm3_mu, goals_by_metric, d),
                    total_spend_mu=p.total_spend_mu,
                    mer=_cell("mer", p.mer_bp, goals_by_metric, d),
                    amer=_cell("amer", p.amer_bp, goals_by_metric, d),
                    new_customers=_cell("new_customers", p.new_customers, goals_by_metric, d),
                    cac=_cell("cac", p.cac_mu, goals_by_metric, d),
                    aov=_cell("aov", p.aov_mu, goals_by_metric, d),
                )
            )

        return CalendarReportResult(
            workspace_id=workspace_id,
            grain=grain,
            currency_code=facts.currency_code,
            rows=tuple(rows),
            total_rows=len(rows),
        )
