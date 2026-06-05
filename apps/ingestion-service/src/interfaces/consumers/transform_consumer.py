"""
Transform-graduation consumer — reads bronze off the migration-28 cursor,
dispatches (vendor, event_type) → mapper, idempotently UPSERTs silver.

@paradigm: sql
  Pure deterministic JSON extraction + PG UPSERT. No ML, no LLM.
  Every mapper in the registry carries @paradigm("sql").

P1-B (data-warehouse-implementation-plan.md §B7):
  Tasks 1–5 all live here or in the sub-modules it calls:
    1. Read bronze WHERE received_at > cursor (PG raw_event_transform_state).
    2. Dispatch via TransformRegistry (domain/transform/transform_registry.py).
    3. Stamp raw_event_id + provenance on every UPSERT.
    4. DLQ on terminal failure + cursor advances past poison event.
    5. Per-(workspace,vendor) circuit breaker + transform_lag_seconds metric.

Amendment 2 (Rohan Stage-1 — shadow-mode shell):
  The consumer + registry + cursor loop is started unconditionally when
  TRANSFORM_GRADUATION_WORKER=true, but the registry may have no mappers
  yet for a given (vendor, event_type) — in that case the row is skipped
  (not DLQ'd).  The shell is runnable from P0-C forward as a no-op.

Amendment 3 (Rohan Stage-1 — fail-closed on cursor-table unavailability):
  Before each tick the consumer checks that raw_event_transform_state is
  reachable.  If the check fails:
    - Logs ERROR with "STALL: cursor table unavailable"
    - Sleeps CURSOR_HEALTH_RETRY_SECS before retrying
    - Does NOT advance the cursor, skip rows, or produce silent gaps
  This ensures a PG outage is a visible stall, not a silent data loss.

Feature flag:
  TRANSFORM_GRADUATION_WORKER (default OFF — B6 §2, B10 step 5).
  ON only after BRONZE_RAW_ARCHIVER is green and bronze has rows.
  Shadow mode: run with flag ON against a shadow CH to diff vs. bespoke
  Shopify path before retiring realtime-facts-consumer.ts (B10 step 5).

Cursor contract (migration 28):
  Table: public.raw_event_transform_state
  Key:   (workspace_id, vendor, event_type)
  Col:   last_processed_received_at TIMESTAMPTZ — the worker reads CH rows
         WHERE received_at > last_processed_received_at AND
               received_at <= NOW() - PROCESSING_GRACE_SECS (avoid hot edge)
  The cursor is advanced ONLY after a successful UPSERT (or a terminal
  failure that routes to DLQ — poison events must not head-of-line block).

NEVERLOG: payload bytes are never logged. Only workspace_id, vendor,
event_type, idempotency_key, and outcome appear in log lines.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, AsyncIterator, Optional, Sequence

from src.domain.transform.circuit_breaker import CircuitBreaker, CircuitState
from src.domain.transform.transform_registry import TransformRegistry, get_registry
from src.application.use_cases.graduate_raw_event import graduate_raw_event, GraduationResult
from src.infrastructure.kafka.dlq_producer import produce_dlq_event, DLQ_TOPIC_NAME

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Seconds between transform ticks (how often the worker polls bronze).
TICK_INTERVAL_SECS: int = int(os.environ.get("TRANSFORM_TICK_INTERVAL_SECS", "10"))

#: Max bronze rows read per tick per (workspace, vendor, event_type).
BATCH_SIZE: int = int(os.environ.get("TRANSFORM_BATCH_SIZE", "500"))

#: Avoid the hot edge (rows within this many seconds of now may still be
#: arriving from the archiver consumer).
PROCESSING_GRACE_SECS: int = int(os.environ.get("TRANSFORM_GRACE_SECS", "5"))

#: Seconds to sleep between retries when the cursor table is unavailable
#: (Amendment 3 — fail-closed, logged stall).
CURSOR_HEALTH_RETRY_SECS: int = int(os.environ.get("CURSOR_HEALTH_RETRY_SECS", "30"))

#: DLQ source topic name for transform errors.
TRANSFORM_SOURCE_TOPIC: str = "integrations.transform.v1"

# ---------------------------------------------------------------------------
# In-process metrics (CloudWatch wiring at Stage-8)
# ---------------------------------------------------------------------------

_TRANSFORM_COUNTERS: dict[str, Any] = {
    "transform_rows_processed_total": 0,
    "transform_rows_skipped_total": 0,
    "transform_rows_dlq_total": 0,
    "transform_rows_upserted_total": 0,
    "transform_ticks_total": 0,
    "transform_cursor_stalls_total": 0,
}

# Per-workspace lag gauge (seconds) — updated each tick.
_TRANSFORM_LAG_SECONDS: dict[str, float] = {}


def _t_inc(counter: str, amount: int = 1) -> None:
    _TRANSFORM_COUNTERS[counter] = _TRANSFORM_COUNTERS.get(counter, 0) + amount


def _set_lag(workspace_id: str, lag_s: float) -> None:
    """Update transform_lag_seconds{workspace_id} gauge."""
    _TRANSFORM_LAG_SECONDS[workspace_id] = lag_s
    if lag_s > 300:  # >5 min: warn threshold
        logger.warning(
            "transform_consumer: lag WARNING workspace_id=%r lag_seconds=%.1f "
            "(threshold=300s)",
            workspace_id, lag_s,
        )
    if lag_s > 900:  # >15 min: page threshold
        logger.error(
            "transform_consumer: lag PAGE workspace_id=%r lag_seconds=%.1f "
            "(page threshold=900s) — CHECK CIRCUIT BREAKER + DLQ",
            workspace_id, lag_s,
        )


def get_transform_counters() -> dict[str, Any]:
    return dict(_TRANSFORM_COUNTERS)


def get_lag_gauges() -> dict[str, float]:
    return dict(_TRANSFORM_LAG_SECONDS)


def reset_transform_counters() -> None:
    for k in list(_TRANSFORM_COUNTERS):
        _TRANSFORM_COUNTERS[k] = 0
    _TRANSFORM_LAG_SECONDS.clear()


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _worker_enabled() -> bool:
    return os.environ.get("TRANSFORM_GRADUATION_WORKER", "false").strip().lower() == "true"


# ---------------------------------------------------------------------------
# Cursor helpers (PG raw_event_transform_state, migration 28)
# ---------------------------------------------------------------------------

# SQL to read the cursor for all (workspace_id, vendor, event_type) rows.
_GET_ALL_CURSORS_SQL = """
SELECT workspace_id::text, vendor, event_type, last_processed_received_at
FROM public.raw_event_transform_state
ORDER BY workspace_id, vendor, event_type
"""

# SQL to check cursor-table reachability (Amendment 3 — fail-closed).
_CURSOR_HEALTH_SQL = "SELECT 1 FROM public.raw_event_transform_state LIMIT 1"

# SQL to advance the cursor.
_ADVANCE_CURSOR_SQL = """
INSERT INTO public.raw_event_transform_state
    (workspace_id, vendor, event_type, last_processed_received_at, updated_at, status)
VALUES
    (%(workspace_id)s::uuid, %(vendor)s, %(event_type)s, %(received_at)s, now(), 'idle')
ON CONFLICT (workspace_id, vendor, event_type)
DO UPDATE SET
    last_processed_received_at = EXCLUDED.last_processed_received_at,
    updated_at                 = now(),
    status                     = 'idle',
    error                      = NULL
"""

# SQL to mark a cursor as errored (terminal failure after DLQ).
_MARK_CURSOR_ERROR_SQL = """
UPDATE public.raw_event_transform_state
SET status    = 'errored',
    error     = %(error)s,
    updated_at = now()
WHERE workspace_id = %(workspace_id)s::uuid
  AND vendor       = %(vendor)s
  AND event_type   = %(event_type)s
"""


# ---------------------------------------------------------------------------
# Bronze batch query (ClickHouse)
# ---------------------------------------------------------------------------

_BRONZE_BATCH_SQL = """
SELECT
    workspace_id,
    vendor,
    event_type,
    idempotency_key,
    received_at,
    payload,
    customer_ref
FROM brain.connector_raw_events
WHERE workspace_id = {workspace_id:String}
  AND vendor       = {vendor:String}
  AND event_type   = {event_type:String}
  AND received_at > {cursor_ts:DateTime64}
  AND received_at <= {grace_ts:DateTime64}
ORDER BY received_at ASC
LIMIT {batch_size:UInt32}
"""


@dataclass
class BronzeRow:
    workspace_id: str
    vendor: str
    event_type: str
    idempotency_key: str
    received_at: datetime
    payload: str
    customer_ref: str


def _query_bronze_batch(
    ch_client: Any,
    workspace_id: str,
    vendor: str,
    event_type: str,
    cursor_ts: datetime,
    batch_size: int = BATCH_SIZE,
) -> list[BronzeRow]:
    """
    Read up to batch_size bronze rows for (workspace, vendor, event_type)
    WHERE received_at > cursor_ts AND received_at <= now() - grace.

    Returns a list of BronzeRow ordered by received_at ASC.
    """
    grace_ts = datetime.now(timezone.utc) - timedelta(seconds=PROCESSING_GRACE_SECS)
    # If cursor_ts is naive, make it UTC.
    if cursor_ts.tzinfo is None:
        cursor_ts = cursor_ts.replace(tzinfo=timezone.utc)

    try:
        result = ch_client.query(
            _BRONZE_BATCH_SQL,
            parameters={
                "workspace_id": workspace_id,
                "vendor": vendor,
                "event_type": event_type,
                "cursor_ts": cursor_ts,
                "grace_ts": grace_ts,
                "batch_size": batch_size,
            },
        )
        rows = []
        for r in result.result_rows:
            received_at = r[4]
            if isinstance(received_at, datetime) and received_at.tzinfo is None:
                received_at = received_at.replace(tzinfo=timezone.utc)
            rows.append(BronzeRow(
                workspace_id=str(r[0]),
                vendor=str(r[1]),
                event_type=str(r[2]),
                idempotency_key=str(r[3]),
                received_at=received_at,
                payload=str(r[5]),
                customer_ref=str(r[6]) if r[6] else "",
            ))
        return rows
    except Exception as exc:
        logger.error(
            "transform_consumer: bronze query failed workspace_id=%r vendor=%r "
            "event_type=%r error=%s",
            workspace_id, vendor, event_type, exc,
        )
        raise


# ---------------------------------------------------------------------------
# Cursor health check (Amendment 3 — fail-closed)
# ---------------------------------------------------------------------------

async def _check_cursor_table_health(pg_conn: Any) -> bool:
    """
    Return True if the cursor table is reachable.

    If False the consumer STALLS (logged ERROR, no silent gap).
    Amendment 3: the worker MUST fail-closed on PG cursor-table unavailability.

    Supports both async context managers (real psycopg) and sync context
    managers (unit-test fakes).
    """
    try:
        cur_ctx = pg_conn.cursor()
        if hasattr(cur_ctx, "__aenter__"):
            async with cur_ctx as cur:
                await cur.execute(_CURSOR_HEALTH_SQL)
        else:
            with cur_ctx as cur:
                import inspect
                if inspect.iscoroutinefunction(getattr(cur, "execute", None)):
                    await cur.execute(_CURSOR_HEALTH_SQL)
                else:
                    cur.execute(_CURSOR_HEALTH_SQL)
        return True
    except Exception as exc:
        logger.error(
            "transform_consumer: STALL — cursor table unavailable: %s", exc
        )
        return False


# ---------------------------------------------------------------------------
# Process one bronze row
# ---------------------------------------------------------------------------

async def _process_one_row(
    *,
    row: BronzeRow,
    pg_conn: Any,
    dlq_producer: Any,
    circuit_breaker: CircuitBreaker,
    registry: TransformRegistry,
) -> bool:
    """
    Process one bronze row: dispatch → UPSERT or DLQ.

    Returns True if the cursor should advance past this row.
    Returns False ONLY on a retryable DB error (cursor must NOT advance).

    Terminal errors (JSON/mapper) route to DLQ + return True (cursor advances).
    Circuit-open events route to DLQ + return True (cursor advances).
    """
    ws = row.workspace_id
    vendor = row.vendor
    event_type = row.event_type
    raw_event_id = row.idempotency_key

    # Circuit-breaker check
    if circuit_breaker.is_open(ws, vendor):
        logger.warning(
            "transform_consumer: circuit OPEN — DLQ-routing workspace_id=%r vendor=%r "
            "event_type=%r raw_event_id=%r",
            ws, vendor, event_type, raw_event_id,
        )
        await _send_to_dlq(
            dlq_producer=dlq_producer,
            row=row,
            error_class="CircuitOpenError",
            error_detail="Circuit breaker is OPEN — event routed to DLQ",
        )
        _t_inc("transform_rows_dlq_total")
        return True  # Advance cursor past this event

    # Attempt graduation
    try:
        result: GraduationResult = await graduate_raw_event(
            workspace_id=ws,
            vendor=vendor,
            event_type=event_type,
            payload_json=row.payload,
            raw_event_id=raw_event_id,
            pg_conn=pg_conn,
            registry=registry,
        )
    except ValueError as terminal_exc:
        # JSON decode or mapper-validation error — terminal (DLQ + advance cursor)
        logger.error(
            "transform_consumer: TERMINAL (DLQ) workspace_id=%r vendor=%r "
            "event_type=%r raw_event_id=%r error=%s",
            ws, vendor, event_type, raw_event_id, terminal_exc,
        )
        circuit_breaker.record_failure(ws, vendor)
        await _send_to_dlq(
            dlq_producer=dlq_producer,
            row=row,
            error_class=type(terminal_exc).__name__,
            error_detail=str(terminal_exc),
        )
        _t_inc("transform_rows_dlq_total")
        return True  # Advance cursor (poison event must not head-of-line block)

    except Exception as db_exc:
        # DB / retryable error — do NOT advance cursor
        logger.error(
            "transform_consumer: RETRYABLE error workspace_id=%r vendor=%r "
            "event_type=%r raw_event_id=%r error_class=%s error=%s",
            ws, vendor, event_type, raw_event_id, type(db_exc).__name__, db_exc,
        )
        circuit_breaker.record_failure(ws, vendor)
        return False  # Do NOT advance cursor — retry next tick

    # Success
    circuit_breaker.record_success(ws, vendor)
    if result.skipped:
        _t_inc("transform_rows_skipped_total")
    else:
        _t_inc("transform_rows_upserted_total")
    _t_inc("transform_rows_processed_total")
    return True  # Advance cursor


async def _send_to_dlq(
    *,
    dlq_producer: Any,
    row: BronzeRow,
    error_class: str,
    error_detail: str,
) -> None:
    """Send a bronze row to the DLQ (non-fatal: DLQ failure is logged, not re-raised)."""
    if dlq_producer is None:
        logger.warning(
            "transform_consumer: no DLQ producer — cannot route raw_event_id=%r to DLQ",
            row.idempotency_key,
        )
        return
    await produce_dlq_event(
        producer=dlq_producer,
        raw_event_id=row.idempotency_key,
        workspace_id=row.workspace_id,
        vendor=row.vendor,
        event_type=row.event_type,
        error_class=error_class,
        error_detail=error_detail,
        source_topic=TRANSFORM_SOURCE_TOPIC,
        source_partition=0,
        source_offset=0,
        raw_bytes=row.payload.encode("utf-8") if row.payload else None,
    )


# ---------------------------------------------------------------------------
# PG cursor read / advance helpers
# ---------------------------------------------------------------------------

async def _exec_on_conn(pg_conn: Any, sql: str, params: Any = None) -> Any:
    """Execute SQL on pg_conn, supporting async and sync context managers."""
    import inspect
    cur_ctx = pg_conn.cursor()
    if hasattr(cur_ctx, "__aenter__"):
        async with cur_ctx as cur:
            await cur.execute(sql, params)
            if hasattr(cur, "fetchall"):
                return await cur.fetchall() if inspect.iscoroutinefunction(cur.fetchall) else cur.fetchall()
    else:
        with cur_ctx as cur:
            if inspect.iscoroutinefunction(getattr(cur, "execute", None)):
                await cur.execute(sql, params)
            else:
                cur.execute(sql, params)
            if hasattr(cur, "fetchall"):
                return cur.fetchall()
    return None


async def _read_all_cursors(pg_conn: Any) -> list[dict]:
    """Read all cursor rows from raw_event_transform_state."""
    rows = await _exec_on_conn(pg_conn, _GET_ALL_CURSORS_SQL) or []

    result = []
    for r in rows:
        result.append({
            "workspace_id": str(r[0]),
            "vendor": str(r[1]),
            "event_type": str(r[2]),
            "last_processed_received_at": r[3],
        })
    return result


async def _advance_cursor(
    pg_conn: Any,
    workspace_id: str,
    vendor: str,
    event_type: str,
    received_at: datetime,
) -> None:
    """Advance the cursor to received_at (the timestamp of the last processed row)."""
    params = {
        "workspace_id": workspace_id,
        "vendor": vendor,
        "event_type": event_type,
        "received_at": received_at,
    }
    await _exec_on_conn(pg_conn, _ADVANCE_CURSOR_SQL, params)


# ---------------------------------------------------------------------------
# Tick function (one cursor-loop iteration)
# ---------------------------------------------------------------------------

async def run_transform_tick(
    *,
    pg_conn: Any,
    ch_client: Any,
    dlq_producer: Any,
    registry: Optional[TransformRegistry] = None,
    circuit_breaker: Optional[CircuitBreaker] = None,
    batch_size: int = BATCH_SIZE,
) -> dict[str, int]:
    """
    Run one transform tick: read cursors → query bronze → graduate rows.

    Amendment 3 (fail-closed on cursor-table unavailability):
      If the cursor table is unreachable, returns immediately with
      {"stall": 1} without advancing any cursor or processing any rows.
      The caller (the loop) is responsible for sleeping + retrying.

    Returns:
        dict with tick stats: processed, upserted, skipped, dlq, stall.
    """
    if registry is None:
        registry = get_registry()
    if circuit_breaker is None:
        circuit_breaker = _DEFAULT_BREAKER

    stats = {"processed": 0, "upserted": 0, "skipped": 0, "dlq": 0, "stall": 0}

    # Amendment 3: fail-closed on cursor-table unavailability
    healthy = await _check_cursor_table_health(pg_conn)
    if not healthy:
        _t_inc("transform_cursor_stalls_total")
        stats["stall"] = 1
        logger.error(
            "transform_consumer: STALL — cursor table unreachable. "
            "No rows will be processed until PG is restored. "
            "This is a logged stall, NOT a silent gap (Amendment 3)."
        )
        return stats

    # Read all active cursor positions
    try:
        cursors = await _read_all_cursors(pg_conn)
    except Exception as exc:
        _t_inc("transform_cursor_stalls_total")
        stats["stall"] = 1
        logger.error("transform_consumer: failed to read cursors: %s", exc)
        return stats

    _t_inc("transform_ticks_total")

    for cursor in cursors:
        ws = cursor["workspace_id"]
        vendor = cursor["vendor"]
        event_type = cursor["event_type"]
        cursor_ts: Optional[datetime] = cursor["last_processed_received_at"]

        # If no cursor yet, start from epoch (pick up all rows)
        if cursor_ts is None:
            cursor_ts = datetime(1970, 1, 1, tzinfo=timezone.utc)
        elif cursor_ts.tzinfo is None:
            cursor_ts = cursor_ts.replace(tzinfo=timezone.utc)

        # Update lag metric
        lag_s = (datetime.now(timezone.utc) - cursor_ts).total_seconds()
        _set_lag(ws, lag_s)

        # Query bronze batch
        try:
            bronze_rows = _query_bronze_batch(
                ch_client=ch_client,
                workspace_id=ws,
                vendor=vendor,
                event_type=event_type,
                cursor_ts=cursor_ts,
                batch_size=batch_size,
            )
        except Exception:
            # Bronze query failed — skip this cursor, retry next tick
            continue

        if not bronze_rows:
            continue  # Nothing to process for this cursor

        last_advanced_ts: Optional[datetime] = None

        for row in bronze_rows:
            advance = await _process_one_row(
                row=row,
                pg_conn=pg_conn,
                dlq_producer=dlq_producer,
                circuit_breaker=circuit_breaker,
                registry=registry,
            )

            if advance:
                last_advanced_ts = row.received_at
                # Tally result
                # (actual upserted/skipped/dlq counted inside _process_one_row)
            else:
                # Retryable DB error — stop processing this cursor batch
                break

        # Advance cursor to the last successfully-processed (or DLQ-routed) row
        if last_advanced_ts is not None:
            try:
                await _advance_cursor(pg_conn, ws, vendor, event_type, last_advanced_ts)
            except Exception as exc:
                logger.error(
                    "transform_consumer: failed to advance cursor workspace_id=%r "
                    "vendor=%r event_type=%r error=%s",
                    ws, vendor, event_type, exc,
                )
                # Do not re-raise — we processed some rows; the worst case is
                # re-processing the batch on the next tick (idempotent UPSERT).

        stats["processed"] += len(bronze_rows)

    # Copy counters into stats for this tick
    stats["upserted"] = _TRANSFORM_COUNTERS.get("transform_rows_upserted_total", 0)
    stats["skipped"] = _TRANSFORM_COUNTERS.get("transform_rows_skipped_total", 0)
    stats["dlq"] = _TRANSFORM_COUNTERS.get("transform_rows_dlq_total", 0)
    return stats


# ---------------------------------------------------------------------------
# Default circuit breaker singleton (one per process)
# ---------------------------------------------------------------------------

_DEFAULT_BREAKER = CircuitBreaker()


# ---------------------------------------------------------------------------
# Consumer loop (long-running, called by main.py or a background task)
# ---------------------------------------------------------------------------

async def start_transform_consumer(
    *,
    pg_conn: Any,
    ch_client: Any,
    dlq_producer: Any = None,
    registry: Optional[TransformRegistry] = None,
    circuit_breaker: Optional[CircuitBreaker] = None,
    tick_interval_secs: int = TICK_INTERVAL_SECS,
) -> None:
    """
    Start the transform-graduation consumer loop.

    Amendment 2 (shadow-mode shell): the loop runs whenever
    TRANSFORM_GRADUATION_WORKER=true.  It can be started from P0-C forward
    as a no-op when no cursors exist or no mappers are registered.

    Amendment 3: if the cursor table is unreachable, the loop STALLS with a
    logged ERROR and retries every CURSOR_HEALTH_RETRY_SECS seconds —
    it does NOT silently advance or skip rows (fail-closed).

    Args:
        pg_conn:            psycopg async connection (or mock in tests).
        ch_client:          clickhouse_connect client (or mock in tests).
        dlq_producer:       aiokafka producer (or mock in tests); None = DLQ disabled.
        registry:           TransformRegistry override (default: global singleton).
        circuit_breaker:    CircuitBreaker override (default: global singleton).
        tick_interval_secs: Seconds between ticks.
    """
    if not _worker_enabled():
        logger.info(
            "transform_consumer: TRANSFORM_GRADUATION_WORKER=false — worker not started. "
            "Set TRANSFORM_GRADUATION_WORKER=true after BRONZE_RAW_ARCHIVER is green "
            "and bronze has rows (B10 step 5)."
        )
        return

    logger.info(
        "transform_consumer: starting shadow-mode consumer loop "
        "(tick_interval=%ds batch_size=%d)",
        tick_interval_secs, BATCH_SIZE,
    )

    while True:
        try:
            stats = await run_transform_tick(
                pg_conn=pg_conn,
                ch_client=ch_client,
                dlq_producer=dlq_producer,
                registry=registry,
                circuit_breaker=circuit_breaker,
            )

            if stats.get("stall"):
                # Cursor table unavailable — fail-closed stall (Amendment 3)
                logger.error(
                    "transform_consumer: stall tick — sleeping %ds before retry",
                    CURSOR_HEALTH_RETRY_SECS,
                )
                await asyncio.sleep(CURSOR_HEALTH_RETRY_SECS)
            else:
                logger.debug(
                    "transform_consumer: tick complete processed=%d upserted=%d "
                    "skipped=%d dlq=%d",
                    stats.get("processed", 0), stats.get("upserted", 0),
                    stats.get("skipped", 0), stats.get("dlq", 0),
                )
                await asyncio.sleep(tick_interval_secs)

        except asyncio.CancelledError:
            logger.info("transform_consumer: cancelled — stopping.")
            return
        except Exception as exc:
            logger.error(
                "transform_consumer: unexpected error in tick loop: %s — "
                "sleeping %ds before retry",
                exc, tick_interval_secs,
            )
            await asyncio.sleep(tick_interval_secs)
