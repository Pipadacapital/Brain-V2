"""test_cod_prepaid_query.py — CodPrepaidQuery (Phase 2, slice 3).

@paradigm: sql
POSITIVE: COD realization; COD/prepaid RTO rates; effective revenue; the FULL break-even formula.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; the naive M/(M+C)
          break-even mutant is killed; zero-order break-even note.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.logistics.cod_prepaid_query import (
    CodPrepaidQuery,
    CodPrepaidFacts,
    FeeInputs,
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

    def _query(sql, parameters=None):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


# Facts engineered so AOV = ₹1500 (150000p) and prepaid RTO rate = 500bp → break-even anchor = 500bp.
#   total_orders = 1000 (800 COD + 200 prepaid); total_gross = 150_000_000p → AOV = 150000p.
#   prepaid_rto = 10 / prepaid_orders 200 = 0.05 = 500bp.
_FACTS = CodPrepaidFacts(
    cod_orders=800,
    prepaid_orders=200,
    cod_delivered=612,
    prepaid_delivered=190,
    cod_rto=180,
    prepaid_rto=10,
    gross_revenue_cod_mu=120_000_000,
    gross_revenue_prepaid_mu=30_000_000,
    rto_cost_cod_mu=3_600_000,
    rto_cost_prepaid_mu=200_000,
)
_FEES = FeeInputs(cod_fee_mu=3_000, gateway_fee_bp=200, return_shipping_mu=8_000, restocking_mu=0)


class TestPositive:
    def test_cod_realization(self):
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        # 612 / 800 = 7650 bp
        assert r.cod_realization_rate_bp == 7650

    def test_rto_rates(self):
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        # cod_rto = 180/800 = 2250 bp; prepaid_rto = 10/200 = 500 bp
        assert r.cod_rto_rate_bp == 2250
        assert r.prepaid_rto_rate_bp == 500

    def test_aov(self):
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        # (120000000 + 30000000) / 1000 = 150000
        assert r.average_order_value_mu == 150_000

    def test_breakeven_full_formula_500bp(self):
        """CF-S3-BREAKEVEN-1: the FULL legacy formula yields 500bp on these inputs."""
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        # aov=150000, P=500bp, cod_fee=3000, gateway=200bp, S=8000, RS=0 → 500bp.
        assert r.breakeven_cod_rto_rate_bp == 500
        assert r.breakeven_note is None

    def test_breakeven_kills_naive_m_over_m_plus_c(self):
        """The naive M/(M+C) = intDiv(150000*10000, 158000) = 9493bp — must NOT match."""
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        naive = (150_000 * 10000) // (150_000 + 8_000)
        assert naive == 9493
        assert r.breakeven_cod_rto_rate_bp != naive

    def test_effective_revenue_segments(self):
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))
        cod = next(s for s in r.comparison if s.payment_method == "COD")
        # eff_cod = gross_cod*(1-cod_rto) - cod_fee_total - return_shipping_total
        #   cod_rto_bp=2250 → survived = 120000000 - intDiv(120000000*2250,10000) = 120000000 - 27000000 = 93000000
        #   cod_fee_total = 800*3000 = 2400000; return_shipping = 180*8000 = 1440000
        #   eff = 93000000 - 2400000 - 1440000 = 89160000
        assert cod.effective_revenue_mu == 89_160_000


class TestNegative:
    def test_empty_workspace_fails_closed(self):
        q = CodPrepaidQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _FEES, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        q = CodPrepaidQuery()
        r = q.execute(_WS_A, _DR, _FACTS, _FEES, _client=_client({_WS_B: [_row(_WS_B)]}))
        assert r.workspace_id == _WS_A

    def test_zero_orders_breakeven_note(self):
        q = CodPrepaidQuery()
        r = q.execute(
            _WS_A, _DR, CodPrepaidFacts(), _FEES,
            _client=_client({_WS_A: [_row(_WS_A)]}),
        )
        assert r.breakeven_cod_rto_rate_bp is None
        assert r.breakeven_note is not None
