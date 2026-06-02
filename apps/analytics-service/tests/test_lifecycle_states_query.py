"""test_lifecycle_states_query.py — LifecycleStatesQuery (Phase 2, slice 8).

@paradigm: sql. READ/ANALYTICS ONLY — recency-vs-empirical-percentile classification.
POSITIVE: p40/p80 from empirical gaps; fallback 45/120; new vs active orderCount split;
          at_risk / churned bands; revenue-by-bucket attribution; net_active = new + active.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; order_count<1 raises;
          the "ignore orderCount split (always active)" mutant misclassifies a 1-order recent
          customer — KILLED. Empty cohort → all-zero buckets.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.lifecycle.lifecycle_states_query import (
    CustomerFact,
    LifecycleFacts,
    LifecycleStatesQuery,
    classify_customer_lifecycle,
    compute_churn_thresholds,
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


def _run(facts: LifecycleFacts, ws: str = _WS_A):
    client = _client({_WS_A: [_row(_WS_A)], _WS_B: [_row(_WS_B)]})
    return LifecycleStatesQuery().execute(ws, _DR, facts, _client=client)


# ── percentile / thresholds (pure) ───────────────────────────────────────────
def test_fallback_thresholds_when_too_few_gaps():
    p40, p80, fb = compute_churn_thresholds([10, 20, 30])  # < 20 gaps
    assert (p40, p80, fb) == (45, 120, True)


def test_empirical_thresholds_when_enough_gaps():
    gaps = list(range(1, 41))  # 40 gaps, 1..40
    p40, p80, fb = compute_churn_thresholds(gaps)
    assert fb is False
    # PERCENTILE.INC: pos40 = 0.4*39 = 15.6 → blend g[15],g[16] = 16 + 0.6*1 = 16.6 → round 17
    assert p40 == 17
    # pos80 = 0.8*39 = 31.2 → 32 + 0.2 = 32.2 → round 32
    assert p80 == 32
    assert p80 > p40


# ── classifier (the orderCount split is load-bearing) ────────────────────────
def test_single_order_recent_is_new_not_active():
    assert classify_customer_lifecycle(1, 10, 45, 120) == "new"


def test_multi_order_recent_is_active():
    assert classify_customer_lifecycle(3, 10, 45, 120) == "active"


def test_kill_ignore_ordercount_split_mutant():
    """A 'always treat as multi-order (active)' mutant labels a 1-order recent customer
    'active' instead of 'new' — KILLED by the orderCount split."""
    canon = classify_customer_lifecycle(1, 10, 45, 120)  # new
    mutant = classify_customer_lifecycle(3, 10, 45, 120)  # active (forced multi)
    assert canon == "new"
    assert mutant == "active"
    assert canon != mutant


def test_at_risk_and_churned_bands():
    assert classify_customer_lifecycle(2, 60, 45, 120) == "at_risk"   # p40 < 60 <= p80
    assert classify_customer_lifecycle(2, 200, 45, 120) == "churned"  # > p80


def test_order_count_below_one_raises():
    with pytest.raises(ValueError):
        classify_customer_lifecycle(0, 5, 45, 120)


# ── full use-case ────────────────────────────────────────────────────────────
def test_buckets_counts_and_revenue_attribution():
    facts = LifecycleFacts(
        repeat_gaps_days=tuple(range(1, 41)),  # empirical: p40=17, p80=32
        customers=(
            CustomerFact("c-new", 1, 5, 100000, 1),       # 1 order, recent → new
            CustomerFact("c-active", 4, 10, 500000, 2),   # multi, recent → active
            CustomerFact("c-risk", 2, 25, 200000, 1),     # 17 < 25 <= 32 → at_risk
            CustomerFact("c-churned", 3, 90, 0, 0),       # > 32 → churned
        ),
        unattributed_revenue_mu=33000,
        unattributed_order_count=1,
        currency_code="INR",
    )
    r = _run(facts)
    bybucket = {b.bucket: b for b in r.buckets}
    assert bybucket["new"].customer_count == 1
    assert bybucket["active"].customer_count == 1
    assert bybucket["at_risk"].customer_count == 1
    assert bybucket["churned"].customer_count == 1
    assert bybucket["new"].revenue_mu == 100000
    assert bybucket["active"].revenue_mu == 500000
    assert r.net_active == 2  # new + active
    assert r.total_customers == 4
    assert r.unattributed_revenue_mu == 33000
    assert r.p40_days == 17 and r.p80_days == 32 and r.used_fallback is False


def test_empty_cohort_all_zero():
    r = _run(LifecycleFacts(repeat_gaps_days=(), customers=()))
    assert r.total_customers == 0
    assert r.net_active == 0
    assert all(b.customer_count == 0 for b in r.buckets)
    assert r.used_fallback is True  # 0 gaps → fallback 45/120


# ── tenancy (fail-closed) ────────────────────────────────────────────────────
def test_falsy_workspace_fails_closed():
    with pytest.raises(UnscopedQueryError):
        LifecycleStatesQuery().execute("", _DR, LifecycleFacts(), _client=_client({}))


def test_whitespace_workspace_fails_closed():
    with pytest.raises(UnscopedQueryError):
        LifecycleStatesQuery().execute("   ", _DR, LifecycleFacts(), _client=_client({}))


def test_cross_workspace_isolation():
    """WS_B's read returns WS_B rows only — the gateway is scoped by the bound param."""
    r = _run(LifecycleFacts(customers=(CustomerFact("c", 2, 5, 1000, 1),)), ws=_WS_B)
    assert r.workspace_id == _WS_B
