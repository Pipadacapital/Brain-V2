"""test_goal_attainment_query.py — GoalAttainmentQuery (Phase 2, slice 7).

@paradigm: sql
POSITIVE: attainment bp; higher-better band (green/amber/red); lower-better band (CAC/ACOS
          inverted); MINIMUM/MAXIMUM/TARGET direction resolution; variance.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; goal==0 → attainment NULL;
          the "treat-all-as-higher-better" mutant flips CAC@120% red→green — KILLED.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.settings.goal_attainment_query import (
    GoalAttainmentQuery,
    GoalFacts,
    GoalRowFact,
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


def _run(facts: GoalFacts):
    client = _client({_WS_A: [_row(_WS_A)]})
    return GoalAttainmentQuery().execute(_WS_A, _DR, facts, _client=client)


# ── Higher-better (revenue, MINIMUM) ─────────────────────────────────────────
def test_higher_better_amber_at_92pct():
    # revenue actual 9200 vs goal 10000 → 9200bp; 92% → amber (>=80 <95).
    facts = GoalFacts(rows=(GoalRowFact("revenue", "MONTHLY", "2026-04-01", 10000, "MINIMUM", 9200),))
    r = _run(facts).rows[0]
    assert r.attainment_bp == 9200
    assert r.higher_better is True
    assert r.rag == "amber"
    assert r.variance_abs == -800


def test_higher_better_green_at_98pct():
    facts = GoalFacts(rows=(GoalRowFact("revenue", "MONTHLY", "2026-04-01", 10000, "MINIMUM", 9800),))
    r = _run(facts).rows[0]
    assert r.rag == "green"


def test_higher_better_red_below_80pct():
    facts = GoalFacts(rows=(GoalRowFact("revenue", "MONTHLY", "2026-04-01", 10000, "MINIMUM", 7000),))
    r = _run(facts).rows[0]
    assert r.rag == "red"


# ── Lower-better (CAC, MAXIMUM) — the inverted band the slice-table omitted ───
def test_lower_better_cac_at_120pct_is_amber_not_green():
    # CAC actual 12000 vs goal 10000 → 120% of goal. lower-better: <=1.20*goal → amber.
    facts = GoalFacts(rows=(GoalRowFact("cac", "MONTHLY", "2026-04-01", 10000, "MAXIMUM", 12000),))
    r = _run(facts).rows[0]
    assert r.higher_better is False
    assert r.rag == "amber"  # NON-VACUOUS: a "all-higher-better" mutant → 120% >= 95% → GREEN


def test_lower_better_cac_just_past_amber_is_red():
    facts = GoalFacts(rows=(GoalRowFact("cac", "MONTHLY", "2026-04-01", 10000, "MAXIMUM", 12100),))
    r = _run(facts).rows[0]
    assert r.rag == "red"


def test_lower_better_cac_at_goal_is_green():
    facts = GoalFacts(rows=(GoalRowFact("cac", "MONTHLY", "2026-04-01", 10000, "MAXIMUM", 10000),))
    r = _run(facts).rows[0]
    assert r.rag == "green"  # <= 1.05*goal


# MUTANT KILL: if direction were ignored (all higher-better), CAC@120% would be green.
def test_mutant_all_higher_better_is_killed():
    facts = GoalFacts(rows=(GoalRowFact("cac", "MONTHLY", "2026-04-01", 10000, "MAXIMUM", 12000),))
    r = _run(facts).rows[0]
    # Real (directional) answer is amber. The mutant answer would be 'green'.
    assert r.rag != "green"


# ── TARGET resolves to the metric's intrinsic direction ──────────────────────
def test_target_uses_metric_intrinsic_direction_acos_lower_better():
    # acos is intrinsically lower-better; TARGET inherits that. actual 11000 vs 10000 = 110% → amber.
    facts = GoalFacts(rows=(GoalRowFact("acos", "MONTHLY", "2026-04-01", 10000, "TARGET", 11000),))
    r = _run(facts).rows[0]
    assert r.higher_better is False
    assert r.rag == "amber"


def test_target_revenue_is_higher_better():
    facts = GoalFacts(rows=(GoalRowFact("revenue", "MONTHLY", "2026-04-01", 10000, "TARGET", 9600),))
    r = _run(facts).rows[0]
    assert r.higher_better is True
    assert r.rag == "green"  # 96% >= 95%


# ── Edge: goal == 0 → attainment NULL but band still classifies ──────────────
def test_zero_goal_attainment_null():
    facts = GoalFacts(rows=(GoalRowFact("revenue", "MONTHLY", "2026-04-01", 0, "MINIMUM", 5000),))
    r = _run(facts).rows[0]
    assert r.attainment_bp is None


# ── Tenancy (fail-closed) ────────────────────────────────────────────────────
def test_empty_workspace_id_fails_closed():
    with pytest.raises(UnscopedQueryError):
        GoalAttainmentQuery().execute("", _DR, GoalFacts(), _client=_client({}))


def test_whitespace_workspace_id_fails_closed():
    with pytest.raises(UnscopedQueryError):
        GoalAttainmentQuery().execute("   ", _DR, GoalFacts(), _client=_client({}))


def test_cross_workspace_isolation():
    # Querying as WS_A must NEVER read WS_B's gateway rows (gateway scopes by param).
    client = _client({_WS_B: [_row(_WS_B)]})
    res = GoalAttainmentQuery().execute(_WS_A, _DR, GoalFacts(), _client=client)
    assert res.workspace_id == _WS_A
    assert res.total_rows == 0


def test_stable_ordering_metric_then_period():
    facts = GoalFacts(rows=(
        GoalRowFact("revenue", "MONTHLY", "2026-04-01", 10000, "MINIMUM", 9000),
        GoalRowFact("cac", "DAILY", "2026-04-01", 10000, "MAXIMUM", 9000),
        GoalRowFact("revenue", "DAILY", "2026-04-01", 10000, "MINIMUM", 9000),
    ))
    res = _run(facts)
    names = [r.metric_name for r in res.rows]
    assert names == ["cac", "revenue", "revenue"]
    # revenue DAILY before MONTHLY
    revs = [r.period_type for r in res.rows if r.metric_name == "revenue"]
    assert revs == ["DAILY", "MONTHLY"]
