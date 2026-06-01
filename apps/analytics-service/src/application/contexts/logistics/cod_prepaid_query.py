"""cod_prepaid_query.py — CodPrepaidQuery use-case (Phase 2, slice 3).

@paradigm: sql (deterministic integer aggregation; zero LLM/ML)

COD vs prepaid economics for ONE workspace over a date range, ported Brain-native from
legacy lib/workspace-metrics/cod-prepaid-analytics.ts onto slice-1's foundation. Computes
COD realization, COD/prepaid RTO rates, effective revenue per segment, and the break-even
COD RTO rate — using the FULL legacy break-even formula (NOT the naive r*=M/(M+C); see DDR
_ROW_BREAKEVEN_COD_RTO and Rohan's Stage-1 Concern-1).

HONEST-INPUT PATTERN: shipment-level counts/values + fee inputs are EXPLICIT workspace-scoped
inputs (connector-held), not gateway columns. money in BIGINT paise.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass

from brain_metrics.registry.definitions import (
    rto_rate_bp as _RTO_RATE_DEF,
    cod_realization_rate_bp as _COD_REALIZATION_DEF,
    breakeven_cod_rto_rate_bp as _BREAKEVEN_DEF,
    aov_mu as _AOV_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


# ---------------------------------------------------------------------------
# Explicit, workspace-scoped operational facts + fee inputs.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CodPrepaidFacts:
    """Per-workspace COD/prepaid operational facts (paise / counts) for the range."""

    cod_orders: int = 0
    prepaid_orders: int = 0
    cod_delivered: int = 0
    prepaid_delivered: int = 0
    cod_rto: int = 0
    prepaid_rto: int = 0
    gross_revenue_cod_mu: int = 0
    gross_revenue_prepaid_mu: int = 0
    rto_cost_cod_mu: int = 0
    rto_cost_prepaid_mu: int = 0


@dataclass(frozen=True)
class FeeInputs:
    """Configurable fees (paise / bp). Mirrors legacy CodPrepaidFeeInputs.

    cod_fee_mu: flat COD handling fee per order (paise).
    gateway_fee_bp: prepaid payment-gateway fee as bp of prepaid gross (e.g. 200 = 2%).
    return_shipping_mu: return-shipping cost per RTO shipment (paise).
    restocking_mu: restocking per RTO (paise; legacy = 0).
    """

    cod_fee_mu: int = 0
    gateway_fee_bp: int = 0
    return_shipping_mu: int = 0
    restocking_mu: int = 0


# ---------------------------------------------------------------------------
# Value objects.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CodPrepaidSegment:
    payment_method: str  # 'COD' | 'Prepaid'
    orders: int
    gross_revenue_mu: int
    rto_rate_bp: int | None
    effective_revenue_mu: int
    fee_total_mu: int
    net_revenue_per_order_mu: int | None


@dataclass(frozen=True)
class CodPrepaidResult:
    workspace_id: str
    cod_orders: int
    prepaid_orders: int
    cod_realization_rate_bp: int | None
    cod_rto_rate_bp: int | None
    prepaid_rto_rate_bp: int | None
    effective_revenue_cod_mu: int
    effective_revenue_prepaid_mu: int
    prepaid_premium_mu: int
    average_order_value_mu: int | None
    breakeven_cod_rto_rate_bp: int | None
    breakeven_note: str | None
    comparison: tuple[CodPrepaidSegment, ...]
    currency_code: str


class CodPrepaidQuery:
    """Assemble COD vs prepaid economics for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: CodPrepaidFacts,
        fees: FeeInputs,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> CodPrepaidResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "CodPrepaidQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        query_metrics(workspace_id, "cod_realization_rate_bp", date_range, _client=_client)

        # Rates via registry formulas (FLOOR bp; None on zero denominator).
        cod_realization = (
            _COD_REALIZATION_DEF.formula_py(facts.cod_delivered, facts.cod_orders)
            if facts.cod_orders > 0
            else None
        )
        cod_rto_rate = (
            _RTO_RATE_DEF.formula_py(facts.cod_rto, facts.cod_orders)
            if facts.cod_orders > 0
            else None
        )
        prepaid_rto_rate = (
            _RTO_RATE_DEF.formula_py(facts.prepaid_rto, facts.prepaid_orders)
            if facts.prepaid_orders > 0
            else None
        )

        # Effective revenue (integer paise). Mirrors legacy effectiveRevenue formula but in paise.
        #   eff_cod = gross_cod * (1 - cod_rto_rate) - cod_fee_total - cod_return_shipping_total
        # cod_rto_rate is in bp; compute the survived-revenue with integer FLOOR:
        #   survived = gross - intDiv(gross * cod_rto_bp, 10000)
        cod_rto_bp = cod_rto_rate or 0
        prepaid_rto_bp = prepaid_rto_rate or 0
        cod_fee_total = facts.cod_orders * fees.cod_fee_mu
        gateway_fee_total = (facts.gross_revenue_prepaid_mu * fees.gateway_fee_bp) // 10000
        cod_return_shipping_total = facts.cod_rto * fees.return_shipping_mu
        prepaid_return_shipping_total = facts.prepaid_rto * fees.return_shipping_mu

        cod_survived = facts.gross_revenue_cod_mu - (
            facts.gross_revenue_cod_mu * cod_rto_bp
        ) // 10000
        prepaid_survived = facts.gross_revenue_prepaid_mu - (
            facts.gross_revenue_prepaid_mu * prepaid_rto_bp
        ) // 10000

        eff_cod = cod_survived - cod_fee_total - cod_return_shipping_total
        eff_prepaid = prepaid_survived - gateway_fee_total - prepaid_return_shipping_total
        prepaid_premium = eff_prepaid - eff_cod

        total_orders = facts.cod_orders + facts.prepaid_orders
        total_gross = facts.gross_revenue_cod_mu + facts.gross_revenue_prepaid_mu
        aov = (
            _AOV_DEF.formula_py(total_gross, total_orders)
            if total_orders > 0
            else None
        )

        # Break-even COD RTO rate — the FULL legacy formula via the registry def.
        breakeven_bp: int | None = None
        breakeven_note: str | None = None
        if aov is not None and aov > 0 and (aov + fees.return_shipping_mu + fees.restocking_mu) > 0:
            raw = _BREAKEVEN_DEF.formula_py(
                aov,
                prepaid_rto_bp,
                fees.cod_fee_mu,
                fees.gateway_fee_bp,
                fees.return_shipping_mu,
                fees.restocking_mu,
            )
            if raw is None:
                breakeven_note = "Return shipping cost required for break-even."
            elif 0 <= raw <= 10000:
                breakeven_bp = raw
            elif raw < 0:
                breakeven_note = "Prepaid is always better at current AOV and fees."
            else:
                breakeven_note = "COD is always better at current AOV and fees."
        elif total_orders == 0 or total_gross <= 0:
            breakeven_note = "No orders in range; set date range and sync Shiprocket."
        elif aov is None or aov <= 0:
            breakeven_note = "Average order value unavailable."
        else:
            breakeven_note = "Return shipping cost required for break-even."

        comparison = (
            CodPrepaidSegment(
                payment_method="COD",
                orders=facts.cod_orders,
                gross_revenue_mu=facts.gross_revenue_cod_mu,
                rto_rate_bp=cod_rto_rate,
                effective_revenue_mu=eff_cod,
                fee_total_mu=cod_fee_total + cod_return_shipping_total,
                net_revenue_per_order_mu=(
                    eff_cod // facts.cod_orders if facts.cod_orders > 0 else None
                ),
            ),
            CodPrepaidSegment(
                payment_method="Prepaid",
                orders=facts.prepaid_orders,
                gross_revenue_mu=facts.gross_revenue_prepaid_mu,
                rto_rate_bp=prepaid_rto_rate,
                effective_revenue_mu=eff_prepaid,
                fee_total_mu=gateway_fee_total + prepaid_return_shipping_total,
                net_revenue_per_order_mu=(
                    eff_prepaid // facts.prepaid_orders if facts.prepaid_orders > 0 else None
                ),
            ),
        )

        return CodPrepaidResult(
            workspace_id=workspace_id,
            cod_orders=facts.cod_orders,
            prepaid_orders=facts.prepaid_orders,
            cod_realization_rate_bp=cod_realization,
            cod_rto_rate_bp=cod_rto_rate,
            prepaid_rto_rate_bp=prepaid_rto_rate,
            effective_revenue_cod_mu=eff_cod,
            effective_revenue_prepaid_mu=eff_prepaid,
            prepaid_premium_mu=prepaid_premium,
            average_order_value_mu=aov,
            breakeven_cod_rto_rate_bp=breakeven_bp,
            breakeven_note=breakeven_note,
            comparison=comparison,
            currency_code=currency_code,
        )
