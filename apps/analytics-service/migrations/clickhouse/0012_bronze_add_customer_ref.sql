-- @paradigm: sql
-- 0012 — Bronze: add customer_ref, lawful_basis, purpose_code columns (P0-B DPDP GATE)
--
-- R3 / R8 from data-warehouse-architecture-proposal.md:
--   customer_ref:  bounded per-subject erasure (ALTER DELETE keyed on customer_ref,
--                  not an O(workspace_rows) full scan).  Populated by the PII
--                  tokenizer (ingest.py / webhook_intake.py) from the HMAC token
--                  of the normalized email or vendor customer ID.
--   lawful_basis:  carried from the Kafka envelope (ingest.py:361) so a DPDP §6
--                  purpose-compliance audit is a column filter, not a JSONB grep.
--   purpose_code:  same — column filter on LowCardinality is near-free in CH.
--
-- Migration safety:
--   - ADD COLUMN … DEFAULT '' is additive and nullable-safe.  Historical rows
--     written before this migration get the empty string default; they remain
--     queryable and no existing SELECT breaks.
--   - Reversible via down.sql (DROP COLUMN ×3).
--   - LowCardinality is near-free on storage; allows column-level index scan.
--
-- Applied: manually at the bronze-writer slice (P0-C) — NOT auto-applied.
-- Bronze cannot be green-lit without this migration.

ALTER TABLE brain.connector_raw_events
    ADD COLUMN IF NOT EXISTS customer_ref  String                    DEFAULT '',
    ADD COLUMN IF NOT EXISTS lawful_basis  LowCardinality(String)    DEFAULT '',
    ADD COLUMN IF NOT EXISTS purpose_code  LowCardinality(String)    DEFAULT '';

-- Add a secondary index on customer_ref to make the erasure DELETE partition-
-- and-key scoped rather than a full-table scan.
-- The table is already PARTITION BY toYYYYMM(received_at); this index narrows
-- within each partition.
ALTER TABLE brain.connector_raw_events
    ADD INDEX IF NOT EXISTS idx_customer_ref (customer_ref) TYPE bloom_filter(0.01) GRANULARITY 4;
