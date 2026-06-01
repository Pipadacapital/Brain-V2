"""order_timings_query.py — OrderTimingsQuery use-case (Phase 2, slice 8).

@paradigm: sql (deterministic inter-order gap medians + repeat percentages; zero LLM/ML)

The order-timing report for ONE workspace: inter-order gap intervals (1→2, 2→3, 3→4),
2nd/3rd/4th repeat percentages, and the recommended reactivation window — overall and
grouped by product/variant/vendor/productType.

LEGACY GROUND TRUTH (Rohan Stage-1 Finding 2 — the slice-table's "best hours/days"
(best_send_time) is a PHANTOM; legacy timings has NO hour-of-day / day-of-week analysis):
  lib/timings/compute.ts:
    For first-order customers in [from,to], over their lifetime orders:
      days_i_to_j = (orderDates[j] - orderDates[i]) / 1 day
      secondOrdersPct = count(>=2 orders) / firstOrders * 100  (windowed first-order cohort)
      median1to2 / median2to3 / median3to4 = median (or mean) of the gap samples
      reactivationDays = REACTIVATION_PCT_OF_1TO2(0.8) × typical(1→2 gap)
  Groups are keyed by the first order's primary line item (highest-total) per groupBy.

  Finding 3: this 2nd-order% is a WINDOWED first-order cohort (all-product), DISTINCT from
  slice-6 first_product_second_order_rate_bp (lifetime >=2 / per-first-product cohort). NOT reused.

The repeat percentages are computed inline (count/cohort × 10000 bp) — they are windowed-cohort
aggregates, not a registry scalar. reactivation_window_days IS the registry def (Brain-native
integerized 0.8 factor). Gap medians are reported in whole days (integer).

COMPLIANCE BOUNDARY (Shreya S4): reactivation_window_days is a REPORTED recommendation, NEVER
an outbound send trigger. This use-case adds zero outbound-channel surface.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    reactivation_window_days as _REACTIVATION_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

VALID_GROUP_BY = ("product", "variant", "vendor", "productType")
VALID_METRIC = ("median", "mean")


def _median_int(values: list[int]) -> int:
    """Integer median (legacy median() on day gaps). Even-length → average of two mids, floor."""
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) // 2


def _mean_int(values: list[int]) -> int:
    """Integer mean (floor) of day gaps."""
    if not values:
        return 0
    return sum(values) // len(values)


def _pick_metric(values: list[int], metric: str) -> int:
    return _median_int(values) if metric == "median" else _mean_int(values)


def _rate_bp(count: int, cohort: int) -> int:
    """count / cohort in bp (FLOOR). 0 when cohort <= 0."""
    if cohort <= 0:
        return 0
    return (count * 10000) // cohort


@dataclass(frozen=True)
class TimingsGroupFact:
    """Inter-order timing sample for one grouping (or the overall cohort when id='').

    gap_*_days: the per-customer day gaps (1→2, 2→3, 3→4) for this cohort.
    count_2nd/3rd/4th: customers reaching the 2nd/3rd/4th order.
    """

    group_id: str
    label: str
    group_by: str
    first_orders: int
    count_2nd: int
    count_3rd: int
    count_4th: int
    gap_1to2_days: tuple[int, ...] = field(default_factory=tuple)
    gap_2to3_days: tuple[int, ...] = field(default_factory=tuple)
    gap_3to4_days: tuple[int, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class TimingsFacts:
    overall: TimingsGroupFact
    groups: tuple[TimingsGroupFact, ...] = field(default_factory=tuple)
    currency_code: str = "INR"


@dataclass(frozen=True)
class TimingsRow:
    group_id: str
    label: str
    group_by: str
    first_orders: int
    second_orders_bp: int
    third_orders_bp: int
    fourth_orders_bp: int
    days_1to2: int | None
    days_2to3: int | None
    days_3to4: int | None
    reactivation_window_days: int | None


@dataclass(frozen=True)
class OrderTimingsResult:
    workspace_id: str
    metric: str
    summary: TimingsRow
    groups: tuple[TimingsRow, ...]
    currency_code: str


class OrderTimingsQuery:
    """Assemble the order-timing report for one workspace (READ-ONLY)."""

    def _row(self, f: TimingsGroupFact, metric: str) -> TimingsRow:
        g12 = list(f.gap_1to2_days)
        g23 = list(f.gap_2to3_days)
        g34 = list(f.gap_3to4_days)
        median_1to2 = _pick_metric(g12, metric) if g12 else None
        reactivation = (
            _REACTIVATION_DEF.formula_py(median_1to2)
            if (median_1to2 is not None and median_1to2 > 0)
            else None
        )
        return TimingsRow(
            group_id=f.group_id,
            label=f.label,
            group_by=f.group_by,
            first_orders=f.first_orders,
            second_orders_bp=_rate_bp(f.count_2nd, f.first_orders),
            third_orders_bp=_rate_bp(f.count_3rd, f.first_orders),
            fourth_orders_bp=_rate_bp(f.count_4th, f.first_orders),
            days_1to2=median_1to2,
            days_2to3=_pick_metric(g23, metric) if g23 else None,
            days_3to4=_pick_metric(g34, metric) if g34 else None,
            reactivation_window_days=reactivation,
        )

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: TimingsFacts,
        *,
        metric: str = "median",
        _client: object | None = None,
    ) -> OrderTimingsResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "OrderTimingsQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        valid_metric = metric if metric in VALID_METRIC else "median"

        # Fail-closed scoped read (observability + tenancy choke). READ ONLY.
        query_metrics(workspace_id, "reactivation_window_days", date_range, _client=_client)

        summary = self._row(facts.overall, valid_metric)
        groups = tuple(self._row(g, valid_metric) for g in facts.groups)
        # Stable order: most first-orders first, then group id.
        groups = tuple(sorted(groups, key=lambda r: (-r.first_orders, r.group_id)))

        return OrderTimingsResult(
            workspace_id=workspace_id,
            metric=valid_metric,
            summary=summary,
            groups=groups,
            currency_code=facts.currency_code,
        )
