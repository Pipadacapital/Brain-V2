"""
Vendor-agnostic webhook-verifier registry.

@paradigm: sql + io/event-handling (no ML, no LLM, ₹0)

Paradigm justified: the registry is a static dict of immutable dataclasses.
Dispatching to a spec is a constant-time dict lookup; no probabilistic surface.
The per-vendor verify_fn callables (e.g. verify_shopify_hmac) are the single
cryptographic primitives — the registry only selects them.

CF contract:
  VENDOR-REGISTRY-DISPATCH-1 (CRIT)  — every per-vendor fact (verify fn, secret fn,
    signature/identity/idempotency/topic headers, allowlist) lives in this registry.
    The servicer calls WEBHOOK_VERIFIERS.get(request.vendor) — NEVER a hardcoded
    vendor branch.  Unknown/empty vendor → REJECT (default-deny in the servicer).
  NO-HARDCODED-VENDOR-1 (HIGH)       — no `== "shopify"` or `if vendor … shopify`
    anywhere outside this registry-definition module.  The registering of the Shopify
    spec here is DATA (the allowed value), not a dispatch branch.
  SINGLE-PRIMITIVE-1 (HIGH)          — each vendor's verify_fn is its single primitive.
    The registry shape is the forward-looking surface required by the Founder directive
    ("100+ sources"); no speculative per-vendor logic is added here.

Adding vendor #2 (e.g. Meta, Stripe):
  1. Write a verify_fn(raw_body: bytes, signature: str, secret: str) -> bool.
  2. Add a VendorWebhookSpec entry to WEBHOOK_VERIFIERS with the new vendor key.
  3. Seed connector_identity_map with the vendor's external_identity rows.
  Zero servicer / route / proto changes required.

Verify_fn signature convention:
  (raw_body: bytes, signature: str, secret: str) -> bool
  Vendors whose scheme needs extra headers (e.g. Stripe timestamp) may read them
  from raw_body closure or a wrapper — v1 needs only Shopify's base64-HMAC-SHA256.
  The shape is intentionally minimal; do NOT pre-build Meta/Stripe specs here
  (Single-Primitive / no speculative abstraction).

NEVERLOG-1 (VETO Shreya): secret_fn returns the live secret at call-time.
  The registry NEVER stores the secret value — it stores a callable that fetches it
  from the secret provider.  The provider is NEVERLOG-safe (fail-closed, no value in
  exception messages per app_secret_provider.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

# ---------------------------------------------------------------------------
# Shopify topic allowlist (TOPIC-ALLOWLIST-1, Shopify entry only)
# Relocated here from webhook_servicer.py — it is a per-vendor configuration
# fact, not a global constant.  The servicer reads it from the spec.
# ---------------------------------------------------------------------------

SHOPIFY_TOPIC_ALLOWLIST: frozenset[str] = frozenset({
    "orders/create",
    "orders/updated",
    "orders/paid",
    "orders/fulfilled",
    "orders/cancelled",
    "customers/create",
    "customers/update",
    "products/create",
    "products/update",
})


# ---------------------------------------------------------------------------
# VendorWebhookSpec — per-vendor configuration dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VendorWebhookSpec:
    """
    Immutable per-vendor webhook configuration.

    @paradigm: sql — pure data, no IO or inference.

    Fields:
      vendor:             The registry key (e.g. "shopify").  Redundant when
                          accessed via WEBHOOK_VERIFIERS[vendor], but included
                          for self-documenting spec objects passed around in tests.
      verify_fn:          (raw_body, signature, secret) -> bool.
                          The single cryptographic primitive for this vendor.
                          SINGLE-PRIMITIVE-1: exactly one per vendor; no second verifier.
      secret_fn:          (AppSecretProvider) -> str — fetches the live secret.
                          NEVERLOG-1: the returned string is the live secret; never log.
      signature_header:   Header carrying the signature to verify.
                          Lowercase (HTTP/2 canonical).
      identity_header:    Header carrying the external identity (trusted POST-verify only).
                          MAP-AFTER-VERIFY-1: only read AFTER verify_fn returns True.
      idempotency_header: Header whose value becomes vendor_event_id (the idempotency anchor).
                          IDEMPOTENCY-ANCHOR-1: NOT a body hash.
      topic_header:       Header carrying the event topic/type.
      topic_allowlist:    Frozen set of accepted topic values.
                          TOPIC-ALLOWLIST-1: unknown → IGNORED (200, no write).
    """
    vendor: str
    verify_fn: Callable[[bytes, str, str], bool]
    secret_fn: Callable  # (AppSecretProvider) -> str  (NEVERLOG-1: never log return value)
    signature_header: str
    identity_header: str
    idempotency_header: str
    topic_header: str
    topic_allowlist: frozenset


# ---------------------------------------------------------------------------
# WEBHOOK_VERIFIERS — the registry
# ---------------------------------------------------------------------------

def _build_registry() -> "dict[str, VendorWebhookSpec]":
    """
    Build the vendor registry dict.

    @paradigm: sql — static dict construction, no IO or LLM.

    Separated into a function so the imports (e.g. verify_shopify_hmac) are
    deferred until first call, making tests that mock the adapters cleaner.
    The result is frozen into the module-level WEBHOOK_VERIFIERS at import time.

    Shopify is the FIRST registered vendor (not the shape):
      verify_fn = verify_shopify_hmac (base64-HMAC-SHA256 over raw body, untouched)
      secret_fn = lambda p: p.get_shopify_hmac_secret()
      signature_header = "x-shopify-hmac-sha256"
      identity_header  = "x-shopify-shop-domain"
      idempotency_header = "x-shopify-webhook-id"
      topic_header     = "x-shopify-topic"
      topic_allowlist  = SHOPIFY_TOPIC_ALLOWLIST

    NO "shopify" string literal appears outside this registry-definition module
    on any dispatch path (NO-HARDCODED-VENDOR-1).
    """
    from src.interfaces.adapters.shopify_adapter import verify_shopify_hmac

    shopify_spec = VendorWebhookSpec(
        vendor="shopify",
        # SINGLE-PRIMITIVE-1: verify_shopify_hmac is the ONE inbound base64/raw-body
        # verifier.  The gateway's validateShopifyHmac (hex/sorted-query OAuth callback)
        # is a DIFFERENT algorithm and purpose — NOT reused here.
        verify_fn=verify_shopify_hmac,
        # secret_fn: callable provider → secret string (NEVERLOG-1: never log the result).
        # The lambda defers the secret lookup until call-time; it does NOT cache the value.
        secret_fn=lambda p: p.get_shopify_hmac_secret(),
        signature_header="x-shopify-hmac-sha256",
        # identity_header: trusted POST-verify only (MAP-AFTER-VERIFY-1).
        identity_header="x-shopify-shop-domain",
        # idempotency_header: IDEMPOTENCY-ANCHOR-1 — NOT a body hash.
        idempotency_header="x-shopify-webhook-id",
        topic_header="x-shopify-topic",
        topic_allowlist=SHOPIFY_TOPIC_ALLOWLIST,
    )

    return {
        "shopify": shopify_spec,
        # Vendor #2 example (DO NOT add until the feature is scoped):
        # "meta": VendorWebhookSpec(
        #     vendor="meta",
        #     verify_fn=verify_meta_hmac,  # X-Hub-Signature-256 hex HMAC-SHA256
        #     secret_fn=lambda p: p.get_meta_hmac_secret(),
        #     signature_header="x-hub-signature-256",
        #     identity_header="x-meta-page-id",
        #     idempotency_header="x-hub-delivery",
        #     topic_header="x-meta-topic",
        #     topic_allowlist=META_TOPIC_ALLOWLIST,
        # ),
    }


# Module-level registry dict (immutable at runtime; tests inject via override).
WEBHOOK_VERIFIERS: dict[str, VendorWebhookSpec] = _build_registry()
