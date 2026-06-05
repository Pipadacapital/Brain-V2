"""
graduate_raw_event — translate a bronze row into a typed silver fact.

@paradigm: sql
  Pure deterministic translation — JSON-path extraction + type coercion.
  No ML, no LLM, zero external HTTP calls.

P1-B (data-warehouse-implementation-plan.md §B7 Task 1):
  This use-case is invoked by transform_consumer.py for each bronze row
  WHERE received_at > cursor.last_processed_received_at.

  Flow per row:
    1. JSON-decode the payload.
    2. Look up (vendor, event_type) in the TransformRegistry.
    3. Call the mapper → SilverFact (or None = skip).
    4. UPSERT into the target silver fact table (PG hot-mirror).
    5. Return the silver table + raw_event_id for the caller to log/metric.

PG UPSERT contract (idempotent, no double-count):
  Every silver table has a UNIQUE business key:
    connector_order_facts: (workspace_id, vendor, vendor_order_id)
    connector_line_item_facts: (workspace_id, vendor, vendor_order_id, vendor_line_item_id)
    connector_ad_spend_facts: (workspace_id, vendor, account_id, campaign_id, date)

  ON CONFLICT DO UPDATE SET … — idempotent re-ingest never double-counts.

Provenance columns (R12 / 0014 migration):
  Every UPSERT stamps raw_event_id + provenance='transform_worker' so the
  silver row is traceable back to the bronze row.

Error handling:
  - JSON decode failure: raises ValueError — caller routes to DLQ.
  - Mapper raises: re-raises — caller routes to DLQ.
  - DB error: re-raises — caller does NOT advance the cursor (retry later).

NEVERLOG: payload content is never logged. Only workspace_id, vendor,
event_type, raw_event_id, and outcome appear in log lines.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Optional

from src.domain.transform.transform_registry import MapperResult, TransformRegistry, get_registry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Async-safe PG execute helper
# ---------------------------------------------------------------------------

async def _execute_upsert(pg_conn: Any, sql: str, params: Any) -> None:
    """
    Execute a SQL statement on pg_conn, supporting async and sync connections.

    psycopg AsyncConnection:  cursor() returns an async context manager.
    Sync / fake connections:  cursor() returns a regular context manager.
    """
    import inspect
    cur_ctx = pg_conn.cursor()
    if hasattr(cur_ctx, "__aenter__"):
        # Async context manager (real psycopg.AsyncConnection)
        async with cur_ctx as cur:
            await cur.execute(sql, params)
    else:
        # Sync context manager (unit-test fake / sync psycopg connection)
        with cur_ctx as cur:
            if inspect.iscoroutinefunction(getattr(cur, "execute", None)):
                await cur.execute(sql, params)
            else:
                cur.execute(sql, params)


# ---------------------------------------------------------------------------
# PG UPSERT SQL per target table
# ---------------------------------------------------------------------------

_ORDER_UPSERT_SQL = """
INSERT INTO connector_order_facts (
    workspace_id, vendor, vendor_order_id, order_number,
    financial_status, fulfillment_status, payment_method, currency_code,
    gross_sales_mu, total_discount_mu, total_tax_mu, shipping_mu,
    customer_ref, is_new_customer, delivery_pincode, delivery_city,
    processed_at, cancelled_at, is_cod, order_type, total_refund_mu,
    synced_at, raw_event_id, provenance
)
VALUES (
    %(workspace_id)s, %(vendor)s, %(vendor_order_id)s, %(order_number)s,
    %(financial_status)s, %(fulfillment_status)s, %(payment_method)s, %(currency_code)s,
    %(gross_sales_mu)s, %(total_discount_mu)s, %(total_tax_mu)s, %(shipping_mu)s,
    %(customer_ref)s, %(is_new_customer)s, %(delivery_pincode)s, %(delivery_city)s,
    %(processed_at)s, %(cancelled_at)s, %(is_cod)s, %(order_type)s, %(total_refund_mu)s,
    now(), %(raw_event_id)s, %(provenance)s
)
ON CONFLICT (workspace_id, vendor, vendor_order_id) DO UPDATE SET
    order_number       = EXCLUDED.order_number,
    financial_status   = EXCLUDED.financial_status,
    fulfillment_status = EXCLUDED.fulfillment_status,
    payment_method     = EXCLUDED.payment_method,
    currency_code      = EXCLUDED.currency_code,
    gross_sales_mu     = EXCLUDED.gross_sales_mu,
    total_discount_mu  = EXCLUDED.total_discount_mu,
    total_tax_mu       = EXCLUDED.total_tax_mu,
    shipping_mu        = EXCLUDED.shipping_mu,
    customer_ref       = EXCLUDED.customer_ref,
    is_new_customer    = EXCLUDED.is_new_customer,
    delivery_pincode   = EXCLUDED.delivery_pincode,
    delivery_city      = EXCLUDED.delivery_city,
    processed_at       = EXCLUDED.processed_at,
    cancelled_at       = EXCLUDED.cancelled_at,
    is_cod             = EXCLUDED.is_cod,
    order_type         = EXCLUDED.order_type,
    total_refund_mu    = EXCLUDED.total_refund_mu,
    synced_at          = now(),
    raw_event_id       = EXCLUDED.raw_event_id,
    provenance         = EXCLUDED.provenance
"""

# Map silver table name → upsert SQL
_UPSERT_SQL_BY_TABLE: dict[str, str] = {
    "connector_order_facts": _ORDER_UPSERT_SQL,
}


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class GraduationResult:
    """Outcome of a single bronze-row graduation attempt."""
    raw_event_id: str
    workspace_id: str
    vendor: str
    event_type: str
    silver_table: Optional[str]  # None if skipped (no mapper)
    skipped: bool
    success: bool
    error: Optional[Exception] = None


# ---------------------------------------------------------------------------
# Public use-case function
# ---------------------------------------------------------------------------

async def graduate_raw_event(
    *,
    workspace_id: str,
    vendor: str,
    event_type: str,
    payload_json: str,
    raw_event_id: str,
    pg_conn: Any,
    registry: Optional[TransformRegistry] = None,
) -> GraduationResult:
    """
    Translate one bronze row into a typed silver fact and UPSERT it.

    @paradigm: sql — deterministic extraction, no LLM, no ML.

    Args:
        workspace_id:  Tenant UUID string.
        vendor:        Vendor code (e.g. "SHOPIFY").
        event_type:    Event type (e.g. "orders/create").
        payload_json:  The bronze row's payload column (JSON string).
        raw_event_id:  The bronze row's idempotency_key (for provenance stamp).
        pg_conn:       psycopg connection (can be a sync or async mock in tests).
        registry:      TransformRegistry override (default: global singleton).

    Returns:
        GraduationResult describing the outcome.

    Raises:
        ValueError: on JSON decode failure (DLQ-able, terminal).
        Exception:  on mapper error (DLQ-able, terminal) or DB error (retry-able).
    """
    if registry is None:
        registry = get_registry()

    # Step 1 — JSON decode (raises ValueError on malformed JSON)
    try:
        raw_payload: dict[str, Any] = json.loads(payload_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError(
            f"graduate_raw_event: JSON decode failed for raw_event_id={raw_event_id!r}: {exc}"
        ) from exc

    # Inject workspace_id into the payload so mappers can embed it in the fact.
    raw_payload.setdefault("workspace_id", workspace_id)

    # Step 2 — Registry lookup + dispatch (mapper errors propagate up to caller)
    result: Optional[MapperResult] = registry.dispatch(
        vendor=vendor,
        event_type=event_type,
        raw_payload=raw_payload,
        raw_event_id=raw_event_id,
    )

    if result is None:
        # No mapper for this (vendor, event_type) — skip, not an error.
        logger.debug(
            "graduate_raw_event: skip workspace_id=%r vendor=%r event_type=%r "
            "raw_event_id=%r (no mapper)",
            workspace_id, vendor, event_type, raw_event_id,
        )
        return GraduationResult(
            raw_event_id=raw_event_id,
            workspace_id=workspace_id,
            vendor=vendor,
            event_type=event_type,
            silver_table=None,
            skipped=True,
            success=True,
        )

    # Step 3 — Build the UPSERT parameters
    fact = result.fact
    fact["workspace_id"] = workspace_id
    fact["raw_event_id"] = raw_event_id
    fact["provenance"] = "transform_worker"

    upsert_sql = _UPSERT_SQL_BY_TABLE.get(result.silver_table)
    if upsert_sql is None:
        raise ValueError(
            f"graduate_raw_event: no UPSERT SQL registered for table "
            f"{result.silver_table!r} (add it to _UPSERT_SQL_BY_TABLE)"
        )

    # Step 4 — UPSERT (DB errors propagate up — caller does NOT advance cursor)
    # The connection may be a real psycopg async conn, an async mock, or a
    # sync fake in unit tests.  We try async first then fall back to sync.
    await _execute_upsert(pg_conn, upsert_sql, fact)

    logger.info(
        "graduate_raw_event: upserted workspace_id=%r vendor=%r event_type=%r "
        "raw_event_id=%r table=%r",
        workspace_id, vendor, event_type, raw_event_id, result.silver_table,
    )

    return GraduationResult(
        raw_event_id=raw_event_id,
        workspace_id=workspace_id,
        vendor=vendor,
        event_type=event_type,
        silver_table=result.silver_table,
        skipped=False,
        success=True,
    )
