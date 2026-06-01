"""
store_summary_query.py — StoreSummaryQuery use-case (Phase 2, slice 1).

@paradigm: sql (deterministic integer aggregation over structured facts; zero LLM/ML)

The FIRST real occupant of the analytics-service application layer. Assembles the
canonical revenue ladder (Gross -> Net -> Net-of-tax -> Net Revenue -> Realized)
for ONE workspace over a date range, reading facts through the ClickHouse query
gateway. The ladder rungs are computed with the canonical metric-registry formulas
(brain_metrics.registry) — NO ad-hoc arithmetic, NO float, money in BIGINT paise.

TENANCY (the load-bearing isolation guarantee):
  Every read goes through query_gateway.query_metrics(workspace_id, ...). workspace_id
  is the first positional, non-optional parameter — a falsy workspace_id raises
  UnscopedQueryError (fail-closed). This use-case NEVER opens a second DB path and
  NEVER accepts an Optional workspace_id.

GST honesty:
  net_net_tax_mu uses total_tax_mu, which the connector layer derives PER-SKU via the
  India GST adapter (india_gst.total_tax_mu_per_sku) — never a blended day rate. This
  use-case consumes that already-per-SKU value from the fact row; it does not re-blend.
"""

from __future__ import annotations

from dataclasses import dataclass

from brain_metrics.registry.definitions import (
    net_sales_mu as _NET_SALES_DEF,
    realized_revenue_mu as _REALIZED_REVENUE_DEF,
    aov_mu as _AOV_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    query_metrics,
)


# ---------------------------------------------------------------------------
# Value objects — frozen, integer-only.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RevenueLadderStep:
    """One rung of the revenue ladder. value_mu is BIGINT minor units (paise)."""

    definition_id: str
    label: str
    value_mu: int


@dataclass(frozen=True)
class StoreSummary:
    """Workspace store summary over a date range. All _mu are integer paise."""

    workspace_id: str
    gross_sales_mu: int
    total_discount_mu: int
    net_sales_mu: int
    total_tax_mu: int
    net_net_tax_mu: int
    shipping_revenue_mu: int
    net_revenue_mu: int
    realized_revenue_mu: int
    order_count: int
    aov_mu: int | None
    currency_code: str


# ---------------------------------------------------------------------------
# Reversal facts — the post-sale leak the honest billing base must subtract.
# In Phase 0/1 these arrive seeded through the same fact path; at the held Child-3
# cutover they are live connector facts. They are NOT yet columns on the gateway's
# MetricRow, so the use-case accepts them as an explicit, workspace-scoped input
# rather than inventing a hidden default — keeping realized revenue HONEST.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ReversalFacts:
    """Per-workspace post-sale reversal aggregates (paise) for the date range."""

    cancelled_revenue_mu: int = 0
    rto_reversed_revenue_mu: int = 0
    refunded_revenue_mu: int = 0


class StoreSummaryQuery:
    """Assemble the canonical store revenue ladder for one workspace + date range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        reversal_facts: ReversalFacts,
        *,
        _client: object | None = None,
    ) -> StoreSummary:
        """Read workspace-scoped facts and assemble the revenue ladder.

        Args:
            workspace_id: authenticated workspace scope. MUST be non-empty
                (sourced from the JWT claim). A falsy value fails closed.
            date_range: inclusive date range.
            reversal_facts: per-workspace post-sale reversal aggregates for the
                same range (cancellations / RTO / refunds), in paise.
            _client: test-injection ClickHouse client (NEVER use in production).

        Returns:
            StoreSummary with the full revenue ladder in integer paise.

        Raises:
            UnscopedQueryError: if workspace_id is falsy (fail-closed tenancy).
        """
        # Fail-closed tenancy: re-assert before any read (defense in depth; the
        # gateway also enforces this). NEVER default to all-workspaces.
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "StoreSummaryQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        rows: list[MetricRow] = query_metrics(
            workspace_id,
            "net_revenue_mu",  # primary definition for observability/logging
            date_range,
            _client=_client,
        )

        # Aggregate the ladder head over the range with integer SUM (no float).
        gross_sales_mu = sum(r.gross_sales_mu for r in rows)
        # discounts come through as `discounts_mu` on the fact row.
        total_discount_mu = sum(getattr(r, "discounts_mu", 0) or 0 for r in rows)
        total_tax_mu = sum(r.total_tax_mu for r in rows)
        shipping_revenue_mu = sum(r.shipping_revenue_mu for r in rows)
        order_count = sum(getattr(r, "total_orders", 0) or 0 for r in rows)
        currency_code = _resolve_currency(rows)

        # Ladder rungs. net_sales + realized + aov use the canonical registry
        # formulas. net_net_tax and net_revenue are computed inline here because
        # the Python registry's net_revenue_mu def carries a DIFFERENT (legacy,
        # 2-arg net_sales-minus-tax) signature than the /store ladder's
        # net_net_tax + shipping shape — a documented registry asymmetry (DDR /
        # plan D2). The Single-Primitive concern is satisfied: the ladder math is
        # the TS registry's net_revenue_mu shape (net_net_tax + shipping), which
        # is the canonical /store contract. No ad-hoc per-channel forks.
        net_sales_mu = _NET_SALES_DEF.formula_py(gross_sales_mu, total_discount_mu)
        net_net_tax_mu = net_sales_mu - total_tax_mu
        net_revenue_mu = net_net_tax_mu + shipping_revenue_mu
        realized_revenue_mu = _REALIZED_REVENUE_DEF.formula_py(
            net_revenue_mu,
            reversal_facts.cancelled_revenue_mu,
            reversal_facts.rto_reversed_revenue_mu,
            reversal_facts.refunded_revenue_mu,
        )
        aov_mu = _AOV_DEF.formula_py(net_sales_mu, order_count)

        return StoreSummary(
            workspace_id=workspace_id,
            gross_sales_mu=gross_sales_mu,
            total_discount_mu=total_discount_mu,
            net_sales_mu=net_sales_mu,
            total_tax_mu=total_tax_mu,
            net_net_tax_mu=net_net_tax_mu,
            shipping_revenue_mu=shipping_revenue_mu,
            net_revenue_mu=net_revenue_mu,
            realized_revenue_mu=realized_revenue_mu,
            order_count=order_count,
            aov_mu=aov_mu,
            currency_code=currency_code,
        )

    def revenue_ladder(
        self,
        workspace_id: str,
        date_range: DateRange,
        reversal_facts: ReversalFacts,
        *,
        _client: object | None = None,
    ) -> list[RevenueLadderStep]:
        """Return the ordered revenue ladder rungs for the /store strip."""
        s = self.execute(workspace_id, date_range, reversal_facts, _client=_client)
        return [
            RevenueLadderStep("gross_sales_mu", "Gross Sales", s.gross_sales_mu),
            RevenueLadderStep("net_sales_mu", "Net Sales", s.net_sales_mu),
            RevenueLadderStep("net_net_tax_mu", "Net of Tax", s.net_net_tax_mu),
            RevenueLadderStep("net_revenue_mu", "Net Revenue", s.net_revenue_mu),
            RevenueLadderStep("realized_revenue_mu", "Realized Revenue", s.realized_revenue_mu),
        ]


def _resolve_currency(rows: list[MetricRow]) -> str:
    """Resolve the workspace currency from fact rows; default INR (India-first)."""
    for r in rows:
        code = getattr(r, "currency_code", None)
        if code:
            return code
    return "INR"
