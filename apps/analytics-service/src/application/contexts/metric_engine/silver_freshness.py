"""
silver_freshness.py — Silver-tier freshness tracking and gold-recompute gate.

@paradigm: sql
Cost-routing: zero LLM tokens; CH read/write only.

Amendment 4 (Rohan, Stage-1, P1-E):
  emit silver_freshness{workspace_id,date}
  recompute_daily MUST gate gold recompute on it during any replay window.

MECHANISM:
  1. emit_silver_freshness(workspace_id, date, rows_written, source, client)
     — UPSERTs a row in brain.silver_freshness_log for each date that the
       transform worker (or backfill / manual ops) updates silver facts.
     — Called by the transform worker after each silver UPSERT batch.
     — Future: also used by the morning-brief pipeline to verify that the
       gold data it narrates is grounded in fresh silver.

  2. check_silver_freshness(workspace_id, date, client) → bool
     — Returns True if a silver_freshness_log row exists for (workspace_id, date).
     — Used by recompute_daily during replay windows to gate gold writes.

  3. gate_gold_recompute(workspace_id, date_start, date_end, client)
     → list[date]
     — Returns only the dates in the window that have fresh silver.
     — recompute_daily calls this and skips dates not in the returned list.
     — Non-replay mode: returns all dates (no gate — silver freshness check
       is a replay-window guard, not a live-recompute guard, because the
       live path (ingestion → silver → gold) is driven by the same tick).

REPLAY MODE:
  A replay run passes replay_run_id (a non-None string) to recompute_daily.
  In replay mode recompute_daily calls gate_gold_recompute() and only writes
  gold rows for dates with silver_freshness_log entries.  This prevents a
  replayed gold rollup from silently producing stale metrics on dates whose
  silver was not yet backfilled.

NON-REPLAY MODE:
  In normal daily tick mode replay_run_id is None and recompute_daily skips
  the gate (fast path, no extra CH query).  The transform worker is the sole
  writer of silver; if it succeeds the freshness entries are present.

USAGE:
    from src.application.contexts.metric_engine.silver_freshness import (
        emit_silver_freshness,
        gate_gold_recompute,
    )

    # After transform worker writes silver rows for 2026-06-01:
    emit_silver_freshness(workspace_id, date(2026, 6, 1), rows_written=142, client=ch)

    # In replay recompute:
    fresh_dates = gate_gold_recompute(workspace_id, "2026-01-01", "2026-06-01", ch)
    # Only recompute gold for fresh_dates.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from brain_cost_router import paradigm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SQL constants
# ---------------------------------------------------------------------------

_EMIT_SQL = """
INSERT INTO brain.silver_freshness_log
(workspace_id, date, rows_written, source, refreshed_at)
VALUES
(%(workspace_id)s, %(date)s, %(rows_written)s, %(source)s, now64())
"""

_FRESH_DATES_SQL = """
SELECT date
FROM brain.silver_freshness_log FINAL
WHERE workspace_id = %(workspace_id)s
  AND date >= toDate(%(date_start)s)
  AND date <= toDate(%(date_end)s)
ORDER BY date
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@paradigm("sql")
def emit_silver_freshness(
    workspace_id: str,
    as_of_date: date,
    *,
    rows_written: int = 0,
    source: str = "transform_worker",
    client: Any,
) -> None:
    """Record that silver facts for (workspace_id, as_of_date) are fresh.

    @paradigm: sql
    Idempotent: ReplacingMergeTree(refreshed_at) keeps the latest entry.
    The transform worker calls this after each successful silver UPSERT batch.

    Args:
        workspace_id:  authenticated workspace scope (fail-closed on empty).
        as_of_date:    the date whose silver is now fresh.
        rows_written:  how many silver rows were written for this date.
        source:        'transform_worker' | 'backfill_worker' | 'manual'.
        client:        ClickHouse client (injected; never built here).

    Raises:
        ValueError: if workspace_id is falsy.
    """
    if not workspace_id or not workspace_id.strip():
        raise ValueError(
            "emit_silver_freshness: workspace_id must not be empty. "
            "CF-C4-QUERY-SCOPE-ISOLATION-1."
        )
    params = {
        "workspace_id": workspace_id,
        "date": str(as_of_date),
        "rows_written": int(rows_written),
        "source": source,
    }
    client.command(_EMIT_SQL, parameters=params)
    logger.debug(
        "silver_freshness: emitted workspace=%s date=%s rows=%d source=%s",
        workspace_id, as_of_date, rows_written, source,
    )


@paradigm("sql")
def gate_gold_recompute(
    workspace_id: str,
    date_start: str,
    date_end: str,
    *,
    client: Any,
) -> list[date]:
    """Return dates in [date_start, date_end] that have fresh silver.

    @paradigm: sql
    Called by recompute_daily in REPLAY mode only.  The returned list is the
    set of dates for which gold recompute is safe (silver was confirmed fresh).
    Dates not in the returned list are SKIPPED — gold is NOT written for them,
    preventing stale gold on un-replayed silver.

    Args:
        workspace_id:  authenticated workspace scope.
        date_start:    inclusive window start, ISO 'YYYY-MM-DD'.
        date_end:      inclusive window end,   ISO 'YYYY-MM-DD'.
        client:        ClickHouse client.

    Returns:
        Sorted list of date objects with silver_freshness_log entries.
        Empty list = no fresh silver in the window → caller skips all dates.

    Raises:
        ValueError: if workspace_id is falsy.
    """
    if not workspace_id or not workspace_id.strip():
        raise ValueError(
            "gate_gold_recompute: workspace_id must not be empty. "
            "CF-C4-QUERY-SCOPE-ISOLATION-1."
        )

    params = {
        "workspace_id": workspace_id,
        "date_start": date_start,
        "date_end": date_end,
    }
    result = client.query(_FRESH_DATES_SQL, parameters=params)
    fresh: list[date] = []
    for row in result.result_rows:
        d = row[0]
        if isinstance(d, date):
            fresh.append(d)
        else:
            # CH may return date as string in some drivers
            fresh.append(date.fromisoformat(str(d)))

    logger.info(
        "gate_gold_recompute: workspace=%s window=[%s,%s] fresh_dates=%d",
        workspace_id, date_start, date_end, len(fresh),
    )
    return sorted(fresh)


@paradigm("sql")
def all_dates_in_window(date_start: str, date_end: str) -> list[date]:
    """Return every date in the inclusive [date_start, date_end] window.

    Helper used in tests and the non-replay fast-path assertion.
    Pure Python — no CH query.
    """
    start = date.fromisoformat(date_start)
    end = date.fromisoformat(date_end)
    if start > end:
        return []
    result = []
    current = start
    while current <= end:
        result.append(current)
        current += timedelta(days=1)
    return result
