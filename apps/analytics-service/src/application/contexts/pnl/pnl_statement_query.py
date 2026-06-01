"""
pnl_statement_query.py — PnlStatementQuery use-case (Phase 2, slice 2).

@paradigm: sql (deterministic integer aggregation over structured facts; zero LLM/ML)

The honest P&L ladder for ONE workspace over a date range, built on slice-1's
foundation. Reads workspace-scoped facts through the ClickHouse query gateway and
assembles the contribution-margin ladder with the canonical metric-registry formulas
(brain_metrics.registry) — NO ad-hoc arithmetic, NO float, money in BIGINT paise.

Honest CM ladder (Phase-2 slice-2, the central correctness point):
    net_revenue_mu
      - cogs_mu
      - variable_costs_mu          (shipping + packaging + website charges)
      = cm1_mu                     (= net_revenue - cogs - variable_costs)  <-- honest
      - total_ad_spend_mu
      = cm2_mu
      - misc_expenses_prorated_mu
      = cm3_mu
    true_cm2_mu = cm2_mu - RTO provision (Brain-native, RTO-honest CM2)

The pre-slice-2 TS registry computed cm1_mu = net_revenue - cogs (COGS-only), silently
diverging from Python and from legacy compute-daily.ts:187. Slice-2 corrected the TS
registry; this use-case re-derives the ladder from the (now byte-identical) registry
formulas so the /pnl page math is registry-traced and consistent across languages.

TENANCY:
  Every read goes through query_gateway.query_metrics(workspace_id, ...). workspace_id is
  the first positional, non-optional parameter — a falsy workspace_id raises
  UnscopedQueryError (fail-closed). This use-case NEVER opens a second DB path.

Variable costs + RTO provisioning inputs:
  variable_costs (shipping/packaging/website) and the RTO order count are NOT yet columns
  on the gateway's MetricRow — they arrive live at the held Child-3 connector cutover.
  Like slice-1's ReversalFacts, they are accepted as EXPLICIT, workspace-scoped inputs
  rather than hidden defaults — keeping CM1 and True-CM2 honest. RTO is applied at CM2
  (true_cm2_mu), NEVER folded into CM1 (that would double-count).
"""

from __future__ import annotations

from dataclasses import dataclass

from brain_metrics.registry.definitions import (
    variable_costs_mu as _VARIABLE_COSTS_DEF,
    cm1_mu as _CM1_DEF,
    cm2_mu as _CM2_DEF,
    cm3_mu as _CM3_DEF,
    true_cm2_mu as _TRUE_CM2_DEF,
)

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    query_metrics,
)


# ---------------------------------------------------------------------------
# Explicit, workspace-scoped inputs (no hidden defaults — honesty constraint).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VariableCostFacts:
    """Per-workspace variable-cost components (paise) for the date range.

    shipping + packaging + website charges = variable_costs_mu. These feed CM1.
    """

    shipping_mu: int = 0
    packaging_mu: int = 0
    website_charges_mu: int = 0


@dataclass(frozen=True)
class RtoProvisionFacts:
    """Per-workspace RTO provisioning inputs (paise / counts) for True-CM2.

    RTO provision = intDiv(rto_orders * (ad_spend + variable_costs + cogs), total_orders).
    Applied at CM2 (true_cm2_mu) — NEVER folded into CM1.
    """

    rto_orders: int = 0


@dataclass(frozen=True)
class ShippingRtoFacts:
    """Per-workspace Shiprocket-sourced cost facts for the waterfall (Wave-1 parity).

    shipping_outbound_mu = forward_charges_mu + cod_charges_mu (from Shiprocket).
    rto_cost_mu = Shiprocket RTO charges for the period.
    founder_salary_mu = prorated founder monthly salary for the period (workspace setting).
    These are NOT in the ClickHouse daily MV — they come from Shiprocket + workspace settings.
    """

    shipping_outbound_mu: int = 0   # forward + COD charges (cost side, NOT revenue)
    rto_cost_mu: int = 0            # Shiprocket RTO charges
    founder_salary_mu: int = 0      # prorated founder salary for the period


# ---------------------------------------------------------------------------
# Value objects — frozen, integer-only.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PnlLine:
    """One line of the P&L statement. value_mu is BIGINT minor units (paise).

    is_subtotal marks the CM rungs (cm1/cm2/cm3/true_cm2) vs the deduction lines.
    """

    definition_id: str
    label: str
    value_mu: int
    is_subtotal: bool


@dataclass(frozen=True)
class PnlStatement:
    """Honest P&L statement over a date range. All _mu are integer paise.

    Wave-1 parity (2026-05-30): gross-revenue ladder fields added so the
    CmWaterfallQuery can produce the full 16-step legacy-matching ladder.
    """

    workspace_id: str
    # Gross revenue ladder (Wave-1 parity — from MetricRow aggregates)
    gross_sales_mu: int
    returns_mu: int
    total_discount_mu: int
    total_tax_mu: int
    # CM ladder (existing)
    net_revenue_mu: int
    cogs_mu: int
    variable_costs_mu: int
    cm1_mu: int
    total_ad_spend_mu: int
    cm2_mu: int
    misc_expenses_prorated_mu: int
    cm3_mu: int
    true_cm2_mu: int | None
    order_count: int
    currency_code: str


class PnlStatementQuery:
    """Assemble the honest P&L contribution-margin ladder for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        variable_costs: VariableCostFacts,
        rto: RtoProvisionFacts,
        *,
        _client: object | None = None,
    ) -> PnlStatement:
        """Read workspace-scoped facts and assemble the honest CM ladder.

        Args:
            workspace_id: authenticated workspace scope. MUST be non-empty
                (sourced from the JWT claim). A falsy value fails closed.
            date_range: inclusive date range.
            variable_costs: per-workspace shipping/packaging/website (paise) for the range.
            rto: per-workspace RTO order count for the True-CM2 provision.
            _client: test-injection ClickHouse client (NEVER use in production).

        Returns:
            PnlStatement with the full CM ladder in integer paise.
            Wave-1 parity: also carries gross-revenue ladder aggregates
            (gross_sales_mu, returns_mu, total_discount_mu, total_tax_mu) so the
            CmWaterfallQuery can produce the full 16-step legacy-matching ladder.

        Raises:
            UnscopedQueryError: if workspace_id is falsy (fail-closed tenancy).
        """
        # Fail-closed tenancy: re-assert before any read (defense in depth; the
        # gateway also enforces this). NEVER default to all-workspaces.
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "PnlStatementQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        rows: list[MetricRow] = query_metrics(
            workspace_id,
            "cm2_mu",  # primary definition for observability/logging
            date_range,
            _client=_client,
        )

        # Aggregate the cost-ladder inputs over the range with integer SUM (no float).
        # Wave-1 parity: also aggregate gross-revenue ladder fields from MetricRow.
        gross_sales_mu = sum(r.gross_sales_mu for r in rows)
        returns_mu = sum(r.returns_mu for r in rows)
        total_discount_mu = sum(r.discounts_mu for r in rows)  # MetricRow.discounts_mu = total_discount_mu
        total_tax_mu = sum(r.total_tax_mu for r in rows)
        net_revenue_mu = sum(r.net_revenue_mu for r in rows)
        cogs_mu = sum(r.cogs_mu for r in rows)
        total_ad_spend_mu = sum(r.total_ad_spend_mu for r in rows)
        misc_expenses_prorated_mu = sum(
            (r.misc_expenses_prorated_mu or 0) for r in rows
        )
        order_count = sum(getattr(r, "total_orders", 0) or 0 for r in rows)
        currency_code = _resolve_currency(rows)

        # variable_costs_mu via the registry formula (shipping + packaging + website).
        variable_costs_total = _VARIABLE_COSTS_DEF.formula_py(
            variable_costs.shipping_mu,
            variable_costs.packaging_mu,
            variable_costs.website_charges_mu,
        )

        # Honest CM ladder — registry formulas only. cm1 SUBTRACTS variable costs
        # (the slice-2 correction). RTO is NOT in cm1.
        cm1 = _CM1_DEF.formula_py(net_revenue_mu, cogs_mu, variable_costs_total)
        cm2 = _CM2_DEF.formula_py(cm1, total_ad_spend_mu)
        cm3 = _CM3_DEF.formula_py(cm2, misc_expenses_prorated_mu)

        # True-CM2 = CM2 - RTO provision (Brain-native; applied at CM2, the honest place).
        # NULL when there are no orders (null-guard mirrors the registry formula).
        if order_count > 0:
            true_cm2 = _TRUE_CM2_DEF.formula_py(
                cm2,
                rto.rto_orders,
                total_ad_spend_mu,
                variable_costs_total,
                cogs_mu,
                order_count,
            )
        else:
            true_cm2 = None

        return PnlStatement(
            workspace_id=workspace_id,
            # Gross revenue ladder (Wave-1 parity)
            gross_sales_mu=gross_sales_mu,
            returns_mu=returns_mu,
            total_discount_mu=total_discount_mu,
            total_tax_mu=total_tax_mu,
            # CM ladder
            net_revenue_mu=net_revenue_mu,
            cogs_mu=cogs_mu,
            variable_costs_mu=variable_costs_total,
            cm1_mu=cm1,
            total_ad_spend_mu=total_ad_spend_mu,
            cm2_mu=cm2,
            misc_expenses_prorated_mu=misc_expenses_prorated_mu,
            cm3_mu=cm3,
            true_cm2_mu=true_cm2,
            order_count=order_count,
            currency_code=currency_code,
        )

    def statement_lines(
        self,
        workspace_id: str,
        date_range: DateRange,
        variable_costs: VariableCostFacts,
        rto: RtoProvisionFacts,
        *,
        _client: object | None = None,
    ) -> list[PnlLine]:
        """Return the ordered P&L statement lines for the /pnl table."""
        s = self.execute(workspace_id, date_range, variable_costs, rto, _client=_client)
        lines = [
            PnlLine("net_revenue_mu", "Net Revenue", s.net_revenue_mu, True),
            PnlLine("cogs_mu", "COGS", -s.cogs_mu, False),
            PnlLine("variable_costs_mu", "Variable Costs", -s.variable_costs_mu, False),
            PnlLine("cm1_mu", "CM1 (Gross Contribution)", s.cm1_mu, True),
            PnlLine("total_ad_spend_mu", "Ad Spend", -s.total_ad_spend_mu, False),
            PnlLine("cm2_mu", "CM2 (After Ads)", s.cm2_mu, True),
            PnlLine("misc_expenses_prorated_mu", "Fixed Overheads (Prorated)",
                    -s.misc_expenses_prorated_mu, False),
            PnlLine("cm3_mu", "CM3 (After Overheads)", s.cm3_mu, True),
        ]
        if s.true_cm2_mu is not None:
            lines.append(
                PnlLine("true_cm2_mu", "True CM2 (RTO-Honest)", s.true_cm2_mu, True)
            )
        return lines


def _resolve_currency(rows: list[MetricRow]) -> str:
    """Resolve the workspace currency from fact rows; default INR (India-first)."""
    for r in rows:
        code = getattr(r, "currency_code", None)
        if code:
            return code
    return "INR"
