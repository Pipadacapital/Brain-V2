"""
cm_waterfall_query.py — CmWaterfallQuery use-case (Phase 2, slice 2).

@paradigm: sql (deterministic integer aggregation over structured facts; zero LLM/ML)

Builds the signed, cumulative CM waterfall steps (the Visx chart contract) for ONE
workspace + date range, from the honest P&L statement. ONE source of truth: this
use-case wraps PnlStatementQuery — it does NOT re-derive the ladder a second way
(Single-Primitive Rule). The api-gateway's metrics.pnlWaterfall + pnl.cmWaterfall both
read THIS use-case; there is no second CM-waterfall computation path.

Step contract (mirrors the existing web cm-waterfall-chart.tsx):
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
    """Assemble the signed, cumulative CM waterfall for one workspace + date range."""

    def __init__(self, statement_query: PnlStatementQuery | None = None) -> None:
        # ONE source of truth: reuse the P&L statement use-case (no second ladder math).
        self._statement_query = statement_query or PnlStatementQuery()

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        variable_costs: VariableCostFacts,
        rto: RtoProvisionFacts,
        *,
        _client: object | None = None,
    ) -> list[WaterfallStep]:
        """Return the ordered, signed, cumulative waterfall steps.

        Raises:
            UnscopedQueryError: if workspace_id is falsy (fail-closed; from the statement use-case).
        """
        s = self._statement_query.execute(
            workspace_id, date_range, variable_costs, rto, _client=_client
        )
        cc = s.currency_code

        steps: list[WaterfallStep] = []
        # Net Revenue is the head; its cumulative IS net revenue.
        steps.append(WaterfallStep("net_revenue_mu", "Net Revenue", s.net_revenue_mu, s.net_revenue_mu, cc))
        # COGS deduction.
        running = s.net_revenue_mu - s.cogs_mu
        steps.append(WaterfallStep("cogs_mu", "COGS", -s.cogs_mu, running, cc))
        # Variable costs deduction (the slice-2 honest line).
        running = running - s.variable_costs_mu
        steps.append(WaterfallStep("variable_costs_mu", "Variable Costs", -s.variable_costs_mu, running, cc))
        # CM1 subtotal — cumulative MUST equal cm1 (invariant the tests assert).
        steps.append(WaterfallStep("cm1_mu", "CM1 (Gross Contribution)", s.cm1_mu, s.cm1_mu, cc))
        # Ad spend deduction.
        running = s.cm1_mu - s.total_ad_spend_mu
        steps.append(WaterfallStep("total_ad_spend_mu", "Ad Spend", -s.total_ad_spend_mu, running, cc))
        # CM2 subtotal.
        steps.append(WaterfallStep("cm2_mu", "CM2 (After Ads)", s.cm2_mu, s.cm2_mu, cc))
        # Fixed overheads deduction.
        running = s.cm2_mu - s.misc_expenses_prorated_mu
        steps.append(WaterfallStep("misc_expenses_prorated_mu", "Fixed Overheads (Prorated)",
                                   -s.misc_expenses_prorated_mu, running, cc))
        # CM3 subtotal.
        steps.append(WaterfallStep("cm3_mu", "CM3 (After Overheads)", s.cm3_mu, s.cm3_mu, cc))
        return steps
