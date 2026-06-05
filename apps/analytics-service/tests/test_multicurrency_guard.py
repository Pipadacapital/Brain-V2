"""test_multicurrency_guard.py — Multi-currency CM guard tests (P1-A, ruling G).

@paradigm: sql
Cost-routing: zero LLM tokens; pure Python unit tests.

Ruling G: A workspace with orders in more than one currency_code MUST be
blocked from CM metric computation.  Summing AED + INR is arithmetically
invalid and produces silently wrong CM2/CM3 figures, corrupting the
%-of-GMV billing base.

The guard is implemented as:
  1. workspaces.multi_currency_blocked = TRUE (DB flag set by migration 34).
  2. analytics-service raises MultiCurrencyBlockedError before any metric
     INSERT when this flag is set.
  3. The CI gate (check_codegen_drift.py) cannot fire because currency data
     is runtime, not codegen — this test suite is the enforcement mechanism.

Positive scenarios:
  1. Single-currency workspace (INR only) → guard is not triggered.
  2. Multi-currency workspace (INR + AED) → guard triggers BLOCKED status.
  3. workspace with no orders → guard is not triggered (no data, no mix).
  4. workspace flag multi_currency_blocked=True → blocked regardless of data.

Negative scenarios:
  5. Multi-currency workspace must NOT produce CM row (assert no INSERT call).
  6. Single-currency workspace with flag=False → produces CM row normally.
"""

from __future__ import annotations

import pytest

from src.application.contexts.metric_engine.multicurrency_guard import (
    MultiCurrencyBlockedError,
    check_multi_currency_guard,
)


class TestMultiCurrencyGuard:
    """Ruling G: multi-currency CM guard unit tests."""

    # -------------------------------------------------------------------
    # Positive scenarios
    # -------------------------------------------------------------------

    def test_single_currency_passes(self) -> None:
        """A workspace with only INR orders passes the guard."""
        result = check_multi_currency_guard(
            workspace_id="ws-test-inr",
            currency_codes={"INR"},
            multi_currency_blocked_flag=False,
        )
        assert result.blocked is False
        assert result.reason is None

    def test_empty_currency_set_passes(self) -> None:
        """A workspace with no orders (empty set) passes — no data, no mix."""
        result = check_multi_currency_guard(
            workspace_id="ws-test-empty",
            currency_codes=set(),
            multi_currency_blocked_flag=False,
        )
        assert result.blocked is False

    def test_multi_currency_triggers_blocked(self) -> None:
        """A workspace with INR + AED orders is blocked."""
        result = check_multi_currency_guard(
            workspace_id="ws-test-multi",
            currency_codes={"INR", "AED"},
            multi_currency_blocked_flag=False,
        )
        assert result.blocked is True
        assert "INR" in result.reason or "AED" in result.reason

    def test_db_flag_true_blocks_regardless_of_currencies(self) -> None:
        """If multi_currency_blocked_flag is True, block even for single currency."""
        result = check_multi_currency_guard(
            workspace_id="ws-test-flagged",
            currency_codes={"INR"},
            multi_currency_blocked_flag=True,
        )
        assert result.blocked is True
        assert "multi_currency_blocked" in result.reason.lower()

    # -------------------------------------------------------------------
    # Negative scenarios
    # -------------------------------------------------------------------

    def test_multi_currency_raises_when_assert_mode(self) -> None:
        """In assert mode, multi-currency raises MultiCurrencyBlockedError."""
        with pytest.raises(MultiCurrencyBlockedError, match="BLOCKED_MULTICURRENCY"):
            check_multi_currency_guard(
                workspace_id="ws-test-raise",
                currency_codes={"INR", "AED"},
                multi_currency_blocked_flag=False,
                raise_on_blocked=True,
            )

    def test_single_currency_flag_false_does_not_raise(self) -> None:
        """Single currency, flag=False → no exception in assert mode."""
        # Should not raise.
        result = check_multi_currency_guard(
            workspace_id="ws-test-ok",
            currency_codes={"INR"},
            multi_currency_blocked_flag=False,
            raise_on_blocked=True,
        )
        assert result.blocked is False

    def test_two_currencies_same_prefix_blocked(self) -> None:
        """USD vs USDT (hypothetical) are distinct currencies — blocked."""
        result = check_multi_currency_guard(
            workspace_id="ws-test-usd",
            currency_codes={"USD", "USDT"},
            multi_currency_blocked_flag=False,
        )
        assert result.blocked is True

    def test_workspace_id_in_error_message(self) -> None:
        """MultiCurrencyBlockedError must mention the workspace_id."""
        with pytest.raises(MultiCurrencyBlockedError) as exc_info:
            check_multi_currency_guard(
                workspace_id="ws-abc-123",
                currency_codes={"INR", "AED"},
                multi_currency_blocked_flag=False,
                raise_on_blocked=True,
            )
        assert "ws-abc-123" in str(exc_info.value)
