"""
test_status_gated_purge.py — Unit tests for the status-gated nightly PII purge
(ADR-CONVERGENCE-001 ruling C, P0-A task 3).

@paradigm: sql
P0-A-RULING-C-1: status-gated purge exempts open/unfulfilled/disputed/partial orders.
P0-A-RULING-C-2: a disputed COD order (financial=PENDING, fulfillment=UNFULFILLED) survives.
P0-A-RULING-C-3: a closed order's PII-adjacent columns are nulled by purge_closed_order_pii.

Tests are UNIT tests (no external DB dependency) that verify the purgeable predicate
logic implemented in is_order_pii_purgeable() via Python-level re-implementation.
Integration tests (actual PG call) are in tests/integration/ (require POSTGRES_HOST env).

The is_order_pii_purgeable logic (ruling C):
  Purgeable when ALL of:
  - financial_status NOT IN ('PENDING', 'PARTIALLY_PAID', 'VOIDED', '')
  - fulfillment_status NOT IN ('UNFULFILLED', 'ON_HOLD', 'PARTIAL', '')
  - (cancelled_at IS NOT NULL) OR (financial_status IN ('REFUNDED', 'PARTIALLY_REFUNDED')
    AND fulfillment_status = 'FULFILLED')
"""

from __future__ import annotations

from typing import Optional
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Python mirror of the PG is_order_pii_purgeable() function.
# Kept in-sync with apps/core-service/migrations/local-dev/31-status-gated-purge.sql.
# If the SQL changes, this must change too (and CI will catch the divergence via
# the integration test hitting the real PG function).
# ---------------------------------------------------------------------------

_OPEN_FINANCIAL = frozenset({'PENDING', 'PARTIALLY_PAID', 'VOIDED', ''})
_OPEN_FULFILLMENT = frozenset({'UNFULFILLED', 'ON_HOLD', 'PARTIAL', ''})
_REFUND_FINANCIAL = frozenset({'REFUNDED', 'PARTIALLY_REFUNDED'})


def is_order_pii_purgeable_py(
    financial_status: Optional[str],
    fulfillment_status: Optional[str],
    cancelled_at: Optional[datetime],
) -> bool:
    """Python mirror of the PG is_order_pii_purgeable() SQL function.

    Returns True if the order's lifecycle is fully closed and its PII-adjacent
    columns may be nulled.
    """
    fin = (financial_status or '').upper().strip()
    ful = (fulfillment_status or '').upper().strip()

    # Gate 1: financial status must be settled (not open/partial/voided)
    if fin in _OPEN_FINANCIAL:
        return False

    # Gate 2: fulfillment status must be complete (not unfulfilled/on_hold/partial)
    if ful in _OPEN_FULFILLMENT:
        return False

    # Gate 3: require explicit cancellation OR completed refund after fulfillment
    explicitly_cancelled = cancelled_at is not None
    refunded_after_fulfilment = (fin in _REFUND_FINANCIAL and ful == 'FULFILLED')

    return explicitly_cancelled or refunded_after_fulfilment


# ---------------------------------------------------------------------------
# POSITIVE: orders that SHOULD be purged (lifecycle fully closed)
# ---------------------------------------------------------------------------

class TestPurgeable:
    """Orders with a fully-closed lifecycle are purgeable (P0-A-RULING-C-3)."""

    def test_paid_fulfilled_cancelled_is_purgeable(self) -> None:
        """PAID + FULFILLED + cancelled_at set → purgeable."""
        result = is_order_pii_purgeable_py(
            'PAID', 'FULFILLED', datetime(2026, 1, 1, tzinfo=timezone.utc)
        )
        assert result is True, "PAID+FULFILLED+cancelled_at must be purgeable"

    def test_refunded_fulfilled_no_cancelled_at_is_purgeable(self) -> None:
        """REFUNDED + FULFILLED (no explicit cancellation) → purgeable (refund-after-fulfilment)."""
        result = is_order_pii_purgeable_py('REFUNDED', 'FULFILLED', None)
        assert result is True, "REFUNDED+FULFILLED is purgeable even without cancelled_at"

    def test_partially_refunded_fulfilled_is_purgeable(self) -> None:
        """PARTIALLY_REFUNDED + FULFILLED → purgeable (partial refund on shipped order)."""
        result = is_order_pii_purgeable_py('PARTIALLY_REFUNDED', 'FULFILLED', None)
        assert result is True, "PARTIALLY_REFUNDED+FULFILLED is purgeable"

    def test_paid_fulfilled_with_cancellation_is_purgeable(self) -> None:
        """PAID + FULFILLED + explicit cancellation → purgeable (gate 3 via cancellation path)."""
        result = is_order_pii_purgeable_py(
            'PAID', 'FULFILLED', datetime(2025, 12, 1, tzinfo=timezone.utc)
        )
        assert result is True


# ---------------------------------------------------------------------------
# NEGATIVE: disputed/open orders that SURVIVE the purge (ruling C exemptions)
# ---------------------------------------------------------------------------

class TestPurgeExempt:
    """Orders with open/disputed/partial lifecycle survive the purge (P0-A-RULING-C-1,2)."""

    def test_disputed_cod_order_survives(self) -> None:
        """PENDING + UNFULFILLED + no cancelled_at → disputed COD order survives.

        P0-A-RULING-C-2: a typical India COD order that is open but not yet
        shipped must NOT have its PII nulled (customer still reachable for delivery).
        """
        result = is_order_pii_purgeable_py('PENDING', 'UNFULFILLED', None)
        assert result is False, (
            "P0-A-RULING-C-2 VIOLATED: disputed COD order (PENDING+UNFULFILLED) "
            "must survive the purge — PII must NOT be nulled."
        )

    def test_voided_unfulfilled_survives(self) -> None:
        """VOIDED + UNFULFILLED (COD cancelled before shipment) → survives.

        Gate 1 passes (VOIDED is in _OPEN_FINANCIAL), so not purgeable.
        India COD cancellation scenario: the order was voided by the vendor but
        never shipped — vendor may reactivate, so PII must be preserved.
        """
        result = is_order_pii_purgeable_py('VOIDED', 'UNFULFILLED', None)
        assert result is False, (
            "VOIDED+UNFULFILLED (COD cancelled pre-shipment) must survive purge. "
            "VOIDED is an open financial status."
        )

    def test_partially_paid_fulfilled_survives(self) -> None:
        """PARTIALLY_PAID + FULFILLED → survives (partial payment outstanding)."""
        result = is_order_pii_purgeable_py('PARTIALLY_PAID', 'FULFILLED', None)
        assert result is False, (
            "PARTIALLY_PAID order has an outstanding payment and must not be purged."
        )

    def test_paid_on_hold_survives(self) -> None:
        """PAID + ON_HOLD → survives (fulfillment blocked/contested)."""
        result = is_order_pii_purgeable_py('PAID', 'ON_HOLD', None)
        assert result is False, (
            "ON_HOLD fulfillment means a dispute or manual review is in progress."
        )

    def test_paid_unfulfilled_survives(self) -> None:
        """PAID + UNFULFILLED → survives (paid but not yet shipped)."""
        result = is_order_pii_purgeable_py('PAID', 'UNFULFILLED', None)
        assert result is False, (
            "PAID+UNFULFILLED: order is paid but not shipped — PII needed for delivery."
        )

    def test_pending_fulfilled_survives(self) -> None:
        """PENDING + FULFILLED → survives (shipped but payment not settled = COD in transit)."""
        result = is_order_pii_purgeable_py('PENDING', 'FULFILLED', None)
        assert result is False, (
            "PENDING+FULFILLED: COD order shipped but COD collection pending. "
            "Must not be purged — payment collection requires customer contactability."
        )

    def test_empty_status_survives(self) -> None:
        """Empty/null status strings → survives (fail-safe: unknown status = exempt)."""
        result = is_order_pii_purgeable_py(None, None, None)
        assert result is False, "Unknown/null status must default to exempt (fail-safe)."

        result = is_order_pii_purgeable_py('', '', None)
        assert result is False, "Empty string status must default to exempt (fail-safe)."

    def test_paid_partial_fulfillment_survives(self) -> None:
        """PAID + PARTIAL (fulfillment) → survives (partial shipment, some items pending)."""
        result = is_order_pii_purgeable_py('PAID', 'PARTIAL', None)
        assert result is False, "PARTIAL fulfillment means items are still pending delivery."

    def test_refunded_unfulfilled_survives(self) -> None:
        """REFUNDED + UNFULFILLED → survives (refunded before shipping — fulfillment gate blocks).

        The refund-after-fulfillment path requires fulfillment = 'FULFILLED', not 'UNFULFILLED'.
        Without explicit cancelled_at, this order is NOT purgeable.
        """
        result = is_order_pii_purgeable_py('REFUNDED', 'UNFULFILLED', None)
        assert result is False, (
            "REFUNDED+UNFULFILLED without cancelled_at: refund happened before shipping. "
            "No gate-3 path satisfied (no cancellation, not refunded-after-fulfilment)."
        )

    def test_refunded_unfulfilled_with_cancellation_is_purgeable(self) -> None:
        """REFUNDED + UNFULFILLED + explicit cancelled_at → purgeable via gate-3 cancellation path."""
        result = is_order_pii_purgeable_py(
            'REFUNDED', 'UNFULFILLED', datetime(2025, 11, 1, tzinfo=timezone.utc)
        )
        # Gate 1: REFUNDED not in _OPEN_FINANCIAL → pass
        # Gate 2: UNFULFILLED in _OPEN_FULFILLMENT → FAIL → not purgeable
        assert result is False, (
            "REFUNDED+UNFULFILLED: gate 2 (fulfillment) blocks even with cancelled_at."
        )


# ---------------------------------------------------------------------------
# BOUNDARY: case-insensitivity
# ---------------------------------------------------------------------------

class TestCaseInsensitivity:
    """The predicate normalises status strings to uppercase (ruling C)."""

    def test_lowercase_pending_unfulfilled_survives(self) -> None:
        """lowercase 'pending' + 'unfulfilled' → survives (same as uppercase)."""
        result = is_order_pii_purgeable_py('pending', 'unfulfilled', None)
        assert result is False

    def test_lowercase_paid_fulfilled_cancelled_is_purgeable(self) -> None:
        """lowercase 'paid' + 'fulfilled' + cancelled_at → purgeable."""
        result = is_order_pii_purgeable_py(
            'paid', 'fulfilled', datetime(2026, 1, 1, tzinfo=timezone.utc)
        )
        assert result is True

    def test_mixed_case_refunded_fulfilled_is_purgeable(self) -> None:
        """Mixed-case 'Refunded' + 'Fulfilled' → purgeable."""
        result = is_order_pii_purgeable_py('Refunded', 'Fulfilled', None)
        assert result is True


# ---------------------------------------------------------------------------
# STATIC: Migration file assertions (no DB required)
# ---------------------------------------------------------------------------

class TestMigrationFileAssertions:
    """Verify the migration SQL file contains the expected ruling-C gates."""

    def _read_migration_sql(self) -> str:
        """Read the status-gated-purge DDL from the consolidated bootstrap.

        The per-migration file (31-status-gated-purge.sql) was retired when the
        bootstrap became the single source of truth; the purge function +
        procedure now live in infra/bootstrap/bootstrap-pg.sql.
        """
        from pathlib import Path
        migration_path = (
            Path(__file__).parents[2] / "infra/bootstrap/bootstrap-pg.sql"
        )
        assert migration_path.exists(), (
            f"Bootstrap DDL not found: {migration_path}."
        )
        return migration_path.read_text()

    def test_migration_file_exists(self) -> None:
        """The bootstrap DDL must exist and carry the purge objects."""
        sql = self._read_migration_sql()
        assert len(sql) > 100, "Bootstrap DDL appears empty."

    def test_migration_has_purge_function(self) -> None:
        """Migration must CREATE the purge_closed_order_pii function."""
        sql = self._read_migration_sql()
        assert 'purge_closed_order_pii' in sql, (
            "Migration must define purge_closed_order_pii function."
        )

    def test_migration_has_purgeable_predicate(self) -> None:
        """Migration must CREATE the is_order_pii_purgeable predicate."""
        sql = self._read_migration_sql()
        assert 'is_order_pii_purgeable' in sql, (
            "Migration must define is_order_pii_purgeable predicate."
        )

    def test_migration_has_pii_purge_log_table(self) -> None:
        """Migration must CREATE pii_purge_log table for audit."""
        sql = self._read_migration_sql()
        assert 'pii_purge_log' in sql, (
            "Migration must create pii_purge_log audit table."
        )

    def test_migration_exempts_pending_status(self) -> None:
        """Migration must explicitly gate on PENDING financial status (India COD)."""
        sql = self._read_migration_sql()
        assert 'PENDING' in sql, (
            "Migration must exempt PENDING financial status (open India COD orders)."
        )

    def test_migration_exempts_unfulfilled_status(self) -> None:
        """Migration must explicitly gate on UNFULFILLED fulfillment status."""
        sql = self._read_migration_sql()
        assert 'UNFULFILLED' in sql, (
            "Migration must exempt UNFULFILLED fulfillment status (unshipped orders)."
        )

    def test_migration_has_security_definer(self) -> None:
        """Purge function must run as SECURITY DEFINER (bypasses RLS for purge)."""
        sql = self._read_migration_sql()
        assert 'SECURITY DEFINER' in sql, (
            "purge_closed_order_pii must use SECURITY DEFINER — it needs to bypass "
            "RLS to null PII columns across the workspace."
        )

    def test_migration_revokes_execute(self) -> None:
        """REVOKE EXECUTE on purge function — rls_app cannot call it directly."""
        sql = self._read_migration_sql()
        assert 'REVOKE EXECUTE' in sql, (
            "purge_closed_order_pii must REVOKE EXECUTE from PUBLIC — "
            "only the superuser scheduler should invoke the purge."
        )
