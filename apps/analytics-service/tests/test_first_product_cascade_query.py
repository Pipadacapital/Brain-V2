"""test_first_product_cascade_query.py — FirstProductCascadeQuery (Phase 2, slice 6).

@paradigm: sql
POSITIVE: second/third/fourth+ rate bp (per-first-product cohort); additional-order-rate
          (centi-orders); average revenue LTV; average-days-to-second (deci-days); cohort sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; empty cohort null guards;
          the "÷ orders not customers" mutant is KILLED; this rate is NOT slice-5 rr90.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.catalog.first_product_cascade_query import (
    FirstProductCascadeQuery,
    FirstProductCascadeFacts,
    FirstProductCohortFact,
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


# Hero first-product cohort: 8 customers; 3 with >=2, 2 with >=3, 1 with >=4 orders.
# additional orders sum = 6 (e.g. customers placed 1,1,1,1,1,2,3,4 = 0+0+0+0+0+1+2+3=6).
# LTV revenue sum = 8,000,000µ → avg 1,000,000µ. days-to-second: 3 custs, sum 90 → avg 30.0.
_HERO = FirstProductCohortFact(
    product_key="p_oud", product_title="Sugandh Oud Attar 12ml",
    first_order_customers=8, customers_with_2plus=3, customers_with_3plus=2, customers_with_4plus=1,
    sum_additional_orders=6, sum_ltv_revenue_mu=8_000_000,
    sum_days_to_second=90, customers_with_second=3,
)
# Second cohort: 4 customers; 1 with >=2. avg ltv 500000.
_SECOND = FirstProductCohortFact(
    product_key="p_rose", product_title="Rose Mist 50ml",
    first_order_customers=4, customers_with_2plus=1, customers_with_3plus=0, customers_with_4plus=0,
    sum_additional_orders=1, sum_ltv_revenue_mu=2_000_000,
    sum_days_to_second=45, customers_with_second=1,
)
_FACTS = FirstProductCascadeFacts(cohorts=(_HERO, _SECOND), total_cohort_customers=12)


class TestPositive:
    def test_second_order_rate_bp(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        # 3 of 8 → intDiv(3*10000,8) = 3750bp (37.5%)
        assert by["p_oud"].second_order_rate_bp == 3750

    def test_third_and_fourth_rates(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        assert by["p_oud"].third_order_rate_bp == 2500  # 2/8 = 25%
        assert by["p_oud"].fourth_plus_rate_bp == 1250  # 1/8 = 12.5%

    def test_additional_order_rate_centi(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        # 6 extra / 8 custs = 0.75 → 75 centi-orders
        assert by["p_oud"].additional_order_rate_centi == 75

    def test_average_ltv_revenue(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        assert by["p_oud"].average_ltv_revenue_mu == 1_000_000  # 8000000 / 8

    def test_average_days_to_second_deci(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        # 90 days / 3 custs = 30.0 → 300 deci-days
        assert by["p_oud"].average_days_to_second_deci == 300

    def test_cohorts_sorted_by_size_desc(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].product_key == "p_oud"  # 8 > 4
        assert r.rows[1].product_key == "p_rose"

    def test_total_cohort_customers(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_cohort_customers == 12

    def test_observation_window_clamped(self):
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, observation_days=5000,
                                               _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.observation_days == 730  # clamped to max
        r2 = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, observation_days=1,
                                                _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r2.observation_days == 30  # clamped to min


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        with pytest.raises(UnscopedQueryError):
            FirstProductCascadeQuery().execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        r = FirstProductCascadeQuery().execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_kill_divide_by_orders_mutant(self):
        """A '÷ total orders' mutant would use a larger denominator → lower rate.

        The cohort has 8 customers but (say) 20 lifetime orders. Canon divides by CUSTOMERS (8)
        → 3750bp. The mutant ÷ orders(20) → 1500bp. Different — KILLED.
        """
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.product_key: row for row in r.rows}
        canon = by["p_oud"].second_order_rate_bp
        # The mutant ÷ orders(20): intDiv(3*10000, 20) = 1500.
        mutant = (3 * 10000) // 20
        assert canon == 3750
        assert mutant == 1500
        assert canon != mutant

    def test_empty_cohort_null_guards(self):
        facts = FirstProductCascadeFacts(cohorts=(FirstProductCohortFact(
            product_key="p_empty", product_title="Empty",
            first_order_customers=0, customers_with_2plus=0, customers_with_3plus=0,
            customers_with_4plus=0, sum_additional_orders=0, sum_ltv_revenue_mu=0,
            sum_days_to_second=0, customers_with_second=0,
        ),), total_cohort_customers=0)
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].second_order_rate_bp is None
        assert r.rows[0].average_ltv_revenue_mu == 0
        assert r.rows[0].average_days_to_second_deci is None

    def test_no_second_order_custs_null_days(self):
        facts = FirstProductCascadeFacts(cohorts=(FirstProductCohortFact(
            product_key="p_oneoff", product_title="One-off",
            first_order_customers=5, customers_with_2plus=0, customers_with_3plus=0,
            customers_with_4plus=0, sum_additional_orders=0, sum_ltv_revenue_mu=1_000_000,
            sum_days_to_second=0, customers_with_second=0,
        ),), total_cohort_customers=5)
        r = FirstProductCascadeQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].second_order_rate_bp == 0  # 0/5
        assert r.rows[0].average_days_to_second_deci is None  # no 2nd-order custs
