"""
test_cm_waterfall_query.py — CmWaterfallQuery use-case (Phase 2, slice 2).

@paradigm: sql
Covers BOTH positive and negative scenarios:
  POSITIVE — ordered signed steps; cost steps negative; the CM-subtotal invariant
             (cumulative at cm1/cm2/cm3 equals the subtotal); variable-costs step present.
  NEGATIVE — falsy workspace_id fails closed (inherited from PnlStatementQuery);
             cross-workspace isolation.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.pnl.cm_waterfall_query import CmWaterfallQuery
from src.application.pnl.pnl_statement_query import RtoProvisionFacts, VariableCostFacts
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)


_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"
_DATE_RANGE = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1))
_VAR = VariableCostFacts(shipping_mu=300_000, packaging_mu=120_000, website_charges_mu=80_000)


def _row(workspace_id: str, date_val: date) -> MetricRow:
    return MetricRow(
        workspace_id=workspace_id, date=date_val,
        gross_sales_mu=6_200_000, returns_mu=0, discounts_mu=310_000,
        net_sales_mu=5_890_000, total_tax_mu=496_000, net_net_tax_mu=5_394_000,
        shipping_revenue_mu=496_000, net_revenue_mu=5_890_000,
        cogs_mu=2_232_000, total_ad_spend_mu=1_736_000,
        cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=200_000, cm3_mu=0,
        rto_rate_bp=1800, prepaid_rate_bp=4100, conversion_rate_bp=230,
        aov_mu=None, acos_bp=None, blended_roas_x100=None,
    )


def _client(rows_by_ws: dict[str, list[MetricRow]]) -> MagicMock:
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


# ---------------------------------------------------------------------------
# POSITIVE
# ---------------------------------------------------------------------------

class TestWaterfallSteps:
    def test_steps_ordered_and_variable_costs_present(self) -> None:
        q = CmWaterfallQuery()
        steps = q.execute(
            _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        ids = [s.definition_id for s in steps]
        assert ids == [
            "net_revenue_mu", "cogs_mu", "variable_costs_mu", "cm1_mu",
            "total_ad_spend_mu", "cm2_mu", "misc_expenses_prorated_mu", "cm3_mu",
        ]
        # the slice-2 honest line is present
        assert "variable_costs_mu" in ids

    def test_cost_steps_negative_subtotals_positive(self) -> None:
        q = CmWaterfallQuery()
        steps = q.execute(
            _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cogs_mu"].value_mu == -2_232_000
        assert by_id["variable_costs_mu"].value_mu == -500_000
        assert by_id["total_ad_spend_mu"].value_mu == -1_736_000
        assert by_id["misc_expenses_prorated_mu"].value_mu == -200_000
        assert by_id["net_revenue_mu"].value_mu == 5_890_000

    def test_cumulative_invariant_at_subtotals(self) -> None:
        # The cumulative at each CM subtotal MUST equal that subtotal's value.
        q = CmWaterfallQuery()
        steps = q.execute(
            _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(),
            _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
        )
        by_id = {s.definition_id: s for s in steps}
        # cm1 = 5890000 - 2232000 - 500000 = 3158000
        assert by_id["cm1_mu"].value_mu == 3_158_000
        assert by_id["cm1_mu"].cumulative_mu == 3_158_000
        # running cumulative after variable_costs step must also equal cm1
        assert by_id["variable_costs_mu"].cumulative_mu == 3_158_000
        # cm2 = 3158000 - 1736000 = 1422000
        assert by_id["cm2_mu"].value_mu == 1_422_000
        assert by_id["cm2_mu"].cumulative_mu == 1_422_000
        # cm3 = 1422000 - 200000 = 1222000
        assert by_id["cm3_mu"].value_mu == 1_222_000

    def test_single_source_of_truth_matches_statement(self) -> None:
        # CmWaterfallQuery wraps PnlStatementQuery — values MUST match the statement.
        from src.application.pnl.pnl_statement_query import PnlStatementQuery
        client = _client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]})
        stmt = PnlStatementQuery().execute(_WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=client)
        client2 = _client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]})
        steps = CmWaterfallQuery().execute(_WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=client2)
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cm1_mu"].value_mu == stmt.cm1_mu
        assert by_id["cm2_mu"].value_mu == stmt.cm2_mu
        assert by_id["cm3_mu"].value_mu == stmt.cm3_mu


# ---------------------------------------------------------------------------
# NEGATIVE
# ---------------------------------------------------------------------------

class TestTenancyFailClosed:
    def test_empty_workspace_raises(self) -> None:
        q = CmWaterfallQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=_client({}))

    def test_cross_workspace_isolation(self) -> None:
        q = CmWaterfallQuery()
        rows_by_ws = {
            _WS_A: [_row(_WS_A, date(2026, 4, 1))],
            _WS_B: [_row(_WS_B, date(2026, 4, 1)), _row(_WS_B, date(2026, 4, 2))],
        }
        steps = q.execute(_WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=_client(rows_by_ws))
        by_id = {s.definition_id: s for s in steps}
        # ws_A has ONE day; ws_B leakage would 3x net_revenue.
        assert by_id["net_revenue_mu"].value_mu == 5_890_000
