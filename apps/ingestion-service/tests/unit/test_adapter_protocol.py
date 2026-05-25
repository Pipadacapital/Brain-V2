"""
Unit tests for adapter.py (P3) domain types + Shopify adapter.

@paradigm: sql

Tests:
  PiiManifest:
  - is_pii returns True for declared PII fields
  - is_pii returns False for undeclared fields
  - get_spec returns the correct PiiFieldSpec
  - get_spec returns None for undeclared fields

  IngestWindow:
  - is_bounded returns False when start is None
  - is_bounded returns True when start is set
  - days_hint returns correct value for bounded windows
  - days_hint returns None for unbounded windows

  ConnectorAdapter (Protocol runtime_checkable):
  - ShopifyAdapter is an instance of ConnectorAdapter Protocol

  ShopifyAdapter:
  - vendor is 'shopify'
  - pii_manifest declares email, first_name, last_name as PII
  - token_model is OAUTH_TOKEN
  - replay is FULL_60D
  - idempotency_key returns vendor_event_id
  - normalize maps raw order to NormalizedEvent with correct fields
  - normalize does NOT convert money (raw string preserved)
  - normalize stamps correct lawful_basis + purpose_code
  - verify_shopify_hmac passes for correct HMAC
  - verify_shopify_hmac fails for incorrect HMAC
"""

from datetime import datetime, timezone, timedelta

import pytest

from src.domain.framework.adapter import (
    ConnectorAdapter,
    Credential,
    IngestWindow,
    PiiFieldSpec,
    PiiManifest,
    RawEvent,
    ReplayCapability,
    TokenModel,
)
from src.interfaces.adapters.shopify_adapter import (
    SHOPIFY_PII_MANIFEST,
    ShopifyAdapter,
    verify_shopify_hmac,
)


class TestPiiManifest:
    def setup_method(self):
        self.manifest = PiiManifest(
            pii_fields={
                "email": PiiFieldSpec("email", "owner_brand_controller", "analytics_performance"),
                "phone": PiiFieldSpec("phone", "owner_brand_controller", "analytics_performance"),
            }
        )

    def test_is_pii_declared_field(self):
        assert self.manifest.is_pii("email") is True

    def test_is_pii_another_declared_field(self):
        assert self.manifest.is_pii("phone") is True

    def test_is_pii_undeclared_field(self):
        assert self.manifest.is_pii("order_id") is False

    def test_get_spec_returns_spec(self):
        spec = self.manifest.get_spec("email")
        assert spec is not None
        assert spec.lawful_basis == "owner_brand_controller"
        assert spec.purpose_code == "analytics_performance"

    def test_get_spec_undeclared_returns_none(self):
        assert self.manifest.get_spec("order_id") is None


class TestIngestWindow:
    def test_unbounded_window_is_not_bounded(self):
        w = IngestWindow()
        assert w.is_bounded is False

    def test_bounded_window_is_bounded(self):
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = datetime(2024, 1, 8, tzinfo=timezone.utc)
        w = IngestWindow(start=start, end=end)
        assert w.is_bounded is True

    def test_days_hint_bounded(self):
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = start + timedelta(days=7)
        w = IngestWindow(start=start, end=end)
        assert w.days_hint == 7

    def test_days_hint_unbounded_returns_none(self):
        w = IngestWindow()
        assert w.days_hint is None

    def test_days_hint_minimum_1(self):
        now = datetime.now(timezone.utc)
        w = IngestWindow(start=now, end=now)  # same second
        assert w.days_hint == 1


class TestShopifyAdapterProtocol:
    def test_is_connector_adapter_instance(self):
        adapter = ShopifyAdapter()
        assert isinstance(adapter, ConnectorAdapter)

    def test_vendor_is_shopify(self):
        assert ShopifyAdapter().vendor == "shopify"

    def test_token_model_oauth(self):
        assert ShopifyAdapter().token_model == TokenModel.OAUTH_TOKEN

    def test_replay_full_60d(self):
        assert ShopifyAdapter().replay == ReplayCapability.FULL_60D


class TestShopifyPiiManifest:
    def test_email_is_pii(self):
        assert SHOPIFY_PII_MANIFEST.is_pii("email")

    def test_first_name_is_pii(self):
        assert SHOPIFY_PII_MANIFEST.is_pii("first_name")

    def test_last_name_is_pii(self):
        assert SHOPIFY_PII_MANIFEST.is_pii("last_name")

    def test_order_id_is_not_pii(self):
        assert not SHOPIFY_PII_MANIFEST.is_pii("shopify_order_id")

    def test_total_price_is_not_pii(self):
        assert not SHOPIFY_PII_MANIFEST.is_pii("total_price")

    def test_pii_spec_lawful_basis(self):
        spec = SHOPIFY_PII_MANIFEST.get_spec("email")
        assert spec is not None
        assert spec.lawful_basis == "owner_brand_controller"

    def test_pii_spec_purpose_code(self):
        spec = SHOPIFY_PII_MANIFEST.get_spec("email")
        assert spec is not None
        assert spec.purpose_code == "analytics_performance"


class TestShopifyNormalize:
    def setup_method(self):
        self.adapter = ShopifyAdapter()
        self.raw = RawEvent(
            vendor="shopify",
            vendor_event_id="1234567890",
            event_type="order",
            occurred_at=datetime(2024, 3, 15, 10, 0, 0, tzinfo=timezone.utc),
            raw_payload={
                "id": 1234567890,
                "order_number": 1001,
                "financial_status": "paid",
                "fulfillment_status": "fulfilled",
                "email": "test@example.com",
                "billing_address": {
                    "first_name": "Arjun",
                    "last_name": "Sharma",
                },
                # Money fields — raw strings from Shopify API (NO conversion)
                "total_price": "1234.00",
                "subtotal_price": "1100.00",
                "total_discounts": "0.00",
                "total_tax": "134.00",
                "currency": "INR",
                "created_at": "2024-03-15T10:00:00+05:30",
                "updated_at": "2024-03-15T10:05:00+05:30",
                "closed_at": None,
                "cancelled_at": None,
            },
        )

    def test_normalize_sets_vendor(self):
        result = self.adapter.normalize(self.raw)
        assert result.vendor == "shopify"

    def test_normalize_sets_vendor_event_id(self):
        result = self.adapter.normalize(self.raw)
        assert result.vendor_event_id == "1234567890"

    def test_normalize_sets_event_type(self):
        result = self.adapter.normalize(self.raw)
        assert result.event_type == "order"

    def test_normalize_preserves_email_pii(self):
        result = self.adapter.normalize(self.raw)
        assert result.columns["email"] == "test@example.com"

    def test_normalize_preserves_first_name_pii(self):
        result = self.adapter.normalize(self.raw)
        assert result.columns["first_name"] == "Arjun"

    def test_normalize_preserves_last_name_pii(self):
        result = self.adapter.normalize(self.raw)
        assert result.columns["last_name"] == "Sharma"

    def test_normalize_does_not_convert_money(self):
        result = self.adapter.normalize(self.raw)
        # Must be the raw string "1234.00" — NOT an integer minor-units value
        assert result.columns["total_price"] == "1234.00"
        assert result.columns["currency"] == "INR"

    def test_normalize_stamps_lawful_basis(self):
        result = self.adapter.normalize(self.raw)
        assert result.lawful_basis == "owner_brand_controller"

    def test_normalize_stamps_purpose_code(self):
        result = self.adapter.normalize(self.raw)
        assert result.purpose_code == "analytics_performance"

    def test_normalize_includes_raw_payload(self):
        result = self.adapter.normalize(self.raw)
        assert "raw_payload" in result.columns

    def test_idempotency_key_returns_vendor_event_id(self):
        key = self.adapter.idempotency_key(self.raw)
        assert key == "1234567890"


class TestShopifyHmacVerification:
    """HMAC verification for app-level SHOPIFY_CLIENT_SECRET (CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1).

    H3/F-2 fix: Shopify X-Shopify-Hmac-SHA256 is BASE64-encoded, not hex.
    Reference: legacy project/backend/src/lib/shopify/webhooks.ts:34-42
      crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('base64')

    All fixture signatures are now built the Shopify way (base64) so these tests
    prove that verify_shopify_hmac accepts real Shopify signatures and rejects
    hex/garbage values.
    """

    def _shopify_signature(self, secret: str, data: bytes) -> str:
        """Build a Shopify-style HMAC-SHA256 base64 signature (canonical Shopify encoding)."""
        import base64, hashlib, hmac as hmac_lib
        return base64.b64encode(
            hmac_lib.new(secret.encode("utf-8"), data, hashlib.sha256).digest()
        ).decode("utf-8")

    def test_valid_base64_hmac_passes(self):
        """H3/F-2: valid Shopify-style base64 signature must be accepted."""
        secret = "test_secret_key"
        data = b'{"id": 12345, "topic": "orders/create"}'
        expected = self._shopify_signature(secret, data)
        assert verify_shopify_hmac(data, expected, secret) is True

    def test_hex_signature_is_rejected(self):
        """H3/F-2: a hex-encoded HMAC (old broken implementation) must be REJECTED.

        This is the core regression test: before the fix, hexdigest() was used
        which could never match a real Shopify header. This test proves that
        passing a hexdigest value returns False (i.e. the old path is broken
        and the new base64 path correctly rejects it).
        """
        import hashlib, hmac as hmac_lib
        secret = "test_secret_key"
        data = b'{"id": 12345, "topic": "orders/create"}'
        hex_signature = hmac_lib.new(secret.encode(), data, hashlib.sha256).hexdigest()
        # hex signature must NOT match — Shopify sends base64, not hex
        assert verify_shopify_hmac(data, hex_signature, secret) is False

    def test_garbage_signature_is_rejected(self):
        """Any garbage/wrong signature must be rejected."""
        data = b'{"id": 12345}'
        assert verify_shopify_hmac(data, "not-a-valid-signature", "secret") is False

    def test_wrong_secret_is_rejected(self):
        """H3/F-2: a signature built with a different secret must be rejected."""
        data = b'{"id": 12345}'
        correct_sig = self._shopify_signature("correct_secret", data)
        assert verify_shopify_hmac(data, correct_sig, "wrong_secret") is False

    def test_tampered_data_is_rejected(self):
        """H3/F-2: a signature for the original body must not verify for tampered body."""
        secret = "test_secret_key"
        original_data = b'{"id": 12345}'
        tampered_data = b'{"id": 99999}'
        original_sig = self._shopify_signature(secret, original_data)
        assert verify_shopify_hmac(tampered_data, original_sig, secret) is False

    def test_empty_data_with_correct_hmac_passes(self):
        """Edge case: empty body with correct signature must pass."""
        secret = "some_secret"
        data = b""
        expected = self._shopify_signature(secret, data)
        assert verify_shopify_hmac(data, expected, secret) is True
