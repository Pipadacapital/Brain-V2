"""test_inventory_levels_query.py — InventoryLevelsQuery (Phase 2, slice 6).

@paradigm: sql
POSITIVE: days_left velocity cascade (L30→L90→L180→L360); sell_through bp; status by priority;
          sort + status filter.
NEGATIVE: falsy workspace_id fails closed; cross-workspace isolation; out-of-stock → 0 days +
          'Out of stock'; stock-no-velocity → 999999; the "always L360" mutant is KILLED.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.catalog.inventory_levels_query import (
    InventoryLevelsQuery,
    InventoryFacts,
    InventoryFact,
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


# Healthy: inv 300, L30=30 → avgDaily 1 → 300 days. sales365=L360=300 → sell-through 5000bp.
_HEALTHY = InventoryFact(label="Oud Attar 12ml", sku="OUD-12", current_inventory=300,
                         qty_l30=30, qty_l90=90, qty_l180=180, qty_l360=300)
# Restock soon: inv 10, L30=30 (1/day) → 10 days < 21 → Restock Soon.
_RESTOCK = InventoryFact(label="Rose Mist 50ml", sku="ROSE-50", current_inventory=10,
                         qty_l30=30, qty_l90=0, qty_l180=0, qty_l360=300)
# Cascade fall-through: inv 30, L30=0, L90=90 → window L90, qty 90 → 30 days.
_CASCADE = InventoryFact(label="Musk 10ml", sku="MUSK-10", current_inventory=30,
                         qty_l30=0, qty_l90=90, qty_l180=0, qty_l360=0)
# Dead stock: inv 1000, no recent velocity → 999999 → Severely Overstocked.
_DEAD = InventoryFact(label="Sandal Bar", sku="SND-BAR", current_inventory=1000,
                      qty_l30=0, qty_l90=0, qty_l180=0, qty_l360=0)
# Out of stock: inv 0.
_OOS = InventoryFact(label="Jasmine 5ml", sku="JAS-5", current_inventory=0,
                     qty_l30=10, qty_l90=0, qty_l180=0, qty_l360=50)
_FACTS = InventoryFacts(skus=(_HEALTHY, _RESTOCK, _CASCADE, _DEAD, _OOS))


class TestPositive:
    def test_days_left_l30_window(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["OUD-12"].days_left == 300  # 300 / (30/30)

    def test_days_left_cascade_fall_through(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["MUSK-10"].days_left == 30  # L30=0 → falls to L90; 30/(90/90)=30

    def test_sell_through_bp(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        # OUD: sales365=300, inv=300 → 300/600 = 5000bp (50%)
        assert by["OUD-12"].sell_through_bp == 5000

    def test_status_overstocked_threshold(self):
        # OUD has 300 days of cover → >=180 and <365 → Overstocked.
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["OUD-12"].status == "Overstocked"

    def test_status_healthy_mid_range(self):
        # A SKU with 100 days of cover → >=21 and <180 → Healthy.
        healthy = InventoryFact(label="Healthy SKU", sku="HLT-1", current_inventory=100,
                                qty_l30=30, qty_l90=0, qty_l180=0, qty_l360=0)
        r = InventoryLevelsQuery().execute(_WS_A, _DR, InventoryFacts(skus=(healthy,)),
                                           _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.rows[0].days_left == 100
        assert r.rows[0].status == "Healthy"

    def test_status_restock_soon(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["ROSE-50"].status == "Restock Soon"  # 10 days < 21

    def test_status_severely_overstocked_dead_stock(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["SND-BAR"].days_left == 999999
        assert by["SND-BAR"].status == "Severely Overstocked"

    def test_status_filter(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, status_filter="Restock Soon",
                                           _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.total_rows == 1
        assert r.rows[0].sku == "ROSE-50"

    def test_sort_days_left_asc(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, sort="days_left", direction="asc",
                                           _client=_client({_WS_A: [_row(_WS_A)]}))
        # OOS=0, Restock=10, Cascade=30, Overstocked=300, Dead=999999
        assert r.rows[0].sku == "JAS-5"  # 0 days
        assert r.rows[-1].sku == "SND-BAR"  # 999999


class TestNegative:
    def test_falsy_workspace_id_fails_closed(self):
        with pytest.raises(UnscopedQueryError):
            InventoryLevelsQuery().execute("", _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))

    def test_cross_workspace_isolation(self):
        r = InventoryLevelsQuery().execute(_WS_B, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        assert r.workspace_id == _WS_B

    def test_out_of_stock_zero_days(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["JAS-5"].days_left == 0
        assert by["JAS-5"].status == "Out of stock"

    def test_kill_always_l360_mutant(self):
        """Cascade SKU (MUSK-10) has L360=0; an 'always L360' mutant → 999999, not 30."""
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        canon = by["MUSK-10"].days_left
        mutant_always_l360 = 999999  # qty_l360=0 → infinite
        assert canon == 30
        assert canon != mutant_always_l360

    def test_stock_no_velocity_infinite_not_zero(self):
        r = InventoryLevelsQuery().execute(_WS_A, _DR, _FACTS, _client=_client({_WS_A: [_row(_WS_A)]}))
        by = {row.sku: row for row in r.rows}
        assert by["SND-BAR"].days_left == 999999  # has stock but no velocity
