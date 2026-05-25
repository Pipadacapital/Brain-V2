# Requirement: Connector framework — per-connector single-owner cutover — Brain-native (Child 3)

> Drafted from the binding Child-0 migration architecture (Child-3 row + A6 token-handoff ceremony + A4 rollback tree + §connector token table + §count-based-parity carve-out). Founder/Rohan can edit at Stage 1.

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` |
| **Title** | Connector framework — per-connector single-owner cutover — Brain-native (Child 3) |
| **parent_epic** | `chore-migrate-legacy-to-brain` |
| **epic_child_id** | `child-3-connector-framework` |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T19:30:00Z |
| **Tier impact** | all (ingestion underpins every downstream metric/AI surface) |
| **Region impact** | in (Shopify/Meta/Google/Shiprocket/Klaviyo India connectors; residency ap-south-1 enforced) |

---

## Lane *(to be set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | *(set by Rohan)* — expected **high-stakes** |
| **trigger_surfaces_touched (first-pass)** | `connectors`, `auth` (OAuth/token handling), `pii` (customer/order PII at ingest), `multi-tenancy` (workspace-scoped writes), `india-compliance` (DPDP at ingest; secrets), `schema-proto` (raw event store + Kafka topics) |
| **paradigm (first-pass)** | `sql` + connection/OAuth/event-handling (idempotent UPSERT + Kafka producer; no ML, no LLM) |
| **persona_count** | *(0–2, set by Rohan — connector-cutover / token-handoff realist is the obvious candidate)* |

---

## Raw text (from Founder)

> Resume the money feature epic's next child. (Standing directive, 2026-05-24: "go ahead with all childs without asking, i will approve at last.")

---

## Problem statement

Child 3 of the strangler-fig migration. The legacy `looqus` stack ingests from Shopify, Meta Ads, Google Ads, Shiprocket, and Klaviyo with **vendor credentials in legacy plaintext** and cross-workspace `findMany` fan-out. Brain needs a **Brain-native connector/ingestion framework** that receives each vendor's events **workspace-scoped, idempotently, into the raw event store (Postgres under RLS) + Kafka `integrations.*.v1`**, with credentials rotated into Brain Secrets Manager.

Per the binding Child-0 architecture, Child 3 is a **SINGLE-OWNER CUTOVER, not a shadow slice** — tokens/webhook ownership live in exactly one system at a time. It is named the slice "most likely to force a big-bang," mitigated by the **per-connector token-handoff ceremony (A6)** + **rollback decision tree (A4)** so it stays reversible *per connector* rather than all-or-nothing.

## Scope (from Child-0 architecture — Rohan to confirm/split at Stage 1)

**In scope (the binding Child-3 row + carry-forwards):**
- Brain-native connector framework: OAuth flows + idempotent UPSERT + Kafka producer to `integrations.*.v1` + raw archive + cursor persistence (same code path for live + backfill; bounded vs unbounded window). All writes workspace-scoped via the Child-1 `withWorkspace` primitive.
- **Per-connector token-handoff ceremony (A6):** token lives in exactly one system at a time; credential rotated into Brain Secrets Manager; **legacy plaintext credential deleted at that connector's cutover (C8)**; per-connector data-loss window + replay availability + rollback decision tree (A4).
- **Count-based + event-field-spot-check parity** per connector (NOT the numeric shadow-compare — explicitly carved out at architecture §655-669). Open question **M-A5-Q3**: rollback window N per connector.
- **Shiprocket special-case:** no replay available → longer shadow + attempted-vs-connected alarm.
- **Child-1 HOLD-AT-FORCE unlock (carry-forward):** convert the residual no-context writers (the O7 carry-forward — discoverChannels, backfill*, etc., now rebuilt Brain-native and context-aware by construction) so the **complete bare-write grep returns ZERO hits** (the legacy grep was DEFECTIVE — must NOT exclude backfill/discoverChannels). This is the precondition that lets Child-1's FORCE ceremony eventually run.

**Out of scope (deferred per architecture):**
- Money Decimal→MU conversion (Child 2 — connectors land **raw**; money conversion is a compute concern, not an ingest concern).
- ClickHouse materializations / metric registry (Child 4).
- AI surface (Child 5).

## Dependencies

- **Child 1 (RLS/tenancy gate): SATISFIABLE** — met (committed; `withWorkspace`/`withSuperadmin` primitive present in `apps/core-service`). Child 3 depends only on Child 1's gate per the architecture DAG (it ingests raw; does not require Child 2's money rep).
- Brain Secrets Manager available for credential rotation.
- Legacy = **reference-only** (CF-BN-NOLEGACY-1): build Brain-native; never edit/commit legacy app code.

## Constraints carried forward (Rohan to bind at Stage 1)

- `CF-BN-NOLEGACY-1` (legacy reference-only), `CF-RES-1` (residency ap-south-1 positive-assert), `CF-SEC-1`/`CF-SEC-5` (RLS fail-closed + traceability), `CF-SEC-SECRETS-1` (no plaintext creds; rotation + legacy-delete-at-cutover), `CF-SEC-3` (DPDP lawful-basis for ingested PII — re-arms if third-party-brand PII enters prod).
- Single-owner cutover (C1/C8), single-writer discipline (C2), per-connector reversibility (A4/A6).

## Notes for Stage 1 (Rohan)

- This is **NOT** a resume of an interrupted pipeline — it is a fresh Child-3 intake.
- Likely escalation surfaces to weigh: webhook single-ownership cutover risk (data-loss window), the M-A5-Q3 rollback-window decision, and whether the residual-writer-conversion-for-FORCE-unlock belongs fully in this child or splits.
- Branch/build sequencing note (for Stage 2/3, not Stage 1): Child 3 build needs the Child-1 `withWorkspace` primitive on its base branch; Child-1/2 are committed on `feature/feat-tenancy-auth-rls-hardening` but not yet merged to `development`. Resolve the build base when the Founder merges that PR.
