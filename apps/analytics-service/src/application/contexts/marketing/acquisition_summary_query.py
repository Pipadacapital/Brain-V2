"""acquisition_summary_query.py — AcquisitionSummaryQuery use-case (Phase 2, slice 4).

@paradigm: sql (deterministic integer aggregation; zero LLM/ML)

The new-customer acquisition surface for ONE workspace over a date range, ported Brain-native
from legacy lib/acquisition/compute.ts onto the slice-1/2/3 foundation.

LEGACY GROUND TRUTH:
  - new customer = first order in the selected period.
  - NC CM2 (per order) = price − COGS − per-order(shipping+packaging+website+adSpend) − refundShare;
    RTO orders contribute 0. nc_cm2_mu is the SUM.
  - new_customer_revenue = price − tax − refundShare (RTO excluded). Per-order tax uses per-SKU GST
    (NEVER blended). new_customer_revenue_mu is the SUM.
  - blended CAC = total_ad_spend / new_customers.
  - cm2_per_nc = nc_cm2 / new_customers.
  - daily aMER = nc_revenue(day) / acquisition_ad_spend(day).
  - meta / google = the blended-vs-platform spend split.

HONEST-INPUT PATTERN: the connector use-case produces the per-NC-order aggregates with the
RTO/tax/refund exclusion ALREADY applied (it owns the per-order facts). This use-case assembles the
registry-traceable summary. money in BIGINT paise.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    cac_mu as _CAC_DEF,
    cm2_per_nc_mu as _CM2_PER_NC_DEF,
    amer_bp as _AMER_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


@dataclass(frozen=True)
class AcquisitionDailyFact:
    """One day of acquisition facts (paise / counts). RTO/tax/refund already applied upstream."""

    date: str
    new_customers_count: int = 0
    nc_cm2_mu: int = 0
    nc_revenue_mu: int = 0
    ad_spend_mu: int = 0
    acquisition_ad_spend_mu: int = 0
    meta_spend_mu: int = 0
    google_spend_mu: int = 0


@dataclass(frozen=True)
class AcquisitionFacts:
    """Per-workspace acquisition aggregates for the range (paise / counts)."""

    new_customers_count: int = 0
    nc_cm2_mu: int = 0
    new_customer_revenue_mu: int = 0
    total_ad_spend_mu: int = 0
    acquisition_ad_spend_mu: int = 0
    meta_spend_mu: int = 0
    google_spend_mu: int = 0
    daily: tuple[AcquisitionDailyFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class AcquisitionDailyRow:
    date: str
    new_customers: int
    nc_cm2_mu: int
    nc_revenue_mu: int
    ad_spend_mu: int
    acquisition_ad_spend_mu: int
    cac_mu: int | None
    cm2_per_nc_mu: int | None
    amer_bp: int | None
    meta_spend_mu: int
    google_spend_mu: int


@dataclass(frozen=True)
class AcquisitionSummaryResult:
    workspace_id: str
    new_customers_count: int
    nc_cm2_mu: int
    new_customer_revenue_mu: int
    total_ad_spend_mu: int
    acquisition_ad_spend_mu: int
    meta_spend_mu: int
    google_spend_mu: int
    cac_mu: int | None
    cm2_per_nc_mu: int | None
    amer_bp: int | None
    daily: tuple[AcquisitionDailyRow, ...]
    currency_code: str


class AcquisitionSummaryQuery:
    """Assemble the new-customer acquisition summary for one workspace + range."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: AcquisitionFacts,
        *,
        currency_code: str = "INR",
        _client: object | None = None,
    ) -> AcquisitionSummaryResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "AcquisitionSummaryQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "cac_mu", date_range, _client=_client)

        cac = (
            _CAC_DEF.formula_py(facts.total_ad_spend_mu, facts.new_customers_count)
            if facts.new_customers_count > 0
            else None
        )
        cm2_per_nc = (
            _CM2_PER_NC_DEF.formula_py(facts.nc_cm2_mu, facts.new_customers_count)
            if facts.new_customers_count > 0
            else None
        )
        amer = (
            _AMER_DEF.formula_py(facts.new_customer_revenue_mu, facts.acquisition_ad_spend_mu)
            if facts.acquisition_ad_spend_mu > 0
            else None
        )

        daily_rows: list[AcquisitionDailyRow] = []
        for d in facts.daily:
            daily_rows.append(
                AcquisitionDailyRow(
                    date=d.date,
                    new_customers=d.new_customers_count,
                    nc_cm2_mu=d.nc_cm2_mu,
                    nc_revenue_mu=d.nc_revenue_mu,
                    ad_spend_mu=d.ad_spend_mu,
                    acquisition_ad_spend_mu=d.acquisition_ad_spend_mu,
                    cac_mu=(
                        _CAC_DEF.formula_py(d.ad_spend_mu, d.new_customers_count)
                        if d.new_customers_count > 0
                        else None
                    ),
                    cm2_per_nc_mu=(
                        _CM2_PER_NC_DEF.formula_py(d.nc_cm2_mu, d.new_customers_count)
                        if d.new_customers_count > 0
                        else None
                    ),
                    amer_bp=(
                        _AMER_DEF.formula_py(d.nc_revenue_mu, d.acquisition_ad_spend_mu)
                        if d.acquisition_ad_spend_mu > 0
                        else None
                    ),
                    meta_spend_mu=d.meta_spend_mu,
                    google_spend_mu=d.google_spend_mu,
                )
            )
        # Stable date sort (legacy sorts ascending by date string).
        daily_rows.sort(key=lambda r: r.date)

        return AcquisitionSummaryResult(
            workspace_id=workspace_id,
            new_customers_count=facts.new_customers_count,
            nc_cm2_mu=facts.nc_cm2_mu,
            new_customer_revenue_mu=facts.new_customer_revenue_mu,
            total_ad_spend_mu=facts.total_ad_spend_mu,
            acquisition_ad_spend_mu=facts.acquisition_ad_spend_mu,
            meta_spend_mu=facts.meta_spend_mu,
            google_spend_mu=facts.google_spend_mu,
            cac_mu=cac,
            cm2_per_nc_mu=cm2_per_nc,
            amer_bp=amer,
            daily=tuple(daily_rows),
            currency_code=currency_code,
        )
