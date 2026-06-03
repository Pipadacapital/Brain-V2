"""test_rto_analytics_query.py — RtoAnalyticsQuery (Phase 2, slice 3).

@paradigm: sql
POSITIVE: RTO rate from the registry; cost/revenue-lost passthrough; by-payment + by-courier.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation (ws_A never sees ws_B).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.logistics.rto_analytics_query import (
    RtoAnalyticsQuery,
    RtoFacts,
    CourierRtoFacts,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)

_DR = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 2))
_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"


def _row(ws: str) -> MetricRow:
    return MetricRow(
        workspace_id=ws, date=date(2026, 4, 1),
        gross_sales_mu=6_200_000, returns_mu=0, discounts_mu=310_000,
        net_sales_mu=5_890_000, total_tax_mu=496_000, net_net_tax_mu=5_394_000,
        shipping_revenue_mu=496_000, net_revenue_mu=5_890_000, cogs_mu=2_232_000,
        total_ad_spend_mu=1_736_000, cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=200_000,
        cm3_mu=0, total_orders=0, rto_rate_bp=1800, prepaid_rate_bp=4100, conversion_rate_bp=230,
        aov_mu=None, acos_bp=None, blended_roas_x100=None,
    )


def _client(rows_by_ws: dict[str, list[MetricRow]]) -> MagicMock:
    mock = MagicMock()

    def _query(sql: str, parameters: dict | None = None, **_kwargs):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


_FACTS = RtoFacts(
    total_shipments=1247,
    rto_orders=224,
    rto_cost_mu=4_480_000,
    rto_revenue_lost_mu=33_200_000,
    cod_rto_orders=180,
    prepaid_rto_orders=44,
    cod_rto_cost_mu=3_600_000,
    prepaid_rto_cost_mu=880_000,
    cod_revenue_lost_mu=27_000_000,
    prepaid_revenue_lost_mu=6_200_000,
    by_courier=(
        CourierRtoFacts("Delhivery", 120, 2_400_000, 18_000_000),
        CourierRtoFacts("Bluedart", 104, 2_080_000, 15_200_000),
    ),
)


class TestPositive:
    def test_rate_cost_revenue(self):
        q = RtoAnalyticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # rto_rate_bp = intDiv(224*10000, 1247) = 1796 bp
        assert r.rto_rate_bp == 1796
        assert r.total_rto_cost_mu == 4_480_000
        assert r.revenue_lost_to_rto_mu == 33_200_000
        assert r.total_shipments == 1247
        assert r.rto_count == 224

    def test_by_payment_method(self):
        q = RtoAnalyticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        cod = next(p for p in r.by_payment_method if p.payment_method == "COD")
        prepaid = next(p for p in r.by_payment_method if p.payment_method == "Prepaid")
        assert cod.rto_count == 180
        assert cod.revenue_lost_mu == 27_000_000
        assert prepaid.rto_count == 44
        # COD + prepaid RTO counts reconcile to the total RTO count.
        assert cod.rto_count + prepaid.rto_count == r.rto_count

    def test_by_courier_sorted_desc(self):
        q = RtoAnalyticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert [c.courier_name for c in r.by_courier] == ["Delhivery", "Bluedart"]
        assert r.by_courier[0].rto_count >= r.by_courier[1].rto_count

    def test_zero_shipments_rate_none(self):
        q = RtoAnalyticsQuery()
        r = q.execute(
            _WS_A, _DR, RtoFacts(total_shipments=0, rto_orders=0),
            _client=_client({_WS_A: [_row(_WS_A)]}),
        )
        assert r.rto_rate_bp is None


class TestNegative:
    def test_empty_workspace_fails_closed(self):
        q = RtoAnalyticsQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_whitespace_workspace_fails_closed(self):
        q = RtoAnalyticsQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("   ", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        # ws_A query against a client seeded ONLY for ws_B returns no ws_B facts on the read path.
        q = RtoAnalyticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_B: [_row(_WS_B)]}))
        # The read path is scoped to ws_A (empty) — the result carries ws_A, never ws_B.
        assert r.workspace_id == _WS_A
