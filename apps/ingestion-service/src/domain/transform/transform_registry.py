"""
Transform mapper registry — (vendor, event_type) → mapper dispatch table.

@paradigm: sql
  Pure deterministic dispatch — no ML, no LLM, zero external I/O.
  A mapper translates a raw bronze payload into a typed SilverFact dict.
  Each mapper carries @paradigm("sql") because all field extraction is
  deterministic JSON-path + type-coercion (no model calls).

Single-Primitive rule (ADR-CONVERGENCE-001 §3):
  ONE registry, one mapper per (vendor, event_type).  Adding a new integration
  = add one registry entry + one mapper function — ZERO changes to the
  transform consumer or any existing mapper.  A grep for 'transform_consumer.py'
  in the diff of a new-vendor PR must be empty.

P1-B (data-warehouse-implementation-plan.md §B7 Task 2):
  The registry key is (vendor: str, event_type: str) — both lowercase-normalised.
  Each mapper is a pure function:

      mapper(raw_payload: dict) -> SilverFact | None

  None return means "this event type has no silver mapping" (not an error).
  Mapper errors (missing keys, type failures) propagate as exceptions — the
  caller (graduate_raw_event.py) routes them to the DLQ.

Amendment 2 (Rohan Stage-1):
  Shadow-mode shell: the registry is initialised at import time so the consumer
  loop can be started (and no-op) even when TRANSFORM_GRADUATION_WORKER=false.
  The registry itself is unconditionally importable.

Acceptance contract:
  (c) a new (vendor, event_type) is added by a registry entry + a mapper only —
      no consumer edit.  Verified by: diff of a new-vendor PR must not touch
      transform_consumer.py.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

#: Raw bronze payload dict (JSON-decoded from connector_raw_events.payload).
RawPayload = Dict[str, Any]

#: Silver fact dict — passed to the silver UPSERT in graduate_raw_event.py.
#: The dict keys must match the connector_order_facts / connector_*_facts columns.
SilverFact = Dict[str, Any]

#: Mapper function signature.
MapperFn = Callable[[RawPayload], Optional[SilverFact]]

#: Registry key: (vendor_upper, event_type_lower).
RegistryKey = Tuple[str, str]


# ---------------------------------------------------------------------------
# SilverFact dataclass for type safety
# ---------------------------------------------------------------------------

@dataclass
class MapperResult:
    """Result of a mapper call — includes the target silver table."""
    silver_table: str
    fact: SilverFact
    raw_event_id: str = ""
    provenance: str = "transform_worker"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class TransformRegistry:
    """
    Registry of (vendor, event_type) → mapper functions.

    Thread-safe for reads (the registry is built at import time and never
    mutated at runtime).  A mapper may raise any exception on malformed
    payloads — the caller routes exceptions to the DLQ.
    """

    def __init__(self) -> None:
        self._registry: dict[RegistryKey, tuple[str, MapperFn]] = {}

    def register(
        self,
        vendor: str,
        event_type: str,
        silver_table: str,
        mapper: MapperFn,
    ) -> None:
        """
        Register a mapper for (vendor, event_type).

        Args:
            vendor:       Vendor code (case-insensitive; stored uppercase).
            event_type:   Event type string (case-insensitive; stored lowercase).
            silver_table: Target silver table name (e.g. "connector_order_facts").
            mapper:       Pure function (RawPayload) → Optional[SilverFact].

        Raises:
            ValueError: if a mapper is already registered for this key.
        """
        key: RegistryKey = (vendor.upper(), event_type.lower())
        if key in self._registry:
            raise ValueError(
                f"TransformRegistry: duplicate mapper for {key!r}. "
                "Each (vendor, event_type) pair must have exactly one mapper "
                "(Single-Primitive Rule, ADR-CONVERGENCE-001 §3)."
            )
        self._registry[key] = (silver_table, mapper)
        logger.debug(
            "transform_registry: registered mapper vendor=%r event_type=%r table=%r",
            vendor, event_type, silver_table,
        )

    def get(
        self, vendor: str, event_type: str
    ) -> Optional[tuple[str, MapperFn]]:
        """
        Look up the (silver_table, mapper) for (vendor, event_type).

        Returns None if no mapper is registered — the caller treats this as
        "no silver mapping for this event type" (skip, do NOT DLQ).
        """
        key: RegistryKey = (vendor.upper(), event_type.lower())
        return self._registry.get(key)

    def dispatch(
        self,
        vendor: str,
        event_type: str,
        raw_payload: RawPayload,
        raw_event_id: str = "",
    ) -> Optional[MapperResult]:
        """
        Dispatch a raw payload through the registered mapper.

        Returns:
            MapperResult if a mapper exists and returns a non-None SilverFact.
            None if no mapper is registered or the mapper returns None
            (event type has no silver mapping — skip without error).

        Raises:
            Any exception the mapper raises (KeyError, ValueError, TypeError …)
            — the caller routes these to the DLQ.
        """
        entry = self.get(vendor, event_type)
        if entry is None:
            logger.debug(
                "transform_registry: no mapper for vendor=%r event_type=%r — skip",
                vendor, event_type,
            )
            return None

        silver_table, mapper_fn = entry
        fact = mapper_fn(raw_payload)
        if fact is None:
            return None

        return MapperResult(
            silver_table=silver_table,
            fact=fact,
            raw_event_id=raw_event_id,
            provenance="transform_worker",
        )

    @property
    def registered_keys(self) -> list[RegistryKey]:
        """Return all registered (vendor, event_type) keys (for tests/introspection)."""
        return list(self._registry.keys())

    def __len__(self) -> int:
        return len(self._registry)


# ---------------------------------------------------------------------------
# Global registry singleton (built at import time)
# ---------------------------------------------------------------------------

#: The global registry.  Import this and call .register(...) in mapper modules.
_REGISTRY = TransformRegistry()


def get_registry() -> TransformRegistry:
    """Return the global TransformRegistry singleton."""
    return _REGISTRY


# ---------------------------------------------------------------------------
# Shopify order mapper (the canonical first mapper — integration #1)
# ---------------------------------------------------------------------------

def _shopify_order_mapper(raw: RawPayload) -> Optional[SilverFact]:
    """
    Map a Shopify order raw payload to a connector_order_facts silver dict.

    @paradigm: sql — deterministic JSON-path extraction, no ML, no LLM.

    The Shopify order payload is already normalized through the ShopifyAdapter
    and PII-tokenized (P0-B), so `customer_ref` is already a HMAC token.
    Money fields: the adapter normalizes to minor units (paise) — no conversion here.

    Required payload keys (adapter contract):
        vendor_order_id, processed_at, currency_code, gross_sales_mu,
        total_discount_mu, total_tax_mu, shipping_mu.

    Optional:
        customer_ref, financial_status, fulfillment_status, payment_method,
        is_cod, order_type, delivery_pincode, delivery_city, cancelled_at,
        total_refund_mu, order_number.

    Returns None if vendor_order_id is missing (cannot form the unique key).
    """
    vendor_order_id = raw.get("vendor_order_id") or raw.get("id")
    if not vendor_order_id:
        return None

    processed_at = raw.get("processed_at") or raw.get("created_at")

    return {
        "workspace_id": raw.get("workspace_id", ""),
        "vendor": "SHOPIFY",
        "vendor_order_id": str(vendor_order_id),
        "order_number": raw.get("order_number", ""),
        "financial_status": raw.get("financial_status", ""),
        "fulfillment_status": raw.get("fulfillment_status", ""),
        "payment_method": raw.get("payment_method", ""),
        "currency_code": raw.get("currency_code", "INR"),
        "gross_sales_mu": int(raw.get("gross_sales_mu", 0)),
        "total_discount_mu": int(raw.get("total_discount_mu", 0)),
        "total_tax_mu": int(raw.get("total_tax_mu", 0)),
        "shipping_mu": int(raw.get("shipping_mu", 0)),
        "customer_ref": raw.get("customer_ref", ""),
        "is_new_customer": bool(raw.get("is_new_customer", False)),
        "delivery_pincode": raw.get("delivery_pincode", ""),
        "delivery_city": raw.get("delivery_city", ""),
        "processed_at": processed_at,
        "cancelled_at": raw.get("cancelled_at"),
        "is_cod": bool(raw.get("is_cod", False)),
        "order_type": raw.get("order_type", ""),
        "total_refund_mu": int(raw.get("total_refund_mu", 0)),
        # provenance + raw_event_id added by the caller (MapperResult)
    }


# Register Shopify order mapper at import time.
_REGISTRY.register(
    vendor="SHOPIFY",
    event_type="orders/create",
    silver_table="connector_order_facts",
    mapper=_shopify_order_mapper,
)

# Also handle the "order" variant (used in some adapter normalisations).
_REGISTRY.register(
    vendor="SHOPIFY",
    event_type="order",
    silver_table="connector_order_facts",
    mapper=_shopify_order_mapper,
)
