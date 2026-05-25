"""cost_stack_query.py — CostStackQuery use-case (Phase 2, slice 7).

@paradigm: sql (deterministic integer cost resolution; zero LLM/ML)

The cost stack the operator sees on /costs: the COGS settings (override/fallback/markup %)
and the active workspace cost rows (fixed / per-order / percent), plus how the resolved COGS
lands in the CM ladder — ported Brain-native from legacy routes/workspaces/{costs,cogs-settings}
+ lib/cogs/resolve.ts onto the slice-1..6 foundation.

LEGACY GROUND TRUTH (lib/cogs/resolve.ts — Rohan Stage-1 Finding 4):
  resolveLineItemCogs precedence (per line, revenue = price*qty):
    override_pct > 0   → base = revenue * override/100
    else product coq>0 → base = coq * qty
    else fallback_pct>0→ base = revenue * fallback/100
    else               → base = 0
    then markup_pct>0  → base * (1 + markup/100)
  This is the SAME COGS slice-2's cm1/cm2/cm3 already consume — this use-case READS/echoes
  the resolved stack; it does NOT fork a second COGS compute (Single source of truth).

This slice ships the READ view (resolved stack); the cost-row EDIT/CRUD defers (per Rohan
Stage-1 scope decision). Money in BIGINT minor units; percents in basis points (×100 of
legacy percent) for integer-exact arithmetic.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ...infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

VALID_COST_KINDS = ("fixed_monthly", "per_order", "percent")


@dataclass(frozen=True)
class CogsSettingsFact:
    """COGS resolution settings (basis points = legacy percent × 100; integer-exact)."""

    override_all_bp: int = 0   # 0 = off. e.g. 3500 = 35.00%
    fallback_bp: int = 0
    markup_bp: int = 0


@dataclass(frozen=True)
class CostRowFact:
    """One active workspace cost line (BIGINT minor units, or bp for percent kind)."""

    cost_type: str             # e.g. SHIPPING, PACKAGING, CUSTOM
    name: str
    kind: str                  # fixed_monthly | per_order | percent
    amount_mu: int             # minor units for fixed/per_order; ignored for percent
    amount_bp: int             # basis points for percent kind; ignored otherwise
    effective_from: str        # ISO yyyy-mm-dd
    currency_code: str


@dataclass(frozen=True)
class CostStackFacts:
    """Per-workspace cost configuration + the resolved-COGS / CM landing aggregates."""

    cogs_settings: CogsSettingsFact = CogsSettingsFact()
    cost_rows: tuple[CostRowFact, ...] = field(default_factory=tuple)
    # CM landing (from the EXISTING slice-2 CM path — read, not recomputed here).
    net_sales_mu: int = 0
    resolved_cogs_mu: int = 0
    variable_costs_mu: int = 0
    cm1_mu: int = 0
    currency_code: str = "INR"


@dataclass(frozen=True)
class CostStackRow:
    cost_type: str
    name: str
    kind: str
    amount_mu: int
    amount_bp: int
    effective_from: str
    currency_code: str


@dataclass(frozen=True)
class CostStackResult:
    workspace_id: str
    # COGS settings echo.
    override_all_bp: int
    fallback_bp: int
    markup_bp: int
    cogs_mode: str             # 'override' | 'product+fallback' (the resolution mode in effect)
    # Active cost rows.
    cost_rows: tuple[CostStackRow, ...]
    total_fixed_monthly_mu: int
    total_per_order_mu: int
    # CM landing (proves the stack flows into the EXISTING CM path).
    net_sales_mu: int
    resolved_cogs_mu: int
    variable_costs_mu: int
    cm1_mu: int
    currency_code: str


class CostStackQuery:
    """Assemble the resolved cost stack the operator sees on /costs."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: CostStackFacts,
        *,
        _client: object | None = None,
    ) -> CostStackResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "CostStackQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke). cm1_mu is the CM landing
        # the resolved COGS feeds — the SAME def slice-2 uses (one source of truth).
        query_metrics(workspace_id, "cm1_mu", date_range, _client=_client)

        s = facts.cogs_settings
        cogs_mode = "override" if s.override_all_bp > 0 else "product+fallback"

        rows: list[CostStackRow] = []
        total_fixed = 0
        total_per_order = 0
        for c in facts.cost_rows:
            kind = c.kind if c.kind in VALID_COST_KINDS else "fixed_monthly"
            if kind == "fixed_monthly":
                total_fixed += c.amount_mu
            elif kind == "per_order":
                total_per_order += c.amount_mu
            rows.append(
                CostStackRow(
                    cost_type=c.cost_type,
                    name=c.name,
                    kind=kind,
                    amount_mu=c.amount_mu,
                    amount_bp=c.amount_bp,
                    effective_from=c.effective_from,
                    currency_code=c.currency_code,
                )
            )

        # Stable order: cost_type asc, then name.
        rows.sort(key=lambda r: (r.cost_type, r.name))

        return CostStackResult(
            workspace_id=workspace_id,
            override_all_bp=s.override_all_bp,
            fallback_bp=s.fallback_bp,
            markup_bp=s.markup_bp,
            cogs_mode=cogs_mode,
            cost_rows=tuple(rows),
            total_fixed_monthly_mu=total_fixed,
            total_per_order_mu=total_per_order,
            net_sales_mu=facts.net_sales_mu,
            resolved_cogs_mu=facts.resolved_cogs_mu,
            variable_costs_mu=facts.variable_costs_mu,
            cm1_mu=facts.cm1_mu,
            currency_code=facts.currency_code,
        )
