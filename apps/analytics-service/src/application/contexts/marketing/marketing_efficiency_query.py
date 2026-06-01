"""marketing_efficiency_query.py — MarketingEfficiencyQuery use-case (Phase 2, slice 4).

@paradigm: sql (deterministic integer aggregation; zero LLM/ML)

MER / aMER / ACOS / blended-ROAS for ONE workspace over a date range, ported Brain-native
from legacy lib/metrics/marketing-efficiency.ts onto the slice-1/2/3 foundation.

LEGACY GROUND TRUTH (read, not slice-table shorthand):
  - MER  = store net revenue / total ad spend          (display: ×; mer_bp)
  - aMER = new-customer revenue / ACQUISITION-CLASSIFIED ad spend  (amer_bp)
           The denominator is the acquisition campaign-intent bucket ONLY — unclassified /
           brand / non_acquisition spend is EXCLUDED (conservative). This is the load-bearing
           legacy semantics (Rohan Stage-1 finding + persona Concern 1).
  - ACOS = total ad spend / store net revenue          (display_only; acos_bp)
  - blended ROAS = net revenue / total ad spend ×100   (display_only)

ROAS / ACOS are DISPLAY-ONLY — never a Brain decision metric (CM2-first).

HONEST-INPUT PATTERN: net revenue, total/acquisition ad spend, nc-revenue arrive as EXPLICIT
workspace-scoped inputs (frozen dataclass), exactly like slice-3 CodPrepaidFacts. They populate
live at the held Child-3 connector cutover. MER numerator == the /store net revenue for the same
range (cross-surface consistency; persona Concern 3). money in BIGINT paise.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass

from brain_metrics.registry.definitions import (
    mer_bp as _MER_DEF,
    amer_bp as _AMER_DEF,
    acos_bp as _ACOS_DEF,
    blended_roas_x100 as _ROAS_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


@dataclass(frozen=True)
class MarketingEfficiencyFacts:
    """Per-workspace marketing efficiency facts (paise) for the range.

    net_revenue_mu: the slice-1 /store net-revenue rung (MER numerator — cross-surface consistent).
    total_ad_spend_mu: ALL ad spend (Meta + Google) in the range — MER denominator.
    new_customer_revenue_mu: SUM per-NC-order (price − tax − refundShare), RTO→0 (aMER numerator).
    acquisition_ad_spend_mu: spend on acquisition-classified campaigns ONLY (aMER denominator).
    meta_spend_mu / google_spend_mu: the blended-vs-platform split (display).
    """

    net_revenue_mu: int = 0
    total_ad_spend_mu: int = 0
    new_customer_revenue_mu: int = 0
    acquisition_ad_spend_mu: int = 0
    meta_spend_mu: int = 0
    google_spend_mu: int = 0


@dataclass(frozen=True)
class MarketingEfficiencyResult:
    workspace_id: str
    net_revenue_mu: int
    total_ad_spend_mu: int
    new_customer_revenue_mu: int
    acquisition_ad_spend_mu: int
    meta_spend_mu: int
    google_spend_mu: int
    mer_bp: int | None
    amer_bp: int | None
    acos_bp: int | None            # display_only
    blended_roas_x100: int | None  # display_only
    currency_code: str


class MarketingEfficiencyQuery:
    """Assemble MER / aMER / ACOS / blended-ROAS for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: MarketingEfficiencyFacts,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> MarketingEfficiencyResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "MarketingEfficiencyQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "mer_bp", date_range, _client=_client)

        # MER = net_revenue / total_ad_spend (None when no spend).
        mer = (
            _MER_DEF.formula_py(facts.net_revenue_mu, facts.total_ad_spend_mu)
            if facts.total_ad_spend_mu > 0
            else None
        )
        # aMER = nc_revenue / ACQUISITION-classified spend (None when no acquisition spend).
        amer = (
            _AMER_DEF.formula_py(facts.new_customer_revenue_mu, facts.acquisition_ad_spend_mu)
            if facts.acquisition_ad_spend_mu > 0
            else None
        )
        # ACOS (display_only) = total_ad_spend / net_revenue.
        acos = (
            _ACOS_DEF.formula_py(facts.total_ad_spend_mu, facts.net_revenue_mu)
            if facts.net_revenue_mu > 0
            else None
        )
        # Blended ROAS ×100 (display_only) = net_revenue / total_ad_spend ×100.
        roas = (
            _ROAS_DEF.formula_py(facts.net_revenue_mu, facts.total_ad_spend_mu)
            if facts.total_ad_spend_mu > 0
            else None
        )

        return MarketingEfficiencyResult(
            workspace_id=workspace_id,
            net_revenue_mu=facts.net_revenue_mu,
            total_ad_spend_mu=facts.total_ad_spend_mu,
            new_customer_revenue_mu=facts.new_customer_revenue_mu,
            acquisition_ad_spend_mu=facts.acquisition_ad_spend_mu,
            meta_spend_mu=facts.meta_spend_mu,
            google_spend_mu=facts.google_spend_mu,
            mer_bp=mer,
            amer_bp=amer,
            acos_bp=acos,
            blended_roas_x100=roas,
            currency_code=currency_code,
        )
