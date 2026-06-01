"""ltv_summary_query.py — LtvSummaryQuery use-case (Phase 2, slice 5).

@paradigm: sql (deterministic integer aggregation; zero LLM/ML — legacy uses NO model)

The LTV curve by DIMENSION for ONE workspace over a date range, ported Brain-native from
legacy lib/ltv/compute.ts onto the slice-1..4 foundation.

LEGACY GROUND TRUTH (lib/ltv/compute.ts — read at Stage 1):
  - grouped by DIMENSION (product/variant/vendor/product_type/product_tags/order_tags/
    discount_pct/customer_id; collection/discount_codes → "—" passthrough), with WEIGHTED
    line-item attribution: weight = (li.price·qty)/orderTotal (tags further ÷ tag count).
  - cm2 = price − cogs − shipping − packaging − website − adSpend.  LTV USES CM2 (Rohan
    Finding 2), NOT CM3 — NO misc subtracted, and there is NO CAC / payback / LTV:CAC here
    (those are COHORT concepts).
  - realized: cm2Realized = 0 if RTO else cm2 − refundShare; revenueRealized = 0 if RTO else
    price − refundShare.
  - bucket = min(12, floor((daysDiff−1)/30)+1); first order excluded.
  - per-dim: newCustomers (distinct first-order custs), firstOrder/firstOrderR (weighted avg),
    M1..M12 (incremental ÷ n) then applyMode; repeat_rate uses distinct-set.size/n, fo = 0.
  - metric families: cm2 | revenue | repeat_rate. modes: cumulative | post_acq | incremental.
  - summary cards month1/3/6/12 = applied M1/M3/M6/M12 over customer-weighted averages.
  - paginated (page, pageSize 10..100), search, sorted by dimensionLabel desc.

HONEST-INPUT PATTERN: the connector/fact use-case produces per-dimension aggregates with the
RTO/refund/weight attribution ALREADY applied. money in BIGINT paise; FX poison ABSENT.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    repeat_rate_bp as _REPEAT_RATE_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

LTV_METRICS = ("cm2", "revenue", "repeat_rate")
LTV_MODES = ("cumulative", "post_acq", "incremental")
LTV_DIMENSIONS = (
    "product", "variant", "vendor", "collection", "product_type",
    "product_tags", "order_tags", "discount_codes", "discount_pct", "customer_id",
)

_BUCKETS = 12


@dataclass(frozen=True)
class LtvDimFact:
    """One dimension value of pre-aggregated facts (paise / counts).

    Weighted line-item attribution + RTO/refund exclusion ALREADY applied upstream.
    sum_*_mu are the customer-weighted SUMs; new_customers is the distinct count;
    incr_value_mu / incr_repeat_customers are length-12 (M1..M12).
    """

    dimension_value: str
    dimension_label: str
    new_customers: int
    orders_count: int
    sum_first_order_mu: int  # original (cm2 or revenue) first-order value, weighted
    sum_first_order_realized_mu: int  # realized first-order value, weighted
    incr_value_mu: tuple[int, ...] = field(default_factory=tuple)  # len 12, realized value per bucket
    incr_repeat_customers: tuple[int, ...] = field(default_factory=tuple)  # len 12 (repeat_rate metric)


@dataclass(frozen=True)
class LtvFacts:
    dims: tuple[LtvDimFact, ...] = field(default_factory=tuple)
    total_new_customers: int = 0


@dataclass(frozen=True)
class LtvRow:
    dimension_value: str
    dimension_label: str
    orders_count: int
    new_customers: int
    first_order_realized_mu: int
    first_order_mu: int
    m: tuple[int, ...]  # length 12, post-mode display values


@dataclass(frozen=True)
class LtvSummaryResult:
    workspace_id: str
    metric: str
    mode: str
    dimension: str
    first_order_mu: int
    first_order_realized_mu: int
    month1_mu: int
    month3_mu: int
    month6_mu: int
    month12_mu: int
    new_customers: int
    total_rows: int
    rows: tuple[LtvRow, ...]
    currency_code: str


def _apply_mode(mode: str, fo: int, incr: list[int]) -> list[int]:
    """Apply LTV display mode (legacy applyMode). cumulative seeds fo; post_acq running
    sum from 0; incremental as-is. Integer only."""
    if mode == "cumulative":
        s = fo
        out = []
        for v in incr:
            s += v
            out.append(s)
        return out
    if mode == "post_acq":
        s = 0
        out = []
        for v in incr:
            s += v
            out.append(s)
        return out
    return list(incr)


class LtvSummaryQuery:
    """Assemble the LTV-by-dimension summary for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: LtvFacts,
        *,
        metric: str = "cm2",
        mode: str = "cumulative",
        dimension: str = "product",
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> LtvSummaryResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "LtvSummaryQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        if metric not in LTV_METRICS:
            metric = "cm2"
        if mode not in LTV_MODES:
            mode = "cumulative"
        if dimension not in LTV_DIMENSIONS:
            dimension = "product"
        page = max(1, page)
        page_size = min(100, max(10, page_size))

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "cm2_mu", date_range, _client=_client)

        all_rows: list[LtvRow] = []
        sum_fo = 0
        sum_fo_r = 0
        sum_incr = [0] * _BUCKETS

        for d in facts.dims:
            n = d.new_customers
            if n == 0:
                continue
            is_repeat = metric == "repeat_rate"
            fo = 0 if is_repeat else d.sum_first_order_mu // n
            fo_r = 0 if is_repeat else d.sum_first_order_realized_mu // n
            if is_repeat:
                incr = [
                    _REPEAT_RATE_DEF.formula_py(v, n) if n > 0 else 0
                    for v in (d.incr_repeat_customers or (0,) * _BUCKETS)
                ]
            else:
                incr = [v // n for v in (d.incr_value_mu or (0,) * _BUCKETS)]
            m = _apply_mode(mode, fo_r if not is_repeat else 0, incr)

            all_rows.append(
                LtvRow(
                    dimension_value=d.dimension_value,
                    dimension_label=d.dimension_label,
                    orders_count=d.orders_count,
                    new_customers=n,
                    first_order_realized_mu=fo_r,
                    first_order_mu=fo,
                    m=tuple(m),
                )
            )
            sum_fo += fo * n
            sum_fo_r += fo_r * n
            # Summary aggregates the per-row INCREMENTAL values (legacy uses r.mX *
            # newCustomers where rows are built in incremental form for the summary
            # path); apply the mode ONCE to the averaged incrementals for the cards.
            for k in range(_BUCKETS):
                sum_incr[k] += incr[k] * n

        # Stable sort by dimension label descending (legacy localeCompare reversed).
        all_rows.sort(key=lambda r: r.dimension_label, reverse=True)

        filtered = all_rows
        if search and search.strip():
            q = search.strip().lower()
            filtered = [r for r in all_rows if q in r.dimension_label.lower()]

        total_rows = len(filtered)
        start = (page - 1) * page_size
        paginated = tuple(filtered[start:start + page_size])

        total_n = facts.total_new_customers or sum(r.new_customers for r in all_rows)
        avg_fo = sum_fo // total_n if total_n > 0 else 0
        avg_fo_r = sum_fo_r // total_n if total_n > 0 else 0
        avg_incr = [s // total_n if total_n > 0 else 0 for s in sum_incr]
        # Summary cards = applied M1/3/6/12 over the customer-weighted averages.
        base_fo = 0 if metric == "repeat_rate" else avg_fo_r
        cards = _apply_mode(mode, base_fo, avg_incr)

        return LtvSummaryResult(
            workspace_id=workspace_id,
            metric=metric,
            mode=mode,
            dimension=dimension,
            first_order_mu=0 if metric == "repeat_rate" else avg_fo,
            first_order_realized_mu=0 if metric == "repeat_rate" else avg_fo_r,
            month1_mu=avg_incr[0] if metric == "repeat_rate" else cards[0],
            month3_mu=avg_incr[2] if metric == "repeat_rate" else cards[2],
            month6_mu=avg_incr[5] if metric == "repeat_rate" else cards[5],
            month12_mu=avg_incr[11] if metric == "repeat_rate" else cards[11],
            new_customers=total_n,
            total_rows=total_rows,
            rows=paginated,
            currency_code=currency_code,
        )
