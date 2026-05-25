"""
Cursor persistence contract for the Brain connector framework.

@paradigm: sql
  Pure deterministic contract — no ML, no LLM.
  The cursor tracks the last-processed window boundary per (workspace_id, vendor)
  so that ingest_batch can resume from the correct position on the next run
  and serve BOTH live (bounded-window) and backfill (unbounded-window) on the
  same code path (CF-C3-SINGLE-PRIMITIVE-1).

M4 contract (consumed by P2 ingest_batch):
  - Table: connector_cursor (DDL in step-a-enable-create.sql)
  - Idempotency: UPSERT ON CONFLICT (workspace_id, vendor) DO UPDATE
  - The cursor row is written INSIDE the same with_workspace transaction
    that commits the batch UPSERT — if the batch fails and rolls back,
    the cursor rolls back with it (no phantom-advance).
  - cursor_value: opaque string; adapter-defined (e.g. ISO timestamp,
    page token, offset integer serialised as string)
  - window_start / window_end: the precise window the batch covered
    (used for the Stage-8 count-based parity check and the LOCAL harness)

V4 seam (Track V ingest_batch calls this contract):
  The ingest_batch primitive calls:
    1. get_cursor(conn, workspace_id, vendor) → CursorRow | None
    2. ... fetch + upsert batch ...
    3. upsert_cursor(conn, workspace_id, vendor, cursor_value, window_start, window_end)
  All three calls use the same psycopg.AsyncConnection inside with_workspace.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime


# ---------------------------------------------------------------------------
# Value object
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CursorRow:
    """
    Represents a persisted cursor row for one (workspace_id, vendor) pair.

    cursor_value : adapter-defined opaque string (ISO timestamp / page token)
    window_start : start of the window the last batch covered (inclusive)
    window_end   : end of the window the last batch covered (exclusive)
    updated_at   : DB-stamped timestamp of the last upsert
    """
    workspace_id:  uuid.UUID
    vendor:        str
    cursor_value:  str
    window_start:  datetime
    window_end:    datetime
    updated_at:    datetime


# ---------------------------------------------------------------------------
# SQL — the two queries ingest_batch issues
# ---------------------------------------------------------------------------

GET_CURSOR_SQL = """
SELECT
    workspace_id,
    vendor,
    cursor_value,
    window_start,
    window_end,
    updated_at
FROM connector_cursor
WHERE workspace_id = %(workspace_id)s
  AND vendor       = %(vendor)s
"""

UPSERT_CURSOR_SQL = """
INSERT INTO connector_cursor
    (workspace_id, vendor, cursor_value, window_start, window_end, updated_at)
VALUES
    (%(workspace_id)s, %(vendor)s, %(cursor_value)s,
     %(window_start)s, %(window_end)s, now())
ON CONFLICT (workspace_id, vendor)
DO UPDATE SET
    cursor_value  = EXCLUDED.cursor_value,
    window_start  = EXCLUDED.window_start,
    window_end    = EXCLUDED.window_end,
    updated_at    = now()
"""


async def get_cursor(
    conn,
    workspace_id: uuid.UUID,
    vendor: str,
) -> CursorRow | None:
    """
    Read the current cursor for (workspace_id, vendor).
    Returns None if no cursor exists yet (first-run backfill).

    Called inside an active with_workspace transaction so that the
    workspace_id GUC is set and the RLS policy allows the read.

    Args:
        conn:         psycopg.AsyncConnection (bound inside with_workspace)
        workspace_id: the workspace UUID (already validated by with_workspace)
        vendor:       connector vendor string

    Returns:
        CursorRow if found, None if first run.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            GET_CURSOR_SQL,
            {"workspace_id": str(workspace_id), "vendor": vendor},
        )
        row = await cur.fetchone()

    if row is None:
        return None

    return CursorRow(
        workspace_id = uuid.UUID(str(row[0])),
        vendor       = row[1],
        cursor_value = row[2],
        window_start = row[3],
        window_end   = row[4],
        updated_at   = row[5],
    )


async def upsert_cursor(
    conn,
    workspace_id: uuid.UUID,
    vendor: str,
    cursor_value: str,
    window_start: datetime,
    window_end: datetime,
) -> None:
    """
    Persist (or advance) the cursor for (workspace_id, vendor).

    Called as the LAST write inside the ingest_batch transaction.
    If the transaction rolls back, this write rolls back too —
    the cursor never advances past a failed batch.

    Args:
        conn:         psycopg.AsyncConnection (bound inside with_workspace)
        workspace_id: the workspace UUID
        vendor:       connector vendor string
        cursor_value: new opaque cursor position (adapter-defined)
        window_start: window start that was just ingested (inclusive)
        window_end:   window end that was just ingested (exclusive)
    """
    async with conn.cursor() as cur:
        await cur.execute(
            UPSERT_CURSOR_SQL,
            {
                "workspace_id": str(workspace_id),
                "vendor":       vendor,
                "cursor_value": cursor_value,
                "window_start": window_start,
                "window_end":   window_end,
            },
        )
