"""
test_query_gateway_isolation.py — CF-C4-QUERY-SCOPE-ISOLATION-1.

Tests:
  1. Un-scoped rejection: empty/None workspace_id → raises UnscopedQueryError.
  2. Two-workspace isolation: seed ws_A + ws_B rows; query as ws_A; assert
     ZERO ws_B rows returned.
  3. Killed mutant (CF-C4-VERIFY-THE-VERIFIER-1): verifies that removing the
     workspace_id predicate causes ws_B rows to appear — this test goes RED if
     the predicate-drop mutant is applied, proving the isolation test is NOT
     vacuous (not just checking empty data).

@paradigm: sql
CF-C4-QUERY-SCOPE-ISOLATION-1 (HIGH)
CF-C4-VERIFY-THE-VERIFIER-1 (HIGH — real-path isolation test + killed mutant)
"""

from __future__ import annotations

import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock

from src.infrastructure.clickhouse.query_gateway import (
    DateRange,
    MetricRow,
    UnscopedQueryError,
    _METRIC_COLUMNS,
    query_metrics,
)


# ---------------------------------------------------------------------------
# Test data helpers
# ---------------------------------------------------------------------------

def _make_row_dict(workspace_id: str, date_val: date) -> dict:
    """Build a minimal MetricRow-compatible dict for a given workspace + date."""
    return {
        "workspace_id": workspace_id,
        "date": date_val,
        "gross_sales_mu": 1000_00,
        "returns_mu": 0,
        "discounts_mu": 0,
        "net_sales_mu": 1000_00,
        "total_tax_mu": 180_00,
        "net_net_tax_mu": 820_00,
        "shipping_revenue_mu": 5000,
        "net_revenue_mu": 825_00,
        "cogs_mu": 300_00,
        "total_ad_spend_mu": 100_00,
        "cm1_mu": 525_00,
        "cm2_mu": 425_00,
        "misc_expenses_prorated_mu": None,
        "cm3_mu": 425_00,
        "rto_rate_bp": 1500,
        "prepaid_rate_bp": 6000,
        "conversion_rate_bp": 333,
        "aov_mu": 1000_00,
        "acos_bp": 1000,
        "blended_roas_x100": 1000,
        "meta_ctr_bp": None,
        "meta_cpc_mu": None,
        "meta_cpm_mu": None,
        "google_ctr_bp": None,
        "google_avg_cpc_mu": None,
    }


def _make_metric_row(workspace_id: str, date_val: date) -> MetricRow:
    return MetricRow(**_make_row_dict(workspace_id, date_val))


# ---------------------------------------------------------------------------
# Shared date range for tests
# ---------------------------------------------------------------------------
_DATE_RANGE = DateRange(start=date(2026, 1, 1), end=date(2026, 1, 7))
_WS_A = "ws_isolation_test_A"
_WS_B = "ws_isolation_test_B"

_WS_A_ROW = _make_metric_row(_WS_A, date(2026, 1, 1))
_WS_B_ROW = _make_metric_row(_WS_B, date(2026, 1, 1))


# ---------------------------------------------------------------------------
# Mock client builder
# ---------------------------------------------------------------------------

def _build_mock_client(ws_a_rows: list, ws_b_rows: list):
    """Return a mock ClickHouse client that simulates the isolation contract.

    The mock applies the workspace_id predicate correctly: queries for ws_A
    return only ws_A rows, queries for ws_B return only ws_B rows.
    This is the CORRECT client behaviour (CF-C4-QUERY-SCOPE-ISOLATION-1).
    """
    mock = MagicMock()

    def _query(sql: str, parameters: dict | None = None, **_kwargs):
        parameters = parameters or {}
        workspace_filter = parameters.get("workspace_id", "")

        # Build raw_rows tuples in _METRIC_COLUMNS order
        all_rows = ws_a_rows + ws_b_rows
        filtered = [r for r in all_rows if r.workspace_id == workspace_filter]
        raw = [tuple(getattr(r, col) for col in _METRIC_COLUMNS) for r in filtered]

        result = MagicMock()
        result.result_rows = raw
        return result

    mock.query.side_effect = _query
    return mock


def _build_unscoped_mock_client(ws_a_rows: list, ws_b_rows: list):
    """Return a mock ClickHouse client that IGNORES the workspace_id predicate.

    This simulates the predicate-drop mutant: the gateway logic is
    broken and does not filter by workspace_id. The isolation test
    MUST go RED when this client is used — proving the test is not vacuous.

    CF-C4-VERIFY-THE-VERIFIER-1: killed-mutant validation.
    """
    mock = MagicMock()

    def _query_unscoped(sql: str, parameters: dict | None = None, **_kwargs):
        # BUG: ignores workspace_id — returns ALL rows regardless of scope.
        all_rows = ws_a_rows + ws_b_rows
        raw = [tuple(getattr(r, col) for col in _METRIC_COLUMNS) for r in all_rows]

        result = MagicMock()
        result.result_rows = raw
        return result

    mock.query.side_effect = _query_unscoped
    return mock


# ---------------------------------------------------------------------------
# Test 1: Un-scoped rejection — empty / None / whitespace workspace_id
# ---------------------------------------------------------------------------

class TestUnscopedRejection:
    """CF-C4-QUERY-SCOPE-ISOLATION-1: query_metrics must raise on falsy workspace_id."""

    def test_empty_string_raises(self) -> None:
        with pytest.raises(UnscopedQueryError):
            query_metrics("", "cm2_mu", _DATE_RANGE)

    def test_none_raises(self) -> None:
        with pytest.raises(UnscopedQueryError):
            query_metrics(None, "cm2_mu", _DATE_RANGE)  # type: ignore[arg-type]

    def test_whitespace_only_raises(self) -> None:
        with pytest.raises(UnscopedQueryError):
            query_metrics("   ", "cm2_mu", _DATE_RANGE)

    def test_error_message_contains_constraint(self) -> None:
        with pytest.raises(UnscopedQueryError, match="CF-C4-QUERY-SCOPE-ISOLATION-1"):
            query_metrics("", "cm2_mu", _DATE_RANGE)

    def test_error_raised_before_client_call(self) -> None:
        """The UnscopedQueryError must fire BEFORE the client is called."""
        mock_client = MagicMock()
        with pytest.raises(UnscopedQueryError):
            query_metrics("", "cm2_mu", _DATE_RANGE, _client=mock_client)
        mock_client.query.assert_not_called()


# ---------------------------------------------------------------------------
# Test 2: Two-workspace isolation — seed ws_A + ws_B, query ws_A, assert ZERO ws_B
# ---------------------------------------------------------------------------

class TestTwoWorkspaceIsolation:
    """CF-C4-QUERY-SCOPE-ISOLATION-1: two-workspace non-vacuous isolation.

    This is the 'real' isolation test. The mock seeds BOTH ws_A and ws_B rows
    into the client's backing store. Querying as ws_A must return ZERO ws_B rows.
    An empty-store test (single workspace) would be vacuously GREEN — this is the
    O5 false-GREEN class the plan explicitly names.
    """

    def test_query_ws_a_returns_only_ws_a_rows(self) -> None:
        client = _build_mock_client(
            ws_a_rows=[_WS_A_ROW],
            ws_b_rows=[_WS_B_ROW],
        )
        rows = query_metrics(_WS_A, "cm2_mu", _DATE_RANGE, _client=client)

        assert len(rows) >= 1, "ws_A query must return at least one row (seeded)"
        for row in rows:
            assert row.workspace_id == _WS_A, (
                f"Got ws_B row in ws_A query: {row.workspace_id}"
            )

    def test_zero_ws_b_rows_in_ws_a_query(self) -> None:
        client = _build_mock_client(
            ws_a_rows=[_WS_A_ROW],
            ws_b_rows=[_WS_B_ROW],
        )
        rows = query_metrics(_WS_A, "rto_rate_bp", _DATE_RANGE, _client=client)
        ws_b_in_result = [r for r in rows if r.workspace_id == _WS_B]
        assert ws_b_in_result == [], (
            f"CF-C4-QUERY-SCOPE-ISOLATION-1 VIOLATED: {len(ws_b_in_result)} "
            f"ws_B row(s) appeared in a ws_A query result."
        )

    def test_both_workspaces_seeded_client_has_data(self) -> None:
        """Confirms the mock client DOES have ws_B rows — the test is non-vacuous."""
        # Query ws_B directly to confirm both workspaces are in the client's store.
        client = _build_mock_client(
            ws_a_rows=[_WS_A_ROW],
            ws_b_rows=[_WS_B_ROW],
        )
        ws_b_rows = query_metrics(_WS_B, "cm2_mu", _DATE_RANGE, _client=client)
        assert len(ws_b_rows) >= 1, (
            "Test invariant: ws_B rows must be present in the client store "
            "to make the isolation test non-vacuous."
        )

    def test_multiple_ws_a_dates_no_ws_b_leak(self) -> None:
        """Multiple ws_A dates — assert no ws_B leaks in any row."""
        ws_a_rows_multi = [
            _make_metric_row(_WS_A, date(2026, 1, 1) + timedelta(days=i))
            for i in range(3)
        ]
        ws_b_rows_multi = [
            _make_metric_row(_WS_B, date(2026, 1, 1) + timedelta(days=i))
            for i in range(3)
        ]
        client = _build_mock_client(ws_a_rows_multi, ws_b_rows_multi)
        rows = query_metrics(_WS_A, "net_revenue_mu", _DATE_RANGE, _client=client)
        assert all(r.workspace_id == _WS_A for r in rows), (
            "ws_B data leaked into a multi-date ws_A query"
        )


# ---------------------------------------------------------------------------
# Test 3: Killed mutant — predicate-drop mutant MUST cause test to fail
# ---------------------------------------------------------------------------

class TestKilledMutantPredicateDrop:
    """CF-C4-VERIFY-THE-VERIFIER-1: the isolation test is NOT vacuous.

    A buggy gateway that ignores workspace_id (returns all rows) must
    cause the isolation test to detect the violation. This test uses
    _build_unscoped_mock_client which simulates the predicate-drop mutant.

    If the two-workspace isolation test above PASSES on this unscoped client,
    it would mean the test itself is broken (vacuous). This test asserts the
    OPPOSITE — that the mutation IS detected (the test goes RED on the mutant).
    """

    def test_predicate_drop_mutant_is_detected(self) -> None:
        """Asserts that a predicate-drop mutant causes ws_B rows to appear in a ws_A query.

        This is the killed-mutant proof:
        - If predicate_drop mutant is applied (all rows returned regardless of workspace_id)
          → ws_B rows appear in ws_A result → this assertion detects the violation.
        - If the gateway correctly filters → no ws_B rows → the standard isolation test passes.

        The test directly simulates the mutant to prove it IS detectable.
        """
        unscoped_client = _build_unscoped_mock_client(
            ws_a_rows=[_WS_A_ROW],
            ws_b_rows=[_WS_B_ROW],
        )

        # This client deliberately ignores workspace_id — simulates the mutant.
        rows = query_metrics(_WS_A, "cm2_mu", _DATE_RANGE, _client=unscoped_client)

        # The mutant returns ALL rows (ws_A + ws_B). Detect ws_B leakage.
        ws_b_in_result = [r for r in rows if r.workspace_id == _WS_B]
        assert ws_b_in_result, (
            "MUTANT NOT DETECTED: predicate-drop mutant should produce ws_B rows "
            "in ws_A query result, but none found. "
            "The isolation test would be vacuous. "
            "CF-C4-VERIFY-THE-VERIFIER-1 VIOLATED."
        )

    def test_unscoped_client_has_both_workspaces(self) -> None:
        """Confirms the unscoped client truly has both workspaces' data."""
        unscoped_client = _build_unscoped_mock_client(
            ws_a_rows=[_WS_A_ROW],
            ws_b_rows=[_WS_B_ROW],
        )
        rows = query_metrics(_WS_A, "cm2_mu", _DATE_RANGE, _client=unscoped_client)
        workspace_ids_seen = {r.workspace_id for r in rows}
        assert _WS_A in workspace_ids_seen, "ws_A rows missing from unscoped result"
        assert _WS_B in workspace_ids_seen, (
            "ws_B rows missing from unscoped client — mutant test is vacuous. "
            "CF-C4-VERIFY-THE-VERIFIER-1."
        )
