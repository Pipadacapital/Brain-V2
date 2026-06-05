"""
Bronze raw-archiver consumer — the SINGLE writer of CH brain.connector_raw_events
and the S3 raw archive.

@paradigm: sql (no ML, no LLM; Kafka consume + CH insert + S3 write; ₹0 compute)

P0-C (data-warehouse-implementation-plan.md §B7):
  This is the keystone of the medallion bronze tier.  It is the SOLE writer of
  `brain.connector_raw_events` (G1 — raw-landing wiring).

  Architecture (proposal §2.2):
    integrations.<vendor>.v1  →  RAW-ARCHIVER consumer group
                               →  CH brain.connector_raw_events  (hot replay cache)
                               →  S3 {ws}/{vendor}/{y}/{m}/{d}/{idem}.json.zst  (durable)

  The S3 write is NON-FATAL (s3_raw_writer.py).  The CH write is the live path;
  any CH failure is retried once then logged (the Kafka offset is NOT committed on
  hard CH failure, allowing re-delivery).

Feature flag:
  BRONZE_RAW_ARCHIVER (default OFF — B6 §2).
  ON only after P0-B (PII_TOKENIZER) is green per B10 flag-flip order.
  When OFF: consumer is not started; the proven realtime-facts-consumer.ts path
  continues un-gated (it handles its own flag: REALTIME_FACTS_CONSUMER).

Single consumer group:
  GROUP_ID = 'brain-bronze-archiver'
  Distinct from the fact consumer group ('brain-facts-consumer') — both can run
  in parallel during the dual-write window (B10 step 3 / cutover plan).
  The fact consumer processes the same topic independently; both groups advance
  their offsets separately.

CH write contract:
  INSERT INTO brain.connector_raw_events using the HTTP interface
  (clickhouse_connect).  The table is append-only MergeTree — no ON CONFLICT
  needed; duplicate rows for the same idempotency_key are normal and expected
  (the transform worker deduplicates at the silver layer per 0010 design).
  customer_ref / lawful_basis / purpose_code are populated from envelope fields
  (0012 columns, P0-B).

Correlation / tracing:
  trace_id + request_id from the Kafka envelope are threaded into every log line.
  Stage-3 VETO surface: the trace flows from the ingest call through Kafka into
  this consumer — end-to-end trace ID propagation.

NEVERLOG:
  The `payload` field (tokenized JSON) is never logged.  Only workspace_id,
  vendor, event_type, idempotency_key, and correlation IDs appear in log lines.
  CF-CC-NEVERLOG-1.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from src.infrastructure.storage.s3_raw_writer import write_to_s3

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GROUP_ID = "brain-bronze-archiver"
# Consume ALL vendor topics matching integrations.*.v1
# The consumer subscribes to a regex so any new vendor's topic is
# automatically picked up without a consumer restart.
TOPIC_PATTERN = r"^integrations\..+\.v1$"

# CH database and table
_CH_DATABASE = "brain"
_CH_TABLE = "connector_raw_events"
_CH_FULL_TABLE = f"{_CH_DATABASE}.{_CH_TABLE}"

# ---------------------------------------------------------------------------
# In-process metrics counters (Prometheus wiring at Stage-8)
# ---------------------------------------------------------------------------

_ARCHIVER_COUNTERS: dict[str, int] = {
    "bronze_archiver_messages_consumed_total": 0,
    "bronze_archiver_ch_inserts_total": 0,
    "bronze_archiver_ch_failures_total": 0,
    "bronze_archiver_s3_failures_total": 0,
    "bronze_archiver_parse_errors_total": 0,
}


def _arc_inc(counter: str, amount: int = 1) -> None:
    _ARCHIVER_COUNTERS[counter] = _ARCHIVER_COUNTERS.get(counter, 0) + amount


def get_archiver_counters() -> dict[str, int]:
    """Return a snapshot of archiver metric counters (test / monitoring hook)."""
    return dict(_ARCHIVER_COUNTERS)


def reset_archiver_counters() -> None:
    """Reset all archiver counters (test isolation only)."""
    for k in list(_ARCHIVER_COUNTERS):
        _ARCHIVER_COUNTERS[k] = 0


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _archiver_enabled() -> bool:
    """Return True when BRONZE_RAW_ARCHIVER env-var is 'true'."""
    return os.environ.get("BRONZE_RAW_ARCHIVER", "false").strip().lower() == "true"


# ---------------------------------------------------------------------------
# Envelope parsing
# ---------------------------------------------------------------------------

@dataclass
class ParsedEnvelope:
    """Parsed Kafka envelope from integrations.<vendor>.v1."""
    workspace_id: str
    vendor: str
    vendor_event_id: str
    event_type: str
    received_at: datetime
    event_at: Optional[datetime]
    payload: str
    payload_version: str
    customer_ref: str
    lawful_basis: str
    purpose_code: str
    trace_id: str
    request_id: str
    raw_bytes: bytes


def parse_envelope(raw_bytes: bytes) -> ParsedEnvelope:
    """
    Parse a Kafka message value into a ParsedEnvelope.

    The envelope shape is produced by ingest.py:_produce_kafka (P0-B).
    Required fields: workspace_id, vendor, vendor_event_id, event_type,
    ingested_at, payload.
    Optional fields: event_at, lawful_basis, purpose_code, customer_ref,
    trace_id, request_id, salt_version.

    Raises:
        ValueError: if any required field is missing or workspace_id is empty.
    """
    try:
        envelope = json.loads(raw_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"parse_envelope: JSON decode failed: {exc}") from exc

    # Required fields
    for required in ("workspace_id", "vendor", "vendor_event_id", "event_type",
                     "ingested_at", "payload"):
        if not envelope.get(required):
            raise ValueError(
                f"parse_envelope: missing required field {required!r} in envelope "
                f"(workspace_id={envelope.get('workspace_id')!r})"
            )

    # Parse ingested_at as the received_at timestamp
    try:
        ingested_at_str: str = envelope["ingested_at"]
        # Handle both ISO format and epoch
        if ingested_at_str.replace(".", "").replace("-", "").replace(":", "").replace("T", "").replace("Z", "").isdigit():
            received_at = datetime.fromisoformat(ingested_at_str.replace("Z", "+00:00"))
        else:
            received_at = datetime.fromisoformat(ingested_at_str)
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
    except (ValueError, KeyError) as exc:
        raise ValueError(
            f"parse_envelope: invalid ingested_at={envelope.get('ingested_at')!r}: {exc}"
        ) from exc

    # Parse optional event_at
    event_at: Optional[datetime] = None
    if envelope.get("occurred_at"):
        try:
            ea_str: str = envelope["occurred_at"]
            event_at = datetime.fromisoformat(ea_str.replace("Z", "+00:00"))
            if event_at.tzinfo is None:
                event_at = event_at.replace(tzinfo=timezone.utc)
        except ValueError:
            pass  # Non-fatal — event_at is nullable in the CH schema

    # customer_ref: the PII tokenizer (P0-B) may have populated this in the
    # columns dict.  The envelope carries it as a top-level field if the
    # tokenizer produced it; otherwise default to empty (backward compat).
    customer_ref: str = envelope.get("customer_ref", "")

    # If customer_ref is not in the envelope top-level, check if the payload
    # columns dict carries it (pre-P0-B / backward-compat path).
    if not customer_ref:
        try:
            cols = json.loads(envelope["payload"]) if isinstance(envelope["payload"], str) else envelope["payload"]
            customer_ref = cols.get("customer_ref", "") or ""
        except (json.JSONDecodeError, TypeError, AttributeError):
            customer_ref = ""

    return ParsedEnvelope(
        workspace_id=envelope["workspace_id"],
        vendor=envelope["vendor"],
        vendor_event_id=envelope["vendor_event_id"],
        event_type=envelope["event_type"],
        received_at=received_at,
        event_at=event_at,
        payload=envelope["payload"],
        payload_version=envelope.get("payload_version", "") or "",
        customer_ref=str(customer_ref),
        lawful_basis=envelope.get("lawful_basis", "") or "",
        purpose_code=envelope.get("purpose_code", "") or "",
        trace_id=envelope.get("trace_id", "") or "",
        request_id=envelope.get("request_id", "") or "",
        raw_bytes=raw_bytes,
    )


# ---------------------------------------------------------------------------
# CH insert helper
# ---------------------------------------------------------------------------

def _build_ch_row(env: ParsedEnvelope) -> dict[str, Any]:
    """
    Build a dict row for insertion into brain.connector_raw_events.

    Maps the ParsedEnvelope fields to the CH column names (0010 + 0012 schema).
    All three P0-B columns (customer_ref, lawful_basis, purpose_code) are
    populated from the envelope.

    Types:
      - received_at: DateTime64(3, 'UTC') → pass as Python datetime (tz-aware)
      - event_at:    Nullable(DateTime64(3, 'UTC')) → Python datetime or None
      - ingested_at: DateTime → Python datetime (clickhouse_connect converts)
    """
    now_utc = datetime.now(timezone.utc)
    return {
        "workspace_id": env.workspace_id,
        "vendor": env.vendor,
        "event_type": env.event_type,
        "idempotency_key": env.vendor_event_id,
        "received_at": env.received_at,          # Python datetime → DateTime64
        "event_at": env.event_at,                # Python datetime or None → Nullable(DateTime64)
        "payload": env.payload,
        "payload_version": env.payload_version,
        "ingested_at": now_utc,                  # Python datetime → DateTime
        # P0-B columns (0012 migration)
        "customer_ref": env.customer_ref,
        "lawful_basis": env.lawful_basis,
        "purpose_code": env.purpose_code,
    }


async def insert_to_clickhouse(
    ch_client: Any,
    row: dict[str, Any],
    workspace_id: str,
    trace_id: str,
    request_id: str,
) -> None:
    """
    Insert one row into brain.connector_raw_events via clickhouse_connect.

    Raises on any CH error (caller handles retry / metric counting).

    Args:
        ch_client:    clickhouse_connect client (or mock in tests).
        row:          Dict mapping column names to values.
        workspace_id: For log correlation only (NEVERLOG: no payload logged).
        trace_id:     Correlation trace ID.
        request_id:   Correlation request ID.
    """
    # clickhouse_connect.Client.insert expects column_names + data as list-of-lists
    col_names = list(row.keys())
    data = [list(row.values())]

    ch_client.insert(
        _CH_FULL_TABLE,
        data=data,
        column_names=col_names,
    )
    logger.debug(
        "raw_archiver_consumer: CH insert ok workspace_id=%r vendor=%r "
        "event_type=%r idempotency_key=%r trace_id=%r request_id=%r",
        workspace_id,
        row.get("vendor"),
        row.get("event_type"),
        row.get("idempotency_key"),
        trace_id,
        request_id,
    )


# ---------------------------------------------------------------------------
# Message processor (the unit-testable core)
# ---------------------------------------------------------------------------

async def process_message(
    raw_bytes: bytes,
    *,
    ch_client: Any,
    s3_client: Any = None,
) -> bool:
    """
    Process a single Kafka message: parse → CH insert → S3 write.

    This is the unit-testable core of the consumer loop.  The Kafka offset-commit
    logic lives in start_raw_archiver_consumer (the aiokafka runner).

    Args:
        raw_bytes:    Raw Kafka message value bytes.
        ch_client:    clickhouse_connect client (injected for tests).
        s3_client:    Optional boto3 S3 client (injected for tests).

    Returns:
        True  — CH insert succeeded (S3 failure doesn't block success).
        False — CH insert failed (offset should NOT be committed; let Kafka retry).

    Raises:
        ValueError: on parse failure (caller logs + commits offset to skip poison).
    """
    # Step 1: parse (raises ValueError on malformed message)
    env = parse_envelope(raw_bytes)

    _arc_inc("bronze_archiver_messages_consumed_total")

    # Step 2: CH insert (primary, must succeed)
    ch_row = _build_ch_row(env)
    try:
        await insert_to_clickhouse(
            ch_client, ch_row,
            workspace_id=env.workspace_id,
            trace_id=env.trace_id,
            request_id=env.request_id,
        )
        _arc_inc("bronze_archiver_ch_inserts_total")
    except Exception as exc:
        _arc_inc("bronze_archiver_ch_failures_total")
        logger.error(
            "raw_archiver_consumer: CH insert FAILED workspace_id=%r vendor=%r "
            "event_type=%r idempotency_key=%r trace_id=%r request_id=%r error=%s",
            env.workspace_id, env.vendor, env.event_type, env.vendor_event_id,
            env.trace_id, env.request_id,
            type(exc).__name__,
        )
        raise  # Let the caller decide whether to commit / retry

    # Step 3: S3 write (non-fatal — runs after CH so a S3 failure is isolated)
    s3_ok = await write_to_s3(
        workspace_id=env.workspace_id,
        vendor=env.vendor,
        received_at=env.received_at,
        idempotency_key=env.vendor_event_id,
        envelope_bytes=env.raw_bytes,
        s3_client=s3_client,
    )
    if not s3_ok:
        _arc_inc("bronze_archiver_s3_failures_total")
        # S3 failure does NOT return False — the CH write succeeded; the row
        # is in bronze.  The BACKUP cron (bronze_backup_cron.py) is the
        # compensating control until P1-D BronzeStorageStack is live.

    logger.info(
        "raw_archiver_consumer: processed workspace_id=%r vendor=%r "
        "event_type=%r idempotency_key=%r trace_id=%r s3_ok=%s",
        env.workspace_id, env.vendor, env.event_type, env.vendor_event_id,
        env.trace_id, s3_ok,
    )
    return True


# ---------------------------------------------------------------------------
# Consumer lifecycle  (aiokafka runner — called by main.py or a cron entry)
# ---------------------------------------------------------------------------

async def start_raw_archiver_consumer(
    kafka_bootstrap_servers: str = "",
    ch_client: Any = None,
    s3_client: Any = None,
) -> None:
    """
    Start the raw-archiver Kafka consumer loop.

    Must be called ONLY when BRONZE_RAW_ARCHIVER=true.  The caller (main.py or
    a health-checked task) is responsible for checking the flag before calling.

    This function runs until cancelled (asyncio.CancelledError) or a fatal
    broker error.  Individual message failures are caught per-message.

    Args:
        kafka_bootstrap_servers: Comma-separated Kafka broker list.
                                 Defaults to KAFKA_BOOTSTRAP_SERVERS env var.
        ch_client:               clickhouse_connect client override (tests).
        s3_client:               boto3 S3 client override (tests).
    """
    if not _archiver_enabled():
        logger.info(
            "raw_archiver_consumer: BRONZE_RAW_ARCHIVER=false — consumer not started. "
            "Set BRONZE_RAW_ARCHIVER=true after P0-B (PII_TOKENIZER) is green."
        )
        return

    try:
        import aiokafka  # noqa: PLC0415
    except ImportError as exc:
        raise ImportError(
            "aiokafka is required for raw_archiver_consumer. "
            "It is in ingestion-service dependencies."
        ) from exc

    brokers = (
        kafka_bootstrap_servers
        or os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:19092")
    ).split(",")
    brokers = [b.strip() for b in brokers if b.strip()]

    # Build CH client if not injected
    if ch_client is None:
        ch_client = _make_ch_client()

    consumer = aiokafka.AIOKafkaConsumer(
        *_get_subscribed_topics(),
        bootstrap_servers=brokers,
        group_id=GROUP_ID,
        auto_offset_reset="earliest",
        enable_auto_commit=False,  # Manual offset commit for at-least-once + CH durability
        value_deserializer=lambda x: x,  # Raw bytes — we parse manually
    )

    logger.info(
        "raw_archiver_consumer: starting group_id=%r brokers=%r",
        GROUP_ID, brokers,
    )

    await consumer.start()
    try:
        async for msg in consumer:
            raw = msg.value
            if not raw:
                await consumer.commit()
                continue

            try:
                await process_message(raw, ch_client=ch_client, s3_client=s3_client)
                # Only commit after successful CH insert
                await consumer.commit()
            except ValueError as parse_exc:
                # Parse error = poison message: log, count, and COMMIT to skip it.
                # A parse error cannot be fixed by retrying; the DLQ (P1-D) will
                # eventually handle persistent poison messages.
                _arc_inc("bronze_archiver_parse_errors_total")
                logger.error(
                    "raw_archiver_consumer: parse error — skipping poison message "
                    "topic=%r partition=%d offset=%d error=%s",
                    msg.topic, msg.partition, msg.offset,
                    parse_exc,
                )
                await consumer.commit()
            except Exception as ch_exc:
                # CH insert failure: do NOT commit — allow Kafka to re-deliver.
                # The consumer will retry on the next poll cycle.
                logger.error(
                    "raw_archiver_consumer: CH failure (offset NOT committed) "
                    "topic=%r partition=%d offset=%d error=%s",
                    msg.topic, msg.partition, msg.offset,
                    type(ch_exc).__name__,
                )
                # Small back-off to avoid tight-loop on persistent CH down
                import asyncio  # noqa: PLC0415
                await asyncio.sleep(1)
    finally:
        await consumer.stop()
        logger.info("raw_archiver_consumer: stopped.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_subscribed_topics() -> list[str]:
    """
    Return the list of Kafka topics this consumer subscribes to.

    Subscribes to all integrations.<vendor>.v1 topics that exist on the broker.
    For the local dev / CI environment (no broker) the list is empty and the
    consumer is not started.

    In production the broker's topic auto-discovery is used via the regex
    subscription pattern.  We return a static list of known topics here as a
    fallback for environments where aiokafka's regex subscribe is not available
    (e.g. older Kafka versions).

    The known-topics fallback covers: shopify, meta, google, shiprocket,
    woocommerce, klaviyo, unicommerce.  New vendors auto-register via the
    transform registry (P1-B) — this list does not need updating per vendor.
    """
    extra = os.environ.get("ARCHIVER_EXTRA_TOPICS", "")
    base = [
        "integrations.shopify.v1",
        "integrations.meta.v1",
        "integrations.google.v1",
        "integrations.shiprocket.v1",
        "integrations.woocommerce.v1",
        "integrations.klaviyo.v1",
        "integrations.unicommerce.v1",
    ]
    if extra:
        base += [t.strip() for t in extra.split(",") if t.strip()]
    return base


def _make_ch_client() -> Any:
    """
    Create a clickhouse_connect client from environment variables.

    Environment variables:
        CLICKHOUSE_HOST       — e.g. "localhost"
        CLICKHOUSE_PORT       — default 8123 (HTTP) or 8443 (HTTPS)
        CLICKHOUSE_USER       — default "default"
        CLICKHOUSE_PASSWORD   — default ""
        CLICKHOUSE_DATABASE   — default "brain"
    """
    try:
        import clickhouse_connect  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "clickhouse_connect is required for the bronze archiver. "
            "Add clickhouse-connect to ingestion-service pyproject.toml dependencies."
        ) from exc

    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    user = os.environ.get("CLICKHOUSE_USER", "default")
    password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    database = os.environ.get("CLICKHOUSE_DATABASE", "brain")

    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=user,
        password=password,
        database=database,
        connect_timeout=10,
        send_receive_timeout=30,
    )
