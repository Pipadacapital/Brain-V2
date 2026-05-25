"""
Shopify connector adapter — the first Brain-native connector.

@paradigm: sql + OAuth/connection (no ML, no LLM)

Shopify is the lowest-risk first connector:
  - Full 60-day order-API backfill (ReplayCapability.FULL_60D)
  - Token model: OAuth access token per shop (shop-domain routing)
  - PII manifest: email, first_name, last_name (owner_brand_controller / analytics_performance)
  - Cutover is ALL-SHOPS-ATOMIC (CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1):
    one shared callbackUrl, one app-level SHOPIFY_CLIENT_SECRET HMAC key.

HOLD-AT-CUTOVER: the fetch() implementation is stubbed for LOCAL harness use.
  The real Shopify API call (httpx GET /admin/api/2024-10/orders.json) is a
  Stage-8 artifact — it requires a live Shopify access token from CredentialCustody.

CF-BN-NOLEGACY-1: zero imports from legacy project/. Implemented Brain-native.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any, Optional

from src.domain.framework.adapter import (
    ConnectorAdapter,
    Credential,
    IngestWindow,
    NormalizedEvent,
    PiiFieldSpec,
    PiiManifest,
    RawEvent,
    ReplayCapability,
    TokenModel,
)


# ---------------------------------------------------------------------------
# Shopify PII manifest (CF-C3-PII-ADAPTER-GATE-1)
# Per §5 of the architecture plan:
#   PII fields: email, first_name, last_name
#   lawful_basis: owner_brand_controller
#   purpose_code: analytics_performance
# ---------------------------------------------------------------------------

SHOPIFY_PII_MANIFEST = PiiManifest(
    default_lawful_basis="owner_brand_controller",
    default_purpose_code="analytics_performance",
    pii_fields={
        "email": PiiFieldSpec(
            field_name="email",
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
        ),
        "first_name": PiiFieldSpec(
            field_name="first_name",
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
        ),
        "last_name": PiiFieldSpec(
            field_name="last_name",
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
        ),
    },
)


# ---------------------------------------------------------------------------
# HMAC verification (CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1)
# Brain must verify Shopify webhook HMAC using the app-level SHOPIFY_CLIENT_SECRET
# BEFORE the first webhook arrives (if HMAC fails, event drops — 48h retry window).
# ---------------------------------------------------------------------------


def verify_shopify_hmac(
    data: bytes,
    hmac_header: str,
    client_secret: str,
) -> bool:
    """
    Verify a Shopify webhook HMAC signature.

    Shopify sends X-Shopify-Hmac-SHA256 as a base64-encoded HMAC-SHA256 digest
    of the raw request body, keyed with the app-level SHOPIFY_CLIENT_SECRET.
    Canonical reference: legacy project/backend/src/lib/shopify/webhooks.ts:34-42
      crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('base64')

    H3/F-2 fix: previous implementation used .hexdigest() which never matched
    a real Shopify signature. Now uses base64(digest()) + constant-time compare.

    Returns True if the HMAC matches, False otherwise.
    Brain MUST call this before processing any incoming Shopify webhook.
    """
    computed = base64.b64encode(
        hmac.new(
            client_secret.encode("utf-8"),
            data,
            hashlib.sha256,
        ).digest()
    ).decode("utf-8")
    return hmac.compare_digest(computed, hmac_header)


# ---------------------------------------------------------------------------
# ShopifyAdapter
# ---------------------------------------------------------------------------


class ShopifyAdapter:
    """
    Brain-native Shopify connector adapter.

    Implements ConnectorAdapter Protocol (P3) for the Shopify Orders API.
    Per-connector quirks (pagination cursor, rate-limit, shop-domain routing)
    are encapsulated here — the ingest primitive (P2) is blind to them.
    """

    vendor: str = "shopify"
    pii_manifest: PiiManifest = SHOPIFY_PII_MANIFEST
    token_model: TokenModel = TokenModel.OAUTH_TOKEN
    replay: ReplayCapability = ReplayCapability.FULL_60D

    # Shopify API rate limit: 2 calls/sec per shop (leaky-bucket 40 credit max)
    _RATE_LIMIT_PER_SEC = 2
    # Shopify supports up to 250 orders per page
    _PAGE_SIZE = 250

    async def fetch(
        self,
        creds: Credential,
        window: IngestWindow,
    ) -> AsyncIterator[RawEvent]:
        """
        Fetch orders from the Shopify Admin REST API for the given window.

        HOLD-AT-CUTOVER: this implementation is STUBBED for LOCAL harness use.
        The real call is:
          GET https://{shop_domain}/admin/api/2024-10/orders.json
              ?status=any&limit=250&created_at_min={start}&created_at_max={end}
              (paginate via Link header cursor)
        In dry_run / LOCAL harness mode (creds=None or creds.content empty),
        this yields an empty iterator — the caller provides fixture data.
        """
        if creds is None or not creds.content:
            return
        # Real implementation: iterate with httpx, respect X-Shopify-Shop-Api-Call-Limit
        # For now, raise NotImplementedError to signal a live-only path.
        raise NotImplementedError(
            "[ShopifyAdapter.fetch] STUB — live Shopify API call requires a real "
            "access token from CredentialCustody. Use dry_run=True + fixture injection "
            "for LOCAL harness. Stage-8 activates the live path."
        )
        # The `yield` here makes this an async generator (satisfies the Protocol).
        # Without it Python would not recognise the method as an AsyncIterator factory.
        yield  # type: ignore[misc]

    def normalize(self, raw: RawEvent) -> NormalizedEvent:
        """
        Map a Shopify order RawEvent to a NormalizedEvent.

        PII fields (email, first_name, last_name) are PRESERVED verbatim in the
        normalized output — they pass through to the raw landing table under RLS.
        NO money conversion (raw Shopify decimal strings stay as-is; Child-2 at ACL).
        """
        p = raw.raw_payload
        columns: dict[str, Any] = {
            # Identity / non-PII
            "shopify_order_id": str(p.get("id", "")),
            "order_number": p.get("order_number"),
            "financial_status": p.get("financial_status"),
            "fulfillment_status": p.get("fulfillment_status"),
            # PII fields — declared in SHOPIFY_PII_MANIFEST
            "email": p.get("email"),
            "first_name": p.get("billing_address", {}).get("first_name") if p.get("billing_address") else None,
            "last_name": p.get("billing_address", {}).get("last_name") if p.get("billing_address") else None,
            # Money — raw vendor strings, NO conversion (Child-2 converts at ACL)
            "total_price": p.get("total_price"),
            "subtotal_price": p.get("subtotal_price"),
            "total_discounts": p.get("total_discounts"),
            "total_tax": p.get("total_tax"),
            "currency": p.get("currency"),
            # Timestamps
            "created_at": p.get("created_at"),
            "updated_at": p.get("updated_at"),
            "closed_at": p.get("closed_at"),
            "cancelled_at": p.get("cancelled_at"),
            # Raw payload archive
            "raw_payload": json.dumps(p),
        }

        return NormalizedEvent(
            vendor=self.vendor,
            vendor_event_id=self.idempotency_key(raw),
            event_type=raw.event_type,
            occurred_at=raw.occurred_at,
            lawful_basis=SHOPIFY_PII_MANIFEST.default_lawful_basis,
            purpose_code=SHOPIFY_PII_MANIFEST.default_purpose_code,
            columns=columns,
        )

    def idempotency_key(self, raw: RawEvent) -> str:
        """Return the Shopify order ID as the idempotency anchor.

        Combined with (workspace_id, vendor) this forms the UNIQUE index key:
        (workspace_id, vendor_event_id) on the shopify_orders table.
        """
        return raw.vendor_event_id


# Runtime check: ShopifyAdapter satisfies the Protocol
assert isinstance(ShopifyAdapter(), ConnectorAdapter)
