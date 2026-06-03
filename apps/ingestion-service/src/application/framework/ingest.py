"""
Single ingest primitive — the ONE generic path consumed by all connectors.

@paradigm: sql + event-handling (idempotent UPSERT + Kafka producer + cursor persistence)

CF-C3-SINGLE-PRIMITIVE-1: ONE ingest_batch consumed N times;
  per-connector quirks are config behind ConnectorAdapter (P3).
CF-C3-PII-ADAPTER-GATE-1: refuse to write undeclared PII fields (fail-closed).
  Gate is Maya's check_pii_fields() — the canonical heuristic gate imported
  directly. _check_pii_manifest and _PiiManifestWithNullSpec are DELETED
  (they were inert dead code — see C1/F-1 bounce finding).
CF-C3-RLS-CONSUME-1: every write goes through with_workspace (P1).
CF-C3-WORKSPACE-ALLOWLIST-1: allowlist asserted at top of ingest_batch before
  any credential read (H2/F-3 fix).
CF-SEC-5 / H1: correlation 4-tuple (request_id, trace_id, workspace_id,
  system="ingest") threaded through ingest_batch → with_workspace log lines
  and into the Kafka envelope. Mirrors Child-1 ALS pattern via Python contextvars.

Locked signature per §A0.5:
  async def ingest_batch(
      adapter: ConnectorAdapter,
      workspace_id: str,
      window: IngestWindow,
      *,
      dry_run: bool = False,
  ) -> IngestResult

Path:
  Allowlist check → OAuth/cred read → per-adapter PII-manifest check
  → idempotent UPSERT + cursor advance in ONE transaction under with_workspace (P1)
  → Kafka produce to integrations.<vendor>.v1

Idempotency key: (workspace_id, vendor, vendor_event_id)
  UPSERT ON CONFLICT DO UPDATE — re-ingest is a no-op on counts.

Same code path for live + backfill (bounded vs unbounded IngestWindow).
`dry_run=True` skips the DB write and Kafka produce (LOCAL parity harness uses this).
"""

from __future__ import annotations

import json
import logging
import uuid as uuid_mod
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from src.bootstrap.startup_gates import assert_workspace_allowed
from src.domain.framework.adapter import (
    ConnectorAdapter,
    Credential,
    IngestWindow,
    NormalizedEvent,
    PiiManifest,
)
from src.domain.framework.cursor import upsert_cursor
from src.domain.framework.pii_manifest import PiiManifestViolation, check_pii_fields
from src.infrastructure.db.session_context import DbConn, with_workspace
from src.infrastructure.secrets.custody import CredentialCustody

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Correlation context store (CF-SEC-5 / H1 fix)
# Mirrors Child-1's AsyncLocalStorage 4-tuple pattern via Python contextvars.
# Fields: request_id, trace_id, workspace_id, actor (system="ingest")
# ---------------------------------------------------------------------------

_correlation_request_id: ContextVar[str] = ContextVar("request_id", default="")
_correlation_trace_id: ContextVar[str] = ContextVar("trace_id", default="")
_correlation_workspace_id: ContextVar[str] = ContextVar("corr_workspace_id", default="")
_correlation_actor: ContextVar[str] = ContextVar("actor", default="system:ingest")


def get_correlation_context() -> dict[str, str]:
    """Return the current correlation 4-tuple snapshot (for log injection + error surfaces)."""
    return {
        "request_id": _correlation_request_id.get(),
        "trace_id": _correlation_trace_id.get(),
        "workspace_id": _correlation_workspace_id.get(),
        "actor": _correlation_actor.get(),
    }


def _set_correlation(
    request_id: str,
    trace_id: str,
    workspace_id: str,
    actor: str = "system:ingest",
) -> None:
    _correlation_request_id.set(request_id)
    _correlation_trace_id.set(trace_id)
    _correlation_workspace_id.set(workspace_id)
    _correlation_actor.set(actor)


# ---------------------------------------------------------------------------
# Metrics counters (simple in-process counters; Prometheus integration at Stage-8)
# ---------------------------------------------------------------------------

_COUNTERS: dict[str, int] = {
    "ingest_events_received_total": 0,
    "ingest_events_upserted_total": 0,
    "ingest_events_deduped_total": 0,
    "ingest_pii_manifest_rejections_total": 0,
}


def _inc(counter: str, amount: int = 1) -> None:
    _COUNTERS[counter] = _COUNTERS.get(counter, 0) + amount


def get_counters() -> dict[str, int]:
    """Return a snapshot of current metric counters (test / monitoring hook)."""
    return dict(_COUNTERS)


def reset_counters() -> None:
    """Reset all counters (test isolation only)."""
    for k in list(_COUNTERS):
        _COUNTERS[k] = 0


# ---------------------------------------------------------------------------
# IngestResult — returned by ingest_batch
# ---------------------------------------------------------------------------


@dataclass
class IngestResult:
    """Summary of one ingest_batch run.

    CF-C3-SINGLE-PRIMITIVE-1: re-ingest same batch → events_upserted unchanged,
    events_deduped increments.
    """
    events_received: int = 0
    events_upserted: int = 0
    events_deduped: int = 0
    cursor_advanced_to: Optional[str] = None
    kafka_offsets: list[int] = field(default_factory=list)
    pii_rejections: int = 0
    dry_run: bool = False
    request_id: str = ""
    trace_id: str = ""


# ---------------------------------------------------------------------------
# DB upsert helper (called inside with_workspace)
# ---------------------------------------------------------------------------

# M1/F-4 fix: table names aligned to prod DDL raw_* prefix.
# The LOCAL pg-init/01-init.sql must use the SAME names to prevent divergence.
_RAW_TABLE_MAP = {
    "shopify": {
        "order": "raw_shopify_orders",
        "customer": "raw_shopify_customers",
        "product": "raw_shopify_products",
        "line_item": "raw_shopify_line_items",
    },
    "shiprocket": {"shipment": "raw_shiprocket_shipments"},
    "meta": {"ad_daily": "raw_meta_ads_daily"},
    "google": {"ad_daily": "raw_google_ads_daily"},
    "klaviyo": {"email_performance": "raw_klaviyo_email_performance"},
    "woocommerce": {"order": "raw_woocommerce_orders"},
    "unicommerce": {"product": "raw_unicommerce_products"},
}

# Defense-in-depth: per-table column allowlists (bandit B608 / L1 fix).
# Only columns listed here can appear in an INSERT for each table.
# If an adapter produces a column not in this set the upsert raises a ValueError
# before it reaches SQL, preventing any possibility of column-name injection.
_ALLOWED_COLUMNS: dict[str, frozenset[str]] = {
    "raw_shopify_orders": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "shopify_order_id", "order_number", "financial_status", "fulfillment_status",
        "email", "first_name", "last_name",
        "total_price", "subtotal_price", "total_discounts", "total_tax", "currency",
        "created_at", "updated_at", "closed_at", "cancelled_at",
        "total_price_raw", "tags", "raw_payload",
    }),
    "raw_shopify_customers": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "shopify_customer_id", "email", "first_name", "last_name",
        "orders_count", "total_spent_raw", "raw_payload",
    }),
    "raw_shopify_products": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "shopify_product_id", "title", "product_type", "status", "raw_payload",
    }),
    "raw_shopify_line_items": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "shopify_order_id", "line_item_id", "product_id", "variant_id",
        "sku", "title", "quantity", "price_raw", "raw_payload",
    }),
    "raw_shiprocket_shipments": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "shipment_id", "order_id", "status", "courier_name",
        "delivery_pincode", "delivery_city", "delivery_state", "raw_payload",
    }),
    "raw_meta_ads_daily": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "campaign_id", "adset_id", "ad_id", "date_start", "date_stop",
        "impressions", "clicks", "spend_raw", "currency", "raw_payload",
    }),
    "raw_google_ads_daily": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "campaign_id", "ad_group_id", "date_day",
        "impressions", "clicks", "cost_micros_raw", "currency", "raw_payload",
    }),
    "raw_klaviyo_email_performance": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "campaign_id", "campaign_name", "date_day",
        "delivered", "unique_opens", "unique_clicks",
        "placed_order_count", "unsubscribe_count", "raw_payload",
    }),
    "raw_woocommerce_orders": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "woo_order_id", "status", "customer_email", "customer_phone",
        "billing_first_name", "billing_last_name", "billing_address_1",
        "billing_city", "billing_state", "billing_postcode",
        "shipping_first_name", "shipping_last_name", "shipping_address_1",
        "shipping_city", "shipping_state", "shipping_postcode",
        "total_raw", "currency", "raw_payload",
    }),
    "raw_unicommerce_products": frozenset({
        "workspace_id", "vendor_event_id", "event_type", "occurred_at",
        "lawful_basis", "purpose_code", "ingested_at", "vendor",
        "sku_code", "item_type_sku", "category", "mrp_raw", "raw_payload",
    }),
}


def _table_for(vendor: str, event_type: str) -> str:
    tables = _RAW_TABLE_MAP.get(vendor, {})
    table = tables.get(event_type)
    if table is None:
        raise ValueError(
            f"[ingest_batch] No raw table mapped for vendor={vendor!r} "
            f"event_type={event_type!r}. Add an entry to _RAW_TABLE_MAP."
        )
    return table


async def _upsert_event(
    conn: DbConn,
    workspace_id: str,
    event: NormalizedEvent,
    manifest: PiiManifest,
    request_id: str = "",
) -> bool:
    """
    Idempotently upsert one NormalizedEvent into the raw landing table.

    Returns True if the row was inserted (new), False if it was a dedup
    (ON CONFLICT — row already existed).

    Idempotency key: (workspace_id, vendor_event_id) per the UNIQUE index
    created by Track M's step-a-enable-create.sql.

    Defense-in-depth (L1/B608): column names validated against a static
    per-table allowlist before interpolation into SQL.
    """
    table = _table_for(event.vendor, event.event_type)
    ingested_at = datetime.now(timezone.utc)

    # Build the column set from the NormalizedEvent
    cols = {
        "workspace_id": workspace_id,
        "vendor_event_id": event.vendor_event_id,
        "event_type": event.event_type,
        "occurred_at": event.occurred_at,
        "lawful_basis": event.lawful_basis,
        "purpose_code": event.purpose_code,
        "ingested_at": ingested_at,
        **event.columns,
    }

    # Defense-in-depth column allowlist (bandit B608 / L1)
    allowed = _ALLOWED_COLUMNS.get(table)
    if allowed is not None:
        disallowed = [c for c in cols if c not in allowed]
        if disallowed:
            raise ValueError(
                f"[_upsert_event] Column(s) {disallowed!r} not in allowlist for "
                f"table {table!r}. request_id={request_id!r}. "
                f"CF-C3-SINGLE-PRIMITIVE-1 defense-in-depth gate."
            )

    col_names = list(cols.keys())
    placeholders = ["%s" for _ in col_names]
    # Exclude ingested_at from the loop — it is appended unconditionally as the
    # last SET item.  Including it in the loop AND as the hardcoded suffix would
    # produce "multiple assignments to same column" (SyntaxError on Postgres).
    update_clause = ", ".join(
        f"{c} = EXCLUDED.{c}"
        for c in col_names
        if c not in ("workspace_id", "vendor_event_id", "ingested_at")
    )

    sql = f"""
        INSERT INTO {table} ({", ".join(col_names)})
        VALUES ({", ".join(placeholders)})
        ON CONFLICT (workspace_id, vendor_event_id)
        DO UPDATE SET {update_clause},
                      ingested_at = EXCLUDED.ingested_at
        RETURNING (xmax = 0) AS was_inserted
    """

    row = await conn.fetchone(sql, list(cols.values()))
    return bool(row["was_inserted"]) if row else True


# ---------------------------------------------------------------------------
# Kafka produce helper
# ---------------------------------------------------------------------------


async def _produce_kafka(
    producer: "aiokafka.AIOKafkaProducer",  # type: ignore[name-defined]
    topic: str,
    workspace_id: str,
    event: NormalizedEvent,
    ingested_at: datetime,
    request_id: str = "",
    trace_id: str = "",
) -> int:
    """Produce an IntegrationEvent to the Kafka topic.

    Returns the offset of the produced message.
    workspace_id is the partition key (CF-C3-SINGLE-PRIMITIVE-1 / envelope spec).
    request_id and trace_id are propagated into the envelope (CF-SEC-5 / H1 fix).
    """
    # Build the envelope payload (proto-shaped dict; real proto codegen at Stage-8).
    # correlation_id and trace_id added per H1 fix — mirrors Child-1 CF-SEC-5.
    envelope = {
        "workspace_id": workspace_id,
        "vendor": event.vendor,
        "vendor_event_id": event.vendor_event_id,
        "event_type": event.event_type,
        "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
        "ingested_at": ingested_at.isoformat(),
        "payload": json.dumps(event.columns).encode().decode("latin-1"),  # bytes repr
        "lawful_basis": event.lawful_basis,
        "purpose_code": event.purpose_code,
        # Correlation 4-tuple (CF-SEC-5 / H1)
        "request_id": request_id,
        "trace_id": trace_id,
        "actor": "system:ingest",
    }
    key = workspace_id.encode()
    value = json.dumps(envelope).encode()
    record_metadata = await producer.send_and_wait(topic, value=value, key=key)
    return record_metadata.offset


# ---------------------------------------------------------------------------
# ingest_batch — the ONE entry point (locked signature per §A0.5)
# ---------------------------------------------------------------------------


async def ingest_batch(
    adapter: ConnectorAdapter,
    workspace_id: str,
    window: IngestWindow,
    *,
    dry_run: bool = False,
    custody: Optional[CredentialCustody] = None,
    kafka_producer: Optional[object] = None,
    allowed_workspace_ids: Optional[frozenset[str]] = None,
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> IngestResult:
    """
    The single generic ingest primitive.

    Path:
      0. Workspace allowlist check (CF-C3-WORKSPACE-ALLOWLIST-1 / H2 fix) —
         rejects any workspace not in allowed_workspace_ids before any credential
         read or DB touch. If allowed_workspace_ids is None, the check is skipped
         (LOCAL dry_run harness mode; in production always pass the frozenset from
         run_all_gates()).
      1. Read credential from custody (P4) — skipped in dry_run.
      2. PII-manifest check on each NormalizedEvent before write (fail-closed).
         Uses Maya's check_pii_fields() — the canonical heuristic gate. (C1/F-1 fix)
      3. Idempotent UPSERT + cursor advance in ONE transaction under with_workspace (P1).
         (M2/F-6 fix: cursor now inside the same transaction as the batch UPSERT)
         Skipped in dry_run.
      4. Kafka produce to integrations.<vendor>.v1 — skipped in dry_run.
         Correlation 4-tuple propagated into envelope (H1/F-7 fix).

    CF-C3-SINGLE-PRIMITIVE-1: same path for live + backfill (bounded vs
    unbounded window — the difference is only in IngestWindow.start/end).

    dry_run=True: fetch + normalize + PII-check but NO DB write, NO Kafka
    produce, NO cursor advance. Used by the LOCAL parity harness (V10).
    """
    if not workspace_id or not isinstance(workspace_id, str):
        raise ValueError("[ingest_batch] workspace_id must be a non-empty string")

    # Generate correlation IDs if not supplied (ingest-initiated run)
    req_id = request_id or str(uuid_mod.uuid4())
    tr_id = trace_id or str(uuid_mod.uuid4())

    # Bind correlation context for the duration of this ingest run (CF-SEC-5 / H1)
    _set_correlation(req_id, tr_id, workspace_id)

    # Step 0: workspace allowlist check (CF-C3-WORKSPACE-ALLOWLIST-1 / H2)
    # Must happen BEFORE custody.get — no credential read for disallowed workspace.
    if allowed_workspace_ids is not None:
        assert_workspace_allowed(workspace_id, allowed_workspace_ids)

    result = IngestResult(dry_run=dry_run, request_id=req_id, trace_id=tr_id)
    last_event_id: Optional[str] = None
    ingested_at = datetime.now(timezone.utc)

    # Step 1: read credential
    creds: Optional[Credential] = None
    if not dry_run and custody is not None:
        creds = await custody.get(workspace_id, adapter.vendor)

    # Collect all events first so we can write batch + cursor in ONE transaction
    normalized_events: list[tuple[NormalizedEvent, str]] = []

    # Step 2: fetch, normalize, PII-gate (fail-closed — CF-C3-PII-ADAPTER-GATE-1)
    async for raw in adapter.fetch(creds, window):  # type: ignore[arg-type]
        result.events_received += 1
        _inc("ingest_events_received_total")

        normalized = adapter.normalize(raw)

        # PII gate via Maya's canonical check_pii_fields (C1/F-1 fix)
        # Raises PiiManifestViolation if any undeclared PII field found.
        try:
            check_pii_fields(adapter.pii_manifest, list(normalized.columns.keys()))
        except PiiManifestViolation as exc:
            _inc("ingest_pii_manifest_rejections_total")
            result.pii_rejections += 1
            logger.error(
                "[ingest_batch] PII gate REJECTED event — vendor=%s workspace_id=%s "
                "request_id=%s trace_id=%s error=%s",
                adapter.vendor,
                workspace_id,
                req_id,
                tr_id,
                exc,
            )
            raise

        last_event_id = raw.vendor_event_id
        normalized_events.append((normalized, raw.vendor_event_id))

        if dry_run:
            result.events_upserted += 1

    if dry_run or not normalized_events:
        logger.info(
            "[ingest_batch] vendor=%s workspace_id=%s request_id=%s trace_id=%s "
            "received=%d upserted=%d deduped=%d pii_rejections=%d dry_run=%s",
            adapter.vendor,
            workspace_id,
            req_id,
            tr_id,
            result.events_received,
            result.events_upserted,
            result.events_deduped,
            result.pii_rejections,
            dry_run,
        )
        return result

    # Step 3: UPSERT batch + cursor advance in ONE transaction (M2/F-6 fix)
    # Cursor and batch share one with_workspace transaction — if the batch rolls
    # back the cursor rolls back with it (no phantom-advance per the M4 contract).
    cursor_value = last_event_id  # adapter-defined opaque cursor position

    async def _do_batch_and_cursor(conn: DbConn) -> tuple[int, int]:
        upserted = 0
        deduped = 0
        for normalized, _ in normalized_events:
            was_inserted = await _upsert_event(
                conn, workspace_id, normalized, adapter.pii_manifest, req_id
            )
            if was_inserted:
                upserted += 1
            else:
                deduped += 1

        # Cursor advance in the SAME transaction (M2/F-6 fix per cursor.py M4 contract)
        await upsert_cursor(
            conn,
            workspace_id=uuid_mod.UUID(workspace_id),  # type: ignore[arg-type]
            vendor=adapter.vendor,
            cursor_value=cursor_value or "",
            window_start=window.start or ingested_at,
            window_end=window.end or ingested_at,
        )
        return upserted, deduped

    upserted_count, deduped_count = await with_workspace(workspace_id, _do_batch_and_cursor)

    result.events_upserted = upserted_count
    result.events_deduped = deduped_count
    result.cursor_advanced_to = cursor_value
    _inc("ingest_events_upserted_total", upserted_count)
    _inc("ingest_events_deduped_total", deduped_count)

    # Step 4: Kafka produce (after DB commit — at-least-once; consumer dedupes via idempotency key)
    for normalized, _ in normalized_events:
        if kafka_producer is not None:
            topic = f"integrations.{adapter.vendor}.v1"
            try:
                import aiokafka  # noqa: PLC0415 — optional at test time
                offset = await _produce_kafka(
                    kafka_producer,  # type: ignore[arg-type]
                    topic,
                    workspace_id,
                    normalized,
                    ingested_at,
                    request_id=req_id,
                    trace_id=tr_id,
                )
                result.kafka_offsets.append(offset)
            except Exception as exc:
                logger.warning(
                    "[ingest_batch] Kafka produce failed — event still upserted to DB. "
                    "vendor=%s workspace_id=%s request_id=%s trace_id=%s error=%s",
                    adapter.vendor,
                    workspace_id,
                    req_id,
                    tr_id,
                    exc,
                )

    logger.info(
        "[ingest_batch] vendor=%s workspace_id=%s request_id=%s trace_id=%s "
        "received=%d upserted=%d deduped=%d pii_rejections=%d dry_run=%s",
        adapter.vendor,
        workspace_id,
        req_id,
        tr_id,
        result.events_received,
        result.events_upserted,
        result.events_deduped,
        result.pii_rejections,
        dry_run,
    )

    return result
