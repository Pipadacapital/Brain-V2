# Stage 1 — Synthesis (CTO Advisor / Rohan)

> Synthesis pass: reached after the orchestrator spawned the two requested personas (`03-persona-metric-parity-olap-correctness-realist.md`, `04-persona-definitional-delta-finance-semantics-realist.md`) and re-invoked Rohan. Folds the genuine concerns into the binding contract carried to Stage 2 (Architect / Aryan + Intelligence-Engineer / Maya co-own).
> Pairs with `02-cto-advisor-review.md` (intake pass). Validates the Stage-1 DoD.

| Field | Value |
|-------|-------|
| **req_id** | `feat-metric-engine-olap-split` (Child 4 of EPIC `chore-migrate-legacy-to-brain`) |
| **Stage** | 1 (synthesis) |
| **Timestamp** | 2026-05-25T05:00:00Z |
| **Decision** | **ADVANCE → Stage 2 (Architect Aryan + Intelligence-Engineer Maya co-own)** |
| **Lane** | high-stakes (confirmed; unchanged) |
| **Paradigm** | `sql` exclusively (M-A1-Q1) — confirmed; zero inference path |
| **Maya (intelligence) co-owner** | **YES** — metric registry + ClickHouse + Definitional-Delta Register are her lane (she authored M-A1-1/Q1/Q2) |
| **Named HOLD state** | `HOLD-AT-READ-FLIP` — confirmed; unchanged |
| **Escalation** | NONE — confirmed; unchanged |

---

## 0. TL;DR

Both personas **clearly passed the quality gate** — 5 code-/architecture-grounded concerns each (OLAP: 1 CRITICAL + 3 HIGH + 1 MEDIUM; Finance: 3 HIGH + 2 MEDIUM), every one carrying file:line evidence, none a "looks good" pass. **I accept all 10 concerns** (de-duping the one CM2/prorated overlap into a single adjudication-discipline bind). The headline outcomes:

1. **A Stage-2 must-bind-before-DDL CRITICAL:** ClickHouse `/` on `Int64` returns `Float64`, not integer FLOOR — every ratio MV expression in the M-A1-1 draft is wrong-by-default and the current parity harness has **zero ClickHouse round-trip coverage**, so the entire ratio-parity guarantee is structurally inert. `CF-C4-RATIO-DIVOP-1` (`intDiv` + null-guard on EVERY MV division + ClickHouse round-trip fixtures) must be bound **before any MV DDL is written**.
2. **The Definitional-Delta Register schema expands from 6 → 9 fields** (`parity_gap`, `child_dependency`, `formula_snapshot`) so a metric with **no legacy comparand is NEVER silently skipped** (True-CM2) and a row whose delta can't yet be measured is **never prematurely signed** (`total_tax_mu`, FX). This directly hardens the artifact I will sign at Stage 6.
3. **"Verify-the-verifier" discipline is bound as binding CF here** — this run is the **4th consecutive occurrence** of the same root cause (defective grep / vacuously-green isolation test / tautological-or-absent fixture). It reinforces the already-proposed (human-gated) rule `verify-the-verifier-mutation-on-gate`; I add this run as evidence #4 to that proposal rather than spawning a new one.

Scope ruling: `CF-C4-SCOPE-SPLIT-1` **held as written** (4a core+OLAP+parity / 4b CM-waterfall+DDR; collapsible at Stage 2 with a one-line rationale). Paradigm `sql`-only, Maya co-own, `HOLD-AT-READ-FLIP`, escalation `none` — all confirmed.

---

## 1. Persona quality gate (both PASS — verified against the full artifacts)

**Persona 1: `metric-parity-olap-correctness-realist:sonnet` — ACCEPTED.**
Surfaced **5 genuine concerns** (1 CRITICAL, 3 HIGH, 1 MEDIUM), all in-lane, each grounded in the committed code it read (`ratio.ts`/`ratio.py`, `parity-runner.ts`, `harness.py`, `taxonomy.py`, `check-metrics-parity.sh`) + the ClickHouse arithmetic-functions docs + the M-A1-1 mapping. It did exactly the adversarial job I handed it: convert "the shadow-compare can be FALSE-GREEN" from a fear into **named, falsifiable mechanisms with fixes**. **I independently verified the CRITICAL claim:** ClickHouse's documented `/` operator semantics return a floating-point type on integer operands (unlike Postgres truncation, Python `//`, or BigInt division). The persona correctly demonstrated that all positive-integer test fixtures stay GREEN because Float64-truncation and integer-FLOOR coincide for positive values — so the divergence only fires on zero-denominator / pathological inputs that no current fixture covers. The claim is accurate, not rhetorical. Not a "looks good" pass.

**Persona 2: `definitional-delta-finance-semantics-realist:sonnet` — ACCEPTED.**
Surfaced **5 genuine concerns** (3 HIGH, 2 MEDIUM), all in-lane, each grounded in the full legacy compute path it read (`compute-daily.ts`, `pnl.ts`, `workspace-costs.ts`, `analytics-sync.ts`) + the M-A1-Q2 ruling. It did exactly its job: pressure-test whether each "delta" is genuine definitional progress or a **bug wearing the `expected_definitional_delta` hall-pass**. **I independently verified two load-bearing claims:** (a) `compute-daily.ts` has no `trueCm2`/`rtoProvision` field — True-CM2 is genuinely Brain-native with no legacy comparand (this matches my own intake open-question #4); (b) `analytics-sync.ts` `buildShopifyAnalyticsQl` pulls `taxes` as a **ShopifyQL day-level aggregate**, NOT per-SKU line-item tax — so `total_tax_mu` legacy-vs-Brain is a genuine definitional delta, not a formula variant. Both verified. Not a "looks good" pass.

**Both personas met the ≥1-concern quality gate decisively. Neither is rejected.**

---

## 2. De-dupe: the CM2 / prorated overlap

OLAP-Concern-2 (`misc_expenses_prorated_mu` Float64 SUM accumulation masked by the `ROUNDING_MODE_MISMATCH` pre-classification) and Finance-Concern-1 (the `pnl.ts` CM2 delta is two superimposed differences; a wrong ClickHouse `days_in_month` constant could be stamped as the pre-authorized expected-delta) are **two views of one root cause**: a wrong proration in Brain's own MV gets absorbed into a pre-authorized delta label instead of being diagnosed.

- **OLAP-2** is the **mechanism** (Float64 division op + the taxonomy pre-classification absorbing the coercion artifact).
- **Finance-1** is the **adjudication-discipline** failure (the triage flow reaches for the pre-authorized label before asking "is Brain's `days_in_month` correct?").

I fold them into **one constraint pair that must travel together**: `CF-C4-PRORATED-DIVOP-1` (the op fix — `intDiv` + audit the `ROUNDING_MODE_MISMATCH` classification for `miscExpensesProrated` so it covers ONLY the Postgres ROUND_HALF_UP story, not a Float64 coercion artifact) **+** `CF-C4-DDR-MISC-PRORATE-1` (the adjudication fix — the Register row must pin the ClickHouse `days_in_month` function [`toDaysInMonth(date)`, NEVER a `30` constant], carry a Feb-boundary worked example, and the triage flow must ask "is Brain's formula correct?" before stamping `expected_definitional_delta`). De-duped: one root cause, two enforcement surfaces (DDL + Register), no double-counting.

---

## 3. Disposition of all 10 concerns (folded into the binding contract)

### OLAP-correctness realist

| # | Sev | Concern (one-line) | Disposition | Carried as | Owner |
|---|-----|--------------------|-------------|------------|-------|
| O1 | **CRITICAL** | ClickHouse `/` on Int64 → Float64 (not FLOOR); coercion garbage on zero-denominator days; CI green because no ClickHouse round-trip fixtures | **ACCEPT — Stage-2 MUST-BIND-BEFORE-DDL.** No MV DDL may be written until every division uses `intDiv` + null-guard and the harness gains ClickHouse round-trip fixtures (non-zero-remainder ratio, zero-denominator day, Float64-vs-FLOOR divergent value). | **`CF-C4-RATIO-DIVOP-1`** (sharpens/absorbs `CF-C4-RATIO-PARITY-1`) | **Aryan** (MV DDL) + **Maya** (registry parity + harness fixtures) |
| O2 | **HIGH** | `misc_expenses_prorated_mu` Float64 SUM accumulation masked by the `ROUNDING_MODE_MISMATCH` pre-classification | **ACCEPT — de-duped with F1 (see §2).** Op fix here; adjudication fix in F1. | **`CF-C4-PRORATED-DIVOP-1`** (paired with `CF-C4-DDR-MISC-PRORATE-1`) | **Aryan** (MV op) + **Maya** (taxonomy classification audit) |
| O3 | **HIGH** | COGS incremental MV is wrong on coq-settings-change days (legacy re-runs full daily); drift can be socially relabelled `expected_definitional_delta` | **ACCEPT.** Architecture must pin the `cogs_mu` refresh model (incremental MV vs scheduled full recompute) **preserving exact-integer-equality**; if incremental, add a NAMED `COGS_SETTINGS_CHANGE_DELTA` taxonomy category (NOT `expected_definitional_delta` — that label is for formula changes, not data-staleness) + a CI fixture modelling a coq-settings change event. | **`CF-C4-COGS-MV-REFRESH-1`** (+ `COGS_SETTINGS_CHANGE_DELTA` taxonomy row + fixture) | **Aryan** (MV refresh model) + **Maya** (taxonomy category + fixture) |
| O4 | **HIGH** | Single-writer grep misses Prisma camelCase model writes (`prisma.workspaceDailyMetrics.upsert`) and ORM-abstracted/string-split targets | **ACCEPT — sharpens `CF-C4-SINGLE-WRITER-1`.** The static gate must cover ≥3 patterns: (a) SQL table names as write targets (INSERT/UPDATE/UPSERT/DELETE/COPY within N chars), (b) Prisma camelCase model write-method calls (`.create/.upsert/.update/.createMany/.delete` on `workspaceDailyMetrics`/`productDailyAggregates`/etc.), (c) **a DB-level read-only role** for the analytics-service Postgres user as the structural backstop the grep cannot provide — enforced at service startup, not only documented. | **`CF-C4-SINGLE-WRITER-GREP-2`** (sharpens `CF-C4-SINGLE-WRITER-1`) | **Aryan** (grep gate + read-only role) + **Jatin** (DB read-only role provisioning if infra) |
| O5 | **MEDIUM** | Cross-workspace isolation test vacuously GREEN on a single-workspace fixture (`query(None)==[]` on empty data proves nothing) | **ACCEPT — sharpens `CF-C4-QUERY-SCOPE-1`.** The Stage-5 negative control must seed TWO workspaces (`ws_A`, `ws_B`) in the ClickHouse test container, query through the gateway as `ws_A`, and assert ZERO `ws_B` rows returned. An un-scoped-query rejection test against an empty fixture is insufficient. | **`CF-C4-QUERY-SCOPE-ISOLATION-1`** (sharpens `CF-C4-QUERY-SCOPE-1`) | **Aryan** (query-gateway + two-workspace test spec) |

**OLAP highest-risk false-GREEN (named):** `rto_rate_bp` (or any ratio metric via ClickHouse `/` on Int64) — passes CI for all positive inputs, then serves a coercion sentinel (`inf`→Int max/NULL) on a zero-shipment day, which Child-5 anomaly detection ingests as a legitimate spike. The fix is `CF-C4-RATIO-DIVOP-1`.

### Definitional-delta finance realist

| # | Sev | Concern (one-line) | Disposition | Carried as | Owner |
|---|-----|--------------------|-------------|------------|-------|
| F1 | **HIGH** | CM2 delta = two superimposed differences (only one definitional); a wrong-constant `misc-prorated` could be stamped expected | **ACCEPT — de-duped with O2 (see §2).** Adjudication fix here; op fix in O2. Register row pins `toDaysInMonth(date)`, carries a Feb-boundary worked example, and triage asks "is Brain's formula correct?" before the pre-authorized label. | **`CF-C4-DDR-MISC-PRORATE-1`** (paired with `CF-C4-PRORATED-DIVOP-1`) | **Maya** (Register row + worked example) |
| F2 | **HIGH** | True-CM2 (RTO-provisioned) has NO legacy comparand → parity structurally undefined (silent skip = false-GREEN); RTO provision formula unspecified | **ACCEPT.** True-CM2 (and any Brain-native metric: `paMER`, `aMER`, `LTV:CAC`) must be registered as an explicit **`parity_gap: true`** row — never silently skipped by the shadow-compare. Each parity-gap row requires: the formula pinned IN FULL (the RTO provision arithmetic written out, not "subtracts RTO provision"), a hand-calculated worked example for ≥1 real workspace-date (Sugandh Lok if RTO data exists), routed to a separate **correctness-fixture gate** (NOT a shadow-compare gate), and my Stage-6 sign-off must explicitly acknowledge there is no legacy shadow. | **`CF-C4-DDR-TRUE-CM2-1`** (+ `parity_gap` field, see §4) | **Maya** (registry definition + provision formula + correctness fixture) |
| F3 | **HIGH** | `total_tax_mu` Register row ABSENT; per-SKU event tax vs legacy day-level ShopifyQL aggregate = wrong-but-signable; not valid until Child-3 per-SKU tax lines | **ACCEPT — the single highest-risk wrong-but-signed-as-expected delta.** An explicit Register row is mandatory: `legacy_formula = ShopifyQL FROM sales taxes (day-level aggregate)`, `brain_formula = SUM(event-level per-SKU GST-2.0 line tax via RegionAdapter)`, reason + magnitude estimate (bounded ~0–2% homogeneous-SKU, ~5–10% mixed 0/18% slab), and a **`child_dependency: child-3-shopify-connector`** marker so the row is NOT signable until Child-3 ingests line-item tax. While shadowing on legacy-sourced data, this delta is not even measurable — the shadow-compare on `total_tax_mu` is meaningless pre-Child-3. (Ties to `CF-C4-PARITY-SCOPE-1`: legacy-sourced GREEN is not a cutover license.) `total_tax_mu` feeds `Net-Net-Tax → Net Revenue → CM1`, so a wrong-but-signed value silently corrupts the whole ladder. | **`CF-C4-DDR-GST-TAX-1`** (+ `child_dependency` field) sharpens `CF-C4-GST-EVENT-TAX-1` | **Maya** (Register row + dependency marker) |
| F4 | **MEDIUM** | 6-field Register missing `parity_gap`, `child_dependency`, `formula_snapshot` → schema insufficient for honest sign-off | **ACCEPT — expands `CF-C4-DDR-1` from 6 → 9 fields (see §4).** This is the structural backbone that makes F2/F3 enforceable rather than ad-hoc. | **`CF-C4-DDR-1` (EXPANDED to 9 fields)** | **Maya** (Register schema) |
| F5 | **MEDIUM** | FX re-statement conflation if the placeholder rate ≠ legacy 83.5 during shadow | **ACCEPT.** During the Child-4 shadow phase, Brain's metric MV must use the SAME static rate as legacy (`83.5`) so the shadow-compare is not contaminated by two simultaneous FX changes (the expected re-statement AND a wrong placeholder). The Register FX row carries `child_dependency: child-3-workspace-cost-currency-migration` — live-rate conversion activates only once workspace-cost entries are migrated to primary-currency-at-entry. No live rate service is in Child-4 scope. | **`CF-C4-DDR-FX-RESTATEMENT-1`** (+ `child_dependency` field) sharpens `CF-MAYA-2` | **Maya** (Register FX row + shadow-phase rate pin) |

**Finance highest-risk wrong-but-signed delta (named):** `total_tax_mu` / the `Net-Net-Tax` ladder step (F3). Different ingest pipelines (ShopifyQL aggregate vs per-SKU event lines), no Register row today, unmeasurable until Child-3 cutover, and it propagates through the entire revenue + CM ladder.

**No concern is silently dropped. All 10 dispositioned above.**

---

## 4. Expanded Definitional-Delta Register schema (`CF-C4-DDR-1`: 6 → 9 fields)

The Register I sign at Stage 6 must carry, **one row per `(metric, source)`**:

| # | Field | Purpose | Source |
|---|-------|---------|--------|
| 1 | `legacy_formula` (file:line in `compute-daily.ts`/`pnl.ts`/`analytics-sync.ts`) | what legacy computed | intake `CF-C4-DDR-1` |
| 2 | `brain_formula` (registry definition id) | what Brain computes | intake |
| 3 | `reason` (wrong-by-design vs genuine bug) | the definitional justification | intake |
| 4 | `shadow_compare_classification` (`expected_definitional_delta` / `COGS_SETTINGS_CHANGE_DELTA` / blocking) | how the harness treats it | intake (+ O3 new category) |
| 5 | `delta_direction_and_magnitude` | sanity-check the expected divergence vs a hidden new error | intake |
| 6 | `business_impact` (does it change a CM2 a brand has seen?) | downstream blast radius | intake |
| 7 | **`parity_gap: boolean`** | TRUE = Brain-native metric, no legacy comparand → routes to a **correctness-fixture gate** (worked example), NEVER silently skipped by the shadow-compare | **NEW — F2/F4** |
| 8 | **`child_dependency: string \| null`** | e.g. `child-3-shopify-connector` — row is **NOT signable** until the named child's parity gate is GREEN; prevents signing against a shadow that cannot exercise the Brain formula | **NEW — F3/F5/F4** |
| 9 | **`formula_snapshot: string`** | the EXACT formula expression captured at sign-off (not just a mutable registry-id pointer) — so a post-sign-off definition amendment cannot silently change what I signed | **NEW — F4** |

**Day-one rows the architecture/personas already require:** the `pnl.ts` lagged-shipping CM2 ≠ `compute-daily.ts` daily CM2 (F1), `misc_expenses_prorated_mu` (F1, `parity_gap:false`, `child_dependency:null`, pinned `days_in_month` fn), `True-CM2`/`paMER`/`aMER`/`LTV:CAC` (F2, `parity_gap:true`), `total_tax_mu` (F3, `child_dependency:child-3-shopify-connector`), the `WorkspaceCost.currency` FX re-statement (F5, `child_dependency:child-3-workspace-cost-currency-migration`), `blended_roas`/`acos` (ROAS display-only). **A `parity_gap:true` row can NEVER be signed off as "shadow-compare GREEN" — it has no shadow. A row with a non-null `child_dependency` can NEVER be signed before that dependency is GREEN.** These two rules are the structural guarantee that a metric with no comparand is never silently skipped, and a premature sign-off is impossible.

---

## 5. Verify-the-verifier discipline — bound as binding CF (4th-occurrence reinforcement)

Three of this run's concerns (O4 defective grep, O5 vacuously-green isolation test, O1 no-ClickHouse-round-trip-fixture) are the SAME root cause that has now hit the migration epic **four consecutive times**: a verification instrument that cannot actually fail on real inputs gives a false GREEN at the exact gate that authorizes the irreversible/security-load-bearing act.

- Child-1: contextless RLS probe arm (hardcoded `return 0`; test ran as BYPASSRLS role).
- Child-2: ROUND_HALF_UP re-derivation called the same function it was meant to check (tautology).
- Child-3: `_check_pii_manifest` checked a logically-impossible condition + Shopify HMAC self-verified with the same broken `hexdigest()`.
- **Child-4 (this run, pre-emptive):** ratio-parity harness with zero ClickHouse round-trip coverage; single-writer grep blind to Prisma camelCase; cross-workspace isolation test vacuous on a single-workspace fixture.

**A human-gated rule proposal already exists** for exactly this — `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md` (status: proposed, awaiting `/adopt-rule`). I do **NOT** spawn a duplicate proposal. Instead I:
1. **Bind it as binding CF for THIS child now** (I have Stage-6 VETO authority to require it on this run regardless of adoption status): **`CF-C4-VERIFY-THE-VERIFIER-1`** — for each high-stakes gate in Child-4 (ratio-parity, query-gateway isolation, single-writer enforcement, COGS-refresh correctness), Stage-2 must NAME the real-path integration test + the killed-mutant kill-test; Stage-3 must implement both; Stage-5 must capture the killed-mutant output. The specific kill-tests for this child: (a) a ClickHouse round-trip fixture that goes RED if a division reverts from `intDiv` to `/`; (b) a two-workspace isolation test that goes RED if the `workspace_id` predicate is removed; (c) a grep gate that goes RED if a `prisma.workspaceDailyMetrics.upsert(...)` mutant is planted in Brain code.
2. **Add this run as evidence #4** to the pending proposal (appended to the decision log + flagged in `pending-founder-attention.md` for the Founder's `/adopt-rule` decision). I am NOT adopting it myself — that is human-gated.

This is the verify-the-verifier discipline made testable for Child-4, and it strengthens the case for the standing rule without pre-empting the Founder's gate.

---

## 6. Scope ruling (`CF-C4-SCOPE-SPLIT-1`) — HELD as written

**Ruling: keep the 4a/4b split as written; collapsible at Stage 2 with a one-line rationale (burden on collapsing, not on splitting).** Neither persona argued for a different scope cut; both reinforced WHY the split matters — 4b's definitional deltas (the Register) must NOT be smuggled in as "parity bugs" against 4a's exact-equality harness. The expanded Register (§4) and the verify-the-verifier binds (§5) make the 4a/4b seam sharper, not looser: 4a ships the OLAP plumbing + core ladder + the exact-integer-equality harness (now with mandatory ClickHouse round-trip fixtures); 4b ships the CM-waterfall semantics + the 9-field Register + the `parity_gap`/`child_dependency` correctness-fixture gates. Aryan+Maya may collapse into one tracked build at Stage 2 with a one-liner, but the **two distinct gate types (exact-equality vs correctness-fixture) must remain distinguishable** even if collapsed. **`CF-C4-SCOPE-SPLIT-1` held.**

---

## 7. Confirmations (held from intake, re-affirmed at synthesis)

- **Lane: high-stakes** — unchanged. Personas reinforced the trigger surfaces (money: the ratio/tax/CM ladder; schema-proto: ClickHouse MV DDL; multi-tenancy: the query-gateway isolation gap; india-compliance: residency unchanged). No surface emerged that would change the lane.
- **Paradigm: `sql` exclusively** — confirmed. Neither persona surfaced any inference path; both are pure deterministic SQL/OLAP + parity-harness concerns. Cost-routing audit remains clean. Any `@paradigm: haiku/sonnet/ml` in the metric path at Stage 6 = BOUNCE.
- **Maya co-own Stage 2** — confirmed and **strengthened**. Every accepted finding lands primarily in Maya's lane (registry definitions, taxonomy categories, the 9-field Register, parity fixtures) with Aryan owning the OLAP architecture (MV refresh model, `intDiv` DDL, query-gateway, single-writer grep+read-only role) and Jatin owning the DB read-only role / ClickHouse residency if infra. Seam: the TS↔Python metric-registry definition contract the MVs materialize and the parity harness asserts.
- **Named HOLD state: `HOLD-AT-READ-FLIP`** — confirmed; unchanged. Reinforced by F3 (`total_tax_mu` not validly comparable pre-Child-3) and `CF-C4-PARITY-SCOPE-1`: a legacy-sourced GREEN is explicitly NOT a cutover license.
- **Escalation: NONE** — confirmed. Both personas explicitly returned NO-escalate on all concerns; all 10 resolve at Stage 2 with Aryan+Maya. The Definitional-Delta Register sign-off remains a governance gate I own at Stage 6 (architecture M-A1-Q2 pre-authorized it), explicitly NOT an `/escalate`. No new compliance ambiguity, cost-model threat, irreversible build, or moat change emerged.

---

## 8. Full binding CF-C4-* contract carried to Stage 2 (with owners + severities + gate-points)

| Constraint ID | Severity | Summary | Owner(s) | Gates at |
|---|---|---|---|---|
| **`CF-C4-RATIO-DIVOP-1`** | **CRITICAL** | Every MV division uses `intDiv(num, denom)` (never `/`) + explicit null-guard `if(denom>0, intDiv(...), NULL)`; harness gains ClickHouse round-trip fixtures (non-zero-remainder, zero-denominator, Float64-vs-FLOOR divergent). Absorbs `CF-C4-RATIO-PARITY-1`. **MUST BIND BEFORE ANY MV DDL.** | Aryan (DDL) + Maya (fixtures) | Stage 2 (DDL pre-condition); Stage 5 QA; Stage 6 VETO |
| `CF-C4-PRORATED-DIVOP-1` | HIGH | `misc_expenses_prorated_mu` uses `intDiv(monthly_amount_mu, days_in_month)`; audit the `ROUNDING_MODE_MISMATCH` pre-classification so it covers ONLY Postgres ROUND_HALF_UP, not a Float64 coercion artifact. (Paired with DDR-MISC-PRORATE-1.) | Aryan (op) + Maya (taxonomy) | Stage 2 DDL; Stage 5 QA |
| `CF-C4-COGS-MV-REFRESH-1` | HIGH | Pin `cogs_mu` refresh model (incremental MV vs scheduled full recompute) preserving exact-integer-equality; if incremental add NAMED `COGS_SETTINGS_CHANGE_DELTA` taxonomy category (NOT `expected_definitional_delta`) + a coq-settings-change CI fixture. | Aryan (refresh) + Maya (taxonomy+fixture) | Stage 2 arch; Stage 5 QA |
| `CF-C4-SINGLE-WRITER-GREP-2` | HIGH | Single-writer static gate covers ≥3 patterns: SQL table write targets; Prisma camelCase model write-method calls; + a DB-level read-only role for the analytics-service Postgres user enforced at startup. Sharpens `CF-C4-SINGLE-WRITER-1`. | Aryan (grep+role) + Jatin (DB role if infra) | Stage 5 QA; Stage 6 VETO |
| `CF-C4-QUERY-SCOPE-ISOLATION-1` | MEDIUM | Stage-5 negative control seeds TWO workspaces, queries as `ws_A`, asserts ZERO `ws_B` rows. An un-scoped-rejection test on an empty fixture is insufficient. Sharpens `CF-C4-QUERY-SCOPE-1`. | Aryan (gateway+test spec) | Stage 5 QA |
| `CF-C4-DDR-1` **(EXPANDED 6→9 fields)** | HIGH | Add `parity_gap`, `child_dependency`, `formula_snapshot`. A `parity_gap:true` row is never signed as "shadow GREEN"; a non-null `child_dependency` row is never signed before that dependency is GREEN. | Maya (schema) | Stage 6 Rohan sign-off |
| `CF-C4-DDR-MISC-PRORATE-1` | HIGH | Register row pins ClickHouse `days_in_month` fn (`toDaysInMonth(date)`, never `30`), Feb-boundary worked example; triage asks "is Brain's formula correct?" before stamping expected-delta. (Paired with PRORATED-DIVOP-1.) | Maya (Register row) | Stage 6 sign-off |
| `CF-C4-DDR-TRUE-CM2-1` | HIGH | True-CM2 + paMER/aMER/LTV:CAC registered `parity_gap:true`; RTO provision formula pinned IN FULL; hand-calc worked example; routed to a correctness-fixture gate (not shadow-compare); sign-off acknowledges no legacy shadow. | Maya (definition+formula+fixture) | Stage 2; Stage 5 QA; Stage 6 sign-off |
| `CF-C4-DDR-GST-TAX-1` | HIGH | Explicit `total_tax_mu` Register row (ShopifyQL aggregate vs per-SKU event tax), magnitude estimate, `child_dependency:child-3-shopify-connector`; not signable/measurable pre-Child-3. Sharpens `CF-C4-GST-EVENT-TAX-1`. | Maya (Register row) | Stage 2; Stage 6 sign-off |
| `CF-C4-DDR-FX-RESTATEMENT-1` | MEDIUM | Shadow-phase MV uses the SAME static rate as legacy (`83.5`); FX row `child_dependency:child-3-workspace-cost-currency-migration`; no live rate service in Child-4 scope. Sharpens `CF-MAYA-2`. | Maya (Register row+rate pin) | Stage 2; Stage 6 sign-off |
| `CF-C4-VERIFY-THE-VERIFIER-1` | HIGH | Each Child-4 high-stakes gate (ratio-parity, query isolation, single-writer, COGS-refresh) NAMES a real-path integration test + a killed-mutant kill-test at Stage 2; implemented Stage 3; killed-mutant output captured Stage 5. (Reinforces the pending standing rule; bound for THIS child by Rohan's VETO authority.) | Aryan+Maya (name tests) | Stage 2 (named); Stage 3 (built); Stage 5 (captured); Stage 6 VETO |

**Held unchanged from intake (carried verbatim):** `CF-C4-SCOPE-SPLIT-1`, `CF-C4-SINGLE-WRITER-1` (now sharpened by GREP-2), `CF-C4-RESIDENCY-1`, `CF-C4-QUERY-SCOPE-1` (sharpened by ISOLATION-1), `CF-C4-PARITY-SCOPE-1`, `CF-C4-CACHE-PURGE-ARM-1`.

**Inherited:** `CF-BN-NOLEGACY-1`, `CF-RES-1`, `CF-MAYA-1`, `CF-MAYA-2` (sharpened by DDR-FX), money=MU/no-float, TS↔Python exact-integer-equality parity, single-writer C2, `CF-QA-1.HARD`, Child-2 carry-forward F3 (gate-also-asserts-`expected_minor_units` → land here) + N1 (stale `ratio.py` docstring cleanup → here).

---

## 9. What Stage 2 needs from Aryan + Maya (must-resolve list)

**Aryan (OLAP architecture + plumbing):**
1. **BEFORE any MV DDL:** bind `CF-C4-RATIO-DIVOP-1` — `intDiv` + null-guard on every division; this gates the whole DDL pass.
2. Pin the `cogs_mu` refresh model (incremental MV vs scheduled recompute) and prove it preserves exact-integer-equality (`CF-C4-COGS-MV-REFRESH-1`).
3. Specify the single-writer static gate's ≥3 patterns + the analytics-service DB read-only role at startup (`CF-C4-SINGLE-WRITER-GREP-2`).
4. Specify the query-gateway enforcement mechanism (mandatory predicate injection vs scoped-view layer) + the two-workspace isolation test spec (`CF-C4-QUERY-SCOPE-ISOLATION-1`).
5. NAME, per high-stakes gate, the real-path integration test + the killed-mutant kill-test (`CF-C4-VERIFY-THE-VERIFIER-1`).
6. Rule on 4a/4b collapse-vs-split with a one-line rationale (`CF-C4-SCOPE-SPLIT-1`); keep exact-equality and correctness-fixture gates distinguishable if collapsed.
7. Resolve the build-base (merge Child-1/2 to development vs branch-from feature) — carried from intake.

**Maya (metric registry + definitions + ClickHouse mappings + Register):**
1. Expand the Definitional-Delta Register schema 6→9 fields (`parity_gap`, `child_dependency`, `formula_snapshot`) and author the day-one rows (§4).
2. Pin the `misc_expenses_prorated_mu` ClickHouse `days_in_month` function (`toDaysInMonth(date)`, never a constant) + Feb-boundary worked example (`CF-C4-DDR-MISC-PRORATE-1`); audit the `ROUNDING_MODE_MISMATCH` classification.
3. Write the True-CM2 RTO-provision formula IN FULL + a hand-calculated worked example; register it `parity_gap:true` routed to a correctness-fixture gate (`CF-C4-DDR-TRUE-CM2-1`).
4. Author the `total_tax_mu` Register row with `child_dependency:child-3-shopify-connector` + magnitude estimate (`CF-C4-DDR-GST-TAX-1`).
5. Author the FX re-statement row with `child_dependency:child-3-workspace-cost-currency-migration` + pin the shadow-phase static rate to legacy `83.5` (`CF-C4-DDR-FX-RESTATEMENT-1`).
6. Add the ClickHouse round-trip parity fixtures (`CF-C4-RATIO-DIVOP-1`) + the `COGS_SETTINGS_CHANGE_DELTA` taxonomy category + fixture (`CF-C4-COGS-MV-REFRESH-1`); land Child-2 carry-forward F3 + N1.

**Jatin (infra, if applicable):** ClickHouse ap-south-1 residency startup assertion (`CF-C4-RESIDENCY-1`); the analytics-service DB read-only role provisioning (`CF-C4-SINGLE-WRITER-GREP-2`).

---

## 10. Decision

**ADVANCE → Stage 2 (Architect Aryan + Intelligence-Engineer Maya co-own).**

- **Not CHALLENGE-BACK:** the requirement is sound, precisely grounded in the binding Child-0 architecture, dependency-satisfied, and planable; the personas sharpened the contract rather than exposing a flaw that requires a Founder re-spec. The scope-size concern stays resolved by the internal 4a/4b split.
- **Not KILL:** this is the data engine the entire runnable UI + Child-5 AI depend on (DAG 2→4→5/6); non-negotiable to the epic.

Both personas accepted (quality gate passed). All 10 concerns folded with owners (1 CRITICAL must-bind-before-DDL + 6 HIGH + 3 MEDIUM, one HIGH/HIGH pair de-duped across the OLAP/finance overlap). Register expanded 6→9 fields. Verify-the-verifier bound for this child + evidence #4 added to the pending standing-rule proposal. Scope, paradigm, Maya co-own, HOLD-AT-READ-FLIP, escalation=none all confirmed.

---

## 11. DoD (Stage 1 — synthesis pass)

- [x] Persona quality gate verified (both PASS; CRITICAL + 2 finance claims independently re-verified against source)
- [x] All 10 concerns dispositioned (accept/reject + reason); the CM2/prorated overlap de-duped
- [x] Accepted concerns folded into CF-C4-* with owner tags + severities + gate-points
- [x] Definitional-Delta Register expanded 6→9 fields (`parity_gap` / `child_dependency` / `formula_snapshot`); True-CM2 = `parity_gap`, `total_tax_mu`/FX = `child_dependency` rows
- [x] Verify-the-verifier discipline bound as `CF-C4-VERIFY-THE-VERIFIER-1`; evidence #4 added to the pending human-gated rule proposal (NOT self-adopted)
- [x] Scope ruling confirmed (`CF-C4-SCOPE-SPLIT-1` held; collapsible with rationale)
- [x] Paradigm (`sql`), Maya co-own, HOLD-AT-READ-FLIP, escalation=none all confirmed
- [x] Decision recorded (ADVANCE → Stage 2)
- [ ] state/active.json updated (this pass) + decision-log line + feature journal (this pass)

---

## 12. Next

Orchestrator advances to **Stage 2 — Architect (Aryan) + Intelligence-Engineer (Maya) co-own**. The binding CF-C4-* contract (§8) + the must-resolve list (§9) are the inputs. `CF-C4-RATIO-DIVOP-1` is the gate on the MV DDL pass — no DDL before it is bound.
