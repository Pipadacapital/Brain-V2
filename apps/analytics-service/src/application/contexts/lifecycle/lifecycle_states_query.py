"""lifecycle_states_query.py — LifecycleStatesQuery use-case (Phase 2, slice 8).

@paradigm: sql (deterministic recency classification + empirical percentile thresholds;
zero LLM/ML. RFM is SQL/analytics scoring — NO model.)

The customer-lifecycle report for ONE workspace: each customer is classified
new / active / at_risk / churned from RECENCY (calendar days since last order) vs the
workspace's EMPIRICAL repeat-gap percentiles p40/p80, plus revenue/order-count attributed
by bucket over a trailing window.

LEGACY GROUND TRUTH (Rohan Stage-1 Finding 1 — the standing lesson bit an 8th time;
the slice-table's "customer_state (RFM)" with R/F/M quintile SCORING is WRONG):
  lib/metrics/customer-lifecycle.ts classifyCustomerLifecycle:
    d = max(0, calendarDays(asOf, lastOrderAt))
    orderCount == 1:  d<=p40 → new ; d<=p80 → at_risk ; else churned
    orderCount >= 2:  d<=p40 → active ; d<=p80 → at_risk ; else churned
  lib/metrics/churn-thresholds.ts computeChurnThresholds:
    repeat gaps = calendarDays between consecutive included orders per customer in the
      training window; p40/p80 = linear-interpolation percentile (PERCENTILE.INC);
      fallback p40=45 / p80=120 when totalGaps < MIN_GAPS_FOR_EMPIRICAL(20).
  netActive = new + active.
There is NO recency/frequency/monetary quintile SCORING anywhere — "RFM scores/segments"
would be a phantom. Frequency enters only as orderCount==1 (new) vs >=2 (active); monetary
is reported as revenue-by-bucket attribution, not a score. The classifier + percentile are
USE-CASE logic here (like compute_goal_rag), NOT registry scalars.

COMPLIANCE BOUNDARY (Shreya S4): this is REPORTING on lifecycle state. It NEVER triggers a
campaign, an audience-to-channel dispatch, or an outbound send. RFM = analytics scoring only.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

# Legacy churn-thresholds.ts constants (exact).
MIN_GAPS_FOR_EMPIRICAL = 20
FALLBACK_P40_DAYS = 45
FALLBACK_P80_DAYS = 120

LIFECYCLE_BUCKETS = ("new", "active", "at_risk", "churned")


def percentile_linear(sorted_asc: list[int], p: int) -> float:
    """PERCENTILE.INC linear interpolation on rank index (legacy churn-thresholds.ts).

    @paradigm: sql — deterministic. pos = (p/100)*(n-1); blend g[floor], g[ceil].
    Float is permitted here ONLY for the percentile blend (identical to legacy); the
    RESULT is immediately rounded to an integer day count, so the classifier is integer-exact.
    """
    n = len(sorted_asc)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_asc[0])
    pos = (p / 100) * (n - 1)
    lo = int(pos)  # floor for non-negative pos
    hi = lo + 1 if pos > lo else lo
    if lo == hi:
        return float(sorted_asc[lo])
    w = pos - lo
    return sorted_asc[lo] + w * (sorted_asc[hi] - sorted_asc[lo])


def compute_churn_thresholds(repeat_gaps_days: list[int]) -> tuple[int, int, bool]:
    """Return (p40_days, p80_days, used_fallback) from empirical repeat gaps.

    Mirrors legacy computeChurnThresholds: fallback to 45/120 when gaps < 20.
    p40 = max(1, round(P40)); p80 = max(p40+1, round(P80)) — keeps p80 strictly > p40.
    """
    gaps = sorted(g for g in repeat_gaps_days if g >= 0)
    used_fallback = len(gaps) < MIN_GAPS_FOR_EMPIRICAL
    if used_fallback:
        return FALLBACK_P40_DAYS, FALLBACK_P80_DAYS, True
    p40 = max(1, round(percentile_linear(gaps, 40)))
    p80 = max(p40 + 1, round(percentile_linear(gaps, 80)))
    return p40, p80, False


def classify_customer_lifecycle(
    order_count: int, days_since_last: int, p40_days: int, p80_days: int
) -> str:
    """Classify a customer into new/active/at_risk/churned (legacy classifyCustomerLifecycle).

    @paradigm: sql — pure integer comparison. order_count must be >= 1.
    NON-VACUOUS: a single-order customer at d<=p40 is 'new'; a multi-order customer at the
    same recency is 'active' — the orderCount split is load-bearing.
    """
    if order_count < 1:
        raise ValueError("classify_customer_lifecycle: order_count must be >= 1")
    d = max(0, days_since_last)
    if order_count == 1:
        if d <= p40_days:
            return "new"
        if d <= p80_days:
            return "at_risk"
        return "churned"
    if d <= p40_days:
        return "active"
    if d <= p80_days:
        return "at_risk"
    return "churned"


@dataclass(frozen=True)
class CustomerFact:
    """One customer's lifetime summary as of the report date (integer paise / day counts)."""

    customer_id: str
    order_count: int
    days_since_last_order: int
    trailing_revenue_mu: int  # revenue attributed in the trailing window
    trailing_order_count: int


@dataclass(frozen=True)
class LifecycleFacts:
    """Per-workspace lifecycle facts for the report.

    repeat_gaps_days: all inter-order repeat gaps (days) in the training window — feeds p40/p80.
    customers: per-customer lifetime summary as of the report date.
    unattributed_revenue_mu / unattributed_order_count: trailing orders with no resolvable
        customer (reported separately, never silently folded into a bucket).
    """

    repeat_gaps_days: tuple[int, ...] = field(default_factory=tuple)
    customers: tuple[CustomerFact, ...] = field(default_factory=tuple)
    unattributed_revenue_mu: int = 0
    unattributed_order_count: int = 0
    currency_code: str = "INR"


@dataclass(frozen=True)
class LifecycleBucketRow:
    bucket: str
    customer_count: int
    revenue_mu: int
    order_count: int


@dataclass(frozen=True)
class LifecycleStatesResult:
    workspace_id: str
    p40_days: int
    p80_days: int
    used_fallback: bool
    buckets: tuple[LifecycleBucketRow, ...]
    net_active: int
    total_customers: int
    unattributed_revenue_mu: int
    unattributed_order_count: int
    currency_code: str


class LifecycleStatesQuery:
    """Assemble the customer-lifecycle report for one workspace (READ-ONLY)."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: LifecycleFacts,
        *,
        _client: object | None = None,
    ) -> LifecycleStatesResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "LifecycleStatesQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke). READ ONLY.
        query_metrics(workspace_id, "reactivation_window_days", date_range, _client=_client)

        p40, p80, used_fallback = compute_churn_thresholds(list(facts.repeat_gaps_days))

        counts = {b: 0 for b in LIFECYCLE_BUCKETS}
        revenue = {b: 0 for b in LIFECYCLE_BUCKETS}
        orders = {b: 0 for b in LIFECYCLE_BUCKETS}

        for c in facts.customers:
            bucket = classify_customer_lifecycle(
                c.order_count, c.days_since_last_order, p40, p80
            )
            counts[bucket] += 1
            revenue[bucket] += c.trailing_revenue_mu
            orders[bucket] += c.trailing_order_count

        buckets = tuple(
            LifecycleBucketRow(
                bucket=b,
                customer_count=counts[b],
                revenue_mu=revenue[b],
                order_count=orders[b],
            )
            for b in LIFECYCLE_BUCKETS
        )
        net_active = counts["new"] + counts["active"]

        return LifecycleStatesResult(
            workspace_id=workspace_id,
            p40_days=p40,
            p80_days=p80,
            used_fallback=used_fallback,
            buckets=buckets,
            net_active=net_active,
            total_customers=len(facts.customers),
            unattributed_revenue_mu=facts.unattributed_revenue_mu,
            unattributed_order_count=facts.unattributed_order_count,
            currency_code=facts.currency_code,
        )
