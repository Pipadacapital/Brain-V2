# LLD Amendment — 2026-06-01

**Status:** Architect-ratified (Aryan), routed to Rohan (CTO Advisor) as FYI-ratification.
**Purpose:** Realign the Low-Level Design (canon TECH/01/05/06) to the **as-built**
reality where a *later, Founder-ratified architecture decision* superseded the LLD.
Governing principle: **a later ratified decision supersedes an earlier design doc on
the surface it touches.** Where the build reflects a ratified decision, the LLD is
amended to match the build — not the reverse.

This amendment is paired with the conformance suite (`tests/conformance/`), whose
C1–C14 assert the **invariants** these amended sections imply, not the struck names.

---

## Amendment 1 — Order/fact model: vendor-discriminator, not per-domain canonical tables

**Supersedes:** LLD §1 `orders_recent` (PG hot mirror) and §2 `raw_orders_local` /
`orders_local` (CH canonical) — and any other per-domain canonical table.

**Ratified model (`integration-extensible-schema`, Founder decision):** Brain models
connector data with a **vendor string discriminator** + generic
`connector_<entity>_facts` tables + a `connector_definitions` registry. There are
**no per-vendor and no per-domain canonical tables** (`orders_recent`, `orders_local`
are struck). This is what lets Brain absorb 100+ future integrations without new
tables/columns per vendor.

- PG hot facts: `connector_order_facts`, `connector_line_item_facts`,
  `connector_ad_spend_facts`, … (core-service, `migrations/local-dev/05*`).
- CH facts: `brain.connector_order_facts`, `brain.connector_*_facts`
  (analytics-service, `migrations/clickhouse/000*`).
- Registry: `public.connector_definitions` (`25-connector-definitions.sql`).

**Invariants retained (and enforced by conformance):** money = BIGINT/Int64 minor
units (C1); CH `ORDER BY` leads with `workspace_id` (C2); PG RLS fail-closed (C3);
ClickHouse `ReplacingMergeTree(version)` dedup; idempotent UPSERT on
`(workspace_id, vendor, vendor_*_id)`.

**Additive idea preserved for later (not struck):** the LLD's `GENERATED ALWAYS`
`net_revenue_minor` / `is_cod` columns are a good ergonomic; they may be added to the
fact tables as a non-breaking enhancement. Not done now.

---

## Amendment 2 — ClickHouse naming + topology

**Supersedes:** LLD §2 table names `*_local` and database `brain_analytics`.

- **Database** is `brain` (configurable via `CLICKHOUSE_DATABASE`), not
  `brain_analytics`. Amend the LLD to `brain`.
- **Table names** follow the discriminator model (Amendment 1), not `orders_local`.
- **Replication / sharding / `Distributed(cityHash64(workspace_id))` / `ON CLUSTER`**
  remain the **Phase-2+ target** (multi-node). Current migrations are single-node
  `ReplacingMergeTree`. This is a deferred infra graduation, **not drift** — and
  because every `ORDER BY` already leads with `workspace_id` (C2), the `Distributed`
  shard key drops in mechanically at Phase 2.

---

## Amendment 3 — Credential custody: bytea-at-rest is the Phase-0/1 state of the ARN target

**Clarifies (does not strike):** LLD §1 `integrations.credential_secret_arn`.

The LLD's ARN-only target is correct as the **destination**. The current build stores
`connector_credentials.credential_enc BYTEA` (AES-256-GCM, no plaintext, never
logged) — a legitimate Phase-0/1 custody posture. The seam is the `credential_enc`
column: the in-flight AWS Secrets Manager + KMS credential-custody work swaps the
encrypted blob for an ARN reference at custody-cutover. Annotate the LLD: *"ARN-only
is the post-custody-cutover target; Phase-0/1 stores a KMS/GCM-encrypted blob in the
same column."*

---

## Amendment 4 — Proto package + service names

**Supersedes:** LLD §4 package names `brain.analytics.v1`, `brain.core.v1`.

`protos/` is the contract source of truth, so the LLD is amended to the **built**
names: `brain.metrics.v1` (MetricsService), `brain.intelligence.v1`
(IntelligenceService), `brain.ingestion.v1` (WebhookIngestService).

**Deferred (not drift):** `WorkspaceService`, `NotificationsService`,
`IntegrationsService`, `LifecycleService`, and the bidi `IntelligenceService.Chat`
RPC are unbuilt Phase-2 contracts that arrive with their services. Method-name
differences (`QueryMetrics`/`GetKpiSummary`/`GetPnlWaterfall` vs the LLD's
`GetDailyMetrics`/`GetWaterfall`/`GetCohortHeatmap`/`DrillDown`) are an as-built
choice; amend the LLD to the built methods.

---

## Items explicitly NOT amended here (routed elsewhere)

- **Workspace role enum** (`OWNER/ADMIN/MANAGER/ANALYST/VIEWER` as-built vs canon
  `owner/operator/analyst/agency/viewer`): a three-way conflict (build diverges from
  *both* LLD and canon), destructive + contract-breaking + a GTM-semantics call.
  **Escalated to Rohan** — see `docs/escalation-role-enum-2026-06-01.md`. Held as-built
  for Phase-0/1.
- **Memory moat depth** (`condition_outcome` table + temporal/component fingerprint +
  the compounding-learning k-NN query): the actual moat, **incompletely built**, scoped
  to the Phase-D intelligence build-out (alongside the 14 unbuilt agents + daily loop).
  Deferred, not amended. (The opclass landmine within the memory layer WAS fixed on
  2026-06-01 — single `vector_cosine_ops` index; enforced by C14.)
- **Named PG schemas** (core/ai/lifecycle/support/billing/audit): Phase-2 physical-split
  affordance; `ai.*`/`memory.*` already carved. Deferred.

See `docs/architecture-conformance-audit-2026-06-01.md` for the full evidence + roadmap.
