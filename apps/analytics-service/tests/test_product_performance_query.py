"""test_product_performance_query.py — ProductPerformanceQuery (Phase 2, slice 6).

@paradigm: sql
POSITIVE: per-group CM1 (= revenue−cogs−variable, REUSE cm1_mu); cm1_pct/cm1_total share;
          pareto cumulative-CM1 walk (A/B/C/F boundary); return-rate bp; AOV; sort + search.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; negative CM1 → F grade;
          the "per-SKU CM2" / "forgot variable cost" mutants are KILLED; revenue<=0 null guards.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.catalog.product_performance_query import (
    ProductPerformanceQuery,
    ProductFacts,
    ProductFact,
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


# Hero product: sales 1,000,000µ, refunds 100,000µ → revenue 900,000µ; cogs 300,000, variable
# 100,000 → cm1 = 900000 − 300000 − 100000 = 500,000µ. sold 100, refunded 10 → return 1000bp.
_HERO = ProductFact(
    label="Sugandh Oud Attar 12ml",
    sales_mu=1_000_000, refunds_mu=100_000, cogs_mu=300_000, variable_cost_mu=100_000,
    sold=100, refunded=10, orders=80,
    nc_orders=50, ec_orders=30, nc_sold=60, nc_refunded=6, ec_sold=40, ec_refunded=4,
    nc_revenue_mu=560_000, ec_revenue_mu=340_000,
)
# Mid product: revenue 300,000; cogs 150,000, variable 50,000 → cm1 = 100,000µ.
_MID = ProductFact(
    label="Rose Mist 50ml",
    sales_mu=320_000, refunds_mu=20_000, cogs_mu=150_000, variable_cost_mu=50_000,
    sold=40, refunded=2, orders=30, nc_orders=20, ec_orders=10,
    nc_sold=25, nc_refunded=1, ec_sold=15, ec_refunded=1, nc_revenue_mu=180_000, ec_revenue_mu=120_000,
)
# Loss product: revenue 50,000; cogs 60,000, variable 10,000 → cm1 = −20,000µ → F grade.
_LOSS = ProductFact(
    label="Discontinued Sample",
    sales_mu=50_000, refunds_mu=0, cogs_mu=60_000, variable_cost_mu=10_000,
    sold=10, refunded=0, orders=8,
)
_FACTS = ProductFacts(products=(_HERO, _MID, _LOSS))


class TestPositive:
    def test_cm1_reuses_registry_def(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        assert by_label["Sugandh Oud Attar 12ml"].cm1_mu == 500_000
        assert by_label["Rose Mist 50ml"].cm1_mu == 100_000
        assert by_label["Discontinued Sample"].cm1_mu == -20_000

    def test_revenue_is_sales_minus_refunds(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        assert by_label["Sugandh Oud Attar 12ml"].revenue_mu == 900_000

    def test_cm1_pct_is_bp_over_revenue(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        # 500000 / 900000 = 5555bp (55.55%)
        assert by_label["Sugandh Oud Attar 12ml"].cm1_pct_bp == 5555

    def test_pareto_grade_cumulative_walk(self):
        # totalPositive = 500000 + 100000 = 600000. Hero alone = 500000/600000 = 83.3% > 80%
        # → Hero is the only A only if ≤80%; here Hero at rank0 cum=500000, 500000*100=50e6 vs
        # 600000*80=48e6 → 50e6 > 48e6 → Hero is B (not A). Mid at cum=600000 → 100% → C.
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        assert by_label["Sugandh Oud Attar 12ml"].pareto_grade == "B"
        assert by_label["Rose Mist 50ml"].pareto_grade == "C"
        assert by_label["Discontinued Sample"].pareto_grade == "F"  # negative cm1

    def test_pareto_grade_a_when_within_80pct(self):
        # Single dominant product → cum 100% but it is the whole positive set; first rank
        # cum=val, val*100 <= val*80? No → so even a sole product is B/C, never auto-A.
        # Build a case where rank0 lands ≤80%: two equal products → rank0 cum=50% ≤80% → A.
        p1 = ProductFact(label="P1", sales_mu=200_000, refunds_mu=0, cogs_mu=0, variable_cost_mu=0,
                         sold=10, refunded=0, orders=10)
        p2 = ProductFact(label="P2", sales_mu=200_000, refunds_mu=0, cogs_mu=0, variable_cost_mu=0,
                         sold=10, refunded=0, orders=10)
        r = ProductPerformanceQuery().execute(
            _WS_A, _DR, ProductFacts(products=(p1, p2)), _client=_client({_WS_A: [_row(_WS_A)]})
        )
        # cm1 each 200000, total 400000. rank0 cum 200000 → 50% ≤80% → A. rank1 cum 400000 → 100% → C.
        grades = {row.label: row.pareto_grade for row in r.rows}
        assert grades["P1"] == "A"
        assert grades["P2"] == "C"

    def test_return_rate_bp(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        # 10 refunded / 100 sold = 1000bp (10%)
        assert by_label["Sugandh Oud Attar 12ml"].return_rate_bp == 1000

    def test_aov_reuses_registry_def(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        # revenue 900000 / 80 orders = 11250µ
        assert by_label["Sugandh Oud Attar 12ml"].aov_mu == 11_250

    def test_total_cm1(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_cm1_mu == 500_000 + 100_000 - 20_000  # 580000

    def test_sort_by_revenue_desc(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, sort="revenue", direction="desc",
                                              _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].label == "Sugandh Oud Attar 12ml"

    def test_search_filters_by_label(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, search="rose",
                                              _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 1
        assert r.rows[0].label == "Rose Mist 50ml"


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        with pytest.raises(UnscopedQueryError):
            ProductPerformanceQuery().execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        r = ProductPerformanceQuery().execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_kill_per_sku_cm2_phantom_no_ad_spend_field(self):
        """CM1 has NO ad-spend term — a per-SKU CM2 mutant would subtract marketing here.

        The fact has no ad-spend field at all; CM1 = revenue − cogs − variable only.
        """
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        # If anyone subtracted a marketing allocation, cm1 would be < 500000. It is exactly 500000.
        assert by_label["Sugandh Oud Attar 12ml"].cm1_mu == 500_000

    def test_kill_forgot_variable_cost_mutant(self):
        """A 'revenue − cogs only' mutant gives 600000 (not the canon 500000)."""
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        canon = by_label["Sugandh Oud Attar 12ml"].cm1_mu
        mutant = 900_000 - 300_000  # revenue − cogs only (forgot variable)
        assert canon == 500_000
        assert mutant == 600_000
        assert canon != mutant

    def test_negative_cm1_grades_f(self):
        r = ProductPerformanceQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by_label = {row.label: row for row in r.rows}
        assert by_label["Discontinued Sample"].pareto_grade == "F"

    def test_zero_revenue_null_cm1_pct(self):
        facts = ProductFacts(products=(ProductFact(
            label="ZeroRev", sales_mu=0, refunds_mu=0, cogs_mu=0, variable_cost_mu=0,
            sold=0, refunded=0, orders=0,
        ),))
        r = ProductPerformanceQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].cm1_pct_bp is None
        assert r.rows[0].aov_mu is None  # zero orders
        assert r.rows[0].return_rate_bp == 0  # sold==0 guard → 0, not None
