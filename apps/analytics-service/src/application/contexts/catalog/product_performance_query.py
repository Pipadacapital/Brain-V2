"""product_performance_query.py — ProductPerformanceQuery use-case (Phase 2, slice 6).

@paradigm: sql (deterministic integer aggregation + a cumulative-CM1 pareto classifier;
zero LLM/ML)

The per-product (or per-group) performance table for ONE workspace over a date range,
ported Brain-native from legacy lib/products/compute.ts onto the slice-1..5 foundation.

LEGACY GROUND TRUTH (lib/products/compute.ts — read at Stage 1, NOT the slice-table shorthand):
  - The product-level margin metric is CM1, NOT per-SKU CM2 (Rohan Finding 1). There is NO
    marketing/ad-spend allocation per SKU, so no CM2 exists at this grain.
        revenue = sales - refunds
        cm1     = revenue - cogs - variable_cost          (compute.ts:696)  → REUSE cm1_mu
        cm1_pct = revenue>0 ? cm1/revenue × 100 : 0        (bp here, FLOOR)
        cm1_total_share = totalCm1≠0 ? cm1/totalCm1 × 100  (bp here, FLOOR; signed)
  - Pareto grade is a CUMULATIVE-CM1 walk over POSITIVE-cm1 rows (Rohan Finding 2):
        F = cm1 < 0
        else rank positive-cm1 rows DESC; cumPct at this row = runningCumPositive / totalPositive
        cumPct ≤ 0.80 → A ;  ≤ 0.95 → B ;  else C ;  totalPositive ≤ 0 → C   (compute.ts:165-180)
  - return_rate = sold>0 ? refunded/sold × 100 : 0 (bp here). nc/ec splits the same way.
  - aov = orders>0 ? revenue/orders : 0 (reuse aov_mu over revenue+orders at this grain).

HONEST-INPUT PATTERN: the fact/connector layer produces per-group aggregates with COGS and
variable-cost ALREADY allocated by line-share and refunds already applied (it owns the per-
order facts). This use-case assembles the registry-traceable CM1 + the pareto classifier +
the ratios. money in BIGINT paise; FX poison ABSENT (legacy products has no static FX).

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    cm1_mu as _CM1_DEF,
    aov_mu as _AOV_DEF,
    _ratio_bp,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

# Group-by dimensions (mirror legacy ProductsGroupBy).
PRODUCT_GROUP_BY = (
    "product", "variant", "collection", "vendor", "type",
    "product_tags", "order_tags", "discount_codes",
)
# Sortable columns (subset of legacy ProductsSortColumn — the ones we render).
PRODUCT_SORT = (
    "label", "pareto_grade", "cm1", "cm1_pct", "cm1_total",
    "revenue", "sold", "refunded", "net_quantity", "return_rate", "orders", "aov",
)
_PARETO_ORDER = {"A": 4, "B": 3, "C": 2, "F": 1}


@dataclass(frozen=True)
class ProductFact:
    """One product/group of pre-aggregated facts (paise / counts).

    COGS and variable_cost are ALREADY line-share allocated upstream; refunds already
    applied. nc/ec = new-customer / existing-customer order splits.
    """

    label: str
    sales_mu: int            # gross line sales before refunds
    refunds_mu: int          # refund amount (subtotal)
    cogs_mu: int             # allocated COGS
    variable_cost_mu: int    # allocated shipping/packaging/website/custom
    sold: int                # units sold
    refunded: int            # units refunded
    orders: int              # distinct orders
    nc_orders: int = 0
    ec_orders: int = 0
    nc_sold: int = 0
    nc_refunded: int = 0
    ec_sold: int = 0
    ec_refunded: int = 0
    nc_revenue_mu: int = 0
    ec_revenue_mu: int = 0


@dataclass(frozen=True)
class ProductFacts:
    """Per-workspace product/group aggregates for the range."""

    products: tuple[ProductFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ProductRow:
    label: str
    pareto_grade: str          # 'A' | 'B' | 'C' | 'F'
    cm1_mu: int
    cm1_pct_bp: int | None     # cm1 / revenue in bp; None if revenue <= 0
    cm1_total_share_bp: int | None  # cm1 / totalCm1 in bp; None if totalCm1 == 0
    revenue_mu: int            # sales - refunds
    sales_mu: int
    refunds_mu: int
    sold: int
    refunded: int
    net_quantity: int
    return_rate_bp: int | None
    nc_return_rate_bp: int | None
    ec_return_rate_bp: int | None
    orders: int
    nc_orders: int
    ec_orders: int
    aov_mu: int | None
    nc_aov_mu: int | None
    ec_aov_mu: int | None


@dataclass(frozen=True)
class ProductPerformanceResult:
    workspace_id: str
    group_by: str
    sort: str
    direction: str
    rows: tuple[ProductRow, ...]
    total_rows: int
    total_cm1_mu: int
    currency_code: str


def _signed_share_bp(numerator: int, denominator: int) -> int | None:
    """Signed share in bp: FLOOR(numerator × 10000 / denominator). None if denom == 0.

    Unlike _ratio_bp (NULL on non-positive denom), cm1_total can have a non-zero
    negative numerator over a positive denominator and must keep its sign.
    """
    if denominator == 0:
        return None
    # Python // floors toward -inf; legacy float×100 truncates toward 0. Use trunc-div
    # so a negative share matches the legacy direction sign (e.g. -5.x% not -6%).
    q = numerator * 10000
    # truncate toward zero
    return int(q / denominator) if q % denominator != 0 else q // denominator


class ProductPerformanceQuery:
    """Assemble the product-performance table for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: ProductFacts,
        *,
        group_by: str = "product",
        sort: str = "cm1",
        direction: str = "desc",
        search: str | None = None,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> ProductPerformanceResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "ProductPerformanceQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        if group_by not in PRODUCT_GROUP_BY:
            group_by = "product"
        if sort not in PRODUCT_SORT:
            sort = "cm1"
        direction = "asc" if direction == "asc" else "desc"

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "cm1_mu", date_range, _client=_client)

        # First pass: CM1 per group (registry def) + the positive-CM1 list for pareto.
        cm1_by_label: list[tuple[ProductFact, int, int]] = []  # (fact, revenue, cm1)
        total_cm1 = 0
        for f in facts.products:
            revenue = f.sales_mu - f.refunds_mu
            cm1 = _CM1_DEF.formula_py(revenue, f.cogs_mu, f.variable_cost_mu)
            total_cm1 += cm1
            cm1_by_label.append((f, revenue, cm1))

        # Pareto cumulative-walk: sort by CM1 desc; positive list + ranks.
        sorted_by_cm1 = sorted(cm1_by_label, key=lambda t: t[2], reverse=True)
        positive_cm1 = [cm1 for (_, _, cm1) in sorted_by_cm1 if cm1 > 0]
        total_positive = sum(positive_cm1)

        rows: list[ProductRow] = []
        for i, (f, revenue, cm1) in enumerate(sorted_by_cm1):
            positive_rank = sum(1 for j in range(i) if sorted_by_cm1[j][2] > 0)
            pareto = _pareto_grade(cm1, positive_cm1, total_positive, positive_rank)

            return_rate = _ratio_bp(f.refunded, f.sold) if f.sold > 0 else (0 if f.sold == 0 else None)
            nc_return = _ratio_bp(f.nc_refunded, f.nc_sold) if f.nc_sold > 0 else 0
            ec_return = _ratio_bp(f.ec_refunded, f.ec_sold) if f.ec_sold > 0 else 0
            # sold==0 → return_rate 0 (legacy guard), not None.
            if f.sold == 0:
                return_rate = 0

            rows.append(
                ProductRow(
                    label=f.label,
                    pareto_grade=pareto,
                    cm1_mu=cm1,
                    cm1_pct_bp=_ratio_bp(cm1, revenue) if revenue > 0 else None,
                    cm1_total_share_bp=_signed_share_bp(cm1, total_cm1),
                    revenue_mu=revenue,
                    sales_mu=f.sales_mu,
                    refunds_mu=f.refunds_mu,
                    sold=f.sold,
                    refunded=min(f.refunded, f.sold),
                    net_quantity=f.sold - min(f.refunded, f.sold),
                    return_rate_bp=return_rate,
                    nc_return_rate_bp=nc_return,
                    ec_return_rate_bp=ec_return,
                    orders=f.orders,
                    nc_orders=f.nc_orders,
                    ec_orders=f.ec_orders,
                    aov_mu=_AOV_DEF.formula_py(revenue, f.orders),
                    nc_aov_mu=_AOV_DEF.formula_py(f.nc_revenue_mu, f.nc_orders),
                    ec_aov_mu=_AOV_DEF.formula_py(f.ec_revenue_mu, f.ec_orders),
                )
            )

        # Search filter (label contains, case-insensitive) — legacy parity.
        if search and search.strip():
            q = search.strip().lower()
            rows = [r for r in rows if q in r.label.lower()]

        rows = _apply_sort(rows, sort, direction)

        return ProductPerformanceResult(
            workspace_id=workspace_id,
            group_by=group_by,
            sort=sort,
            direction=direction,
            rows=tuple(rows),
            total_rows=len(rows),
            total_cm1_mu=total_cm1,
            currency_code=currency_code,
        )


def _pareto_grade(
    cm1: int, sorted_positive_cm1: list[int], total_positive: int, rank_index: int
) -> str:
    """Pareto grade via the legacy cumulative-CM1 walk (compute.ts:165-180).

    A = within top 80% of cumulative positive CM1; B = next 15%; C = bottom 5%;
    F = negative CM1. Integer-exact: compare cum×100 ≤ total×80 (no float).
    """
    if cm1 < 0:
        return "F"
    if total_positive <= 0:
        return "C"
    cum = 0
    for i, v in enumerate(sorted_positive_cm1):
        cum += v
        if i == rank_index:
            # cum/total ≤ 0.80  ⇔  cum×100 ≤ total×80 (integer)
            if cum * 100 <= total_positive * 80:
                return "A"
            if cum * 100 <= total_positive * 95:
                return "B"
            return "C"
    return "C"


def _apply_sort(rows: list[ProductRow], sort: str, direction: str) -> list[ProductRow]:
    """Stable sort by the requested column; None sorts low."""
    reverse = direction == "desc"

    def key(r: ProductRow):
        if sort == "label":
            return r.label.lower()
        if sort == "pareto_grade":
            return _PARETO_ORDER.get(r.pareto_grade, 0)
        mapping = {
            "cm1": r.cm1_mu,
            "cm1_pct": r.cm1_pct_bp if r.cm1_pct_bp is not None else -(1 << 62),
            "cm1_total": r.cm1_total_share_bp if r.cm1_total_share_bp is not None else -(1 << 62),
            "revenue": r.revenue_mu,
            "sold": r.sold,
            "refunded": r.refunded,
            "net_quantity": r.net_quantity,
            "return_rate": r.return_rate_bp if r.return_rate_bp is not None else -(1 << 62),
            "orders": r.orders,
            "aov": r.aov_mu if r.aov_mu is not None else -(1 << 62),
        }
        return mapping.get(sort, r.cm1_mu)

    if sort == "label":
        return sorted(rows, key=key, reverse=reverse)
    return sorted(rows, key=key, reverse=reverse)
