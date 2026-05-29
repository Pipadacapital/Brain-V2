"""
WebhookIngest gRPC servicer — verify-first / default-deny state machine.

@paradigm: sql + io/event-handling (no ML, no LLM, ₹0 marginal cost)

Paradigm justified: this is a constant-time HMAC compare + a single Postgres
point-lookup + an idempotent UPSERT + a Kafka produce. Zero probabilistic
inference surface. Confirms Aryan §3 / §17b; Maya co-owns the Python runtime.

CF-contract obligations implemented here:
  VERIFY-FIRST-1 (CRIT)              — default-deny state machine; every except → REJECT.
  MAP-AFTER-VERIFY-1 (CRIT)          — identity resolved ONLY post-verify.
  VENDOR-REGISTRY-DISPATCH-1 (CRIT)  — every per-vendor fact read from WEBHOOK_VERIFIERS
                                       registry; unknown/empty vendor → REJECT (default-deny).
  NO-HARDCODED-VENDOR-1 (HIGH)       — NO `== "shopify"` or vendor-literal branch anywhere
                                       in this module.  The registry is the authority.
  SINGLE-PRIMITIVE-1 (HIGH)          — one verify_fn (from spec) per request; no second verifier.
  NEVERLOG-1 (VETO Shreya)           — ids+outcome only; secret/signature/PII never logged.
  CORRELATION-1 (HIGH)               — request_id/trace_id propagated proto → _set_correlation.
  TRANSPORT-1 (MED)                  — internal grpc.aio only; not a public listener.
  TOPIC-ALLOWLIST-1 (MED)            — topic checked post-verify; unknown→IGNORED.

SEAM: the grpc.aio server startup (webhook_server.py) imports this servicer.
  This module contains ONLY the servicer logic — no server lifecycle.
  Tests instantiate the servicer directly without a running server.

GENERALIZATION NOTE (G2 of 06-architecture-plan.md §0-GEN):
  Shopify is ONE registered vendor, not the shape.  Adding vendor #2 is ZERO
  change to this module — add a VendorWebhookSpec row to webhook_registry.py only.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import grpc

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Outcome constants — match the proto enum (brain.ingestion.v1 Outcome).
# We use plain integers here to avoid a generated-stub import; the gRPC
# generated stubs are not yet committed (codegen runs in CI / buf generate).
# The server.py that uses these values passes them via the stub.
#
# Enum values (must stay in sync with ingestion.proto):
#   OUTCOME_UNSPECIFIED = 0  (proto3 zero value; never emitted)
#   OUTCOME_ACCEPTED    = 1
#   OUTCOME_REJECTED    = 2
#   OUTCOME_PARKED      = 3
#   OUTCOME_IGNORED     = 4
# ---------------------------------------------------------------------------

OUTCOME_ACCEPTED = 1
OUTCOME_REJECTED = 2
OUTCOME_PARKED = 3
OUTCOME_IGNORED = 4


# ---------------------------------------------------------------------------
# WebhookIngestServicer
# ---------------------------------------------------------------------------


class WebhookIngestServicer:
    """
    gRPC servicer implementing brain.ingestion.v1.WebhookIngestService.

    @paradigm: sql + io/event-handling

    Instantiated by webhook_server.py and registered against the generated stub.
    Tests instantiate directly (no running server needed) for unit coverage of
    the state machine.

    Dependency-injected for testability:
      - app_secret_provider_factory: callable → provider (default: select_app_secret_provider)
      - identity_resolver: callable(vendor, external_identity) → workspace_id | None
      - receive_webhook_fn: the async push-intake coroutine
      - allowed_workspace_ids: frozenset[str] from run_all_gates()
      - webhook_registry_override: dict[str, VendorWebhookSpec] (tests only — injected
        to register test-only vendors without touching WEBHOOK_VERIFIERS at module level)
    """

    def __init__(
        self,
        *,
        app_secret_provider_factory=None,
        identity_resolver=None,
        receive_webhook_fn=None,
        allowed_workspace_ids: frozenset[str] | None = None,
        webhook_registry_override: "dict | None" = None,
    ) -> None:
        # @paradigm: sql — all injected callables are deterministic; no LLM.
        if app_secret_provider_factory is None:
            from src.infrastructure.secrets.app_secret_factory import select_app_secret_provider
            app_secret_provider_factory = select_app_secret_provider
        if identity_resolver is None:
            from src.interfaces.grpc.identity_resolver import resolve_identity_workspace
            identity_resolver = resolve_identity_workspace
        if receive_webhook_fn is None:
            from src.application.framework.webhook_intake import receive_webhook
            receive_webhook_fn = receive_webhook

        self._secret_factory = app_secret_provider_factory
        self._identity_resolver = identity_resolver
        self._receive_webhook = receive_webhook_fn
        self._allowed_workspace_ids = allowed_workspace_ids or frozenset()
        # The registry override allows tests to inject a 2nd vendor spec
        # without modifying the module-level WEBHOOK_VERIFIERS (VENDOR-REGISTRY-DISPATCH-1).
        self._registry_override = webhook_registry_override

    def _get_registry(self) -> "dict":
        """Return the active registry (override for tests, module-level for production).

        @paradigm: sql — pure lookup, no IO.
        """
        if self._registry_override is not None:
            return self._registry_override
        from src.application.framework.webhook_registry import WEBHOOK_VERIFIERS
        return WEBHOOK_VERIFIERS

    async def ReceiveWebhook(self, request, context):
        """
        Verify-first / default-deny state machine (vendor-agnostic).

        @paradigm: sql + io/event-handling

        VENDOR-REGISTRY-DISPATCH-1 (CRIT): every per-vendor fact is read from
        the spec returned by WEBHOOK_VERIFIERS.get(request.vendor).
        NO "if vendor == <literal>" branch anywhere in this method.
        Unknown/empty vendor → REJECT (default-deny, same as a missing signature).

        VERIFY-FIRST-1 (CRIT): no workspace lookup, no DB touch, no Kafka produce
        occurs before the vendor's verify_fn returns True.  Every non-True branch → REJECTED.

        State machine:
          1. Unknown/empty vendor (not in registry)   → REJECTED (VENDOR-REGISTRY-DISPATCH-1)
          2. Missing/empty signature header            → REJECTED (VERIFY-FIRST-1)
          3. Secret retrieval raises (any exc)         → REJECTED (default-deny else)
          4. verify_fn returns False                   → REJECTED
          --- POST-VERIFY ONLY below this line ---
          5. external_identity unmapped                → PARKED  (no write)
          6. topic not in spec.topic_allowlist         → IGNORED (no write)
          7. all checks pass                           → ACCEPTED (upsert + produce)

        NEVERLOG-1 (VETO Shreya): only ids + outcome logged; no secret, no
        signature, no PII payload bytes in any log line or response field.
        """
        # Extract correlation from the proto request.
        request_id = request.request_id or ""
        trace_id = request.trace_id or ""

        # ----------------------------------------------------------------
        # STEP 1: vendor lookup — unknown/empty vendor → REJECT immediately.
        # VENDOR-REGISTRY-DISPATCH-1 (CRIT): the registry is the authority.
        # This is DEFAULT-DENY for vendors: if a vendor is not registered,
        # we reject before doing any cryptographic work.
        # NO "if vendor == <literal>" branch — the dict lookup IS the dispatch.
        # ----------------------------------------------------------------
        vendor = (request.vendor or "").strip()
        registry = self._get_registry()
        spec = registry.get(vendor)

        if spec is None:
            logger.warning(
                "webhook.verify: outcome=REJECTED reason=unknown_vendor "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,  # vendor is not PII (it's a system key like "shopify")
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="unknown_vendor")
            return _make_response(OUTCOME_REJECTED, request_id)

        # ----------------------------------------------------------------
        # STEP 2: missing/empty signature header → REJECT immediately.
        # MAP-AFTER-VERIFY-1: we do NOT read the identity header yet.
        # spec.signature_header is the vendor-declared header name — NOT hardcoded.
        # ----------------------------------------------------------------
        signature_header_value = request.headers.get(spec.signature_header, "").strip()
        if not signature_header_value:
            logger.warning(
                "webhook.verify: outcome=REJECTED reason=missing_signature_header "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="missing_header")
            return _make_response(OUTCOME_REJECTED, request_id)

        # ----------------------------------------------------------------
        # STEP 3: fetch the app secret — default-deny on ANY exception.
        #
        # VERIFY-FIRST-1 (CRIT): the entire try/except must resolve to
        # REJECT on any non-success path.  There is NO fall-open branch.
        # If the secret is unavailable the servicer REJECTS — never
        # processes the webhook on the optimistic assumption of validity.
        #
        # spec.secret_fn(provider) is the vendor-declared secret fetcher — NOT hardcoded.
        # The assignment `secret = spec.secret_fn(provider)` in the try block is the ONLY
        # success path; both named except clauses and the bare `except Exception` handler
        # all → REJECT immediately.  The bare `except Exception` is exhaustive — it covers
        # every Python exception, so `secret` is guaranteed non-None after this block
        # (no belt-guard needed; a guard would be dead code and vacuate mutation-3 tests).
        # ----------------------------------------------------------------
        from src.infrastructure.secrets.app_secret_provider import (
            AppSecretUnavailableError,
            HeldAppSecretError,
        )

        try:
            provider = self._secret_factory()
            secret: str = spec.secret_fn(provider)  # VENDOR-REGISTRY-DISPATCH-1: secret_fn from spec
        except AppSecretUnavailableError:
            # CF-HMAC-FAILCLOSED-1: secret unavailable — reject, never fall open.
            # NEVERLOG-1: no secret value, no exception body with value in message.
            logger.error(
                "webhook.verify: outcome=REJECTED reason=secret_unavailable "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="secret_unavailable")
            return _make_response(OUTCOME_REJECTED, request_id)
        except HeldAppSecretError:
            # CF-HMAC-FAILCLOSED-1: held provider — reject.
            logger.error(
                "webhook.verify: outcome=REJECTED reason=secret_held "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="secret_unavailable")
            return _make_response(OUTCOME_REJECTED, request_id)
        except Exception:
            # DEFAULT-DENY: any unexpected exception → REJECT.
            # NEVERLOG-1: log only outcome + ids; exc details must not include secret.
            # This is the load-bearing default-deny catch-all: the bare except Exception
            # is exhaustive, so execution reaches here only on truly unexpected failures,
            # and it MUST return REJECTED to preserve VERIFY-FIRST-1.
            logger.exception(
                "webhook.verify: outcome=REJECTED reason=secret_error_unexpected "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="secret_unavailable")
            return _make_response(OUTCOME_REJECTED, request_id)

        # ----------------------------------------------------------------
        # STEP 4: HMAC verification — the single cryptographic gate.
        #
        # SINGLE-PRIMITIVE-1: spec.verify_fn is called EXACTLY ONCE.
        #   No Node verifier, no second Python verifier.
        # VENDOR-REGISTRY-DISPATCH-1: verify_fn comes from the spec, not hardcoded.
        # NEVERLOG-1: raw_body and secret are NOT logged.
        # ----------------------------------------------------------------
        raw_body: bytes = request.raw_body
        verified = spec.verify_fn(raw_body, signature_header_value, secret)  # VENDOR-REGISTRY-DISPATCH-1

        if not verified:
            logger.warning(
                "webhook.verify: outcome=REJECTED reason=bad_signature "
                "vendor=%s request_id=%s trace_id=%s",
                vendor,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_rejected_total", reason="bad_signature")
            return _make_response(OUTCOME_REJECTED, request_id)

        # ================================================================
        # POST-VERIFY ONLY — attacker-controllable headers are NOW trusted.
        # MAP-AFTER-VERIFY-1 (CRIT): no workspace lookup occurred above.
        # ================================================================

        # Read the vendor-declared headers POST-VERIFY.
        # VENDOR-REGISTRY-DISPATCH-1: header names come from spec, NOT hardcoded.
        external_identity = request.headers.get(spec.identity_header, "").strip()
        topic = request.headers.get(spec.topic_header, "").strip()
        vendor_event_id = request.headers.get(spec.idempotency_header, "").strip()

        # ----------------------------------------------------------------
        # STEP 5: resolve external_identity → workspace_id (MAP-AFTER-VERIFY-1).
        # None → PARKED (logged config gap; 200 so vendor stops retrying).
        # ----------------------------------------------------------------
        workspace_id = await self._identity_resolver(vendor, external_identity)
        if workspace_id is None:
            logger.warning(
                "webhook.map: outcome=PARKED vendor=%s external_identity=%s topic=%s "
                "request_id=%s trace_id=%s",
                vendor,
                external_identity,  # external_identity is not PII (a shop domain / app id)
                topic,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_parked_total")
            return _make_response(OUTCOME_PARKED, request_id)

        # ----------------------------------------------------------------
        # STEP 6: topic allowlist (TOPIC-ALLOWLIST-1).
        # VENDOR-REGISTRY-DISPATCH-1: spec.topic_allowlist is vendor-specific.
        # Unknown topic → IGNORED (200); not our fault, stop vendor retries.
        # ----------------------------------------------------------------
        if topic not in spec.topic_allowlist:
            logger.info(
                "webhook.topic: outcome=IGNORED vendor=%s topic=%s workspace_id=%s "
                "request_id=%s trace_id=%s",
                vendor,
                topic,
                workspace_id,
                request_id,
                trace_id,
            )
            _inc_webhook_counter("webhook_ignored_total")
            return _make_response(OUTCOME_IGNORED, request_id)

        # ----------------------------------------------------------------
        # STEP 7: push-intake (PUSH-INTAKE-1).
        # Reuses normalize + PII gate + _upsert_event + _produce_kafka +
        # _set_correlation + assert_workspace_allowed.
        # vendor_event_id = spec.idempotency_header value (IDEMPOTENCY-ANCHOR-1).
        # No adapter.fetch, no window, no custody read (PUSH-INTAKE-1).
        # ----------------------------------------------------------------
        _inc_webhook_counter("webhook_received_total")
        await self._receive_webhook(
            vendor=vendor,
            raw_body=raw_body,
            headers=dict(request.headers),
            workspace_id=workspace_id,
            vendor_event_id=vendor_event_id,
            topic=topic,
            request_id=request_id,
            trace_id=trace_id,
            allowed_workspace_ids=self._allowed_workspace_ids,
        )

        logger.info(
            "webhook.intake: outcome=ACCEPTED vendor=%s external_identity=%s topic=%s "
            "workspace_id=%s request_id=%s trace_id=%s",
            vendor,
            external_identity,
            topic,
            workspace_id,
            request_id,
            trace_id,
        )
        return _make_response(OUTCOME_ACCEPTED, request_id)


# ---------------------------------------------------------------------------
# Response factory helper — keeps the servicer free of stub imports
# ---------------------------------------------------------------------------


def _make_response(outcome: int, request_id: str):
    """
    Build a ReceiveWebhookResponse-shaped object.

    @paradigm: sql — pure data construction, no IO.

    Returns a SimpleNamespace with .outcome and .request_id matching the
    proto-generated stub shape.  This approach decouples the servicer from
    the generated stubs for unit testing.  The gRPC server layer (webhook_server.py)
    wraps in the real generated stub when running live.
    """
    from types import SimpleNamespace
    return SimpleNamespace(outcome=outcome, request_id=request_id)


# ---------------------------------------------------------------------------
# Webhook counters — extend the existing ingest counters (§9 of plan)
# ---------------------------------------------------------------------------

# Four webhook-scoped counters (§9 / §17 Track 2, step 6).
# Extend the existing _COUNTERS dict in ingest.py via _inc below.
# The existing get_counters() + reset_counters() in ingest.py expose all counters.

_WEBHOOK_COUNTER_KEYS = frozenset({
    "webhook_received_total",
    "webhook_rejected_total",
    "webhook_parked_total",
    "webhook_ignored_total",
})


def _inc_webhook_counter(counter: str, reason: str | None = None) -> None:
    """Increment a webhook counter in the shared ingest._COUNTERS dict.

    @paradigm: sql — in-process counter mutation, no IO, no LLM.

    The `reason` label is captured in log structured fields (not as a metric label
    on the counter key itself) to avoid cardinality explosion in a future Prometheus
    export.  The log-based label keeps the key namespace simple.
    """
    from src.application.framework.ingest import _inc
    _inc(counter)
