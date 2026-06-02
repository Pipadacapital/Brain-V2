"""test_pincode_intelligence_query.py — PincodeIntelligenceQuery (Phase 2, slice 3).

@paradigm: sql
POSITIVE: per-pincode rates; AOV; tier; the integer reliability score anchor; filters + sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; zero-shipment guards.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.logistics.pincode_intelligence_query import (
    PincodeIntelligenceQuery,
    PincodeFacts,
    PincodeFilters,
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
        cm3_mu=0, rto_rate_bp=1800, prepaid_rate_bp=4100, conversion_rate_bp=230,
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


# Anchor pincode: 100 shipments, 18 RTO (1800bp), 60 COD (6000bp), 70 delivered,
#   unique=50, repeat=10 (2000bp), revenue from delivered = 105000000p (₹10.5L),
#   delivered_count=70 → aov = intDiv(105000000, 70) = 1500000p (₹15000).
# reliability: rto_bp=1800, cod_bp=6000, repeat_bp=2000, aov_mu=1500000 →
#   10000 - 3600 - 3000 + 1000 + intDiv(1500000,100)=15000 → raw=10000-3600-3000+1000+15000=19400 → clamp 10000.
# To hit the CF-S3-PINCODE-1 anchor (5900) exactly we use aov_mu=150000 below in a focused test.
_MUMBAI = PincodeFacts(
    pincode="400001", city="Mumbai", state="Maharashtra",
    shipment_count=100, rto_count=18, cod_count=60, delivered_count=70,
    revenue_mu=105_000_000, unique_customers=50, repeat_customers=10, top_courier="Delhivery",
)
_NASHIK = PincodeFacts(
    pincode="422001", city="Nashik", state="Maharashtra",
    shipment_count=40, rto_count=12, cod_count=30, delivered_count=24,
    revenue_mu=24_000_000, unique_customers=20, repeat_customers=2, top_courier="Bluedart",
)


class TestPositive:
    def test_rates_and_tier(self):
        q = PincodeIntelligenceQuery()
        r = q.execute(_WS_A, _DR, (_MUMBAI, _NASHIK), _client=_client({_WS_A: [_row(_WS_A)]}))
        mum = next(row for row in r.rows if row.pincode == "400001")
        assert mum.rto_rate_bp == 1800   # 18/100
        assert mum.cod_rate_bp == 6000   # 60/100
        assert mum.delivered_rate_bp == 7000  # 70/100
        assert mum.repeat_rate_bp == 2000  # 10/50
        assert mum.tier == 1             # Mumbai = T1
        nashik = next(row for row in r.rows if row.pincode == "422001")
        assert nashik.tier == 2          # Nashik = T2

    def test_reliability_score_anchor(self):
        """CF-S3-PINCODE-1: a pincode with aov_mu=150000 yields exactly 5900 centi-points."""
        q = PincodeIntelligenceQuery()
        anchor = PincodeFacts(
            pincode="999999", city="Pune", state="Maharashtra",
            shipment_count=100, rto_count=18, cod_count=60, delivered_count=70,
            revenue_mu=10_500_000, unique_customers=50, repeat_customers=10,
        )
        # aov = intDiv(10_500_000, 70) = 150000 → reliability anchor inputs (1800,6000,2000,150000) → 5900.
        r = q.execute(_WS_A, _DR, (anchor,), _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].aov_mu == 150_000
        assert r.rows[0].reliability_score == 5900

    def test_total_shipments(self):
        q = PincodeIntelligenceQuery()
        r = q.execute(_WS_A, _DR, (_MUMBAI, _NASHIK), _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_shipments == 140

    def test_high_rto_filter(self):
        q = PincodeIntelligenceQuery()
        # Nashik rto = 12/40 = 3000bp >= 2000; Mumbai 1800bp < 2000 → only Nashik survives.
        r = q.execute(
            _WS_A, _DR, (_MUMBAI, _NASHIK),
            PincodeFilters(high_rto_only=True),
            _client=_client({_WS_A: [_row(_WS_A)]}),
        )
        assert [row.pincode for row in r.rows] == ["422001"]

    def test_sort_by_reliability_desc(self):
        q = PincodeIntelligenceQuery()
        r = q.execute(
            _WS_A, _DR, (_MUMBAI, _NASHIK),
            PincodeFilters(sort="reliability_score", order="desc"),
            _client=_client({_WS_A: [_row(_WS_A)]}),
        )
        scores = [row.reliability_score for row in r.rows]
        assert scores == sorted(scores, reverse=True)

    def test_state_filter(self):
        q = PincodeIntelligenceQuery()
        r = q.execute(
            _WS_A, _DR, (_MUMBAI, _NASHIK),
            PincodeFilters(state="Maharashtra"),
            _client=_client({_WS_A: [_row(_WS_A)]}),
        )
        assert len(r.rows) == 2


class TestNegative:
    def test_empty_workspace_fails_closed(self):
        q = PincodeIntelligenceQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, (_MUMBAI,), _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        q = PincodeIntelligenceQuery()
        r = q.execute(_WS_A, _DR, (_MUMBAI,), _client=_client({_WS_B: [_row(_WS_B)]}))
        assert r.workspace_id == _WS_A

    def test_zero_shipment_pincode_guards(self):
        q = PincodeIntelligenceQuery()
        empty = PincodeFacts(
            pincode="000000", city="—", state="—",
            shipment_count=0, rto_count=0, cod_count=0, delivered_count=0,
            revenue_mu=0, unique_customers=0, repeat_customers=0,
        )
        r = q.execute(_WS_A, _DR, (empty,), _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].rto_rate_bp is None
        assert r.rows[0].aov_mu is None
        assert r.rows[0].tier is None
