"""
query_gateway.py — Workspace-scoped ClickHouse query entry-point.

@paradigm: sql
CF-C4-QUERY-SCOPE-ISOLATION-1 (HIGH): every ClickHouse metric read passes through
    this single entry-point. workspace_id is the FIRST positional, non-optional
    parameter — no Optional[str], no default-to-all. Falsy workspace_id raises
    UnscopedQueryError (fail-closed, never returns rows).
CF-C4-QUERY-SCOPE-1: bound-param predicate injection — no string interpolation.
CF-C4-VERIFY-THE-VERIFIER-1: isolation test seeds TWO workspaces; the predicate-
    drop mutant (removing workspace_id from WHERE) goes RED.
CF-C4-RESIDENCY-1: startup assertion enforced by analytics_service_startup.py.

ClickHouse has no Postgres-style RLS. This gateway is the tenant-isolation
analogue of Child-1's RLS — app-enforced, single entry-point, fail-closed.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Sequence

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public exception — raised on any attempt to read without a workspace scope.
# ---------------------------------------------------------------------------

class UnscopedQueryError(ValueError):
    """Raised when query_metrics() is called with a falsy workspace_id.

    CF-C4-QUERY-SCOPE-ISOLATION-1: fail-closed — an un-scoped query is a
    tenancy violation. The caller must supply a non-empty workspace_id that
    comes from the authenticated JWT context (Child-1 claim contract).
    NEVER default to returning all rows.
    """


# ---------------------------------------------------------------------------
# Date-range value object (plain dataclass; no float, no ORM).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DateRange:
    """Inclusive date range for metric queries."""

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError(
                f"DateRange: end ({self.end}) must be >= start ({self.start})."
            )


# ---------------------------------------------------------------------------
# MetricRow — typed result row from the computed MV.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MetricRow:
    """One (workspace_id, date) row from brain.workspace_daily_metrics_computed.

    All money fields are Int64 minor units (µ).
    All ratio fields are Nullable[Int32] basis points.
    None means zero-denominator day (guard fired → NULL in ClickHouse).
    """

    workspace_id: str
    date: date

    # Revenue ladder
    gross_sales_mu: int
    returns_mu: int
    discounts_mu: int
    net_sales_mu: int
    total_tax_mu: int
    net_net_tax_mu: int
    shipping_revenue_mu: int
    net_revenue_mu: int

    # Cost ladder
    cogs_mu: int
    total_ad_spend_mu: int
    cm1_mu: int
    cm2_mu: int
    misc_expenses_prorated_mu: int | None
    cm3_mu: int

    # Order / session counts
    total_orders: int

    # Ratio metrics (None = NULL from ClickHouse zero-denominator guard)
    rto_rate_bp: int | None
    prepaid_rate_bp: int | None
    conversion_rate_bp: int | None
    aov_mu: int | None
    acos_bp: int | None          # display_only=true
    blended_roas_x100: int | None  # display_only=true

    # Optional channel ratios (may not be present on all rows)
    meta_ctr_bp: int | None = None
    meta_cpc_mu: int | None = None
    meta_cpm_mu: int | None = None
    google_ctr_bp: int | None = None
    google_avg_cpc_mu: int | None = None


# ---------------------------------------------------------------------------
# _DEFAULT_CLIENT_FACTORY — replaced by _client kwarg in tests.
# ---------------------------------------------------------------------------

def _make_default_client() -> Any:
    """Create the default clickhouse_connect client from environment variables.

    The client is intentionally lazy (called inside query_metrics, not at
    import time) so tests can inject a mock client via _client= without
    importing clickhouse_connect.

    Environment variables (all required in production):
        CLICKHOUSE_HOST       — e.g. "abc123.ap-south-1.clickhouse.cloud"
        CLICKHOUSE_PORT       — default 8443
        CLICKHOUSE_USER       — e.g. "brain_analytics_ro"
        CLICKHOUSE_PASSWORD
        CLICKHOUSE_DATABASE   — default "brain"
    """
    try:
        import clickhouse_connect  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "clickhouse_connect is required. Add it to analytics-service dependencies. "
            "See pyproject.toml. CF-C4-QUERY-SCOPE-1."
        ) from exc

    host = os.environ.get("CLICKHOUSE_HOST", "")
    if not host:
        raise EnvironmentError(
            "CLICKHOUSE_HOST environment variable is required. "
            "CF-C4-RESIDENCY-1: analytics-service refuses to start without it."
        )

    return clickhouse_connect.get_client(
        host=host,
        port=int(os.environ.get("CLICKHOUSE_PORT", "8443")),
        username=os.environ.get("CLICKHOUSE_USER", "brain_analytics_ro"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "brain"),
    )


# ---------------------------------------------------------------------------
# query_metrics — the SINGLE entry-point for all ClickHouse metric reads.
# ---------------------------------------------------------------------------

_METRIC_COLUMNS = (
    "workspace_id",
    "date",
    "gross_sales_mu",
    "returns_mu",
    "discounts_mu",
    "net_sales_mu",
    "total_tax_mu",
    "net_net_tax_mu",
    "shipping_revenue_mu",
    "net_revenue_mu",
    "cogs_mu",
    "total_ad_spend_mu",
    "cm1_mu",
    "cm2_mu",
    "misc_expenses_prorated_mu",
    "cm3_mu",
    "total_orders",
    "rto_rate_bp",
    "prepaid_rate_bp",
    "conversion_rate_bp",
    "aov_mu",
    "acos_bp",
    "blended_roas_x100",
    "meta_ctr_bp",
    "meta_cpc_mu",
    "meta_cpm_mu",
    "google_ctr_bp",
    "google_avg_cpc_mu",
)

_SELECT_COLS = ", ".join(_METRIC_COLUMNS)

_QUERY_TEMPLATE = """
SELECT {cols}
FROM brain.workspace_daily_metrics_computed
WHERE workspace_id = %(workspace_id)s
  AND date >= %(date_start)s
  AND date <= %(date_end)s
ORDER BY date ASC
""".strip()


def query_metrics(
    workspace_id: str,
    definition_id: str,
    date_range: DateRange,
    *,
    _client: Any = None,
) -> list[MetricRow]:
    """Query workspace-scoped metric rows from the ClickHouse computed MV.

    CF-C4-QUERY-SCOPE-ISOLATION-1: workspace_id is the FIRST positional,
    NON-OPTIONAL parameter (no Optional[str] — that is the O5 false-GREEN class).
    A falsy workspace_id raises UnscopedQueryError immediately — the gateway
    never defaults to returning all workspaces' rows.

    CF-C4-QUERY-SCOPE-1: workspace_id is injected as a bound parameter
    (%(workspace_id)s), never via string interpolation.

    Args:
        workspace_id: the authenticated workspace scope. MUST be non-empty.
            Sourced from the JWT claim (Child-1 contract); callers must not
            accept an Optional here.
        definition_id: the metric registry definition id (e.g. "cm2_mu").
            Currently used for observability/logging; column-level filtering
            is a Child-5/6 concern. Pass the primary definition being queried.
        date_range: inclusive date range for the query.
        _client: (test injection only) a ClickHouse client instance. If None,
            the default client is created from environment variables.
            ONLY use this parameter in tests — never in production callers.

    Returns:
        list[MetricRow]: ordered by date ASC. Empty list if no rows match.

    Raises:
        UnscopedQueryError: if workspace_id is falsy (None, "", whitespace).
            This is a programming error — callers MUST provide a workspace scope.
        EnvironmentError: if required env vars are missing (production only).
    """
    # CF-C4-QUERY-SCOPE-ISOLATION-1: fail-closed — must happen BEFORE any query.
    if not workspace_id or not workspace_id.strip():
        logger.error(
            "UnscopedQueryError: query_metrics called with falsy workspace_id=%r "
            "definition_id=%r — tenancy violation, refusing query. "
            "CF-C4-QUERY-SCOPE-ISOLATION-1.",
            workspace_id,
            definition_id,
        )
        raise UnscopedQueryError(
            f"query_metrics: workspace_id must not be empty or None. "
            f"Got workspace_id={workspace_id!r}. "
            "An un-scoped query is a tenancy violation. "
            "Provide a workspace_id from the authenticated JWT context. "
            "CF-C4-QUERY-SCOPE-ISOLATION-1."
        )

    client = _client if _client is not None else _make_default_client()

    # Build the query — workspace_id is ALWAYS a bound parameter, never interpolated.
    query = _QUERY_TEMPLATE.format(cols=_SELECT_COLS)
    params: dict[str, Any] = {
        "workspace_id": workspace_id,
        "date_start": date_range.start.isoformat(),
        "date_end": date_range.end.isoformat(),
    }

    logger.debug(
        "query_metrics: workspace_id=%r definition_id=%r date_range=[%s, %s]",
        workspace_id,
        definition_id,
        date_range.start,
        date_range.end,
    )

    # Dashboard-read query timeout (canon: max_execution_time=30s) — caps the
    # blast radius of a pathological/unbounded read so one query can't pin CH.
    result = client.query(query, parameters=params, settings={"max_execution_time": 30})
    rows: list[MetricRow] = []

    for raw_row in result.result_rows:
        row_dict = dict(zip(_METRIC_COLUMNS, raw_row))
        rows.append(MetricRow(**row_dict))

    return rows
