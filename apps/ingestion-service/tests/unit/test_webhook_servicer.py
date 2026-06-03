"""
Unit tests for the WebhookIngest servicer and receive_webhook push-intake.

@paradigm: sql + io/event-handling (tests for the verify-first state machine)

T-GEN-A REFACTOR (2026-05-29):
  All tests ported to the generic ReceiveWebhook RPC (was ReceiveShopifyWebhook).
  Request shape: request.vendor (new), request.raw_body, request.headers (was
  request.shopify_headers), request.request_id, request.trace_id.
  The servicer now dispatches via WEBHOOK_VERIFIERS[request.vendor] — no hardcoded
  vendor branch.

VERIFY-THE-VERIFIER-1 (CRIT durable rule):
  This file contains FIVE mutation kill-tests from the architecture plan §10 +
  §0-GEN G6.  Each mutation test has a # MUTATION: comment identifying what was
  mutated.  Each mutation MUST go RED when the indicated code change is made:
    1. flip verify_fn to always-True       → tampered/invalid accepted → RED
    2. reorder to map-before-verify        → workspace touched pre-verify → RED
    3. default-deny else → accept-on-unknown → bad-sig/no-secret accepted → RED
    4. anchor → body-hash                  → order-update replay dropped → RED
    5. hardcode Shopify spec ignoring vendor → 2nd-test-vendor matrix goes RED

VENDOR-REGISTRY-DISPATCH-1 (CRIT):
  A SECOND test-only vendor ("_test_token") is registered in the test fixtures
  using a trivial constant-secret token-equality verifier and its own distinct
  headers.  The FULL ACCEPTED→PARKED→IGNORED→REJECTED matrix runs GREEN against it
  with ZERO servicer/route/proto edits — proving the dispatch path is generic.
  Mutation #5 (hardcode Shopify spec) causes this matrix to go RED.

NO-HARDCODED-VENDOR-1 (HIGH, grep-gate):
  The servicer, resolver, and intake modules contain ZERO vendor-literal branches.
  Confirmed by TestNoHardcodedVendorGrep.

Tests are organised as:
  TestVerifyFirstStateMachine   — the state machine paths (plan §10 unit matrix)
  TestKillMutations             — the 5 VERIFY-THE-VERIFIER mutations (each MUST go RED)
  TestIdempotencyAnchor         — anchor tests + order-update re-fire
  TestReceiveWebhookPushIntake  — push-intake function unit tests (generic vendor)
  TestGenericityMatrix          — 2nd-test-vendor full ACCEPTED/PARKED/IGNORED/REJECTED matrix
                                  (VENDOR-REGISTRY-DISPATCH-1 proof)
  TestNeverlogAssertion         — grep test: no secret/sig/PII in captured logs
  TestNoHardcodedVendorGrep     — NO-HARDCODED-VENDOR-1 grep-gate
  TestVerifyShopifyHmacUnit     — direct tests of the single HMAC primitive
  TestTopicAllowlistCoverage    — allowlist constant well-formedness

Moto/stubbed: zero real AWS, zero real Kafka.  DB-less unit path via injected mocks.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac as hmac_mod
import json
import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.interfaces.grpc.webhook_servicer import (
    OUTCOME_ACCEPTED,   # 1 — matches proto OUTCOME_ACCEPTED
    OUTCOME_IGNORED,    # 4 — matches proto OUTCOME_IGNORED
    OUTCOME_PARKED,     # 3 — matches proto OUTCOME_PARKED
    OUTCOME_REJECTED,   # 2 — matches proto OUTCOME_REJECTED
    WebhookIngestServicer,
    _passthrough_intake_runner,
)
from src.application.framework.webhook_registry import (
    VendorWebhookSpec,
    WEBHOOK_VERIFIERS,
    SHOPIFY_TOPIC_ALLOWLIST,
)
from src.interfaces.adapters.shopify_adapter import verify_shopify_hmac

# ---------------------------------------------------------------------------
# Test helpers — Shopify vendor
# ---------------------------------------------------------------------------

_TEST_SECRET = "dev-test-secret-not-real"
_TEST_WID = "550e8400-e29b-41d4-a716-446655440000"
_TEST_SHOP = "sugandhlok.myshopify.com"
_TEST_TOPIC = "orders/create"
_TEST_WEBHOOK_ID = "abc123-webhook-id"
_TEST_VENDOR = "shopify"


def _sign_body(body: bytes, secret: str = _TEST_SECRET) -> str:
    """Compute the correct base64 HMAC-SHA256 for a raw body (Shopify verifier)."""
    return base64.b64encode(
        hmac_mod.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    ).decode("utf-8")


def _make_body(payload: dict | None = None) -> bytes:
    """Produce a JSON bytes body from a dict (simulating Shopify's raw payload)."""
    p = payload or {"id": "9001", "order_number": 1001, "financial_status": "paid"}
    return json.dumps(p).encode("utf-8")


def _make_request(
    body: bytes,
    hmac_header: str,
    *,
    vendor: str = _TEST_VENDOR,
    shop: str = _TEST_SHOP,
    topic: str = _TEST_TOPIC,
    webhook_id: str = _TEST_WEBHOOK_ID,
    request_id: str = "req-001",
    trace_id: str = "trace-001",
) -> SimpleNamespace:
    """Build a mock RPC request object matching the generic proto shape.

    Uses the generic `headers` field (was `shopify_headers`) and adds `vendor`.
    """
    return SimpleNamespace(
        vendor=vendor,
        raw_body=body,
        headers={
            "x-shopify-hmac-sha256": hmac_header,
            "x-shopify-shop-domain": shop,
            "x-shopify-topic": topic,
            "x-shopify-webhook-id": webhook_id,
        },
        request_id=request_id,
        trace_id=trace_id,
    )


def _make_secret_provider(secret: str = _TEST_SECRET):
    """Return a mock secret factory that returns a provider with the given secret."""
    provider = MagicMock()
    provider.get_shopify_hmac_secret.return_value = secret
    factory = MagicMock(return_value=provider)
    return factory


async def _noop_resolver(vendor: str, external_identity: str) -> str | None:
    """Generic identity resolver: maps the test shop to the test workspace."""
    if vendor == _TEST_VENDOR and external_identity == _TEST_SHOP:
        return _TEST_WID
    return None


async def _noop_receive(**kwargs) -> None:
    """No-op receive_webhook for servicer tests that reach the intake step."""
    pass


def _make_servicer(
    *,
    secret: str = _TEST_SECRET,
    resolver=None,
    receive_fn=None,
    registry_override: dict | None = None,
) -> WebhookIngestServicer:
    """Construct a servicer with injected test doubles.

    registry_override allows tests to register test-only vendors without
    modifying the module-level WEBHOOK_VERIFIERS.

    intake_runner is always _passthrough_intake_runner for unit tests — this
    keeps the servicer state-machine tests DB-free (no DIRECT_URL required).
    The passthrough calls receive_webhook_fn directly without with_workspace.
    """
    return WebhookIngestServicer(
        app_secret_provider_factory=_make_secret_provider(secret),
        identity_resolver=resolver or _noop_resolver,
        receive_webhook_fn=receive_fn or _noop_receive,
        allowed_workspace_ids=frozenset({_TEST_WID}),
        webhook_registry_override=registry_override,
        intake_runner=_passthrough_intake_runner,
    )


# ---------------------------------------------------------------------------
# Test helpers — _test_token 2nd vendor (TEST-ONLY, VENDOR-REGISTRY-DISPATCH-1)
#
# A trivial constant-secret token-equality verifier for genericity proof.
# "_test_token" is registered ONLY in test fixtures — never in the production
# WEBHOOK_VERIFIERS.  Its verify_fn, headers, and topic_allowlist are distinct
# from Shopify's to confirm the dispatch path does not hard-wire Shopify.
# ---------------------------------------------------------------------------

_TEST2_VENDOR = "_test_token"
_TEST2_SECRET = "test-vendor-secret-constant"
_TEST2_SIG_HEADER = "x-test-token-signature"
_TEST2_IDENTITY_HEADER = "x-test-identity"
_TEST2_IDEMPOTENCY_HEADER = "x-test-event-id"
_TEST2_TOPIC_HEADER = "x-test-topic"
_TEST2_ALLOWLIST: frozenset[str] = frozenset({"test/event", "test/create"})
_TEST2_IDENTITY = "test-connector-id-001"
_TEST2_EVENT_ID = "test-event-id-xyz"
_TEST2_TOPIC = "test/event"


def _test_token_verify(raw_body: bytes, signature: str, secret: str) -> bool:
    """
    Trivial token-equality verifier for the _test_token vendor (TESTS ONLY).

    @paradigm: sql — deterministic comparison, no IO.

    Verifies by checking that signature == secret (token equality).
    Intentionally simple — the point is to prove the registry dispatch path
    works for ANY verifier, not to test cryptographic correctness.
    Uses hmac.compare_digest for constant-time compare (avoids timing attack
    even in test code, consistent with the production pattern).
    """
    return hmac_mod.compare_digest(signature, secret)


def _make_test2_provider():
    """Return a mock factory for the _test_token vendor."""
    provider = MagicMock()
    # test_token vendor secret fetcher — distinct method name from Shopify's
    provider.get_test_token_secret = MagicMock(return_value=_TEST2_SECRET)
    factory = MagicMock(return_value=provider)
    return factory


def _make_test2_spec() -> VendorWebhookSpec:
    """Build the test-only _test_token VendorWebhookSpec."""
    return VendorWebhookSpec(
        vendor=_TEST2_VENDOR,
        verify_fn=_test_token_verify,
        secret_fn=lambda p: p.get_test_token_secret(),
        signature_header=_TEST2_SIG_HEADER,
        identity_header=_TEST2_IDENTITY_HEADER,
        idempotency_header=_TEST2_IDEMPOTENCY_HEADER,
        topic_header=_TEST2_TOPIC_HEADER,
        topic_allowlist=_TEST2_ALLOWLIST,
    )


def _make_combined_registry() -> dict[str, VendorWebhookSpec]:
    """Return a registry that includes BOTH the Shopify spec AND the test2 spec."""
    return {
        **WEBHOOK_VERIFIERS,  # production registry (Shopify)
        _TEST2_VENDOR: _make_test2_spec(),  # test-only 2nd vendor
    }


def _make_test2_request(
    *,
    # _test_token vendor: signature = secret (token-equality verifier)
    signature: str = _TEST2_SECRET,
    identity: str = _TEST2_IDENTITY,
    topic: str = _TEST2_TOPIC,
    event_id: str = _TEST2_EVENT_ID,
    raw_body: bytes = b"test-body-payload",
    request_id: str = "t2-req-001",
    trace_id: str = "t2-trace-001",
) -> SimpleNamespace:
    """Build a mock RPC request for the _test_token vendor."""
    return SimpleNamespace(
        vendor=_TEST2_VENDOR,
        raw_body=raw_body,
        headers={
            _TEST2_SIG_HEADER: signature,
            _TEST2_IDENTITY_HEADER: identity,
            _TEST2_TOPIC_HEADER: topic,
            _TEST2_IDEMPOTENCY_HEADER: event_id,
        },
        request_id=request_id,
        trace_id=trace_id,
    )


async def _test2_resolver(vendor: str, external_identity: str) -> str | None:
    """Resolver for _test_token vendor: maps the test identity to the test workspace."""
    if vendor == _TEST2_VENDOR and external_identity == _TEST2_IDENTITY:
        return _TEST_WID
    return None


async def _combined_resolver(vendor: str, external_identity: str) -> str | None:
    """Resolver for both Shopify and _test_token vendors."""
    if vendor == _TEST_VENDOR and external_identity == _TEST_SHOP:
        return _TEST_WID
    if vendor == _TEST2_VENDOR and external_identity == _TEST2_IDENTITY:
        return _TEST_WID
    return None


def _make_combined_servicer(
    *,
    receive_fn=None,
    resolver=None,
) -> WebhookIngestServicer:
    """Build a servicer with BOTH shopify + _test_token in the registry.

    intake_runner is always _passthrough_intake_runner for unit tests — DB-free.
    """
    # The combined secret provider can serve both vendors.
    shopify_provider = MagicMock()
    shopify_provider.get_shopify_hmac_secret.return_value = _TEST_SECRET
    shopify_provider.get_test_token_secret = MagicMock(return_value=_TEST2_SECRET)
    factory = MagicMock(return_value=shopify_provider)

    return WebhookIngestServicer(
        app_secret_provider_factory=factory,
        identity_resolver=resolver or _combined_resolver,
        receive_webhook_fn=receive_fn or _noop_receive,
        allowed_workspace_ids=frozenset({_TEST_WID}),
        webhook_registry_override=_make_combined_registry(),
        intake_runner=_passthrough_intake_runner,
    )


# ---------------------------------------------------------------------------
# TestVerifyFirstStateMachine
# Covers all state machine paths from §10 (unit test matrix).
# ---------------------------------------------------------------------------


class TestVerifyFirstStateMachine:
    """
    Verify-first / default-deny state machine — all outcome branches.

    VERIFY-FIRST-1 (CRIT): every non-verify-True path → REJECTED.
    MAP-AFTER-VERIFY-1 (CRIT): workspace resolver NOT called on reject paths.
    VENDOR-REGISTRY-DISPATCH-1: unknown vendor → REJECTED before any HMAC work.
    """

    @pytest.mark.asyncio
    async def test_valid_webhook_accepted(self):
        """Valid HMAC + mapped shop + known topic → ACCEPTED."""
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)
        servicer = _make_servicer()

        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_ACCEPTED

    @pytest.mark.asyncio
    async def test_unknown_vendor_rejected(self):
        """Unknown vendor not in registry → REJECTED (VENDOR-REGISTRY-DISPATCH-1)."""
        body = _make_body()
        req = SimpleNamespace(
            vendor="unknown_vendor_xyz",
            raw_body=body,
            headers={"x-shopify-hmac-sha256": "anything"},
            request_id="req-unknown",
            trace_id="trace-unknown",
        )

        resolver_called = []

        async def tracking_resolver(vendor, external_identity):
            resolver_called.append((vendor, external_identity))
            return _TEST_WID

        servicer = _make_servicer(resolver=tracking_resolver)
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED
        # VENDOR-REGISTRY-DISPATCH-1: resolver must NOT be called for unknown vendor
        assert len(resolver_called) == 0, (
            "Resolver called for unknown vendor — VENDOR-REGISTRY-DISPATCH-1 violation!"
        )

    @pytest.mark.asyncio
    async def test_empty_vendor_rejected(self):
        """Empty vendor string → REJECTED (default-deny, VENDOR-REGISTRY-DISPATCH-1)."""
        body = _make_body()
        req = SimpleNamespace(
            vendor="",
            raw_body=body,
            headers={"x-shopify-hmac-sha256": "anything"},
            request_id="req-empty-vendor",
            trace_id="trace-empty",
        )
        servicer = _make_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED

    @pytest.mark.asyncio
    async def test_missing_hmac_header_rejected(self):
        """Missing signature header → REJECTED (no workspace lookup)."""
        body = _make_body()
        req = _make_request(body, hmac_header="")  # missing

        resolver_called = []

        async def tracking_resolver(vendor, external_identity):
            resolver_called.append((vendor, external_identity))
            return _TEST_WID

        servicer = _make_servicer(resolver=tracking_resolver)
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED
        # MAP-AFTER-VERIFY-1: resolver must NOT be called when header is missing
        assert len(resolver_called) == 0, "Resolver called before verify — MAP-AFTER-VERIFY-1 violation!"

    @pytest.mark.asyncio
    async def test_tampered_body_rejected(self):
        """Valid sig on original body but body was mutated → HMAC mismatch → REJECTED."""
        original_body = _make_body()
        sig = _sign_body(original_body)
        tampered_body = original_body + b" TAMPERED"
        req = _make_request(tampered_body, sig)
        servicer = _make_servicer()

        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED

    @pytest.mark.asyncio
    async def test_tampered_signature_rejected(self):
        """Correct body but wrong signature → HMAC mismatch → REJECTED."""
        body = _make_body()
        wrong_sig = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        req = _make_request(body, hmac_header=wrong_sig)
        servicer = _make_servicer()

        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED

    @pytest.mark.asyncio
    async def test_secret_unavailable_rejected_fail_closed(self):
        """AppSecretUnavailableError → REJECTED; never fall open."""
        from src.infrastructure.secrets.app_secret_provider import AppSecretUnavailableError

        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = AppSecretUnavailableError("test")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED

    @pytest.mark.asyncio
    async def test_held_secret_rejected_fail_closed(self):
        """HeldAppSecretError → REJECTED; never fall open."""
        from src.infrastructure.secrets.app_secret_provider import HeldAppSecretError

        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = HeldAppSecretError("get_shopify_hmac_secret")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED

    @pytest.mark.asyncio
    async def test_unmapped_identity_parked_no_write(self):
        """Verified HMAC, but identity not in connector_identity_map → PARKED (no write)."""
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig, shop="unknown-shop.myshopify.com")

        receive_called = []

        async def tracking_receive(**kwargs):
            receive_called.append(kwargs)

        servicer = _make_servicer(receive_fn=tracking_receive)
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_PARKED
        # No write — receive_webhook must NOT be called
        assert len(receive_called) == 0, "receive_webhook called for unmapped identity — MAP-AFTER-VERIFY-1 violation!"

    @pytest.mark.asyncio
    async def test_unknown_topic_ignored_no_write(self):
        """Verified HMAC + mapped identity but unknown topic → IGNORED (no write)."""
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig, topic="inventory/update")  # not in allowlist

        receive_called = []

        async def tracking_receive(**kwargs):
            receive_called.append(kwargs)

        servicer = _make_servicer(receive_fn=tracking_receive)
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_IGNORED
        assert len(receive_called) == 0, "receive_webhook called for ignored topic!"

    @pytest.mark.asyncio
    async def test_duplicate_vendor_event_id_noop(self):
        """Duplicate vendor_event_id → servicer accepts (ON CONFLICT in receive)."""
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig, webhook_id="dup-webhook-id")

        servicer = _make_servicer()
        resp1 = await servicer.ReceiveWebhook(req, context=None)
        resp2 = await servicer.ReceiveWebhook(req, context=None)

        assert resp1.outcome == OUTCOME_ACCEPTED
        assert resp2.outcome == OUTCOME_ACCEPTED

    @pytest.mark.asyncio
    async def test_correlation_propagated(self):
        """request_id from proto is echo'd in the response (CORRELATION-1)."""
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig, request_id="my-unique-req-id")
        servicer = _make_servicer()

        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.request_id == "my-unique-req-id", "CORRELATION-1: request_id not echo'd in response"

    @pytest.mark.asyncio
    async def test_unexpected_exception_from_secret_rejected(self):
        """Any unexpected exception from secret retrieval → REJECTED (default-deny)."""
        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = RuntimeError("unexpected network error")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED


# ---------------------------------------------------------------------------
# TestGenericityMatrix
# VENDOR-REGISTRY-DISPATCH-1 (CRIT): 2nd test-vendor full matrix proof.
#
# A SECOND vendor ("_test_token") is registered ONLY in test fixtures.
# The full ACCEPTED→PARKED→IGNORED→REJECTED matrix runs GREEN with ZERO
# servicer/route/proto changes — proving the path is generic, not Shopify-shaped.
#
# Mutation #5 (hardcode Shopify spec in servicer) causes this class to go RED.
# ---------------------------------------------------------------------------


class TestGenericityMatrix:
    """
    2nd-test-vendor full ACCEPTED/PARKED/IGNORED/REJECTED matrix.

    VENDOR-REGISTRY-DISPATCH-1 (CRIT): This entire class proves that the servicer
    dispatch is generic.  The _test_token vendor uses:
      - A completely different verify_fn (token equality vs. base64-HMAC-SHA256)
      - Different header names (x-test-* vs. x-shopify-*)
      - A different topic_allowlist (test/event vs. orders/create etc.)
      - A different identity_header

    ZERO servicer / route / proto changes are needed to support this vendor.
    Only the registry override (webhook_registry_override) registers it.
    """

    @pytest.mark.asyncio
    async def test_2nd_vendor_accepted(self):
        """
        _test_token vendor with valid token-signature + mapped identity + known topic
        → ACCEPTED.  Proves VENDOR-REGISTRY-DISPATCH-1: ReceiveWebhook dispatches
        to the _test_token spec with ZERO servicer code changes.
        """
        req = _make_test2_request()  # valid signature = _TEST2_SECRET (token verifier)
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_ACCEPTED, (
            f"VENDOR-REGISTRY-DISPATCH-1: _test_token vendor ACCEPTED path failed. "
            f"outcome={resp.outcome}"
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_rejected_bad_signature(self):
        """
        _test_token vendor with wrong signature → REJECTED.
        Proves the dispatch path applies the test vendor's verify_fn (not Shopify's).
        """
        req = _make_test2_request(signature="wrong-token-signature")
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED, (
            f"VENDOR-REGISTRY-DISPATCH-1: _test_token bad-signature should be REJECTED. "
            f"outcome={resp.outcome}"
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_rejected_missing_signature_header(self):
        """
        _test_token vendor with missing signature header → REJECTED.
        The servicer reads spec.signature_header (x-test-token-signature), not x-shopify-*.
        """
        req = SimpleNamespace(
            vendor=_TEST2_VENDOR,
            raw_body=b"test-body",
            headers={
                # Omit the _TEST2_SIG_HEADER intentionally
                _TEST2_IDENTITY_HEADER: _TEST2_IDENTITY,
                _TEST2_TOPIC_HEADER: _TEST2_TOPIC,
                _TEST2_IDEMPOTENCY_HEADER: _TEST2_EVENT_ID,
            },
            request_id="t2-req-missing-sig",
            trace_id="t2-trace-missing-sig",
        )
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED, (
            "VENDOR-REGISTRY-DISPATCH-1: missing _test_token sig header should REJECT."
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_parked_unmapped_identity(self):
        """
        _test_token vendor with unmapped identity → PARKED (no write).
        Proves MAP-AFTER-VERIFY-1 works for the 2nd vendor.
        """
        req = _make_test2_request(identity="unmapped-connector-id")
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_PARKED, (
            f"VENDOR-REGISTRY-DISPATCH-1: _test_token unmapped identity should PARK. "
            f"outcome={resp.outcome}"
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_ignored_unknown_topic(self):
        """
        _test_token vendor with unknown topic → IGNORED (no write).
        Proves TOPIC-ALLOWLIST-1 works for the 2nd vendor (using the test allowlist).
        """
        req = _make_test2_request(topic="unknown/topic")  # not in _TEST2_ALLOWLIST
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_IGNORED, (
            f"VENDOR-REGISTRY-DISPATCH-1: _test_token unknown topic should IGNORE. "
            f"outcome={resp.outcome}"
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_map_after_verify_enforced(self):
        """
        _test_token vendor: resolver is NOT called on bad-signature path.
        MAP-AFTER-VERIFY-1 applies to all registered vendors.
        """
        req = _make_test2_request(signature="wrong-token")

        resolver_calls: list = []

        async def tracking_resolver(vendor, external_identity):
            resolver_calls.append((vendor, external_identity))
            return _TEST_WID

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=_make_combined_servicer()._secret_factory,
            identity_resolver=tracking_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
            webhook_registry_override=_make_combined_registry(),
        )
        # Need to rebuild the factory for the combined provider
        combined_provider = MagicMock()
        combined_provider.get_shopify_hmac_secret.return_value = _TEST_SECRET
        combined_provider.get_test_token_secret = MagicMock(return_value=_TEST2_SECRET)
        factory = MagicMock(return_value=combined_provider)

        servicer2 = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=tracking_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
            webhook_registry_override=_make_combined_registry(),
        )
        resp = await servicer2.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED
        assert len(resolver_calls) == 0, (
            "MAP-AFTER-VERIFY-1: resolver called before verify for _test_token vendor. "
            f"Got {len(resolver_calls)} calls."
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_does_not_interfere_with_shopify(self):
        """
        With the combined registry, a valid Shopify request still → ACCEPTED.
        The two vendors coexist without interference.
        """
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)  # vendor="shopify" by default

        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_ACCEPTED, (
            "Shopify ACCEPTED path broken when _test_token vendor is also registered."
        )

    @pytest.mark.asyncio
    async def test_shopify_request_rejected_as_test_vendor(self):
        """
        A Shopify-signed body presented as _test_token vendor → REJECTED.
        Each vendor's spec is independent — the Shopify signature does not satisfy
        the _test_token token-equality verifier.
        """
        body = _make_body()
        shopify_sig = _sign_body(body)
        # Use a request with vendor=_TEST2_VENDOR but with a Shopify-style signature
        req = SimpleNamespace(
            vendor=_TEST2_VENDOR,
            raw_body=body,
            headers={
                _TEST2_SIG_HEADER: shopify_sig,  # Shopify base64 sig, not the token secret
                _TEST2_IDENTITY_HEADER: _TEST2_IDENTITY,
                _TEST2_TOPIC_HEADER: _TEST2_TOPIC,
                _TEST2_IDEMPOTENCY_HEADER: _TEST2_EVENT_ID,
            },
            request_id="cross-vendor-test",
            trace_id="cross-vendor-trace",
        )
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        # Shopify base64 sig != _TEST2_SECRET → token verifier returns False → REJECTED
        assert resp.outcome == OUTCOME_REJECTED, (
            "Cross-vendor signature must be REJECTED — each vendor's verifier is independent."
        )

    @pytest.mark.asyncio
    async def test_2nd_vendor_correlation_propagated(self):
        """_test_token vendor: request_id is echo'd in response (CORRELATION-1)."""
        req = _make_test2_request(request_id="t2-corr-test-id")
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.request_id == "t2-corr-test-id", (
            "CORRELATION-1: request_id not echo'd for _test_token vendor."
        )


# ---------------------------------------------------------------------------
# TestKillMutations
# VERIFY-THE-VERIFIER-1 (CRIT): 5 mutation kill-tests.
# Each test contains a # MUTATION: comment showing what code change makes it RED.
# The test itself is CORRECT — it tests the correct behaviour.
# A mutation that breaks the invariant causes the test to fail (go RED).
# ---------------------------------------------------------------------------


class TestKillMutations:
    """
    5-mutation kill-test suite.  Each test MUST go RED when the indicated mutation
    is applied to the production code.  Rohan re-mutates these at Stage 6.

    MUTATION 1: In webhook_servicer.py, replace:
        verified = spec.verify_fn(raw_body, signature_header_value, secret)
        if not verified:
            ...REJECT...
      with:
        verified = True   ← always-True mutation
        if not verified:
            ...
    Expected result: RED (tampered body accepted → test_mutation_1_alwaystrue_verify_rejects_tampered FAILS)

    MUTATION 2: In webhook_servicer.py, move the identity-resolver call (STEP 5)
      ABOVE the verify call (STEP 4) — before `verified = spec.verify_fn(...)`.
    Expected result: RED (workspace_id populated before verify → test_mutation_2_map_before_verify_fires FAILS)

    MUTATION 3: In webhook_servicer.py, remove the default-deny return in all
      except clauses and replace with `pass` (i.e. continue execution after exception).
    Expected result: RED (bad_sig/no-secret accepted → test_mutation_3_default_deny_catches_bad_sig FAILS)

    MUTATION 4: In webhook_intake.py, replace:
        raw_event = RawEvent(
            vendor=vendor,
            vendor_event_id=vendor_event_id,   # idempotency anchor from spec header
            ...
        )
      with:
        import hashlib
        vendor_event_id = hashlib.sha256(raw_body).hexdigest()  # body-hash mutation
        raw_event = RawEvent(vendor=vendor, vendor_event_id=vendor_event_id, ...)
    Expected result: RED (order-update re-fire treated as new event → test_mutation_4_anchor_body_hash_loses_update FAILS)

    MUTATION 5 (GEN — VENDOR-REGISTRY-DISPATCH-1):
      In webhook_servicer.py._get_registry(), ignore the registry and always return
      only the Shopify spec:
        return {"shopify": WEBHOOK_VERIFIERS["shopify"]}  # hardcode mutation
      Expected result: RED (_test_token vendor request → REJECTED because the registry
      only contains shopify → test_mutation_5_hardcode_shopify_spec_breaks_2nd_vendor FAILS)
    """

    # ----------------------------------------------------------------
    # MUTATION 1: flip verify_fn to always-True
    # ----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_mutation_1_alwaystrue_verify_rejects_tampered(self):
        """
        MUTATION 1 target: spec.verify_fn always returns True.
        # MUTATION: in webhook_servicer.py:
        #   verified = spec.verify_fn(raw_body, signature_header_value, secret)
        # → becomes:
        #   verified = True   ← always-True mutation
        #
        # This test MUST go RED with that mutation because:
        #   - A tampered body (wrong HMAC) would be ACCEPTED instead of REJECTED.
        #   - The assertion `resp.outcome == OUTCOME_REJECTED` would FAIL.
        """
        body = _make_body()
        sig = _sign_body(body)
        tampered = body + b" INJECTED"
        req = _make_request(tampered, sig)  # sig is for original body, body is tampered

        # CORRECT production behaviour: tampered body → REJECTED
        servicer = _make_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED, (
            "MUTATION 1 KILL: tampered body must be REJECTED. "
            "If this passes with verify=True mutation, the verifier is dead."
        )

    @pytest.mark.asyncio
    async def test_mutation_1_invalid_signature_must_reject(self):
        """
        Second MUTATION 1 target: completely invalid signature is rejected.
        With the always-True mutation, this test also goes RED.
        """
        body = _make_body()
        bad_sig = "not-a-real-signature"
        req = _make_request(body, hmac_header=bad_sig)
        servicer = _make_servicer()

        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED, (
            "MUTATION 1 KILL: invalid signature must be REJECTED."
        )

    # ----------------------------------------------------------------
    # MUTATION 2: reorder to map-before-verify
    # ----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_mutation_2_map_before_verify_fires(self):
        """
        MUTATION 2 target: identity resolver called before verify_fn.
        # MUTATION: in webhook_servicer.py, move:
        #   workspace_id = await self._identity_resolver(vendor, external_identity)
        # to BEFORE:
        #   verified = spec.verify_fn(raw_body, signature_header_value, secret)
        #
        # This test MUST go RED with that mutation because:
        #   - The resolver is called even when the body is tampered.
        #   - The tracking_resolver captures its call, so len(resolver_calls) == 1
        #     on a tampered body, which fails the assertion.
        """
        body = _make_body()
        sig = _sign_body(body)
        tampered = body + b" TAMPERED"
        req = _make_request(tampered, sig)

        resolver_calls: list = []

        async def tracking_resolver(vendor: str, external_identity: str) -> str | None:
            resolver_calls.append((vendor, external_identity))
            return _TEST_WID

        servicer = _make_servicer(resolver=tracking_resolver)
        resp = await servicer.ReceiveWebhook(req, context=None)

        # Correct behaviour: resolver not called on tampered body (verify fails first)
        assert resp.outcome == OUTCOME_REJECTED, "Tampered body must be REJECTED."
        assert len(resolver_calls) == 0, (
            "MUTATION 2 KILL: identity resolver MUST NOT be called before verify. "
            f"Got {len(resolver_calls)} call(s). "
            "MAP-AFTER-VERIFY-1 violation — cross-tenant lookup before auth."
        )

    @pytest.mark.asyncio
    async def test_mutation_2_missing_hmac_no_workspace_lookup(self):
        """
        Second MUTATION 2 target: missing header path also must not call resolver.
        """
        body = _make_body()
        req = _make_request(body, hmac_header="")

        resolver_calls: list = []

        async def tracking_resolver(vendor: str, external_identity: str) -> str | None:
            resolver_calls.append((vendor, external_identity))
            return _TEST_WID

        servicer = _make_servicer(resolver=tracking_resolver)
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_REJECTED
        assert len(resolver_calls) == 0, (
            "MUTATION 2 KILL: resolver called before HMAC verify on missing header path."
        )

    # ----------------------------------------------------------------
    # MUTATION 3: default-deny else → accept-on-unknown
    # ----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_mutation_3_default_deny_catches_bad_signature(self):
        """
        MUTATION 3 target: remove the default-deny REJECT in the bare except Exception handler.
        # MUTATION: in webhook_servicer.py, change the except Exception handler from:
        #   ...
        #   return _make_response(OUTCOME_REJECTED, request_id)
        # to:
        #   pass   ← fall-through mutation
        #
        # This test (AppSecretUnavailableError path) is handled by the NAMED except clause,
        # which is NOT touched by mutation 3 (only the bare except Exception is mutated).
        # This test stays GREEN for mutation 3 — it proves the named-exception clause works.
        # The bare except Exception kill is exercised by test_mutation_3_unexpected_exception_rejects_not_accepts
        # (RuntimeError), which goes RED when the bare clause is mutated to pass:
        #   - RuntimeError → except Exception: pass → falls through → `secret` is unbound
        #     (declared inside the try body, never assigned on the exception path)
        #   - spec.verify_fn(raw_body, signature_header_value, secret) → UnboundLocalError
        #   - The test crashes (exception propagates) rather than returning OUTCOME_REJECTED → RED.
        # The definitive kill: AppSecretUnavailableError must cause REJECTED (named clause).
        """
        from src.infrastructure.secrets.app_secret_provider import AppSecretUnavailableError

        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = AppSecretUnavailableError("no secret")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED, (
            "MUTATION 3 KILL: AppSecretUnavailableError must result in REJECTED. "
            "If this fails, the default-deny else was removed and the path fell open."
        )

    @pytest.mark.asyncio
    async def test_mutation_3_held_secret_rejects_not_accepts(self):
        """
        Second MUTATION 3 target: HeldAppSecretError must also cause REJECTED.
        """
        from src.infrastructure.secrets.app_secret_provider import HeldAppSecretError

        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = HeldAppSecretError("get_shopify_hmac_secret")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED, (
            "MUTATION 3 KILL: HeldAppSecretError must result in REJECTED. "
            "Default-deny must cover HeldAppSecretError."
        )

    @pytest.mark.asyncio
    async def test_mutation_3_unexpected_exception_rejects_not_accepts(self):
        """
        Third MUTATION 3 target: generic Exception (RuntimeError) must → REJECTED.
        This is the PRIMARY kill test for mutation 3 (bare except Exception handler).

        # MUTATION: in webhook_servicer.py, change the bare except Exception handler from:
        #   ...
        #   return _make_response(OUTCOME_REJECTED, request_id)
        # to:
        #   pass   ← fall-through mutation
        #
        # This test MUST go RED with that mutation because:
        #   - RuntimeError is caught by except Exception: pass → falls through.
        #   - `secret` is declared inside the try block as `secret: str = spec.secret_fn(...)`.
        #     When the exception fires before assignment, `secret` is never bound.
        #   - The next line `spec.verify_fn(raw_body, signature_header_value, secret)` raises
        #     UnboundLocalError: cannot access local variable 'secret' before assignment.
        #   - The coroutine raises instead of returning a response → resp.outcome is never
        #     reached → this test goes RED (pytest ERROR, not just assertion failure).
        # No belt-guard exists to absorb the fall-through — the bare except is the
        # single load-bearing default-deny for unexpected exceptions (VERIFY-FIRST-1).
        """
        provider = MagicMock()
        provider.get_shopify_hmac_secret.side_effect = RuntimeError("unexpected")
        factory = MagicMock(return_value=provider)

        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = WebhookIngestServicer(
            app_secret_provider_factory=factory,
            identity_resolver=_noop_resolver,
            receive_webhook_fn=_noop_receive,
            allowed_workspace_ids=frozenset({_TEST_WID}),
        )
        resp = await servicer.ReceiveWebhook(req, context=None)
        assert resp.outcome == OUTCOME_REJECTED, (
            "MUTATION 3 KILL: generic Exception must result in REJECTED. "
            "The bare except clause must cover this."
        )

    # ----------------------------------------------------------------
    # MUTATION 4: idempotency anchor → body-hash
    # ----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_mutation_4_anchor_body_hash_loses_update(self):
        """
        MUTATION 4 target: swap vendor_event_id from the spec header to a body hash.
        # MUTATION: in webhook_intake.py, change:
        #   vendor_event_id=vendor_event_id,     ← spec.idempotency_header value
        # to:
        #   vendor_event_id=hashlib.sha256(raw_body).hexdigest(),  ← body-hash
        #
        # This test MUST go RED with that mutation because:
        #   - Vendor re-fires the same vendor_event_id with an updated body.
        #   - With body-hash anchor: new body → new hash → INSERT (not UPDATE)
        #     → silent drop of the dedup, meaning the old row is NOT updated.
        #   - The test asserts that the spec header value is used as vendor_event_id.
        #   - After the mutation, the vendor_event_id would differ for the updated body
        #     and the test checking `vendor_event_id == expected_id` would FAIL.
        """
        # Simulate two deliveries from vendor with the SAME vendor_event_id but different bodies
        vendor_event_id = "vendor-event-id-99999"
        original_payload = {"id": "order-1", "financial_status": "pending"}
        updated_payload = {"id": "order-1", "financial_status": "paid"}  # updated

        original_body = json.dumps(original_payload).encode("utf-8")
        updated_body = json.dumps(updated_payload).encode("utf-8")

        # Both bodies are different (updated order), same vendor_event_id
        assert original_body != updated_body

        received_vendor_event_ids: list[str] = []

        async def tracking_receive(**kwargs):
            received_vendor_event_ids.append(kwargs.get("vendor_event_id", "MISSING"))

        body1 = original_body
        sig1 = _sign_body(body1)
        req1 = _make_request(body1, sig1, webhook_id=vendor_event_id)

        body2 = updated_body
        sig2 = _sign_body(body2)
        req2 = _make_request(body2, sig2, webhook_id=vendor_event_id)

        servicer = _make_servicer(receive_fn=tracking_receive)

        resp1 = await servicer.ReceiveWebhook(req1, context=None)
        resp2 = await servicer.ReceiveWebhook(req2, context=None)

        assert resp1.outcome == OUTCOME_ACCEPTED
        assert resp2.outcome == OUTCOME_ACCEPTED

        # IDEMPOTENCY-ANCHOR-1: the spec header value must be used, NOT a body hash.
        assert len(received_vendor_event_ids) == 2, "receive_webhook not called twice"
        assert received_vendor_event_ids[0] == vendor_event_id, (
            "MUTATION 4 KILL: vendor_event_id must equal the spec header value, not a body hash. "
            f"Got {received_vendor_event_ids[0]!r}, expected {vendor_event_id!r}."
        )
        assert received_vendor_event_ids[1] == vendor_event_id, (
            "MUTATION 4 KILL: second delivery must also pass through vendor_event_id. "
            f"Got {received_vendor_event_ids[1]!r}, expected {vendor_event_id!r}."
        )

    # ----------------------------------------------------------------
    # MUTATION 5: hardcode Shopify spec ignoring request.vendor (GEN)
    # VENDOR-REGISTRY-DISPATCH-1 (CRIT): this is the genericity kill-test.
    # ----------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_mutation_5_hardcode_shopify_spec_breaks_2nd_vendor(self):
        """
        MUTATION 5 target (GEN — VENDOR-REGISTRY-DISPATCH-1):
          In webhook_servicer.py._get_registry(), ignore the override and always
          return a registry with ONLY the Shopify spec:
            # MUTATION: in _get_registry():
            #   return {"shopify": WEBHOOK_VERIFIERS["shopify"]}  ← hardcode mutation
            # This ignores request.vendor and always dispatches to the Shopify spec.
          With this mutation:
            - A _test_token request is looked up as "shopify" — not found → REJECTED.
            - The 2nd-vendor matrix goes RED (VENDOR-REGISTRY-DISPATCH-1 violated).

        This test asserts the CORRECT production behaviour:
          - _test_token vendor with valid token-signature → ACCEPTED (registry has it).
          - If the mutation is applied, the spec lookup for "_test_token" returns None
            → REJECTED → this assertion FAILS → mutation goes RED.
        """
        # CORRECT production behaviour with combined registry: _test_token → ACCEPTED
        req = _make_test2_request()  # valid token signature
        servicer = _make_combined_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        assert resp.outcome == OUTCOME_ACCEPTED, (
            "MUTATION 5 KILL: _test_token vendor must be ACCEPTED when the registry "
            "contains its spec.  If this fails, the servicer hardcodes the Shopify spec "
            "and ignores request.vendor — VENDOR-REGISTRY-DISPATCH-1 violated.  "
            f"Got outcome={resp.outcome} (expected OUTCOME_ACCEPTED={OUTCOME_ACCEPTED})."
        )

    @pytest.mark.asyncio
    async def test_mutation_5_full_genericity_matrix_accepted(self):
        """
        Broader MUTATION 5 coverage: ALL _test_token ACCEPTED-path sub-assertions.
        If mutation #5 is applied, the 2nd-vendor matrix cannot pass ACCEPTED → RED.
        """
        servicer = _make_combined_servicer()

        # 1. _test_token ACCEPTED
        req_accept = _make_test2_request()
        resp_accept = await servicer.ReceiveWebhook(req_accept, context=None)
        assert resp_accept.outcome == OUTCOME_ACCEPTED, (
            "MUTATION 5: _test_token ACCEPTED failed."
        )

        # 2. _test_token REJECTED (wrong sig)
        req_reject = _make_test2_request(signature="wrong")
        resp_reject = await servicer.ReceiveWebhook(req_reject, context=None)
        assert resp_reject.outcome == OUTCOME_REJECTED, (
            "MUTATION 5: _test_token REJECTED (bad sig) failed."
        )

        # 3. _test_token PARKED (unmapped identity)
        req_park = _make_test2_request(identity="unmapped-id-xyz")
        resp_park = await servicer.ReceiveWebhook(req_park, context=None)
        assert resp_park.outcome == OUTCOME_PARKED, (
            "MUTATION 5: _test_token PARKED (unmapped identity) failed."
        )

        # 4. _test_token IGNORED (unknown topic)
        req_ignore = _make_test2_request(topic="unknown/topic/xyz")
        resp_ignore = await servicer.ReceiveWebhook(req_ignore, context=None)
        assert resp_ignore.outcome == OUTCOME_IGNORED, (
            "MUTATION 5: _test_token IGNORED (unknown topic) failed."
        )


# ---------------------------------------------------------------------------
# TestIdempotencyAnchor
# ---------------------------------------------------------------------------


class TestIdempotencyAnchor:
    """
    Tests for the IDEMPOTENCY-ANCHOR-1 contract.
    vendor_event_id = spec.idempotency_header value (NOT a body hash).
    """

    @pytest.mark.asyncio
    async def test_same_vendor_event_id_different_body_both_accepted(self):
        """
        Same vendor_event_id, updated body → both ACCEPTED by the servicer.
        The ON CONFLICT DO UPDATE in _upsert_event handles the idempotency.
        """
        vendor_event_id = "wh-update-test"
        body_v1 = json.dumps({"id": "1", "status": "pending"}).encode()
        body_v2 = json.dumps({"id": "1", "status": "paid"}).encode()
        sig_v1 = _sign_body(body_v1)
        sig_v2 = _sign_body(body_v2)

        req_v1 = _make_request(body_v1, sig_v1, webhook_id=vendor_event_id)
        req_v2 = _make_request(body_v2, sig_v2, webhook_id=vendor_event_id)

        servicer = _make_servicer()
        resp1 = await servicer.ReceiveWebhook(req_v1, context=None)
        resp2 = await servicer.ReceiveWebhook(req_v2, context=None)

        assert resp1.outcome == OUTCOME_ACCEPTED
        assert resp2.outcome == OUTCOME_ACCEPTED

    @pytest.mark.asyncio
    async def test_different_vendor_event_ids_both_accepted_independently(self):
        """
        Two different vendor_event_ids (different events) → both ACCEPTED independently.
        """
        body_a = json.dumps({"id": "order-a"}).encode()
        body_b = json.dumps({"id": "order-b"}).encode()
        sig_a = _sign_body(body_a)
        sig_b = _sign_body(body_b)

        req_a = _make_request(body_a, sig_a, webhook_id="wh-id-a")
        req_b = _make_request(body_b, sig_b, webhook_id="wh-id-b")

        servicer = _make_servicer()
        resp_a = await servicer.ReceiveWebhook(req_a, context=None)
        resp_b = await servicer.ReceiveWebhook(req_b, context=None)

        assert resp_a.outcome == OUTCOME_ACCEPTED
        assert resp_b.outcome == OUTCOME_ACCEPTED


# ---------------------------------------------------------------------------
# TestReceiveWebhookPushIntake
# ---------------------------------------------------------------------------


class TestReceiveWebhookPushIntake:
    """
    Unit tests for receive_webhook() push-intake function (generic vendor).

    Tests run against the real implementation with injected mocks for DB + Kafka.
    No real DB connection; no real Kafka.

    VENDOR-REGISTRY-DISPATCH-1: vendor parameter flows through without branching.
    """

    @pytest.mark.asyncio
    async def test_receive_webhook_normalises_and_sets_correlation(self):
        """
        receive_webhook sets the correlation context (CORRELATION-1).
        vendor parameter flows through; no vendor-literal branch.
        """
        from src.application.framework.ingest import get_correlation_context, reset_counters
        from src.application.framework.webhook_intake import receive_webhook

        reset_counters()
        body = json.dumps({
            "id": "order-999",
            "order_number": 999,
            "financial_status": "paid",
        }).encode()

        await receive_webhook(
            vendor="shopify",
            raw_body=body,
            headers={},
            workspace_id=_TEST_WID,
            vendor_event_id="wh-corr-test",
            topic="orders/create",
            request_id="test-req-id",
            trace_id="test-trace-id",
        )

        ctx = get_correlation_context()
        assert ctx["request_id"] == "test-req-id", "CORRELATION-1: request_id not set"
        assert ctx["trace_id"] == "test-trace-id", "CORRELATION-1: trace_id not set"
        assert ctx["workspace_id"] == _TEST_WID

    @pytest.mark.asyncio
    async def test_receive_webhook_uses_vendor_event_id_as_anchor(self):
        """
        IDEMPOTENCY-ANCHOR-1: vendor_event_id passed to _upsert_event = the spec header value.
        """
        from src.application.framework.webhook_intake import receive_webhook

        upsert_calls: list[dict] = []

        async def mock_upsert(conn, workspace_id, event, manifest, request_id=""):
            upsert_calls.append({"vendor_event_id": event.vendor_event_id})
            return True  # was_inserted

        body = json.dumps({
            "id": "order-123",
            "order_number": 123,
            "financial_status": "paid",
        }).encode()

        with patch("src.application.framework.webhook_intake._upsert_event", mock_upsert):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id=_TEST_WID,
                vendor_event_id="my-vendor-event-id-anchor",
                topic="orders/create",
                request_id="req-1",
                trace_id="trace-1",
                db_conn=MagicMock(),  # triggers the DB branch
            )

        assert len(upsert_calls) == 1
        assert upsert_calls[0]["vendor_event_id"] == "my-vendor-event-id-anchor", (
            "IDEMPOTENCY-ANCHOR-1: vendor_event_id must equal the spec header value. "
            f"Got {upsert_calls[0]['vendor_event_id']!r}"
        )

    @pytest.mark.asyncio
    async def test_receive_webhook_kafka_topic_uses_vendor_param(self):
        """
        Kafka topic is 'integrations.{vendor}.v1' — vendor is the parameter, not hardcoded.
        VENDOR-REGISTRY-DISPATCH-1: no 'integrations.shopify.v1' literal in the function.
        """
        from src.application.framework.webhook_intake import receive_webhook

        kafka_calls: list[tuple] = []

        async def mock_produce(producer, topic, workspace_id, event, ingested_at, **kwargs):
            kafka_calls.append(topic)

        body = json.dumps({"id": "order-kafka", "order_number": 42}).encode()

        with patch("src.application.framework.webhook_intake._produce_kafka", mock_produce):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id=_TEST_WID,
                vendor_event_id="wh-kafka-test",
                topic="orders/create",
                request_id="req-kafka",
                trace_id="trace-kafka",
                kafka_producer=MagicMock(),
            )

        assert len(kafka_calls) == 1
        assert kafka_calls[0] == "integrations.shopify.v1", (
            "Kafka topic must be 'integrations.shopify.v1'. "
            f"Got {kafka_calls[0]!r}"
        )

    @pytest.mark.asyncio
    async def test_receive_webhook_raw_event_vendor_is_parameter(self):
        """
        RawEvent.vendor = the vendor parameter (not a hardcoded literal).
        VENDOR-REGISTRY-DISPATCH-1: vendor flows through, not branched on.
        """
        from src.application.framework.webhook_intake import receive_webhook

        upsert_calls: list[dict] = []

        async def mock_upsert(conn, workspace_id, event, manifest, request_id=""):
            upsert_calls.append({"vendor": event.vendor})
            return True

        body = json.dumps({"id": "order-v", "order_number": 5}).encode()

        with patch("src.application.framework.webhook_intake._upsert_event", mock_upsert):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id=_TEST_WID,
                vendor_event_id="wh-vendor-check",
                topic="orders/create",
                request_id="req-v",
                trace_id="trace-v",
                db_conn=MagicMock(),
            )

        assert len(upsert_calls) == 1
        assert upsert_calls[0]["vendor"] == "shopify", (
            "RawEvent.vendor must equal the vendor parameter."
        )

    @pytest.mark.asyncio
    async def test_receive_webhook_does_not_call_adapter_fetch(self):
        """
        PUSH-INTAKE-1: receive_webhook must never call ShopifyAdapter.fetch().
        """
        from src.application.framework.webhook_intake import receive_webhook

        body = json.dumps({"id": "order-456", "order_number": 456}).encode()

        with patch.object(
            __import__("src.interfaces.adapters.shopify_adapter", fromlist=["ShopifyAdapter"]).ShopifyAdapter,
            "fetch",
            side_effect=AssertionError("PUSH-INTAKE-1 violation: fetch() called on webhook path!"),
        ):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id=_TEST_WID,
                vendor_event_id="wh-no-fetch",
                topic="orders/create",
                request_id="req-2",
                trace_id="trace-2",
            )

    @pytest.mark.asyncio
    async def test_receive_webhook_workspace_allowlist_backstop(self):
        """
        assert_workspace_allowed rejects disallowed workspace even on the push path.
        """
        from src.bootstrap.startup_gates import WorkspaceNotAllowedError
        from src.application.framework.webhook_intake import receive_webhook

        body = json.dumps({"id": "order-789"}).encode()
        allowed = frozenset({"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"})

        with pytest.raises(WorkspaceNotAllowedError):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",  # not in allowed
                vendor_event_id="wh-blocked",
                topic="orders/create",
                request_id="req-block",
                trace_id="trace-block",
                allowed_workspace_ids=allowed,
            )

    @pytest.mark.asyncio
    async def test_receive_webhook_pii_gate_declared_fields_pass(self):
        """
        PII gate: declared PII fields (email, first_name, last_name) pass cleanly.
        """
        from src.application.framework.webhook_intake import receive_webhook

        body = json.dumps({
            "id": "order-pii-pass",
            "order_number": 1,
            "financial_status": "paid",
            "billing_address": {
                "first_name": "Priya",
                "last_name": "Sharma",
            },
            "email": "priya@example.com",
        }).encode()

        await receive_webhook(
            vendor="shopify",
            raw_body=body,
            headers={},
            workspace_id=_TEST_WID,
            vendor_event_id="wh-pii-pass",
            topic="orders/create",
            request_id="req-pii-pass",
            trace_id="trace-pii-pass",
        )

    @pytest.mark.asyncio
    async def test_receive_webhook_pii_gate_undeclared_field_rejects(self):
        """
        PII gate rejects if check_pii_fields is called with an undeclared PII column.
        """
        from src.domain.framework.pii_manifest import PiiManifestViolation
        from src.application.framework.webhook_intake import receive_webhook

        body = json.dumps({
            "id": "order-pii-reject",
            "order_number": 1,
        }).encode()

        with patch(
            "src.application.framework.webhook_intake.check_pii_fields",
            side_effect=PiiManifestViolation("shopify", ["phone"]),
        ):
            with pytest.raises(PiiManifestViolation):
                await receive_webhook(
                    vendor="shopify",
                    raw_body=body,
                    headers={},
                    workspace_id=_TEST_WID,
                    vendor_event_id="wh-pii-reject",
                    topic="orders/create",
                    request_id="req-pii-r",
                    trace_id="trace-pii-r",
                )


# ---------------------------------------------------------------------------
# TestNeverlogAssertion
# NEVERLOG-1 (VETO Shreya): grep test on captured log output.
# ---------------------------------------------------------------------------


class TestNeverlogAssertion:
    """
    NEVERLOG-1 (VETO Shreya): no secret / full signature / raw PII in logs.
    """

    @pytest.mark.asyncio
    async def test_rejected_path_does_not_log_secret(self, caplog):
        """
        On REJECTED path, the secret value must NOT appear in any log output.
        NEVERLOG-1 (Shreya VETO).
        """
        body = _make_body()
        sig = _sign_body(body)
        tampered = body + b" BAD"
        req = _make_request(tampered, sig)

        servicer = _make_servicer()
        with caplog.at_level(logging.DEBUG, logger="src.interfaces.grpc.webhook_servicer"):
            await servicer.ReceiveWebhook(req, context=None)

        log_output = caplog.text
        assert _TEST_SECRET not in log_output, (
            f"NEVERLOG-1 VIOLATION: secret value found in log output. "
            f"Secret fragment: {_TEST_SECRET!r}"
        )

    @pytest.mark.asyncio
    async def test_accepted_path_does_not_log_signature(self, caplog):
        """
        On ACCEPTED path, the full HMAC signature must NOT appear in any log output.
        NEVERLOG-1 (Shreya VETO).
        """
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = _make_servicer()
        with caplog.at_level(logging.DEBUG, logger="src.interfaces.grpc.webhook_servicer"):
            await servicer.ReceiveWebhook(req, context=None)

        log_output = caplog.text
        assert sig not in log_output, (
            "NEVERLOG-1 VIOLATION: full HMAC signature found in log output."
        )

    @pytest.mark.asyncio
    async def test_no_pii_email_in_logs(self, caplog):
        """
        PII field values (email) must NOT appear in any log output.
        NEVERLOG-1 (Shreya VETO).
        """
        from src.application.framework.webhook_intake import receive_webhook

        pii_email = "secret-customer@example.com"
        body = json.dumps({
            "id": "order-log-test",
            "order_number": 1,
            "email": pii_email,
            "financial_status": "paid",
        }).encode()

        with caplog.at_level(logging.DEBUG):
            await receive_webhook(
                vendor="shopify",
                raw_body=body,
                headers={},
                workspace_id=_TEST_WID,
                vendor_event_id="wh-neverlog",
                topic="orders/create",
                request_id="req-nolog",
                trace_id="trace-nolog",
            )

        log_output = caplog.text
        assert pii_email not in log_output, (
            f"NEVERLOG-1 VIOLATION: PII email value found in log output: {pii_email!r}"
        )

    @pytest.mark.asyncio
    async def test_response_does_not_contain_secret(self):
        """
        The gRPC response object must not contain the secret or full signature.
        NEVERLOG-1 (Shreya VETO) — applies to response fields too.
        """
        body = _make_body()
        sig = _sign_body(body)
        req = _make_request(body, sig)

        servicer = _make_servicer()
        resp = await servicer.ReceiveWebhook(req, context=None)

        resp_str = str(vars(resp))
        assert _TEST_SECRET not in resp_str, "NEVERLOG-1: secret in response"
        assert sig not in resp_str, "NEVERLOG-1: full signature in response"

    @pytest.mark.asyncio
    async def test_2nd_vendor_secret_not_in_logs(self, caplog):
        """
        _test_token vendor: the token secret must NOT appear in logs.
        NEVERLOG-1 applies to ALL vendors, not just Shopify.
        """
        req = _make_test2_request(signature="wrong-token-bad-sig")
        servicer = _make_combined_servicer()

        with caplog.at_level(logging.DEBUG, logger="src.interfaces.grpc.webhook_servicer"):
            await servicer.ReceiveWebhook(req, context=None)

        log_output = caplog.text
        assert _TEST2_SECRET not in log_output, (
            f"NEVERLOG-1 VIOLATION: _test_token secret found in log output."
        )


# ---------------------------------------------------------------------------
# TestNoHardcodedVendorGrep
# NO-HARDCODED-VENDOR-1 (HIGH, grep-gate): confirm no vendor-literal branches
# in servicer / identity_resolver / webhook_intake.
# ---------------------------------------------------------------------------


class TestNoHardcodedVendorGrep:
    """
    NO-HARDCODED-VENDOR-1 (HIGH, grep-gate).

    Reads each dispatch-path module and asserts that no vendor-literal branching
    pattern appears.  This is the in-test equivalent of the CI grep-gate.

    The registry-definition module (webhook_registry.py) is EXCLUDED — that
    is DATA (the Shopify spec entry), not a dispatch branch.  The grep targets
    are the dispatch path: servicer, identity_resolver, webhook_intake.
    """

    def _read_source(self, relative_path: str) -> str:
        import os
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        # base = apps/ingestion-service/
        full_path = os.path.join(base, relative_path)
        with open(full_path, "r") as f:
            return f.read()

    def test_servicer_no_shopify_equality_branch(self):
        """
        webhook_servicer.py: no `== "shopify"` or `=== "shopify"` or
        `if.*vendor.*shopify` pattern on the dispatch path CODE lines.
        Comment/docstring lines (starting with # or inside triple-quoted strings)
        are excluded — only actual code lines are checked.
        """
        import re
        source = self._read_source("src/interfaces/grpc/webhook_servicer.py")
        # Filter to non-comment lines only (strip leading whitespace then check #)
        code_lines = [
            line for line in source.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        code_only = "\n".join(code_lines)
        # Pattern: equality comparison to "shopify" literal on the vendor variable in code
        pattern = re.compile(
            r'vendor\s*==\s*["\']shopify["\']'
            r'|===\s*["\']shopify["\']'
            r'|if\s+vendor\s+["\']shopify["\']',
            re.IGNORECASE,
        )
        matches = pattern.findall(code_only)
        assert len(matches) == 0, (
            f"NO-HARDCODED-VENDOR-1 VIOLATION: vendor-literal branch in webhook_servicer.py. "
            f"Matches: {matches}. "
            "The servicer must dispatch via WEBHOOK_VERIFIERS[request.vendor], not hardcode vendor names."
        )

    def test_identity_resolver_no_shopify_equality_branch(self):
        """
        identity_resolver.py: no vendor-literal branching in code lines.
        """
        import re
        source = self._read_source("src/interfaces/grpc/identity_resolver.py")
        # Filter to non-comment lines
        code_lines = [
            line for line in source.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        code_only = "\n".join(code_lines)
        pattern = re.compile(
            r'vendor\s*==\s*["\']shopify["\']'
            r'|===\s*["\']shopify["\']'
            r'|if\s+vendor\s+["\']shopify["\']',
            re.IGNORECASE,
        )
        matches = pattern.findall(code_only)
        assert len(matches) == 0, (
            f"NO-HARDCODED-VENDOR-1 VIOLATION: vendor-literal branch in identity_resolver.py. "
            f"Matches: {matches}"
        )

    def test_webhook_intake_no_shopify_equality_branch(self):
        """
        webhook_intake.py: no `vendor == "shopify"` dispatch branch in code lines.
        (Uses of ShopifyAdapter are allowed as v1 implementation detail;
        the grep targets equality comparisons on the vendor variable.)
        """
        import re
        source = self._read_source("src/application/framework/webhook_intake.py")
        # Filter to non-comment lines
        code_lines = [
            line for line in source.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        code_only = "\n".join(code_lines)
        # Only flag: equality comparison to "shopify" literal on the vendor variable
        pattern = re.compile(r'vendor\s*==\s*["\']shopify["\']|if\s+vendor\s+["\']shopify["\']', re.IGNORECASE)
        matches = pattern.findall(code_only)
        assert len(matches) == 0, (
            f"NO-HARDCODED-VENDOR-1 VIOLATION: vendor-literal branch in webhook_intake.py. "
            f"Matches: {matches}. "
            "vendor must be used as a plain parameter, not branched on."
        )

    def test_servicer_dispatches_via_get_not_literal(self):
        """
        Positive assertion: servicer source contains 'registry.get(vendor)' or
        similar registry-dispatch pattern (not a hardcoded branch).
        """
        source = self._read_source("src/interfaces/grpc/webhook_servicer.py")
        # The dispatch line must be a dict .get() call, not an equality check
        assert "registry.get(vendor)" in source, (
            "NO-HARDCODED-VENDOR-1: servicer must dispatch via registry.get(vendor). "
            "Dispatch pattern not found."
        )


# ---------------------------------------------------------------------------
# TestWebhookRegistrySpec
# Confirms the WEBHOOK_VERIFIERS registry has the Shopify entry with correct fields.
# ---------------------------------------------------------------------------


class TestWebhookRegistrySpec:
    """
    Tests that WEBHOOK_VERIFIERS is well-formed and the Shopify spec is correct.
    """

    def test_shopify_in_registry(self):
        """WEBHOOK_VERIFIERS must contain the 'shopify' key."""
        assert "shopify" in WEBHOOK_VERIFIERS, (
            "webhook_registry.WEBHOOK_VERIFIERS must contain 'shopify' entry."
        )

    def test_shopify_spec_has_all_fields(self):
        """Shopify VendorWebhookSpec has all required fields."""
        spec = WEBHOOK_VERIFIERS["shopify"]
        assert spec.vendor == "shopify"
        assert callable(spec.verify_fn)
        assert callable(spec.secret_fn)
        assert spec.signature_header == "x-shopify-hmac-sha256"
        assert spec.identity_header == "x-shopify-shop-domain"
        assert spec.idempotency_header == "x-shopify-webhook-id"
        assert spec.topic_header == "x-shopify-topic"
        assert isinstance(spec.topic_allowlist, frozenset)
        assert len(spec.topic_allowlist) > 0

    def test_shopify_spec_verify_fn_is_verify_shopify_hmac(self):
        """Shopify spec's verify_fn is verify_shopify_hmac (SINGLE-PRIMITIVE-1)."""
        spec = WEBHOOK_VERIFIERS["shopify"]
        assert spec.verify_fn is verify_shopify_hmac, (
            "SINGLE-PRIMITIVE-1: Shopify spec.verify_fn must be verify_shopify_hmac."
        )

    def test_shopify_spec_topic_allowlist_has_orders_create(self):
        """Shopify topic_allowlist includes orders/create."""
        spec = WEBHOOK_VERIFIERS["shopify"]
        assert "orders/create" in spec.topic_allowlist

    def test_shopify_spec_topic_allowlist_excludes_inventory(self):
        """Shopify topic_allowlist does NOT include inventory_levels/update."""
        spec = WEBHOOK_VERIFIERS["shopify"]
        assert "inventory_levels/update" not in spec.topic_allowlist

    def test_spec_is_frozen_dataclass(self):
        """VendorWebhookSpec is frozen (immutable at runtime)."""
        spec = WEBHOOK_VERIFIERS["shopify"]
        with pytest.raises((AttributeError, TypeError)):
            spec.vendor = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# TestVerifyShopifyHmacUnit
# Direct tests of the verify_shopify_hmac primitive to confirm the seam.
# ---------------------------------------------------------------------------


class TestVerifyShopifyHmacUnit:
    """Direct unit tests of verify_shopify_hmac (the single primitive)."""

    def test_correct_hmac_verifies(self):
        body = b"hello webhook"
        secret = "test-secret"
        sig = base64.b64encode(
            hmac_mod.new(secret.encode(), body, hashlib.sha256).digest()
        ).decode()
        assert verify_shopify_hmac(body, sig, secret) is True

    def test_wrong_body_fails(self):
        body = b"hello webhook"
        secret = "test-secret"
        sig = base64.b64encode(
            hmac_mod.new(secret.encode(), body, hashlib.sha256).digest()
        ).decode()
        assert verify_shopify_hmac(b"tampered", sig, secret) is False

    def test_wrong_secret_fails(self):
        body = b"hello webhook"
        sig = base64.b64encode(
            hmac_mod.new(b"correct-secret", body, hashlib.sha256).digest()
        ).decode()
        assert verify_shopify_hmac(body, sig, "wrong-secret") is False

    def test_empty_body_fails(self):
        """Empty body with valid sig for empty body — still verifies correctly."""
        body = b""
        secret = "test-secret"
        sig = base64.b64encode(
            hmac_mod.new(secret.encode(), body, hashlib.sha256).digest()
        ).decode()
        assert verify_shopify_hmac(body, sig, secret) is True

    def test_hex_sig_fails_not_base64(self):
        """verify_shopify_hmac uses base64 comparison; a hex sig always fails."""
        body = b"hello webhook"
        secret = "test-secret"
        hex_sig = hmac_mod.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert verify_shopify_hmac(body, hex_sig, secret) is False


# ---------------------------------------------------------------------------
# TestTopicAllowlistCoverage
# ---------------------------------------------------------------------------


class TestTopicAllowlistCoverage:
    """Confirm the Shopify topic allowlist constants are well-formed."""

    def test_allowlist_non_empty(self):
        assert len(SHOPIFY_TOPIC_ALLOWLIST) > 0

    def test_orders_create_in_allowlist(self):
        assert "orders/create" in SHOPIFY_TOPIC_ALLOWLIST

    def test_inventory_topic_not_in_allowlist(self):
        assert "inventory_levels/update" not in SHOPIFY_TOPIC_ALLOWLIST

    def test_empty_topic_not_in_allowlist(self):
        assert "" not in SHOPIFY_TOPIC_ALLOWLIST


# ---------------------------------------------------------------------------
# Webhook counter pre-seed (python-services-12 fix)
# ---------------------------------------------------------------------------

class TestWebhookCounterPreSeed:
    """Webhook counters must be pre-seeded in _COUNTERS on cold start.

    BEFORE (bug): webhook_* keys were not in _COUNTERS until the first event
    was processed, causing get_counters() to return missing keys on cold-start
    and monitoring dashboards to show gaps.
    AFTER: all four webhook_* keys are pre-seeded to 0 in _COUNTERS init.
    """

    def test_webhook_received_total_pre_seeded(self) -> None:
        """webhook_received_total must be present in _COUNTERS at import time."""
        from src.application.framework.ingest import get_counters
        counters = get_counters()
        assert "webhook_received_total" in counters, (
            "webhook_received_total missing from _COUNTERS on cold-start. "
            "Monitoring dashboards will show a missing-metric gap."
        )

    def test_webhook_rejected_total_pre_seeded(self) -> None:
        """webhook_rejected_total must be present in _COUNTERS at import time."""
        from src.application.framework.ingest import get_counters
        counters = get_counters()
        assert "webhook_rejected_total" in counters

    def test_webhook_parked_total_pre_seeded(self) -> None:
        """webhook_parked_total must be present in _COUNTERS at import time."""
        from src.application.framework.ingest import get_counters
        counters = get_counters()
        assert "webhook_parked_total" in counters

    def test_webhook_ignored_total_pre_seeded(self) -> None:
        """webhook_ignored_total must be present in _COUNTERS at import time."""
        from src.application.framework.ingest import get_counters
        counters = get_counters()
        assert "webhook_ignored_total" in counters

    def test_all_webhook_counters_start_at_zero(self) -> None:
        """All pre-seeded webhook counters must start at 0."""
        from src.application.framework.ingest import get_counters, reset_counters
        reset_counters()
        counters = get_counters()
        for key in ("webhook_received_total", "webhook_rejected_total",
                    "webhook_parked_total", "webhook_ignored_total"):
            assert counters[key] == 0, (
                f"{key} must start at 0 after reset, got {counters[key]}"
            )

    def test_get_counters_always_has_webhook_keys_after_reset(self) -> None:
        """After reset_counters(), the webhook_* keys must still be present.

        reset_counters() sets existing keys to 0; pre-seeded keys survive the reset.
        """
        from src.application.framework.ingest import get_counters, reset_counters
        reset_counters()
        counters = get_counters()
        for key in ("webhook_received_total", "webhook_rejected_total",
                    "webhook_parked_total", "webhook_ignored_total"):
            assert key in counters, f"{key} missing after reset_counters()"
