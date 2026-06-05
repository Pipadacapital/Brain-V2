# Data-Warehouse Implementation Plan — 100+ Integrations (Medallion-on-ClickHouse)

**Author:** Aryan (Architect) · **Date:** 2026-06-05 · **Status:** PLAN (pre-build; no code, no commits)
**Executes:** `docs/data-warehouse-architecture-proposal.md` (target arch + R1–R12) and extends `docs/adr-convergence-001-schema-100-integrations.md` (rulings A–J, 1–5).
**Does NOT re-derive architecture.** Where the proposal already fixed a contract (R1–R12, ADRs 1–8), this doc turns it into ordered, verifiable tasks. A developer can start P0-A from this doc alone.

---

# PART A — REPORT (executive)

## A1. Where we are today (verified)

The medallion warehouse Brain needs is **designed and committed, with zero application callers** — the G1 finding holds on the live tree:

- **Bronze has no writer.** `apps/analytics-service/migrations/clickhouse/0010_connector_raw_events.sql` defines `brain.connector_raw_events` (append-only MergeTree, `PARTITION BY toYYYYMM(received_at)`, ORDER BY `(workspace_id, vendor, event_type, idempotency_key, received_at)`) but nothing in the tree inserts into it. The transform cursor it references (`apps/core-service/migrations/local-dev/28-raw-event-transform-cursor.sql`, `public.raw_event_transform_state`) exists; `grep -r "transform_state|graduation" apps/ingestion-service/src` returns nothing — **no transform worker exists** (R5).
- **Both ingest paths are lossy / Shopify-shaped.**
  - The pull-sync (`apps/core-service/src/application/contexts/connectors/sync/sync-use-cases.ts:212-215`) writes typed facts **directly** via `upsertOrder/upsertLineItem/upsertProduct/upsertAdSpend` — the vendor JSON payload is normalized through ACL and **discarded**; nothing lands in bronze. Vendor branching is hardcoded (`:190-208` `if SHOPIFY / META / GOOGLE`).
  - The realtime consumer (`apps/api-gateway/src/infrastructure/realtime-facts-consumer.ts:375`) is hardwired `TOPIC = 'integrations.shopify.v1'`, `GROUP_ID = 'brain-facts-consumer'`, and writes CH facts directly with zeroed `cogs_mu/discount_mu/tax_mu` (`:361-363`). It is the **proven** Shopify webhook→facts path and must survive cutover.
- **PII is in the clear on the wire.** `ingest.py:360` builds the envelope with `"payload": json.dumps(event.columns)…` — raw `event.columns`, including every field the adapter's `pii_manifest` declares. `pii_manifest.py` (`apps/ingestion-service/src/domain/framework/pii_manifest.py`) only *checks* a manifest; it does not redact. No tokenizer, no salted hash, no KMS write exists (R1).
- **Bronze cannot bound erasure.** `0010` has no `customer_ref` / `lawful_basis` / `purpose_code` columns; `_produce_kafka` carries `lawful_basis`/`purpose_code` in the envelope only (`ingest.py:361-362`), so DPDP purpose-audit would be a TB-scale JSON scan (R3, R8).
- **Vendor is a 3-value ENUM.** `03-schema-connectors.sql:25` `CREATE TYPE connector_vendor AS ENUM ('SHOPIFY','META','GOOGLE')` — Shiprocket/Woo/Klaviyo/Unicommerce cannot be a data row; `phase5-legacy-facts-to-pg.sql` already casts `'SHIPROCKET'::connector_vendor` which will fail (R6).
- **Metric inputs are stubbed.** `recompute_daily.py:44-50` declares RTO/total_shipments, misc_expenses, sessions all `0 for now`; identity hash is bare unsalted `sha256(...).slice(0,32)` (`acl.ts:175`).

**What "end-to-end application" means here:** a vendor event flows `vendor → bronze (CH + S3, PII-tokenized) → silver (typed facts, raw_event_id + identity_cluster_id) → gold (recompute_daily + MVs) → KPIs / Morning Brief / %-of-GMV billing`, and is **replayable** (fix a mapper → reset the transform cursor → re-derive silver from bronze, never hand-patch CH) and **erasable** (one subject key → COUNT=0 across every tier). Today none of that is wired end-to-end.

## A2. The decision being executed (one paragraph)

**Wire the warehouse Brain already designed; do not re-found it.** The spine is **Medallion-on-ClickHouse (CH + PG only)**: bronze = a Kafka raw-archiver consumer group (single writer of `connector_raw_events` + S3 archive); a transform-graduation worker (the keystone) reads bronze off the PG migration-28 cursor and idempotently UPSERTs silver; identity stitching (deterministic salted hash + MIN-label union-find) lives in core-service; gold (recompute_daily + MVs) reads silver unchanged. **Adopted now:** S3 raw archive (Phase-1 durable copy), DLQ topic, fail-closed mappers, ingest-time PII tokenizer, `customer_ref`/consent columns on bronze, erasure orchestrator, vendor ENUM→TEXT+FK, `@paradigm` decorator wiring, CH query gateway. **Trigger-deferred:** Glue Schema Registry + Avro + BACKWARD CI gate (R4 trigger: integration #5 or 2nd consumer), MSK tiered storage + Debezium (`TECH/00` MSK graduation), Iceberg/open-format (named second-reader trigger), probabilistic/household identity, ADR-J archetypes (Founder product scope).

## A3. Scope IN / scope OUT

**IN (this build):** bronze raw-archiver consumer + S3 `BronzeStorageStack`; transform-graduation worker + `(vendor,event_type)→mapper` registry; PII tokenizer chokepoint + per-workspace versioned salt; `customer_ref`/`lawful_basis`/`purpose_code` on bronze (`0011`); erasure orchestrator (PG + CH + S3 crypto-shred + Kafka note + COUNT=0); vendor ENUM→TEXT+FK + `connector_vendors` registry; `email_hash`/`phone_hash`/`identity_cluster_id` + union-find stitcher + per-workspace salt; wire `recompute_daily` deferred inputs (shipment / misc_expenses / vendor_product_id); `@paradigm` decorator + CI gate; CH query gateway (`brain_clickhouse` stub → real); DLQ topic; full-column parity hardening of the existing drift gate; PII catalog YAML; WooCommerce full-address removal.

**OUT (trigger-gated, explicitly NOT built now):**
- **Iceberg / S3-as-source-of-truth / Glue catalog / compaction** — trigger: a named second reader (external BI/Trino, ML feature store, regulator export, CH-lock-in hedge). S3 archive is workspace-prefixed compressed JSON, *not* an Iceberg lake.
- **MSK tiered storage + Debezium (PG→Kafka outbox)** — trigger: `TECH/00` MSK graduation. Holding Debezium protects the Postgres primary (WAL-slot outage risk) for a small team.
- **Glue Schema Registry + Avro serializer + BACKWARD CI gate** — trigger: integration #5 OR first 2nd independent consumer of `integrations.<vendor>.v1` (R4). Interim contract = codegen'd envelope + transform-mapper JSON-schema validation → DLQ.
- **Probabilistic (Splink) + household identity linkage** — opt-in, separately-scored, reversible; one false-positive edge over-merges permanently.
- **ADR-J India archetypes** (settlement / marketplace-fee / returns-first-class / inventory-ledger / COD-remittance) — Founder product-scope.

## A4. DPDP hard gates (non-negotiable; block go-live)

No live anchor-customer PII may enter the warehouse until **all three** are green:

1. **PII tokenizer at the ingest chokepoint** (R1, P0-B) — no field named in any adapter `pii_manifest` appears un-tokenized in the bytes `_produce_kafka` emits; plaintext lands only in `customer_pii._ct`.
2. **Bronze `customer_ref` column** (R3, P0-B) — erasure is a bounded key-level delete, not an `O(workspace_rows)` scan.
3. **Erasure orchestrator** (R2, reclassified **P0-D**) — five-tier ladder with a `COUNT=0` verification artifact, before any live customer data lands.

Plus the **WooCommerce full-address removal** gate (`step-a-enable-create.sql:243,249` `billing_address_1`/`shipping_address_1`) blocks Stage-8.

## A5. Founder decision-dependencies (proposal §9 + R12) — recommended defaults

The plan is **executable under these defaults without waiting**. If the Founder rules otherwise, the delta is noted.

> ✅ **FOUNDER-CONFIRMED 2026-06-05.** All seven recommended defaults (Q1–Q7) are accepted as locked decisions for this epic. The "otherwise" column is retained only as the documented change-path if a future trigger fires. These are now the binding assumptions the build executes under.

| # | Decision | RECOMMENDED DEFAULT | If Founder chooses otherwise |
|---|---|---|---|
| Q1 | MSK graduation / Debezium timing | **Hold Debezium + MSK tiered storage to Phase-2 `TECH/00` trigger.** Phase-0/1 runs single-broker/MSK-Serverless. | If pulled forward: add a P2 slice for a PG→Kafka outbox + MSK Connect; **do not** stand up WAL slots without platform headroom. No P0/P1 slice changes. |
| Q2 | Iceberg second-reader | **No named reader for 12 months → CH-only + S3 archive is correct.** | If a reader is named: S3 archive prefixes (`{ws}/{vendor}/{y}/{m}/{d}/`) become an Iceberg landing + Glue catalog (additive, no silver/gold change). |
| Q3 | ADR-J archetypes | **Do not build now;** bronze accommodates any vendor class as raw JSON regardless. | If in scope: add archetype rows to `connector_vendors` (already TEXT after P0/R6) + per-archetype silver mappers; no spine change. |
| Q4 | SDF localization | **Default ap-south-1 residency assert at CDK synth is sufficient.** | If SDF thresholds cross: cold-tier localization hardens from default to mandate (annual DPIA/DPO); S3 region posture already pinned, so it is an audit-process add, not a re-architecture. |
| Q5 | Crypto-shred §12 acceptance | **Accept key-destruction + COUNT=0 artifact + WORM ledger as §12 evidence** (PII-light bronze bounds the contested surface). | If physical-delete-only required: cold tier swaps crypto-shred for object-level delete + rewrite (slower/costlier); only the S3 tier of the erasure ladder changes. |
| Q6 | Pre-bronze historical provenance (R12) | **Option (a): mark legacy facts `provenance='legacy_etl'`, `raw_event_id=NULL`; opportunistic Shopify/Woo bronze synthesis** where raw payload survives. | If full re-pull funded: bounded by each adapter's `ReplayCapability` (`adapter.py:46` — Shopify `FULL_60D`; Meta/Google `WINDOW`, so >window history unrecoverable regardless). Adds a backfill slice; default ships without it. |
| Q7 | Glue Registry defer (R4) | **Hold to integration #5 / 2nd-consumer trigger;** codegen'd envelope + DLQ + mapper JSON-schema validation is the interim contract boundary. | If a 2nd consumer is already roadmapped: pull the Registry slice into P1 (multi-week build); spine unchanged. |

---

# PART B — IMPLEMENTATION PLAN

## B6. Guiding principles for this build

1. **Vertical slices.** Each slice delivers a wired, demonstrable increment (not a horizontal layer).
2. **Everything behind feature flags.** Reuse the existing `REALTIME_FACTS_CONSUMER` and `BRAIN_WEBHOOKS_ENABLED` (both real — `apps/api-gateway/src/infrastructure/realtime-facts-consumer.ts`, `interfaces/server.ts`). New flags: `BRONZE_RAW_ARCHIVER`, `TRANSFORM_GRADUATION_WORKER`, `PII_TOKENIZER`, `IDENTITY_STITCHER`, `ERASURE_ORCHESTRATOR`. Default OFF; flip per the B10 cutover order.
3. **Preserve the proven Shopify path during cutover.** The bespoke `integrations.shopify.v1` → CH-facts consumer keeps running until the generic transform worker is shadow-verified at parity; only then is it retired.
4. **Reversible per slice.** Every migration ships a `down.sql`; every flag has a documented rollback recipe.
5. **Verify-before-done.** Each task names an exact command/assertion. No slice is "done" without its acceptance criteria green.
6. **No commit/merge without explicit Founder "commit it."** Feature branch `feature/<req-id>` off `development`; agents never push to development/release/master.
7. **TS↔Python metric parity stays green** (`tests/conformance/check_fact_schema_drift.py`; `apps/analytics-service/tests/test_recompute_daily.py`).
8. **Legacy stays reference-only** — never write/commit into `legacy project/`.

## B7. Phased slice plan

> Owners: **@maya** (ingestion/analytics Py), **@vikram** (core-service TS), **@jatin** (platform/CDK/IaC), **@ananya** (web), **@karan** (mobile). Task format: `path` · action · **verify**.

---

### P0 — correctness + DPDP gates

---

#### P0-A — ADR triage + full-column drift gate · closes G3,G5 · @maya (+@vikram on parity)
**Goal:** land the ADR-CONVERGENCE-001 P0 correctness fixes and harden the existing drift gate to full-column parity before any new wiring.
**Why now:** these are provably-wrong-on-live-data bugs (net_sales double-tax) and the structural backstop the codegen will later replace; everything downstream assumes these are green.

Tasks:
1. `apps/analytics-service/migrations/clickhouse/phase8-ch-backfill.sql` (~:37) · drop `- total_tax_mu` from `net_sales` (ruling A); bump RMT `version` → `toUnixTimestamp64Milli` · **verify** rerun the ORDER backfill step only; assert `net_sales_mu = gross − discount − returns` on a seed workspace.
2. `apps/analytics-service/migrations/clickhouse/0010_connector_raw_events.sql` · confirm append-only MergeTree, no `transform_status` (ruling B — already correct; assert in a test) · **verify** `grep -c transform_status 0010_*.sql` == 0.
3. core-service migration (new `30-status-gated-purge.sql`) · status-gated nightly PII purge `WHERE status NOT IN (open,unfulfilled,disputed,partial)` + dead-letter 0-row webhook updates (ruling C) · **verify** unit test: a disputed COD order survives purge; a closed order's PII is nulled.
4. `docs/schema/canonical-facts.yaml` + `tests/conformance/check_fact_schema_drift.py` · register **all 13 connector facts** (8 ungated today); harden the gate from `must_columns` to **full-column parity** (writer column list vs DDL) · **verify** `python tests/conformance/check_fact_schema_drift.py` passes; a deliberately-dropped column fails it.
5. `apps/analytics-service/tests/test_recompute_daily.py` · add refund canonical-name assertion + subunit parity (rulings F, 2) · **verify** `pytest apps/analytics-service/tests/test_recompute_daily.py`.

**Flag:** none (correctness). **Rollback:** migrations have `down.sql`; the order backfill rerun is RMT version-collapse (no data loss).
**Acceptance:** all 13 facts registered; full-column drift gate green and proven to fail on drift; net_sales correct on seed; refund/subunit parity tests pass.
**Migration safety:** order backfill rerun is idempotent (RMT collapse); purge migration reversible.

---

#### P0-B — PII tokenizer + bronze `customer_ref`/consent columns + Woo address removal · closes G6 (R1,R3,R8) · @maya · **DPDP GATE**
**Goal:** tokenize PII at the single ingest chokepoint before the Kafka produce, and give bronze the columns that make erasure and purpose-audit bounded.
**Why now:** blocks any bronze go-live and Stage-8; the envelope is plaintext today (`ingest.py:360`).

Tasks:
1. `apps/ingestion-service/src/domain/framework/pii_tokenizer.py` (new, pure-domain, no I/O) · for each field in `adapter.pii_manifest`, replace raw value in `columns` with `tok:<HMAC-SHA256(per-workspace-salt, normalized_value)>`; email lowercased/trimmed, phone E.164-normalized **before** hash; emit `salt_version` · **verify** unit test: same phone from two vendors → identical token; rotating salt_version → different token, old still resolvable.
2. `apps/ingestion-service/src/infrastructure/pii/kms_vault.py` (new adapter) · read per-workspace salt as a KMS-wrapped Secrets Manager secret (reuse `CredentialCustodyStack` envelope pattern, `infra/cdk/bin/app.ts:15`); write raw plaintext for downstream messaging only to `customer_pii._ct` (`07-schema-customer-pii.sql:23-25`) under a per-subject DEK keyed `(workspace_id, customer_ref)` · **verify** integration test: plaintext never returned to caller; DEK present.
3. `apps/ingestion-service/src/application/framework/ingest.py:447-468` (after `normalize`, before `normalized_events.append`) and `apps/ingestion-service/src/application/framework/webhook_intake.py:~211` (before `_produce_kafka`) · invoke the tokenizer on `NormalizedEvent.columns` · **verify** snapshot test: produce a Shopify order with `email/first_name/last_name`; grep the bytes `_produce_kafka` emits for the plaintext → **0 matches**.
4. `apps/analytics-service/migrations/clickhouse/0011_bronze_add_customer_ref.sql` (new) · `ALTER TABLE brain.connector_raw_events ADD COLUMN customer_ref String DEFAULT '', ADD COLUMN lawful_basis LowCardinality(String) DEFAULT '', ADD COLUMN purpose_code LowCardinality(String) DEFAULT ''` + `down.sql` (DROP COLUMN ×3) · **verify** `clickhouse-client --query "DESCRIBE brain.connector_raw_events"` shows all three; historical rows default-safe.
5. `apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql:243,249` · remove `billing_address_1` / `shipping_address_1`; retain city/state/postcode · **verify** `grep -c "address_1" step-a-enable-create.sql` == 0.

**Flag:** `PII_TOKENIZER` (default OFF until snapshot-grep passes, then ON before P0-C).
**Rollback:** flag OFF reverts to passthrough (only safe pre-go-live, never with live PII); `0011` down.sql drops columns.
**Acceptance (pass-1 REQUIRED):** (a) envelope-snapshot grep clean of plaintext PII; (b) HMAC keyed by per-workspace salt, phone E.164 pre-hash; (c) `salt_version` in envelope; (d) plaintext only in `customer_pii._ct`; (e) `0011` applied; (f) Woo address columns gone.
**Migration safety:** `0011` additive + nullable-default + reversible; Woo DDL change reversible via down.

---

#### P0-C — Bronze raw-archiver consumer (single writer of bronze) · closes G1 · @maya
**Goal:** give `0010` + S3 their first production writer; both ingest paths produce ONE envelope, a single consumer group writes bronze.
**Why now:** the keystone (P1-B) reads bronze — bronze must have a writer first. **Sequence P1-D ≤14 days behind (R7 SLA).**

Tasks:
1. `apps/ingestion-service/src/interfaces/consumers/raw_archiver_consumer.py` (new) · consume `integrations.<vendor>.v1`, write each envelope to CH `brain.connector_raw_events` (populate `customer_ref`/`lawful_basis`/`purpose_code` from the envelope) · **verify** integration test: produce 1 event → exactly 1 bronze row with populated columns.
2. `apps/ingestion-service/src/infrastructure/storage/s3_raw_writer.py` (new) · write same bytes to `s3://.../{ws}/{vendor}/{y}/{m}/{d}/{idem_key}.json.zst`; **non-fatal** (log+metric on failure) · **verify** unit test: S3 failure does not block the CH write; metric `bronze_s3_write_failures_total` increments.
3. `apps/api-gateway/src/infrastructure/realtime-facts-consumer.ts` · **do not delete** — keep the proven Shopify path live; add a guard so it no-ops when `BRONZE_RAW_ARCHIVER==='true'` AND shadow-parity verified (B10) · **verify** with flag ON, no duplicate facts (shadow-read diff == 0).
4. `apps/analytics-service/migrations/clickhouse/0012_bronze_ttl.sql` (new, **NOT applied until P1-D**) · documents `MODIFY TTL received_at + INTERVAL 90 DAY` · **verify** file present; applied only after S3 is the durable copy.
5. Daily `BACKUP TABLE connector_raw_events TO S3(...)` cron stopgap (R7) · **verify** runs from day one of P0-C as the independent copy until P1-D.

**Flag:** `BRONZE_RAW_ARCHIVER` (default OFF; ON only after P0-B green).
**Rollback:** flag OFF stops bronze writes; facts still flow via the preserved Shopify path; no data loss (S3/BACKUP copy independent).
**Acceptance:** both pull + webhook paths produce the envelope; single consumer is the sole bronze writer; `customer_ref` populated on every row; S3 write non-fatal; BACKUP cron live.
**Migration safety:** bronze is append-only; re-delivery appends a distinct row (dedup is silver's job per `0010` header).

---

#### P0-D — Erasure orchestrator (reclassified from P1-F per R2) · closes G6 · @vikram (+@maya CH side) · **DPDP GATE**
**Goal:** a working five-tier erasure path before any live customer data lands.
**Why now:** DPDP penalties accrue per request; this is a prerequisite, not a P1.

Tasks:
1. core-service migration `31-subject-erasure.sql` (new) · add `audit_log.action` value `subject_erasure`; create `subject_erasure_request(workspace_id, customer_ref, requested_at, notice_window_ends_at, executed_at, count_zero_verified_at, status)` with `notice_window_ends_at = requested_at + 48h` (DPDP §12); create WORM `key_destruction_ledger` (append-only) · **verify** insert a request → `notice_window_ends_at` is +48h; ledger rejects UPDATE/DELETE.
2. `apps/core-service/src/application/contexts/consent/commands/erase-subject.ts` + use-case (new) · PG plaintext-wipe + tombstone (`customer_pii.tombstoned_at`, zero `_ct`) → CH bronze `ALTER DELETE WHERE ws=? AND customer_ref=?` → S3 crypto-shred (destroy per-subject DEK) → Kafka offset note in `audit_log` · **verify** end-to-end test below.
3. CH silver + MV fan-out · iterate a generated `erasure_targets` manifest (emitted by the `canonical-facts.yaml` codegen, sequenced with P1-A for the MV list); the PG + bronze + S3 tiers ship at P0-D without the manifest · **verify** `ALTER DELETE` issued per manifest target; a new MV unregistered → CI fail (post-P1-A).
4. `apps/core-service/.../erase-subject.integration.test.ts` (new) · ingest a subject across 2 vendors, run erasure, assert `COUNT=0` on PG hot-mirror + CH silver + CH bronze + a registered MV; assert per-subject DEK destroyed (decrypt now fails); assert `audit_log` carries `subject_erasure` and §12 window honored · **verify** the COUNT=0 row + ledger entry are emitted as the DPB artifact.

**Flag:** `ERASURE_ORCHESTRATOR` (must be ON before any live PII).
**Rollback:** erasure is irreversible by design; the flag gates *availability* of the command, not partial execution. The orchestrator is idempotent (re-run on a tombstoned subject is a no-op returning COUNT=0).
**Acceptance (pass-1 REQUIRED):** COUNT=0 artifact across all four tiers + DEK destroyed + §12 window honored + `audit_log` entry.
**Migration safety:** additive tables; WORM ledger append-only; tombstone is forward-only.

---

#### P0-R6 — vendor ENUM→TEXT+FK (pulled from P1-A per R6) · closes G3 · @vikram (+@maya analytics facts)
**Goal:** make vendor #4 a data row, not an `ALTER TYPE`; unblock Shiprocket (P0-1 in `connector-pipeline-gaps.md`).
**Why now:** every day live without it miscalculates realized GMV (~0 RTO/delivery) for Shiprocket orders; `phase5-legacy-facts-to-pg.sql:524` `'SHIPROCKET'::connector_vendor` fails today.

Tasks:
1. core-service migration `32-vendor-text-fk.sql` (new) · create `connector_vendors(code TEXT PK, archetype TEXT)`; convert `connector_vendor` ENUM → `TEXT REFERENCES connector_vendors(code)` across `connector_connections`, `customer_pii.source_vendor` (`07-schema-customer-pii.sql:19`), `05-schema-connector-facts.sql:22`; seed SHOPIFY/META/GOOGLE/SHIPROCKET/WOOCOMMERCE/KLAVIYO/UNICOMMERCE; `down.sql` recreates the enum (values map 1:1) · **verify** `INSERT INTO connector_vendors VALUES ('SHIPROCKET','logistics')` succeeds; `phase5` cast no longer errors.
2. `apps/core-service/src/application/contexts/connectors/sync/acl.ts` + the `ConnectorVendor` TS type · widen from union literal to registry-backed string · **verify** `tsc` passes; a new vendor needs no type edit.

**Flag:** none (additive schema). **CTOA sign-off:** typed-contract change, additive + reversible (flagged for Rohan visibility per ADR-CONVERGENCE-001 escalation).
**Rollback:** `down.sql` restores enum (1:1 value map).
**Acceptance:** Shiprocket/Woo/Klaviyo/Unicommerce insert as data rows; existing values map 1:1; no `ALTER TYPE` needed for vendor #4.
**Migration safety:** additive registry + 1:1 backfill; reversible.

---

### P1 — pre-100-integration hardening (keystone + tiers)

---

#### P1-A — Fact-schema codegen + MV apply/sunset + FINAL/PREWHERE (ADR P1: 2,I,E,5,3,1,G) · closes G3 · @maya (+@vikram)
**Goal:** single-source the PG↔CH fact schema (`canonical-facts.yaml` → CH DDL + PG DDL + TS row-builder + Py constants + the `erasure_targets` manifest for P0-D fan-out).
**Why now:** hand-maintained dual DDL is already wrong at 7 vendors (ADR C1); it produces the `erasure_targets` manifest P0-D's MV fan-out consumes.

Tasks:
1. `tools/codegen/gen_facts.py` (new) · `docs/schema/canonical-facts.yaml` → per-store DDL + TS row-builder + Py constants + `erasure_targets.json` manifest · **verify** generated DDL diff vs committed DDL == 0 on a clean tree.
2. `tools/ci/check_codegen_drift.py` (new CI gate) · fail PR if generated artifacts differ from committed · **verify** edit a fact column without regenerating → CI fails.
3. `apps/analytics-service/migrations/clickhouse/` · runbook-gated `daily_metrics_computed` MV apply + double-fire guard; define legacy-vs-base parity sunset gate (ruling I) · **verify** MV fires once per insert (no double-count).
4. CH gateways · auto-append `FINAL` + `PREWHERE workspace_id` (rulings E,5) · **verify** generated query carries FINAL + PREWHERE; conformance `check_clickhouse.py` passes.
5. `connector_vendors.archetype` field + `ALTER DEFAULT PRIVILEGES` grants (ruling 3) + multi-currency CM guard (ruling G) · **verify** a multi-currency workspace is flagged/blocked from CM.

**Flag:** none (codegen is build-time). **Rollback:** codegen output reversible; MV apply has a down runbook.
**Acceptance:** codegen produces all 4 artifacts + `erasure_targets`; drift gate green; MV double-fire guarded; FINAL/PREWHERE auto-enforced.
**Migration safety:** generated DDL reviewed before apply; MV apply runbook-gated + reversible.

---

#### P1-B — Transform-graduation worker (KEYSTONE) + raw_event_id provenance · closes G1,G5 (R5,R11) · @maya
**Goal:** the missing raw→fact graduation; reads bronze off the migration-28 cursor, dispatches `(vendor,event_type)→mapper`, idempotently UPSERTs silver with `raw_event_id` provenance.
**Why now:** must ship **before integration #2** adopts the old bespoke-consumer pattern; it closes G1+G5 simultaneously.

Tasks:
1. `apps/ingestion-service/src/interfaces/consumers/transform_consumer.py` + `apps/ingestion-service/src/application/use-cases/graduate_raw_event.py` (new) · read bronze `WHERE received_at > cursor` (PG `raw_event_transform_state`), UPSERT silver keyed (PG ON CONFLICT + CH RMT(version=ms)) · **verify** re-run over same bronze rows is idempotent (silver row count stable).
2. `apps/ingestion-service/src/domain/framework/transform_registry.py` (new) · `dict[(vendor,event_type) → mapper]`; one mapper per pair (Single-Primitive); each mapper carries `@paradigm("sql")` · **verify** a new `(vendor,event_type)` is added by a registry row + mapper only — **no consumer edit** (grep diff).
3. Provenance · add `raw_event_id` + `provenance` (nullable) to silver fact DDL (via P1-A codegen); stamp `raw_event_id` on every UPSERT · **verify** every new silver row joins back to a bronze row; legacy rows marked `provenance='legacy_etl'`, `raw_event_id=NULL` (R12 default).
4. Retry/backoff + DLQ + cursor-advance-past-poison · on terminal failure → `integrations.dlq.v1` with `raw_event_id`+error; cursor advances (no head-of-line block) · **verify** test: a poison event routes to DLQ AND the cursor still advances.
5. Per-tenant isolation (R11) · per-`(workspace,vendor)` circuit breaker (K consecutive terminal failures → route to DLQ + `transform_circuit_open{workspace_id}` alarm); emit `transform_lag_seconds{workspace_id}` to CloudWatch (NOT Prometheus) · **verify** load test: one workspace at 10k events/min, a second workspace's lag stays < 5-min warn threshold.

**Flag:** `TRANSFORM_GRADUATION_WORKER` (default OFF; shadow-mode first per B10).
**Rollback:** flag OFF → silver stops graduating from bronze; the preserved Shopify path keeps facts flowing; re-derive on re-enable from bronze.
**Acceptance (pass-1 REQUIRED):** (a) poison→DLQ + cursor advances; (b) `transform_lag_seconds` per workspace; (c) new `(vendor,event_type)` = registry row only; (d) re-run idempotent; (e) `raw_event_id` on every silver row.
**Migration safety:** silver UPSERT keyed + idempotent; replay is per-tenant + bounded.

---

#### P1-C — Identity: salted hashes + union-find stitcher + per-workspace salt (R10, ADR #4) · closes G4 · @vikram (identity) + @maya (union-find job)
**Goal:** deterministic cross-vendor identity with a stable surrogate `identity_cluster_id`.
**Why now:** today only Shopify contributes a `customer_ref`; nothing to stitch without normalized Klaviyo/Meta customer→fact paths and salted hashes.

Tasks:
1. core-service migration `33-identity-hashes.sql` (new) · add `email_hash`/`phone_hash` (HMAC, per-workspace salt, salt_version) + `identity_cluster_id` to `customer_pii`; create `identity_cluster_registry(workspace_id, min_label, cluster_id UUID)` + edges table partitioned by workspace_id · **verify** columns present; per-workspace salt distinct.
2. Per-workspace customer_ref salt · replace bare `sha256(...).slice(0,32)` (`acl.ts:175`) with HMAC(per-workspace salt) so the same Shopify customer at two brands does NOT collide (closes G6 cross-workspace breach) · **verify** test: same vendor_customer_id in 2 workspaces → different customer_ref.
3. `apps/core-service/src/.../identity/union_find.py` (or TS job) · MIN-label connected-components (Paradigm-1, `@paradigm("sql")`); first observation → immutable opaque UUID in registry; merge keeps the **older** cluster_id (tie-break oldest wins); emit `identity.cluster.v1` · **verify** test: merging two clusters preserves the older cluster_id on all downstream facts.
4. k≥5 guard · suppress identity edges/cluster export for any cluster in a workspace with < 5 distinct customers · **verify** test: a <5-customer cluster is suppressed from export.
5. Klaviyo/Meta customer→fact normalization path · **verify** a Klaviyo profile and a Shopify order for the same E.164 phone land in one cluster.

**Flag:** `IDENTITY_STITCHER` (default OFF). **Rollback:** flag OFF → facts carry `identity_cluster_id=NULL`; no cross-vendor merge; reversible.
**Acceptance:** salt rotation does not break a pre-rotation join; cluster merge preserves older cluster_id; <5-customer cluster suppressed; per-workspace customer_ref no longer collides cross-workspace.
**Migration safety:** additive columns; union-find incremental + reversible (re-derivable from edges).

---

#### P1-D — BronzeStorageStack CDK + lifecycle + CH TTL + DLQ topic (R4 DLQ, R7) · closes G2 · @jatin (CDK) + @vikram (bin/app wiring + BACKUP cron)
**Goal:** the durable S3 raw archive + the DLQ safety net; close the CH-only-copy window.
**Why now:** **must land ≤14 days after P0-C** (R7 SLA) or the bronze writer is flagged OFF.

Tasks:
1. `infra/cdk/lib/bronze-storage-stack.ts` (new) · S3 bucket, per-workspace KMS-CMK key prefix (reuse CredentialCustody key pattern), versioning ON, `if (region !== 'ap-south-1') throw` synth assert, lifecycle 90d Standard → Glacier IR → delete 7y · **verify** `cdk synth` produces the bucket + lifecycle; region assert fires on a wrong region.
2. `infra/cdk/bin/app.ts:15-16` · register `BronzeStorageStack` alongside `CredentialCustodyStack`/`CoreServiceTaskDefStack` · **verify** `cdk synth` lists 3 stacks. **AUTHORED-NOT-DEPLOYED** (Stage-8 console ceremony).
3. DLQ topic `integrations.dlq.v1` + producer the transform worker (P1-B) writes to · **verify** a parse/contract failure becomes a queryable DLQ row, never a silent skip.
4. `apps/analytics-service/migrations/clickhouse/0012_bronze_ttl.sql` · apply CH bronze TTL **only now** that S3 is the durable copy · **verify** `DESCRIBE` shows the TTL; the daily BACKUP cron can be retired.

**Flag:** none for CDK (provisioning is the held Stage-8 ceremony). DLQ is infra.
**Rollback:** stack is destroy-able; TTL `0012` has a down.sql (remove TTL).
**Acceptance:** stack synths in ap-south-1 with lifecycle + per-ws KMS prefix; DLQ topic live; CH TTL applied only after S3 durable; CH-only window ≤14 days documented + risk-accepted.
**Migration safety:** TTL applied only post-S3; BACKUP cron is the bridge.

---

#### P1-E — Wire recompute_daily inputs + `@paradigm` decorator + CI gate + CH query gateway + PII catalog (R9) · closes G5,G6 · @maya
**Goal:** close the provably-wrong metric gaps and wire the already-built `@paradigm` runtime + the CH query gateway (Layer-4 tenant isolation + erasure home).
**Why now:** CM2/True-CM2/CM3 are wrong on live data today; the gateway is the structural home for P0-D's erasure mutations.

Tasks:
1. `apps/analytics-service/src/application/contexts/metric_engine/recompute_daily.py:44-50` · wire shipment facts (rto_orders, total_shipments → CM2/True-CM2), misc_expenses (`workspace_costs` PG lookup → CM3≠CM2), vendor_product_id propagation (COGS join, top P0 blocker) · **verify** `pytest test_recompute_daily.py`: CM2 non-zero on seed with shipments; CM3 ≠ CM2 with misc_expenses.
2. `pylibs/brain_clickhouse/brain_clickhouse/` (stub today — only `__init__.py`) · build the real workspace_id-injecting, parameterized, FINAL-appending query gateway · **verify** a query without workspace_id is rejected; FINAL auto-appended.
3. Convert docstring `@paradigm: <tier>` comments (`recompute_daily.py:4`, `main.py`, `cost_stack_query.py`, etc.) into real `@paradigm("<tier>")` invocations from `pylibs/brain_cost_router/brain_cost_router/paradigm.py:99` · **verify** decorator present at all analytics/intelligence call sites.
4. `tools/ci/paradigm_gate.py` (new CI gate) · AST-scan: any call into an LLM SDK (anthropic/openai) NOT inside a function carrying a live `@paradigm` decorator → fail PR · **verify** a bare Sonnet call without `@paradigm` fails CI; transform mappers (P1-B) all carry `@paradigm("sql")`.
5. `docs/pii-catalog.yaml` (new) + CI assertion · each connector declares its PII fields as a merge prerequisite · **verify** a new adapter without a catalog entry fails CI.

**Flag:** none (correctness + CI). **Rollback:** gateway is additive; gates can be temporarily skipped only with CTOA sign-off.
**Acceptance:** CM2/CM3 correct on seed; gateway rejects un-scoped queries; paradigm gate fails on a bare LLM call; PII catalog CI enforced.
**Migration safety:** read-path only; no destructive migration.

---

#### P1-F — (folded into P0-D) erasure MV fan-out completion · @vikram + @maya
The PG/bronze/S3 tiers ship at P0-D; the **MV fan-out tier** completes here once P1-A emits the `erasure_targets` manifest. **Verify** a registered MV unregistered from the manifest → CI fail; COUNT=0 extends to every MV.

---

### P2 — scale / triggered (NOT built now)

- ADR P2: Replicated-engine activation; FX daily-write path; probabilistic/household identity graph (opt-in, reversible).
- **MSK tiered storage + Debezium PG→Kafka outbox** — `TECH/00` MSK graduation trigger (Q1).
- **Glue Schema Registry + Avro + BACKWARD CI gate** — integration #5 / 2nd-consumer trigger (Q7).
- **Iceberg/S3-as-source-of-truth + Glue catalog + compaction** — named second-reader trigger (Q2).
- **ADR-J archetypes** — Founder product scope (Q3).

---

## B8. Dependency graph + critical path

```
                 P0-A (drift gate, net_sales)  ── @maya
                   │
                   ▼
   P0-B (PII tokenizer + customer_ref + Woo)  ── @maya  [DPDP GATE]
                   │
        ┌──────────┼───────────────────────────┐
        ▼          ▼                            ▼
   P0-C (bronze   P0-D (erasure orch.)      P0-R6 (vendor TEXT+FK) ── @vikram
   raw-archiver)  [DPDP GATE] @vikram         (parallel; unblocks Shiprocket)
   @maya             │                            │
        │            │                            │
        ▼            │                            ▼
   P1-D (S3 stack    │                       (Shiprocket/Woo/Klaviyo
   + DLQ + TTL)      │                        vendor rows usable)
   ≤14d behind P0-C  │
   @jatin/@vikram    │
        │            │
        ▼            │
   P1-B (TRANSFORM   │   ◀── P1-A (codegen + erasure_targets manifest) @maya
   WORKER keystone)  │            │  feeds ──▶ P1-F (MV fan-out completion)
   @maya ────────────┘            │
        │                         │
        ▼                         ▼
   P1-C (identity stitcher) ── P1-E (recompute inputs + @paradigm + CH gateway)
   @vikram/@maya               @maya
        │                         │
        └───────────┬─────────────┘
                    ▼
        GOLD wired: KPIs / Morning Brief / billing read live silver
```

**Critical path:** `P0-A → P0-B → P0-C → P1-D → P1-B → P1-E` (the bronze→silver→gold spine; the warehouse is not "end-to-end" until P1-E reads correct silver).

**Parallelizable across owners:**
- **@vikram** runs `P0-R6` and `P0-D` in parallel with @maya's `P0-C` (both depend only on P0-B's columns).
- **@jatin** can begin `P1-D` CDK synth as soon as P0-C lands (the 14-day SLA window).
- **P1-A (codegen)** runs in parallel with P0-C/P0-D and is a prerequisite only for `P1-F` (MV fan-out) and the `raw_event_id` DDL in P1-B.
- **P1-C (identity)** and **P1-E (recompute/gateway)** parallelize after P1-B.

## B9. Testing & verification strategy

| Layer | What | New CI gate (slice that introduces it) |
|---|---|---|
| **Unit** | tokenizer hash determinism + salt-version; union-find merge/stability; mapper dispatch | — |
| **Contract** | envelope shape; `(vendor,event_type)→mapper` registry; silver UPSERT keys | — |
| **Parity** | TS↔Py metric parity; full-column fact-schema drift | **canonical-fact full-column-parity drift gate** (P0-A, hardens `tests/conformance/check_fact_schema_drift.py`); **codegen-drift gate** `tools/ci/check_codegen_drift.py` (P1-A) |
| **Real-network smoke** | live Shopify webhook → bronze → silver → gold; Shiprocket pull → shipment fact | — (Tanvi VETO surface) |
| **Mutation-on-gates** | mutate the tokenizer to leak one PII field → snapshot grep MUST catch it; mutate erasure to skip an MV → COUNT MUST fail | **plaintext-PII grep** (P0-B); **COUNT=0 erasure artifact** (P0-D) |
| **Conformance / invariants** | workspace_id at 4 layers; FINAL on every CH read; RMT keyed/idempotent; `@paradigm` on every LLM call | **`@paradigm` AST gate** `tools/ci/paradigm_gate.py` (P1-E); **schema-BACKWARD gate** (DEFERRED to P2 per R4 — interim = mapper JSON-schema validation → DLQ); reuse `tests/conformance/check_clickhouse.py`, `check_rls.py`, `check_money_types.py` |

**Replay-double-count invariant (proposal §8):** "every fact sink is keyed + idempotent, read with FINAL" is a conformance invariant (P1-B + `check_clickhouse.py`) — without it, replay corrupts %-of-GMV billing.

## B10. Rollout / cutover plan

**Flag-flip order (each verified before the next):**
1. `PII_TOKENIZER` ON → snapshot-grep clean (P0-B). Hard gate.
2. `ERASURE_ORCHESTRATOR` ON → COUNT=0 artifact (P0-D). Hard gate before any live PII.
3. `BRONZE_RAW_ARCHIVER` ON → bronze receives rows; the **proven Shopify `realtime-facts-consumer.ts` path stays ON in parallel** (dual-write window).
4. S3 + DLQ live (P1-D) → flip CH bronze TTL ON; retire the BACKUP cron.
5. `TRANSFORM_GRADUATION_WORKER` ON in **shadow mode** → silver derived from bronze is diffed against the facts the bespoke Shopify consumer wrote (**shadow-read window**). When diff == 0 over a soak period, retire the bespoke consumer (no-op guard in `realtime-facts-consumer.ts`).
6. `IDENTITY_STITCHER` ON → `identity_cluster_id` stamps silver.
7. P1-E correctness inputs ON → gold (KPIs/Morning Brief/billing) reads correct silver.

**Back-derive silver from bronze:** reset `raw_event_transform_state.last_processed_received_at` per workspace → the transform worker re-reads bronze (CH cache or S3 archive) → re-UPSERTs silver idempotently. Never hand-patch CH.

**Held Stage-8 Founder-at-console ceremonies (NOT in this plan's execution):** S3 bucket provisioning (`cdk deploy BronzeStorageStack`), KMS CMK creation, MSK graduation. CDK is **authored-not-deployed** (`infra/cdk/bin/app.ts` header). **Local-dev validates first:** the full bronze→silver→gold flow + erasure COUNT=0 run against `brain_dev` + local CH + local S3 (minio) before any console action.

## B11. Risk register

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| **Transform-worker SPOF** — stall → ALL silver stale | Med | High | Per-tenant cursor + per-(ws,vendor) circuit breaker (R11); `transform_lag_seconds` page >15min p95; DLQ + cursor-advance-past-poison; re-derive from bronze | @maya |
| **Bronze single-copy window (P0-C→P1-D)** | Med | High | ≤14-day SLA (R7); CH TTL withheld until S3 live; daily BACKUP cron stopgap from day one; writer flagged OFF if window breached | @jatin/@vikram |
| **Replay double-counting vs %-of-GMV billing** | Med | High | "keyed + idempotent + FINAL" conformance invariant (P1-B); silver UPSERT keyed; per-tenant replay bounded | @maya |
| **Migrating the hottest code** (`acl.ts`, `sync-use-cases.ts`, `ingest.py`, `realtime-facts-consumer.ts`) | Med | High | Preserve proven Shopify path; shadow-read window; existing `REALTIME_FACTS_CONSUMER`/`BRAIN_WEBHOOKS_ENABLED` flags; reversible per slice | @maya/@vikram |
| **PII leak on the wire** (current state) | High (today) | Critical | P0-B tokenizer gate + plaintext-grep mutation test; flag-gated | @maya |
| **Crypto-shred regulator-contested** | Low | Med | PII-light bronze (small vault); WORM key-destruction ledger; COUNT=0 artifact; Founder Q5 default | @vikram |
| **Codegen-not-built drift on ungated facts** | Med | Med | P0-A full-column parity as interim backstop; P1-A codegen as the real fix | @maya/@vikram |
| **Identity over-merge** (false-positive edge) | Low | High | Deterministic-only (strong identifiers); probabilistic deferred + opt-in; k≥5 export guard; stable older-wins cluster_id | @vikram |
| **Legacy backfill provenance gap** (R12) | High (existing) | Med | `provenance='legacy_etl'` + nullable `raw_event_id` marker (visible, queryable); opportunistic Shopify/Woo synthesis; Founder Q6 | @maya |

## B12. EOS stage mapping & estimate

| EOS Stage | This epic |
|---|---|
| 1 Intake | This plan + the approved proposal = the requirement |
| 2 Plan | **This document** (Aryan binding plan) |
| 3 Build | P0-A…P0-R6, P1-A…P1-F (slice owners above) |
| 4 Security | **Shreya VETO** on every DPDP-gate slice: P0-B (tokenizer), P0-D (erasure), P1-C (per-workspace salt + k≥5), P1-D (KMS/residency), P0-A (status-gated purge) |
| 5 QA | **Tanvi VETO** on parity + real-network smoke: P0-A (drift gate), P1-B (transform parity vs Shopify shadow), P1-E (recompute parity) |
| 6 Final | Cross-slice conformance suite (B9) green |
| 7 Approve | Rohan (CTOA) signs Founder gates; CTOA sign-off already flagged on P0-R6 (vendor TEXT) |
| 8 Deploy | **HELD** Founder-at-console: S3/KMS provisioning, MSK graduation; local-dev validated first |

**VETO summary:** Shreya (DPDP) → P0-B, P0-D, P1-C, P1-D, P0-A. Tanvi (parity/smoke) → P0-A, P1-B, P1-E.

**Relative effort (S/M/L) + suggested ordering for a small team:**

| Order | Slice | Effort | Owner |
|---|---|---|---|
| 1 | P0-A | M | @maya |
| 2 | P0-B | L | @maya |
| 3 | P0-R6 (parallel w/ 2) | S | @vikram |
| 4 | P0-C | M | @maya |
| 5 | P0-D (parallel w/ 4) | L | @vikram |
| 6 | P1-A (parallel from 2) | L | @maya |
| 7 | P1-D | M | @jatin/@vikram |
| 8 | P1-B (keystone) | L | @maya |
| 9 | P1-C (parallel w/ 10) | M | @vikram/@maya |
| 10 | P1-E | M | @maya |
| 11 | P1-F | S | @vikram/@maya |

No calendar dates — effort is relative sizing only.

## B13. Definition of Done

**The end-to-end application is DONE when:** a vendor event flows `vendor → bronze (CH + S3, PII-tokenized, customer_ref-keyed) → silver (typed facts, raw_event_id + identity_cluster_id, idempotent) → gold (recompute_daily + MVs) → KPIs / Morning Brief / %-of-GMV billing` for **a non-Shopify vendor added by a registry row + a mapper only** (no new code path); a subject-erasure request produces a **COUNT=0 artifact across all five tiers** with the per-subject DEK destroyed; a mapper bug is fixed by **resetting the transform cursor and re-deriving silver from bronze** (no hand-patch); and all B9 CI gates are green.

**Per-phase exit gates:**
- **P0 exit:** PII-grep clean + COUNT=0 erasure + bronze has a writer + Shiprocket is a data row + full-column drift gate green. (DPDP gates all green.)
- **P1 exit:** transform worker shadow-verified at parity then bespoke consumer retired + S3 durable + CH TTL on + identity stitching live + recompute correct (CM2/CM3 non-zero) + `@paradigm` gate enforced + MV erasure fan-out complete.
- **P2:** trigger-gated only; no work begins without its named trigger firing.
