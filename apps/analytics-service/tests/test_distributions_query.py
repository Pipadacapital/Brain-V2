"""test_distributions_query.py — DistributionsQuery (Phase 2, slice 4).

@paradigm: sql
POSITIVE: per-product mode/mean/diff; metric toggle (sales/cm1); histogram; filter/sort/paginate.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; empty product set; mode
          tie-break = lowest value (legacy computeMode).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.marketing.distributions_query import (
    DistributionsQuery,
    DistributionsFacts,
    DistributionsProductFact,
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
        total_ad_spend_mu=0, cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=0,
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


# Product A: 5 orders sales {100000,100000,100000,200000,300000} → mode 100000, mean 160000.
# Product B: 3 orders sales {50000,50000,90000} → mode 50000, mean 63333 (floor).
_FACTS = DistributionsFacts(
    products=(
        DistributionsProductFact(
            product_label="Attar Oud",
            per_order_sales_mu=(100_000, 100_000, 100_000, 200_000, 300_000),
            per_order_cm1_mu=(40_000, 40_000, 40_000, 80_000, 120_000),
        ),
        DistributionsProductFact(
            product_label="Rose Mist",
            per_order_sales_mu=(50_000, 50_000, 90_000),
            per_order_cm1_mu=(20_000, 20_000, 30_000),
        ),
    )
)


class TestPositive:
    def test_mode_mean_diff_sales(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, metric="sales", _client=_client({_WS_A: [_row(_WS_A)]}))
        a = next(x for x in r.rows if x.product == "Attar Oud")
        assert a.orders == 5
        assert a.mode_mu == 100_000        # most frequent
        assert a.mean_mu == 160_000        # (100+100+100+200+300)k / 5
        assert a.diff_mu == 100_000 - 160_000

    def test_metric_toggle_cm1(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, metric="cm1", _client=_client({_WS_A: [_row(_WS_A)]}))
        a = next(x for x in r.rows if x.product == "Attar Oud")
        assert a.mode_mu == 40_000
        assert a.mean_mu == 64_000         # (40+40+40+80+120)k / 5

    def test_mean_floor(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, metric="sales", _client=_client({_WS_A: [_row(_WS_A)]}))
        b = next(x for x in r.rows if x.product == "Rose Mist")
        # (50000+50000+90000)/3 = 63333.33 → FLOOR 63333
        assert b.mean_mu == 63_333

    def test_histogram_present(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, metric="sales", _client=_client({_WS_A: [_row(_WS_A)]}))
        assert len(r.graph_points) == 60
        # density is integer bp; sum over buckets ≈ 10000 (allow FLOOR loss)
        total_density = sum(p.density_bp for p in r.graph_points)
        assert 9900 <= total_density <= 10000

    def test_sort_and_search(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, _FACTS, metric="sales", search="rose",
                      _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 1
        assert r.rows[0].product == "Rose Mist"


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        q = DistributionsQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        q = DistributionsQuery()
        r = q.execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_empty_products(self):
        q = DistributionsQuery()
        r = q.execute(_WS_A, _DR, DistributionsFacts(products=()),
                      _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 0
        assert r.rows == ()
        assert r.graph_points == ()
        assert r.global_mode_mu == 0

    def test_mode_tie_break_lowest_value(self):
        """Two values tie on frequency → mode is the LOWEST (legacy computeMode tie-break)."""
        q = DistributionsQuery()
        facts = DistributionsFacts(products=(
            DistributionsProductFact(
                product_label="Tie", per_order_sales_mu=(100_000, 100_000, 200_000, 200_000),
                per_order_cm1_mu=(100_000, 100_000, 200_000, 200_000),
            ),
        ))
        r = q.execute(_WS_A, _DR, facts, metric="sales", _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].mode_mu == 100_000  # lowest of the two tied values
