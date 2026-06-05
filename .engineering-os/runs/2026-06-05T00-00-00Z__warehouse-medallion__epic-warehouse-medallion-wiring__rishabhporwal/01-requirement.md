# Requirement — epic-warehouse-medallion-wiring

| Field | Value |
|-------|-------|
| **req_id** | `epic-warehouse-medallion-wiring` |
| **Author** | rishabhporwal (Founder) |
| **Date** | 2026-06-05 |
| **Source** | Founder-authorized epic opening; architecture produced by a 28-agent review→research→brainstorm→judge→completeness workflow |

## Goal

Wire Brain's designed-but-uncalled 100+ integration data warehouse.

The bronze table (`brain.connector_raw_events`, migration `0010`), the durable PG transform cursor (migration `28`), the idempotent ReplacingMergeTree sinks, and the medallion-shaped flow are all correct and committed — they have **zero application callers** today. The 100-integration vision fails not on the model but on six unwired seams (G1–G6).

The spine is **Medallion-on-ClickHouse (CH + PG only, no new heavy infra)** — wire what is designed; do not re-found it.

## Problem statement

A vendor event cannot flow `vendor → bronze → silver → gold → KPIs / Morning Brief / %-of-GMV billing` end-to-end today. Both ingest paths are lossy or Shopify-only. No PII tokenization exists at the chokepoint. Bronze has no writer, no `customer_ref` column, no bounded erasure path. The transform worker (the keystone) does not exist. Silver metrics (CM2/CM3) are provably wrong on live data (shipment inputs hard-coded to 0). DPDP erasure has no orchestrator. Vendor is a 3-value ENUM that blocks Shiprocket/Woo/Klaviyo today.

## Success metrics

- A non-Shopify vendor added by a registry row + mapper only (no new code path) flows end-to-end.
- A subject-erasure request produces a COUNT=0 artifact across all five tiers with the per-subject DEK destroyed.
- A mapper bug is fixed by resetting the transform cursor and re-deriving silver from bronze (no hand-patch).
- CM2 and CM3 are non-zero and correct on seed with shipment data.
- All B9 CI gates are green.

## Relationship to existing work

- **Extends** `docs/adr-convergence-001-schema-100-integrations.md` — does NOT contradict its rulings A–J, 1–5.
- **Relates to** `chore-migrate-legacy-to-brain` (master strangler epic; shares the medallion target architecture).
- **Relates to** `epic-phase2-feature-parity` (gold layer feeds the feature-parity surfaces).
- **Relates to** `feat-connector-data-ingestion` (consumes the ingestion seam; the bronze writer closes its open gap).
- **Relates to** `feat-realtime-ingestion` (the realtime-facts-consumer path is the proven Shopify path preserved during cutover).

## Locked intake assumptions (Q1–Q7, Founder-confirmed 2026-06-05)

| # | Decision | Locked default |
|---|---|---|
| Q1 | MSK graduation / Debezium timing | Hold Debezium + MSK tiered storage to Phase-2 `TECH/00` trigger. Phase-0/1 runs single-broker/MSK-Serverless. |
| Q2 | Iceberg second-reader | No named reader for 12 months; CH-only + S3 archive is correct. |
| Q3 | ADR-J archetypes | Do not build now; bronze accommodates any vendor class as raw JSON. |
| Q4 | SDF localization | Default ap-south-1 residency assert at CDK synth is sufficient. |
| Q5 | Crypto-shred §12 acceptance | Accept key-destruction + COUNT=0 artifact + WORM ledger as §12 evidence. |
| Q6 | Pre-bronze historical provenance | Option (a): mark legacy facts `provenance='legacy_etl'`, `raw_event_id=NULL`; opportunistic Shopify/Woo bronze synthesis. |
| Q7 | Glue Registry defer | Hold to integration #5 / 2nd-consumer trigger; codegen'd envelope + DLQ + mapper JSON-schema validation is the interim contract boundary. |

## Scope

**IN (this epic):** 11 vertical slices — P0-A, P0-B, P0-C, P0-D, P0-R6, P1-A, P1-B, P1-C, P1-D, P1-E, P1-F. See `docs/data-warehouse-implementation-plan.md` Part B for full task breakdown.

**OUT (trigger-gated):** Iceberg/open-format, MSK tiered storage + Debezium, Glue Schema Registry + Avro, probabilistic identity (Splink), ADR-J archetypes.

## DPDP hard gates (non-negotiable, block go-live)

1. PII tokenizer at the ingest chokepoint (R1, P0-B)
2. Bronze `customer_ref` column (R3, P0-B)
3. Erasure orchestrator (R2, P0-D)
4. WooCommerce full-address removal (blocks Stage-8)
