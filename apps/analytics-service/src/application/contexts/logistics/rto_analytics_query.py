"""rto_analytics_query.py — RtoAnalyticsQuery use-case (Phase 2, slice 3).

@paradigm: sql (deterministic integer aggregation over structured facts; zero LLM/ML)

RTO analytics for ONE workspace over a date range, ported Brain-native from legacy
lib/workspace-metrics/rto-analytics.ts onto slice-1's foundation. Reads workspace-scoped
facts through the ClickHouse query gateway (fail-closed) and assembles the RTO leak picture:
rate (registry rto_rate_bp), total cost, revenue lost, by-payment-method, by-courier.

HONEST-INPUT PATTERN (slice-1/2):
  Shipment-level operational facts (total_shipments, rto_orders, RTO charges/value, courier
  breakdown, COD/prepaid RTO split) are NOT columns on the gateway MetricRow — they arrive
  live at the held Child-3 connector cutover. Like slice-1's ReversalFacts and slice-2's
  VariableCostFacts, they are accepted as EXPLICIT, workspace-scoped inputs rather than
  hidden defaults. The DDR row _ROW_RTO_COST_VALUE carries child_dependency:child-3.

TENANCY:
  query_metrics(workspace_id, ...) is the only read path; a falsy workspace_id raises
  UnscopedQueryError. This use-case re-asserts the scope before any read (defense in depth).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    rto_rate_bp as _RTO_RATE_DEF,
    rto_cost_mu as _RTO_COST_DEF,
    rto_revenue_lost_mu as _RTO_REVENUE_LOST_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


# ---------------------------------------------------------------------------
# Explicit, workspace-scoped operational facts (no hidden defaults).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CourierRtoFacts:
    """Per-courier RTO breakdown (paise / counts) for the range."""

    courier_name: str
    rto_count: int
    rto_cost_mu: int
    revenue_lost_mu: int


@dataclass(frozen=True)
class RtoFacts:
    """Per-workspace RTO operational facts for the date range (Shiprocket-sourced).

    All money in BIGINT paise. Counts are integers. by_courier is optional enrichment.
    """

    total_shipments: int = 0
    rto_orders: int = 0
    rto_cost_mu: int = 0
    rto_revenue_lost_mu: int = 0
    cod_rto_orders: int = 0
    prepaid_rto_orders: int = 0
    cod_rto_cost_mu: int = 0
    prepaid_rto_cost_mu: int = 0
    cod_revenue_lost_mu: int = 0
    prepaid_revenue_lost_mu: int = 0
    by_courier: tuple[CourierRtoFacts, ...] = field(default_factory=tuple)


# ---------------------------------------------------------------------------
# Value objects — frozen, integer-only.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RtoByPaymentMethod:
    payment_method: str  # 'COD' | 'Prepaid'
    rto_count: int
    rto_cost_mu: int
    revenue_lost_mu: int


@dataclass(frozen=True)
class RtoByCourier:
    courier_name: str
    rto_count: int
    rto_cost_mu: int
    revenue_lost_mu: int


@dataclass(frozen=True)
class RtoAnalytics:
    """RTO analytics over a date range. Money in integer paise; rate in bp (None if no shipments)."""

    workspace_id: str
    total_shipments: int
    rto_count: int
    rto_rate_bp: int | None
    total_rto_cost_mu: int
    revenue_lost_to_rto_mu: int
    by_payment_method: tuple[RtoByPaymentMethod, ...]
    by_courier: tuple[RtoByCourier, ...]
    currency_code: str


class RtoAnalyticsQuery:
    """Assemble the RTO leak picture for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        rto_facts: RtoFacts,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> RtoAnalytics:
        """Read workspace-scoped facts and assemble RTO analytics.

        Args:
            workspace_id: authenticated workspace scope. MUST be non-empty.
            date_range: inclusive date range.
            rto_facts: per-workspace RTO operational facts (Shiprocket-sourced).
            currency_code: workspace primary currency (India-first default INR).
            _client: test-injection ClickHouse client (NEVER in production).

        Raises:
            UnscopedQueryError: if workspace_id is falsy (fail-closed tenancy).
        """
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "RtoAnalyticsQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Touch the scoped read path (defense in depth + observability). The RTO operational
        # facts arrive via rto_facts (connector-held), but every use-case proves the scope.
        query_metrics(workspace_id, "rto_rate_bp", date_range, _client=_client)

        # RTO rate via the registry formula (FLOOR bp; None on zero shipments).
        rate = (
            _RTO_RATE_DEF.formula_py(rto_facts.rto_orders, rto_facts.total_shipments)
            if rto_facts.total_shipments > 0
            else None
        )

        # Total cost / revenue-lost via the passthrough registry defs (registry-traced).
        total_cost = _RTO_COST_DEF.formula_py(rto_facts.rto_cost_mu)
        revenue_lost = _RTO_REVENUE_LOST_DEF.formula_py(rto_facts.rto_revenue_lost_mu)

        by_payment = (
            RtoByPaymentMethod(
                payment_method="COD",
                rto_count=rto_facts.cod_rto_orders,
                rto_cost_mu=rto_facts.cod_rto_cost_mu,
                revenue_lost_mu=rto_facts.cod_revenue_lost_mu,
            ),
            RtoByPaymentMethod(
                payment_method="Prepaid",
                rto_count=rto_facts.prepaid_rto_orders,
                rto_cost_mu=rto_facts.prepaid_rto_cost_mu,
                revenue_lost_mu=rto_facts.prepaid_revenue_lost_mu,
            ),
        )

        # by-courier sorted by rto_count desc (mirrors legacy ordering).
        by_courier = tuple(
            RtoByCourier(
                courier_name=c.courier_name,
                rto_count=c.rto_count,
                rto_cost_mu=c.rto_cost_mu,
                revenue_lost_mu=c.revenue_lost_mu,
            )
            for c in sorted(rto_facts.by_courier, key=lambda c: c.rto_count, reverse=True)
        )

        return RtoAnalytics(
            workspace_id=workspace_id,
            total_shipments=rto_facts.total_shipments,
            rto_count=rto_facts.rto_orders,
            rto_rate_bp=rate,
            total_rto_cost_mu=total_cost,
            revenue_lost_to_rto_mu=revenue_lost,
            by_payment_method=by_payment,
            by_courier=by_courier,
            currency_code=currency_code,
        )
