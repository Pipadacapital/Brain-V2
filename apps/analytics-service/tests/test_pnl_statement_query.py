"""
test_pnl_statement_query.py — PnlStatementQuery use-case (Phase 2, slice 2).

@paradigm: sql
Covers BOTH positive and negative scenarios (code-clarity + coverage standard):
  POSITIVE — assembles the honest CM ladder; cm1 SUBTRACTS variable costs (the
             slice-2 correction); cm2/cm3 cascade; True-CM2 worked example; multi-day SUM.
  NEGATIVE — falsy workspace_id fails closed (UnscopedQueryError); cross-workspace
             isolation (querying ws_A never returns ws_B facts); the cm1-COGS-only
             regression mutant is killed.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.pnl.pnl_statement_query import (
    PnlStatementQuery,
    RtoProvisionFacts,
    VariableCostFacts,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)


_DATE_RANGE = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 2))
_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"


def _row(workspace_id: str, date_val: date) -> MetricRow:
    """A single canonical fact row (paise). net_revenue 58900.00, cogs 22320.00,
    ad_spend 17360.00, misc prorated 2000.00."""
    return MetricRow(
        workspace_id=workspace_id,
        date=date_val,
        gross_sales_mu=6_200_000,
        returns_mu=0,
        discounts_mu=310_000,
        net_sales_mu=5_890_000,
        total_tax_mu=496_000,
        net_net_tax_mu=5_394_000,
        shipping_revenue_mu=496_000,
        net_revenue_mu=5_890_000,
        cogs_mu=2_232_000,
        total_ad_spend_mu=1_736_000,
        cm1_mu=0,                       # MV pre-computed value ignored; we re-derive honestly
        cm2_mu=0,
        misc_expenses_prorated_mu=200_000,
        cm3_mu=0,
        rto_rate_bp=1800,
        prepaid_rate_bp=4100,
        conversion_rate_bp=230,
        aov_mu=None,
        acos_bp=None,
        blended_roas_x100=None,
    )


def _client(rows_by_ws: dict[str, list[MetricRow]]) -> MagicMock:
    """Mock CH client honoring the workspace_id predicate (correct isolation)."""
    mock = MagicMock()

    def _query(sql: str, parameters: dict | None = None):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, col, None) for col in _METRIC_COLUMNS) for r in rows]
        result = MagicMock()
        result.result_rows = raw
        return result

    mock.query.side_effect = _query
    return mock


_VAR = VariableCostFacts(shipping_mu=300_000, packaging_mu=120_000, website_charges_mu=80_000)
# variable_costs_mu = 300000 + 120000 + 80000 = 500_000


# ---------------------------------------------------------------------------
# POSITIVE
# ---------------------------------------------------------------------------

class TestHonestCmLadder:
    def test_single_day_cm1_subtracts_variable_costs(self) -> None:
        q = PnlStatementQuery()
        s = q.execute(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            _VAR,
            RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        assert s.net_revenue_mu == 5_890_000
        assert s.cogs_mu == 2_232_000
        assert s.variable_costs_mu == 500_000
        # HONEST cm1 = net_revenue - cogs - variable_costs = 5890000 - 2232000 - 500000
        assert s.cm1_mu == 3_158_000
        # cm2 = cm1 - ad_spend = 3158000 - 1736000
        assert s.cm2_mu == 1_422_000
        # cm3 = cm2 - misc = 1422000 - 200000
        assert s.cm3_mu == 1_222_000
        assert s.currency_code == "INR"

    def test_cm1_is_NOT_cogs_only_regression_mutant(self) -> None:
        # KILLS the pre-slice-2 COGS-only cm1 bug. COGS-only would give
        # 5890000 - 2232000 = 3_658_000 (variable costs ignored). The honest
        # value is 500000 lower.
        q = PnlStatementQuery()
        s = q.execute(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            _VAR,
            RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        cogs_only_cm1 = s.net_revenue_mu - s.cogs_mu
        assert s.cm1_mu == cogs_only_cm1 - s.variable_costs_mu
        assert s.cm1_mu != cogs_only_cm1  # the bug is dead

    def test_multi_day_sums(self) -> None:
        q = PnlStatementQuery()
        rows = [_row(_WS_A, date(2026, 4, 1)), _row(_WS_A, date(2026, 4, 2))]
        s = q.execute(_WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=_client({_WS_A: rows}))
        assert s.net_revenue_mu == 11_780_000   # 2 days
        assert s.cogs_mu == 4_464_000
        # variable_costs is a single range total (not per-row), so still 500000
        assert s.variable_costs_mu == 500_000
        assert s.cm1_mu == 11_780_000 - 4_464_000 - 500_000  # 6_816_000

    def test_true_cm2_worked_example(self) -> None:
        # True-CM2 needs order_count > 0. total_orders is not a MetricRow column in
        # the mock, so we exercise the registry formula directly through the use-case
        # by patching order_count via a fact row that carries total_orders.
        # Simpler: call the registry-backed branch via a row whose getattr returns orders.
        from brain_metrics.registry.definitions import true_cm2_mu as TRUE_CM2
        # Worked example from the DDR (_ROW_TRUE_CM2):
        #   total_orders=120, rto_orders=18, ad_spend=5000000, variable_costs=1200000,
        #   cogs=3000000, cm2=8000000 -> cost_base=9200000 -> rto_provision=1380000
        #   -> true_cm2 = 6620000
        result = TRUE_CM2.formula_py(
            cm2_mu=8_000_000,
            rto_orders=18,
            total_ad_spend_mu=5_000_000,
            variable_costs_mu=1_200_000,
            cogs_mu=3_000_000,
            total_orders_count=120,
        )
        assert result == 6_620_000
        assert result < 8_000_000  # True-CM2 < CM2 always (RTO bites)

    def test_statement_lines_ordered_and_signed(self) -> None:
        q = PnlStatementQuery()
        lines = q.statement_lines(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            _VAR,
            RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        ids = [ln.definition_id for ln in lines]
        # order_count is 0 in the mock (total_orders not a column) → no true_cm2 line.
        assert ids == [
            "net_revenue_mu", "cogs_mu", "variable_costs_mu", "cm1_mu",
            "total_ad_spend_mu", "cm2_mu", "misc_expenses_prorated_mu", "cm3_mu",
        ]
        by_id = {ln.definition_id: ln for ln in lines}
        # cost lines are negative; subtotals positive (for this profitable seed).
        assert by_id["cogs_mu"].value_mu < 0
        assert by_id["variable_costs_mu"].value_mu < 0
        assert by_id["total_ad_spend_mu"].value_mu < 0
        assert by_id["cm1_mu"].is_subtotal is True
        assert by_id["cogs_mu"].is_subtotal is False


# ---------------------------------------------------------------------------
# NEGATIVE — fail-closed tenancy + cross-workspace isolation.
# ---------------------------------------------------------------------------

class TestTenancyFailClosed:
    def test_empty_workspace_raises(self) -> None:
        q = PnlStatementQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=_client({}))

    def test_whitespace_workspace_raises(self) -> None:
        q = PnlStatementQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("   ", _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=_client({}))

    def test_cross_workspace_isolation(self) -> None:
        q = PnlStatementQuery()
        rows_by_ws = {
            _WS_A: [_row(_WS_A, date(2026, 4, 1))],
            _WS_B: [_row(_WS_B, date(2026, 4, 1)), _row(_WS_B, date(2026, 4, 2))],
        }
        s = q.execute(
            _WS_A,
            DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1)),
            _VAR,
            RtoProvisionFacts(),
            _client=_client(rows_by_ws),
        )
        # ws_A has ONE day; if ws_B leaked, net_revenue would be 3x.
        assert s.net_revenue_mu == 5_890_000

    def test_context_less_returns_zero_ladder(self) -> None:
        q = PnlStatementQuery()
        s = q.execute(
            _WS_A, _DATE_RANGE, VariableCostFacts(), RtoProvisionFacts(),
            _client=_client({_WS_B: [_row(_WS_B, date(2026, 4, 1))]}),
        )
        assert s.net_revenue_mu == 0
        assert s.cm1_mu == 0
        assert s.cm2_mu == 0
