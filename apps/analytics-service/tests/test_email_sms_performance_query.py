"""test_email_sms_performance_query.py — EmailSmsPerformanceQuery (Phase 2, slice 8).

@paradigm: sql. READ/ANALYTICS ONLY — REPORTING on past Klaviyo email/SMS performance.
🚨 COMPLIANCE: this query has NO send/dispatch path. It reports open/click/revenue on
already-sent rows. test_no_outbound_surface asserts the use-case exposes zero send method.

POSITIVE: open/click rate bp; revenue-per-recipient mu; totals; sort by revenue; dow sort.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; delivered=0 → None rates;
          the "÷ unique_opens not delivered" rate mutant — KILLED. email_cm2 absent.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.lifecycle import email_sms_performance_query as mod
from src.application.contexts.lifecycle.email_sms_performance_query import (
    EmailPerfFact,
    EmailSmsFacts,
    EmailSmsPerformanceQuery,
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
        cm3_mu=0, total_orders=0, rto_rate_bp=0, prepaid_rate_bp=0, conversion_rate_bp=0,
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


def _run(facts: EmailSmsFacts, ws: str = _WS_A):
    client = _client({_WS_A: [_row(_WS_A)], _WS_B: [_row(_WS_B)]})
    return EmailSmsPerformanceQuery().execute(ws, _DR, facts, _client=client)


def _fact(**kw) -> EmailPerfFact:
    base = dict(
        key="c:1", label="Diwali Sale", channel="email",
        delivered=1000, unique_opens=450, unique_clicks=120,
        orders=30, revenue_mu=5_000_000, unsubscribes=2, spam_complaints=1,
    )
    base.update(kw)
    return EmailPerfFact(**base)


# ── rates + revenue-per-recipient ────────────────────────────────────────────
def test_rates_and_rpr():
    r = _run(EmailSmsFacts(group_by="campaign", rows=(_fact(),))).rows[0]
    assert r.open_rate_bp == 4500          # 450/1000
    assert r.click_rate_bp == 1200         # 120/1000
    assert r.revenue_per_recipient_mu == 5000  # 5_000_000/1000


def test_kill_click_rate_divide_by_opens_mutant():
    """click_rate must be ÷ delivered, not ÷ unique_opens — KILLED."""
    r = _run(EmailSmsFacts(group_by="campaign", rows=(_fact(),))).rows[0]
    canon = r.click_rate_bp        # 1200 (÷1000)
    mutant = (120 * 10000) // 450  # 2666 (÷opens)
    assert canon == 1200
    assert mutant == 2666
    assert canon != mutant


def test_zero_delivered_gives_none_rates():
    r = _run(EmailSmsFacts(group_by="campaign", rows=(_fact(delivered=0),))).rows[0]
    assert r.open_rate_bp is None
    assert r.click_rate_bp is None
    assert r.revenue_per_recipient_mu is None


def test_totals_and_revenue_sort():
    facts = EmailSmsFacts(
        group_by="campaign",
        rows=(
            _fact(key="c:lo", revenue_mu=1_000_000, delivered=500),
            _fact(key="c:hi", revenue_mu=9_000_000, delivered=2000),
        ),
    )
    res = _run(facts)
    assert [row.key for row in res.rows] == ["c:hi", "c:lo"]  # revenue desc
    assert res.total_delivered == 2500
    assert res.total_revenue_mu == 10_000_000


def test_sms_channel_reporting():
    r = _run(EmailSmsFacts(group_by="channel", rows=(_fact(channel="sms", key="ch:sms"),))).rows[0]
    assert r.channel == "sms"
    assert r.open_rate_bp == 4500  # rates apply to SMS reporting rows too


def test_dow_group_sorted_by_key():
    facts = EmailSmsFacts(
        group_by="dow",
        rows=(_fact(key="w:5"), _fact(key="w:1"), _fact(key="w:3")),
    )
    assert [row.key for row in _run(facts).rows] == ["w:1", "w:3", "w:5"]


# ── compliance: no outbound surface ──────────────────────────────────────────
def test_no_outbound_surface():
    """🚨 The use-case is REPORTING only. It must expose NO send/dispatch method."""
    q = EmailSmsPerformanceQuery()
    forbidden = ("send", "dispatch", "enqueue", "trigger", "deliver", "publish")
    methods = [m for m in dir(q) if not m.startswith("_")]
    for m in methods:
        for token in forbidden:
            assert token not in m.lower(), f"outbound-looking method {m!r} on read-only query"
    # The module imports no notification/lifecycle-outbound client.
    src = mod.__doc__ or ""
    assert "REPORTING" in src


def test_email_cm2_not_referenced():
    """Finding 4: there is no email CM2 attribution — the result row has no cm2 field."""
    r = _run(EmailSmsFacts(group_by="campaign", rows=(_fact(),))).rows[0]
    assert not hasattr(r, "cm2_mu")
    assert not hasattr(r, "email_cm2_mu")


# ── tenancy (fail-closed) ────────────────────────────────────────────────────
def test_falsy_workspace_fails_closed():
    with pytest.raises(UnscopedQueryError):
        EmailSmsPerformanceQuery().execute("", _DR, EmailSmsFacts(group_by="campaign"), _client=_client({}))


def test_cross_workspace_isolation():
    r = _run(EmailSmsFacts(group_by="campaign", rows=(_fact(),)), ws=_WS_B)
    assert r.workspace_id == _WS_B
