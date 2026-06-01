"""pincode_intelligence_query.py — PincodeIntelligenceQuery use-case (Phase 2, slice 3).

@paradigm: sql (deterministic integer aggregation + scoring; zero LLM/ML)

Pincode intelligence for ONE workspace over a date range, ported Brain-native from legacy
lib/workspace-metrics/pincode-intelligence.ts. Per-pincode RTO%/COD%/delivered%/repeat-rate,
AOV, tier (city_tiers), and the Brain-native integerized reliability score
(pincode_reliability_score — see DDR _ROW_PINCODE_RELIABILITY; integer centi-points, not the
legacy float profitability score). Filters/sort live here, not in the registry.

HONEST-INPUT PATTERN: per-pincode shipment aggregates are EXPLICIT workspace-scoped inputs
(connector-held), not gateway columns. money in BIGINT paise; rates in bp.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    rto_rate_bp as _RTO_RATE_DEF,
    aov_mu as _AOV_DEF,
    pincode_reliability_score as _RELIABILITY_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)
from .city_tiers import classify_tier


# High-RTO / high-COD display thresholds (bp). Ported from legacy:319-323 (20% / 50%).
_HIGH_RTO_BP = 2000
_HIGH_COD_BP = 5000


@dataclass(frozen=True)
class PincodeFacts:
    """Per-pincode aggregated shipment facts (paise / counts) for the range."""

    pincode: str
    city: str
    state: str
    shipment_count: int
    rto_count: int
    cod_count: int
    delivered_count: int
    revenue_mu: int            # revenue from delivered, non-RTO shipments
    unique_customers: int
    repeat_customers: int
    top_courier: str = "—"


@dataclass(frozen=True)
class PincodeFilters:
    search: str | None = None
    state: str | None = None
    min_orders: int = 0
    high_rto_only: bool = False
    high_cod_only: bool = False
    sort: str = "shipment_count"
    order: str = "desc"  # 'asc' | 'desc'


@dataclass(frozen=True)
class PincodeRow:
    pincode: str
    city: str
    state: str
    tier: int | None
    shipment_count: int
    rto_count: int
    rto_rate_bp: int | None
    cod_count: int
    cod_rate_bp: int | None
    delivered_count: int
    delivered_rate_bp: int | None
    revenue_mu: int
    aov_mu: int | None
    unique_customers: int
    repeat_rate_bp: int | None
    reliability_score: int      # centi-points (0..10000)
    top_courier: str


@dataclass(frozen=True)
class PincodeIntelligenceResult:
    workspace_id: str
    rows: tuple[PincodeRow, ...]
    total_shipments: int
    currency_code: str


class PincodeIntelligenceQuery:
    """Assemble pincode intelligence rows for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        pincode_facts: tuple[PincodeFacts, ...],
        filters: PincodeFilters | None = None,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> PincodeIntelligenceResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "PincodeIntelligenceQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        query_metrics(workspace_id, "rto_rate_bp", date_range, _client=_client)

        filters = filters or PincodeFilters()
        rows: list[PincodeRow] = []
        total_shipments = 0

        for f in pincode_facts:
            total_shipments += f.shipment_count
            sc = f.shipment_count
            rto_bp = _RTO_RATE_DEF.formula_py(f.rto_count, sc) if sc > 0 else None
            cod_bp = _RTO_RATE_DEF.formula_py(f.cod_count, sc) if sc > 0 else None
            delivered_bp = _RTO_RATE_DEF.formula_py(f.delivered_count, sc) if sc > 0 else None
            # AOV from delivered shipments (legacy: revenue / deliveredCount).
            aov = (
                _AOV_DEF.formula_py(f.revenue_mu, f.delivered_count)
                if f.delivered_count > 0
                else None
            )
            repeat_bp = (
                _RTO_RATE_DEF.formula_py(f.repeat_customers, f.unique_customers)
                if f.unique_customers > 0
                else None
            )
            # Reliability score via the registry def (integer centi-points; clamped).
            score = _RELIABILITY_DEF.formula_py(
                rto_bp or 0,
                cod_bp or 0,
                repeat_bp or 0,
                aov or 0,
            )
            rows.append(
                PincodeRow(
                    pincode=f.pincode,
                    city=f.city,
                    state=f.state,
                    tier=classify_tier(f.city),
                    shipment_count=sc,
                    rto_count=f.rto_count,
                    rto_rate_bp=rto_bp,
                    cod_count=f.cod_count,
                    cod_rate_bp=cod_bp,
                    delivered_count=f.delivered_count,
                    delivered_rate_bp=delivered_bp,
                    revenue_mu=f.revenue_mu,
                    aov_mu=aov,
                    unique_customers=f.unique_customers,
                    repeat_rate_bp=repeat_bp,
                    reliability_score=score,
                    top_courier=f.top_courier,
                )
            )

        rows = self._apply_filters(rows, filters)
        rows = self._sort(rows, filters)

        return PincodeIntelligenceResult(
            workspace_id=workspace_id,
            rows=tuple(rows),
            total_shipments=total_shipments,
            currency_code=currency_code,
        )

    @staticmethod
    def _apply_filters(rows: list[PincodeRow], f: PincodeFilters) -> list[PincodeRow]:
        out = rows
        if f.search and f.search.strip():
            q = f.search.strip().lower()
            out = [
                r for r in out
                if q in r.pincode.lower() or q in r.city.lower() or q in r.state.lower()
            ]
        if f.state and f.state.strip():
            s = f.state.strip().lower()
            out = [r for r in out if r.state.lower() == s]
        if f.min_orders > 0:
            out = [r for r in out if r.shipment_count >= f.min_orders]
        if f.high_rto_only:
            out = [r for r in out if r.rto_rate_bp is not None and r.rto_rate_bp >= _HIGH_RTO_BP]
        if f.high_cod_only:
            out = [r for r in out if r.cod_rate_bp is not None and r.cod_rate_bp >= _HIGH_COD_BP]
        return out

    @staticmethod
    def _sort(rows: list[PincodeRow], f: PincodeFilters) -> list[PincodeRow]:
        key = f.sort or "shipment_count"
        reverse = (f.order or "desc") == "desc"
        string_keys = {"pincode", "city", "state", "top_courier"}

        def sort_value(r: PincodeRow):
            v = getattr(r, key, None)
            if key in string_keys:
                return str(v or "")
            return v if v is not None else -1  # None sorts low

        try:
            return sorted(rows, key=sort_value, reverse=reverse)
        except (TypeError, AttributeError):
            return sorted(rows, key=lambda r: r.shipment_count, reverse=True)
