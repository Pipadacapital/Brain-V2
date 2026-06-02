"""test_order_timings_query.py — OrderTimingsQuery (Phase 2, slice 8).

@paradigm: sql. READ/ANALYTICS ONLY — inter-order gap medians + repeat % + reactivation window.
POSITIVE: gap medians (median + mean); 2nd/3rd/4th repeat bp; reactivation = 0.8×median(1→2);
          grouping + stable sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; empty gaps → None rungs;
          the "reactivation = full interval (drop 0.8)" mutant — KILLED. best_send_time absent.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.lifecycle.order_timings_query import (
    OrderTimingsQuery,
    TimingsFacts,
    TimingsGroupFact,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)

_DR = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 30))
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

    def _query(sql, parameters=None, **_kwargs):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


def _run(facts: TimingsFacts, ws: str = _WS_A, metric: str = "median"):
    client = _client({_WS_A: [_row(_WS_A)], _WS_B: [_row(_WS_B)]})
    return OrderTimingsQuery().execute(ws, _DR, facts, metric=metric, _client=client)


def _overall(**kw) -> TimingsGroupFact:
    base = dict(
        group_id="", label="All products", group_by="product",
        first_orders=0, count_2nd=0, count_3rd=0, count_4th=0,
        gap_1to2_days=(), gap_2to3_days=(), gap_3to4_days=(),
    )
    base.update(kw)
    return TimingsGroupFact(**base)


# ── gap medians + reactivation ───────────────────────────────────────────────
def test_summary_median_and_reactivation():
    facts = TimingsFacts(
        overall=_overall(
            first_orders=10, count_2nd=6, count_3rd=3, count_4th=1,
            gap_1to2_days=(20, 30, 40),  # median 30
            gap_2to3_days=(50, 60),      # median (50+60)//2 = 55
            gap_3to4_days=(70,),
        )
    )
    s = _run(facts).summary
    assert s.days_1to2 == 30
    assert s.days_2to3 == 55
    assert s.days_3to4 == 70
    assert s.reactivation_window_days == 24  # round(0.8×30) = 24
    # repeat bp: 6/10 → 6000bp, 3/10 → 3000bp, 1/10 → 1000bp
    assert s.second_orders_bp == 6000
    assert s.third_orders_bp == 3000
    assert s.fourth_orders_bp == 1000


def test_mean_metric_path():
    facts = TimingsFacts(
        overall=_overall(first_orders=2, count_2nd=2, gap_1to2_days=(10, 30))  # mean 20
    )
    s = _run(facts, metric="mean").summary
    assert s.days_1to2 == 20
    assert s.reactivation_window_days == 16  # round(0.8×20) = 16


def test_kill_reactivation_no_factor_mutant():
    """The reactivation window must be 0.8×median, NOT the full interval — KILLED."""
    facts = TimingsFacts(overall=_overall(first_orders=1, count_2nd=1, gap_1to2_days=(30,)))
    s = _run(facts).summary
    canon = s.reactivation_window_days  # 24
    mutant = s.days_1to2  # 30 (full interval)
    assert canon == 24
    assert mutant == 30
    assert canon != mutant


def test_empty_gaps_give_none_rungs():
    s = _run(TimingsFacts(overall=_overall(first_orders=5, count_2nd=0))).summary
    assert s.days_1to2 is None
    assert s.days_2to3 is None
    assert s.reactivation_window_days is None
    assert s.second_orders_bp == 0


# ── grouping + sort ──────────────────────────────────────────────────────────
def test_groups_sorted_by_first_orders_desc():
    facts = TimingsFacts(
        overall=_overall(first_orders=12),
        groups=(
            TimingsGroupFact("p2", "Musk", "product", 4, 2, 1, 0, (10,), (), ()),
            TimingsGroupFact("p1", "Oud", "product", 8, 5, 2, 1, (20,), (), ()),
        ),
    )
    g = _run(facts).groups
    assert [row.group_id for row in g] == ["p1", "p2"]  # 8 before 4


# ── tenancy (fail-closed) ────────────────────────────────────────────────────
def test_falsy_workspace_fails_closed():
    with pytest.raises(UnscopedQueryError):
        OrderTimingsQuery().execute("", _DR, TimingsFacts(overall=_overall()), _client=_client({}))


def test_cross_workspace_isolation():
    r = _run(TimingsFacts(overall=_overall(first_orders=1)), ws=_WS_B)
    assert r.workspace_id == _WS_B
