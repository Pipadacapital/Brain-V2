"""goal_attainment_query.py — GoalAttainmentQuery use-case (Phase 2, slice 7).

@paradigm: sql (deterministic integer attainment + boolean RAG classification; zero LLM/ML)

The per-metric goal table for ONE workspace: each goal's actual vs target, the attainment
in basis points, and the DIRECTION-AWARE RAG band — ported Brain-native from legacy
routes/workspaces/goals.ts + lib/metrics/goals.ts onto the slice-1..6 foundation.

LEGACY GROUND TRUTH (lib/metrics/goals.ts — Rohan Stage-1 Finding 1; the slice-table's flat
"≥95% green / 80-95% amber / <80% red" is ONLY the higher-better case):
  computeGoalRag(actual, goal, higherBetter):
    higher-better: actual >= goal*0.95 → green ; >= goal*0.80 → amber ; else red
    lower-better:  actual <= goal*1.05 → green ; <= goal*1.20 → amber ; else red
  higherBetterForGoal(goalType, metricHigherBetter):
    MINIMUM → higher-better ; MAXIMUM → lower-better ; TARGET → metric's intrinsic direction.
  GOAL_METRIC_REGISTRY directions: revenue/cm3/cm3_pct/mer/amer/aov/new_customers/meta_roas/
    google_roas → higher-better ; cac/acos → lower-better.

The attainment magnitude (goal_attainment_bp) is the canonical registry def; the band is the
registry's compute_goal_rag classification. The use-case NEVER recomputes the band locally.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    goal_attainment_bp as _GOAL_ATTAINMENT_DEF,
    compute_goal_rag as _compute_goal_rag,
    goal_higher_better as _goal_higher_better,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

# Canonical goal-metric directions (legacy GOAL_METRIC_REGISTRY.higherBetter).
# lower-better: cac, acos. Everything else higher-better.
GOAL_METRIC_HIGHER_BETTER: dict[str, bool] = {
    "revenue": True,
    "cm3": True,
    "cm3_pct": True,
    "mer": True,
    "amer": True,
    "cac": False,
    "aov": True,
    "new_customers": True,
    "acos": False,
    "meta_roas": True,
    "google_roas": True,
}

VALID_GOAL_TYPES = ("MINIMUM", "MAXIMUM", "TARGET")
VALID_PERIOD_TYPES = ("DAILY", "WEEKLY", "MONTHLY")


@dataclass(frozen=True)
class GoalRowFact:
    """One stored goal + its measured actual for the period (integer-scaled, consistent units)."""

    metric_name: str
    period_type: str          # DAILY | WEEKLY | MONTHLY
    period_start: str         # ISO yyyy-mm-dd
    goal_value: int           # minor units / bp / count, SAME scale as actual
    goal_type: str            # MINIMUM | MAXIMUM | TARGET
    actual: int


@dataclass(frozen=True)
class GoalFacts:
    """Per-workspace stored goals + actuals for the range."""

    rows: tuple[GoalRowFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class GoalEvaluationRow:
    metric_name: str
    period_type: str
    period_start: str
    goal_type: str
    goal_value: int
    actual: int
    attainment_bp: int | None  # NULL when goal_value == 0
    variance_abs: int          # actual - goal_value
    higher_better: bool
    rag: str                   # green | amber | red


@dataclass(frozen=True)
class GoalAttainmentResult:
    workspace_id: str
    rows: tuple[GoalEvaluationRow, ...]
    total_rows: int


class GoalAttainmentQuery:
    """Assemble the directional goal-attainment table for one workspace."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: GoalFacts,
        *,
        _client: object | None = None,
    ) -> GoalAttainmentResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "GoalAttainmentQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "goal_attainment_bp", date_range, _client=_client)

        rows: list[GoalEvaluationRow] = []
        for f in facts.rows:
            metric_hb = GOAL_METRIC_HIGHER_BETTER.get(f.metric_name, True)
            higher_better = _goal_higher_better(f.goal_type, metric_hb)
            attainment = (
                _GOAL_ATTAINMENT_DEF.formula_py(f.actual, f.goal_value)
                if f.goal_value != 0
                else None
            )
            rag = _compute_goal_rag(f.actual, f.goal_value, higher_better)
            rows.append(
                GoalEvaluationRow(
                    metric_name=f.metric_name,
                    period_type=f.period_type,
                    period_start=f.period_start,
                    goal_type=f.goal_type,
                    goal_value=f.goal_value,
                    actual=f.actual,
                    attainment_bp=attainment,
                    variance_abs=f.actual - f.goal_value,
                    higher_better=higher_better,
                    rag=rag,
                )
            )

        # Stable order: metric name asc, then period (DAILY < WEEKLY < MONTHLY).
        period_rank = {"DAILY": 0, "WEEKLY": 1, "MONTHLY": 2}
        rows.sort(key=lambda r: (r.metric_name, period_rank.get(r.period_type, 9)))

        return GoalAttainmentResult(
            workspace_id=workspace_id,
            rows=tuple(rows),
            total_rows=len(rows),
        )
