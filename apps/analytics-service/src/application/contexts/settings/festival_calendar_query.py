"""festival_calendar_query.py — FestivalCalendarQuery use-case (Phase 2, slice 7).

@paradigm: sql (deterministic selection over structured facts; zero LLM/ML)

The India festival template calendar + the per-workspace festivals for /settings/festivals —
ported Brain-native from legacy lib/festivals/india-festival-calendar.ts + seed-festivals.ts +
routes/workspaces/festivals.ts onto the slice-1..6 foundation.

ROHAN STAGE-1 FINDING 2 — festival LEARNED-LIFT IS A PHANTOM:
  Legacy festivals carry ONLY a stored expected_multiplier template default (1.3 Makar
  Sankranti … 4.0 Diwali). There is NO learned-lift computation anywhere in lib/festivals.
  Per the decommission-phantoms rule (slice-4 pamer_bp, slice-5 cac_payback_months, slice-6
  product_cm1_mu), this use-case does NOT introduce a learned festival_lift metric. It returns
  the India template calendar + the operator's expected multipliers (display-only this slice;
  CRUD defers per the Stage-1 scope decision).

The expected_multiplier is surfaced as basis points (×10000 of the multiplier) to keep the
wire integer-exact — e.g. 4.0× → 40000, 1.3× → 13000.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)


@dataclass(frozen=True)
class FestivalFact:
    """One festival window (template or workspace-edited). multiplier in bp (×10000)."""

    name: str
    start_date: str            # ISO yyyy-mm-dd
    end_date: str              # ISO yyyy-mm-dd
    expected_multiplier_bp: int  # e.g. 40000 = 4.0×, 13000 = 1.3×
    regions: tuple[str, ...] = ()
    categories: tuple[str, ...] = ()
    color: str = "#F59E0B"
    is_template: bool = True
    is_active: bool = True


@dataclass(frozen=True)
class FestivalFacts:
    festivals: tuple[FestivalFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class FestivalRow:
    name: str
    start_date: str
    end_date: str
    expected_multiplier_bp: int
    regions: tuple[str, ...]
    categories: tuple[str, ...]
    color: str
    is_template: bool
    is_active: bool


@dataclass(frozen=True)
class FestivalCalendarResult:
    workspace_id: str
    year: int | None
    rows: tuple[FestivalRow, ...]
    total_rows: int
    # The single biggest expected multiplier in the window (informational; NOT learned).
    peak_multiplier_bp: int


class FestivalCalendarQuery:
    """Assemble the festival template calendar for one workspace (display-only this slice)."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: FestivalFacts,
        *,
        year: int | None = None,
        _client: object | None = None,
    ) -> FestivalCalendarResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "FestivalCalendarQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )

        # Fail-closed scoped read (observability + tenancy choke). No metric def — festivals
        # are config; we touch net_revenue_mu only as the tenancy choke (NOT a learned lift).
        query_metrics(workspace_id, "net_revenue_mu", date_range, _client=_client)

        rows: list[FestivalRow] = []
        peak = 0
        for f in facts.festivals:
            if year is not None and not f.start_date.startswith(str(year)):
                continue
            peak = max(peak, f.expected_multiplier_bp)
            rows.append(
                FestivalRow(
                    name=f.name,
                    start_date=f.start_date,
                    end_date=f.end_date,
                    expected_multiplier_bp=f.expected_multiplier_bp,
                    regions=f.regions,
                    categories=f.categories,
                    color=f.color,
                    is_template=f.is_template,
                    is_active=f.is_active,
                )
            )

        rows.sort(key=lambda r: r.start_date)

        return FestivalCalendarResult(
            workspace_id=workspace_id,
            year=year,
            rows=tuple(rows),
            total_rows=len(rows),
            peak_multiplier_bp=peak,
        )
