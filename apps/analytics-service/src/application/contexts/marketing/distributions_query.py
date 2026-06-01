"""distributions_query.py — DistributionsQuery use-case (Phase 2, slice 4).

@paradigm: sql (deterministic integer/statistical aggregation; zero LLM/ML)

Per-product distribution (histogram) of per-order sales OR CM1 for ONE workspace over a date
range, ported Brain-native from legacy routes/workspaces/distributions.ts + lib/distributions.

This is a STATISTICAL distribution surface, NOT an attribution ladder (a slice-table-shorthand
correction from Rohan's Stage-1 review). For each product: the per-order value distribution's
mode, mean, and diff (mode − mean), plus a 60-bucket density histogram of all per-order values.

Legacy mode (distributions.ts:23-37): round each value to 2 decimals, take the most-frequent;
tie-break = the LOWEST value. In Brain we work in integer paise, so "round to 2dp rupees" =
round to the nearest 100 paise. Deterministic integer arithmetic; the mode/mean tie-break is
ported exactly (persona Concern 6). money in BIGINT paise.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

_NUM_BUCKETS = 60
_ROUND_UNIT_PAISE = 100  # 2dp of rupees == nearest 100 paise (legacy Math.round(v*100)/100)


@dataclass(frozen=True)
class DistributionsProductFact:
    """One product's per-order value arrays (paise). sales = per-order sales; cm1 = per-order CM1."""

    product_label: str
    per_order_sales_mu: tuple[int, ...] = field(default_factory=tuple)
    per_order_cm1_mu: tuple[int, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class DistributionsFacts:
    """Per-workspace per-product distribution facts for the range."""

    products: tuple[DistributionsProductFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class DistributionsProductRow:
    product: str
    orders: int
    mode_mu: int
    mean_mu: int
    diff_mu: int  # mode_mu − mean_mu


@dataclass(frozen=True)
class DistributionsGraphPoint:
    value_mu: int
    density_bp: int  # density as basis points of total (×10000), integer


@dataclass(frozen=True)
class DistributionsResult:
    workspace_id: str
    metric: str  # 'sales' | 'cm1'
    rows: tuple[DistributionsProductRow, ...]
    total_rows: int
    graph_points: tuple[DistributionsGraphPoint, ...]
    global_mode_mu: int
    global_mean_mu: int
    currency_code: str


def _round_to_unit(value_mu: int) -> int:
    """Round paise to the nearest 100 (== 2dp rupees), half-up like JS Math.round.

    JS Math.round rounds .5 toward +Inf. Replicate with floor((v + 50)/100)*100 for the
    positive domain; for negative CM1 values, mirror JS (round half toward +Inf).
    """
    # floor-division of (v + 50) by 100 then ×100 gives Math.round-to-100 for all integers.
    return ((value_mu + _ROUND_UNIT_PAISE // 2) // _ROUND_UNIT_PAISE) * _ROUND_UNIT_PAISE


def _mode_mu(values: tuple[int, ...]) -> int:
    """Most-frequent value after rounding to 2dp; tie-break = lowest value (legacy computeMode)."""
    if not values:
        return 0
    rounded = [_round_to_unit(v) for v in values]
    freq: dict[int, int] = {}
    for r in rounded:
        freq[r] = freq.get(r, 0) + 1
    best_value = rounded[0]
    best_count = 0
    for val, count in freq.items():
        if count > best_count or (count == best_count and val < best_value):
            best_value = val
            best_count = count
    return best_value


def _mean_mu(values: tuple[int, ...]) -> int:
    """Integer-FLOOR mean of per-order values (paise). Legacy uses float mean; Brain FLOORs."""
    if not values:
        return 0
    return sum(values) // len(values)


class DistributionsQuery:
    """Assemble per-product distributions for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: DistributionsFacts,
        *,
        metric: str = "cm1",
        search: str | None = None,
        sort: str = "orders",
        direction: str = "desc",
        page: int = 1,
        page_size: int = 20,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> DistributionsResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "DistributionsQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke). aov_mu is a registered
        # money metric used purely as the gateway probe (no value consumed here).
        query_metrics(workspace_id, "aov_mu", date_range, _client=_client)

        valid_metric = "sales" if metric == "sales" else "cm1"

        def vals(p: DistributionsProductFact) -> tuple[int, ...]:
            return p.per_order_sales_mu if valid_metric == "sales" else p.per_order_cm1_mu

        # Per-product rows.
        rows: list[DistributionsProductRow] = []
        all_values: list[int] = []
        for p in facts.products:
            v = vals(p)
            all_values.extend(v)
            mode = _mode_mu(v)
            mean = _mean_mu(v)
            rows.append(
                DistributionsProductRow(
                    product=p.product_label,
                    orders=len(p.per_order_sales_mu),
                    mode_mu=mode,
                    mean_mu=mean,
                    diff_mu=mode - mean,
                )
            )

        # Filter (search).
        if search and search.strip():
            q = search.strip().lower()
            rows = [r for r in rows if q in r.product.lower()]

        total_rows = len(rows)

        # Sort.
        valid_sort = sort if sort in ("product", "orders", "mode", "mean", "diff") else "orders"
        reverse = direction != "asc"
        if valid_sort == "product":
            rows.sort(key=lambda r: r.product, reverse=reverse)
        elif valid_sort == "mode":
            rows.sort(key=lambda r: r.mode_mu, reverse=reverse)
        elif valid_sort == "mean":
            rows.sort(key=lambda r: r.mean_mu, reverse=reverse)
        elif valid_sort == "diff":
            rows.sort(key=lambda r: r.diff_mu, reverse=reverse)
        else:
            rows.sort(key=lambda r: r.orders, reverse=reverse)

        # Paginate.
        page = max(1, page)
        page_size = min(100, max(10, page_size))
        start = (page - 1) * page_size
        paginated = tuple(rows[start : start + page_size])

        # Global histogram over ALL per-order values (legacy buildGraphPoints).
        graph_points, global_mode, global_mean = _build_graph_points(tuple(all_values))

        return DistributionsResult(
            workspace_id=workspace_id,
            metric=valid_metric,
            rows=paginated,
            total_rows=total_rows,
            graph_points=graph_points,
            global_mode_mu=global_mode,
            global_mean_mu=global_mean,
            currency_code=currency_code,
        )


def _build_graph_points(
    values: tuple[int, ...],
) -> tuple[tuple[DistributionsGraphPoint, ...], int, int]:
    """60-bucket density histogram (legacy buildGraphPoints), integer paise.

    density_bp = intDiv(count × 10000, total) — basis points of the total (integer).
    """
    if not values:
        return (tuple(), 0, 0)
    global_mean = _mean_mu(values)
    global_mode = _mode_mu(values)
    lo = min(values)
    hi = max(values)
    rng = (hi - lo) or 1
    # bucket width in paise (integer FLOOR; min 1 to avoid zero-width).
    bucket_width = max(1, rng // _NUM_BUCKETS)
    counts = [0] * _NUM_BUCKETS
    for v in values:
        idx = (v - lo) // bucket_width
        if idx < 0:
            idx = 0
        if idx >= _NUM_BUCKETS:
            idx = _NUM_BUCKETS - 1
        counts[idx] += 1
    total = len(values)
    points = tuple(
        DistributionsGraphPoint(
            value_mu=lo + idx * bucket_width + bucket_width // 2,
            density_bp=(count * 10000) // total if total > 0 else 0,
        )
        for idx, count in enumerate(counts)
    )
    return (points, global_mode, global_mean)
