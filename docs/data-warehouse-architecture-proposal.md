# Data-Warehouse Architecture for 100+ Integrations — Target Proposal

**Author:** Aryan (Architect) · **Date:** 2026-06-05 · **Status:** PROPOSED (Founder gates noted)
**Method:** Synthesis of a 7-dimension current-system review (G1–G6 + data-quality + streaming/lineage), 5 research themes (lakehouse/medallion, ELT platforms, streaming/CDC/replay, identity resolution, multi-tenant cost+erasure), and 4 ranked candidate architectures. Extends — does not contradict — `ADR-CONVERGENCE-001`.

---

## 1. Headline verdict

**Wire the warehouse Brain already designed; do not re-found it.** The bronze table (`brain.connector_raw_events`, `0010`), the durable PG transform cursor (`migration 28`), the idempotent ReplacingMergeTree sinks, and the medallion-shaped flow are all correct and committed — they simply have **zero application callers** today. The 100-integration vision fails not on the model but on six unwired seams.

The spine is **Medallion-on-ClickHouse (CH+PG only, no new heavy infra)** — the highest-scoring candidate (6.5) and the cheapest path under %-of-GMV pricing for a small team. Onto that spine I graft three ideas from the runner-ups, each gated on a concrete trigger so we never pay for capability ahead of need:

- **From Streaming-First (6.25):** the bronze writer is a **Kafka consumer group**, not an inline DB call. The migration-28 cursor pattern is preserved for the *transform* worker, but ingestion *produces* one envelope and a single raw-archiver consumer is the sole writer of bronze. This kills the two-divergent-writers problem at the root and gives per-tenant replay for free (workspace_id is already the partition key). We adopt the **DLQ topic** and **Glue Schema Registry BACKWARD gate** — but **defer MSK tiered storage + Debezium to Phase-2** behind the `TECH/00` MSK graduation trigger (the judge's correct warning: an under-resourced team that stands up Debezium WAL slots early will take the Postgres primary down).
- **From Iceberg Lakehouse (5.5):** **defer Iceberg/S3-as-source-of-truth** until a concrete second-reader trigger fires (external BI/Trino, ML feature store, regulator export, or CH-lock-in hedge). But adopt its **crypto-shred erasure primitive now** for the cold tier, and adopt its **S3 raw archive as a Phase-1 deliverable** (not Phase-2) — the canon already specifies it (`technical-context.md:109,143`) and it is the only independent recovery path that makes CH ephemeral.
- **From Buy-Ingestion (3.5):** **reject buying** (violates the locked canon; the moat is silver/gold, not connectors; the anchor customer's P0s are all silver-layer). But adopt its **Airbyte-Protocol 4-verb connector contract** (`spec/check/discover/read`) and **net-additive + per-row null-and-log** change handling as the *internal* SDK shape — build, don't buy.

**Two hard corrections to the spine, promoted from judge findings to release gates (not deferred tracks):**

1. **Ingest-time PII tokenization is a GATE on bronze go-live, not a follow-on.** `brain.connector_raw_events.payload` stores raw vendor JSON verbatim; WooCommerce raw DDL carries full street addresses (`step-a-enable-create.sql:237-241`). Bronze cannot be green-lit on DPDP grounds until PII is tokenized at the ingest chokepoint and the WooCommerce full-address columns are removed.
2. **Bronze needs a `customer_ref` column for bounded erasure.** The `0010` DDL has no subject key — right-to-erasure would be an `O(workspace_rows)` scan-then-mutate. Add `customer_ref` (the salted identity hash) to bronze so erasure is a bounded key-level delete.

---

## 2. Target architecture — bronze / silver / gold

### 2.1 The three tiers (medallion vocabulary, CH-native default)

| Tier | What | Store | Engine | Mutability | Owner service |
|---|---|---|---|---|---|
| **Bronze** | Verbatim vendor payload, PII-tokenized, append-only | CH `connector_raw_events` (hot, short TTL) **+** S3 raw archive (durable, ap-south-1) | MergeTree | append-only | ingestion-service |
| **Silver** | Validated, conformed, deduped typed facts; `raw_event_id` provenance; `identity_cluster_id` | PG hot-mirror (≤90d) **+** CH `connector_*_facts` | ReplacingMergeTree(version=ms) | idempotent UPSERT | ingestion → core (identity) |
| **Gold** | Daily metrics, MVs, marts feeding KPIs/Morning Brief | CH `workspace_daily_metrics` + MVs | MergeTree / MV | recompute | analytics-service |

**Default is CH-only with MergeTree TTL-MOVE tiering** (hot NVMe ≤90d → cold S3 via `TTL ... TO VOLUME 'cold'`), per the research's small-team %-of-GMV recommendation. S3 raw archive is a *parallel durable copy* (blast-radius isolation), **not** an Iceberg lake — that is deferred until a second engine must read Brain's bytes.

### 2.2 Data flow (ASCII)

```
                          ┌──────────────────────────────────────────────────────────┐
   VENDOR (Shopify/Meta/  │  INGESTION-SERVICE (py)                                   │
   Google/Shiprocket/     │                                                          │
   Klaviyo/Woo/Uni...)    │  ┌────────────┐   pull loop  ┌───────────────────────┐  │
        │                 │  │ Connector  │─────────────▶│ PII TOKENIZER (GATE)  │  │
        │ webhook ───────▶│  │ (4-verb    │   webhook    │ email/phone/name →    │  │
        │ poll    ───────▶│  │  SDK)      │─────────────▶│ salted hash + token   │  │
        │                 │  └────────────┘              │ (raw PII → KMS vault) │  │
        │                 │         │                    └───────────┬───────────┘  │
        │                 │         │ produce ONE IntegrationEvent (Avro envelope)  │
        │                 │         ▼  schema-validated @ Glue Registry (BACKWARD)  │
        └─────────────────┼──▶  integrations.<vendor>.v1  ──────────────────────────┼─▶ DLQ: integrations.dlq.v1
                          └───────────────────────┬──────────────────────────────────┘   (parse/contract fail =
                                                  │ workspace_id = partition key            queryable row, never
                                                  │                                          silent log+skip)
                  ┌───────────────────────────────┼───────────────────────────────────┐
                  │  RAW-ARCHIVER consumer group (single writer of BRONZE)             │
                  ▼                                                                    ▼
   ╔═══════════════════════════╗                                    ┌──────────────────────────────┐
   ║ BRONZE                    ║  same bytes, two homes             │ S3 raw archive (ap-south-1)  │
   ║ CH connector_raw_events   ║◀──────────────────────────────────▶│ {ws}/{vendor}/{y}/{m}/{d}/   │
   ║ + customer_ref (NEW)      ║   CH = hot replay cache (TTL 90d)   │  {idem_key}.json.zst         │
   ║ append-only MergeTree     ║   S3 = durable SoT, crypto-shred   │  per-ws KMS prefix, lifecycle│
   ║ PII-TOKENIZED payload     ║                                    │  90d→Glacier IR→7y delete    │
   ╚═════════════╤═════════════╝                                    └──────────────────────────────┘
                 │  transform-graduation worker reads CH WHERE received_at > cursor
                 │  (cursor = PG raw_event_transform_state, migration 28)
                 │  dispatch by (vendor,event_type) → per-vendor mapper → FAIL-CLOSED contract
                 ▼
   ╔═══════════════════════════════════════════════════════════════════════════════╗
   ║ SILVER — typed facts (idempotent: PG ON CONFLICT + CH ReplacingMergeTree(ver)) ║
   ║  connector_order_facts / line_item / product / ad_spend / shipment / refund    ║
   ║  EVERY ROW: raw_event_id (provenance)  +  identity_cluster_id (stitched)        ║
   ╚═══════════════╤═══════════════════════════════════════════════════╤═══════════╝
                   │                                                   │
         ┌─────────▼──────────┐                          ┌─────────────▼────────────────┐
         │ IDENTITY (core-svc)│  consumes bronze →       │ GOLD — analytics-service      │
         │ salted email_hash, │  emits edges → MIN-label │ recompute_daily + CH MVs      │
         │ phone_hash (E.164) │  union-find →            │ → KPIs, Morning Brief, billing│
         │ → identity_cluster │  identity.cluster.v1     │ (gold reads silver, unchanged)│
         └────────────────────┘                          └───────────────────────────────┘

   REPLAY: fix a mapper bug → reset transform cursor → re-derive silver from bronze (per-tenant,
           idempotent). Never hand-patch CH. Bronze (CH cache OR S3 archive) is the replay source.
```

### 2.3 Why this shape

- **One ingest topology.** Both the lossy pull-sync (`sync-use-cases.ts:70-134`, discards the vendor payload) and the Shopify-only realtime consumer (`realtime-facts-consumer.ts:375`) collapse into produce→consume. Adding a vendor = a topic + a mapper + a registry row — never a new code path (Single-Primitive Rule).
- **The transform worker is the keystone.** It is the missing half of ADR-CONVERGENCE-001 finding B; the cursor (`migration 28`) already exists. It is what makes "new integration = new transform, no migration" *true*, and it simultaneously closes G1 (raw-wiring) and G5 (analytics coupling) — they are the same missing piece.
- **Provenance by construction.** `raw_event_id` on every silver fact makes a dashboard number traceable to a raw payload (today impossible) and turns DPDP erasure-scope from archaeology into a lookup.

---

## 3. Per-gap resolution

### G1 — Raw-landing wiring (CRITICAL) → RESOLVED at the root
- Ingestion *produces* the existing proto envelope; both pull and webhook paths stop writing facts directly. A single **raw-archiver consumer group** is the sole writer of bronze (CH `connector_raw_events` + S3 archive). This gives `0010` its first production writer.
- The **transform-graduation worker** reads bronze off the migration-28 PG cursor, dispatches by `(vendor,event_type)`, and idempotently UPSERTs silver facts.
- Non-Shopify vendors get a uniform topic + the same consumer — no bespoke per-vendor consumer.
- The per-vendor PG `raw_*` tables (the HOLD-AT-CUTOVER liability, full WooCommerce addresses) are **retired** in favor of one generic bronze store, shrinking the erasure graph from 7+ PII tables to 1.

### G2 — Durable cheap archive tier (HIGH) → RESOLVED (S3 raw now; Iceberg deferred)
- **New `BronzeStorageStack` CDK construct** (today `infra/cdk/bin/app.ts` has only `CredentialCustodyStack` + `CoreServiceTaskDefStack`): S3 bucket, per-workspace KMS-CMK key prefix, versioning, ap-south-1 residency assert, lifecycle 90d Standard → Glacier IR → delete 7y (`technical-context.md:109`).
- The **S3 raw write is non-fatal** (log+metric on failure) so PG+Kafka stay the live path while S3 is the durable archive.
- **CH `connector_raw_events` gets a TTL** (`MODIFY TTL received_at + INTERVAL 90 DAY DELETE` or `TO VOLUME 'cold'`) — it becomes a *replay cache*, not the durable copy (CH-hot is ~5-6x S3/Glacier cost for read-once archive data).
- **MSK tiered storage + Iceberg open format = DEFERRED** behind a concrete second-reader trigger. The S3 archive (compressed JSON, workspace-prefixed) is the blast-radius escape hatch; if Brain ever needs Iceberg, the same prefixes become an Iceberg landing with a Glue catalog.
- *Honest weakness:* CH-native parts are not an open format. A second engine reading Brain's bytes is a re-export, not a catalog point — this is the deferred Iceberg hedge, accepted at current scale (83k orders/anchor brand).

### G3 — Schema single-sourcing / PG↔CH drift (HIGH) → PARTIALLY (spine helps; codegen is the real fix)
- Collapsing 5-6 hand-edited writer sites (`chOrderRow`, phase8 backfill, PG/CH DDL) to **one transform mapper per (vendor,event_type)** shrinks the drift surface structurally.
- The streaming envelope adds the **Glue Schema Registry as the single source for the wire/event contract** with a CI BACKWARD-compat gate — which the current ad-hoc JSON envelope lacks.
- But this does **not** by itself eliminate fact-column drift. ADR-CONVERGENCE-001 **C1 codegen** (`canonical-facts.yaml` → CH DDL + PG DDL + TS row-builder + Py constants) is still required and is folded in as a hard pre-req. Until codegen lands: harden the existing CI gate to **full-column parity**, validate **writer column lists vs DDL**, and register **all 13 connector facts** (8 are ungated today).
- Apply **vendor ENUM→TEXT+FK** (`03-schema-connectors.sql:25`, still a 3-value enum) so vendor #4 is a data row, not an `ALTER TYPE` migration. (CTOA sign-off: typed-contract change, additive/reversible.)

### G4 — Cross-source identity (HIGH) → RESOLVED in-tier
- Identity lives in **core-service** (the locked Single-Primitive owner) as a **connected-components consumer** off the bronze topics.
- Add **deterministic salted `email_hash` + `phone_hash`** to `customer_pii` (E.164-normalized phone *first* — the dominant India COD key), populated at the PII-tokenizer chokepoint. The current AES-GCM ciphertext cannot be equality-joined; these hashes are the only viable cross-vendor match keys.
- A scheduled **SQL MIN-label union-find** (RudderStack ID-Stitcher pattern, Paradigm-1, ~free) assigns a **stable surrogate `identity_cluster_id`** (never leak the raw min-node-ID downstream), emitted on `identity.cluster.v1` and stamped onto silver facts by the transform worker.
- Decouple `customer_ref` from `vendor_customer_id` (`acl.ts:173-176`) — add a **per-workspace + per-vendor salt** so the same Shopify customer at two brands does NOT collide (closes the G6 cross-workspace inference breach too).
- **Probabilistic (Splink) + household linkage = OPT-IN, separately-scored, reversible** layers feeding the same edges table — a single false-positive edge permanently over-merges two clusters, so gate behind eval. Keep k≥5 cohort suppression intact (clustering shrinks distinct-customer counts).
- Build the missing **Klaviyo/Meta customer→fact normalization** path; today only Shopify contributes a `customer_ref`, so there is nothing to stitch against without it.

### G5 — Analytics↔warehouse coupling (HIGH) → RESOLVED for the keystone
- The **transform-graduation worker IS the missing raw→fact graduation** that makes "analytics built later" real; the migration-28 cursor is retired in favor of either the PG cursor (CH-read default) or consumer-group offsets (if read off Kafka).
- Wire `recompute_daily.py`'s four deferred inputs — **shipment facts** (rto_orders, total_shipments → CM2/True-CM2 correct), **misc_expenses** (workspace_costs PG lookup → CM3≠CM2), and **vendor_product_id propagation** (COGS join, the top P0 blocker). These are provably-wrong-on-live-data correctness gaps (`connector-pipeline-gaps.md`).
- Convert `@paradigm` docstring comments into **real decorator invocations** + a CI gate; the enforcement runtime (`brain_cost_router`) is fully built but unapplied at call sites.

### G6 — Governance / DPDP / erasure (CRITICAL) → RESOLVED with two gates promoted
See §4 for the full design. Summary:
- **Ingest-time PII tokenization (GATE, not track):** raw email/phone/name → salted hash + KMS-vaulted token at the chokepoint *before* the bronze write. Keeps the replayable log PII-light (the single largest liability otherwise).
- **WooCommerce full-address DDL fix (GATE, blocks Stage-8):** remove `billing_address_1` / `shipping_address_1`; retain only city/state/postcode.
- **`customer_ref` column on bronze (GATE):** makes per-subject erasure a bounded key-level delete, not a workspace-wide scan.
- **Erasure orchestrator** (core-service consent context): PG plaintext-wipe + tombstone → CH `ALTER DELETE` fanned out to **every** MV/projection → S3/cold crypto-shred (DEK destruction) → Kafka offset note → emit `COUNT=0` verification artifact. Honor DPDP §12 / 48h pre-erasure notice.
- **Status-gated retention** (ADR finding C): nightly purge of raw PII where status NOT IN (open/unfulfilled/disputed/partial) — exempts long-lifecycle India COD/returns orders.
- **Build the CH query gateway** (`pylibs/brain_clickhouse` stub → real): workspace_id-injecting, parameterized, FINAL-appending — Layer 4 of tenant isolation and the structural home for erasure mutations.
- **PII catalog as versioned YAML + CI assertion** (`docs/pii-catalog.yaml`): each new connector declares its PII fields as a merge prerequisite — without it, erasure scope at 100 integrations is undiscoverable in incident time.

---

## 4. Identity & DPDP-erasure design

### 4.1 Identity (deterministic-first, warehouse-native)
1. **Normalize + salted-SHA-256-hash** email (lowercase/trim) and phone (E.164) at the connector/tokenizer layer — analytics store links on hashes, never raw PII.
2. **Edges table** (per-workspace, partitioned by workspace_id): every co-occurrence of strong identifiers in one event = one edge. Strong identifiers only — never shared/household IP/device (monster-cluster risk).
3. **MIN-label connected-components** as a scheduled SQL/Python job (Paradigm-1, ~free); map each component to a stable surrogate `identity_cluster_id`.
4. **Per-tenant salt** prevents cross-workspace linkage and brute-force re-identification of low-entropy phone numbers.

### 4.2 DPDP erasure ladder (the key correctness surface)
| Tier | PII state | Erasure mechanism |
|---|---|---|
| PG hot-mirror | plaintext columns + tombstone | `SET email=NULL,... tombstoned_at=now()` |
| CH silver facts | tokenized refs + customer_ref | heavy `ALTER TABLE ... DELETE WHERE ws=? AND customer_ref=?`, **fanned out to every MV/projection** (deletes do NOT cascade — #1 silent-non-compliance bug), verify `COUNT=0` |
| CH bronze (hot) | tokenized payload | partition-scoped `ALTER DELETE` keyed on the **new `customer_ref` column** |
| S3 raw / Glacier / backups | KMS-DEK-encrypted PII columns | **crypto-shred** — destroy the per-subject DEK; ciphertext becomes permanently unreadable with no rewrite (the only mechanism that reaches immutable/cold/backup PII cheaply) |
| Kafka log | tokenized envelope | document offset as erased in audit_log (immutable); compaction tombstone on any keyed-PII topic |

**Honest caveats (judge findings, designed-in not deferred):**
- Crypto-shred per-subject DEK **must be assigned at write time** (no plaintext-first window); any mapper that decrypts-and-re-persists during replay voids the guarantee — enforced by the "never log/persist decrypted PII" observability rule + a WORM key-destruction ledger.
- MeitY has issued no guidance that key-destruction = physical deletion under §12. Because Brain's posture is **PII-light bronze** (tokenized at ingest), crypto-shred applies to a *small* PII vault, not the whole warehouse — so the contested surface is bounded, and we retain a verification artifact for the DPB.

### 4.3 ap-south-1 residency
S3 bucket + Glue catalog (if/when) + KMS + MSK + CH all pinned ap-south-1 (DPDP negative-list regime; SDF localization contingency). CDK asserts region at synth.

---

## 5. Cost / tiering model

| Line item | Phase 0-1 (now) | At scale (100+ integrations × N tenants × years) |
|---|---|---|
| **Bronze CH (hot cache)** | low tens-of-GB, ZSTD ~5-10x | bounded by 90d TTL; metadata-drop retention (`ttl_only_drop_parts=1`) |
| **S3 raw archive** | < ₹500/mo (anchor brand) | Glacier IR ~$0.004/GB/mo vs CH-hot ~$0.023 — 5-6x cheaper for read-once archive |
| **Silver/gold CH** | existing footprint | hot ≤90d NVMe → `TTL MOVE` cold S3; RECOMPRESS cold ZSTD(3) |
| **Transform + identity compute** | Paradigm-1 SQL/IO, **0 LLM tokens/day** | union-find is incremental (~5-6x cheaper than full rebuild) |
| **New infra delta** | +1 S3 bucket + lifecycle, +Glue Registry, +DLQ topic | +MSK tiered storage + Debezium **only at Phase-2 trigger** |

**Deliberately deferred cost lines (the whole point):** no Iceberg catalog to operate, no compaction job, no Debezium Connect cluster, no Flink, no ELT runtime. Total marginal ₹/mo over today's footprint at anchor scale ≈ **low single-digit ₹k/mo**, dominated by Glue Registry + S3, decoupled from GMV.

**Cost guardrails:** (1) bronze must be PII-light via ingest tokenization or it becomes the single largest storage+liability line; (2) keep the *durable* raw copy in S3, not CH; (3) async-insert batching on the bronze MergeTree to avoid too-many-parts from 100+ webhook-cadence connectors.

---

## 6. Migration sequence (extends ADR-CONVERGENCE-001 P0/P1/P2)

This **extends** the existing roadmap; ADR items keep their priorities, new warehouse-wiring slices interleave.

### P0 — correctness + gates (now; the ADR's P0 + the two promoted gates)
- **P0-A** ADR triage: net_sales double-tax (A), raw_events append-only confirmed (B), status-gated purge (C), canonical-fact CI drift gate + refund-name + subunit parity (2, F). *(ADR P0, in flight.)*
- **P0-B (NEW GATE):** PII tokenizer at the ingest chokepoint + **remove WooCommerce full-address columns** (`step-a-enable-create.sql:237-241`) + add **`customer_ref` to bronze `0010`**. *Blocks any bronze go-live and Stage-8.*
- **P0-C (NEW):** Wire the **bronze raw-archiver consumer** (G1) — CH `connector_raw_events` + S3 archive get their first writer; both ingest paths produce the envelope.

### P1 — pre-100-integration hardening (the ADR's P1 + the keystone)
- **P1-A** ADR P1: vendor ENUM→TEXT+FK + ALTER DEFAULT PRIVILEGES + archetype field (1, 3); FINAL auto-enforce + PREWHERE (E, 5); fact-schema **codegen** + MV apply/sunset (2, I); multi-currency CM guard (G).
- **P1-B (NEW, keystone):** Build the **transform-graduation worker** (G1+G5) off the migration-28 cursor; add **`raw_event_id` provenance** to every silver fact.
- **P1-C** ADR #4 + G4: `email_hash`/`phone_hash`/`identity_cluster_id` columns + connected-components stitcher + per-workspace customer_ref salt + cohort guard.
- **P1-D (NEW):** S3 `BronzeStorageStack` CDK + lifecycle; CH bronze TTL; fail-closed data contracts + DLQ topic + Glue Registry BACKWARD CI gate.
- **P1-E (NEW):** Wire `recompute_daily.py` deferred inputs (shipment/misc_expenses/vendor_product_id); `@paradigm` decorator + CI gate; build the CH query gateway; PII catalog YAML + CI.
- **P1-F (NEW):** Erasure orchestrator (PG+CH+S3 crypto-shred+Kafka note+COUNT=0).

### P2 — scale / triggered (the ADR's P2 + deferred grafts)
- ADR P2: Replicated-engine activation; FX write path; identity graph (probabilistic).
- **MSK tiered storage + Debezium** (internal PG→Kafka outbox) — behind the `TECH/00` MSK graduation trigger, **never before**.
- **Iceberg/S3-as-source-of-truth + Glue catalog + compaction** — behind a concrete second-reader trigger.

### Product-gated (Founder)
- ADR J: settlement / marketplace-fee / returns-first-class / inventory-ledger / COD-remittance archetypes.

---

## 7. ADRs to record
1. **Bronze writer = Kafka raw-archiver consumer group** (single writer of `connector_raw_events` + S3), superseding inline DB writes.
2. **S3 raw archive as Phase-1 durable source-of-truth; CH bronze = replay cache with TTL.** Iceberg/open-format deferred behind a second-reader trigger.
3. **Ingest-time PII tokenization is a gate on bronze go-live** (keep the replayable log PII-light).
4. **Per-subject crypto-shred (KMS DEK) for cold/immutable/backup PII**; heavy CH `ALTER DELETE` + MV fan-out for hot; `customer_ref` on bronze for bounded erasure.
5. **Identity: deterministic salted-hash + MIN-label connected-components in core-service**; probabilistic/household opt-in + reversible.
6. **Internal connector SDK adopts the Airbyte 4-verb contract + net-additive/null-and-log**; build, not buy.
7. **MSK tiered storage + Debezium + Iceberg are Phase-2/trigger-gated**, not Phase-0/1 (over-reach = Postgres-primary outage risk).
8. (Inherits ADR-CONVERGENCE-001 ADRs 1-6 unchanged.)

---

## 8. Risks & reversibility
- **Transform worker is a new critical-path SPOF** — if it stalls, ALL silver goes stale (not one vendor). Needs its own freshness SLA, lag alerting, retry/backoff, and DLQ. *Reversible:* re-derive from bronze; per-tenant replay isolates blast radius.
- **Bronze single-copy until S3 lands** — sequence P1-D (S3) close behind P0-C (bronze writer) to minimize the CH-only-copy window. *Reversible:* S3 archive is the escape hatch once wired.
- **Crypto-shred is contested by regulators** — mitigated by PII-light bronze (small vault), WORM key-destruction ledger, COUNT=0 artifact.
- **Codegen not built = G3 only partially closed** — drift can still ship on ungated facts; harden the CI gate to full-column parity as the interim backstop.
- **Migration touches the hottest code** (`acl.ts`, `sync-use-cases.ts`, `ingest.py`, `realtime-facts-consumer.ts`) — preserve the proven Shopify webhook→facts path during cutover; ship behind the existing `REALTIME_FACTS_CONSUMER` / `BRAIN_WEBHOOKS_ENABLED` flags.
- **Replay double-counting** — ReplacingMergeTree dedup is eventual; make "every fact sink is keyed + idempotent, read with FINAL" a CI conformance invariant or replay corrupts %-of-GMV billing.

**Overall reversibility:** every move wires what is already designed and committed; the bronze boundary is a clean seam (swap S3↔Iceberg, swap CH-read↔Kafka-read for the transform cursor, fall back to bespoke Shopify webhook) without touching silver/gold.

---

## 9. Open questions for the Founder
1. **MSK graduation timing.** Phase-0/1 can run MSK-Serverless or single-broker Kafka; full MSK + tiered storage + Debezium is the `TECH/00` Phase-2 trigger. Confirm we hold Debezium until then (WAL-slot outage risk for a small team).
2. **Iceberg trigger.** Do we have a *named* second reader on the horizon (external BI, ML feature store, regulator export) that would pull Iceberg forward from "deferred" — or is CH-only-with-S3-archive correct for the next 12 months?
3. **ADR J archetypes** (settlement / marketplace-fee / returns-first-class / inventory-ledger / COD-remittance) — product-scope call; gates whether bronze must accommodate Razorpay/Cashfree/Amazon/Flipkart/Meesho vendor classes now.
4. **SDF status.** If Brain or an anchor brand crosses DPDP SDF thresholds (~2cr users, annual DPIA/audit/DPO), cold-tier localization hardens from default to mandate — affects S3 region posture and crypto-shred acceptance.
5. **Crypto-shred acceptance.** Are we comfortable that key-destruction + COUNT=0 artifact is our §12 evidence for cold-tier PII, pending MeitY guidance — or do we want physical-delete-only (more expensive, slower) for the cold tier?

---

## Completeness-gate resolutions

> Appended 2026-06-05 in response to the CTO completeness gate. Each gap below is either **RESOLVED in design** (the implementation contract is now specified to a code-review-gateable level) or **CONSCIOUSLY DEFERRED** (with reason + the concrete trigger that pulls it forward). The proposal's §6 sequence is updated where a gap was reclassified. Every claim is grounded in a verified `file:line` from the committed tree.

The standing correction the gate is right about: **§1–§5 described several mechanisms as if operational that have zero callers today.** This section converts each design claim into either (a) a buildable spec with a builder owner + acceptance contract, or (b) an explicit defer. No mechanism below is allowed to remain a "gate" without an implementation contract — a gate with no code is false assurance, exactly as the reviewer flagged.

### R1 — PII tokenizer: from claim to a wired chokepoint (gap: critical) → RESOLVED in design, GATES bronze go-live

**Verified state:** `ingest.py:360` builds the Kafka envelope with `"payload": json.dumps(event.columns)…` — raw `event.columns` verbatim, including every PII field the adapter's `pii_manifest` declares (`pii_manifest.py:28` only *checks* the manifest, it does not *redact*). There is no tokenizer, no salted hash, no KMS write. The security finding (S8-C2 "Kafka envelope carries raw PII") is real and currently unmitigated.

**Resolution — concrete call-stack placement (P0-B, blocks bronze go-live):**
1. **Where it sits:** a new pure-domain `domain/framework/pii_tokenizer.py` (no I/O) + an `infrastructure/pii/kms_vault.py` adapter. It is invoked inside `ingest_batch` (`ingest.py:379`) and the webhook path (`webhook_intake.py:234`) **on `NormalizedEvent.columns` BEFORE `_produce_kafka` is called** — i.e. the envelope `_produce_kafka` serializes is already tokenized. This is the single chokepoint both ingest paths share (Single-Primitive), so no per-vendor fork.
2. **Hashing scheme:** for each field in `adapter.pii_manifest`, replace the raw value in `columns` with `tok:<HMAC-SHA256(per-workspace-salt, normalized_value)>`. Email lowercased/trimmed; phone E.164-normalized **before** hashing (so the same number from Shopify and Klaviyo hashes identically — this is also the G4 join key). HMAC (keyed), not bare SHA-256, to defeat rainbow-table re-identification of low-entropy phones.
3. **Which key store:** the per-workspace salt is a KMS-wrapped secret in AWS Secrets Manager, reusing the existing `CredentialCustodyStack` envelope-encryption pattern (`infra/cdk/bin/app.ts:15`) — no new key infra. The raw plaintext PII needed for downstream messaging (email/phone for a recovery send) is written to the `customer_pii` PG vault (`07-schema-customer-pii.sql:23-25`, `email_ct/phone_ct/full_name_ct`, already AES-256-GCM) under a **per-subject DEK** keyed by `(workspace_id, customer_ref)` — that DEK is the crypto-shred unit in §4.2.
4. **Replay / re-hash behavior (the reviewer's sharp question):** the salt is **versioned and append-only — never rotated in place.** A `salt_version` travels in the envelope and onto bronze (see R9). Re-hashing a historical event during replay reuses the salt of *that event's* `salt_version`, so hashes are stable across replays and old↔new joins never silently break. Salt rotation = a new version + a backfill job that re-stamps `identity_cluster_id`, never an in-place overwrite. This directly answers gap R10(1).

**Acceptance contract (pass-1 REQUIRED, gates Stage-8 bronze go-live):** code-review must verify (a) no field named in any adapter's `pii_manifest` appears un-tokenized in the bytes `_produce_kafka` emits — assert with a test that snapshots the produced envelope for a Shopify order containing `email/first_name/last_name` and greps for the plaintext; (b) HMAC keyed by per-workspace salt, phone E.164-normalized pre-hash; (c) `salt_version` present in envelope; (d) plaintext lands only in `customer_pii._ct` columns, never in Kafka, never in CH bronze. Owner: **@maya** (ingestion py). This is NOT deferred — it is the gate.

### R2 — Erasure orchestrator: from prose to a buildable use-case (gap: critical) → reclassified P1-F → **P0-D (prerequisite for any live customer data)**

**Verified state:** `customer_pii` *does* carry `tombstoned_at` (`07-schema-customer-pii.sql:41`) and the design comment "Erasure tombs the row" (line 8) — so the gate's claim that the column is missing is stale on that one point. But the gate's substance holds: there is **no orchestrator, no MV fan-out, no erasure action-type in `audit_log`, no §12 notice data model, and `pylibs/brain_clickhouse` is a stub** (`__init__.py` only). Nothing executes the five-tier ladder of §4.2.

**Resolution — concrete implementation contract (reclassified to P0-D):**
- **Home:** core-service `domain/consent/` (the Single-Primitive consent owner) — a `EraseSubject` command + use-case in `application/commands/`, not scattered SQL.
- **Data model additions (migration):** (a) `audit_log` gains an `action` value `subject_erasure` + a `subject_erasure_request` table `(workspace_id, customer_ref, requested_at, notice_window_ends_at, executed_at, count_zero_verified_at, status)` — `notice_window_ends_at = requested_at + 48h` implements the DPDP §12 pre-erasure notice with a real timestamp, not a comment; (b) a WORM `key_destruction_ledger` (append-only, for the crypto-shred audit trail of §4.2).
- **MV fan-out (the silent-non-compliance bug):** ClickHouse `ALTER … DELETE` does NOT cascade to MVs/projections. The orchestrator reads a **generated `erasure_targets` manifest** — emitted by the same `canonical-facts.yaml` codegen (ADR-CONVERGENCE-001 C1) that owns the fact DDL — listing every silver table + every MV/projection derived from a table carrying `customer_ref`. The erasure use-case iterates that manifest. This makes fan-out **mechanically complete by construction** (a new MV added without registering = CI fail), not a hand-maintained list that rots. This is why R2 is sequenced *with* the codegen (P1-A) for the MV manifest, but the PG-wipe + CH-bronze + S3-crypto-shred tiers ship at P0-D since they don't need the MV manifest.
- **Verification artifact:** after the ladder runs, a `COUNT(*) … WHERE customer_ref=? AND ws=?` across every manifest target must return 0; the result row + the key-destruction ledger entry are the DPB evidence, stamped `count_zero_verified_at`.

**Acceptance contract (pass-1 REQUIRED):** one `EraseSubject` end-to-end test that ingests a subject across 2 vendors, runs erasure, and asserts COUNT=0 on PG hot-mirror, CH silver, CH bronze, and a registered MV; asserts the per-subject DEK is destroyed (decrypt now fails); asserts `audit_log` carries `subject_erasure` and the §12 notice window was honored. Owner: **@vikram** (core-service TS) with **@maya** on the CH-side delete via the gateway (R7). Reason for the reclassification: the gate is correct that this is a **prerequisite, not a P1** — no live anchor-customer PII may enter the warehouse before a working erasure path exists, because DPDP penalties accrue per request.

### R3 — `customer_ref` on bronze: a migration, not a comment (gap: high) → RESOLVED, GATE

**Verified state:** `0010_connector_raw_events.sql` (read in full) has columns `workspace_id, vendor, event_type, idempotency_key, received_at, event_at, payload, payload_version, ingested_at` — **no `customer_ref`.** `canonical-facts.yaml` carries `customer_ref` only on silver (`connector_order_facts`). The gate is exactly right.

**Resolution (folded into P0-B, the same gate as R1):** ship migration `0011_bronze_add_customer_ref.sql` — `ALTER TABLE brain.connector_raw_events ADD COLUMN customer_ref String DEFAULT ''` (nullable-safe default so historical rows don't break), populated by the tokenizer (R1) at produce time from the salted identity hash. Bronze erasure (§4.2 tier 3) then becomes `ALTER … DELETE WHERE workspace_id=? AND customer_ref=?` — partition-and-key scoped, not an `O(workspace_rows)` full scan. Because the table is `PARTITION BY toYYYYMM(received_at)` the delete is further bounded to touched partitions. **Acceptance:** migration present + applied in the bronze-writer slice (P0-C cannot merge without 0011); the bronze writer (R-keystone) must populate `customer_ref` on every row. This is the gate — a migration, not a TODO. Owner: **@maya**.

### R4 — Glue Schema Registry + BACKWARD gate + DLQ (gap: high) → SPLIT: DLQ now (P1-D), Registry **consciously deferred** behind a named trigger

**Verified state:** `ingest.py:369` emits `json.dumps(envelope).encode()` — schema-less JSON. No registry client, no Avro serializer, no Glue call, no DLQ producer, no CI BACKWARD gate anywhere in `apps/ingestion-service`. §2.2's diagram shows these as operational; they are not.

**Resolution — honest split:**
- **DLQ ships now (P1-D, RESOLVED):** a `integrations.dlq.v1` topic + a producer the transform worker (R5) writes to on parse/contract failure, so a bad event becomes a *queryable row*, never a silent log+skip. This is cheap, needs no registry, and is the safety net for the schema-less interim — so it is **not** deferred.
- **Glue Registry + Avro + BACKWARD CI gate: CONSCIOUSLY DEFERRED to P2.** *Reason:* standing up Avro codegen + a Glue Registry client + a CI breaking-change gate is a multi-week build that does not block the next 1–2 integrations, and the **BACKWARD-compat guarantee is achievable in the interim** via the canonical-facts codegen (ADR C1) owning the wire envelope shape + a JSON-schema validation step in the transform mapper (fail-closed → DLQ). *Trigger that pulls it forward:* **integration #5, OR the first time two independent consumers read the same `integrations.<vendor>.v1` topic** (today only the transform worker consumes it; the registry's value is a contract boundary between *multiple* consumers). Until then the single-consumer + DLQ + codegen'd envelope is sufficient. **ADR-7-bis records this.** The gate's "archaeology at integration #15" risk is real but lands at #5, well inside the trigger.

### R5 — transform-graduation worker: the keystone gets a real spec (gap: high) → RESOLVED in design, sequenced FIRST among new builds

**Verified state:** the cursor table exists (`28-raw-event-transform-cursor.sql`), but `grep` across `apps/ingestion-service/src/` for `transform_state|graduation` returns **nothing** — no worker, no dispatch table, no SLA, no DLQ wiring, no per-tenant isolation. §2.3 calls it "the keystone" and §8 calls it a SPOF but proposes only "needs lag alerting."

**Resolution — concrete spec (P1-B, must ship before integration #2):**
- **Shape:** a Kafka-consumer use-case in ingestion `interfaces/consumers/transform_consumer.py` → `application/use-cases/graduate_raw_event.py`. Reads bronze `WHERE received_at > cursor` (CH-read default per `0010`), dispatches via a **`(vendor, event_type) → mapper` registry table** (a dict in `domain/framework/transform_registry.py`, one mapper per pair — Single-Primitive; a new vendor = a registry row + a mapper, never a new consumer).
- **Retry/backoff + DLQ:** N bounded retries with exponential backoff; on terminal failure → `integrations.dlq.v1` (R4) with the `raw_event_id` + error, and the cursor **advances past** the poisoned event (a fail-closed contract violation must not head-of-line-block the tenant). The DLQ row is replayable once the mapper bug is fixed.
- **Freshness SLA:** silver-staleness = `now() - cursor.last_processed_received_at`. **Page at >15min p95 per workspace**, warn at >5min. Emitted as a CloudWatch metric `transform_lag_seconds{workspace_id}` (observability is CloudWatch/X-Ray per the locked stack, NOT Prometheus).
- **Per-tenant isolation (answers gap R11):** see R11 — the cursor and the consumer-group topology are sharded so one stalled tenant does not block others.

**Acceptance contract (pass-1 REQUIRED):** test that (a) a poison event routes to DLQ and the cursor still advances; (b) `transform_lag_seconds` is emitted per workspace; (c) a new `(vendor,event_type)` is added by registry row only (no consumer edit); (d) re-running over the same bronze rows is idempotent (silver UPSERT keyed). Owner: **@maya**. **This is the keystone and ships before any new integration adopts the old bespoke-consumer pattern** — the window is the next integration, not P1-generic.

### R6 — vendor ENUM → TEXT+FK: unblock Shiprocket today (gap: high) → RESOLVED, pulled into P0

**Verified state:** `03-schema-connectors.sql:25` — `CREATE TYPE connector_vendor AS ENUM ('SHOPIFY', 'META', 'GOOGLE')` — still a live 3-value ENUM, and it propagates: `customer_pii.source_vendor connector_vendor` (`07-schema-customer-pii.sql:19`), `05-schema-connector-facts.sql:22` reuses it, and `phase5-legacy-facts-to-pg.sql:524` already casts `'SHIPROCKET'::connector_vendor` — which **will fail** because SHIPROCKET is not in the enum. `connector-pipeline-gaps.md` lists WOOCOMMERCE/KLAVIYO/UNICOMMERCE as required.

**Resolution — pulled from P1-A into P0 (it blocks Shiprocket = P0-1 in connector-pipeline-gaps):** migration converts `connector_vendor` ENUM → `TEXT` with an FK to a `connector_vendors(code TEXT PK, archetype TEXT)` registry table (ADR-CONVERGENCE-001 finding #1). Reversible (the registry is additive; existing values map 1:1). Seed SHOPIFY/META/GOOGLE/SHIPROCKET/WOOCOMMERCE/KLAVIYO/UNICOMMERCE. After this, vendor #4 is an `INSERT` row, never an `ALTER TYPE` coordinated across `customer_pii` + all fact tables. **CTOA sign-off:** typed-contract change, additive + reversible (within Aryan's authority; flagged for CTOA visibility because it touches a cross-table type). Owner: **@vikram** (core-service migration) + **@maya** (analytics fact tables that reference vendor). Reason for the pull: every day live without this miscalculates realized GMV (the billing base) as ~0 RTO / ~0 delivery for Shiprocket-shipped orders.

### R7 — BronzeStorageStack CDK + bounded CH-only window (gap: high) → RESOLVED, window now SLA'd

**Verified state:** `infra/cdk/bin/app.ts` instantiates only `CredentialCustodyStack` (line 15/20) and `CoreServiceTaskDefStack` (line 16/36). There is **no `BronzeStorageStack`.** §2.1/§6 sequence P1-D (S3) *after* P0-C (bronze writer), creating an unbounded CH-only window.

**Resolution:**
- **Build the stack (P1-D):** new `infra/cdk/lib/bronze-storage-stack.ts` — S3 bucket, per-workspace KMS-CMK key prefix (reusing the CredentialCustody key pattern), versioning ON, an explicit `ap-south-1` residency assert at synth (`if (region !== 'ap-south-1') throw`), lifecycle 90d Standard → Glacier IR → delete 7y. Registered in `bin/app.ts`.
- **Close the unbounded-window hole (the gate's real point):** the CH-only window between P0-C and P1-D is now **SLA'd to ≤14 days and explicitly risk-accepted in writing**, with two compensating controls during the window: (1) CH bronze TTL is **NOT** applied until S3 is live (so CH stays the durable copy, not a 90d cache, until its replacement exists — this removes the "disk full / DROP / upgrade = total loss" path); (2) a daily CH `BACKUP TABLE connector_raw_events TO S3(...)` snapshot runs as a stopgap from day one of P0-C, so even pre-stack there is an independent copy. P1-D must land within 14 days of P0-C or the bronze writer is feature-flagged off. Owner: **@karan**/platform (CDK) — *correction: CDK/infra track owner is the platform builder*; tag **@vikram** for the `bin/app.ts` wiring + the BACKUP cron.

### R8 — consent state as first-class bronze columns (gap: medium) → RESOLVED

**Verified state:** `_produce_kafka` puts `lawful_basis` and `purpose_code` in the envelope (`ingest.py:361-362`) — good — but `0010` bronze has **no such columns**; they survive only inside the envelope JSON, and the PG raw tables that *do* carry them NOT NULL are being retired (§3 G1). So a "all events under `purpose_code=analytics_performance` for ws X" query would be a JSON scan over TB of bronze.

**Resolution (folded into the R3 migration `0011`):** add `lawful_basis LowCardinality(String)` + `purpose_code LowCardinality(String)` as first-class bronze columns alongside `customer_ref`, populated by the raw-archiver from the envelope fields (`ingest.py:361-362`) at write time. `LowCardinality` keeps them near-free on storage and indexable. DPDP §6 purpose-compliance audit becomes a column filter, not a JSONB grep. **Acceptance:** `0011` adds all three columns (customer_ref + lawful_basis + purpose_code); the bronze writer populates them; a purpose-filter query plan reads the column, not the payload. Owner: **@maya**.

### R9 — `@paradigm` enforcement runtime wired + CI gate (gap: medium) → RESOLVED

**Verified state:** the real decorator exists and is tested (`pylibs/brain_cost_router/paradigm.py:99` `def paradigm(tier)`), but every analytics call site is **docstring-only**: `main.py:4`, `recompute_daily`, `cost_stack_query.py:3`, etc. carry `@paradigm: sql` as a *comment*. The CI gate rejecting un-declared LLM calls does not exist.

**Resolution (P1-E):** (1) convert docstring `@paradigm: <tier>` comments at all analytics/intelligence call sites into real `@paradigm("<tier>")` decorator invocations from `brain_cost_router`; (2) add a CI gate (`tools/ci/paradigm_gate.py`) that AST-scans for any call into an LLM SDK (anthropic/openai client) NOT inside a function carrying a live `@paradigm` decorator → fail the PR. This wires the already-built enforcement runtime to the call sites and gives the 85/12/2.5/0.5 paradigm-distribution dashboard something real to count. **Acceptance:** a PR adding a bare Sonnet call without `@paradigm` fails CI; the transform worker's mappers (R5) all carry `@paradigm("sql")`. Owner: **@maya**.

### R10 — identity correctness: salt rotation, surrogate stability, edges k-guard (gap: medium) → RESOLVED in design

**Verified state:** `customer_pii.customer_ref = sha256(vendor customer id)` (`07-schema-customer-pii.sql:18`) — **no per-workspace salt today** (confirms the cross-workspace-collision concern) and bare SHA-256 (re-identifiable). §4.1 says "stable surrogate" + "per-tenant salt" but specifies no mechanism.

**Resolution — the three sub-gaps explicitly:**
1. **Salt generation + rotation:** per-workspace salt is a versioned Secrets Manager secret (R1.3). **Rotation is append-only with `salt_version`** — never in place. Historical `email_hash`/`phone_hash` joins reference the salt version they were written under (the version is on bronze per R1/R3), so a rotation never silently breaks a historical join; it triggers a backfill re-stamp, not a break.
2. **Stable surrogate (the MIN-label instability bug):** the MIN node-id of a connected component is **NOT** exposed downstream. Instead, the first time a component is observed, it is assigned an **immutable opaque `identity_cluster_id` (UUID) stored in a `identity_cluster_registry(workspace_id, min_label, cluster_id)` mapping.** When a new edge merges two components, the union-find keeps the surviving component's *existing* `cluster_id` (tie-break: oldest `cluster_id` wins), and the absorbed cluster's facts are re-stamped to the survivor via a recorded merge event — the UUID stored on silver facts **never changes identity meaning**, only points of two-clusters-becoming-one are recorded. This is the stabilization mechanism §4.1 referenced but did not specify.
3. **k≥5 guard on the edges table itself:** in addition to the LTV cohort suppression, the identity edges/cluster export is suppressed for any cluster in a workspace whose distinct-customer count < 5 — a 1-customer workspace cannot expose that customer's cross-vendor identity graph. Owner: **@vikram** (core-service identity) + **@maya** (the union-find job). **Acceptance:** test that a salt rotation does not break a pre-rotation join; that merging two clusters preserves the older `cluster_id` on all downstream facts; that a <5-customer cluster is suppressed from any export.

### R11 — noisy-neighbor / per-tenant isolation at the transform tier (gap: medium) → RESOLVED in design

**Verified state:** `workspace_id` is the partition key (`ingest.py:348`) — ordering within a workspace is guaranteed — but there is one raw-archiver + one transform consumer group for all tenants, no per-tenant lag SLA, no per-tenant circuit breaker. A flash-sale tenant or a Shopify 5xx-retry storm lags every tenant.

**Resolution (folded into R5, the transform worker spec):**
- **Partition count scaling:** the `integrations.<vendor>.v1` topics are provisioned with a partition count ≥ the consumer-group parallelism target (start 12, scale to MSK graduation), so per-workspace partitions spread across consumers — one hot workspace occupies a bounded subset of partitions, not the whole group.
- **Per-tenant cursor + circuit breaker:** the migration-28 cursor is already keyed by workspace (it is `raw_event_transform_state`), so a stalled mapper for tenant A advances tenant A's cursor independently and does not move tenant B's. The transform consumer applies a **per-(workspace,vendor) circuit breaker** — after K consecutive terminal failures for one tenant, that tenant's events route straight to DLQ and a `transform_circuit_open{workspace_id}` alarm fires, while other tenants keep flowing.
- **Per-tenant lag SLA:** `transform_lag_seconds{workspace_id}` from R5 is the SLA signal; the page is per-workspace, so one tenant's breach is not framed as a global breach. **Acceptance:** load test where one workspace produces 10k events/min and a second workspace's lag stays under the 5-min warn threshold. Owner: **@maya** + platform for partition-count IaC.

### R12 — historical backfill provenance for pre-bronze data (gap: medium) → CONSCIOUSLY DEFERRED with a named decision for the Founder

**Verified state:** 83k orders / 346k line items already in `connector_order_facts` were ETL'd directly (legacy migration), never written through bronze — they have no `raw_event_id`, cannot be replayed through the transform worker, and their `customer_ref` provenance joins to bronze will be empty.

**Resolution — honest defer (no clean fix exists, so name the trade-off):** there are only three options and all have a cost: (a) **leave historical facts as-is** with `raw_event_id = NULL` and a `provenance = 'legacy_etl'` marker column → the provenance guarantee is *true for all post-bronze data and explicitly NULL-marked for pre-bronze*, which is honest and cheap; (b) **synthesize bronze rows** from the existing PG raw tables before they're retired (only possible where a raw table still holds the payload — Shopify/Woo do, Meta/Google facts were derived lossily so cannot be reconstructed); (c) **re-pull from vendors** within each adapter's `ReplayCapability` window (`adapter.py:46` — `FULL_60D` for Shopify only; Meta/Google = `WINDOW`, so >window history is unrecoverable). **Recommendation: (a) as the default + (b) opportunistically for Shopify/Woo where the raw payload survives, since Shopify is the anchor customer's GMV base.** This is **DEFERRED to the bronze-writer slice's follow-up** because it does not block the writer landing, but it is surfaced as **Open Question #6** for the Founder because it affects billing-provenance claims for the anchor customer on day 1. *Trigger to force (b)/(c):* a billing dispute or an auditor request that demands `raw_event_id` traceability for a pre-go-live order. **Acceptance for the marker:** add `provenance` + nullable `raw_event_id` to silver facts so the gap is *visible and queryable*, never silently implied-present.

### Sequence delta (updates §6)

| Item | Was | Now | Reason |
|---|---|---|---|
| PII tokenizer + `customer_ref` + consent columns on bronze | P0-B (gate) | **P0-B unchanged, contract now concrete** (R1, R3, R8) | gate had no impl; now has call-stack spec |
| Erasure orchestrator | P1-F | **P0-D** (R2) | prerequisite for any live PII, not P1 |
| vendor ENUM→TEXT+FK | P1-A | **P0** (R6) | blocks Shiprocket = P0-1 today |
| DLQ topic | P1-D | **P1-D, RESOLVED** (R4) | cheap safety net, ships |
| Glue Schema Registry + BACKWARD gate | P1-D (implied operational) | **DEFERRED to P2** behind "integration #5 / 2nd consumer" trigger (R4) | multi-week build, not blocking; codegen+DLQ bridge |
| transform worker | P1-B | **P1-B, full spec + per-tenant isolation** (R5, R11) | keystone, ships before integration #2 |
| BronzeStorageStack + ≤14d CH-only window SLA | P1-D | **P1-D, window now bounded + BACKUP stopgap** (R7) | unbounded-loss window closed |
| `@paradigm` decorator + CI gate | P1-E | **P1-E, RESOLVED** (R9) | runtime built, now wired |
| historical backfill provenance | unspecified | **DEFERRED + marker column + Open Q#6** (R12) | no clean fix; make it visible |

### Open questions added for the Founder

6. **Pre-bronze historical provenance (R12).** Accept option (a) — historical facts marked `provenance='legacy_etl'`, `raw_event_id=NULL`, with opportunistic Shopify/Woo bronze synthesis — as the day-1 posture? Or fund a full re-pull (bounded by each vendor's replay window, so Meta/Google history is partially unrecoverable regardless)? This affects the billing-provenance claim for the anchor customer on go-live day.
7. **Glue Registry defer (R4).** Confirm the registry + Avro + BACKWARD CI gate hold until integration #5 / second-consumer trigger, with the codegen'd envelope + DLQ + transform-mapper JSON-schema validation as the interim contract boundary — or pull it into P1 if a second independent consumer of `integrations.<vendor>.v1` is already on the roadmap.
