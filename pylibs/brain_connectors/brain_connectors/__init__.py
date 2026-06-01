# brain_connectors — connector base ABC + provider implementations (spec: pylibs/brain_connectors).
# Each provider connector (Shopify, Meta, Google Ads, Shiprocket, Klaviyo, …) subclasses
# BaseConnector. Backfill == live (window only); idempotent UPSERT on payload hash.

from brain_connectors.connector_base import (
    BaseConnector,
    ConnectorRecord,
    ConnectorHealth,
)

__all__ = ["BaseConnector", "ConnectorRecord", "ConnectorHealth"]
