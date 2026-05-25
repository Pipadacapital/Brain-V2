# brain_metrics — metric registry, Python half of the TS↔Python parity pair.
# Counterpart: packages/lib-metrics (@brain/lib-metrics).
# Parity check: tools/check-metrics-parity.sh (turbo task: check:metrics-parity).
#
# Child 2 (feat-money-minor-units-parity): Money value object + conversion +
# ratio + subunit lookup + goal type + parity harness.
# Child 4 (feat-metric-engine-olap-split): metric registry + 9-field DDR +
# ClickHouse round-trip fixtures + True-CM2 + taxonomy COGS category.
# @paradigm: sql — deterministic value types + exact-integer arithmetic.

from brain_metrics.convert import decimal_to_minor_units
from brain_metrics.goal_type import GoalType
from brain_metrics.money import Money, make_money
from brain_metrics.ratio import ratio_to_basis_points
from brain_metrics.subunits import subunit_multiplier

# Child 4: metric registry
from brain_metrics.registry import MetricDefinition, METRIC_REGISTRY, get_metric

# Child 4: 9-field DDR
from brain_metrics.parity.definitional_delta_register import (
    DDRRow,
    DEFINITIONAL_DELTA_REGISTER,
    SignOffBlockedError,
    get_ddr_row,
    is_parity_gap,
    is_child_dependency_blocked,
    get_parity_gap_metrics,
    get_child_dependency_blocked_metrics,
)

__all__ = [
    # Child 2: money primitives
    "Money",
    "make_money",
    "decimal_to_minor_units",
    "ratio_to_basis_points",
    "subunit_multiplier",
    "GoalType",
    # Child 4: registry
    "MetricDefinition",
    "METRIC_REGISTRY",
    "get_metric",
    # Child 4: DDR
    "DDRRow",
    "DEFINITIONAL_DELTA_REGISTER",
    "SignOffBlockedError",
    "get_ddr_row",
    "is_parity_gap",
    "is_child_dependency_blocked",
    "get_parity_gap_metrics",
    "get_child_dependency_blocked_metrics",
]
