"""email_sms_performance_query.py — EmailSmsPerformanceQuery use-case (Phase 2, slice 8).

@paradigm: sql (deterministic integer aggregation of Klaviyo-synced rows; zero LLM/ML)

The email/SMS PERFORMANCE report for ONE workspace: aggregated delivered / unique opens /
unique clicks / orders / revenue / unsubscribes / spam-complaints per campaign / flow / date /
channel / day-of-week, plus the derived rates (open / click / rev-per-recipient).

LEGACY GROUND TRUTH (Rohan Stage-1 Finding 4 — email_cm2_mu is a PHANTOM; legacy
lib/email-performance/compute.ts computes NO CM2 / margin attribution to email):
  open_rate = unique_opens / delivered       (0 if delivered = 0)
  click_rate = unique_clicks / delivered
  revenue_per_recipient = revenue / delivered
  revenue_per_unique_open = revenue / unique_opens   (display; 0 if opens = 0)
  unsubscribe_rate = unsubscribes / delivered
  spam_rate = spam_complaints / delivered
  rows = Klaviyo emailPerformance, grouped by campaign | flow | date | channel | dow.

email_cm2_mu was DECOMMISSIONED before birth (no legacy comparand). Port revenue + the rates.

🚨 COMPLIANCE BOUNDARY (epic flag, Shreya S4 — the load-bearing constraint of this slice):
  This is REPORTING on PAST send performance, NOT sending. `sendDate` is a READ column on
  already-sent Klaviyo rows. This use-case has NO send / dispatch / audience-to-channel path,
  NO write to lifecycle-service outbound. Any actual send would re-trigger full
  DLT/NCPR/9am-9pm/consent compliance review and is OUT OF Phase-2 scope.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    email_open_rate_bp as _OPEN_RATE_DEF,
    email_click_rate_bp as _CLICK_RATE_DEF,
    email_revenue_per_recipient_mu as _RPR_DEF,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

VALID_GROUP_BY = ("campaign", "flow", "date", "channel", "dow")


@dataclass(frozen=True)
class EmailPerfFact:
    """One aggregated email/SMS performance group (post-aggregation, integer minor units).

    revenue_mu is BIGINT paise (attributed past performance — REPORTING, never a send).
    """

    key: str
    label: str
    channel: str  # "email" | "sms"
    delivered: int
    unique_opens: int
    unique_clicks: int
    orders: int
    revenue_mu: int
    unsubscribes: int
    spam_complaints: int


@dataclass(frozen=True)
class EmailSmsFacts:
    group_by: str
    rows: tuple[EmailPerfFact, ...] = field(default_factory=tuple)
    currency_code: str = "INR"


@dataclass(frozen=True)
class EmailPerfRow:
    key: str
    label: str
    channel: str
    delivered: int
    unique_opens: int
    unique_clicks: int
    orders: int
    revenue_mu: int
    unsubscribes: int
    spam_complaints: int
    open_rate_bp: int | None
    click_rate_bp: int | None
    revenue_per_recipient_mu: int | None


@dataclass(frozen=True)
class EmailSmsPerformanceResult:
    workspace_id: str
    group_by: str
    rows: tuple[EmailPerfRow, ...]
    total_delivered: int
    total_revenue_mu: int
    currency_code: str


class EmailSmsPerformanceQuery:
    """Assemble the email/SMS PERFORMANCE report for one workspace (READ-ONLY, no send)."""

    def _row(self, f: EmailPerfFact) -> EmailPerfRow:
        open_rate = (
            _OPEN_RATE_DEF.formula_py(f.unique_opens, f.delivered)
            if f.delivered > 0
            else None
        )
        click_rate = (
            _CLICK_RATE_DEF.formula_py(f.unique_clicks, f.delivered)
            if f.delivered > 0
            else None
        )
        rpr = (
            _RPR_DEF.formula_py(f.revenue_mu, f.delivered) if f.delivered > 0 else None
        )
        return EmailPerfRow(
            key=f.key,
            label=f.label,
            channel=f.channel,
            delivered=f.delivered,
            unique_opens=f.unique_opens,
            unique_clicks=f.unique_clicks,
            orders=f.orders,
            revenue_mu=f.revenue_mu,
            unsubscribes=f.unsubscribes,
            spam_complaints=f.spam_complaints,
            open_rate_bp=open_rate,
            click_rate_bp=click_rate,
            revenue_per_recipient_mu=rpr,
        )

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: EmailSmsFacts,
        *,
        _client: object | None = None,
    ) -> EmailSmsPerformanceResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "EmailSmsPerformanceQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        group_by = facts.group_by if facts.group_by in VALID_GROUP_BY else "campaign"

        # Fail-closed scoped read (observability + tenancy choke). READ ONLY — reporting only.
        query_metrics(workspace_id, "email_revenue_per_recipient_mu", date_range, _client=_client)

        rows = tuple(self._row(f) for f in facts.rows)
        # Legacy sort: dow → by weekday index; else revenue desc then delivered desc.
        if group_by == "dow":
            rows = tuple(sorted(rows, key=lambda r: r.key))
        else:
            rows = tuple(sorted(rows, key=lambda r: (-r.revenue_mu, -r.delivered, r.key)))

        return EmailSmsPerformanceResult(
            workspace_id=workspace_id,
            group_by=group_by,
            rows=rows,
            total_delivered=sum(r.delivered for r in rows),
            total_revenue_mu=sum(r.revenue_mu for r in rows),
            currency_code=facts.currency_code,
        )
