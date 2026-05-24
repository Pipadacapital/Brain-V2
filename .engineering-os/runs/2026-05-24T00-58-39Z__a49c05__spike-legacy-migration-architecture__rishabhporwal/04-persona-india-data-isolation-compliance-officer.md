# Dynamic Persona Review — india-data-isolation-compliance-officer

> Filled by a single persona spawned in Stage 1.
> Validates against schemas/dynamic-persona.schema.json.
> At least one concern is mandatory.

| Field | Value |
|-------|-------|
| **req_id** | `spike-legacy-migration-architecture` |
| **Persona** | `india-data-isolation-compliance-officer` |
| **Timestamp** | 2026-05-24T01:15:00Z |

---

## What this lens sees

I am reading this migration not for what the end state will look like but for what happens to real tenant data, real customer PII, and real money figures during the transition. The legacy codebase is single-database, no RLS, with 586 application-layer `workspaceId`/`workspace_id` references across 88 files. The isolation guarantee is entirely a runtime software convention with no enforcement at the storage layer. Three things combine to make the migration sequencing a compliance minefield rather than a routine refactor: (1) the cron sync paths (`syncAllMetaAds`, `syncAllShiprocket`, `syncAllGoogleAds`) run cross-workspace fan-outs with no per-workspace session isolation, meaning the dual-run shadow-compare window is also a cross-brand data co-mingling window; (2) `ShopifyCustomer` carries `email`, `firstName`, `lastName`, `totalSpent` — live PII at rest with no DPDP consent record in the schema — and this PII will move across at least three storage boundaries (Postgres → Brain service → ClickHouse → potentially S3 raw) during the migration before any consent mechanism is proven; (3) 85 `@db.Decimal` columns and one `Float` column feed into `WorkspaceDailyMetrics.cm2`, `cm3`, `grossSales`, `rtoValue` — these are the realized-GMV fields that Brain's billing base will be computed from in minor units, but during dual-run both representations will co-exist and any reconciliation that uses approximate equality will silently accept a drift that is a financial-correctness defect.

---

## Concerns

### Concern 1 — CRITICAL: Cross-brand PII co-mingling during cron dual-run (no RLS + cross-workspace fan-out)

- **Severity:** critical
- **Concern:** The cron sync paths (`syncAllMetaAds` at `meta-sync.ts:290`, `syncAllShiprocket` at `shiprocket-sync.ts:351`, `syncAllGoogleAds` at `google-sync.ts:660`) each do a `prisma.<connector>.findMany({ where: { status: 'CONNECTED' } })` — no per-workspace session scoping, no row-level guard. During the dual-run window, if Brain's sync layer runs alongside legacy's cron using the same Postgres database (or even a shared read replica), any bug in the anti-corruption layer or facade routing can cause Brand A's customer PII or financial rows to be processed under Brand B's `workspaceId` context. There is no RLS policy to catch this at the storage layer. `ShopifyCustomer` carries `email`, `firstName`, `lastName` (DPDP "personal data" per Section 2(t) of the DPDP Act 2023). A cross-brand exposure of even one row of this data during migration is a reportable breach under DPDP Section 8(6) (the data fiduciary's obligation to report a breach to the Board).
- **Rationale:** The plan correctly identifies RLS as Child 1. But it does not make RLS a **precondition for any dual-run data movement**. The dual-run strategy (A5) could inadvertently schedule shadow-compare runs before RLS is in place. The spike acceptance criterion must require: "The dual-run shadow-compare for ANY slice is forbidden to begin until: (a) Postgres RLS is live and verified on ALL workspace-scoped tables, AND (b) the cron fan-out paths have been converted to per-workspace-session-aware invocations." This is not a Child 1 implementation concern — it is a sequencing gate the spike artifact A2/A5 must encode as a hard entry criterion for every subsequent dual-run.
- **Spike acceptance criterion:** A2 (strangler-fig sequence) must explicitly list "RLS verified live + cron paths session-scoped" as the entry criterion for the dual-run phase of EVERY child, not just Child 1. A5 (dual-run strategy) must state: "Shadow-compare is blocked until the RLS pre-condition is met; the facade must enforce this gate." If this is not in the spike's A2/A5, the compliance guard is missing and every later slice inherits an open breach window.
- **Escalate:** No. The requirement to close the leak surface before moving data is derivable from DPDP Act 2023 Section 8 and Brain's own multi-tenancy non-negotiable. This is an architecture decision, not a DPDP interpretation ambiguity.

---

### Concern 2 — HIGH: PII boundary crossing without a prior consent record (DPDP Section 6 + data-residency)

- **Severity:** high
- **Concern:** `ShopifyCustomer` (email, firstName, lastName, totalSpent), `WoocommerceOrder` (customerEmail, customerPhone, billingCity, billingPostcode, billingState, shippingCity, shippingPostcode, shippingState), `ShiprocketShipment` (deliveryPincode, deliveryCity, deliveryState), and `Invitation` (email) are all "personal data" under DPDP Act 2023 Section 2(t). The legacy schema has zero consent primitives — no `consent_given_at`, no `purpose_code`, no `processing_lawful_basis` column on any of these models. When these rows migrate from legacy Postgres (current hosting unknown / not ap-south-1 confirmed) into Brain services backed by ClickHouse and S3 (Brain canon: ap-south-1), the migration itself constitutes a "processing" action under DPDP Section 4. If the data is currently processed outside ap-south-1 (e.g., the Supabase project is on a non-India region), then the migration is also a cross-border transfer that requires a transfer mechanism under DPDP Section 16 (standard contractual clauses or adequacy determination). Even within ap-south-1, populating ClickHouse or S3 with raw PII rows without a purpose-linked consent record means Brain cannot answer an erasure request (DPDP Section 12) or a correction request (Section 13) without a full table scan — a compliance operational deficit.
- **Rationale:** The spike's A6 (risk register) must enumerate each PII model, the slice at which it crosses a storage boundary (Postgres → ClickHouse or S3), and the consent/residency proof required before that crossing. The spike must also determine whether the current Supabase project region is ap-south-1. If it is not, the migration itself requires a data-residency migration (not just a code migration) that must happen before Brain can ingest any PII from the legacy DB. This is a design-level question the spike must answer, not defer.
- **Spike acceptance criterion:** A6 must include: (a) a row per PII-bearing model listing which child slice causes it to cross a storage boundary and what consent/residency proof is required before that slice's dual-run begins; (b) a confirmed answer on the current Supabase/Postgres region; (c) if the current region is not ap-south-1, a data-residency migration step must be inserted before Child 1 in A2's strangler-fig sequence.
- **Escalate:** Conditional yes — if the current Supabase project is confirmed to be outside ap-south-1 (e.g., us-east-1 or eu-west-1), that is a genuine DPDP/residency ambiguity that should `/escalate` to the Founder before the spike finalizes A2, because inserting a data-residency migration ahead of Child 1 changes the program timeline materially.

---

### Concern 3 — HIGH: Decimal/Float to BIGINT minor-units: billing-base rounding drift during dual-run is a financial-integrity defect

- **Severity:** high
- **Concern:** `WorkspaceDailyMetrics` carries `netSales`, `grossSales`, `cm1`, `cm2`, `cm3`, `rtoValue`, `totalAdSpend`, and `miscExpensesProrated` — all `@db.Decimal(12,2)`. `ShopifyCustomer.totalSpent` is `@db.Decimal(12,2)`. `EmailPerformance.revenue` is `@db.Decimal(18,4)`. `ProductDailyAggregate.grossSales` is `@db.Decimal(14,4)`. The conversion to BIGINT minor units (Child 2) requires multiplying each value by 100 (for INR paise). The danger is not the happy path — it is the rounding semantics during the dual-run shadow-compare for `WorkspaceDailyMetrics`. If the shadow-compare tolerance is set to "approximately equal" (e.g., within 1 rupee), a systematic rounding drift of 0.5 paise per line item across 10,000 orders is invisible to the compare gate but accumulates to a measurable GMV error in Brain's billing base. Brain's realized GMV in minor units is the fee base — a systematic under-count of paise means the Founder is billing on a number lower than actual GMV. The `@db.Decimal(18,6)` on `WorkspaceMetricGoal.goalValue` adds a further precision mismatch if goals are set against Decimal values that do not map cleanly to integer paise.
- **Rationale:** This is not hypothetical. The `toDecimal()` function in `sync.ts:82-85` wraps Shopify's string amounts into Prisma's `Decimal` type. When Brain's minor-units layer re-reads these values and multiplies by 100, any value like "1234.565" (which Shopify can legally send as a 3-decimal amount) will round differently depending on whether Python's `decimal.ROUND_HALF_UP` or JavaScript's `Math.round` or Postgres's `ROUND()` is used. The dual-run must enforce exact-integer-equality after conversion, not approximate equality. The `WorkspaceDailyMetrics` table is the one that feeds the billing computation, so this is the highest-risk table for financial-integrity drift.
- **Spike acceptance criterion:** A4 (per-slice parity plan) for Child 2 (money migration) must specify: "Shadow-compare for all money fields is exact-integer-equality in minor units after conversion — no tolerance band. Reconciliation must confirm SUM(legacy Decimal * 100 rounded via [named rounding rule]) == SUM(Brain BIGINT) for each workspace-date pair in `WorkspaceDailyMetrics`. Any mismatch is a hard block on cutover, not a warning." A5 must name the single canonical rounding rule (recommend `ROUND_HALF_EVEN` / banker's rounding in both TS and Python) and enforce it in the dual-run harness. This is distinct from Child 4 (metric engine) — the rounding-rule agreement must be established in Child 2 before metrics land on top.
- **Escalate:** No. This is a deterministic engineering constraint. The rounding rule choice is architectural (belongs in A4/A5 of the spike), not a DPDP/regulatory ambiguity.

---

### Concern 4 — MEDIUM: Connector credential PII at rest: `ShiprocketConnection.password`, `UnicommerceConnection.password`, `KlaviyoConnection.apiKey` migrate without a credential-rotation gate

- **Severity:** medium
- **Concern:** `ShiprocketConnection` stores `email` + `password` (plaintext in schema — no `@db.VarChar` length annotation that hints at hashing) and `accessToken`. `UnicommerceConnection` stores `username` + `password` + `accessToken`. `KlaviyoConnection` stores `apiKey`. These are not customer PII but they are sensitive credentials stored as plaintext strings in Postgres. When the migration copies these rows into Brain's schema (or the anti-corruption layer proxies through them), if the target Brain system uses a different secrets management strategy (e.g., AWS Secrets Manager or Vault), the migration must not merely lift-and-shift the plaintext values — it must rotate credentials at cutover. The spike's A2 must schedule a credential-rotation gate at the connector-migration slice (Child 3), not as an afterthought.
- **Rationale:** A lift-and-shift of plaintext connector passwords from legacy Postgres into Brain's Postgres (even ap-south-1) doubles the credential attack surface for the duration of the dual-run. If the dual-run lasts weeks (which is likely for 7 connectors), that is weeks of duplicated plaintext credentials in two databases. The risk is multiplied because the cron paths call these credentials for all connected workspaces in a single fan-out loop — a compromise of one credential in either database exposes the entire fan-out.
- **Spike acceptance criterion:** A2 must annotate Child 3 with: "Connector credential migration is NOT a data copy — it is a credential-rotation event. Each connector's secret must be migrated to Brain's secrets manager and the legacy plaintext deleted from legacy Postgres at the moment of cutover for that connector, not after." A6 (risk register) must list this as a credential-hygiene risk with the mitigation being the rotation gate.
- **Escalate:** No. This is a security/operational decision the spike can specify.

---

### Concern 5 — MEDIUM: AuditLog.workspaceId is nullable — DPDP audit trail is incomplete and will break the Brain Decision Log's immutability requirement during dual-run

- **Severity:** medium
- **Concern:** `AuditLog.workspaceId` is `String?` (nullable, line 659 of schema). This means system-level actions that do not carry a workspace context produce audit rows with `workspaceId = NULL`. During migration, operations performed by the migration process itself (data moves, schema transforms) must be attributable to a workspace for DPDP accountability purposes. If the migration process generates `AuditLog` rows with null `workspaceId`, there is no way to scope a data-subject erasure request or a regulatory audit to a specific brand. Additionally, the legacy `AuditLog` does not map to Brain's Decision Log (immutable, append-only, per-workspace). When the migration's shadow-compare engine reads `AuditLog` to validate parity, it will encounter null-workspace rows that have no target in Brain's Decision Log model — these rows either orphan silently or require a bespoke migration rule that the spike's A1 capability map must specify.
- **Spike acceptance criterion:** A1 must classify `AuditLog` as: "partial-refactor — null-workspace rows are a gap; migration must either (a) attribute migration-generated rows to a system workspace or (b) filter them from the Decision Log migration with an explicit 'system-event, not brand-event' disposition." A6 must flag the null-workspaceId audit trail gap as a DPDP accountability risk for system-level operations during dual-run.
- **Escalate:** No. This is an architecture classification decision for the capability map.

---

## Recommendations

1. **Encode the RLS pre-condition as a hard, non-waivable entry gate in A2 and A5.** The strangler-fig sequence must make the dual-run shadow-compare phase of every child slice contingent on "RLS live and verified + cron paths session-scoped." This gate must appear in the A2 sequence table as an explicit entry criterion column, not as a prose note. Without this structural encoding, the gate will be treated as optional by downstream builders.

2. **The spike must produce a PII-boundary crossing register as part of A6.** For each PII-bearing model (`ShopifyCustomer`, `WoocommerceOrder`, `ShiprocketShipment`, `Invitation`, `ShopifyOrder.email`), A6 must state: the child slice at which the model crosses a new storage boundary, the consent/residency proof required before that crossing, and whether the current Supabase region requires a data-residency migration ahead of Child 1. If the region is non-India, this becomes an `/escalate` to the Founder before A2 is finalized.

3. **Mandate exact-integer-equality in the money shadow-compare and name the canonical rounding rule in A4/A5.** "Approximately equal" is not an acceptable tolerance for GMV fields that feed the billing base. The spike must select `ROUND_HALF_EVEN` (banker's rounding) as the canonical rule, enforce it in both the TS conversion layer and the Python metric layer, and require that the shadow-compare harness for Child 2 produces a per-workspace-date reconciliation report showing exact parity — not a summary statistic.

---

## Skills consulted

- `multi-tenancy-isolation` (RLS pre-condition gate, cron cross-workspace fan-out)
- `data-privacy-dpdp` (DPDP Act 2023 Sections 2(t), 4, 6, 8, 12, 13, 16 — PII model classification, consent, residency, breach reporting)
- `metric-engine` (money = integer minor units; billing base correctness; rounding rule discipline)
- `security-baseline` (credential plaintext at rest; credential-rotation gate at connector cutover)

---

## One line for the CTO Advisor synthesis

**The migration plan must encode three non-negotiable sequencing gates before any dual-run begins: (1) RLS live + cron paths session-scoped (Concern 1 — critical breach window); (2) Supabase/Postgres region confirmed as ap-south-1, else a data-residency migration precedes Child 1 (Concern 2 — conditional escalate); (3) money shadow-compare uses exact-integer-equality with a named rounding rule, not an approximate tolerance (Concern 3 — billing-base financial integrity).**
