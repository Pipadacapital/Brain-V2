"""Tests for brain_clickhouse.gateway (P1-A, rulings E, 5).

@paradigm: sql
Cost-routing: zero LLM tokens; pure Python unit tests.

Positive scenarios:
  1. Un-scoped rejection: None/empty/whitespace workspace_id → UnscopedQueryError.
  2. Auto-FINAL injection on RMT tables.
  3. No FINAL added when already present.
  4. No FINAL on non-RMT tables.
  5. Auto-PREWHERE injection when WHERE present.
  6. Auto-PREWHERE injection when WHERE absent.
  7. No duplicate PREWHERE when already present.
  8. query_fact builds and executes correctly scoped SQL.
  9. command() validates workspace_id but does NOT inject FINAL.
 10. Two-workspace isolation: gateway scopes queries to the given workspace.

Negative scenarios:
  11. FINAL injection on a non-registered table does NOT add FINAL.
  12. Missing workspace_id on command() also raises UnscopedQueryError.
  13. Empty table selection in query_fact falls back to SELECT *.
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from brain_clickhouse.gateway import (
    BrainClickHouseGateway,
    GatewayConfig,
    UnscopedQueryError,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

_CONFIG = GatewayConfig(host="localhost", port=9000, username="default", password="", database="brain")


def _make_mock_client(rows: list[list] | None = None, col_names: list[str] | None = None) -> MagicMock:
    mock = MagicMock()
    result = MagicMock()
    result.result_rows = rows or []
    result.column_names = col_names or []
    mock.query.return_value = result
    mock.command.return_value = None
    return mock


def _make_gw(mock_client: MagicMock | None = None) -> BrainClickHouseGateway:
    return BrainClickHouseGateway(_CONFIG, _client=mock_client or _make_mock_client())


# ─────────────────────────────────────────────────────────────────────────────
# Tests: workspace_id validation (CF-C4-QUERY-SCOPE-ISOLATION-1)
# ─────────────────────────────────────────────────────────────────────────────

class TestUnscopedRejection:
    """Fail-closed on falsy workspace_id."""

    def test_none_raises(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError):
            gw.query_raw(None, "SELECT 1")  # type: ignore[arg-type]

    def test_empty_string_raises(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError):
            gw.query_raw("", "SELECT 1")

    def test_whitespace_only_raises(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError):
            gw.query_raw("   ", "SELECT 1")

    def test_error_message_mentions_constraint(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError, match="CF-C4-QUERY-SCOPE-ISOLATION-1"):
            gw.query_raw("", "SELECT 1")

    def test_error_raised_before_client_call(self) -> None:
        mock_client = MagicMock()
        gw = _make_gw(mock_client)
        with pytest.raises(UnscopedQueryError):
            gw.query_raw("", "SELECT 1")
        mock_client.query.assert_not_called()


class TestCommandUnscopedRejection:
    """command() also validates workspace_id."""

    def test_empty_workspace_raises(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError):
            gw.command("", "ALTER TABLE brain.connector_order_facts DELETE WHERE 1=0")

    def test_none_workspace_raises(self) -> None:
        gw = _make_gw()
        with pytest.raises(UnscopedQueryError):
            gw.command(None, "SELECT 1")  # type: ignore[arg-type]


# ─────────────────────────────────────────────────────────────────────────────
# Tests: FINAL auto-injection (ruling E)
# ─────────────────────────────────────────────────────────────────────────────

class TestFinalInjection:
    """Auto-FINAL on RMT tables; no-op on already-FINAL or non-RMT."""

    def test_final_injected_on_rmt_table(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts WHERE 1=1"
        injected = gw._inject_final(sql)
        assert "FINAL" in injected.upper()
        assert "connector_order_facts FINAL" in injected or "connector_order_facts FINAL\n" in injected.replace(
            "connector_order_facts FINAL", "connector_order_facts FINAL"
        )

    def test_final_not_duplicated_when_already_present(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL WHERE 1=1"
        injected = gw._inject_final(sql)
        # Should appear exactly once.
        assert injected.upper().count("FINAL") == 1

    def test_no_final_on_non_rmt_table(self) -> None:
        """workspace_daily_metrics_computed is NOT in _RMT_TABLES — no FINAL."""
        gw = _make_gw()
        sql = "SELECT * FROM brain.workspace_daily_metrics_computed WHERE 1=1"
        injected = gw._inject_final(sql)
        assert "FINAL" not in injected.upper()

    def test_final_on_line_item_facts(self) -> None:
        gw = _make_gw()
        sql = "SELECT workspace_id, vendor_order_id FROM brain.connector_line_item_facts"
        injected = gw._inject_final(sql)
        assert "FINAL" in injected.upper()

    def test_final_on_shipment_facts(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_shipment_facts\nWHERE date >= '2026-01-01'"
        injected = gw._inject_final(sql)
        assert "FINAL" in injected.upper()


# ─────────────────────────────────────────────────────────────────────────────
# Tests: PREWHERE auto-injection (ruling 5)
# ─────────────────────────────────────────────────────────────────────────────

class TestPrewhereInjection:
    """Auto-PREWHERE workspace_id; no duplicate if already present."""

    _WS = "ws-test-123"

    def test_prewhere_injected_before_where(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL WHERE date >= '2026-01-01'"
        injected, _ = gw._inject_prewhere(sql, self._WS, {})
        assert "PREWHERE" in injected.upper()
        prewhere_pos = injected.upper().index("PREWHERE")
        where_pos = injected.upper().index("WHERE", prewhere_pos + 1)
        assert prewhere_pos < where_pos, "PREWHERE must come before WHERE"

    def test_prewhere_injected_with_no_where(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL"
        injected, _ = gw._inject_prewhere(sql, self._WS, {})
        assert "PREWHERE" in injected.upper()

    def test_no_duplicate_prewhere(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL PREWHERE workspace_id = %(ws)s"
        injected, _ = gw._inject_prewhere(sql, self._WS, {"ws": self._WS})
        assert injected.upper().count("PREWHERE") == 1

    def test_workspace_id_added_to_params(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL"
        _, params = gw._inject_prewhere(sql, self._WS, {})
        assert "gateway_workspace_id" in params
        assert params["gateway_workspace_id"] == self._WS

    def test_caller_params_preserved(self) -> None:
        gw = _make_gw()
        sql = "SELECT * FROM brain.connector_order_facts FINAL WHERE date >= %(dt)s"
        caller_params = {"dt": "2026-01-01"}
        _, params = gw._inject_prewhere(sql, self._WS, caller_params)
        assert params["dt"] == "2026-01-01"
        assert params["gateway_workspace_id"] == self._WS


# ─────────────────────────────────────────────────────────────────────────────
# Tests: query_raw integration
# ─────────────────────────────────────────────────────────────────────────────

class TestQueryRaw:
    """query_raw pipes FINAL + PREWHERE into the client call."""

    _WS = "ws-abc-456"

    def test_client_receives_final_and_prewhere(self) -> None:
        mock_client = _make_mock_client([], col_names=["workspace_id"])
        gw = _make_gw(mock_client)
        gw.query_raw(self._WS, "SELECT workspace_id FROM brain.connector_order_facts WHERE 1=1")
        call_args = mock_client.query.call_args
        sql_passed = call_args[0][0]
        assert "FINAL" in sql_passed.upper(), "FINAL must be in the SQL sent to client"
        assert "PREWHERE" in sql_passed.upper(), "PREWHERE must be in the SQL sent to client"

    def test_workspace_id_in_bound_params(self) -> None:
        mock_client = _make_mock_client([], col_names=[])
        gw = _make_gw(mock_client)
        gw.query_raw(self._WS, "SELECT * FROM brain.connector_order_facts")
        call_kwargs = mock_client.query.call_args[1]
        params = call_kwargs.get("parameters", {})
        assert params.get("gateway_workspace_id") == self._WS

    def test_returns_list_of_dicts(self) -> None:
        mock_client = _make_mock_client(
            rows=[["ws-abc-456", "order-001"]],
            col_names=["workspace_id", "vendor_order_id"],
        )
        gw = _make_gw(mock_client)
        result = gw.query_raw(self._WS, "SELECT * FROM brain.connector_order_facts")
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["workspace_id"] == "ws-abc-456"
        assert result[0]["vendor_order_id"] == "order-001"


# ─────────────────────────────────────────────────────────────────────────────
# Tests: query_fact convenience method
# ─────────────────────────────────────────────────────────────────────────────

class TestQueryFact:
    """query_fact builds scoped SQL and delegates to query_raw."""

    _WS = "ws-fact-789"

    def test_selects_all_when_cols_none(self) -> None:
        mock_client = _make_mock_client([], col_names=[])
        gw = _make_gw(mock_client)
        gw.query_fact(self._WS, "connector_order_facts")
        sql = mock_client.query.call_args[0][0]
        assert "SELECT *" in sql

    def test_selects_specified_cols(self) -> None:
        mock_client = _make_mock_client([], col_names=[])
        gw = _make_gw(mock_client)
        gw.query_fact(self._WS, "connector_order_facts", select_cols=["vendor_order_id", "gross_sales_mu"])
        sql = mock_client.query.call_args[0][0]
        assert "vendor_order_id, gross_sales_mu" in sql

    def test_extra_where_appended(self) -> None:
        mock_client = _make_mock_client([], col_names=[])
        gw = _make_gw(mock_client)
        gw.query_fact(
            self._WS, "connector_order_facts",
            extra_where="date >= %(dt)s",
            params={"dt": "2026-01-01"},
        )
        sql = mock_client.query.call_args[0][0]
        # extra_where must appear in the query
        assert "date >=" in sql or "%(dt)s" in sql

    def test_prewhere_workspace_present(self) -> None:
        mock_client = _make_mock_client([], col_names=[])
        gw = _make_gw(mock_client)
        gw.query_fact(self._WS, "connector_order_facts")
        sql = mock_client.query.call_args[0][0]
        assert "PREWHERE" in sql.upper()


# ─────────────────────────────────────────────────────────────────────────────
# Tests: command()
# ─────────────────────────────────────────────────────────────────────────────

class TestCommand:
    """command() validates workspace_id but does NOT inject FINAL."""

    _WS = "ws-cmd-001"

    def test_command_passes_through_without_final(self) -> None:
        mock_client = _make_mock_client()
        gw = _make_gw(mock_client)
        sql = "ALTER TABLE brain.connector_order_facts DELETE WHERE workspace_id=%(gateway_workspace_id)s AND customer_ref=%(ref)s"
        gw.command(self._WS, sql, params={"ref": "tok:abc123"})
        mock_client.command.assert_called_once()
        called_sql = mock_client.command.call_args[0][0]
        assert "FINAL" not in called_sql.upper()

    def test_command_workspace_id_injected_in_params(self) -> None:
        mock_client = _make_mock_client()
        gw = _make_gw(mock_client)
        gw.command(self._WS, "SELECT 1")
        call_kwargs = mock_client.command.call_args[1]
        params = call_kwargs.get("parameters", {})
        assert params.get("gateway_workspace_id") == self._WS


# ─────────────────────────────────────────────────────────────────────────────
# Tests: two-workspace isolation (killed-mutant class)
# ─────────────────────────────────────────────────────────────────────────────

class TestTwoWorkspaceIsolation:
    """Verify the gateway scopes queries to the given workspace_id."""

    _WS_A = "ws-iso-A"
    _WS_B = "ws-iso-B"

    def _make_two_ws_client(self):
        """Mock client that simulates workspace_id predicate filtering."""
        mock = MagicMock()

        rows_a = [["ws-iso-A", "order-a1"]]
        rows_b = [["ws-iso-B", "order-b1"]]
        col_names = ["workspace_id", "vendor_order_id"]

        def _query(sql, parameters=None, **_):
            params = parameters or {}
            ws = params.get("gateway_workspace_id", "")
            if ws == "ws-iso-A":
                filtered = rows_a
            elif ws == "ws-iso-B":
                filtered = rows_b
            else:
                filtered = rows_a + rows_b  # simulates predicate-drop mutant

            result = MagicMock()
            result.result_rows = filtered
            result.column_names = col_names
            return result

        mock.query.side_effect = _query
        return mock

    def test_ws_a_query_returns_only_ws_a_rows(self) -> None:
        mock_client = self._make_two_ws_client()
        gw = _make_gw(mock_client)
        rows = gw.query_raw(self._WS_A, "SELECT * FROM brain.connector_order_facts")
        ws_ids = {r["workspace_id"] for r in rows}
        assert ws_ids == {"ws-iso-A"}, f"Expected only ws-iso-A, got: {ws_ids}"

    def test_ws_b_query_returns_only_ws_b_rows(self) -> None:
        mock_client = self._make_two_ws_client()
        gw = _make_gw(mock_client)
        rows = gw.query_raw(self._WS_B, "SELECT * FROM brain.connector_order_facts")
        ws_ids = {r["workspace_id"] for r in rows}
        assert ws_ids == {"ws-iso-B"}, f"Expected only ws-iso-B, got: {ws_ids}"
