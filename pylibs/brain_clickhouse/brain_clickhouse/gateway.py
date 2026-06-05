"""brain_clickhouse.gateway — Workspace-scoped ClickHouse query gateway.

@paradigm: sql
Cost-routing: zero LLM tokens; driver I/O only.

P1-A (epic-warehouse-medallion-wiring, rulings E, 5):
    Every read through this gateway auto-receives:
      1. FINAL appended to the FROM clause — ReplacingMergeTree dedup semantics.
         Without FINAL, a read over RMT returns ALL versions of a row until
         background merge collapses them.  On a freshly ingested partition this
         can be 2–100× the correct row count — corrupting every KPI and the
         %-of-GMV billing base.
      2. PREWHERE workspace_id = %(workspace_id)s as the FIRST predicate —
         ClickHouse evaluates PREWHERE before reading full column data, so this
         prunes to the correct workspace partition before any other filter.

    A query that bypasses this gateway (raw clickhouse_connect.get_client() call
    outside query_gateway.py / this module) is a CF-C4-SINGLE-WRITER-GREP-2
    violation and will be caught by the paradigm CI gate (P1-E).

Tenant-isolation invariant (CF-C4-QUERY-SCOPE-ISOLATION-1):
    workspace_id is the FIRST positional, NON-OPTIONAL parameter on every
    read method.  Falsy workspace_id raises UnscopedQueryError immediately.

Usage:
    from brain_clickhouse import BrainClickHouseGateway, make_default_gateway

    gw = make_default_gateway()              # reads CLICKHOUSE_* env vars
    rows = gw.query_fact(
        workspace_id="<uuid>",
        table="connector_order_facts",
        select_cols=["vendor_order_id", "gross_sales_mu"],
        extra_where="AND date >= %(date_start)s",
        params={"date_start": "2026-01-01"},
    )

    # Raw parameterised query (gateway auto-injects FINAL + PREWHERE):
    rows = gw.query_raw(
        workspace_id="<uuid>",
        sql="SELECT vendor_order_id FROM brain.connector_order_facts",
        params={},
    )
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Tables for which FINAL must be appended (ReplacingMergeTree fact sinks).
# ─────────────────────────────────────────────────────────────────────────────

_RMT_TABLES: frozenset[str] = frozenset(
    {
        "connector_order_facts",
        "connector_line_item_facts",
        "connector_ad_spend_facts",
        "connector_shipment_facts",
        "connector_product_facts",
        "connector_refund_facts",
        "connector_variant_facts",
        "connector_email_send_facts",
        "connector_logistics_order_facts",
        "connector_ad_creative_facts",
        "connector_ad_funnel_facts",
        # base metrics table uses ReplacingMergeTree too
        "workspace_daily_metrics_base",
    }
)

# ─────────────────────────────────────────────────────────────────────────────
# Patterns used to inject FINAL / PREWHERE.
# ─────────────────────────────────────────────────────────────────────────────

# Matches `brain.<table_name>` in FROM clause (with or without FINAL already).
_FROM_TABLE_RE = re.compile(
    r"(FROM\s+brain\.(" + "|".join(re.escape(t) for t in _RMT_TABLES) + r"))"
    r"(\s+FINAL)?"
    r"(?=\s|$|;|\)|\n)",
    re.I,
)

# ─────────────────────────────────────────────────────────────────────────────
# Public exceptions
# ─────────────────────────────────────────────────────────────────────────────


class UnscopedQueryError(ValueError):
    """Raised when a query is attempted without a non-empty workspace_id.

    CF-C4-QUERY-SCOPE-ISOLATION-1: fail-closed — an un-scoped query is a
    tenancy violation.  The caller MUST supply a workspace_id from the
    authenticated session context; do NOT accept Optional[str] at call sites.
    """


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GatewayConfig:
    """Immutable configuration for BrainClickHouseGateway.

    All fields have sensible defaults for local development; override via
    environment variables (see make_default_gateway).
    """

    host: str
    port: int = 8443
    username: str = "default"
    password: str = ""
    database: str = "brain"
    max_execution_time: int = 30       # seconds — caps unbounded reads
    connect_timeout: int = 10


# ─────────────────────────────────────────────────────────────────────────────
# Gateway
# ─────────────────────────────────────────────────────────────────────────────


class BrainClickHouseGateway:
    """Workspace-scoped ClickHouse gateway.

    Single entry-point for all CH reads in analytics-service and intelligence-
    service.  Every call auto-enforces:
      - FINAL on RMT tables (dedup semantics)
      - PREWHERE workspace_id (partition pruning)
      - Bound-parameter injection (no string interpolation of workspace_id)
      - workspace_id fail-closed (UnscopedQueryError on empty/None)

    The gateway accepts an injected client for testing (pass _client=mock in
    tests; never in production callers).
    """

    def __init__(
        self,
        config: GatewayConfig,
        *,
        _client: Any = None,
    ) -> None:
        self._config = config
        self._client = _client  # None → lazy-constructed from config

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            import clickhouse_connect  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "clickhouse_connect is required for brain_clickhouse. "
                "Add it to the service's pyproject.toml dependencies."
            ) from exc
        self._client = clickhouse_connect.get_client(
            host=self._config.host,
            port=self._config.port,
            username=self._config.username,
            password=self._config.password,
            database=self._config.database,
        )
        return self._client

    @staticmethod
    def _validate_workspace(workspace_id: str | None) -> str:
        """Assert workspace_id is non-empty.  CF-C4-QUERY-SCOPE-ISOLATION-1."""
        if not workspace_id or not str(workspace_id).strip():
            raise UnscopedQueryError(
                "BrainClickHouseGateway: workspace_id must not be empty or None. "
                f"Got workspace_id={workspace_id!r}. "
                "An un-scoped query is a tenancy violation. "
                "Provide a workspace_id from the authenticated session context. "
                "CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        return workspace_id.strip()

    @staticmethod
    def _inject_final(sql: str) -> str:
        """Auto-append FINAL to FROM brain.<RMT_table> if not already present.

        Ruling E: FINAL is required for ReplacingMergeTree dedup semantics on
        every read.  Without it, unmerged parts return duplicate rows.

        Only appends FINAL to RMT tables (_RMT_TABLES).  Tables not in the
        set (e.g. workspace_daily_metrics_computed — plain ReplacingMergeTree
        that collects computed rows) are left unchanged.
        """

        def _replacer(m: re.Match) -> str:
            from_clause = m.group(1)
            # table = m.group(2) -- available if needed
            already_final = m.group(3)
            if already_final:
                return m.group(0)  # already has FINAL — leave intact
            return from_clause + " FINAL"

        return _FROM_TABLE_RE.sub(_replacer, sql)

    @staticmethod
    def _inject_prewhere(sql: str, workspace_id: str, params: dict) -> tuple[str, dict]:
        """Inject PREWHERE workspace_id = %(gateway_workspace_id)s as the first predicate.

        Ruling 5: PREWHERE is evaluated before the full column read in CH —
        it is the correct place for the workspace partition predicate because
        it enables early partition pruning.

        We use a distinct param name (gateway_workspace_id) to avoid colliding
        with any workspace_id param the caller may have provided.

        If the SQL already contains PREWHERE workspace_id (case-insensitive),
        we do NOT inject a duplicate — the caller's PREWHERE takes precedence.
        """
        if re.search(r"\bPREWHERE\s+workspace_id\b", sql, re.I):
            return sql, params  # already scoped at PREWHERE level

        # We inject PREWHERE <workspace_filter> immediately after the
        # FROM … [FINAL] clause. Strategy: find WHERE clause and
        # convert the first WHERE to "PREWHERE … AND (… WHERE clause)".
        # Simpler and safer: prepend PREWHERE before the existing WHERE.

        where_match = re.search(r"\bWHERE\b", sql, re.I)
        prewhere_clause = "PREWHERE workspace_id = %(gateway_workspace_id)s"
        new_params = {**params, "gateway_workspace_id": workspace_id}

        if where_match:
            # Replace "WHERE <conditions>" with "PREWHERE ws=? AND <conditions>".
            # ClickHouse allows PREWHERE + WHERE together, but it is cleaner to
            # fold workspace_id into the PREWHERE and keep the caller's conditions
            # as a WHERE clause.  We do this by inserting PREWHERE immediately
            # before WHERE (not AND WHERE), which is valid ClickHouse syntax:
            #   PREWHERE workspace_id = %(gw_ws_id)s
            #   WHERE date >= %(d)s
            # This produces a two-predicate query; ClickHouse evaluates PREWHERE
            # first (early partition pruning), then WHERE.
            pos = where_match.start()
            injected = sql[:pos] + prewhere_clause + "\n" + sql[pos:]
        else:
            # No WHERE clause — append PREWHERE at end of SELECT block.
            # Handle the common pattern: SELECT … FROM … [FINAL]\n
            # Append before ORDER BY / LIMIT / SETTINGS if present.
            for kw in ("ORDER BY", "LIMIT", "SETTINGS", "FORMAT"):
                m = re.search(r"\b" + kw + r"\b", sql, re.I)
                if m:
                    pos = m.start()
                    injected = sql[:pos] + prewhere_clause + "\n" + sql[pos:]
                    return injected, new_params
            injected = sql.rstrip() + "\n" + prewhere_clause

        return injected, new_params

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def query_raw(
        self,
        workspace_id: str,
        sql: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Execute a raw parameterised SQL SELECT with auto-FINAL + auto-PREWHERE.

        Args:
            workspace_id: authenticated workspace scope (MUST be non-empty).
            sql: SQL SELECT statement.  Use %(param)s placeholders — never
                 f-strings or % formatting for user-controlled values.
            params: additional bound parameters.

        Returns:
            list of dicts, one per result row (column name → value).

        Raises:
            UnscopedQueryError: workspace_id is falsy.
        """
        ws = self._validate_workspace(workspace_id)
        params = dict(params or {})

        # Ruling E — auto-FINAL on RMT tables.
        sql = self._inject_final(sql)

        # Ruling 5 — auto-PREWHERE workspace_id.
        sql, params = self._inject_prewhere(sql, ws, params)

        logger.debug(
            "BrainClickHouseGateway.query_raw workspace_id=%r sql_head=%r",
            ws,
            sql[:80],
        )

        client = self._get_client()
        result = client.query(
            sql,
            parameters=params,
            settings={"max_execution_time": self._config.max_execution_time},
        )
        col_names = result.column_names if hasattr(result, "column_names") else []
        rows = []
        for raw_row in result.result_rows:
            if col_names:
                rows.append(dict(zip(col_names, raw_row)))
            else:
                rows.append({"_row": raw_row})
        return rows

    def query_fact(
        self,
        workspace_id: str,
        table: str,
        select_cols: list[str] | None = None,
        extra_where: str = "",
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Convenience method for a simple fact-table SELECT.

        Builds:
            SELECT <select_cols>
            FROM brain.<table>
            [FINAL auto-injected if RMT]
            PREWHERE workspace_id = %(gateway_workspace_id)s
            [AND extra_where]

        Args:
            workspace_id: authenticated workspace scope.
            table: bare table name (e.g. "connector_order_facts"); "brain."
                   prefix is added automatically.
            select_cols: columns to SELECT; None → SELECT *.
            extra_where: optional WHERE conditions to AND with workspace_id;
                         must start with "AND ".  Use %(param)s placeholders.
            params: bound parameters for extra_where.

        Returns:
            list of dicts.

        Raises:
            UnscopedQueryError: workspace_id is falsy.
        """
        ws = self._validate_workspace(workspace_id)
        cols = ", ".join(select_cols) if select_cols else "*"
        sql = f"SELECT {cols} FROM brain.{table}"
        if extra_where:
            sql += f"\nWHERE {extra_where.lstrip('AND ').lstrip('and ')}"

        return self.query_raw(ws, sql, params)

    def command(
        self,
        workspace_id: str,
        sql: str,
        params: dict[str, Any] | None = None,
    ) -> None:
        """Execute a non-SELECT command (DDL mutation) with workspace scope.

        Used for ALTER TABLE ... DELETE (erasure orchestrator), OPTIMIZE, etc.
        Does NOT auto-inject FINAL (mutations do not use FINAL).
        DOES validate workspace_id (fail-closed).

        Args:
            workspace_id: authenticated workspace scope.
            sql: command SQL.  Use %(param)s placeholders.
            params: bound parameters.

        Raises:
            UnscopedQueryError: workspace_id is falsy.
        """
        ws = self._validate_workspace(workspace_id)
        params = dict(params or {})
        if "gateway_workspace_id" not in params:
            params["gateway_workspace_id"] = ws
        logger.debug(
            "BrainClickHouseGateway.command workspace_id=%r sql_head=%r",
            ws,
            sql[:80],
        )
        client = self._get_client()
        client.command(sql, parameters=params)


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────


def make_default_gateway(*, _client: Any = None) -> BrainClickHouseGateway:
    """Construct a BrainClickHouseGateway from environment variables.

    Environment variables:
        CLICKHOUSE_HOST      — required; e.g. "abc123.ap-south-1.clickhouse.cloud"
        CLICKHOUSE_PORT      — default 8443
        CLICKHOUSE_USER      — default "default"
        CLICKHOUSE_PASSWORD  — default ""
        CLICKHOUSE_DATABASE  — default "brain"

    The _client kwarg is for test injection only.
    """
    host = os.environ.get("CLICKHOUSE_HOST", "")
    if not host and _client is None:
        raise EnvironmentError(
            "CLICKHOUSE_HOST environment variable is required for BrainClickHouseGateway. "
            "CF-C4-RESIDENCY-1: the service refuses to start without it."
        )
    config = GatewayConfig(
        host=host,
        port=int(os.environ.get("CLICKHOUSE_PORT", "8443")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "brain"),
    )
    return BrainClickHouseGateway(config, _client=_client)
