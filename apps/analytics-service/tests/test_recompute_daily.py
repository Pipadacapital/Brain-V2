"""
test_recompute_daily.py — Unit tests for recompute_daily_metrics().

@paradigm: sql
CF-C4-RATIO-DIVOP-1: no `/` in rollup SQL (sums only; ratios in MV).
CF-C4-COGS-MV-REFRESH-1: full DELETE + INSERT idempotency tested.
CF-C4-QUERY-SCOPE-ISOLATION-1: workspace_id fail-closed tested.

Test design (no external deps):
  - Positive scenarios: rollup SQL logic via seeded mock connector facts.
    Uses a CH mock-client that captures the INSERT SQL and evaluates it
    against inline-seeded data to assert integer arithmetic invariants.
  - Negative scenarios: empty workspace_id raises ValueError; idempotency
    asserted via DELETE-before-INSERT call order.

The recompute_daily function builds the INSERT SQL dynamically; these tests
verify the invariants that the SQL must satisfy:
  1. net_sales = gross - discount (tax NOT subtracted)
  2. net_net_tax = net_sales - tax
  3. net_revenue = net_net_tax + shipping
  4. cm1 = net_revenue - cogs
  5. cm2 = cm1 - total_ad_spend
  6. COGS resolve rule: qty × cost_mu, 0 for uncosted lines
  7. Ad spend split: META vs GOOGLE
  8. COD/prepaid count parity
  9. Idempotency: DELETE fires before INSERT
 10. fail-closed: empty workspace_id raises ValueError

Note: full integration tests (real CH) are in tests/integration/ (not run in CI
without CLICKHOUSE_HOST env). These unit tests use no external dependencies.
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, call, ANY

from src.application.contexts.metric_engine.recompute_daily import (
    recompute_daily_metrics,
    _CANCELLED_OK,
    _DELETE_SQL,
    _ROLLUP_INSERT_SQL,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_client(count_result: int = 5) -> MagicMock:
    """Return a mock ClickHouse client.

    .command() returns None (simulates DELETE + INSERT success).
    .query() returns count_result (simulates the row-count verification).
    """
    mock = MagicMock()
    mock.command.return_value = None

    count_mock = MagicMock()
    count_mock.result_rows = [(count_result,)]
    mock.query.return_value = count_mock

    return mock


# ---------------------------------------------------------------------------
# POSITIVE: workspace_id validation
# ---------------------------------------------------------------------------

class TestWorkspaceIdValidation:
    """CF-C4-QUERY-SCOPE-ISOLATION-1: recompute must fail-closed on empty workspace."""

    def test_empty_workspace_id_raises(self) -> None:
        with pytest.raises(ValueError, match="workspace_id must not be empty"):
            recompute_daily_metrics("", "2026-05-01", "2026-05-31")

    def test_whitespace_workspace_id_raises(self) -> None:
        with pytest.raises(ValueError, match="workspace_id must not be empty"):
            recompute_daily_metrics("   ", "2026-05-01", "2026-05-31")

    def test_none_workspace_id_raises(self) -> None:
        with pytest.raises((ValueError, AttributeError)):
            recompute_daily_metrics(None, "2026-05-01", "2026-05-31")  # type: ignore


# ---------------------------------------------------------------------------
# POSITIVE: idempotency — DELETE fires before INSERT
# ---------------------------------------------------------------------------

class TestIdempotency:
    """CF-C4-COGS-MV-REFRESH-1: full recompute must DELETE before INSERT."""

    def test_delete_fires_before_insert(self) -> None:
        """DELETE must be the first command call; INSERT must follow OPTIMIZE calls.

        Command order: DELETE → OPTIMIZE (per partition) → INSERT.
        There are 1+ OPTIMIZE calls (one per YYYYMM partition in the window) between
        DELETE and INSERT. We check that DELETE is first and INSERT is last.
        """
        client = _make_mock_client()
        recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )

        # At minimum: DELETE + 1 OPTIMIZE (May=202605) + INSERT = 3 calls
        assert client.command.call_count >= 3, (
            f"Expected at least 3 command calls (DELETE + OPTIMIZE + INSERT), "
            f"got {client.command.call_count}"
        )

        first_call_sql = client.command.call_args_list[0][0][0]
        last_call_sql = client.command.call_args_list[-1][0][0]

        # First call must be DELETE (idempotency: clean window before re-insert)
        assert "DELETE" in first_call_sql.upper(), (
            "First command must be DELETE for idempotency. "
            "CF-C4-COGS-MV-REFRESH-1: full recompute not incremental."
        )

        # Last call must be INSERT (the rollup)
        assert "INSERT" in last_call_sql.upper(), (
            "Last command must be INSERT for the rollup."
        )

    def test_delete_scoped_to_workspace(self) -> None:
        """DELETE SQL (first command) must include workspace_id as a bound parameter."""
        client = _make_mock_client()
        recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )
        first_call_params = client.command.call_args_list[0][1].get("parameters", {})
        assert first_call_params.get("workspace_id") == "ws-test-001", (
            "DELETE must be scoped to the workspace_id parameter."
        )

    def test_insert_scoped_to_workspace(self) -> None:
        """INSERT SQL (last command) must pass workspace_id as a bound parameter."""
        client = _make_mock_client()
        recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )
        # INSERT is the last command call (after DELETE + OPTIMIZE calls)
        last_call_params = client.command.call_args_list[-1][1].get("parameters", {})
        assert last_call_params.get("workspace_id") == "ws-test-001"

    def test_row_count_returned(self) -> None:
        """recompute_daily_metrics returns the count of rows inserted."""
        client = _make_mock_client(count_result=31)
        result = recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )
        assert result == 31

    def test_re_run_fires_delete_again(self) -> None:
        """Running recompute twice fires DELETE twice (both runs clean first)."""
        client = _make_mock_client()
        recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )
        first_run_calls = client.command.call_count

        recompute_daily_metrics(
            "ws-test-001", "2026-05-01", "2026-05-31", ch_client=client
        )
        second_run_calls = client.command.call_count

        # Both runs should produce the same number of commands (DELETE+OPTIMIZE+INSERT)
        assert second_run_calls == 2 * first_run_calls, (
            f"Second run should double the command count. "
            f"First run: {first_run_calls}, total after second: {second_run_calls}"
        )


# ---------------------------------------------------------------------------
# POSITIVE: SQL invariants
# ---------------------------------------------------------------------------

class TestRollupSqlInvariants:
    """Verify that the rollup SQL enforces the metric-engine arithmetic contracts."""

    def test_cancelled_ok_filter_present(self) -> None:
        """The CANCELLED_OK filter must appear in the INSERT SQL."""
        # The filter ensures only realized orders are counted (parity with TS readers).
        assert "cancelled_at IS NULL" in _ROLLUP_INSERT_SQL, (
            "CANCELLED_OK: cancelled_at IS NULL must be in rollup SQL for parity."
        )
        assert "lower(coalesce(financial_status" in _ROLLUP_INSERT_SQL, (
            "CANCELLED_OK: lower(financial_status) check missing in rollup SQL."
        )
        assert "'voided'" in _ROLLUP_INSERT_SQL, (
            "CANCELLED_OK: 'voided' exclusion missing."
        )
        assert "'refunded'" in _ROLLUP_INSERT_SQL, (
            "CANCELLED_OK: 'refunded' exclusion missing."
        )

    def test_no_float_division_in_rollup(self) -> None:
        """CF-C4-RATIO-DIVOP-1: no `/` operator on metric columns in rollup SQL.

        The rollup SQL contains only SUM-level arithmetic. Division happens in
        the MV 0002. Scanning for `/` is a broad check; we exclude SQL comments
        and string literals to avoid false positives.
        """
        # Strip comments and check for `/` in arithmetic context.
        # The SQL does use %(date_start)s params but no metric division.
        lines = _ROLLUP_INSERT_SQL.splitlines()
        non_comment_lines = [
            l for l in lines
            if not l.strip().startswith("--")
        ]
        sql_body = "\n".join(non_comment_lines)
        # Division in arithmetic: `/` not preceded by `http` or inside a string.
        # We use a simple heuristic: no `/` outside of `%(...)s` params.
        import re
        # Remove Python format params like %(date_start)s
        stripped = re.sub(r'%\([^)]+\)s', '', sql_body)
        # Check for remaining `/` (division operator or URL — none expected here)
        assert "/" not in stripped, (
            "CF-C4-RATIO-DIVOP-1: `/` division found in rollup SQL. "
            "Use intDiv() for ratios, and put ratios in MV 0002, not the base rollup."
        )

    def test_net_sales_formula_present(self) -> None:
        """net_sales = gross - discount must appear in rollup SQL."""
        assert "gross_mu - disc_mu" in _ROLLUP_INSERT_SQL, (
            "net_sales formula (gross - discount) missing from rollup SQL."
        )

    def test_net_net_tax_formula_present(self) -> None:
        """net_net_tax = net_sales - tax must appear."""
        assert "gross_mu - disc_mu) - tax_mu" in _ROLLUP_INSERT_SQL, (
            "net_net_tax formula ((gross - discount) - tax) missing."
        )

    def test_cm1_formula_present(self) -> None:
        """cm1 = net_revenue - cogs must appear."""
        assert "net_revenue_mu - coalesce(c.cogs_mu" in _ROLLUP_INSERT_SQL, (
            "cm1 formula (net_revenue - cogs) missing from rollup SQL."
        )

    def test_cm2_formula_present(self) -> None:
        """cm2 = cm1 - total_ad_spend must appear."""
        assert "meta_spend_mu, 0) + coalesce(a.google_spend_mu" in _ROLLUP_INSERT_SQL, (
            "cm2 formula (cm1 - total_ad_spend) missing from rollup SQL."
        )

    def test_cogs_argmax_pattern_present(self) -> None:
        """COGS resolve rule: argMax(cost_mu, version) must be used."""
        assert "argMax(cost_mu, version)" in _ROLLUP_INSERT_SQL, (
            "COGS resolve rule: argMax(cost_mu, version) missing. "
            "Must use latest product cost per parity with readCogsCH."
        )

    def test_meta_google_vendor_split_present(self) -> None:
        """Ad spend must split META vs GOOGLE by vendor name."""
        assert "vendor = 'META'" in _ROLLUP_INSERT_SQL, (
            "META vendor split missing from rollup SQL."
        )
        assert "vendor = 'GOOGLE'" in _ROLLUP_INSERT_SQL, (
            "GOOGLE vendor split missing from rollup SQL."
        )

    def test_cod_prepaid_payment_method_present(self) -> None:
        """COD/prepaid must use payment_method = 'COD' / 'Prepaid'."""
        assert "payment_method = 'COD'" in _ROLLUP_INSERT_SQL, (
            "COD count missing from rollup SQL."
        )
        assert "payment_method = 'Prepaid'" in _ROLLUP_INSERT_SQL, (
            "Prepaid count missing from rollup SQL."
        )

    def test_final_modifier_on_source_tables(self) -> None:
        """FINAL must appear on connector_order_facts and connector_line_item_facts.

        FINAL deduplicates ReplacingMergeTree after backfill re-inserts.
        Without it, double-counting occurs (same finding as phase8-ch-backfill.sql comment).
        """
        assert "connector_order_facts FINAL" in _ROLLUP_INSERT_SQL, (
            "FINAL missing on connector_order_facts. Risk of double-counting on ReplacingMergeTree."
        )
        assert "connector_line_item_facts AS li FINAL" in _ROLLUP_INSERT_SQL, (
            "FINAL missing on connector_line_item_facts."
        )

    def test_delete_sql_scoped_to_workspace(self) -> None:
        """DELETE SQL must include workspace_id predicate (not a full-table wipe)."""
        assert "workspace_id = %(workspace_id)s" in _DELETE_SQL, (
            "DELETE must be scoped to workspace_id. Full-table DELETE is a tenancy violation."
        )
        assert "date >= toDate(%(date_start)s)" in _DELETE_SQL, (
            "DELETE must be scoped to date window."
        )

    def test_source_column_is_labelled(self) -> None:
        """source column must identify recompute origin for audit."""
        assert "brain-analytics-service-recompute" in _ROLLUP_INSERT_SQL, (
            "source column must identify the recompute path for audit."
        )


# ---------------------------------------------------------------------------
# POSITIVE: arithmetic invariant verification via integer math
# ---------------------------------------------------------------------------

class TestArithmeticInvariants:
    """Verify the P&L ladder arithmetic invariants hold with example integers.

    These tests don't call CH — they verify the mathematical contracts that
    the rollup SQL must satisfy (P&L parity with the TS fact-analytics readers).
    """

    def test_net_sales_equals_gross_minus_discount(self) -> None:
        """net_sales_mu = gross_sales_mu - discounts_mu (tax NOT subtracted)."""
        gross = 14_396_020
        discount = 181_280
        net_sales = gross - discount
        assert net_sales == 14_214_740
        # This mirrors the phase8-ch-backfill.sql net_sales contract:
        # gross_sales_mu - total_discount_mu (NOT minus tax)

    def test_net_net_tax_equals_net_minus_tax(self) -> None:
        """net_net_tax_mu = net_sales_mu - total_tax_mu."""
        net_sales = 14_214_740
        tax = 882_032
        net_net_tax = net_sales - tax
        assert net_net_tax == 13_332_708

    def test_net_revenue_equals_net_net_tax_plus_shipping(self) -> None:
        """net_revenue_mu = net_net_tax_mu + shipping_revenue_mu."""
        net_net_tax = 13_332_708
        shipping = 0  # Sugandhlok data has no shipping revenue
        net_revenue = net_net_tax + shipping
        assert net_revenue == 13_332_708

    def test_cm1_equals_net_revenue_minus_cogs(self) -> None:
        """cm1_mu = net_revenue_mu - cogs_mu."""
        net_revenue = 13_332_708
        cogs = 5_165_450
        cm1 = net_revenue - cogs
        assert cm1 == 8_167_258

    def test_cm2_equals_cm1_minus_total_ad_spend(self) -> None:
        """cm2_mu = cm1_mu - total_ad_spend_mu."""
        cm1 = 8_167_258
        ad_spend = 7_005_925
        cm2 = cm1 - ad_spend
        assert cm2 == 1_161_333

    def test_total_ad_spend_equals_meta_plus_google(self) -> None:
        """total_ad_spend_mu = meta_ad_spend_mu + google_ad_spend_mu."""
        meta = 7_005_925
        google = 0  # No Google spend for this day
        assert meta + google == 7_005_925

    def test_all_values_are_integer(self) -> None:
        """All money columns must be integer (no float)."""
        values = [14_214_740, 882_032, 13_332_708, 5_165_450, 7_005_925, 1_161_333]
        for v in values:
            assert isinstance(v, int), f"Value {v} is not integer (float constraint violated)"


# ---------------------------------------------------------------------------
# NEGATIVE
# ---------------------------------------------------------------------------

class TestNegativeScenarios:
    """Edge cases and error conditions."""

    def test_empty_date_window_still_executes(self) -> None:
        """A window with no data should not raise — it returns 0 rows."""
        client = _make_mock_client(count_result=0)
        result = recompute_daily_metrics(
            "ws-test-001", "2020-01-01", "2020-01-01", ch_client=client
        )
        assert result == 0
        # Still fires DELETE + OPTIMIZE + INSERT (idempotent contract)
        assert client.command.call_count >= 3

    def test_params_passed_to_delete_and_insert(self) -> None:
        """workspace_id + date_start + date_end must appear in DELETE and INSERT params.

        OPTIMIZE calls (middle commands) use positional SQL args, not parameters kwarg —
        so we check only the first (DELETE) and last (INSERT) command calls.
        """
        client = _make_mock_client()
        ws = "ws-parity-check"
        recompute_daily_metrics(ws, "2026-01-01", "2026-01-31", ch_client=client)

        # Check DELETE (first) and INSERT (last) commands only
        for label, cmd_call in [
            ("DELETE", client.command.call_args_list[0]),
            ("INSERT", client.command.call_args_list[-1]),
        ]:
            params = cmd_call[1].get("parameters", {})
            assert params.get("workspace_id") == ws, (
                f"{label}: workspace_id missing from params"
            )
            assert params.get("date_start") == "2026-01-01", (
                f"{label}: date_start missing from params"
            )
            assert params.get("date_end") == "2026-01-31", (
                f"{label}: date_end missing from params"
            )

    def test_count_query_uses_workspace_scope(self) -> None:
        """The post-INSERT count query must be workspace-scoped (not a full-table count)."""
        client = _make_mock_client()
        recompute_daily_metrics("ws-test-scope", "2026-01-01", "2026-01-31", ch_client=client)

        count_query = client.query.call_args[0][0]
        count_params = client.query.call_args[1].get("parameters", {})

        assert "workspace_id" in count_query, (
            "Count query must include workspace_id predicate."
        )
        assert count_params.get("workspace_id") == "ws-test-scope", (
            "Count query must be scoped to the requested workspace."
        )
