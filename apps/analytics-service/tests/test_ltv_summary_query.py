"""test_ltv_summary_query.py — LtvSummaryQuery (Phase 2, slice 5).

@paradigm: sql
POSITIVE: per-dimension first-order/realized; cumulative LTV (CM2); summary cards;
          pagination + search; repeat_rate metric.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; zero-customer dim skipped;
          cumulative-vs-incremental mutant KILLED (CF-S5-LTV-CUM-1).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.ltv.ltv_summary_query import (
    LtvSummaryQuery,
    LtvFacts,
    LtvDimFact,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)

_DR = DateRange(start=date(2026, 1, 1), end=date(2026, 4, 30))
_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"


def _row(ws: str) -> MetricRow:
    return MetricRow(
        workspace_id=ws, date=date(2026, 4, 1),
        gross_sales_mu=0, returns_mu=0, discounts_mu=0,
        net_sales_mu=0, total_tax_mu=0, net_net_tax_mu=0,
        shipping_revenue_mu=0, net_revenue_mu=0, cogs_mu=0,
        total_ad_spend_mu=0, cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=0,
        cm3_mu=0, total_orders=0, rto_rate_bp=0, prepaid_rate_bp=0, conversion_rate_bp=0,
        aov_mu=None, acos_bp=None, blended_roas_x100=None,
    )


def _client(rows_by_ws):
    mock = MagicMock()

    def _query(sql, parameters=None, **_kwargs):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


# Two product dims. Dim "Zebra": n=2, firstOrderR sum 2000000µ (1000000/cust), incr cm2 =
# [1000000, 600000, 0...] → 500000, 300000 /cust. Dim "Alpha": n=1, fo 500000, incr 0.
_FACTS = LtvFacts(
    dims=(
        LtvDimFact(
            dimension_value="p_zebra", dimension_label="Zebra", new_customers=2, orders_count=5,
            sum_first_order_mu=2_000_000, sum_first_order_realized_mu=2_000_000,
            incr_value_mu=(1_000_000, 600_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
            incr_repeat_customers=(2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        ),
        LtvDimFact(
            dimension_value="p_alpha", dimension_label="Alpha", new_customers=1, orders_count=1,
            sum_first_order_mu=500_000, sum_first_order_realized_mu=500_000,
            incr_value_mu=(0,) * 12, incr_repeat_customers=(0,) * 12,
        ),
    ),
    total_new_customers=3,
)


class TestPositive:
    def test_per_dim_first_order(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, dimension="product",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        zebra = next(row for row in r.rows if row.dimension_label == "Zebra")
        assert zebra.first_order_realized_mu == 1_000_000  # 2000000/2

    def test_cumulative_cm2_curve(self):
        """CF-S5-LTV-CUM-1: cumulative seeds firstOrderR; m1 = 1000000+500000 = 1500000."""
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, metric="cm2", mode="cumulative",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        zebra = next(row for row in r.rows if row.dimension_label == "Zebra")
        assert zebra.m[0] == 1_500_000  # fo 1000000 + incr 500000
        assert zebra.m[1] == 1_800_000  # + 300000

    def test_cumulative_kills_incremental_mutant(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, metric="cm2", mode="cumulative",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        zebra = next(row for row in r.rows if row.dimension_label == "Zebra")
        # An incremental mutant would give m1 = 500000 (per-cust incr only). KILLED.
        assert zebra.m[0] != 500_000
        assert zebra.m[0] == 1_500_000

    def test_incremental_mode(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, metric="cm2", mode="incremental",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        zebra = next(row for row in r.rows if row.dimension_label == "Zebra")
        assert zebra.m[0] == 500_000  # per-cust incremental
        assert zebra.m[1] == 300_000

    def test_summary_cards_cumulative(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, metric="cm2", mode="cumulative",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        # weighted avg fo_r = (2*1000000 + 1*500000)/3 = 833333; avg incr m1 = (2*500000+0)/3=333333
        # card month1 = 833333 + 333333 = 1166666
        assert r.first_order_realized_mu == 833_333
        assert r.month1_mu == 1_166_666

    def test_sorted_descending_by_label(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        labels = [row.dimension_label for row in r.rows]
        assert labels == ["Zebra", "Alpha"]

    def test_pagination(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, page=1, page_size=10,
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 2
        assert len(r.rows) == 2

    def test_search_filters(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, search="zeb",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 1
        assert r.rows[0].dimension_label == "Zebra"

    def test_repeat_rate_metric(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, metric="repeat_rate", mode="incremental",
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        zebra = next(row for row in r.rows if row.dimension_label == "Zebra")
        # M1 repeat rate = intDiv(2*10000,2) = 10000bp; fo forced 0
        assert zebra.first_order_realized_mu == 0
        assert zebra.m[0] == 10000


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        with pytest.raises(UnscopedQueryError):
            LtvSummaryQuery().execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        r = LtvSummaryQuery().execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_zero_customer_dim_skipped(self):
        facts = LtvFacts(dims=(LtvDimFact(
            dimension_value="empty", dimension_label="Empty", new_customers=0, orders_count=0,
            sum_first_order_mu=0, sum_first_order_realized_mu=0,
        ),), total_new_customers=0)
        r = LtvSummaryQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 0
        assert r.new_customers == 0

    def test_page_size_clamped(self):
        r = LtvSummaryQuery().execute(_WS_A, _DR, _FACTS, page_size=5,  # below min 10 → clamp
                                      _client=_client({_WS_A: [_row(_WS_A)]}))
        assert len(r.rows) == 2  # both fit in the clamped page
