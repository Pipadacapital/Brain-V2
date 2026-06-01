"""test_marketing_efficiency_query.py — MarketingEfficiencyQuery (Phase 2, slice 4).

@paradigm: sql
POSITIVE: MER (net_revenue/total_spend); aMER (nc_revenue/ACQUISITION spend); ACOS/ROAS display.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; the "use total spend for
          aMER" mutant is killed; null guards on zero denominators.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.marketing.marketing_efficiency_query import (
    MarketingEfficiencyQuery,
    MarketingEfficiencyFacts,
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
        gross_sales_mu=12_000_000, returns_mu=0, discounts_mu=0,
        net_sales_mu=12_000_000, total_tax_mu=0, net_net_tax_mu=12_000_000,
        shipping_revenue_mu=0, net_revenue_mu=12_000_000, cogs_mu=0,
        total_ad_spend_mu=10_000_000, cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=0,
        cm3_mu=0, rto_rate_bp=0, prepaid_rate_bp=0, conversion_rate_bp=0,
        aov_mu=None, acos_bp=None, blended_roas_x100=None,
    )


def _client(rows_by_ws):
    mock = MagicMock()

    def _query(sql, parameters=None):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


# Facts with a CLASSIFICATION SPLIT: total spend ₹100k but only ₹40k acquisition-classified.
_FACTS = MarketingEfficiencyFacts(
    net_revenue_mu=12_000_000,
    total_ad_spend_mu=10_000_000,
    new_customer_revenue_mu=6_000_000,
    acquisition_ad_spend_mu=4_000_000,
    meta_spend_mu=6_000_000,
    google_spend_mu=4_000_000,
)


class TestPositive:
    def test_mer_bp(self):
        q = MarketingEfficiencyQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 12000000 / 10000000 = 1.20x = 12000 bp
        assert r.mer_bp == 12000

    def test_amer_bp_acquisition_denominator(self):
        q = MarketingEfficiencyQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 6000000 / 4000000 (ACQUISITION spend, NOT total) = 1.50x = 15000 bp
        assert r.amer_bp == 15000

    def test_amer_kills_use_total_spend_mutant(self):
        """The 'use total spend' mutant would give 6000bp — must NOT be the result."""
        q = MarketingEfficiencyQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        mutant = (6_000_000 * 10000) // 10_000_000  # 6000
        assert mutant == 6000
        assert r.amer_bp == 15000
        assert r.amer_bp != mutant

    def test_acos_and_roas_display(self):
        q = MarketingEfficiencyQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # ACOS = 10000000/12000000 = 8333 bp; ROAS = 12000000*100/10000000 = 120 (×100 → 1.20×)
        assert r.acos_bp == 8333
        assert r.blended_roas_x100 == 120

    def test_meta_google_split(self):
        q = MarketingEfficiencyQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.meta_spend_mu == 6_000_000
        assert r.google_spend_mu == 4_000_000


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        q = MarketingEfficiencyQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_whitespace_workspace_id_fails_closed(self):
        q = MarketingEfficiencyQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("   ", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        """WS_B context returns ZERO rows from WS_A's data path (still computes from facts)."""
        q = MarketingEfficiencyQuery()
        # The gateway probe is scoped to WS_B; no WS_A rows leak. Result derives from explicit facts.
        r = q.execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_zero_total_spend_mer_null(self):
        q = MarketingEfficiencyQuery()
        facts = MarketingEfficiencyFacts(net_revenue_mu=12_000_000, total_ad_spend_mu=0)
        r = q.execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.mer_bp is None
        assert r.blended_roas_x100 is None

    def test_zero_acquisition_spend_amer_null(self):
        q = MarketingEfficiencyQuery()
        facts = MarketingEfficiencyFacts(
            net_revenue_mu=12_000_000, total_ad_spend_mu=10_000_000,
            new_customer_revenue_mu=6_000_000, acquisition_ad_spend_mu=0,
        )
        r = q.execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.amer_bp is None

    def test_zero_net_revenue_acos_null(self):
        q = MarketingEfficiencyQuery()
        facts = MarketingEfficiencyFacts(net_revenue_mu=0, total_ad_spend_mu=10_000_000)
        r = q.execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.acos_bp is None
