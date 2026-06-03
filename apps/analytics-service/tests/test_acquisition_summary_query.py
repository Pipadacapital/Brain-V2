"""test_acquisition_summary_query.py — AcquisitionSummaryQuery (Phase 2, slice 4).

@paradigm: sql
POSITIVE: blended CAC; cm2-per-NC; aMER; daily rows + sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; RTO new-customer order
          contributes 0 (facts already exclude it); zero-customer null guards.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.marketing.acquisition_summary_query import (
    AcquisitionSummaryQuery,
    AcquisitionFacts,
    AcquisitionDailyFact,
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
        gross_sales_mu=0, returns_mu=0, discounts_mu=0,
        net_sales_mu=0, total_tax_mu=0, net_net_tax_mu=0,
        shipping_revenue_mu=0, net_revenue_mu=0, cogs_mu=0,
        total_ad_spend_mu=10_000_000, cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=0,
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


# 200 new customers, ₹100k spend (₹40k acquisition), nc_cm2 ₹20k, nc_revenue ₹60k.
_FACTS = AcquisitionFacts(
    new_customers_count=200,
    nc_cm2_mu=2_000_000,
    new_customer_revenue_mu=6_000_000,
    total_ad_spend_mu=10_000_000,
    acquisition_ad_spend_mu=4_000_000,
    meta_spend_mu=6_000_000,
    google_spend_mu=4_000_000,
    daily=(
        AcquisitionDailyFact(
            date="2026-04-02", new_customers_count=120, nc_cm2_mu=1_200_000,
            nc_revenue_mu=3_600_000, ad_spend_mu=6_000_000, acquisition_ad_spend_mu=2_400_000,
            meta_spend_mu=3_600_000, google_spend_mu=2_400_000,
        ),
        AcquisitionDailyFact(
            date="2026-04-01", new_customers_count=80, nc_cm2_mu=800_000,
            nc_revenue_mu=2_400_000, ad_spend_mu=4_000_000, acquisition_ad_spend_mu=1_600_000,
            meta_spend_mu=2_400_000, google_spend_mu=1_600_000,
        ),
    ),
)


class TestPositive:
    def test_blended_cac(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 10000000 / 200 = 50000p (₹500)
        assert r.cac_mu == 50_000

    def test_cm2_per_nc(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 2000000 / 200 = 10000p (₹100)
        assert r.cm2_per_nc_mu == 10_000

    def test_amer_acquisition_denominator(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 6000000 / 4000000 = 15000 bp
        assert r.amer_bp == 15000

    def test_daily_sorted_ascending(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert [d.date for d in r.daily] == ["2026-04-01", "2026-04-02"]

    def test_daily_cac_and_amer(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        d01 = next(d for d in r.daily if d.date == "2026-04-01")
        # CAC 4000000/80 = 50000; aMER 2400000/1600000 = 15000bp
        assert d01.cac_mu == 50_000
        assert d01.amer_bp == 15000


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        q = AcquisitionSummaryQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        q = AcquisitionSummaryQuery()
        r = q.execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_zero_customers_cac_and_cm2nc_null(self):
        q = AcquisitionSummaryQuery()
        facts = AcquisitionFacts(new_customers_count=0, total_ad_spend_mu=10_000_000)
        r = q.execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.cac_mu is None
        assert r.cm2_per_nc_mu is None

    def test_rto_new_customer_excluded_via_facts(self):
        """RTO new-customer orders contribute 0 (the connector excludes them upstream).

        Simulate: 1 NC order that is RTO → nc_cm2 and nc_revenue are 0 for it.
        """
        q = AcquisitionSummaryQuery()
        facts = AcquisitionFacts(
            new_customers_count=1, nc_cm2_mu=0, new_customer_revenue_mu=0,
            total_ad_spend_mu=50_000, acquisition_ad_spend_mu=50_000,
        )
        r = q.execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        # CAC defined (1 customer), but cm2/revenue zero → cm2_per_nc 0, aMER 0 (0/50000).
        assert r.cac_mu == 50_000
        assert r.cm2_per_nc_mu == 0
        assert r.amer_bp == 0
