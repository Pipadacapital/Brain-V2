"""
DLQ producer — write parse/contract failures to integrations.dlq.v1.

@paradigm: sql (no ML, no LLM; Kafka produce; ₹0 compute)

P1-D (data-warehouse-implementation-plan.md §B7):
  Task 3: DLQ topic `integrations.dlq.v1` + producer.
  The transform worker (P1-B) calls produce_dlq_event on terminal failure so a
  bad event becomes a QUERYABLE DLQ row, never a silent log+skip.

Architecture (proposal R4):
  A parse/contract failure from the raw-archiver consumer or transform worker
  routes here.  The DLQ record carries:
    raw_event_id:    idempotency_key / vendor_event_id of the failed event
    workspace_id:    tenant isolation (all DLQ reads are scoped to workspace)
    vendor:          source integration vendor
    event_type:      e.g. "orders/create", "order"
    error_class:     Python exception class name (e.g. "ValueError", "KeyError")
    error_detail:    str(exc)[:500] — bounded, never a full traceback
    source_topic:    the integrations.<vendor>.v1 topic the event came from
    source_partition: Kafka partition the event lived on
    source_offset:   Kafka offset (makes the poison event replayable by offset)
    produced_at:     ISO-8601 UTC timestamp of when this DLQ record was written
    raw_bytes_b64:   base64-encoded original event bytes (bounded to MAX_RAW_BYTES)
                     so ops can inspect + fix + replay the exact bytes.

Feature flag:
  No dedicated flag — DLQ is infra (always-on safety net, not a feature gate).
  The MSK topic creation is the HELD Stage-8 ceremony; in Phase-0/1 local dev
  the topic is the local redpanda/kafka docker topic.

Topic name:
  DLQ_TOPIC_NAME = "integrations.dlq.v1"
  Must match BronzeStorageStack.DLQ_TOPIC_NAME (the CDK-authored constant).
  Import from here, not from CDK, in Python services.

Error detail bounding:
  error_detail is truncated to MAX_ERROR_DETAIL chars (500) to prevent
  large stack traces from inflating the DLQ record size.  Full traces are
  in CloudWatch Logs + Sentry under the same trace_id.

NEVERLOG:
  The raw_bytes_b64 field is bounded to MAX_RAW_BYTES_B64_CHARS.
  The DLQ record itself is not logged at INFO (only at DEBUG for local dev).
  Workspace-scoped reads only — no cross-tenant DLQ access.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants — must match BronzeStorageStack exports in CDK
# ---------------------------------------------------------------------------

#: The DLQ Kafka topic name.  Matches BronzeStorageStack.DLQ_TOPIC_NAME.
DLQ_TOPIC_NAME = "integrations.dlq.v1"

#: Maximum length for error_detail (bounded to prevent DLQ record bloat).
MAX_ERROR_DETAIL_CHARS = 500

#: Maximum length for raw_bytes base64 payload in the DLQ record.
#: Bounded to ~50KB (67_000 base64 chars ≈ 50 KB raw) to keep DLQ records
#: inspectable without overwhelming the Kafka topic's segment.bytes budget.
MAX_RAW_BYTES_B64_CHARS = 67_000

# ---------------------------------------------------------------------------
# DLQ record schema
# ---------------------------------------------------------------------------


def build_dlq_record(
    *,
    raw_event_id: str,
    workspace_id: str,
    vendor: str,
    event_type: str,
    error_class: str,
    error_detail: str,
    source_topic: str,
    source_partition: int,
    source_offset: int,
    raw_bytes: Optional[bytes] = None,
    trace_id: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    """
    Build a DLQ record dict for serialization to integrations.dlq.v1.

    All string fields are validated at build time:
      - workspace_id and raw_event_id must be non-empty.
      - error_detail is truncated to MAX_ERROR_DETAIL_CHARS.
      - raw_bytes is base64-encoded and truncated to MAX_RAW_BYTES_B64_CHARS.

    Args:
        raw_event_id:      Idempotency key / vendor_event_id of the failed event.
        workspace_id:      Tenant ID (all DLQ reads are workspace-scoped).
        vendor:            Integration vendor (e.g. "SHOPIFY", "META").
        event_type:        Event type (e.g. "orders/create", "ad_spend").
        error_class:       Python exception class name (e.g. "ValueError").
        error_detail:      str(exc) — bounded to MAX_ERROR_DETAIL_CHARS.
        source_topic:      Kafka topic the event came from.
        source_partition:  Kafka partition the event lived on.
        source_offset:     Kafka offset (makes the event replayable by offset).
        raw_bytes:         Optional original event bytes for inspection/replay.
        trace_id:          Correlation trace ID (for log stitching).
        request_id:        Correlation request ID (for log stitching).

    Returns:
        dict suitable for json.dumps → Kafka produce.

    Raises:
        ValueError: if workspace_id or raw_event_id is empty.
    """
    if not workspace_id:
        raise ValueError("build_dlq_record: workspace_id must be non-empty")
    if not raw_event_id:
        raise ValueError("build_dlq_record: raw_event_id must be non-empty")

    # Bound error_detail to prevent DLQ record bloat.
    bounded_error = str(error_detail)[:MAX_ERROR_DETAIL_CHARS]

    # Encode raw_bytes as base64 (bounded for ops inspection/replay).
    raw_bytes_b64: str = ""
    if raw_bytes:
        encoded = base64.b64encode(raw_bytes).decode("ascii")
        raw_bytes_b64 = encoded[:MAX_RAW_BYTES_B64_CHARS]
        if len(encoded) > MAX_RAW_BYTES_B64_CHARS:
            logger.debug(
                "dlq_producer: raw_bytes truncated from %d to %d b64 chars for dlq record "
                "(workspace_id=%r raw_event_id=%r)",
                len(encoded), MAX_RAW_BYTES_B64_CHARS, workspace_id, raw_event_id,
            )

    return {
        "schema_version": "1.0",
        "topic": DLQ_TOPIC_NAME,
        "raw_event_id": raw_event_id,
        "workspace_id": workspace_id,
        "vendor": vendor,
        "event_type": event_type,
        "error_class": str(error_class)[:200],
        "error_detail": bounded_error,
        "source_topic": source_topic,
        "source_partition": int(source_partition),
        "source_offset": int(source_offset),
        "raw_bytes_b64": raw_bytes_b64,
        "trace_id": trace_id,
        "request_id": request_id,
        "produced_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Kafka produce helpers
# ---------------------------------------------------------------------------


async def produce_dlq_event(
    *,
    producer: Any,
    raw_event_id: str,
    workspace_id: str,
    vendor: str,
    event_type: str,
    error_class: str,
    error_detail: str,
    source_topic: str,
    source_partition: int,
    source_offset: int,
    raw_bytes: Optional[bytes] = None,
    trace_id: str = "",
    request_id: str = "",
) -> bool:
    """
    Produce a DLQ record to `integrations.dlq.v1`.

    This is NON-FATAL on produce failure: a DLQ produce error is logged at
    ERROR level but does not re-raise, because the DLQ is a safety net — we
    must not deadlock on a DLQ produce failure when the primary error path
    has already decided to advance the cursor / skip the poison event.

    Partition key: workspace_id — all DLQ reads are workspace-scoped; keeping
    workspace records on the same partition enables ordered-per-tenant replay.

    Args:
        producer:          aiokafka AIOKafkaProducer (or mock in tests).
                           Must be started before calling this function.
        raw_event_id:      Idempotency key of the failed event.
        workspace_id:      Tenant ID.
        vendor:            Integration vendor.
        event_type:        Event type.
        error_class:       Python exception class name.
        error_detail:      str(exc) — bounded internally.
        source_topic:      Kafka topic the event came from.
        source_partition:  Kafka partition.
        source_offset:     Kafka offset.
        raw_bytes:         Optional original event bytes.
        trace_id:          Correlation trace ID.
        request_id:        Correlation request ID.

    Returns:
        True  — DLQ record produced successfully.
        False — DLQ produce failed (error is logged; caller continues).
    """
    try:
        record = build_dlq_record(
            raw_event_id=raw_event_id,
            workspace_id=workspace_id,
            vendor=vendor,
            event_type=event_type,
            error_class=error_class,
            error_detail=error_detail,
            source_topic=source_topic,
            source_partition=source_partition,
            source_offset=source_offset,
            raw_bytes=raw_bytes,
            trace_id=trace_id,
            request_id=request_id,
        )
        value_bytes = json.dumps(record).encode("utf-8")
        key_bytes = workspace_id.encode("utf-8")  # partition by workspace_id

        await producer.send_and_wait(
            DLQ_TOPIC_NAME,
            value=value_bytes,
            key=key_bytes,
        )

        logger.info(
            "dlq_producer: produced DLQ record "
            "workspace_id=%r vendor=%r event_type=%r raw_event_id=%r "
            "source_topic=%r source_offset=%d trace_id=%r",
            workspace_id, vendor, event_type, raw_event_id,
            source_topic, source_offset, trace_id,
        )
        return True

    except ValueError as build_err:
        # build_dlq_record validation failure (missing workspace_id/raw_event_id).
        logger.error(
            "dlq_producer: CANNOT build DLQ record (validation failure) "
            "workspace_id=%r raw_event_id=%r error=%s",
            workspace_id, raw_event_id, build_err,
        )
        return False

    except Exception as produce_err:
        # Kafka produce failure — non-fatal (DLQ is a safety net, not the primary path).
        logger.error(
            "dlq_producer: produce FAILED (non-fatal) "
            "workspace_id=%r vendor=%r raw_event_id=%r "
            "source_topic=%r source_offset=%d error_class=%s error=%s",
            workspace_id, vendor, raw_event_id,
            source_topic, source_offset,
            type(produce_err).__name__, produce_err,
        )
        return False


def build_dlq_kafka_config(
    bootstrap_servers: Optional[str] = None,
) -> dict[str, Any]:
    """
    Build the aiokafka producer config for the DLQ producer.

    Reads environment variables:
        KAFKA_BOOTSTRAP_SERVERS — comma-separated broker list (default localhost:19092)

    Args:
        bootstrap_servers: Override for KAFKA_BOOTSTRAP_SERVERS env var.

    Returns:
        dict of kwargs for AIOKafkaProducer(**config).
    """
    brokers = (
        bootstrap_servers
        or os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:19092")
    )
    broker_list = [b.strip() for b in brokers.split(",") if b.strip()]

    return {
        "bootstrap_servers": broker_list,
        "client_id": "brain-dlq-producer",
        # DLQ records are small; linger_ms=0 for low-latency delivery.
        "linger_ms": 0,
        # acks=all for at-least-once delivery guarantee on the DLQ.
        "acks": "all",
        # Serialize to bytes in produce_dlq_event; no serializer here.
        "value_serializer": None,
        "key_serializer": None,
    }
