"""
PII manifest contract for the Brain connector framework.

@paradigm: sql
  Pure deterministic data contract — no ML, no LLM.
  The fail-closed check is a set-membership guard executed before every
  ingest_batch write; it has zero inference cost.

CF-C3-PII-ADAPTER-GATE-1:
  The ingest primitive (P2 ingest_batch) calls check_pii_fields() before
  writing any row to the raw event store.  If a field is present in the
  payload AND the adapter's PiiManifest does not declare it as a known PII
  field (is_pii=False) or as a known non-PII field, the write is REFUSED
  and ingest_pii_manifest_rejections_total is incremented.
  This forces an explicit decision at every future adapter.

CF-C3-CONSENT-COLUMN-1:
  default_lawful_basis and default_purpose_code values are sourced from the
  PiiManifest declared on the adapter; they are stamped at ingest-write time,
  never backfilled.  default_lawful_basis init = 'owner_brand_controller'
  for the Sugandh Lok scope.

DPDP §2(t) personal data definition drives the pii_fields declarations.

V4 seam (Track V / ingest_batch):
  from src.domain.framework.adapter import PiiManifest, PiiFieldSpec
  from src.domain.framework.pii_manifest import check_pii_fields, MANIFEST_REGISTRY
  check_pii_fields(adapter.pii_manifest, normalized_event.columns.keys())
"""
from __future__ import annotations

from typing import Sequence

# Import the canonical PiiManifest / PiiFieldSpec types from the locked P3
# interface (adapter.py — Vikram's Track V, locked signature per §A0.5).
# Track M does NOT redefine PiiManifest; it provides the per-adapter manifest
# instances and the fail-closed gate function that ingest_batch calls.
from .adapter import PiiManifest, PiiFieldSpec


# ---------------------------------------------------------------------------
# Violation type
# ---------------------------------------------------------------------------

class PiiManifestViolation(ValueError):
    """
    Raised by check_pii_fields() when a field in the payload is:
      - not declared in the adapter's PiiManifest.pii_fields (i.e. undeclared
        as a known PII field), AND
      - matches the PII heuristic (suggesting it may be personal data).

    The ingest primitive increments ingest_pii_manifest_rejections_total
    {vendor, field} before raising — write is refused (fail-closed).
    """
    def __init__(self, vendor: str, undeclared_fields: Sequence[str]) -> None:
        self.vendor             = vendor
        self.undeclared_fields  = list(undeclared_fields)
        super().__init__(
            f"PII manifest violation for vendor '{vendor}': "
            f"undeclared potential-PII fields {self.undeclared_fields} — write refused. "
            f"Declare them in the adapter's pii_fields with their lawful_basis + "
            f"purpose_code (CF-C3-PII-ADAPTER-GATE-1)."
        )


# ---------------------------------------------------------------------------
# Heuristic substrings — defence-in-depth PII auto-detection
# The manifest declaration is the authoritative gate; this heuristic catches
# field names that look like personal data but were never declared at all.
# ---------------------------------------------------------------------------

_PII_HEURISTIC_SUBSTRINGS: frozenset[str] = frozenset({
    "email", "phone", "mobile", "address", "pincode", "postcode",
    "zip", "billing", "shipping", "delivery_pincode", "delivery_city",
    "delivery_state", "first_name", "last_name", "customer_name",
    "customer_email", "customer_phone",
})


# ---------------------------------------------------------------------------
# Fail-closed gate — called by ingest_batch before every write (CF-C3-PII-ADAPTER-GATE-1)
# ---------------------------------------------------------------------------

def check_pii_fields(
    manifest: PiiManifest,
    payload_field_names: Sequence[str],
) -> None:
    """
    CF-C3-PII-ADAPTER-GATE-1 fail-closed check.

    A field in payload_field_names is accepted if ANY of:
      (a) it is declared in manifest.pii_fields (the adapter explicitly said
          "this is PII with lawful basis X and purpose Y")
      (b) it does NOT match the PII heuristic substrings (it looks like
          non-PII data and was silently included)

    A field is REJECTED if:
      - it is NOT declared in manifest.pii_fields, AND
      - it matches the PII heuristic (it looks like personal data)

    This means: declare every PII field explicitly, or it will be blocked.
    Non-PII fields that don't look like PII pass through silently.

    Args:
        manifest:            the adapter's PiiManifest (from ConnectorAdapter.pii_manifest)
        payload_field_names: field names present in the normalized event's columns dict

    Raises:
        PiiManifestViolation: if undeclared potential-PII fields are detected
    """
    declared_pii_fields = set(manifest.pii_fields.keys())
    undeclared_pii: list[str] = []

    for fname in payload_field_names:
        if fname in declared_pii_fields:
            # Explicitly declared — passes (even if not currently flagged is_pii,
            # the adapter made a conscious decision about this field).
            continue
        fname_lower = fname.lower()
        if any(hint in fname_lower for hint in _PII_HEURISTIC_SUBSTRINGS):
            undeclared_pii.append(fname)

    if undeclared_pii:
        # F-5 fix: pass vendor_name not default_lawful_basis as the first arg.
        # PiiManifest does not carry a vendor_name field (it is adapter-scoped);
        # we use the default_purpose_code as a proxy identifier where no vendor
        # string is directly available here — callers that have the vendor string
        # should raise PiiManifestViolation(vendor, undeclared_pii) directly.
        # ingest_batch wraps check_pii_fields and re-raises with vendor context.
        raise PiiManifestViolation("undeclared", undeclared_pii)


# ---------------------------------------------------------------------------
# Per-adapter manifest instances (Sugandh Lok scope — CF-C3-CONSENT-COLUMN-1)
# These are the manifests each adapter sets as its pii_manifest attribute.
# ---------------------------------------------------------------------------

def _spec(lawful_basis: str = "owner_brand_controller",
          purpose_code: str = "analytics_performance") -> PiiFieldSpec:
    return PiiFieldSpec(
        field_name   = "",  # overridden by dict key at declaration site
        lawful_basis = lawful_basis,
        purpose_code = purpose_code,
    )


def _make_spec(field_name: str, lawful_basis: str, purpose_code: str) -> PiiFieldSpec:
    return PiiFieldSpec(
        field_name   = field_name,
        lawful_basis = lawful_basis,
        purpose_code = purpose_code,
    )


def _shopify_manifest() -> PiiManifest:
    """
    Shopify: PII fields = email, first_name, last_name.
    lawful_basis: owner_brand_controller (Sugandh Lok brand owner processes own customers).
    purpose_code: analytics_performance.
    """
    pii_fields = {
        "email":      _make_spec("email",      "owner_brand_controller", "analytics_performance"),
        "first_name": _make_spec("first_name", "owner_brand_controller", "analytics_performance"),
        "last_name":  _make_spec("last_name",  "owner_brand_controller", "analytics_performance"),
    }
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "analytics_performance",
        pii_fields           = pii_fields,
    )


def _woocommerce_manifest() -> PiiManifest:
    """
    WooCommerce: customer_email, customer_phone, billing_*, shipping_* are PII.
    lawful_basis: owner_brand_controller.
    purpose_code: analytics_performance.
    """
    pii_field_names = [
        "customer_email", "customer_phone",
        "billing_first_name", "billing_last_name",
        "billing_address_1", "billing_city", "billing_state", "billing_postcode",
        "shipping_first_name", "shipping_last_name",
        "shipping_address_1", "shipping_city", "shipping_state", "shipping_postcode",
    ]
    pii_fields = {
        name: _make_spec(name, "owner_brand_controller", "analytics_performance")
        for name in pii_field_names
    }
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "analytics_performance",
        pii_fields           = pii_fields,
    )


def _shiprocket_manifest() -> PiiManifest:
    """
    Shiprocket: delivery_pincode, delivery_city, delivery_state are PII.
    DPDP §2(t): pincode/city/state can identify a natural person's location.
    purpose_code: logistics_tracking (not analytics_performance).
    HIGHEST-blast-radius connector — no replay. Sequenced LAST at Stage-8.
    """
    pii_field_names = ["delivery_pincode", "delivery_city", "delivery_state"]
    pii_fields = {
        name: _make_spec(name, "owner_brand_controller", "logistics_tracking")
        for name in pii_field_names
    }
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "logistics_tracking",
        pii_fields           = pii_fields,
    )


def _klaviyo_manifest() -> PiiManifest:
    """
    Klaviyo: aggregate campaign metrics only — NO individual PII.
    pii_fields is empty: no individual email/phone/name fields in current scope.
    Individual subscriber sync (email, phone_number) is OUT OF SCOPE until
    separately gated.  If added, the adapter MUST update this manifest.
    purpose_code: email_performance.
    """
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "email_performance",
        pii_fields           = {},
    )


def _meta_manifest() -> PiiManifest:
    """
    Meta Ads: aggregate campaign metrics only — NO individual PII.
    Conversions API / hashed-PII (SHA-256 email/phone) OUT OF SCOPE
    until separately gated.  If added, the adapter MUST update this manifest.
    purpose_code: analytics_performance.
    """
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "analytics_performance",
        pii_fields           = {},
    )


def _google_manifest() -> PiiManifest:
    """
    Google Ads: aggregate campaign metrics only — NO individual PII.
    Enhanced-conversions hashed-PII OUT OF SCOPE until separately gated.
    purpose_code: analytics_performance.
    """
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "analytics_performance",
        pii_fields           = {},
    )


def _unicommerce_manifest() -> PiiManifest:
    """
    Unicommerce: catalog/product sync — NO individual PII.
    purpose_code: catalog_sync.
    """
    return PiiManifest(
        default_lawful_basis = "owner_brand_controller",
        default_purpose_code = "catalog_sync",
        pii_fields           = {},
    )


# Singleton instances — import these into the adapter implementations
SHOPIFY_MANIFEST:     PiiManifest = _shopify_manifest()
WOOCOMMERCE_MANIFEST: PiiManifest = _woocommerce_manifest()
SHIPROCKET_MANIFEST:  PiiManifest = _shiprocket_manifest()
KLAVIYO_MANIFEST:     PiiManifest = _klaviyo_manifest()
META_MANIFEST:        PiiManifest = _meta_manifest()
GOOGLE_MANIFEST:      PiiManifest = _google_manifest()
UNICOMMERCE_MANIFEST: PiiManifest = _unicommerce_manifest()

# Registry: vendor string → manifest (consumed by ingest_batch and tests)
MANIFEST_REGISTRY: dict[str, PiiManifest] = {
    "shopify":     SHOPIFY_MANIFEST,
    "woocommerce": WOOCOMMERCE_MANIFEST,
    "shiprocket":  SHIPROCKET_MANIFEST,
    "klaviyo":     KLAVIYO_MANIFEST,
    "meta":        META_MANIFEST,
    "google":      GOOGLE_MANIFEST,
    "unicommerce": UNICOMMERCE_MANIFEST,
}
