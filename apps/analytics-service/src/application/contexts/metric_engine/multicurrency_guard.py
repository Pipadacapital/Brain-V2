"""multicurrency_guard.py — Multi-currency CM guard (P1-A, ruling G).

@paradigm: sql
Cost-routing: zero LLM tokens; pure domain logic.

Ruling G (data-warehouse-implementation-plan.md §P1-A task 5):
  A workspace with orders in more than one currency_code MUST be blocked
  from CM metric computation.  Summing AED + INR is arithmetically invalid
  and produces silently wrong CM1/CM2/CM3 figures — corrupting the
  %-of-GMV billing base.

  The guard is invoked:
    1. By recompute_daily_metrics() before the INSERT into
       brain.workspace_daily_metrics_base for the affected workspace.
    2. By the analytics-service read path when serving CM metrics to the
       Morning Brief / AI agents — returning a BLOCKED_MULTICURRENCY status
       row rather than wrong numbers.
    3. Via the workspaces.multi_currency_blocked DB flag (migration 34)
       which persists the blocked state so the guard fires even when the
       in-memory currency_codes set is unavailable (e.g. cache scenarios).

Design:
  - The guard is pure domain logic (no I/O) so it can be tested without
    a DB connection.  The DB flag lookup and the CH currency set query
    are caller responsibilities; this module processes the results.
  - Result is a GuardResult dataclass rather than a raw bool so callers
    can surface the reason to the Decision Log / observability layer.
"""

from __future__ import annotations

from dataclasses import dataclass


# ─────────────────────────────────────────────────────────────────────────────
# Public exception
# ─────────────────────────────────────────────────────────────────────────────


class MultiCurrencyBlockedError(ValueError):
    """Raised when a CM metric computation is attempted on a blocked workspace.

    Ruling G: a workspace with mixed-currency orders MUST NOT have its CM
    metrics summed across currencies.  This exception surfaces the block
    to the caller rather than returning silently wrong numbers.

    Callers MUST catch this and return a BLOCKED_MULTICURRENCY status,
    never swallow it and insert wrong data.
    """


# ─────────────────────────────────────────────────────────────────────────────
# Guard result
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GuardResult:
    """Result of the multi-currency guard check.

    Attributes:
        workspace_id: the checked workspace.
        blocked: True if CM computation is blocked for this workspace.
        reason: human-readable explanation of why it is blocked (None if not blocked).
        currencies: the set of currency codes seen in the workspace's orders.
    """

    workspace_id: str
    blocked: bool
    reason: str | None
    currencies: frozenset[str]


# ─────────────────────────────────────────────────────────────────────────────
# Guard function
# ─────────────────────────────────────────────────────────────────────────────


def check_multi_currency_guard(
    workspace_id: str,
    currency_codes: set[str],
    multi_currency_blocked_flag: bool,
    *,
    raise_on_blocked: bool = False,
) -> GuardResult:
    """Check whether CM computation is allowed for this workspace.

    Args:
        workspace_id: the workspace being checked.
        currency_codes: the set of distinct non-empty currency codes seen in
            the workspace's connector_order_facts for the recompute window.
            Caller obtains this from:
                SELECT DISTINCT currency_code FROM connector_order_facts
                WHERE workspace_id = %(ws)s AND currency_code != ''
        multi_currency_blocked_flag: the value of
            workspaces.multi_currency_blocked for this workspace.
            Caller obtains this from the PG workspaces table.
        raise_on_blocked: if True, raise MultiCurrencyBlockedError when
            the guard fires.  Useful in the recompute INSERT path.
            If False (default), return a GuardResult with blocked=True.

    Returns:
        GuardResult with blocked=False if computation is allowed,
        or blocked=True with a reason if it is blocked.

    Raises:
        MultiCurrencyBlockedError: if raise_on_blocked=True and blocked=True.
    """
    currencies = frozenset(c for c in currency_codes if c)

    # Case 1: DB flag is set (persisted blocked state).
    if multi_currency_blocked_flag:
        reason = (
            f"workspace {workspace_id!r} has multi_currency_blocked=True "
            f"(set by migration 34 / nightly currency-drift check). "
            f"CM metrics are BLOCKED_MULTICURRENCY until resolved. "
            f"Ruling G: do not sum money across currencies."
        )
        result = GuardResult(
            workspace_id=workspace_id,
            blocked=True,
            reason=reason,
            currencies=currencies,
        )
        if raise_on_blocked:
            raise MultiCurrencyBlockedError(
                f"BLOCKED_MULTICURRENCY: workspace={workspace_id!r}. {reason}"
            )
        return result

    # Case 2: more than one distinct non-empty currency in the current data window.
    if len(currencies) > 1:
        sorted_currencies = ", ".join(sorted(currencies))
        reason = (
            f"workspace {workspace_id!r} has orders in {len(currencies)} distinct "
            f"currencies: [{sorted_currencies}]. "
            f"CM metrics are BLOCKED_MULTICURRENCY — summing across currencies "
            f"produces arithmetically invalid CM1/CM2/CM3. "
            f"Ruling G: multi-currency CM guard (epic-warehouse-medallion-wiring P1-A)."
        )
        result = GuardResult(
            workspace_id=workspace_id,
            blocked=True,
            reason=reason,
            currencies=currencies,
        )
        if raise_on_blocked:
            raise MultiCurrencyBlockedError(
                f"BLOCKED_MULTICURRENCY: workspace={workspace_id!r}. {reason}"
            )
        return result

    # Guard passes.
    return GuardResult(
        workspace_id=workspace_id,
        blocked=False,
        reason=None,
        currencies=currencies,
    )
