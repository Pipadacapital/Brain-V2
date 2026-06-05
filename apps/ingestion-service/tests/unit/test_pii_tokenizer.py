"""
Unit tests for P0-B: PII tokenizer (CF-C3-PII-TOKENIZER-1).

@paradigm: sql (pure-domain tests; no DB, no network, no LLM)

Coverage:
  Positive scenarios:
    - Same phone from two vendors → identical token (determinism on E.164 norm)
    - Same email, same salt → same token
    - Non-PII fields are untouched by tokenizer
    - Rotating salt_version → different token (old still derivable from old salt)
    - Empty salt_version fallback ("" treated as distinct version)
    - PII_TOKENIZER=false → passthrough (columns unchanged)
    - PII_TOKENIZER=true → PII fields replaced with tok: prefix tokens

  Negative scenarios:
    - Empty workspace_salt raises ValueError (caller bug guard)
    - Plaintext PII NEVER appears in the emitted columns when flag is ON
    - cross-workspace: same email, different workspace → different token
    - Non-PII field with similar name (e.g. 'order_id') is NOT tokenized

  Woo address removal:
    - billing_address_1 / shipping_address_1 NOT in WooCommerce PiiManifest
    - billing_address_1 in a payload → PII gate blocks it (fail-closed)

  Step-a DDL:
    - grep step-a-enable-create.sql for "address_1" → 0 matches in column defs
      (comments don't count; the COLUMN must be gone)
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re

import pytest

from domain.framework.pii_tokenizer import (
    _hmac_token,
    _normalize_email,
    _normalize_phone,
    tokenize_event,
    tokenize_event_if_enabled,
    PiiTokenizerResult,
)
from domain.framework.pii_manifest import (
    SHOPIFY_MANIFEST,
    WOOCOMMERCE_MANIFEST,
    check_pii_fields,
    PiiManifestViolation,
)
from domain.framework.adapter import PiiManifest, PiiFieldSpec


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_simple_manifest(*field_names: str) -> PiiManifest:
    """Build a minimal PiiManifest declaring the given field names as PII."""
    pii_fields = {
        f: PiiFieldSpec(field_name=f, lawful_basis="owner_brand_controller",
                       purpose_code="analytics_performance")
        for f in field_names
    }
    return PiiManifest(
        default_lawful_basis="owner_brand_controller",
        default_purpose_code="analytics_performance",
        pii_fields=pii_fields,
    )


_TEST_SALT_WS1 = b"workspace_1_test_salt_32bytes___"
_TEST_SALT_WS2 = b"workspace_2_test_salt_32bytes___"
_TEST_SALT_V2  = b"workspace_1_test_salt_v2_32bytes"

# ---------------------------------------------------------------------------
# Phone normalization
# ---------------------------------------------------------------------------

class TestPhoneNormalization:

    def test_e164_with_plus_unchanged(self):
        """E.164 form +919876543210 returns as-is (digits only after +)."""
        assert _normalize_phone("+919876543210") == "+919876543210"

    def test_10_digit_bare_assumed_india(self):
        """10-digit bare number → +91 prefix added."""
        assert _normalize_phone("9876543210") == "+919876543210"

    def test_11_digit_leading_zero_india(self):
        """11-digit number starting with 0 → strip 0, add +91."""
        assert _normalize_phone("09876543210") == "+919876543210"

    def test_spaces_stripped(self):
        """+91 98765 43210 → +919876543210 (spaces removed)."""
        assert _normalize_phone("+91 98765 43210") == "+919876543210"

    def test_dashes_stripped(self):
        """+91-9876-543210 → +919876543210."""
        assert _normalize_phone("+91-9876-543210") == "+919876543210"

    def test_same_number_different_formats_produce_same_result(self):
        """Three formats of the same number → same canonical form."""
        formats = ["+919876543210", "9876543210", "09876543210", "+91 9876543210"]
        normalized = {_normalize_phone(f) for f in formats}
        assert len(normalized) == 1, f"Expected 1 canonical form, got {normalized}"


class TestEmailNormalization:

    def test_lowercase(self):
        assert _normalize_email("BUYER@Example.COM") == "buyer@example.com"

    def test_strip_whitespace(self):
        assert _normalize_email("  buyer@example.com  ") == "buyer@example.com"

    def test_combined(self):
        assert _normalize_email("  BUYER@EXAMPLE.COM  ") == "buyer@example.com"


# ---------------------------------------------------------------------------
# HMAC token determinism
# ---------------------------------------------------------------------------

class TestHmacToken:

    def test_same_salt_same_value_same_token(self):
        """HMAC is deterministic: same salt + same value → same token."""
        t1 = _hmac_token(_TEST_SALT_WS1, "buyer@example.com")
        t2 = _hmac_token(_TEST_SALT_WS1, "buyer@example.com")
        assert t1 == t2

    def test_token_has_tok_prefix(self):
        """All tokens start with 'tok:'."""
        token = _hmac_token(_TEST_SALT_WS1, "buyer@example.com")
        assert token.startswith("tok:")

    def test_different_salt_different_token(self):
        """Different workspace salt → different token (cross-workspace isolation)."""
        t1 = _hmac_token(_TEST_SALT_WS1, "buyer@example.com")
        t2 = _hmac_token(_TEST_SALT_WS2, "buyer@example.com")
        assert t1 != t2

    def test_different_value_different_token(self):
        """Different values → different tokens (collision resistance)."""
        t1 = _hmac_token(_TEST_SALT_WS1, "buyer@example.com")
        t2 = _hmac_token(_TEST_SALT_WS1, "other@example.com")
        assert t1 != t2

    def test_empty_string_produces_stable_token(self):
        """Empty value produces a stable HMAC token (no error)."""
        t = _hmac_token(_TEST_SALT_WS1, "")
        assert t.startswith("tok:")
        assert len(t) == len("tok:") + 64  # sha256 hex = 64 chars


# ---------------------------------------------------------------------------
# tokenize_event — positive scenarios
# ---------------------------------------------------------------------------

class TestTokenizeEventPositive:

    def test_pii_fields_replaced_with_tok_prefix(self):
        """PII-declared fields are replaced with tok: tokens."""
        manifest = _make_simple_manifest("email", "first_name")
        columns = {"email": "buyer@example.com", "first_name": "Alice",
                   "order_id": "ORD-001"}
        result = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        assert result.columns["email"].startswith("tok:")
        assert result.columns["first_name"].startswith("tok:")
        # Non-PII field untouched
        assert result.columns["order_id"] == "ORD-001"

    def test_non_pii_fields_untouched(self):
        """Fields not declared as PII pass through unchanged."""
        manifest = _make_simple_manifest("email")
        columns = {"email": "x@y.com", "order_id": "123", "currency": "INR"}
        result = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        assert result.columns["order_id"] == "123"
        assert result.columns["currency"] == "INR"

    def test_same_phone_two_vendors_identical_token(self):
        """
        KEY TEST (P0-B acceptance): same phone from two vendors → same token.

        This is the G4 identity join key.  Shopify and Klaviyo both have the
        same customer's phone; after E.164 normalization + HMAC they must
        produce the same token so cross-vendor identity stitching works.
        """
        phone = "9876543210"
        manifest = _make_simple_manifest("phone")
        cols_shopify = {"phone": phone, "source": "shopify"}
        cols_klaviyo = {"phone": phone, "source": "klaviyo"}

        r_shopify = tokenize_event(cols_shopify, manifest, _TEST_SALT_WS1, "v1")
        r_klaviyo = tokenize_event(cols_klaviyo, manifest, _TEST_SALT_WS1, "v1")

        assert r_shopify.columns["phone"] == r_klaviyo.columns["phone"], (
            "Same phone from two vendors must produce the same HMAC token "
            "(G4 identity join key)."
        )

    def test_salt_version_rotation_different_token(self):
        """
        KEY TEST (P0-B R1.4): rotating salt_version produces a different token.

        Old token still derivable from the old salt (replay stability).
        """
        manifest = _make_simple_manifest("email")
        columns = {"email": "buyer@example.com"}

        r_v1 = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        r_v2 = tokenize_event(columns, manifest, _TEST_SALT_V2, "v2")

        assert r_v1.columns["email"] != r_v2.columns["email"], (
            "A new salt_version must produce a different token."
        )
        # Old token is still derivable from old salt
        r_v1_rederived = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        assert r_v1.columns["email"] == r_v1_rederived.columns["email"], (
            "Old token must be re-derivable from old salt (replay stability R1.4)."
        )

    def test_cross_workspace_different_token(self):
        """Same email, different workspace → different token (cross-workspace isolation)."""
        manifest = _make_simple_manifest("email")
        columns = {"email": "buyer@example.com"}
        r_ws1 = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        r_ws2 = tokenize_event(columns, manifest, _TEST_SALT_WS2, "v1")
        assert r_ws1.columns["email"] != r_ws2.columns["email"]

    def test_fields_tokenized_list_contains_pii_fields(self):
        """fields_tokenized in the result names the fields that were replaced."""
        manifest = _make_simple_manifest("email", "phone")
        columns = {"email": "x@y.com", "phone": "9876543210", "sku": "ABC"}
        result = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        assert set(result.fields_tokenized) == {"email", "phone"}

    def test_salt_version_stored_in_result(self):
        """PiiTokenizerResult carries the salt_version for envelope embedding."""
        manifest = _make_simple_manifest("email")
        result = tokenize_event({"email": "x@y.com"}, manifest, _TEST_SALT_WS1, "v42")
        assert result.salt_version == "v42"

    def test_original_columns_not_mutated(self):
        """tokenize_event must not mutate the caller's columns dict."""
        manifest = _make_simple_manifest("email")
        original = {"email": "buyer@example.com"}
        original_copy = dict(original)
        tokenize_event(original, manifest, _TEST_SALT_WS1, "v1")
        assert original == original_copy, "tokenize_event must not mutate caller's dict"

    def test_shopify_manifest_tokenizes_email_first_name_last_name(self):
        """SHOPIFY_MANIFEST + real PII fields → all three replaced with tok: tokens."""
        columns = {
            "email": "alice@example.com",
            "first_name": "Alice",
            "last_name": "Doe",
            "shopify_order_id": "12345",
            "total_price": "999.00",
        }
        result = tokenize_event(columns, SHOPIFY_MANIFEST, _TEST_SALT_WS1, "v1")
        assert result.columns["email"].startswith("tok:")
        assert result.columns["first_name"].startswith("tok:")
        assert result.columns["last_name"].startswith("tok:")
        # Non-PII untouched
        assert result.columns["shopify_order_id"] == "12345"
        assert result.columns["total_price"] == "999.00"


# ---------------------------------------------------------------------------
# tokenize_event — negative / guard scenarios
# ---------------------------------------------------------------------------

class TestTokenizeEventNegative:

    def test_empty_workspace_salt_raises_value_error(self):
        """Empty salt must raise ValueError — caller bug guard."""
        manifest = _make_simple_manifest("email")
        with pytest.raises(ValueError, match="workspace_salt must not be empty"):
            tokenize_event({"email": "x@y.com"}, manifest, b"", "v1")

    def test_plaintext_pii_never_in_columns_when_tokenized(self):
        """
        DPDP GATE: after tokenization, NO plaintext PII value appears in columns.

        This is the snapshot-grep equivalent in Python:
        serialize the columns dict and assert the plaintext strings are absent.
        """
        import json
        manifest = _make_simple_manifest("email", "first_name", "last_name")
        plaintext_email = "alice@shopify.example.com"
        plaintext_first = "Alice"
        plaintext_last  = "Doe"
        columns = {
            "email":      plaintext_email,
            "first_name": plaintext_first,
            "last_name":  plaintext_last,
            "order_id":   "ORD-001",
        }
        result = tokenize_event(columns, manifest, _TEST_SALT_WS1, "v1")
        serialized = json.dumps(result.columns)

        # KEY ACCEPTANCE CRITERION: grep for plaintext → 0 matches
        assert plaintext_email  not in serialized, "email plaintext leaked into columns"
        assert plaintext_first  not in serialized, "first_name plaintext leaked into columns"
        assert plaintext_last   not in serialized, "last_name plaintext leaked into columns"

    def test_non_pii_field_order_id_not_tokenized(self):
        """'order_id' is not PII and must NOT be tokenized even if it looks numeric."""
        manifest = _make_simple_manifest("email")
        result = tokenize_event(
            {"email": "x@y.com", "order_id": "ORD-999"},
            manifest, _TEST_SALT_WS1, "v1"
        )
        assert result.columns["order_id"] == "ORD-999"

    def test_empty_manifest_no_fields_tokenized(self):
        """A manifest with no PII fields leaves all columns unchanged."""
        from domain.framework.adapter import PiiManifest as _PM
        empty_manifest = _PM(
            default_lawful_basis="owner_brand_controller",
            default_purpose_code="analytics_performance",
            pii_fields={},
        )
        columns = {"impressions": 1000, "clicks": 50, "spend_raw": "500.00"}
        result = tokenize_event(columns, empty_manifest, _TEST_SALT_WS1, "v1")
        assert result.columns == columns
        assert result.fields_tokenized == []


# ---------------------------------------------------------------------------
# tokenize_event_if_enabled — feature flag gate
# ---------------------------------------------------------------------------

class TestTokenizeEventIfEnabled:

    def test_flag_off_passthrough(self, monkeypatch):
        """When PII_TOKENIZER=false (default), columns pass through unchanged."""
        monkeypatch.setenv("PII_TOKENIZER", "false")
        manifest = _make_simple_manifest("email")
        columns = {"email": "alice@example.com", "order_id": "ORD-1"}
        result = tokenize_event_if_enabled(columns, manifest, _TEST_SALT_WS1, "v1")
        assert result.columns["email"] == "alice@example.com"  # plaintext preserved
        assert result.fields_tokenized == []

    def test_flag_on_tokenizes(self, monkeypatch):
        """When PII_TOKENIZER=true, PII fields are replaced with tok: tokens."""
        monkeypatch.setenv("PII_TOKENIZER", "true")
        manifest = _make_simple_manifest("email")
        columns = {"email": "alice@example.com", "order_id": "ORD-1"}
        result = tokenize_event_if_enabled(columns, manifest, _TEST_SALT_WS1, "v1")
        assert result.columns["email"].startswith("tok:")
        assert "alice@example.com" not in result.columns["email"]

    def test_flag_off_salt_version_still_in_result(self, monkeypatch):
        """Even with flag OFF, salt_version is returned (for envelope embedding)."""
        monkeypatch.setenv("PII_TOKENIZER", "false")
        manifest = _make_simple_manifest("email")
        result = tokenize_event_if_enabled({}, manifest, _TEST_SALT_WS1, "v99")
        assert result.salt_version == "v99"

    def test_flag_case_insensitive(self, monkeypatch):
        """PII_TOKENIZER=True (capital T) is treated as ON."""
        monkeypatch.setenv("PII_TOKENIZER", "True")
        manifest = _make_simple_manifest("email")
        result = tokenize_event_if_enabled(
            {"email": "x@y.com"}, manifest, _TEST_SALT_WS1, "v1"
        )
        assert result.columns["email"].startswith("tok:")

    def test_flag_missing_treated_as_off(self, monkeypatch):
        """Absent PII_TOKENIZER env-var is treated as OFF."""
        monkeypatch.delenv("PII_TOKENIZER", raising=False)
        manifest = _make_simple_manifest("email")
        result = tokenize_event_if_enabled(
            {"email": "x@y.com"}, manifest, _TEST_SALT_WS1, "v1"
        )
        # passthrough — plaintext preserved
        assert result.columns["email"] == "x@y.com"


# ---------------------------------------------------------------------------
# Woo address removal: manifest + gate
# ---------------------------------------------------------------------------

class TestWooAddressRemoval:

    def test_billing_address_1_not_in_woo_manifest(self):
        """
        P0-B DPDP GATE: billing_address_1 must NOT be declared in WOOCOMMERCE_MANIFEST.
        It was removed to reduce the PII surface area (full street address).
        """
        assert "billing_address_1" not in WOOCOMMERCE_MANIFEST.pii_fields, (
            "billing_address_1 must have been removed from WOOCOMMERCE_MANIFEST (P0-B)."
        )

    def test_shipping_address_1_not_in_woo_manifest(self):
        """P0-B DPDP GATE: shipping_address_1 must NOT be in WOOCOMMERCE_MANIFEST."""
        assert "shipping_address_1" not in WOOCOMMERCE_MANIFEST.pii_fields, (
            "shipping_address_1 must have been removed from WOOCOMMERCE_MANIFEST (P0-B)."
        )

    def test_billing_address_1_in_payload_blocked_by_pii_gate(self):
        """
        NEGATIVE: billing_address_1 in a WooCommerce payload → PII gate blocks it.
        Since it's removed from the manifest but 'billing' matches the heuristic,
        the fail-closed gate must raise PiiManifestViolation.
        """
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(
                WOOCOMMERCE_MANIFEST,
                ["woo_order_id", "billing_address_1"],
            )
        assert "billing_address_1" in exc_info.value.undeclared_fields

    def test_shipping_address_1_in_payload_blocked_by_pii_gate(self):
        """shipping_address_1 in payload → PII gate blocks it (heuristic)."""
        with pytest.raises(PiiManifestViolation) as exc_info:
            check_pii_fields(
                WOOCOMMERCE_MANIFEST,
                ["woo_order_id", "shipping_address_1"],
            )
        assert "shipping_address_1" in exc_info.value.undeclared_fields

    def test_city_state_postcode_retained_in_woo_manifest(self):
        """billing_city/billing_state/billing_postcode remain in the manifest."""
        retained = {"billing_city", "billing_state", "billing_postcode",
                    "shipping_city", "shipping_state", "shipping_postcode"}
        manifest_fields = set(WOOCOMMERCE_MANIFEST.pii_fields.keys())
        for field in retained:
            assert field in manifest_fields, (
                f"{field} should still be in WOOCOMMERCE_MANIFEST (retained for geo-bucketing)."
            )


# ---------------------------------------------------------------------------
# DDL static grep: step-a-enable-create.sql must not define address_1 columns
# ---------------------------------------------------------------------------

class TestStepADdlAddressRemoval:
    """
    P0-B acceptance criterion (task 5):
      grep -c "address_1" step-a-enable-create.sql == 0  (for column definitions)

    We allow the word to appear in SQL COMMENTS (-- ...) but not as a column
    definition line.
    """

    @pytest.fixture(scope="class")
    def step_a_lines(self) -> list[str]:
        import os as _os
        ddl_path = _os.path.normpath(_os.path.join(
            _os.path.dirname(__file__),
            "../../migrations/manual/raw/step-a-enable-create.sql",
        ))
        with open(ddl_path) as f:
            return f.readlines()

    def test_no_billing_address_1_column_definition(self, step_a_lines):
        """
        billing_address_1 must not appear as a column definition.
        Comment lines (-- ...) are excluded from the check.
        """
        col_def_lines = [
            line for line in step_a_lines
            if "billing_address_1" in line
            and not line.strip().startswith("--")
        ]
        assert len(col_def_lines) == 0, (
            f"billing_address_1 still defined as a column (non-comment) in step-a:\n"
            + "".join(col_def_lines)
        )

    def test_no_shipping_address_1_column_definition(self, step_a_lines):
        """shipping_address_1 must not appear as a column definition."""
        col_def_lines = [
            line for line in step_a_lines
            if "shipping_address_1" in line
            and not line.strip().startswith("--")
        ]
        assert len(col_def_lines) == 0, (
            f"shipping_address_1 still defined as a column (non-comment) in step-a:\n"
            + "".join(col_def_lines)
        )


# ---------------------------------------------------------------------------
# Snapshot-grep: ingest.py _ALLOWED_COLUMNS must not contain address_1 fields
# ---------------------------------------------------------------------------

class TestAllowedColumnsAddressRemoval:

    def test_billing_address_1_not_in_woo_allowed_columns(self):
        """billing_address_1 must be removed from _ALLOWED_COLUMNS in ingest.py."""
        from src.application.framework.ingest import _ALLOWED_COLUMNS
        woo_cols = _ALLOWED_COLUMNS.get("raw_woocommerce_orders", frozenset())
        assert "billing_address_1" not in woo_cols, (
            "billing_address_1 must not be in _ALLOWED_COLUMNS['raw_woocommerce_orders'] (P0-B)."
        )

    def test_shipping_address_1_not_in_woo_allowed_columns(self):
        """shipping_address_1 must be removed from _ALLOWED_COLUMNS in ingest.py."""
        from src.application.framework.ingest import _ALLOWED_COLUMNS
        woo_cols = _ALLOWED_COLUMNS.get("raw_woocommerce_orders", frozenset())
        assert "shipping_address_1" not in woo_cols, (
            "shipping_address_1 must not be in _ALLOWED_COLUMNS['raw_woocommerce_orders'] (P0-B)."
        )


# ---------------------------------------------------------------------------
# Kafka envelope snapshot: plaintext PII must not appear in _produce_kafka bytes
# ---------------------------------------------------------------------------

class TestKafkaEnvelopeSnapshotGrep:
    """
    P0-B acceptance criterion (task 3):
      Produce a Shopify order with email/first_name/last_name;
      grep the bytes _produce_kafka would emit for the plaintext → 0 matches.

    REWRITTEN (P0-B VETO fix): the old test pre-tokenized manually and never
    called ShopifyAdapter.normalize(), so it could not catch raw_payload leaking
    the full vendor JSON (which contains email/first_name/last_name verbatim).

    This version calls ShopifyAdapter.normalize() with a REAL RawEvent (email +
    billing_address with first_name/last_name in the payload), runs
    tokenize_event_if_enabled on the result, then feeds the tokenized NormalizedEvent
    to _produce_kafka and greps every byte of the emitted envelope for plaintext.

    VERIFY-THE-VERIFIER: the negative regression test below confirms that the test
    FAILS when raw_payload is re-added to columns (i.e. the bug is re-introduced),
    and PASSES when it is absent.
    """

    # Shared plaintext values used in both the positive and regression tests.
    _PLAINTEXT_EMAIL = "alice@shopify.example.com"
    _PLAINTEXT_FIRST = "Alice"
    _PLAINTEXT_LAST  = "Doe"
    _TEST_SALT = b"workspace_1_test_salt_32bytes___"

    def _build_shopify_raw_event(self) -> "RawEvent":
        """Build a realistic Shopify order RawEvent with PII in the payload."""
        from src.domain.framework.adapter import RawEvent
        from datetime import datetime, timezone
        payload = {
            "id": 9999,
            "order_number": 1001,
            "financial_status": "paid",
            "fulfillment_status": "fulfilled",
            "email": self._PLAINTEXT_EMAIL,
            "billing_address": {
                "first_name": self._PLAINTEXT_FIRST,
                "last_name": self._PLAINTEXT_LAST,
            },
            "total_price": "2999.00",
            "subtotal_price": "2799.00",
            "total_discounts": "200.00",
            "total_tax": "0.00",
            "currency": "INR",
            "created_at": "2024-01-15T10:00:00+05:30",
            "updated_at": "2024-01-15T10:05:00+05:30",
            "closed_at": None,
            "cancelled_at": None,
        }
        return RawEvent(
            vendor="shopify",
            vendor_event_id="ORD-9999",
            event_type="order",
            occurred_at=datetime.now(timezone.utc),
            raw_payload=payload,
        )

    async def _produce_and_capture(
        self,
        columns: dict,
        salt: bytes = _TEST_SALT,
        salt_version: str = "v1",
    ) -> bytes:
        """Tokenize columns and produce to a fake Kafka; return the raw envelope bytes."""
        import json as _json
        from src.application.framework.ingest import _produce_kafka
        from src.domain.framework.adapter import NormalizedEvent
        from src.domain.framework.pii_tokenizer import tokenize_event_if_enabled
        from datetime import datetime, timezone

        tokenizer_result = tokenize_event_if_enabled(
            columns=columns,
            manifest=SHOPIFY_MANIFEST,
            workspace_salt=salt,
            salt_version=salt_version,
        )
        event = NormalizedEvent(
            vendor="shopify",
            vendor_event_id="ORD-9999",
            event_type="order",
            occurred_at=datetime.now(timezone.utc),
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
            columns=tokenizer_result.columns,
        )
        produced_bytes: list[bytes] = []

        class _FakeProducer:
            async def send_and_wait(self, topic, *, value, key):
                produced_bytes.append(value)
                class _Meta:
                    offset = 0
                return _Meta()

        await _produce_kafka(
            _FakeProducer(),
            "integrations.shopify.v1",
            "ws-1234",
            event,
            datetime.now(timezone.utc),
            request_id="req-1",
            trace_id="trace-1",
            salt_version=salt_version,
        )
        assert len(produced_bytes) == 1
        return produced_bytes[0]

    @pytest.mark.asyncio
    async def test_shopify_order_envelope_no_plaintext_pii_when_tokenizer_on(self, monkeypatch):
        """
        PRIMARY TEST (P0-B VETO fix):
        Call ShopifyAdapter.normalize() with a REAL RawEvent, then tokenize + produce.
        The Kafka envelope bytes must contain ZERO plaintext email/first_name/last_name.

        This catches both the pii-field leak AND the raw_payload vendor-JSON leak —
        if raw_payload is present in columns it contains the full JSON including
        plaintext email and names, and this grep will catch it.
        """
        from src.interfaces.adapters.shopify_adapter import ShopifyAdapter

        monkeypatch.setenv("PII_TOKENIZER", "true")

        adapter = ShopifyAdapter()
        raw_event = self._build_shopify_raw_event()
        normalized = adapter.normalize(raw_event)

        envelope_bytes = await self._produce_and_capture(normalized.columns)
        envelope_str = envelope_bytes.decode("latin-1")

        # DPDP GATE: plaintext must not appear anywhere in the emitted bytes
        assert self._PLAINTEXT_EMAIL not in envelope_str, (
            f"{self._PLAINTEXT_EMAIL!r} (plaintext email) leaked into Kafka envelope. "
            "Check that raw_payload is stripped from NormalizedEvent.columns (P0-B Option-a)."
        )
        assert self._PLAINTEXT_FIRST not in envelope_str, (
            f"{self._PLAINTEXT_FIRST!r} (plaintext first_name) leaked into Kafka envelope."
        )
        assert self._PLAINTEXT_LAST not in envelope_str, (
            f"{self._PLAINTEXT_LAST!r} (plaintext last_name) leaked into Kafka envelope."
        )
        # Tokens must be present — confirms tokenizer ran
        assert "tok:" in envelope_str, (
            "Expected tok: tokens in envelope but found none — did tokenizer run?"
        )

    @pytest.mark.asyncio
    async def test_regression_raw_payload_in_columns_causes_test_to_fail(self, monkeypatch):
        """
        VERIFY-THE-VERIFIER (negative regression):
        If raw_payload is reintroduced into columns (the original bug), the grep
        MUST detect the plaintext email and this assertion must FAIL.

        We inject raw_payload manually to simulate the pre-fix code path.
        This test asserts that the plaintext IS detectable — confirming the
        grep is not a no-op and that the primary test above is load-bearing.
        """
        import json as _json
        from src.interfaces.adapters.shopify_adapter import ShopifyAdapter

        monkeypatch.setenv("PII_TOKENIZER", "true")

        adapter = ShopifyAdapter()
        raw_event = self._build_shopify_raw_event()
        normalized = adapter.normalize(raw_event)

        # Inject raw_payload back in to simulate the pre-fix bug
        buggy_columns = dict(normalized.columns)
        buggy_columns["raw_payload"] = _json.dumps(raw_event.raw_payload)

        envelope_bytes = await self._produce_and_capture(buggy_columns)
        envelope_str = envelope_bytes.decode("latin-1")

        # The buggy path MUST expose plaintext in the envelope.
        # If this assertion fails, the tokenizer somehow removed the raw_payload too —
        # which is fine but unlikely (raw_payload is not in SHOPIFY_MANIFEST.pii_fields).
        assert (
            self._PLAINTEXT_EMAIL in envelope_str
            or self._PLAINTEXT_FIRST in envelope_str
            or self._PLAINTEXT_LAST in envelope_str
        ), (
            "Regression test setup error: injected raw_payload but no plaintext found "
            "in envelope — the verifier test is broken."
        )

    @pytest.mark.asyncio
    async def test_shopify_order_envelope_has_salt_version(self):
        """Kafka envelope must carry salt_version for replay stability (P0-B R1.4)."""
        import json
        from src.application.framework.ingest import _produce_kafka
        from src.domain.framework.adapter import NormalizedEvent
        from datetime import datetime, timezone

        event = NormalizedEvent(
            vendor="shopify",
            vendor_event_id="ORD-8888",
            event_type="order",
            occurred_at=datetime.now(timezone.utc),
            lawful_basis="owner_brand_controller",
            purpose_code="analytics_performance",
            columns={"shopify_order_id": "ORD-8888"},
        )

        produced_bytes: list[bytes] = []

        class _FakeProducer:
            async def send_and_wait(self, topic, *, value, key):
                produced_bytes.append(value)
                class _Meta:
                    offset = 0
                return _Meta()

        await _produce_kafka(
            _FakeProducer(),
            "integrations.shopify.v1",
            "ws-abcd",
            event,
            datetime.now(timezone.utc),
            salt_version="v42",
        )

        envelope = json.loads(produced_bytes[0].decode("latin-1"))
        assert envelope.get("salt_version") == "v42"
