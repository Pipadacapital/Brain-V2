"""brain_clickhouse — ClickHouse query-gateway primitive.

Layer-4 of the 4-layer workspace_id tenancy enforcement.
See docs/conventions/multi-tenancy.md and docs/conventions/data-model.md.

P1-A (epic-warehouse-medallion-wiring, rulings E,5):
    Auto-appends FINAL to every read over ReplacingMergeTree fact tables and
    auto-injects PREWHERE workspace_id as the first predicate.

    The gateway is the SINGLE entry-point for all CH fact reads in analytics
    and intelligence services. A query that bypasses it:
      - May return duplicate rows (missing FINAL on RMT dedup pass)
      - May miss the workspace partition prune (missing PREWHERE workspace_id)
      - Will fail the C2-FINAL conformance gate

@paradigm: sql
Cost-routing: zero LLM tokens; all operations are SQL / driver I/O.
"""

from brain_clickhouse.gateway import (
    BrainClickHouseGateway,
    GatewayConfig,
    UnscopedQueryError,
    make_default_gateway,
)

__all__ = [
    "BrainClickHouseGateway",
    "GatewayConfig",
    "UnscopedQueryError",
    "make_default_gateway",
]
