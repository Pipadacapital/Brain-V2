"""test_cohort_matrix_query.py — CohortMatrixQuery (Phase 2, slice 5).

@paradigm: sql
POSITIVE: per-cohort CAC; rr90 bp; cumulative LTV (CM3); LTV:CAC; the cumulative bucket-walk
          payback WITH interpolation (the load-bearing correction); mode transforms; summary.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; zero-customer null guards;
          payback null when never reached; the flat CAC/MonthlyCM2 mutant is KILLED.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.cohorts.cohort_matrix_query import (
    CohortMatrixQuery,
    CohortFacts,
    CohortFact,
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


# One cohort, 10 customers. firstOrderR sum = 300000µ (30000µ/cust), cac month-spend = 500000µ
# → cac 50000µ/cust. incr cm3 = [200000µ, 0...] → 20000µ/cust in M1. 3 of 10 repeat in 90d.
# CF-S5-COHORT-PAYBACK-1: cum0 = 30000 − 50000 = −20000; M1 cum = 0 → cm3+post interpolate:
#   (1-1)*100 + floor(100*20000/20000) = 100 centi-months (1.0 month).
_COHORT = CohortFact(
    cohort_month="2026-01",
    new_customers=10,
    month_spend_mu=500_000,
    sum_first_order_cm3_mu=300_000,
    sum_first_order_realized_cm3_mu=300_000,
    repeat_customers_90d=3,
    incr_cm3_mu=(200_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    incr_revenue_mu=(400_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    incr_repeat_customers=(3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    incr_repurchase_orders=(4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
)
_FACTS = CohortFacts(cohorts=(_COHORT,), total_ad_spend_mu=500_000)


class TestPositive:
    def test_per_cohort_cac(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].cac_mu == 50_000  # 500000/10

    def test_rr90_basis_points(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].rr90_bp == 3000  # intDiv(3*10000,10) = 3000bp (30%)

    def test_cohort_ltv_cumulative_cm3(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # ltv = firstOrderR(30000) + Σ per-cust cm3 (20000 in M1) = 50000µ
        assert r.rows[0].cohort_ltv_mu == 50_000

    def test_ltv_cac_ratio(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        # ltv 50000 / cac 50000 = 10000bp (1.0x)
        assert r.rows[0].ltv_cac_bp == 10000

    def test_payback_interpolated_cm3_post(self):
        """CF-S5-COHORT-PAYBACK-1: the load-bearing cumulative bucket-walk + interpolation."""
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="cm3", mode="post",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].payback_centimonths == 100  # 1.0 month

    def test_payback_kills_flat_ratio_mutant(self):
        """KILL: the phantom flat CAC/MonthlyCM2 = intDiv(50000, 20000) = 2 months (200 centi).

        The real bucket-walk gives 100 centi-months — they MUST differ.
        """
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="cm3", mode="post",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        flat_mutant = (50_000 // 20_000) * 100  # 200 centi-months
        assert r.rows[0].payback_centimonths != flat_mutant
        assert r.rows[0].payback_centimonths == 100

    def test_summary_average_cac_and_repeat(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.average_cac_mu == 50_000
        assert r.avg_90day_repeat_bp == 3000
        assert r.average_payback_centimonths == 100
        assert r.new_customers == 10

    def test_cm3_post_keeps_incremental(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="cm3", mode="post",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].m[0] == 20_000  # per-cust incremental M1

    def test_cm3_cumulative_seeds_first_order(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="cm3", mode="cumulative",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        # cumulative seeds firstOrderR(30000) + M1(20000) = 50000
        assert r.rows[0].m[0] == 50_000

    def test_repeat_metric_uses_rate(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="repeat", mode="incr",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        # M1 repeat rate = intDiv(3*10000,10) = 3000bp
        assert r.rows[0].m[0] == 3000


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        with pytest.raises(UnscopedQueryError):
            CohortMatrixQuery().execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        r = CohortMatrixQuery().execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_zero_customers_null_guards(self):
        facts = CohortFacts(cohorts=(CohortFact(
            cohort_month="2026-02", new_customers=0, month_spend_mu=100_000,
            sum_first_order_cm3_mu=0, sum_first_order_realized_cm3_mu=0, repeat_customers_90d=0,
        ),), total_ad_spend_mu=100_000)
        r = CohortMatrixQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].cac_mu is None
        assert r.rows[0].rr90_bp is None
        assert r.average_cac_mu is None

    def test_payback_none_when_never_reached(self):
        """firstOrderR << cac and tiny increments → never recovers → payback None."""
        facts = CohortFacts(cohorts=(CohortFact(
            cohort_month="2026-03", new_customers=10, month_spend_mu=5_000_000,  # cac 500000
            sum_first_order_cm3_mu=100_000, sum_first_order_realized_cm3_mu=100_000,  # fo 10000
            repeat_customers_90d=0,
            incr_cm3_mu=(10_000,) + (0,) * 11,  # 1000/cust per M1, nothing else
        ),), total_ad_spend_mu=5_000_000)
        r = CohortMatrixQuery().execute(_WS_A, _DR, facts, metric="cm3", mode="post",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].payback_centimonths is None
        assert r.average_payback_centimonths is None

    def test_payback_immediate_when_fo_exceeds_cac(self):
        facts = CohortFacts(cohorts=(CohortFact(
            cohort_month="2026-03", new_customers=10, month_spend_mu=100_000,  # cac 10000
            sum_first_order_cm3_mu=300_000, sum_first_order_realized_cm3_mu=300_000,  # fo 30000 > cac
            repeat_customers_90d=0,
        ),), total_ad_spend_mu=100_000)
        r = CohortMatrixQuery().execute(_WS_A, _DR, facts, metric="cm3", mode="post",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].payback_centimonths == 0

    def test_payback_none_for_repeat_metric(self):
        r = CohortMatrixQuery().execute(_WS_A, _DR, _FACTS, metric="repeat", mode="incr",
                                        _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].payback_centimonths is None
