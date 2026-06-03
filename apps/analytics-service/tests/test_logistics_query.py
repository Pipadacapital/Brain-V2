"""test_logistics_query.py — LogisticsQuery (Phase 2, slice 3).

@paradigm: sql
POSITIVE: delivered%/RTO% from the registry; charge breakdown; avg charge; by-courier sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; zero-shipment guards.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.logistics.logistics_query import (
    LogisticsQuery,
    LogisticsFacts,
    CourierLogisticsFacts,
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


_FACTS = LogisticsFacts(
    total_shipments=1247,
    delivered_count=980,
    rto_count=224,
    cod_count=800,
    prepaid_count=447,
    forward_charges_mu=8_000_000,
    cod_charges_mu=1_200_000,
    rto_charges_mu=4_480_000,
    by_courier=(
        CourierLogisticsFacts("Delhivery", 700, 560, 120, 7_000_000),
        CourierLogisticsFacts("Bluedart", 547, 420, 104, 6_680_000),
    ),
)


class TestPositive:
    def test_rates(self):
        q = LogisticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # delivered = 980/1247 = 7858 bp; rto = 224/1247 = 1796 bp
        assert r.delivered_rate_bp == 7858
        assert r.rto_rate_bp == 1796

    def test_charge_breakdown(self):
        q = LogisticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.forward_charges_mu == 8_000_000
        assert r.cod_charges_mu == 1_200_000
        assert r.rto_charges_mu == 4_480_000
        # total = forward + cod + rto
        assert r.total_shiprocket_charges_mu == 13_680_000
        # avg = intDiv(13680000, 1247) = 10970
        assert r.average_shipping_charge_per_shipment_mu == 10_970

    def test_by_courier_sorted(self):
        q = LogisticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert [c.courier_name for c in r.by_courier] == ["Delhivery", "Bluedart"]

    def test_zero_shipments_guards(self):
        q = LogisticsQuery()
        r = q.execute(_WS_A, _DR, LogisticsFacts(), _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.delivered_rate_bp is None
        assert r.rto_rate_bp is None
        assert r.average_shipping_charge_per_shipment_mu is None


class TestNegative:
    def test_empty_workspace_fails_closed(self):
        q = LogisticsQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        q = LogisticsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_B: [_row(_WS_B)]}))
        assert r.workspace_id == _WS_A
