"""test_calendar_report_query.py — CalendarReportQuery (Phase 2, slice 7).

@paradigm: sql
POSITIVE: period grid (rev/cm3/spend/mer/amer/cac/aov); marketing-action overlays per cell;
          per-cell DIRECTIONAL RAG; money goal proration vs ratio goal NOT prorated.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; CAC cell uses lower-better
          band (the "all-higher-better" mutant flips it — KILLED).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.settings.calendar_report_query import (
    CalendarReportQuery,
    CalendarReportFacts,
    CalendarPeriodFact,
    CalendarActionFact,
    CalendarGoalFact,
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

    def _query(sql, parameters=None):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, c, None) for c in _METRIC_COLUMNS) for r in rows]
        res = MagicMock()
        res.result_rows = raw
        return res

    mock.query.side_effect = _query
    return mock


_PERIOD = CalendarPeriodFact(
    period_key="2026-04-01", label="Apr 1, 2026", days_in_period=1,
    revenue_mu=1000000, cm3_mu=300000, total_spend_mu=200000, new_customers=10,
    mer_bp=50000, amer_bp=30000, cac_mu=20000, aov_mu=100000,
)
_ACTION = CalendarActionFact(
    id="a1", action_date="2026-04-01", action_type="email_campaign",
    action_name="Spring blast", notes="Klaviyo · 5000 delivered", source="klaviyo",
)


def _run(facts):
    return CalendarReportQuery().execute(
        _WS_A, _DR, facts, grain="day", _client=_client({_WS_A: [_row(_WS_A)]})
    )


def test_period_grid_carries_all_metrics():
    r = _run(CalendarReportFacts(periods=(_PERIOD,))).rows[0]
    assert r.revenue.actual == 1000000
    assert r.cm3.actual == 300000
    assert r.total_spend_mu == 200000
    assert r.mer.actual == 50000
    assert r.amer.actual == 30000
    assert r.cac.actual == 20000
    assert r.aov.actual == 100000
    assert r.new_customers.actual == 10


def test_marketing_action_overlay_attached():
    facts = CalendarReportFacts(periods=(_PERIOD,), actions=(_ACTION,))
    r = _run(facts).rows[0]
    assert len(r.actions) == 1
    assert r.actions[0].action_type == "email_campaign"
    assert r.actions[0].source == "klaviyo"


def test_money_goal_prorated_daily_no_goal_no_rag():
    # No goals → all cells have rag None.
    r = _run(CalendarReportFacts(periods=(_PERIOD,))).rows[0]
    assert r.revenue.rag is None
    assert r.revenue.goal is None


def test_money_goal_monthly_prorated_to_period():
    # Monthly revenue goal 30_000_000 → per-day (30-day canon) = 1_000_000.
    # Period revenue 1_000_000 → 100% → green (higher-better).
    goal = CalendarGoalFact("revenue", "MONTHLY", 30000000, "MINIMUM")
    facts = CalendarReportFacts(periods=(_PERIOD,), goals=(goal,))
    r = _run(facts).rows[0]
    assert r.revenue.goal == 1000000
    assert r.revenue.rag == "green"


def test_ratio_goal_not_prorated():
    # MER goal (ratio) is NOT prorated — same target each period.
    goal = CalendarGoalFact("mer", "MONTHLY", 48000, "MINIMUM")
    facts = CalendarReportFacts(periods=(_PERIOD,), goals=(goal,))
    r = _run(facts).rows[0]
    assert r.mer.goal == 48000  # unchanged
    # actual 50000 vs 48000 → >100% → green (higher-better)
    assert r.mer.rag == "green"


def test_cac_cell_uses_lower_better_band():
    # CAC goal 18000, actual 20000 → 111% of goal. lower-better: <=1.20*goal → amber.
    # NON-VACUOUS: an "all-higher-better" mutant would compute 111% >= 95% → green.
    goal = CalendarGoalFact("cac", "MONTHLY", 18000, "MAXIMUM")
    facts = CalendarReportFacts(periods=(_PERIOD,), goals=(goal,))
    r = _run(facts).rows[0]
    assert r.cac.rag == "amber"
    assert r.cac.rag != "green"


def test_empty_workspace_id_fails_closed():
    with pytest.raises(UnscopedQueryError):
        CalendarReportQuery().execute("", _DR, CalendarReportFacts(), _client=_client({}))


def test_cross_workspace_isolation():
    r = CalendarReportQuery().execute(
        _WS_A, _DR, CalendarReportFacts(periods=(_PERIOD,)),
        _client=_client({_WS_B: [_row(_WS_B)]}),
    )
    assert r.workspace_id == _WS_A
