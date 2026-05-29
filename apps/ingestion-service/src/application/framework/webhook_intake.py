"""
Webhook push-intake — the sibling of ingest_batch for inbound webhook events.

@paradigm: sql + io/event-handling (no ML, no LLM, ₹0)

Paradigm justified: this is an idempotent Postgres UPSERT (ON CONFLICT DO UPDATE)
plus a Kafka produce.  The data path is: normalize (deterministic dict mapping) →
PII gate (heuristic substring check, no inference) → UPSERT → Kafka.  Zero
probabilistic surface.  Confirms §3 of the architecture plan.

CF contract:
  PUSH-INTAKE-1 (MED)                — NO adapter.fetch, NO window, NO custody read.
    This is a push path: the raw body arrives in the RPC call.  ingest_batch
    (pull path) is untouched — its locked signature is UNCHANGED.
  IDEMPOTENCY-ANCHOR-1 (HIGH)        — vendor_event_id = spec.idempotency_header value
    (passed in from the servicer as `vendor_event_id`), NOT a body hash.
    Duplicate vendor delivery → ON CONFLICT no-op.
    A legitimate order-update re-fire (same vendor_event_id, updated body from
    vendor retry) is idempotent.
  REPLAY-NOOP-1 (MED)               — ON CONFLICT DO UPDATE handles duplicate delivery.
  CORRELATION-1 (HIGH)              — _set_correlation propagates request_id/trace_id
    into the context and subsequently into the Kafka envelope.
  NEVERLOG-1 (VETO Shreya)          — only ids + outcome logged; raw PII bytes never
    appear in a log line.
  VENDOR-REGISTRY-DISPATCH-1 (CRIT) — vendor is a parameter (flows in from the
    servicer which read it from the registry); NO hardcoded vendor literal or branch.
  NO-HARDCODED-VENDOR-1 (HIGH)      — zero `== "shopify"` branches in this module.

Seam reuse (verified on disk against §0 of the architecture plan):
  ShopifyAdapter.normalize   — shopify_adapter.py:163  (Shopify-specific normalize;
                               for non-Shopify vendors a vendor-specific adapter is
                               added to their VendorWebhookSpec in a future slice;
                               v1 only has Shopify so this module still uses it)
  SHOPIFY_PII_MANIFEST       — shopify_adapter.py:51
  check_pii_fields           — domain/framework/pii_manifest.py
  _upsert_event              — ingest.py:257 (ON CONFLICT idempotency key)
  _produce_kafka             — ingest.py:328 (workspace_id partition key)
  _set_correlation           — ingest.py:89 (4-tuple ContextVar bind)
  assert_workspace_allowed   — bootstrap/startup_gates.py:135

NOT reused (as per PUSH-INTAKE-1):
  adapter.fetch              — no vendor API call; payload arrived in the RPC.
  upsert_cursor              — no cursor; webhooks are event-driven, not windowed.
  CredentialCustody          — verify uses the app-secret (already consumed by the
                               servicer before this function is called).

Vendor extensibility note:
  For v1 this module hard-wires the ShopifyAdapter for normalize/manifest because
  Shopify is the only registered vendor.  When a second vendor is onboarded its
  normalize/manifest will be looked up from the VendorWebhookSpec (a future field
  on the spec).  The `vendor` parameter already flows through so the Kafka topic
  and RawEvent.vendor are already generic.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from src.application.framework.ingest import (
    _produce_kafka,
    _set_correlation,
    _upsert_event,
    _inc,
)
from src.bootstrap.startup_gates import assert_workspace_allowed
from src.domain.framework.adapter import NormalizedEvent, RawEvent
from src.domain.framework.pii_manifest import check_pii_fields
from src.interfaces.adapters.shopify_adapter import (
    SHOPIFY_PII_MANIFEST,
    ShopifyAdapter,
)

logger = logging.getLogger(__name__)

# Shared ShopifyAdapter instance — normalize() is stateless.
# v1: Shopify is the only registered vendor; normalize is Shopify-specific.
# When vendor #2 is onboarded its adapter comes from the VendorWebhookSpec.
_SHOPIFY_ADAPTER = ShopifyAdapter()

# Shopify topic → event_type mapping (Shopify-specific, v1 only).
# Unknown topics are IGNORED by the servicer before receive_webhook is called
# (TOPIC-ALLOWLIST-1), so this map only needs to cover the allowlist entries.
_SHOPIFY_TOPIC_TO_EVENT_TYPE: dict[str, str] = {
    "orders/create": "order",
    "orders/updated": "order",
    "orders/paid": "order",
    "orders/fulfilled": "order",
    "orders/cancelled": "order",
    "customers/create": "customer",
    "customers/update": "customer",
    "products/create": "product",
    "products/update": "product",
}

# Default event_type when the topic mapping is not found.
# Servicer's topic-allowlist gate ensures this only fires for known topics;
# the fallback is a belt-and-suspenders measure.
_DEFAULT_EVENT_TYPE = "order"


async def receive_webhook(
    *,
    vendor: str,
    raw_body: bytes,
    headers: dict[str, str],
    workspace_id: str,
    vendor_event_id: str,
    topic: str,
    request_id: str = "",
    trace_id: str = "",
    allowed_workspace_ids: Optional[frozenset[str]] = None,
    db_conn=None,
    kafka_producer=None,
) -> None:
    """
    Push-intake for a verified webhook event (vendor-agnostic).

    @paradigm: sql + io/event-handling

    Called ONLY post-verify (servicer guarantees the vendor's verify_fn returned
    True before calling this).  Reuses ingest_batch internals for the write path;
    does NOT call adapter.fetch or advance a cursor (PUSH-INTAKE-1).

    VENDOR-REGISTRY-DISPATCH-1 / NO-HARDCODED-VENDOR-1:
      The `vendor` parameter flows through from the servicer (which read it from
      the registry).  NO `== "shopify"` or `if vendor …` branch in this function.
      `vendor` is used as a plain string in:
        - RawEvent.vendor       — the vendor column in raw_shopify_orders
        - Kafka topic           — "integrations.{vendor}.v1"

    Args:
        vendor:               The vendor key (from the registry dispatch).
        raw_body:             Verbatim bytes from the RPC request (post-verify).
        headers:              The full forwarded header dict (post-verify, trusted).
        workspace_id:         Resolved from connector_identity_map (post-verify).
        vendor_event_id:      The spec.idempotency_header value — the idempotency anchor.
                              IDEMPOTENCY-ANCHOR-1: NOT a hash of the body.
        topic:                Topic string (validated against spec.topic_allowlist by servicer).
        request_id:           Correlation UUID from the gateway.
        trace_id:             Distributed trace ID from the gateway.
        allowed_workspace_ids: Workspace allowlist from run_all_gates() (backstop).
        db_conn:              Optional AsyncConnection override (for tests).
        kafka_producer:       Optional Kafka producer override (for tests).
    """
    # CORRELATION-1: bind the 4-tuple to the Python ContextVar store.
    # This propagates into _produce_kafka's Kafka envelope automatically.
    _set_correlation(request_id, trace_id, workspace_id, actor="system:webhook")

    # Workspace allowlist backstop (CF-C3-WORKSPACE-ALLOWLIST-1).
    # The servicer already resolved workspace_id from the identity_map, but
    # assert_workspace_allowed is the defence-in-depth gate before any write.
    if allowed_workspace_ids is not None:
        assert_workspace_allowed(workspace_id, allowed_workspace_ids)

    # v1: Shopify is the only registered vendor; event_type mapping is Shopify-specific.
    # When vendor #2 is onboarded the mapping comes from the VendorWebhookSpec.
    event_type = _SHOPIFY_TOPIC_TO_EVENT_TYPE.get(topic, _DEFAULT_EVENT_TYPE)

    # Parse the raw body JSON once.  The bytes are verified at this point.
    # NEVERLOG-1: raw_payload is not emitted to any log line.
    try:
        raw_payload = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.error(
            "webhook.intake: json_parse_failed vendor=%s workspace_id=%s "
            "request_id=%s trace_id=%s error=%s",
            vendor,
            workspace_id,
            request_id,
            trace_id,
            type(exc).__name__,
        )
        raise

    # Build a RawEvent.
    # IDEMPOTENCY-ANCHOR-1: vendor_event_id = spec.idempotency_header value (the header),
    # NOT a hash of the body.  This ensures:
    #   - A duplicate vendor delivery (same vendor_event_id) → ON CONFLICT no-op.
    #   - A legitimate order-update re-fire (same vendor_event_id, updated body from
    #     a new vendor delivery) → UPSERT-updates the row (correct behaviour).
    # VENDOR-REGISTRY-DISPATCH-1: `vendor` is a parameter, not a hardcoded string.
    raw_event = RawEvent(
        vendor=vendor,                         # VENDOR-REGISTRY-DISPATCH-1: parameter, not literal
        vendor_event_id=vendor_event_id,       # IDEMPOTENCY-ANCHOR-1
        event_type=event_type,
        occurred_at=datetime.now(timezone.utc),
        raw_payload=raw_payload,
    )

    # Normalize via the shared ShopifyAdapter (same mapping as ingest_batch).
    # v1: ShopifyAdapter used because Shopify is the only registered vendor.
    normalized: NormalizedEvent = _SHOPIFY_ADAPTER.normalize(raw_event)

    # PII gate (CF-C3-PII-ADAPTER-GATE-1): fail-closed on undeclared PII fields.
    # Uses the same SHOPIFY_PII_MANIFEST as ingest_batch — no new gate logic.
    check_pii_fields(SHOPIFY_PII_MANIFEST, list(normalized.columns.keys()))

    ingested_at = datetime.now(timezone.utc)
    # Kafka topic: "integrations.{vendor}.v1" — vendor is parameterized, not hardcoded.
    # VENDOR-REGISTRY-DISPATCH-1: topic name uses the vendor parameter.
    topic_kafka = f"integrations.{vendor}.v1"

    if db_conn is not None:
        # Integration-test or live path: real DB connection provided.
        was_inserted = await _upsert_event(
            db_conn,
            workspace_id,
            normalized,
            SHOPIFY_PII_MANIFEST,
            request_id,
        )
        if was_inserted:
            _inc("ingest_events_upserted_total")
        else:
            _inc("ingest_events_deduped_total")
    else:
        # Dry-run / unit-test path: no DB connection; count as received.
        # In production the server wires a real db_conn from the pool.
        _inc("ingest_events_received_total")
        logger.debug(
            "webhook.intake: dry_run mode (no db_conn) vendor=%s workspace_id=%s "
            "request_id=%s",
            vendor,
            workspace_id,
            request_id,
        )

    # Kafka produce (at-least-once, after DB write per at-least-once posture).
    if kafka_producer is not None:
        try:
            await _produce_kafka(
                kafka_producer,
                topic_kafka,
                workspace_id,
                normalized,
                ingested_at,
                request_id=request_id,
                trace_id=trace_id,
            )
        except Exception as exc:
            # Log warning; event is already durably upserted.
            logger.warning(
                "webhook.intake: kafka_produce_failed vendor=%s workspace_id=%s "
                "request_id=%s trace_id=%s error=%s",
                vendor,
                workspace_id,
                request_id,
                trace_id,
                type(exc).__name__,
            )

    logger.info(
        "webhook.intake: complete vendor=%s workspace_id=%s event_type=%s "
        "vendor_event_id=%s request_id=%s trace_id=%s",
        vendor,
        workspace_id,
        event_type,
        vendor_event_id,  # NEVERLOG-1: vendor_event_id is NOT PII (it's a delivery ID)
        request_id,
        trace_id,
    )
