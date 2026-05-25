"""
Brain connector framework — domain layer.

Exports the PII manifest contract and cursor persistence contract
consumed by the P2 ingest_batch primitive (Track V, V4 seam).
"""
from .adapter import (
    TokenModel,
    ReplayCapability,
    IngestWindow,
    RawEvent,
    NormalizedEvent,
    Credential,
    PiiFieldSpec,
    PiiManifest,
    ConnectorAdapter,
)
from .pii_manifest import (
    PiiManifestViolation,
    check_pii_fields,
    SHOPIFY_MANIFEST,
    WOOCOMMERCE_MANIFEST,
    SHIPROCKET_MANIFEST,
    KLAVIYO_MANIFEST,
    META_MANIFEST,
    GOOGLE_MANIFEST,
    UNICOMMERCE_MANIFEST,
    MANIFEST_REGISTRY,
)
from .cursor import (
    CursorRow,
    GET_CURSOR_SQL,
    UPSERT_CURSOR_SQL,
    get_cursor,
    upsert_cursor,
)

__all__ = [
    # adapter.py types
    "TokenModel",
    "ReplayCapability",
    "IngestWindow",
    "RawEvent",
    "NormalizedEvent",
    "Credential",
    "PiiFieldSpec",
    "PiiManifest",
    "ConnectorAdapter",
    # pii_manifest.py
    "PiiManifestViolation",
    "check_pii_fields",
    "SHOPIFY_MANIFEST",
    "WOOCOMMERCE_MANIFEST",
    "SHIPROCKET_MANIFEST",
    "KLAVIYO_MANIFEST",
    "META_MANIFEST",
    "GOOGLE_MANIFEST",
    "UNICOMMERCE_MANIFEST",
    "MANIFEST_REGISTRY",
    # cursor.py
    "CursorRow",
    "GET_CURSOR_SQL",
    "UPSERT_CURSOR_SQL",
    "get_cursor",
    "upsert_cursor",
]
