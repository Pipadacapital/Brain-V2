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

LIVE-WIRING SEAM (PUSH-INTAKE-LIVE-1):
  Step 7 (push-intake) delegates to self._intake_runner, an injectable callable:

    intake_runner(receive_webhook_fn, workspace_id, **receive_kwargs) -> None

  Production default (_live_intake_runner):
    Opens a with_workspace session and calls receive_webhook_fn with db_conn +
    the module-level Kafka producer singleton.  DB commit + Kafka produce happen
    inside a single with_workspace context (CF-C3-RLS-CONSUME-1).

  Test passthrough (injected via WebhookIngestServicer(intake_runner=...)):
    Calls receive_webhook_fn(**kwargs) directly — no DB, no Kafka.
    Existing tests that inject receive_webhook_fn=_noop_receive also inject
    intake_runner=_passthrough_intake_runner (via _make_servicer test helper)
    so no DIRECT_URL is needed to run the unit test suite.

KAFKA SINGLETON (KAFKA-LAZY-SINGLETON-1):
  _KAFKA_PRODUCER is a module-level AIOKafkaProducer, started once, reused.
  Constructed lazily on first webhook arrival if KAFKA_BOOTSTRAP_SERVERS is set.
  If the env var is absent, the producer stays None (dry-run safe — _produce_kafka
  is skipped in receive_webhook when kafka_producer=None).
  Call start_kafka_producer() at server startup and stop_kafka_producer() at
  shutdown to manage the asyncio producer lifecycle cleanly.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import grpc

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Kafka producer singleton (KAFKA-LAZY-SINGLETON-1)
# ---------------------------------------------------------------------------
#
# One AIOKafkaProducer per process.  Started at server startup by
# start_kafka_producer(); stopped at shutdown by stop_kafka_producer().
# get_kafka_producer() returns the live producer or None if KAFKA_BOOTSTRAP_SERVERS
# is not set (dry-run safe: receive_webhook skips produce when kafka_producer=None).
#
# NEVERLOG-1: KAFKA_BOOTSTRAP_SERVERS is a server address, not a secret — logging
# the address (not credential) is safe.  No credentials are embedded in the bootstrap
# URL for the local-dev path.
# ---------------------------------------------------------------------------

_KAFKA_PRODUCER = None  # type: ignore[assignment]  # AIOKafkaProducer | None


async def start_kafka_producer() -> None:
    """Construct and start the module-level AIOKafkaProducer singleton.

    @paradigm: sql + io/event-handling — network IO only; no ML, no LLM.

    Safe to call multiple times (idempotent: skipped if already started).
    If KAFKA_BOOTSTRAP_SERVERS is not set, the producer stays None (dry-run safe).

    Called by webhook_server.py at server startup, before accepting requests.
    """
    global _KAFKA_PRODUCER

    if _KAFKA_PRODUCER is not None:
        return  # Already started — idempotent.

    bootstrap = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "").strip()
    if not bootstrap:
        logger.info(
            "webhook_servicer: KAFKA_BOOTSTRAP_SERVERS not set — "
            "Kafka producer will be None (dry-run; webhooks land in DB only)."
        )
        return

    try:
        from aiokafka import AIOKafkaProducer  # noqa: PLC0415 — optional dep
        _KAFKA_PRODUCER = AIOKafkaProducer(bootstrap_servers=bootstrap)
        await _KAFKA_PRODUCER.start()
        logger.info(
            "webhook_servicer: Kafka producer started bootstrap=%r",
            bootstrap,
        )
    except Exception:
        # NEVERLOG-1: no credentials in this log path; bootstrap_servers is safe.
        logger.exception(
            "webhook_servicer: Kafka producer start FAILED bootstrap=%r "
            "— producer stays None (dry-run fallback).",
            bootstrap,
        )
        _KAFKA_PRODUCER = None


async def stop_kafka_producer() -> None:
    """Stop and clear the module-level AIOKafkaProducer singleton.

    @paradigm: sql + io/event-handling — network IO only; no ML, no LLM.

    Safe to call when the producer is already None (idempotent).
    Called by webhook_server.py at graceful shutdown.
    """
    global _KAFKA_PRODUCER
    if _KAFKA_PRODUCER is None:
        return
    try:
        await _KAFKA_PRODUCER.stop()
        logger.info("webhook_servicer: Kafka producer stopped.")
    except Exception:
        logger.exception("webhook_servicer: Kafka producer stop failed.")
    finally:
        _KAFKA_PRODUCER = None


def get_kafka_producer():
    """Return the live AIOKafkaProducer or None if not started / not configured.

    @paradigm: sql — simple module-level read; no IO.
    """
    return _KAFKA_PRODUCER


# ---------------------------------------------------------------------------
# Intake runners — injectable seam (PUSH-INTAKE-LIVE-1)
# ---------------------------------------------------------------------------


async def _live_intake_runner(receive_webhook_fn, workspace_id: str, **kwargs) -> None:
    """Live intake runner: opens with_workspace and calls receive_webhook_fn with db_conn.

    @paradigm: sql + io/event-handling — DB session + Kafka produce; no ML, no LLM.

    CF-C3-RLS-CONSUME-1: every write goes through with_workspace (session-mode
    connection, tx-local set_config for RLS workspace context).

    KAFKA-LAZY-SINGLETON-1: passes the module-level _KAFKA_PRODUCER (may be None
    if KAFKA_BOOTSTRAP_SERVERS is not set — receive_webhook skips produce when None).

    P0-B / CF-C3-PII-TOKENIZER-1: fetches the per-workspace HMAC salt from KmsVault
    before opening the DB session.  Local dev: set BRAIN_PII_SALT_LOCAL_DEV=true to
    return a deterministic test salt without any AWS call (KmsVault handles this).
    Real AWS Secrets Manager provisioning (brain/{workspace_id}/pii_salt/v1) is a
    Stage-8 console ceremony.  When PII_TOKENIZER=false the salt fetch is skipped
    (tokenizer is a no-op; any bytes — including b"" — are acceptable).

    NEVERLOG-1: no PII or secrets in log lines.
    """
    from src.infrastructure.db.session_context import with_workspace
    from src.infrastructure.pii.kms_vault import KmsVault
    from src.domain.framework.pii_tokenizer import _tokenizer_enabled

    producer = get_kafka_producer()

    # Fetch the per-workspace PII salt only when the tokenizer is ON.
    # When PII_TOKENIZER=false the tokenizer is a no-op and any bytes are safe.
    pii_salt: bytes = b""
    pii_salt_version: str = kwargs.pop("pii_salt_version", "v1")
    if _tokenizer_enabled():
        vault = KmsVault()
        pii_salt = await vault.get_salt(workspace_id, pii_salt_version)

    async def _fn(conn):
        return await receive_webhook_fn(
            **kwargs,
            workspace_id=workspace_id,
            db_conn=conn,
            kafka_producer=producer,
            pii_workspace_salt=pii_salt,
            pii_salt_version=pii_salt_version,
        )

    await with_workspace(workspace_id, _fn)


async def _passthrough_intake_runner(receive_webhook_fn, workspace_id: str, **kwargs) -> None:
    """Test/dry-run passthrough: calls receive_webhook_fn directly, no DB, no Kafka.

    @paradigm: sql — pure pass-through delegation; no IO beyond what receive_webhook_fn does.

    Used by:
      - Tests that inject receive_webhook_fn=_noop_receive (servicer state-machine tests).
      - Tests that call receive_webhook directly with db_conn=None (dry-run unit tests).
    Inject via WebhookIngestServicer(intake_runner=_passthrough_intake_runner).
    """
    await receive_webhook_fn(**kwargs, workspace_id=workspace_id)

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
      - intake_runner: async callable(receive_webhook_fn, workspace_id, **kwargs) → None.
          Production default: _live_intake_runner (opens with_workspace + injects db_conn
          + Kafka producer singleton).
          Test passthrough: _passthrough_intake_runner (calls receive_webhook_fn directly,
          no DB, no Kafka — used by servicer state-machine tests that inject _noop_receive).
          Inject via WebhookIngestServicer(intake_runner=_passthrough_intake_runner) in
          test helpers to keep unit tests DB-free.
    """

    def __init__(
        self,
        *,
        app_secret_provider_factory=None,
        identity_resolver=None,
        receive_webhook_fn=None,
        allowed_workspace_ids: frozenset[str] | None = None,
        webhook_registry_override: "dict | None" = None,
        intake_runner=None,
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

        # intake_runner: defaults to _live_intake_runner (with_workspace + Kafka singleton).
        # Tests inject _passthrough_intake_runner to avoid needing DIRECT_URL.
        if intake_runner is None:
            intake_runner = _live_intake_runner

        self._secret_factory = app_secret_provider_factory
        self._identity_resolver = identity_resolver
        self._receive_webhook = receive_webhook_fn
        self._intake_runner = intake_runner
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
        #
        # PUSH-INTAKE-LIVE-1: delegates to self._intake_runner which opens
        # with_workspace and injects db_conn + Kafka producer singleton.
        # Tests inject _passthrough_intake_runner to skip DB/Kafka.
        # ----------------------------------------------------------------
        _inc_webhook_counter("webhook_received_total")
        await self._intake_runner(
            self._receive_webhook,
            workspace_id,
            vendor=vendor,
            raw_body=raw_body,
            headers=dict(request.headers),
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
# Response factory helper — builds the grpcio ReceiveWebhookResponse
# ---------------------------------------------------------------------------

# Module-level cache: resolved once, reused on every call.
_ReceiveWebhookResponse = None  # type: ignore[assignment]


def _get_response_class():
    """
    Return the grpcio-generated ReceiveWebhookResponse class.

    @paradigm: sql — module-level lazy load, no IO.

    Adds the committed _pb2 directory to sys.path on first call so the
    generated stubs are importable without a manual codegen step.
    Stubs live at src/interfaces/grpc/_pb2/brain/ingestion/v1/ingestion_pb2.py
    (committed in the repo — DO NOT delete or move).

    Falls back to SimpleNamespace if the stubs are somehow absent (defensive
    only — stubs are committed; this path should never trigger in production).
    """
    global _ReceiveWebhookResponse
    if _ReceiveWebhookResponse is not None:
        return _ReceiveWebhookResponse

    import pathlib
    import sys

    _pb2_dir = pathlib.Path(__file__).parent / "_pb2"
    _pb2_dir_str = str(_pb2_dir)
    if _pb2_dir_str not in sys.path:
        sys.path.insert(0, _pb2_dir_str)

    try:
        from brain.ingestion.v1 import ingestion_pb2  # noqa: PLC0415
        _ReceiveWebhookResponse = ingestion_pb2.ReceiveWebhookResponse
        return _ReceiveWebhookResponse
    except ImportError:
        # Defensive fallback — stubs absent (should not happen post-commit).
        # SimpleNamespace satisfies .outcome + .request_id access in tests.
        logger.warning(
            "webhook_servicer: grpcio stubs not found — _make_response falls back "
            "to SimpleNamespace.  Run grpcio-tools codegen to fix this."
        )
        from types import SimpleNamespace

        class _FallbackResponse:  # noqa: B024
            def __init__(self, outcome, request_id):
                self.outcome = outcome
                self.request_id = request_id

        return _FallbackResponse


def _make_response(outcome: int, request_id: str):
    """
    Build a ReceiveWebhookResponse proto message (grpcio-generated).

    @paradigm: sql — pure data construction, no IO.

    Uses the committed grpcio stubs at src/interfaces/grpc/_pb2/.
    The grpcio server layer calls .SerializeToString() on this object
    when sending the wire response — a SimpleNamespace would raise
    AttributeError on that call.

    Tests check .outcome and .request_id — both are present on the real
    ReceiveWebhookResponse object so no test changes are needed.

    OUTCOME_* integer values match the proto enum (VERIFY-FIRST-1):
      OUTCOME_ACCEPTED = 1
      OUTCOME_REJECTED = 2
      OUTCOME_PARKED   = 3
      OUTCOME_IGNORED  = 4
    """
    cls = _get_response_class()
    resp = cls()
    resp.outcome = outcome
    resp.request_id = request_id
    return resp


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
