# Stage 1 — CTO Advisor Review (Rohan)

**req_id:** `feat-metric-engine-olap-split` (Child 4 of EPIC `chore-migrate-legacy-to-brain`)
**Stage:** 1 (intake / brainstorm)
**Reviewer:** Rohan (cto-advisor)
**Timestamp:** 2026-05-25T03:10:00Z
**Decision:** **ADVANCE** (2 personas requested first → synthesis pending orchestrator re-invoke)

---

## TL;DR

Child 4 is the data engine behind the runnable UI — the metric registry + canonical definitions + ClickHouse materializations the dashboard, P&L, CM waterfall, and (Child 5) AI all read. The requirement is **sound, well-grounded in the binding Child-0 architecture, and planable** — it is NOT a CHALLENGE-BACK and NOT a KILL. But it is **the largest single-child surface in the epic** (the full revenue+CM+marketing+COD/RTO ladder + a new OLAP store + a governance gate), so my intake does real work: I **bind a scope split (4a core / 4b CM-waterfall+Register) as a Stage-2 must-decide**, harden the single-writer + residency + Definitional-Delta governance gates into testable constraints, and reaffirm `sql` exclusively. Maya co-owns Stage 2 (her lane: metric registry + ClickHouse + the M-A1-1 mappings she authored).

---

## Pre-flight dependency check (MANDATORY — child requirement)

Child-4 entry in the epic `proposed_children` (state line 1554): `blocks: [child-0-audit-migration-architecture-spike, child-2-money-minor-units-migration]`.

| Blocker | Status in state | Satisfied? |
|---|---|---|
| `child-0-audit-migration-architecture-spike` | `done` (spike-legacy-migration-architecture) | YES |
| `child-2-money-minor-units-migration` (`feat-money-minor-units-parity`) | `committed-on-feature-branch` (sha 3c1134f) | YES |

- **Child 1 (RLS gate):** SATISFIABLE Brain-native (`feat-tenancy-rls-brain-native`, committed 860aeee). Architecture A2.2 row 4 requires the gate be **FORCE-ready**; SATISFIABLE is sufficient for the **shadow build** this child delivers (live FORCE stays HELD). No violation.
- **Child 3 (connectors):** in pipeline (Stage 8 readiness, awaiting-founder-commit). **NOT a hard block** per architecture line 515 + DAG line 515: "Child 4 can shadow on legacy-sourced data if a connector hasn't cut over — no hard block." Confirmed. (Parity-confound risk flagged below — Challenge (e).)

**Result: NO dependency violation. Proceed.** Both hard blockers shipped/committed; Child-1 gate at the required readiness; Child-3 explicitly non-blocking.

**Build-base note (carry to Stage 2, not blocking intake):** Child-1/2 are committed on `feature/feat-tenancy-auth-rls-hardening`, not yet merged to `development`. Child-4 build consumes `packages/lib-metrics` + `pylibs/brain_metrics` + the parity gate — resolve the build-base (merge-to-development or branch-from) at Stage 2/3, same as Child-3 handled it.

---

## Semantic recall (v0.8.0)

`memory_search -k 6` on the Child-4 gist returned **no near-duplicate**. Nearest shipped patterns: `feat-money-minor-units-parity` (Child-2 — the MU + parity-harness foundation this child EXTENDS, sim 0.69–0.72) and `spike-legacy-migration-architecture` (the binding architecture, sim 0.69). This is a genuine new build that **stands on Child-2's shoulders** — reuse the parity-harness shape, the `expected_definitional_delta` taxonomy hook (Child-2 carry-forward F3, confirmed present at `pylibs/brain_metrics/brain_metrics/parity/taxonomy.py`), and the Shape-A boundary pattern; do not re-derive them.

---

## Lane decision

| Field | Value |
|---|---|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger scan fires ≥4 surfaces: **money** (every metric value is MU/scaled-INT; CM waterfall feeds CM2 economics), **schema-proto** (ClickHouse MV/base schema + metric-registry contract + any proto for the analytics read path), **multi-tenancy** (workspace-scoped MVs + query-gateway must reject un-scoped reads — a cross-tenant metric leak is a P0), **india-compliance** (OLAP residency: ClickHouse must be ap-south-1 per CF-RES-1). Foundational-scaffolding carve-out **inapplicable** (live money semantics + a new live data store + the read-source authoritativeness gate). Conservative tie-break moot — multiple hard surfaces force high-stakes outright. |
| **trigger_surfaces_touched** | `["money", "schema-proto", "multi-tenancy", "india-compliance"]` |
| **Stages that run** | Full high-stakes lane: 1 (intake, 2 personas) → 2 (architect Aryan, **Maya co-owns**) → 3 (build) → 4 (Shreya security) → 5 (Tanvi QA) → 6 (Rohan final-review VETO) → 7 (Founder gate, delegated) → 8 (readiness). No stage drops. Mutation tests required at Stage 5 (the parity gate + the query-gateway scope-rejection are exactly the predicates a tautological test could fake — see Child-2/Child-3 retro pattern). |

---

## Paradigm

**`sql` exclusively — CONFIRMED and BINDING.**

Architecture **M-A1-Q1 ruling is unambiguous** (line 272): *"Every metric in `workspace_daily_metrics` is a deterministic SQL aggregation or arithmetic combination… No metric requires ML… Paradigm for Child 4: `sql` exclusively for all metric materializations."* The COGS lookup is a SQL join; proration is SQL arithmetic with a calendar function; signals (anomaly/spike/trend) are SQL/statistical (ClickHouse `stddevPop` / `simpleLinearRegression`), NOT ML and NOT this child's scope anyway.

**Cost-routing audit (clean):** there is NO inference path in this child. Any `@paradigm: haiku/sonnet/ml` decorator appearing anywhere in the metric materialization path at Stage 6 = a **paradigm violation** and an automatic BOUNCE. LLMs **never produce a number** in Brain (this is the canon's hard rule and the entire point of the metric registry). The AI surface that *reads* these metrics is Child 5 — out of scope here.

**Binding for Stage 6 audit:** zero LLM/ML in the metric path; every materialization is deterministic SQL with TS↔Python registry parity.

---

## Domain context check (India-D2C business canon)

- **CM2-first, ROAS display-only:** CONFIRMED honored. Architecture lines 48/260/410–417 + the requirement scope explicitly make CM1/CM2/CM3 + True CM2 the decision surface and `blended_roas`/`acos` display-only (`*_x100`/`*_bp`, flagged `display_only:true`). Any registry definition that re-privileges ROAS as a decision metric = challenge at Stage 2/6.
- **COD/RTO economics:** CONFIRMED in scope (`rto_orders`/`rto_value_mu`/`rto_rate_bp`, prepaid rate, COD break-even) — honest CM2 in India is impossible without RTO provisioning. Good.
- **GST 2.0 per-SKU (0/5/18/40):** `total_tax_mu` is a SQL aggregation from order events (line 243) — the per-SKU rate lives at the order/line-item event level (Child-3 ingest), not the metric registry. Stage-2 check: confirm tax is summed from event-level rates, NOT a single blended workspace rate (a blended rate silently breaks under the 4-tier GST 2.0 regime). Flagged to Aryan/Maya.
- **Money = minor-units, no float in the metric path:** CONFIRMED — `_mu` BIGINT + ratio scaled-INT (×10,000, FLOOR), zero `Decimal`/float in Brain (consumes Child-2's locked types). The legacy `compute-daily.ts` TS-float compute is the thing being replaced.
- **Multi-tenancy:** workspace-scoped MVs + query-gateway rejecting un-scoped queries is in scope — this is the metric-layer expression of the Child-1 RLS guarantee in the OLAP store. Non-negotiable.
- **Decision Log / minor-units / RegionAdapter:** Decision-Log writes are Child-5's concern (metrics are read by agents, not written by them here). RegionAdapter: India metric semantics only this child; UAE/GCC deferred (Phase 4). OK.

No business-canon violation. The requirement is economically honest.

---

## Challenges (anti-blind-agreement — I stress-tested this; I did not rubber-stamp it)

### (a) Scope size — SHOULD THIS BE SLICED? → **YES. Bound as a Stage-2 split (4a / 4b), NOT two requirements, NOT a CHALLENGE-BACK.**

The in-scope list is the **single largest surface in the epic**: the full revenue ladder (Gross→Net→Net-Net-Tax-per-SKU→Net→Realized/Delivered) + CM1/CM2/CM3 + True CM2 + MER/aMER/paMER/CAC/payback/LTV:CAC + COD/RTO + Goal RAG, **plus** a brand-new OLAP store (ClickHouse) with MV DDL + a workspace-scoped query gateway, **plus** a governance gate (Definitional-Delta Register). That is three distinct risk classes in one child.

I will **not** bounce it back (it is sound and planable) and I will **not** split it into two separate `/requirement`s (that fragments the parity-harness ownership and the single-writer gate across two pipelines — the same anti-pattern I avoided on Child-1 1a/1b and Child-3 3a/3b/3c). Instead I **bind an internal scope split as a Stage-2 must-decide**, mirroring the proven pattern:

- **4a — Core ladder + OLAP plumbing + parity (the dangerous unit, ships first):** the ClickHouse base/MV schema + query-gateway (workspace-scoped, rejects un-scoped) + the revenue ladder + CM1 + the marketing display metrics + COD/RTO counts/rates + the shadow-compare harness extending Child-2's `check-metrics-parity.sh` to exact-integer-equality vs the legacy rollups. This is the structurally hard, parity-provable core.
- **4b — CM waterfall semantics + Definitional-Delta Register (the governance unit, ships behind 4a):** CM2/CM3 + True CM2 + MER/aMER/paMER + the **Definitional-Delta Register** (CF-MAYA-1) capturing every row where `legacy_formula != brain_formula` (the `pnl.ts` lagged-shipping CM2 vs `compute-daily.ts` daily CM2 divergence; FX `WorkspaceCost.currency` re-statement; ROAS-display-only). These are where the *definition itself* changes, so money-equality parity is **insufficient** and a definitional sign-off is required.

**Aryan/Maya may collapse 4a/4b into one tracked build at Stage 2 with a one-line rationale (burden on collapsing, not on splitting)** — same mechanism as Child-2/Child-3 co-own. The point of the bind is that 4b's definitional deltas are NOT smuggled in as "parity bugs" against 4a's exact-equality harness. **Binding: `CF-C4-SCOPE-SPLIT-1`.**

### (b) Definitional-Delta Register governance gate (CF-MAYA-1) — WHAT MUST BE SIGNED BEFORE A READ-SOURCE FLIP? → **Ruled. This is a governance gate, NOT an /escalate.**

The architecture (M-A1-Q2 ruling, line 410) requires: *"Child 4 architect must explicitly document all confirmed definition changes in a Definitional-Delta Register (one row per metric+source where legacy_formula != brain_formula), reviewed and signed by Rohan before cutover."*

I bind the Register's **minimum signable content** (`CF-C4-DDR-1`): one row per `(metric, source)` where the formula changes, each row carrying — (1) `legacy_formula` (file:line in `compute-daily.ts`/`pnl.ts`), (2) `brain_formula` (registry definition id), (3) the **reason** the legacy number is wrong-by-design vs a genuine bug, (4) the **shadow-compare classification** (`expected_definitional_delta`, consuming Child-2's `taxonomy.py` hook — NOT a blocking bug), (5) the **direction + magnitude** of the expected delta (so a reviewer can sanity-check it's the *expected* divergence and not a new error hiding behind the label), (6) **business impact** (does this change a CM2 number a brand has seen?). Known day-one rows from the architecture: the `pnl.ts` lagged-shipping CM2 ≠ `compute-daily.ts` daily CM2 (Brain canonicalizes on daily), and the `WorkspaceCost.currency` FX re-statement.

**The sign-off is mine (Rohan) and it gates CUTOVER, not this child's build.** This child *builds and populates* the Register + the `expected_definitional_delta` classifier; it does **not** flip any read source (that is the named HOLD state, Stage 8). So the Register is a **Stage-6 review artifact I must sign at final review**, and the live read-source flip stays HELD. **This is a governance gate, not an escalation** — it is canon-derivable (the architecture pre-authorized my sign-off; nothing here needs Founder interpretation). No `/escalate`.

### (c) Single-writer C2 — HOW IS DUAL-WRITE TO THE LEGACY POSTGRES ROLLUP STRUCTURALLY PREVENTED? → **Bound as a hard, testable constraint.**

Architecture A3.3 (line 538) is explicit: `workspace_daily_metrics` is **single-writer-at-a-time**; Brain's shadow compute lands in a **separate ClickHouse materialization**, and the Postgres rollup keeps **exactly one writer (legacy)** until the ownership gate flips. A Brain writer touching the Postgres rollup is a data race, not a shadow.

"The facade enforces writer-exclusivity" is prose — I want it **structural**. Binding `CF-C4-SINGLE-WRITER-1`: (1) Brain's metric engine has **NO write path to the legacy Postgres rollup tables** (`workspace_daily_metrics`, `product_daily_aggregates`, `shopify_analytics_daily`, the `*_ads_*` rollups) — it writes **only** to ClickHouse; (2) a **grep/static gate** at Stage 5 proves zero Brain code references the legacy rollup tables as a write target (mirrors Child-1's banned-shape grep and Child-3's bare-write grep — a *real* grep, not a `grep -v`-defective one); (3) `CF-BN-NOLEGACY-1` reaffirmed — Brain never edits legacy `compute-daily.ts`. The legacy rollup stays the single writer of Postgres; Brain is the single writer of ClickHouse; they never overlap. The read-source flip (which makes Brain authoritative) is the HELD Stage-8 ceremony, not a code path this child runs.

### (d) ClickHouse residency + workspace-scoped query-gateway → **Bound.**

- **Residency (`CF-C4-RESIDENCY-1`, sharpens CF-RES-1):** ClickHouse Cloud **must be ap-south-1**. Mirror Child-3's `CF-C3-RESIDENCY-ASSERT-1` — a **startup gate that asserts the ClickHouse endpoint region and refuses to start on mismatch** (not a comment, a runtime assertion). India-in-region by default; OLAP metrics derive from order/customer events, so the store is in DPDP scope.
- **Query-gateway (`CF-C4-QUERY-SCOPE-1`):** every ClickHouse read goes through a gateway that **injects/enforces `workspace_id`** and **rejects un-scoped queries** — the OLAP analogue of Child-1's RLS. ClickHouse has no Postgres-style RLS, so isolation is **enforced at the query layer** (mandatory `workspace_id` predicate + a fail-closed gateway that refuses a query lacking it). Stage-5 must include a **negative control**: an un-scoped query is rejected, and a cross-workspace query returns zero rows. This is a multi-tenancy P0 — a metric leak across brands is the same class of incident as the Child-1 RLS leak.

### (e) Shadowing on legacy-sourced data (Child-3 not cut over) — PARITY CONFOUND? → **Real risk; bound, not blocking.**

Architecture line 515 permits Child-4 to shadow on legacy-sourced data. But there is a genuine confound: if Brain's ClickHouse MV is fed from the **same legacy event source** the legacy rollup computes from, exact-integer-equality proves only that **Brain's SQL re-implementation of the formula is correct** — it does **not** prove Brain's ingest (Child-3) produces the same events. That is fine *as long as we are honest about what the parity gate proves*. Binding `CF-C4-PARITY-SCOPE-1`: the shadow-compare must **declare its input source** per run (legacy-sourced vs Brain-Child-3-sourced). When shadowing on legacy-sourced data, the gate proves **formula/representation parity** (the in-scope claim for this child); **ingest parity** is Child-3's count-based check (`CF-C3-PARITY-COUNT-1`), already satisfied separately. The two must not be conflated — a GREEN formula-parity run on legacy-sourced data is **not** a license to flip the read source; the live flip (HELD, Stage-8) additionally requires Child-3's connector cut over for that source so the *full chain* (ingest→MV→serve) is parity-proven. This keeps the parity claim honest and prevents a false-GREEN cutover.

---

## Named HOLD state (mirrors Child-1 HOLD-AT-FORCE / Child-2 HOLD-AT-LIVE-RECON / Child-3 HOLD-AT-CUTOVER)

**`HOLD-AT-READ-FLIP`** — this child builds the registry + canonical definitions + ClickHouse base/MV DDL + query-gateway + shadow-compare harness + Definitional-Delta Register, all Brain-native and LOCAL/shadow-verified. The **live read-source flip** (legacy-writes/Brain-reads-shadow → Brain-writes/legacy-reads-fallback → legacy-reads-decommissioned, per A2.2 row 4) is **HELD to a Stage-8 named ownership gate**, gated on: (i) exact-integer-equality parity GREEN, (ii) my signed Definitional-Delta Register, (iii) the `CACHE-PURGE-C4C5` gate armed (the `filtersHash` cache purge that fires before Child-5 AI reads the new source). **Zero live read-source flip, zero live DDL on the legacy rollup, this child.** Shape-A boundary.

---

## Escalation (per rubric)

**NONE at intake.** Checked every trigger:
- **Compliance ambiguity?** No. Residency is ap-south-1 (positive assertion, sharpened to a startup gate); the metric path is ingest-derived OLAP with no new DLT/NCPR/WhatsApp/voice/calling-window surface (those are channel surfaces, not metric surfaces). No DPDP interpretation gap — minimization/purpose already bound at Child-3 ingest (`CF-C3-CONSENT-COLUMN-1`).
- **Cost-model threat to %-of-GMV pricing?** No — `sql` exclusively, zero inference path, the opposite of a cost threat.
- **Irreversible/high-blast-radius?** The build is additive + reversible (shadow only; HOLD-AT-READ-FLIP). The irreversible flip is the HELD Stage-8 ceremony, gated by my Register sign-off — handled by governance, not escalation.
- **Moat change (Decision Log / Memory Layer / non-negotiable)?** No — this child *implements* the metric-registry non-negotiable, it does not change it.

The **Definitional-Delta Register sign-off is a governance gate I own (Stage 6), explicitly NOT an escalation** — the architecture pre-authorized it as my call. Ruled.

---

## Persona-count decision

**Count: 2** (high-stakes cap; two distinct, intersecting risk dimensions — exactly the table's 2-persona condition).

| # | Persona | Depth tag | Dominant dimension | Brief |
|---|---|---|---|---|
| 1 | `metric-parity-olap-correctness-realist` | `:sonnet` | Engineering: numeric/OLAP correctness | Adversarially prove the exact-integer-equality shadow-compare can be FALSE-GREEN: ClickHouse MV aggregation-order/type-coercion vs the registry SQL; `aov_mu = net_sales_mu / orders_count` and ratio FLOOR(×10,000) rounding under ClickHouse integer division vs TS/Python; the COGS-lookup join (`resolve_line_item_cogs`) under MV refresh semantics; the single-writer grep being defective (the Child-3 `grep -v` lesson); the query-gateway scope-rejection being structurally inert (the Child-1 contextless-arm / Child-3 inert-PII-gate lesson — verify-the-verifier). Name the one metric most likely to silently diverge. **Reasoning-heavy → :sonnet.** |
| 2 | `definitional-delta-finance-semantics-realist` | `:sonnet` | Finance semantics: definition-vs-bug | Pressure-test the Definitional-Delta Register: which formula changes are *known divergences* (pnl.ts lagged-shipping CM2; FX re-statement; ROAS-display-only) vs which could be a *new bug wearing the `expected_definitional_delta` label*; whether True CM2 / RTO-provisioned CM2 introduces a definition the legacy never had (so there's no legacy number to compare — a parity *gap*, not a delta); GST-2.0 per-SKU tax summed from event rates vs a blended rate; whether the Register's content is sufficient for me to sign honestly. Name the one definitional delta most likely to be a disguised bug. **Multi-step finance reasoning → :sonnet.** |

**Rationale (classifier rule):** two distinct risk dimensions **intersect** — numeric/OLAP correctness (does the SQL re-implementation match exactly) AND finance-definition governance (is a "delta" a known divergence or a hidden bug). Neither subsumes the other; the parity realist will wave through a definitional change as "expected," and the finance realist can't audit ClickHouse aggregation correctness. This is the textbook 2-persona case. **I did NOT take 3+** — declined an `india-compliance-officer` (no new channel/PII surface beyond Child-3's already-bound ingest; residency is a one-line startup-gate bind, not a reasoning dimension that needs a persona) and a generic architecture persona (Aryan's Stage-2 job). Both declines recorded so the count stays at the honest cap.

**Both tagged `:sonnet`** — both are genuinely reasoning-heavy (numeric-parity false-GREEN analysis; multi-step finance-semantics adjudication), not bounded checklist angles. This is the right tier; a `:haiku` here would miss the subtle false-GREEN and definition-vs-bug calls that are the entire reason these personas exist.

**I do not spawn them.** Returned in `needs_personas` for the orchestrator to spawn in parallel (`03-persona-*.md`, `04-persona-*.md`), then re-invoke me for synthesis. Each must surface ≥1 code/architecture-grounded concern or it is rejected as a "looks good" persona.

---

## Maya co-own Stage 2

**CONFIRMED — YES.** This is squarely Maya's lane: she **authored** the M-A1-1 rollup→metric-registry mapping, M-A1-Q1/Q2 rulings, and the ratio/4-decimal canonical rules in the Child-0 spike. The metric registry + ClickHouse materializations + the Definitional-Delta Register are her domain; Aryan owns the OLAP architecture (query-gateway, MV refresh model, single-writer enforcement, residency startup-gate) and the service-layer plumbing. **Stage 2 co-owned: Aryan (architecture/plumbing) + Maya (metric registry + definitions + ClickHouse mappings + Register).** Integration seam: the metric-registry definition contract (TS↔Python) that the ClickHouse MVs materialize and the parity harness asserts.

---

## Binding constraints carried to Stage 2

Inherited: `CF-BN-NOLEGACY-1`, `CF-RES-1` (residency), `CF-MAYA-1` (Definitional-Delta Register pre-condition), `CF-MAYA-2` (WorkspaceCost currency-at-entry), money=MU/no-float, TS↔Python parity (CI gate, exact-integer-equality), single-writer C2, `CF-QA-1.HARD` (real byte-identity parity gate), Child-2 carry-forward **F3** (`gate-also-asserts-expected_minor_units` → land here), Child-2 carry-forward **N1** (stale `ratio.py` docstring → clean up here).

New (this intake):
- `CF-C4-SCOPE-SPLIT-1` — 4a core+OLAP+parity / 4b CM-waterfall+Definitional-Delta-Register; collapsible at Stage 2 with one-line rationale; 4b deltas never smuggled as 4a parity bugs.
- `CF-C4-DDR-1` — Definitional-Delta Register minimum signable content (6 fields per row); built+populated this child; signed by Rohan at Stage 6; gates the HELD cutover, not the build.
- `CF-C4-SINGLE-WRITER-1` — zero Brain write path to the legacy Postgres rollup; static grep gate (a *real* grep) at Stage 5; Brain writes ClickHouse only.
- `CF-C4-RESIDENCY-1` — ClickHouse ap-south-1 startup assertion, refuse-to-start on mismatch.
- `CF-C4-QUERY-SCOPE-1` — workspace-scoped query gateway; un-scoped query rejected (fail-closed); cross-workspace returns zero rows; Stage-5 negative control + mutation test.
- `CF-C4-PARITY-SCOPE-1` — shadow-compare declares input source per run; legacy-sourced GREEN proves formula/representation parity only (not ingest parity); not a cutover license.
- `CF-C4-RATIO-PARITY-1` — ratio metrics use `FLOOR(ratio × 10,000)` scaled-INT with the **same zero-tolerance** rule as money (`ROUND_HALF_EVEN(legacy_decimal × 100) == brain_bp`); a wrong rate corrupts Child-5 anomaly context (M-A5-Q1).
- `CF-C4-GST-EVENT-TAX-1` — `total_tax_mu` summed from event-level per-SKU GST-2.0 rates, NOT a blended workspace rate.
- `CF-C4-CACHE-PURGE-ARM-1` — the `CACHE-PURGE-C4C5` gate (M-A5-5 / line 470) is armed as a Stage-8 pre-condition for the eventual Child-5 read; named, not built-live, this child.

---

## Decision

**ADVANCE** → personas requested first (synthesis pending orchestrator re-invoke), then Stage 2 (Architect Aryan, **Maya co-owns**).

- **Not CHALLENGE-BACK:** the requirement is sound, precisely grounded in the binding architecture, dependency-satisfied, and planable. The scope-size concern is resolved by an *internal* split bind (`CF-C4-SCOPE-SPLIT-1`), not a bounce.
- **Not KILL:** this is the data engine the entire runnable UI + Child-5 AI depend on (DAG: 2→4→5/6). Non-negotiable to the epic.

---

## DoD (Stage 1)

- [x] `02-cto-advisor-review.md` filled (no `{{TBD}}`)
- [x] Lane decision recorded (high-stakes + rationale + 4 trigger surfaces); conservative tie-break moot; lane to be set on `state/active.json`
- [x] Persona-count decision recorded (2, within high-stakes cap; both `:sonnet`; declines logged); ≥1-concern gate stated
- [x] Pre-flight dependency check complete (no violation)
- [x] Decision recorded (ADVANCE)
- [x] Paradigm confirmed (`sql` exclusively, M-A1-Q1)
- [x] Maya co-own confirmed
- [x] Escalation ruled (none; DDR is governance not escalation)
- [ ] Decision log + journal + feature journal + state updated (this pass)

---

## Next

Orchestrator spawns the 2 personas in parallel (`03-persona-metric-parity-olap-correctness-realist.md`, `04-persona-definitional-delta-finance-semantics-realist.md`) → re-invokes Rohan for synthesis → Stage 2 (Aryan + Maya).
