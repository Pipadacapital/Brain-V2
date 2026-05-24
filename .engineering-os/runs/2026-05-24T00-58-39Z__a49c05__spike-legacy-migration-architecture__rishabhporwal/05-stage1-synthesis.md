# Stage 1 — Persona Synthesis (Rohan, cto-advisor)

| Field | Value |
|-------|-------|
| **req_id** | `spike-legacy-migration-architecture` |
| **Parent epic** | `chore-migrate-legacy-to-brain` (child-0-audit-migration-architecture-spike) |
| **Stage** | 1 (synthesis — orchestrator re-invoke, personas now present) |
| **Reviewer** | Rohan (cto-advisor) |
| **Timestamp** | 2026-05-24T01:07:19Z |
| **Personas synthesized** | `migration-strangler-fig-realist`, `india-data-isolation-compliance-officer` |
| **Decision** | **ADVANCE** (re-affirmed) |
| **Escalation** | **spike-investigation-item with a pre-wired tripwire** (cross-border residency) — NOT escalated-now |

---

## Persona validity check (no "looks good" personas accepted)

Both personas returned with substantive, code-grounded concerns. Neither is a no-concern reject.

- **`migration-strangler-fig-realist`** — 4 concerns (1 CRITICAL, 2 HIGH, 1 MEDIUM), each anchored to specific legacy schema lines and module paths. Accepted.
- **`india-data-isolation-compliance-officer`** — 5 concerns (1 CRITICAL, 2 HIGH, 2 MEDIUM), each anchored to schema + DPDP Act 2023 sections. Accepted.

**Total: 9 concerns carried into Stage 2.** 0 dropped. Every one binds the spike as an explicit acceptance requirement on A1–A6 (table below).

The two CRITICALs are *the same fault line seen from two lenses*: legacy isolation is a runtime convention with **no storage-layer enforcement (no RLS)**, and the cron paths fan out cross-workspace with `findMany` and no per-workspace session. The strangler realist sees it as "you can't dual-home a connector token"; the compliance officer sees it as "the dual-run window IS a cross-brand PII co-mingling window." Both resolve to the same binding rule: **RLS-live + cron-session-scoped is a hard entry gate for EVERY child's dual-run phase, and connector cutover is a single-owner token handoff, not a shadow.**

---

## How each concern BINDS the spike (this updates the acceptance contract)

The spike contract in `02-cto-advisor-review.md` (artifacts A1–A6 + "good enough" bar) stands. The personas do not change scope; they **sharpen the acceptance bar** on specific artifacts. The following become **mandatory required-content** for Stage 2 — Aryan + Maya are bound by them, and Tanvi (Stage 5) verifies their presence, Shreya (Stage 4) reviews their adequacy.

| # | Source (persona · concern · severity) | Binding requirement added to the acceptance contract |
|---|---|---|
| C1 | strangler · 1 · **CRITICAL** | **A2 + A4 must contain a per-connector "token handoff ceremony" for all 7 connectors** (NOT a generic "dual-run" label). Each connector row must state: (a) the exact moment legacy loses event reception; (b) the maximum data-loss window in minutes; (c) whether historical replay is available per connector (Shopify 60-day order API = recoverable; Meta/Google insights API = recoverable; **Shiprocket = NO historical event replay → flagged higher-risk, requires a longer legacy-shadow period before token transfer**); (d) a go/no-go rollback decision tree (if Brain connector parity not reached within N hours of token transfer, how legacy connector is restored without corruption). Child 3 is explicitly named in A2 as a **single-owner cutover slice, not a shadow slice.** |
| C2 | strangler · 2 · **HIGH** | **A2 + A5 must make `WorkspaceDailyMetrics` / `workspace_daily_metrics` single-writer-at-a-time.** The shadow-compare for metrics is into **Brain's ClickHouse shadow materialization — NEVER a dual-write to the same Postgres rollup table** (a Brain-paise writer + legacy-rupee-float writer on one table is a data race, not a shadow). A2 must record the explicit ownership transitions as a **named gate**: "legacy writes / Brain reads-shadow" → "Brain writes / legacy reads-fallback" → "legacy reads decommissioned." Not a footnote inside Child 4. |
| C3 | strangler · 3 · **HIGH** | **A2 must declare Child 5 (AI engine) has a HARD dependency on Child 4 (metric engine + ClickHouse) being live and parity-proven** — the dependency edge must be explicit in the DAG, and A4-for-Child-5 must list "`WorkspaceDailyMetrics` no longer authoritative; Brain AI reads ClickHouse" as a **mandatory entry criterion.** A2 must also include an explicit **`AiInsight`/`WorkspaceAiInsightsCache` invalidation event** (the `filtersHash`/`expiresAt` TTL cache) as a named cutover step at the Child 4→Child 5 boundary, so stale AI commentary cannot survive a metric redefinition. |
| C4 | strangler · 4 · **MEDIUM** | **A5 must exclude currency conversion from the money parity check.** The hardcoded `pnl.ts EXCHANGE_RATES` (`INR: 83.5`, etc.) is a semantic leak that would poison shadow-compare with false positives on every multi-currency workspace (incl. Sugandh Lok's USD international SKUs). Monetary shadow-compare is done **in the workspace primary currency at a fixed snapshot rate** (compare `cm2_inr` to `cm2_inr`), not at each system's compute-time rate. A6 must list the static-rate assumption (and the `WorkspaceCost.currency @default("USD")` mismatch) as a parity-contamination risk. |
| C5 | compliance · 1 · **CRITICAL** | **A2 + A5 must encode "RLS live + verified on ALL workspace-scoped tables + cron fan-out paths converted to per-workspace-session-aware invocations" as a HARD, non-waivable entry criterion for the dual-run phase of EVERY child slice** — rendered as an explicit *column* in the A2 sequence table, not prose. A5 must state: "Shadow-compare is BLOCKED until the RLS pre-condition is met; the facade enforces this gate." Rationale: during dual-run a facade/routing bug can process Brand A `ShopifyCustomer` PII (email/name) under Brand B context with no storage-layer guard — DPDP §8(6) reportable breach. |
| C6 | compliance · 2 · **HIGH** | **A6 must include a PII-boundary-crossing register**: one row per PII-bearing model (`ShopifyCustomer`, `WoocommerceOrder`, `ShiprocketShipment`, `Invitation`, `ShopifyOrder.email`) listing (a) the child slice at which it crosses a new storage boundary (Postgres→ClickHouse/S3), (b) the consent/residency proof required before that crossing, (c) the erasure/correction-scoping plan (DPDP §12/§13). **PLUS the residency tripwire** — see "Escalation call" below: the spike must confirm the current Supabase/Postgres region; if it is not ap-south-1, a data-residency migration step is inserted **before Child 1** in A2, and that confirmation fires an immediate `/escalate`. |
| C7 | compliance · 3 · **HIGH** | **A4-for-Child-2 (money) must specify shadow-compare as EXACT-INTEGER-EQUALITY in minor units after conversion — zero tolerance band, NOT "approximately equal."** Reconciliation must confirm `SUM(legacy Decimal × 100 rounded via the named rule) == SUM(Brain BIGINT)` per workspace-date pair on `WorkspaceDailyMetrics`; any mismatch is a hard cutover block. **A5 must name a single canonical rounding rule = `ROUND_HALF_EVEN` (banker's rounding), enforced identically in BOTH the TS conversion layer and the Python metric layer.** Established in Child 2 *before* metrics land (Child 4) on top. Rationale: realized GMV in minor units is the fee base; a systematic sub-paise under-count is a financial-correctness/billing defect invisible to an approximate gate. |
| C8 | compliance · 4 · **MEDIUM** | **A2 must annotate Child 3 as a credential-ROTATION event, not a data copy.** Each connector secret (`ShiprocketConnection.password`, `UnicommerceConnection.password`, `KlaviyoConnection.apiKey`, etc. — plaintext in legacy) is migrated into Brain's secrets manager and **the legacy plaintext is deleted from legacy Postgres at the moment of that connector's cutover** (not after). A6 lists duplicated-plaintext-credentials-during-dual-run as a credential-hygiene risk with the rotation gate as mitigation. |
| C9 | compliance · 5 · **MEDIUM** | **A1 must disposition `AuditLog` null-`workspaceId` rows explicitly**: classify as "partial-refactor — null-workspace rows are a gap; migration must either (a) attribute migration-generated rows to a system workspace, or (b) filter them from the Decision Log migration with an explicit 'system-event, not brand-event' disposition." A6 flags the null-workspaceId audit gap as a DPDP accountability/erasure-scoping risk for system-level operations during dual-run. |

**Net effect on the contract:** A1 gains one disposition rule (C9). A2 gains: the RLS+cron entry-gate column (C5), the per-connector token-handoff ceremony + Child-3-is-single-owner-cutover (C1), the `WorkspaceDailyMetrics` ownership-transition named gate (C2), the explicit Child5→Child4 hard-dependency edge + cache-invalidation step (C3), the credential-rotation annotation on Child 3 (C8), and (conditionally) a pre-Child-1 data-residency-migration step (C6). A4 gains: exact-integer-equality money parity + named rounding rule on Child 2 (C7), and the rollback decision tree on Child 3 (C1). A5 gains: the RLS-blocks-shadow-compare statement (C5), the ClickHouse-shadow-never-Postgres-dual-write rule (C2), currency-conversion excluded from parity / primary-currency-fixed-snapshot compare (C4), and the canonical `ROUND_HALF_EVEN` rule shared TS↔Python (C7). A6 gains: the PII-boundary-crossing register + residency tripwire (C6), the static-FX parity-contamination risk (C4), the credential-hygiene risk (C8), and the null-workspaceId audit gap (C9).

These are now part of the spike's acceptance bar. **Tanvi (Stage 5) checks each is present and internally consistent; Shreya (Stage 4) reviews C1/C2/C5/C6/C8 (the isolation/residency/credential ones) for adequacy as a design-level VETO.**

---

## Escalation call (the load-bearing judgment)

**Concern under decision:** compliance Concern 2 — cross-border data transfer. PII migrates from legacy Postgres into Brain (ap-south-1 ClickHouse/S3). The persona flagged this as a **conditional** `/escalate`: yes *if* the current Supabase/Postgres region is confirmed outside ap-south-1 (e.g., us-east-1/eu-west-1), because that would make the migration itself a DPDP §16 cross-border transfer and would insert a data-residency migration ahead of Child 1 — a material timeline change.

**My decision: this is a `spike-investigation-item` with a pre-wired escalation tripwire — NOT an `escalate-now`.** Reasoning, deliberately:

1. **The escalation predicate is an unconfirmed FACT, not an interpretation ambiguity.** The `/escalate` rubric fires on a *compliance ambiguity I cannot resolve from canon + lessons*. Here the rule is unambiguous — DPDP §16 governs cross-border transfer, Brain canon mandates India-in-region by default; there is no interpretation gap. What is unknown is a single binary fact: **which region is the current Supabase project in?** Escalating an unconfirmed fact would be fabricating an escalation — exactly what my mandate forbids ("Do not fabricate an escalation").

2. **Determining that fact IS the spike's job.** This child is a deep-audit. "Confirm the current Postgres/Supabase region" is a trivially answerable investigation item that belongs inside A6, not a Founder decision. Asking the Founder to adjudicate before the spike has even looked would invert the order of work.

3. **But burying it would be the opposite failure.** So I am not leaving it as soft prose. I am making it a **HARD, EARLY, BLOCKING investigation item with a tripwire**: the spike MUST confirm the region as one of the *first* things it does, *before A2 is finalized*, and the result is wired to an automatic action:
   - **If ap-south-1 (expected):** record in A6, no residency-migration step, no escalation; proceed.
   - **If NOT ap-south-1:** this immediately becomes a real `/escalate` to the Founder (genuine §16 cross-border + a pre-Child-1 data-residency-migration step that changes the program timeline) — and A2 cannot be finalized until the Founder rules. The tripwire is named in A6 so it cannot be silently skipped.

This is the honest middle: I neither invent an escalation on a guess, nor let a genuine breach-risk drift. The escalation is **armed and pre-authorized**, conditional on a fact the spike is uniquely positioned to confirm this week.

**Founder heads-up (not an action request):** I am adding one informational line to `pending-founder-attention.md` so the Founder is not surprised if the tripwire fires mid-spike. It asks for nothing now; it pre-frames the conditional escalation. No other concern fires `/escalate` — C5 (RLS-before-data-move) and C7 (exact-equality money parity) are architecture decisions derivable from canon + the multi-tenancy/money non-negotiables, which is precisely why both personas marked them "Escalate: No."

---

## Decision: ADVANCE (re-affirmed)

The personas sharpened the sequence and guardrails exactly as intended; they did not surface anything that changes whether the spike should run. The spike is well-scoped, its acceptance bar is now tighter (9 concerns bound onto A1–A6), and the no-prod-code guardrail is intact.

**Next:** Stage 2 — **Aryan (architect)**, co-owned with **Maya (intelligence-engineer)** on the data/AI-surface mapping + the numeric shadow-compare (A5). The A1–A6 artifacts ARE their Stage-2 deliverable, now bound by the 9 persona requirements above.

---

## DoD (synthesis pass)

- [x] Both persona artifacts read; both have ≥1 concern (neither rejected as "looks good")
- [x] All 9 concerns dispositioned and bound onto the acceptance contract (0 dropped) — table above
- [x] Escalation call made deliberately and recorded (spike-investigation-item + pre-wired tripwire; reasoning documented; NOT a fabricated escalate-now)
- [x] Founder heads-up mirrored to `pending-founder-attention.md` (informational, no action requested)
- [x] Decision re-affirmed: ADVANCE → Stage 2 architect (Aryan), co-owner intelligence-engineer (Maya)
- [x] state/active.json updated (.bak first; `personas_synthesized: true`, `persona_concerns_carried_to_stage2: 9`; epic + scaffold entries intact)
- [x] Journal + decision-log appended
