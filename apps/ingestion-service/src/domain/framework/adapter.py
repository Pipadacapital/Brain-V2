"""
ConnectorAdapter Protocol — the adapter interface for all vendor connectors.

@paradigm: sql (per-connector quirks are CONFIG behind this interface, NOT N bespoke ingest paths)

CF-C3-SINGLE-PRIMITIVE-1: ONE generic ingest primitive consumed N times.
CF-C3-PII-ADAPTER-GATE-1: each adapter declares a code-level PiiManifest (checked by ingest_batch).

Per the locked signature in 07-handoff-to-developer.md §2:
  class ConnectorAdapter(Protocol)
    vendor: str
    pii_manifest: PiiManifest
    token_model: TokenModel
    replay: ReplayCapability
    async fetch(creds, window) -> AsyncIterator[RawEvent]
    normalize(raw) -> NormalizedEvent   (NO money conversion — lands raw; Child-2 converts at ACL)
    idempotency_key(raw) -> str
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# TokenModel — which authentication model the vendor uses
# ---------------------------------------------------------------------------


class TokenModel(str, Enum):
    OAUTH_TOKEN = "oauth_token"
    REFRESH_TOKEN = "refresh_token"
    API_KEY = "api_key"
    EMAIL_PASSWORD = "email_password"  # Shiprocket — unrecoverable; treat with extra care


# ---------------------------------------------------------------------------
# ReplayCapability — how far back the vendor can replay events on rollback
# ---------------------------------------------------------------------------


class ReplayCapability(str, Enum):
    FULL_60D = "full_60d"       # Shopify — 60-day order API backfill
    WINDOW = "window"            # Meta/Google — bounded attribution window
    PARTIAL = "partial"          # Klaviyo/Unicommerce — limited history
    NONE = "none"                # Shiprocket — NO replay; sequenced LAST


# ---------------------------------------------------------------------------
# IngestWindow — bounded (live run) or unbounded (backfill); same code path
# CF-C3-SINGLE-PRIMITIVE-1: same ingest_batch path for live + backfill
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IngestWindow:
    """Temporal window for an ingest run.

    Bounded window: start + end both set (live run, parity check, backfill).
    Unbounded window: start=None (full historical backfill from vendor epoch).
    """
    start: Optional[datetime] = None  # None = unbounded (full backfill)
    end: Optional[datetime] = None    # None = "now" at execution time

    @property
    def is_bounded(self) -> bool:
        return self.start is not None

    @property
    def days_hint(self) -> Optional[int]:
        """Approximate days span — used for logging/metrics; not a hard gate."""
        if self.start is not None and self.end is not None:
            delta = self.end - self.start
            return max(1, delta.days)
        return None


# ---------------------------------------------------------------------------
# RawEvent — the unit of data coming off the vendor API
# ---------------------------------------------------------------------------


@dataclass
class RawEvent:
    """Vendor-shape event, unmodified from the API response.

    The raw payload is preserved verbatim (NO money conversion — that is
    Child-2's job at the ACL). Only metadata is added by the framework.
    """
    vendor: str                          # e.g. "shopify"
    vendor_event_id: str                 # the idempotency anchor from the vendor
    event_type: str                      # e.g. "order", "shipment", "ad_daily"
    occurred_at: Optional[datetime]      # vendor-supplied event timestamp
    raw_payload: dict[str, Any]          # verbatim vendor JSON — NO transformation


# ---------------------------------------------------------------------------
# NormalizedEvent — vendor-shape → raw-event-store row (still raw money/PII)
# ---------------------------------------------------------------------------


@dataclass
class NormalizedEvent:
    """Vendor-shape event mapped to the raw event store column layout.

    Money fields are passed through VERBATIM as vendor-supplied strings/
    decimals. Child-2 converts Decimal → minor-units at the ACL.
    NO money conversion here (CF-C3 scope carve-out).
    """
    vendor: str
    vendor_event_id: str
    event_type: str
    occurred_at: Optional[datetime]
    # Consent columns — stamped at ingest-write (CF-C3-CONSENT-COLUMN-1)
    lawful_basis: str           # e.g. "owner_brand_controller"
    purpose_code: str           # e.g. "analytics_performance"
    # All other columns as raw key-value pairs (vendor-shape)
    columns: dict[str, Any]     # maps to raw landing table columns


# ---------------------------------------------------------------------------
# Credential — opaque credential container (backing = CredentialCustody)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Credential:
    """Opaque credential container. Never log or serialize this object.

    The content dict holds whatever the vendor needs (access_token, api_key,
    email/password). The custody backing (P4) controls read/write/seal.
    """
    workspace_id: str
    vendor: str
    content: dict[str, Any]  # NEVER logged or serialized outside the custody backing


# ---------------------------------------------------------------------------
# PiiFieldSpec — one field's compliance declaration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PiiFieldSpec:
    """Declaration for a single PII-bearing field in the adapter's manifest.

    CF-C3-PII-ADAPTER-GATE-1: the ingest primitive refuses to write a field
    flagged personal-data unless its lawful_basis + purpose_code are declared.
    """
    field_name: str
    lawful_basis: str      # e.g. "owner_brand_controller"
    purpose_code: str      # e.g. "analytics_performance"


# ---------------------------------------------------------------------------
# PiiManifest — the full per-adapter manifest checked by ingest_batch
# CF-C3-PII-ADAPTER-GATE-1 + CF-C3-CONSENT-COLUMN-1
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PiiManifest:
    """Per-adapter PII field declarations.

    Sugandh-Lok scope (per §5 of the architecture plan):
      Shopify:         email, first_name, last_name
      WooCommerce:     customer_email, customer_phone, billing_*, shipping_*
      Shiprocket:      delivery_pincode, delivery_city, delivery_state
      Klaviyo/Meta/Google: NO individual PII (aggregates only)

    The ingest primitive checks every NormalizedEvent column against this
    manifest before writing. An undeclared PII field causes a write refusal
    (fail-closed).
    """
    # default_lawful_basis and default_purpose_code apply to all non-PII fields
    default_lawful_basis: str = "owner_brand_controller"
    default_purpose_code: str = "analytics_performance"
    # Explicit PII declarations (field_name → spec)
    pii_fields: dict[str, PiiFieldSpec] = field(default_factory=dict)

    def is_pii(self, field_name: str) -> bool:
        """Return True if this field_name is declared as personal data."""
        return field_name in self.pii_fields

    def get_spec(self, field_name: str) -> Optional[PiiFieldSpec]:
        """Return the spec for a PII field, or None if not declared."""
        return self.pii_fields.get(field_name)


# ---------------------------------------------------------------------------
# ConnectorAdapter Protocol (P3) — locked signature per §A0.5
# ---------------------------------------------------------------------------


@runtime_checkable
class ConnectorAdapter(Protocol):
    """
    Protocol for all vendor connector adapters.

    Per-connector quirks (Shopify webhook vs Shiprocket poll vs Google
    refresh_token) are CONFIG behind this interface — NOT N bespoke paths.

    CF-C3-SINGLE-PRIMITIVE-1: ingest_batch (P2) consumes ANY ConnectorAdapter.
    """

    vendor: str
    """Vendor identifier, e.g. 'shopify', 'shiprocket', 'meta'."""

    pii_manifest: PiiManifest
    """Per-adapter PII field declarations (CF-C3-PII-ADAPTER-GATE-1)."""

    token_model: TokenModel
    """Which authentication model this vendor uses."""

    replay: ReplayCapability
    """How far back the vendor can replay events (critical for rollback planning)."""

    async def fetch(
        self,
        creds: Credential,
        window: IngestWindow,
    ) -> AsyncIterator[RawEvent]:
        """Fetch events from the vendor API for the given window.

        Yields RawEvent objects in the vendor's native shape. The framework
        calls this once per ingest_batch run; the adapter handles pagination.
        """
        ...

    def normalize(self, raw: RawEvent) -> NormalizedEvent:
        """Map a vendor-shape RawEvent to a NormalizedEvent for the raw store.

        MUST NOT perform money conversion — raw money fields pass through
        verbatim (strings or vendor decimals). Child-2 converts at the ACL.
        """
        ...

    def idempotency_key(self, raw: RawEvent) -> str:
        """Return the vendor-side idempotency key for this event.

        Used alongside (workspace_id, vendor) to form the UPSERT key:
        (workspace_id, vendor, vendor_event_id).
        """
        ...
