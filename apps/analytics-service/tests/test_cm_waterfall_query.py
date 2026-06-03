"""
test_cm_waterfall_query.py — CmWaterfallQuery use-case (Phase 2, slice 2 + Wave-1 parity).

@paradigm: sql
Wave-1 parity (2026-05-30): expanded from 8 to 16 steps to match legacy waterfall.ts.

Covers BOTH positive and negative scenarios:
  POSITIVE — 16-step ordered ladder; correct step ids + labels; cost steps negative;
             subtotal invariants at CM1/CM2/CM3/netProfit; gross-revenue sub-ladder correct;
             rto_cost step present; founder_salary step present; net_profit step present.
             Full step with ShippingRtoFacts. Backwards-compat: ShippingRtoFacts=None defaults.
  NEGATIVE — falsy workspace_id fails closed (inherited from PnlStatementQuery);
             cross-workspace isolation.

Mutation anchors:
  - "net_revenue_mu as top line" mutant: top step should be gross_sales_mu, not net_revenue_mu.
  - "rto_cost in cm1" mutant: step 9 is a separate rto_cost_mu deduction, not folded into CM1.
  - "no founder_salary" mutant: 15th step must be founder_salary_mu.
  - "net_profit wrong sign" mutant: netProfit = cm3 − founder_salary (founder_salary positive).
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock

import pytest

from src.application.contexts.pnl.cm_waterfall_query import CmWaterfallQuery
from src.application.contexts.pnl.pnl_statement_query import (
    RtoProvisionFacts,
    ShippingRtoFacts,
    VariableCostFacts,
)
from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
)


_WS_A = "00000000-0000-0000-0000-000000000001"
_WS_B = "00000000-0000-0000-0000-000000000002"
_DATE_RANGE = DateRange(start=date(2026, 4, 1), end=date(2026, 4, 1))

# Variable costs: shipping=300k, packaging=120k, website=80k → variable_costs=500k
_VAR = VariableCostFacts(shipping_mu=300_000, packaging_mu=120_000, website_charges_mu=80_000)

# Shiprocket + founder salary facts (Wave-1 parity)
_SHIP_RTO = ShippingRtoFacts(
    shipping_outbound_mu=150_000,   # Shiprocket forward+COD
    rto_cost_mu=80_000,             # Shiprocket RTO charges
    founder_salary_mu=200_000,      # prorated founder salary
)


def _row(workspace_id: str, date_val: date) -> MetricRow:
    """Synthetic MetricRow for the waterfall test.

    gross_sales_mu = 6_200_000
    discounts_mu   = 310_000
    returns_mu     = 50_000
    total_tax_mu   = 496_000
    net_revenue_mu = 5_890_000  (pre-existing: gross − discounts + shipping_revenue − tax)

    cogs_mu = 2_232_000
    variable_costs_mu (from _VAR) = 500_000
    total_ad_spend_mu = 1_736_000
    misc_expenses_prorated_mu = 200_000

    CM1 = net_revenue − cogs − variable_costs = 5_890_000 − 2_232_000 − 500_000 = 3_158_000
    CM2 = CM1 − ad_spend = 3_158_000 − 1_736_000 = 1_422_000
    CM3 = CM2 − misc = 1_422_000 − 200_000 = 1_222_000

    Gross revenue after deductions:
      = gross_sales − discounts − returns − tax − shipping_outbound
      = 6_200_000 − 310_000 − 50_000 − 496_000 − 150_000 = 5_194_000
    """
    return MetricRow(
        workspace_id=workspace_id, date=date_val,
        gross_sales_mu=6_200_000,
        returns_mu=50_000,
        discounts_mu=310_000,
        net_sales_mu=5_890_000,
        total_tax_mu=496_000,
        net_net_tax_mu=5_394_000,
        shipping_revenue_mu=496_000,
        net_revenue_mu=5_890_000,
        cogs_mu=2_232_000,
        total_ad_spend_mu=1_736_000,
        cm1_mu=0, cm2_mu=0, misc_expenses_prorated_mu=200_000, cm3_mu=0, total_orders=0,
        rto_rate_bp=1800, prepaid_rate_bp=4100, conversion_rate_bp=230,
        aov_mu=None, acos_bp=None, blended_roas_x100=None,
    )


def _client(rows_by_ws: dict[str, list[MetricRow]]) -> MagicMock:
    mock = MagicMock()

    def _query(sql: str, parameters: dict | None = None, **_kwargs):
        ws = (parameters or {}).get("workspace_id", "")
        rows = rows_by_ws.get(ws, [])
        raw = [tuple(getattr(r, col, None) for col in _METRIC_COLUMNS) for r in rows]
        result = MagicMock()
        result.result_rows = raw
        return result

    mock.query.side_effect = _query
    return mock


def _steps(shipping_rto: ShippingRtoFacts | None = None) -> list:
    q = CmWaterfallQuery()
    return q.execute(
        _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(),
        shipping_rto,
        _client=_client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]}),
    )


# ---------------------------------------------------------------------------
# POSITIVE: full 16-step ladder
# ---------------------------------------------------------------------------

class TestWaterfallSteps16:
    """Wave-1 parity: full 16-step ladder matching legacy waterfall.ts."""

    def test_step_count_is_16(self) -> None:
        steps = _steps(_SHIP_RTO)
        assert len(steps) == 16, f"Expected 16 steps, got {len(steps)}: {[s.definition_id for s in steps]}"

    def test_step_ids_ordered(self) -> None:
        """Exact ordered ladder ids matching legacy waterfall.ts step sequence."""
        steps = _steps(_SHIP_RTO)
        ids = [s.definition_id for s in steps]
        assert ids == [
            "gross_sales_mu",
            "total_discount_mu",
            "returns_mu",
            "total_tax_mu",
            "shipping_outbound_mu",
            "gross_revenue_after_deductions_mu",
            "cogs_mu",
            "variable_costs_mu",
            "rto_cost_mu",
            "cm1_mu",
            "total_ad_spend_mu",
            "cm2_mu",
            "misc_expenses_prorated_mu",
            "cm3_mu",
            "founder_salary_mu",
            "net_profit_mu",
        ], f"Ladder ids mismatch: {ids}"

    def test_top_line_is_gross_sales_not_net_revenue(self) -> None:
        """P0: top line MUST be gross_sales_mu. 'net_revenue_mu as top line' mutant killed."""
        steps = _steps(_SHIP_RTO)
        assert steps[0].definition_id == "gross_sales_mu"
        assert steps[0].value_mu == 6_200_000
        # Mutant check: net_revenue_mu is a different (lower) value
        assert steps[0].value_mu != 5_890_000, "top line must not be net_revenue_mu"

    def test_cost_steps_are_negative(self) -> None:
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        assert by_id["total_discount_mu"].value_mu == -310_000
        assert by_id["returns_mu"].value_mu == -50_000
        assert by_id["total_tax_mu"].value_mu == -496_000
        assert by_id["shipping_outbound_mu"].value_mu == -150_000
        assert by_id["cogs_mu"].value_mu == -2_232_000
        assert by_id["variable_costs_mu"].value_mu == -500_000
        assert by_id["rto_cost_mu"].value_mu == -80_000
        assert by_id["total_ad_spend_mu"].value_mu == -1_736_000
        assert by_id["misc_expenses_prorated_mu"].value_mu == -200_000
        assert by_id["founder_salary_mu"].value_mu == -200_000

    def test_gross_revenue_after_deductions_subtotal(self) -> None:
        """Step 6 subtotal: grossSales − discounts − returns − tax − shipping_outbound."""
        # 6_200_000 − 310_000 − 50_000 − 496_000 − 150_000 = 5_194_000
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        expected = 6_200_000 - 310_000 - 50_000 - 496_000 - 150_000
        assert expected == 5_194_000
        assert by_id["gross_revenue_after_deductions_mu"].value_mu == expected
        assert by_id["gross_revenue_after_deductions_mu"].cumulative_mu == expected

    def test_rto_cost_is_separate_step_not_folded_into_cm1(self) -> None:
        """P1/CM1 shape: rto_cost_mu is step 9, NOT folded into CM1.
        Mutant: 'rto in cm1' would remove rto_cost_mu from step list.
        """
        steps = _steps(_SHIP_RTO)
        ids = [s.definition_id for s in steps]
        assert "rto_cost_mu" in ids, "rto_cost_mu must be a separate waterfall step"
        # rto_cost must appear BEFORE cm1
        assert ids.index("rto_cost_mu") < ids.index("cm1_mu")

    def test_cm1_subtotal_invariant(self) -> None:
        """CM1 = net_revenue − cogs − variable_costs (Brain-canonical, DDR _ROW_CM1).
        5_890_000 − 2_232_000 − 500_000 = 3_158_000
        """
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cm1_mu"].value_mu == 3_158_000
        assert by_id["cm1_mu"].cumulative_mu == 3_158_000

    def test_cm2_subtotal_invariant(self) -> None:
        """CM2 = CM1 − ad_spend = 3_158_000 − 1_736_000 = 1_422_000."""
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cm2_mu"].value_mu == 1_422_000
        assert by_id["cm2_mu"].cumulative_mu == 1_422_000

    def test_cm3_subtotal_invariant(self) -> None:
        """CM3 = CM2 − fixed_overheads = 1_422_000 − 200_000 = 1_222_000."""
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cm3_mu"].value_mu == 1_222_000
        assert by_id["cm3_mu"].cumulative_mu == 1_222_000

    def test_founder_salary_step_present(self) -> None:
        """P1: founder_salary_mu step must be present (step 15).
        Mutant: 'no founder_salary' would omit step 15.
        """
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        assert "founder_salary_mu" in by_id
        assert by_id["founder_salary_mu"].value_mu == -200_000

    def test_net_profit_subtotal(self) -> None:
        """Net Profit = CM3 − founder_salary = 1_222_000 − 200_000 = 1_022_000.
        Mutant: 'net_profit wrong sign' would add founder_salary instead of subtract.
        """
        steps = _steps(_SHIP_RTO)
        by_id = {s.definition_id: s for s in steps}
        expected = 1_222_000 - 200_000  # = 1_022_000
        assert by_id["net_profit_mu"].value_mu == expected
        assert by_id["net_profit_mu"].cumulative_mu == expected
        # Mutant: adding founder_salary gives 1_422_000 — killed
        assert by_id["net_profit_mu"].value_mu != 1_422_000


# ---------------------------------------------------------------------------
# POSITIVE: backwards compatibility — ShippingRtoFacts=None defaults to zeros
# ---------------------------------------------------------------------------

class TestWaterfallBackwardsCompat:
    def test_none_shipping_rto_defaults_to_zero_steps(self) -> None:
        """ShippingRtoFacts=None must not crash; shipping/rto/founder steps default to 0."""
        steps = _steps(None)
        assert len(steps) == 16
        by_id = {s.definition_id: s for s in steps}
        assert by_id["shipping_outbound_mu"].value_mu == 0
        assert by_id["rto_cost_mu"].value_mu == 0
        assert by_id["founder_salary_mu"].value_mu == 0
        assert by_id["net_profit_mu"].value_mu == by_id["cm3_mu"].value_mu

    def test_existing_8_step_ids_still_present(self) -> None:
        """The original 8 step ids must still appear in the expanded 16-step ladder."""
        steps = _steps(_SHIP_RTO)
        ids = {s.definition_id for s in steps}
        for expected_id in [
            "cogs_mu", "variable_costs_mu", "cm1_mu",
            "total_ad_spend_mu", "cm2_mu", "misc_expenses_prorated_mu", "cm3_mu",
        ]:
            assert expected_id in ids, f"Original step {expected_id!r} missing from 16-step ladder"


# ---------------------------------------------------------------------------
# POSITIVE: single source of truth matches PnlStatementQuery
# ---------------------------------------------------------------------------

class TestSingleSourceOfTruth:
    def test_cm_subtotals_match_statement(self) -> None:
        from src.application.contexts.pnl.pnl_statement_query import PnlStatementQuery
        client = _client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]})
        stmt = PnlStatementQuery().execute(_WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _client=client)
        client2 = _client({_WS_A: [_row(_WS_A, date(2026, 4, 1))]})
        steps = CmWaterfallQuery().execute(
            _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _SHIP_RTO, _client=client2
        )
        by_id = {s.definition_id: s for s in steps}
        assert by_id["cm1_mu"].value_mu == stmt.cm1_mu
        assert by_id["cm2_mu"].value_mu == stmt.cm2_mu
        assert by_id["cm3_mu"].value_mu == stmt.cm3_mu
        assert by_id["gross_sales_mu"].value_mu == stmt.gross_sales_mu


# ---------------------------------------------------------------------------
# NEGATIVE: tenancy fail-closed + isolation
# ---------------------------------------------------------------------------

class TestTenancyFailClosed:
    def test_empty_workspace_raises(self) -> None:
        q = CmWaterfallQuery()
        with pytest.raises(UnscopedQueryError):
            q.execute("", _DATE_RANGE, _VAR, RtoProvisionFacts(), _SHIP_RTO, _client=_client({}))

    def test_cross_workspace_isolation(self) -> None:
        q = CmWaterfallQuery()
        rows_by_ws = {
            _WS_A: [_row(_WS_A, date(2026, 4, 1))],
            _WS_B: [_row(_WS_B, date(2026, 4, 1)), _row(_WS_B, date(2026, 4, 2))],
        }
        steps = q.execute(
            _WS_A, _DATE_RANGE, _VAR, RtoProvisionFacts(), _SHIP_RTO,
            _client=_client(rows_by_ws),
        )
        by_id = {s.definition_id: s for s in steps}
        # ws_A has ONE day; ws_B leakage would 3x gross_sales.
        assert by_id["gross_sales_mu"].value_mu == 6_200_000
