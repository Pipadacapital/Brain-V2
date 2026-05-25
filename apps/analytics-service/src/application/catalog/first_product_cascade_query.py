"""first_product_cascade_query.py — FirstProductCascadeQuery use-case (Phase 2, slice 6).

@paradigm: sql (deterministic integer aggregation over per-first-product cohorts; zero LLM/ML)

The first-product → repeat-purchase cascade for ONE workspace over a date range, ported
Brain-native from legacy lib/metrics/first-product-cascade.ts onto the slice-1..5 foundation.

LEGACY GROUND TRUTH (lib/metrics/first-product-cascade.ts — read at Stage 1, NOT the slice-table):
  - cohort = customer whose FIRST included order processedAt ∈ [from, to].
  - primary first product (exactly one cohort per customer) = top line on the first order by:
        line revenue (price×qty) DESC, then productShopifyId ASC (null-last), then lineItemId ASC.
  - observationEnd = endOfDay(to) + observationDaysAfterTo (default 365).
  - orderCount = included orders from firstOrder onward through observationEnd.
  - second/third/fourth+ rate (PERCENT 0-100; Brain → bp, Rohan Finding 4):
        secondOrderRate = (#cust ≥2 orders) / cohort   → first_product_second_order_rate_bp
        (NOT slice-5 repeat_rate_bp / rr90 — different window + cohort semantics).
  - additionalOrderRate = sum(max(0, orderCount-1)) / cohortSize  (mean EXTRA orders; ×100 here
        to keep integer precision — "centi-orders").
  - averageLtv = mean over cohort of sum(totalPrice) — REVENUE ONLY, NO CM (Rohan Finding 4;
        DDR note — legacy v1 cascade LTV is revenue, not margin).
  - averageDaysToSecondOrder = mean calendar days first→second (≥2-order custs), else null
        (×10 here to keep 1-decimal precision as an integer — "deci-days").

HONEST-INPUT PATTERN: the connector/fact layer owns the per-order facts and produces, per
first-product cohort, the deterministic primary-product grouping + the count/LTV/days aggregates.
This use-case assembles the registry-traceable rates + the cohort means. integer-only.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    first_product_second_order_rate_bp as _SECOND_ORDER_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

EMPTY_FIRST_ORDER_KEY = "__empty_first_order__"
NO_PRODUCT_KEY = "__no_product__"


@dataclass(frozen=True)
class FirstProductCohortFact:
    """One first-product cohort of pre-aggregated facts (counts / paise).

    Cohort assembly (deterministic primary-product pick, observation-window order counts)
    is done upstream at the fact layer — it owns the per-order line facts.
    """

    product_key: str
    product_title: str
    first_order_customers: int                 # cohort size
    customers_with_2plus: int                  # >=2 lifetime orders through observation end
    customers_with_3plus: int
    customers_with_4plus: int
    sum_additional_orders: int                 # sum(max(0, orderCount-1)) over cohort
    sum_ltv_revenue_mu: int                    # sum over cohort of sum(totalPrice) — REVENUE
    sum_days_to_second: int                    # sum of (days first→second) over >=2-order custs
    customers_with_second: int                 # count of >=2-order custs (denominator for avg days)


@dataclass(frozen=True)
class FirstProductCascadeFacts:
    """Per-workspace cohort aggregates for the range + observation window."""

    cohorts: tuple[FirstProductCohortFact, ...] = field(default_factory=tuple)
    total_cohort_customers: int = 0


@dataclass(frozen=True)
class FirstProductCascadeRow:
    product_key: str
    product_title: str
    first_order_customers: int
    customers_with_2nd_order: int
    customers_with_3rd_order: int
    customers_with_4th_plus_order: int
    second_order_rate_bp: int | None
    third_order_rate_bp: int | None
    fourth_plus_rate_bp: int | None
    additional_order_rate_centi: int           # mean extra orders ×100 (centi-orders)
    average_ltv_revenue_mu: int                # mean revenue LTV (paise)
    average_days_to_second_deci: int | None    # mean days ×10 (deci-days); None if no 2nd order


@dataclass(frozen=True)
class FirstProductCascadeResult:
    workspace_id: str
    observation_days: int
    rows: tuple[FirstProductCascadeRow, ...]
    total_cohort_customers: int
    currency_code: str


class FirstProductCascadeQuery:
    """Assemble the first-product cascade table for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: FirstProductCascadeFacts,
        *,
        observation_days: int = 365,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> FirstProductCascadeResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "FirstProductCascadeQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        # Clamp observation window to legacy bounds (30..730).
        observation_days = min(730, max(30, observation_days))

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(
            workspace_id, "first_product_second_order_rate_bp", date_range, _client=_client
        )

        rows: list[FirstProductCascadeRow] = []
        for c in facts.cohorts:
            n = c.first_order_customers
            second = _SECOND_ORDER_DEF.formula_py(c.customers_with_2plus, n) if n > 0 else None
            third = _SECOND_ORDER_DEF.formula_py(c.customers_with_3plus, n) if n > 0 else None
            fourth = _SECOND_ORDER_DEF.formula_py(c.customers_with_4plus, n) if n > 0 else None
            # mean extra orders ×100 (centi-orders), integer FLOOR.
            additional_centi = (c.sum_additional_orders * 100) // n if n > 0 else 0
            avg_ltv = c.sum_ltv_revenue_mu // n if n > 0 else 0
            # mean days to second ×10 (deci-days), integer FLOOR; None if no 2nd-order custs.
            avg_days_deci = (
                (c.sum_days_to_second * 10) // c.customers_with_second
                if c.customers_with_second > 0
                else None
            )
            rows.append(
                FirstProductCascadeRow(
                    product_key=c.product_key,
                    product_title=c.product_title,
                    first_order_customers=n,
                    customers_with_2nd_order=c.customers_with_2plus,
                    customers_with_3rd_order=c.customers_with_3plus,
                    customers_with_4th_plus_order=c.customers_with_4plus,
                    second_order_rate_bp=second,
                    third_order_rate_bp=third,
                    fourth_plus_rate_bp=fourth,
                    additional_order_rate_centi=additional_centi,
                    average_ltv_revenue_mu=avg_ltv,
                    average_days_to_second_deci=avg_days_deci,
                )
            )

        # Legacy sorts rows by cohort size DESC.
        rows.sort(key=lambda r: r.first_order_customers, reverse=True)

        return FirstProductCascadeResult(
            workspace_id=workspace_id,
            observation_days=observation_days,
            rows=tuple(rows),
            total_cohort_customers=facts.total_cohort_customers,
            currency_code=currency_code,
        )
