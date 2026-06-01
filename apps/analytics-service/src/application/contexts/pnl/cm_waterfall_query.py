"""
cm_waterfall_query.py — CmWaterfallQuery use-case (Phase 2, slice 2).

@paradigm: sql (deterministic integer aggregation over structured facts; zero LLM/ML)

Builds the signed, cumulative CM waterfall steps (the Visx chart contract) for ONE
workspace + date range, from the honest P&L statement. ONE source of truth: this
use-case wraps PnlStatementQuery — it does NOT re-derive the ladder a second way
(Single-Primitive Rule). The api-gateway's metrics.pnlWaterfall + pnl.cmWaterfall both
read THIS use-case; there is no second CM-waterfall computation path.

Wave-1 parity (2026-05-30): expanded from 8 steps to 16 steps to match the legacy
waterfall.ts ladder exactly. The 16 steps in order are:

  1. gross_sales_mu             — Gross Sales (top line, revenue)
  2. total_discount_mu          — Discounts (cost)
  3. returns_mu                 — Refunds (cost)
  4. total_tax_mu               — Tax (cost)
  5. shipping_outbound_mu       — Shipping (forward+COD cost, from Shiprocket)
  6. gross_revenue_after_deductions_mu — Revenue After Tax & Shipping (subtotal)
  7. cogs_mu                    — COGS (cost)
  8. variable_costs_mu          — Variable Costs (shipping+packaging+website, cost)
  9. rto_cost_mu                — RTO Cost (Shiprocket RTO charges, cost)
 10. cm1_mu                     — CM1 (subtotal; Brain formula: net_revenue − cogs − varCosts)
 11. total_ad_spend_mu          — Ad Spend (cost)
 12. cm2_mu                     — CM2 (subtotal)
 13. misc_expenses_prorated_mu  — Fixed Overheads (cost)
 14. cm3_mu                     — CM3 (subtotal)
 15. founder_salary_mu          — Founder's Salary (cost, from workspace settings)
 16. net_profit_mu              — Net Profit (subtotal)

Definitional-Delta note (CM1): Brain's CM1 = net_revenue − cogs − variable_costs.
Legacy CM1 = revenueAfterTaxShipping − cogs − varCosts − rto. The difference is:
Brain nets shipping_revenue into the top (net_revenue includes shipping income), and
does NOT fold RTO into CM1 (RTO is a separate step + True-CM2 at CM2 level). The DDR
row _ROW_CM1 documents this as an EXPECTED_DEFINITIONAL_DELTA. The 16-step shape
matches legacy; the CM1 formula stays Brain-canonical per the DDR decision.

Step contract (mirrors legacy waterfall.ts / web cm-waterfall-chart.tsx):
  - revenue / subtotal steps carry positive value_mu;
  - cost deduction steps carry NEGATIVE value_mu;
  - cumulative_mu is the running total after applying each step.

Tenancy + honesty inherited from PnlStatementQuery (fail-closed workspace_id; cm1
subtracts variable costs; RTO applied at CM2 via true_cm2_mu, never folded into CM1).
"""

from __future__ import annotations

from dataclasses import dataclass

from ...infrastructure.clickhouse.query_gateway import DateRange
from .pnl_statement_query import (
    PnlStatementQuery,
    RtoProvisionFacts,
    ShippingRtoFacts,
    VariableCostFacts,
)


@dataclass(frozen=True)
class WaterfallStep:
    """One waterfall bar. value_mu signed (negative = cost); cumulative_mu running total."""

    definition_id: str
    label: str
    value_mu: int       # signed: negative for cost deductions
    cumulative_mu: int  # running total after this step
    currency_code: str


class CmWaterfallQuery:
    """Assemble the signed, cumulative 16-step CM waterfall for one workspace + date range."""

    def __init__(self, statement_query: PnlStatementQuery | None = None) -> None:
        # ONE source of truth: reuse the P&L statement use-case (no second ladder math).
        self._statement_query = statement_query or PnlStatementQuery()

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        variable_costs: VariableCostFacts,
        rto: RtoProvisionFacts,
        shipping_rto: ShippingRtoFacts | None = None,
        *,
        _client: object | None = None,
    ) -> list[WaterfallStep]:
        """Return the ordered, signed, cumulative waterfall steps (16 steps).

        Args:
            workspace_id: authenticated workspace scope (fail-closed).
            date_range: inclusive date range.
            variable_costs: per-workspace shipping/packaging/website costs for CM1.
            rto: RTO order count for True-CM2 provision (applied at CM2, not CM1).
            shipping_rto: Shiprocket-sourced cost facts for the waterfall deduction steps.
                          Defaults to zero values if not provided (backwards-compatible).
            _client: test-injection ClickHouse client.

        Returns:
            16 WaterfallStep objects in legacy-matching order.

        Raises:
            UnscopedQueryError: if workspace_id is falsy (fail-closed; from PnlStatementQuery).
        """
        if shipping_rto is None:
            shipping_rto = ShippingRtoFacts()

        s = self._statement_query.execute(
            workspace_id, date_range, variable_costs, rto, _client=_client
        )
        cc = s.currency_code

        steps: list[WaterfallStep] = []

        # ── Step 1: Gross Sales (top line) ──────────────────────────────────
        running = s.gross_sales_mu
        steps.append(WaterfallStep(
            "gross_sales_mu", "Gross Sales",
            s.gross_sales_mu, running, cc,
        ))

        # ── Step 2: Discounts (cost) ────────────────────────────────────────
        running -= s.total_discount_mu
        steps.append(WaterfallStep(
            "total_discount_mu", "Discounts",
            -s.total_discount_mu, running, cc,
        ))

        # ── Step 3: Refunds (cost) ──────────────────────────────────────────
        running -= s.returns_mu
        steps.append(WaterfallStep(
            "returns_mu", "Refunds",
            -s.returns_mu, running, cc,
        ))

        # ── Step 4: Tax (cost) ──────────────────────────────────────────────
        running -= s.total_tax_mu
        steps.append(WaterfallStep(
            "total_tax_mu", "Tax",
            -s.total_tax_mu, running, cc,
        ))

        # ── Step 5: Shipping outbound cost (forward + COD, from Shiprocket) ─
        running -= shipping_rto.shipping_outbound_mu
        steps.append(WaterfallStep(
            "shipping_outbound_mu", "Shipping",
            -shipping_rto.shipping_outbound_mu, running, cc,
        ))

        # ── Step 6: Revenue After Tax & Shipping (intermediate subtotal) ────
        # = gross_sales − discounts − refunds − tax − shipping_outbound
        gross_revenue_after_deductions = running  # matches the walk above
        steps.append(WaterfallStep(
            "gross_revenue_after_deductions_mu", "Revenue After Tax & Shipping",
            gross_revenue_after_deductions, gross_revenue_after_deductions, cc,
        ))

        # ── Step 7: COGS (cost) ─────────────────────────────────────────────
        running = gross_revenue_after_deductions - s.cogs_mu
        steps.append(WaterfallStep(
            "cogs_mu", "COGS",
            -s.cogs_mu, running, cc,
        ))

        # ── Step 8: Variable Costs (cost) ───────────────────────────────────
        running -= s.variable_costs_mu
        steps.append(WaterfallStep(
            "variable_costs_mu", "Variable Costs",
            -s.variable_costs_mu, running, cc,
        ))

        # ── Step 9: RTO Cost (cost, from Shiprocket) ────────────────────────
        running -= shipping_rto.rto_cost_mu
        steps.append(WaterfallStep(
            "rto_cost_mu", "RTO Cost",
            -shipping_rto.rto_cost_mu, running, cc,
        ))

        # ── Step 10: CM1 subtotal ───────────────────────────────────────────
        # Brain CM1 = net_revenue − cogs − variable_costs (DDR _ROW_CM1 delta).
        # The subtotal bar resets the running total to the Brain-canonical CM1 value.
        # This surfaces the DDR delta visually: the difference between running (which
        # includes the rto_cost deduction) and s.cm1_mu is the documented delta.
        steps.append(WaterfallStep(
            "cm1_mu", "CM1",
            s.cm1_mu, s.cm1_mu, cc,
        ))

        # ── Step 11: Ad Spend (cost) ────────────────────────────────────────
        running = s.cm1_mu - s.total_ad_spend_mu
        steps.append(WaterfallStep(
            "total_ad_spend_mu", "Ad Spend",
            -s.total_ad_spend_mu, running, cc,
        ))

        # ── Step 12: CM2 subtotal ───────────────────────────────────────────
        steps.append(WaterfallStep(
            "cm2_mu", "CM2",
            s.cm2_mu, s.cm2_mu, cc,
        ))

        # ── Step 13: Fixed Overheads (cost) ─────────────────────────────────
        running = s.cm2_mu - s.misc_expenses_prorated_mu
        steps.append(WaterfallStep(
            "misc_expenses_prorated_mu", "Fixed Cost",
            -s.misc_expenses_prorated_mu, running, cc,
        ))

        # ── Step 14: CM3 subtotal ───────────────────────────────────────────
        steps.append(WaterfallStep(
            "cm3_mu", "CM3",
            s.cm3_mu, s.cm3_mu, cc,
        ))

        # ── Step 15: Founder's Salary (cost) ────────────────────────────────
        running = s.cm3_mu - shipping_rto.founder_salary_mu
        steps.append(WaterfallStep(
            "founder_salary_mu", "Founder's Salary",
            -shipping_rto.founder_salary_mu, running, cc,
        ))

        # ── Step 16: Net Profit (final subtotal) ────────────────────────────
        net_profit = s.cm3_mu - shipping_rto.founder_salary_mu
        steps.append(WaterfallStep(
            "net_profit_mu", "Net Profit",
            net_profit, net_profit, cc,
        ))

        return steps
