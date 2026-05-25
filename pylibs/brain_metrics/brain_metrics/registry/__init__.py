"""
registry/__init__.py — Metric registry, Python half of the TS↔Python byte-identity pair.

@paradigm: sql (integer arithmetic, zero LLM, zero float in money/ratio paths)
Justified: every metric is a deterministic SQL aggregation or integer-arithmetic
combination. No inference path exists. LLMs never produce a metric number.
CF-C4-DDR-1, M1, M2 (Child 4).

Counterpart: packages/lib-metrics/src/registry/index.ts
Parity enforced by extended tools/check-metrics-parity.sh.

MetricDefinition fields (byte-identity pair with TS MetricDefinition):
  id             — canonical snake_case metric id (matches TS camelCase via parity map)
  kind           — "money" | "ratio" | "count"
  unit           — "mu" | "bp" | "count"
  formula_py     — pure Python callable; integer arithmetic; zero float for money
  clickhouse_sql — the MV expression; intDiv + null-guard (NEVER "/")
  display_only   — True for blended_roas_x100, acos_bp (CM2-first; ROAS never a decision metric)
  parity_class   — "shadow_compare" | "correctness_fixture"
                   correctness_fixture = parity_gap:true Brain-native (no legacy comparand)
"""

from brain_metrics.registry.definitions import (
    MetricDefinition,
    METRIC_REGISTRY,
    get_metric,
    # Phase-2 slice-7: goal attainment + directional RAG (classification, not registry metric).
    goal_attainment_bp,
    compute_goal_rag,
    goal_higher_better,
)

__all__ = [
    "MetricDefinition",
    "METRIC_REGISTRY",
    "get_metric",
    "goal_attainment_bp",
    "compute_goal_rag",
    "goal_higher_better",
]
