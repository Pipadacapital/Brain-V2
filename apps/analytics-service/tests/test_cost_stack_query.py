"""test_cost_stack_query.py — CostStackQuery (Phase 2, slice 7).

@paradigm: sql
POSITIVE: COGS mode (override vs product+fallback); cost-row totals (fixed/per-order);
          CM landing echoed from the EXISTING CM path; stable ordering.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.settings.cost_stack_query import (
    CostStackQuery,
    CostStackFacts,
    CogsSettingsFact,
    CostRowFact,
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


_FACTS = CostStackFacts(
    cogs_settings=CogsSettingsFact(override_all_bp=0, fallback_bp=2500, markup_bp=500),
    cost_rows=(
        CostRowFact("SHIPPING", "Courier", "per_order", 6000, 0, "2026-01-01", "INR"),
        CostRowFact("PACKAGING", "Box+filler", "per_order", 2000, 0, "2026-01-01", "INR"),
        CostRowFact("SOFTWARE", "SaaS stack", "fixed_monthly", 5000000, 0, "2026-01-01", "INR"),
        CostRowFact("CUSTOM", "Payment gateway", "percent", 0, 200, "2026-01-01", "INR"),
    ),
    net_sales_mu=20000000, resolved_cogs_mu=5000000, variable_costs_mu=800000,
    cm1_mu=14200000, currency_code="INR",
)


def _run(facts=_FACTS):
    return CostStackQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))


def test_cogs_mode_product_fallback_when_override_off():
    r = _run()
    assert r.cogs_mode == "product+fallback"
    assert r.fallback_bp == 2500
    assert r.markup_bp == 500


def test_cogs_mode_override_when_override_on():
    facts = CostStackFacts(cogs_settings=CogsSettingsFact(override_all_bp=3500))
    r = CostStackQuery().execute(_WS_A, _DR, facts, _client=_client({_WS_A: [_row(_WS_A)]}))
    assert r.cogs_mode == "override"


def test_cost_totals_split_by_kind():
    r = _run()
    assert r.total_per_order_mu == 6000 + 2000
    assert r.total_fixed_monthly_mu == 5000000


def test_cm_landing_echoes_existing_cm_path():
    r = _run()
    # CM1 = net_sales - cogs - variable (one source of truth — not recomputed here).
    assert r.cm1_mu == 14200000
    assert r.resolved_cogs_mu == 5000000
    assert r.net_sales_mu == 20000000


def test_stable_ordering_by_cost_type():
    r = _run()
    types = [c.cost_type for c in r.cost_rows]
    assert types == sorted(types)


def test_empty_workspace_id_fails_closed():
    with pytest.raises(UnscopedQueryError):
        CostStackQuery().execute("", _DR, _FACTS, _client=_client({}))


def test_cross_workspace_isolation():
    client = _client({_WS_B: [_row(_WS_B)]})
    # No gateway rows for WS_A is fine — facts come from the scoped settings path.
    r = CostStackQuery().execute(_WS_A, _DR, _FACTS, _client=client)
    assert r.workspace_id == _WS_A
