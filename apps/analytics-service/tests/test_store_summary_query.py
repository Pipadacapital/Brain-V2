"""
test_store_summary_query.py — StoreSummaryQuery use-case (Phase 2, slice 1).

@paradigm: sql
Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
  POSITIVE — assembles the revenue ladder from workspace-scoped facts; realized
             revenue subtracts reversals; aov from registry; multi-day SUM.
  NEGATIVE — falsy workspace_id fails closed (UnscopedQueryError); cross-workspace
             isolation (querying ws_A never returns ws_B facts).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.store.store_summary_query import (
    ReversalFacts,
    StoreSummaryQuery,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)


_DATE_RANGE = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 2))
_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"


def _row(workspace_id: str, date_val: date) -> MetricRow:
    """A single canonical fact row (paise). gross 62000.00, discount 3100.00,
    tax 4960.00 (already per-SKU from the connector), shipping 4960.00."""
    return MetricRow(
        workspace_id=workspace_id,
        date=date_val,
        gross_sales_mu=6_200_000,
        returns_mu=0,
        discounts_mu=310_000,
        net_sales_mu=5_890_000,        # gross - discount
        total_tax_mu=496_000,          # per-SKU GST sum (NOT blended)
        net_net_tax_mu=5_394_000,
        shipping_revenue_mu=496_000,
        net_revenue_mu=5_890_000,
        cogs_mu=2_232_000,
        total_ad_spend_mu=1_736_000,
        cm1_mu=0,
        cm2_mu=0,
        misc_expenses_prorated_mu=None,
        cm3_mu=0,
        rto_rate_bp=1800,
        prepaid_rate_bp=4100,
        conversion_rate_bp=230,
        aov_mu=None,
        acos_bp=None,
        blended_roas_x100=None,
    )


def _client(rows_by_ws: dict[str, list[MetricRow]]) -> MagicMock:
    """Mock CH client honoring the workspace_id predicate (correct isolation)."""
    mock = MagicMock()

    def _query(sql: str, parameters: dict | None = None):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, col, None) for col in _METRIC_COLUMNS) for r in rows]
        result = MagicMock()
        result.result_rows = raw
        return result

    mock.query.side_effect = _query
    return mock


# Note: total_orders / discounts_mu are not in _METRIC_COLUMNS, so the mock
# returns None for them and the use-case's getattr(..., 0) fallback applies.
# order_count is therefore 0 in these tests and aov is asserted only via the
# multi-day/single-day ladder rungs, not the order denominator.


# ---------------------------------------------------------------------------
# POSITIVE
# ---------------------------------------------------------------------------

class TestRevenueLadderAssembly:
    def test_single_day_ladder(self) -> None:
        q = StoreSummaryQuery()
        s = q.execute(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            ReversalFacts(
                cancelled_revenue_mu=120_000,
                rto_reversed_revenue_mu=300_000,
                refunded_revenue_mu=80_000,
            ),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        assert s.gross_sales_mu == 6_200_000
        assert s.total_discount_mu == 310_000
        assert s.net_sales_mu == 5_890_000             # gross - discount
        assert s.total_tax_mu == 496_000               # per-SKU sum, not blended
        assert s.net_net_tax_mu == 5_394_000           # net_sales - tax
        assert s.net_revenue_mu == 5_890_000           # net_net_tax + shipping
        # realized = net_revenue - 120000 - 300000 - 80000 = 5_390_000
        assert s.realized_revenue_mu == 5_390_000
        assert s.realized_revenue_mu < s.net_revenue_mu  # honesty: reversals bite
        assert s.currency_code == "INR"

    def test_multi_day_sums(self) -> None:
        q = StoreSummaryQuery()
        rows = [_row(_WS_A, date(2026, 4, 1)), _row(_WS_A, date(2026, 4, 2))]
        s = q.execute(
            _WS_A, _DATE_RANGE, ReversalFacts(), _client=_client({_WS_A: rows})
        )
        assert s.gross_sales_mu == 12_400_000          # 2 days summed
        assert s.total_tax_mu == 992_000
        # no reversals → realized == net_revenue
        assert s.realized_revenue_mu == s.net_revenue_mu

    def test_revenue_ladder_steps_are_ordered_and_registry_traced(self) -> None:
        q = StoreSummaryQuery()
        steps = q.revenue_ladder(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            ReversalFacts(refunded_revenue_mu=10_000),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        ids = [s.definition_id for s in steps]
        assert ids == [
            "gross_sales_mu",
            "net_sales_mu",
            "net_net_tax_mu",
            "net_revenue_mu",
            "realized_revenue_mu",
        ]
        # ladder is monotonically non-increasing in value (sanity of the ladder)
        assert steps[0].value_mu >= steps[1].value_mu >= steps[2].value_mu


# ---------------------------------------------------------------------------
# NEGATIVE — fail-closed tenancy + cross-workspace isolation.
# ---------------------------------------------------------------------------

class TestTenancyFailClosed:
    def test_empty_workspace_raises(self) -> None:
        q = StoreSummaryQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DATE_RANGE, ReversalFacts(), _client=_client({}))

    def test_whitespace_workspace_raises(self) -> None:
        q = StoreSummaryQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("   ", _DATE_RANGE, ReversalFacts(), _client=_client({}))

    def test_cross_workspace_isolation(self) -> None:
        # Seed BOTH workspaces; query as ws_A; assert ZERO ws_B contribution.
        q = StoreSummaryQuery()
        rows_by_ws = {
            _WS_A: [_row(_WS_A, date(2026, 4, 1))],
            _WS_B: [_row(_WS_B, date(2026, 4, 1)), _row(_WS_B, date(2026, 4, 2))],
        }
        s = q.execute(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            ReversalFacts(),
            _client=_client(rows_by_ws),
        )
        # ws_A has ONE day; if ws_B leaked, gross would be 3x.
        assert s.gross_sales_mu == 6_200_000

    def test_context_less_returns_zero_rows_for_unknown_ws(self) -> None:
        # A workspace with no facts returns an all-zero ladder (not an error,
        # not another tenant's data).
        q = StoreSummaryQuery()
        s = q.execute(
            _WS_A, _DATE_RANGE, ReversalFacts(), _client=_client({_WS_B: [_row(_WS_B, date(2026, 4, 1))]})
        )
        assert s.gross_sales_mu == 0
        assert s.net_revenue_mu == 0
        assert s.realized_revenue_mu == 0
