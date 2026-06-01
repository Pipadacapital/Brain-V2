"""logistics_query.py — LogisticsQuery use-case (Phase 2, slice 3).

@paradigm: sql (deterministic integer aggregation; zero LLM/ML)

Logistics operational summary for ONE workspace over a date range, ported Brain-native from
legacy lib/workspace-metrics/logistics-summary.ts. Shiprocket-only: shipment counts,
delivered%/RTO% (registry rto_rate_bp), charge breakdown (forward + COD + RTO), avg shipping
charge, by-courier. money in BIGINT paise.

HONEST-INPUT PATTERN: shipment-level counts/charges are EXPLICIT workspace-scoped inputs
(connector-held), not gateway columns.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    rto_rate_bp as _RTO_RATE_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


@dataclass(frozen=True)
class CourierLogisticsFacts:
    courier_name: str
    count: int
    delivered_count: int
    rto_count: int
    total_charges_mu: int


@dataclass(frozen=True)
class LogisticsFacts:
    """Per-workspace logistics operational facts (paise / counts) for the range."""

    total_shipments: int = 0
    delivered_count: int = 0
    rto_count: int = 0
    cod_count: int = 0
    prepaid_count: int = 0
    forward_charges_mu: int = 0
    cod_charges_mu: int = 0
    rto_charges_mu: int = 0
    by_courier: tuple[CourierLogisticsFacts, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class LogisticsCourier:
    courier_name: str
    count: int
    delivered_count: int
    rto_count: int
    total_charges_mu: int


@dataclass(frozen=True)
class LogisticsResult:
    workspace_id: str
    total_shipments: int
    delivered_count: int
    delivered_rate_bp: int | None
    rto_count: int
    rto_rate_bp: int | None
    cod_count: int
    prepaid_count: int
    forward_charges_mu: int
    cod_charges_mu: int
    rto_charges_mu: int
    total_shiprocket_charges_mu: int
    average_shipping_charge_per_shipment_mu: int | None
    by_courier: tuple[LogisticsCourier, ...]
    currency_code: str


class LogisticsQuery:
    """Assemble the logistics operational summary for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: LogisticsFacts,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> LogisticsResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "LogisticsQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        query_metrics(workspace_id, "rto_rate_bp", date_range, _client=_client)

        total = facts.total_shipments
        delivered_rate = (
            _RTO_RATE_DEF.formula_py(facts.delivered_count, total) if total > 0 else None
        )
        rto_rate = (
            _RTO_RATE_DEF.formula_py(facts.rto_count, total) if total > 0 else None
        )
        total_charges = (
            facts.forward_charges_mu + facts.cod_charges_mu + facts.rto_charges_mu
        )
        avg_charge = total_charges // total if total > 0 else None

        by_courier = tuple(
            LogisticsCourier(
                courier_name=c.courier_name,
                count=c.count,
                delivered_count=c.delivered_count,
                rto_count=c.rto_count,
                total_charges_mu=c.total_charges_mu,
            )
            for c in sorted(facts.by_courier, key=lambda c: c.count, reverse=True)
        )

        return LogisticsResult(
            workspace_id=workspace_id,
            total_shipments=total,
            delivered_count=facts.delivered_count,
            delivered_rate_bp=delivered_rate,
            rto_count=facts.rto_count,
            rto_rate_bp=rto_rate,
            cod_count=facts.cod_count,
            prepaid_count=facts.prepaid_count,
            forward_charges_mu=facts.forward_charges_mu,
            cod_charges_mu=facts.cod_charges_mu,
            rto_charges_mu=facts.rto_charges_mu,
            total_shiprocket_charges_mu=total_charges,
            average_shipping_charge_per_shipment_mu=avg_charge,
            by_courier=by_courier,
            currency_code=currency_code,
        )
