"""test_festival_calendar_query.py — FestivalCalendarQuery (Phase 2, slice 7).

@paradigm: sql
POSITIVE: India template rows; expected_multiplier in bp (×10000); year filter; peak multiplier;
          NO learned-lift field anywhere (phantom decommissioned — Rohan Finding 2).
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.settings.festival_calendar_query import (
    FestivalCalendarQuery,
    FestivalFacts,
    FestivalFact,
    FestivalRow,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)

_DR = DateRange(start=date(2026, 1, 1), end=date(2026, 12, 31))
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


_FACTS = FestivalFacts(festivals=(
    FestivalFact("Makar Sankranti", "2026-01-14", "2026-01-14", 13000, (), ("all",)),
    FestivalFact("Diwali", "2026-11-08", "2026-11-12", 40000, (), ("all",)),
    FestivalFact("Onam", "2026-09-13", "2026-09-23", 22000, ("Kerala",), ("all",)),
    FestivalFact("Diwali", "2025-10-20", "2025-10-24", 40000, (), ("all",)),  # prior year
))


def _run(year=None, facts=_FACTS):
    return FestivalCalendarQuery().execute(
        _WS_A, _DR, facts, year=year, _client=_client({_WS_A: [_row(_WS_A)]})
    )


def test_multiplier_in_basis_points():
    r = _run()
    diwali = next(x for x in r.rows if x.name == "Diwali" and x.start_date.startswith("2026"))
    assert diwali.expected_multiplier_bp == 40000  # 4.0×


def test_peak_multiplier_is_diwali():
    r = _run()
    assert r.peak_multiplier_bp == 40000


def test_year_filter_excludes_other_years():
    r = _run(year=2026)
    years = {x.start_date[:4] for x in r.rows}
    assert years == {"2026"}
    assert r.total_rows == 3


def test_sorted_by_start_date():
    r = _run(year=2026)
    dates = [x.start_date for x in r.rows]
    assert dates == sorted(dates)


def test_no_learned_lift_field_exists():
    # Finding 2: festival_lift is a phantom. The row carries only the stored multiplier.
    r = _run()
    field_names = set(FestivalRow.__dataclass_fields__.keys())
    assert "learned_lift" not in field_names
    assert "festival_lift" not in field_names
    assert "expected_multiplier_bp" in field_names


def test_empty_workspace_id_fails_closed():
    with pytest.raises(UnscopedQueryError):
        FestivalCalendarQuery().execute("", _DR, _FACTS, _client=_client({}))


def test_cross_workspace_isolation():
    r = FestivalCalendarQuery().execute(
        _WS_A, _DR, _FACTS, _client=_client({_WS_B: [_row(_WS_B)]})
    )
    assert r.workspace_id == _WS_A
