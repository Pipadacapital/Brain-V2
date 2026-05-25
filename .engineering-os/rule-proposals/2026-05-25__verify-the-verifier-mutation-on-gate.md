# Rule Proposal — verify-the-verifier-mutation-on-gate

> A proposed change to the team's operating rules. Lives at `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`.
> Proposed by an agent; ADOPTED only when Founder runs `/brain-engineering-os:adopt-rule <proposal-path>`.
> Agents CANNOT self-promote a proposal to a durable rule.

| Field | Value |
|---|---|
| **proposal_id** | `verify-the-verifier-mutation-on-gate` |
| **proposed_by** | `cto-advisor` (Rohan), Stage-6 auto-candidate detection |
| **proposed_at** | 2026-05-25T02:40:00Z |
| **target_scope** | `stage-3-developer` + `stage-5-qa` (enforced), informational for `stage-2-architect` (must name the gate's kill-test in the plan) |
| **status** | proposed |

---

## Proposed text

> **For every high-stakes GATE (a check whose GREEN authorizes an irreversible or security-/compliance-load-bearing act — RLS isolation, PII fail-closed, numeric-parity, HMAC/auth verification, fail-closed predicates), two conditions are MANDATORY at Stage 3 and re-verified at Stage 5:**
> 1. **The gate is exercised by its real integrated entrypoint with the real collaborator** — never a hand-built test double that manufactures the gate's trigger condition. The test calls the actual function the production path calls (e.g. `ingest_batch`, not a stub), bound to the actual registry/manifest/policy (e.g. the real `SHOPIFY_MANIFEST`), AND includes a negative control proving the gate does NOT false-positive.
> 2. **A mutation-style test proves the gate can FAIL** — i.e. there exists a captured mutant (gate removed / predicate inverted / encoding swapped) that the test suite KILLS. A gate with no killing test is treated as structurally inert and BOUNCES.
>
> The Stage-2 plan must name, per high-stakes gate, the kill-test and the real-path integration test that satisfy (1) and (2). The Stage-5 QA review must capture the killed-mutant output. Absence of either is a blocking finding, not a nit.

---

## Rationale

Three consecutive children of the legacy→Brain migration bounced (or nearly shipped) on the SAME root cause: a verification instrument that could never actually fail on real inputs gave a false GREEN at the exact gate that decides the irreversible/security-critical act. Per-track unit-green hid it every time because the bug lived in the cross-track seam (gate-wired-into-the-primitive) or in a tautological test double. This is the single most dangerous failure mode in the migration because the gates in question are the ones that protect tenant isolation, customer PII, money correctness, and webhook authenticity — the moat. The fix is cheap and mechanical (one real-path test + one killed mutant per gate); the cost of missing it is a silent isolation/PII/parity breach shipped behind a green check.

---

## Evidence

- **Child-1 (`feat-tenancy-rls-brain-native`)** — CF-SEC-1 RLS probe shipped structurally inert: contextless arm computed under `withSuperadmin` (RLS-bypassing) then hardcoded `return 0`, with `&& contextlessCount===0` a constant-true no-op; the integration test ran as role `postgres` (BYPASSRLS=true) so its isolation assertions proved nothing. Caught at review (1 bounce). Source: `.engineering-os/runs/2026-05-24T09-57-25Z__245326__feat-tenancy-rls-brain-native__rishabhporwal/14-retro.md:26` + lesson #1.
- **Child-2 (`feat-money-minor-units-parity`)** — the ROUND_HALF_UP re-derivation (`re_derive`) called the same function used to compute `legacy_mu`, making the reconciliation branch structurally dead (a tautology). Source: `.engineering-os/runs/2026-05-24T12-54-15Z__ebb1d2__feat-money-minor-units-parity__rishabhporwal/14-retro.md:15`. Child-2's Stage-6 review explicitly noted "single occurrence below ≥3 threshold; watch for 3rd."
- **Child-3 (`feat-connector-framework-cutover`, this run)** — round-1 BOUNCE: `_check_pii_manifest` in `ingest.py` checked `is_pii AND get_spec is None` (logically impossible with any real manifest) and was never wired to Maya's `check_pii_fields`; the test used `_PiiManifestWithNullSpec`, a double manufacturing the impossible condition. Separately, the Shopify HMAC test built the expected signature with the same broken `hexdigest()` the implementation used — tautological self-verification. Source: `09b-security-rereview.md` (C1), `10b-qa-rereview.md` (F-1, F-2), `08b-bounce-fix-report-vikram.md` §C1/H3.

- **Child-4 (`feat-metric-engine-olap-split`, Stage-1 synthesis 2026-05-25) — 4th occurrence, caught PRE-EMPTIVELY at intake.** Both Stage-1 personas independently surfaced the same root-cause class *before any code was written*: (a) OLAP realist Concern 1 (CRITICAL) — the ratio-parity harness has **zero ClickHouse round-trip fixtures**, so the entire ratio-parity guarantee is structurally inert (all positive-integer fixtures stay GREEN because Float64-truncation and integer-FLOOR coincide; the divergence only fires on zero-denominator inputs no fixture covers); (b) OLAP realist Concern 4 (HIGH) — the single-writer grep gate is blind to Prisma camelCase model writes (`prisma.workspaceDailyMetrics.upsert`) — a defective-grep variant of the Child-3 `grep -v` lesson; (c) OLAP realist Concern 5 (MEDIUM) — the cross-workspace isolation test is vacuously GREEN on a single-workspace fixture (`query(None)==[]` on empty data proves nothing) — the same contextless/inert-gate pattern as Child-1's RLS probe and Child-3's PII gate. Bound for this child as `CF-C4-VERIFY-THE-VERIFIER-1` (real-path test + killed-mutant kill-test per high-stakes gate) by Rohan's Stage-6 VETO authority, pending this proposal's adoption. Source: `.engineering-os/runs/2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal/05-stage1-synthesis.md` §5 + `03-persona-metric-parity-olap-correctness-realist.md` Concerns 1/4/5.

- **Child-4 (`feat-metric-engine-olap-split`, this run) — 5th occurrence, MATERIALIZED IN-CHILD (Stage-4 round-1, not just predicted at intake).** Despite `CF-C4-VERIFY-THE-VERIFIER-1` being bound at Stage-1 specifically to prevent this, the round-1 build shipped a **vacuous registry-parity gate** to review: `check-metrics-parity.sh` step 6 asserted only that the two registry directories *exist* — not that any metric agreed on `id`/`unit`/`clickhouse_sql`. This let 4 Brain-native decision metrics (`true_cm2_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp`) carry **materially different formulas in TS vs Python/DDR** straight past every gate, because their `parity_class: correctness_fixture` (`parity_gap:true`) routing — itself a Stage-1 safety mechanism — moved them away from the only cross-language comparison. Compounding it: a self-consistent unit test (`registry.test.ts:204-216`) tautologically pinned the WRONG TS formulas as "correct," and **round-1 QA gave PASS** on the same defect Security bounced (Tanvi classified the 17-vs-25 metric asymmetry + the `ltv_cac_x100`/`ltv_cac_bp` scale divergence as DEFER, not blocking — a reviewer trusting a vacuous gate's GREEN). Caught by Security (1 bounce); fixed in `08b`/`08c`; round-2 both PASS. At Stage-6 I independently mutated the REAL `definitions.ts` on disk twice (id-rename → RED; re-introduce the original H-1 SQL → RED) to confirm the rebuilt gate is genuinely non-vacuous. **The instrument designed to catch the failure class was the instrument that exhibited it.** Source: `09-security-review.md` (H-1), `10-qa-review.md` (F2 DEFER — the QA miss), `08b`/`08c` bounce-fix reports, `09b`/`10b` round-2 PASS, `11-final-review.md` (independent on-disk mutation), `14-retro.md`.

- **Child-5 (`feat-ai-engine-intelligence`, this run) — 6th occurrence, but the FIRST child where the failure class was BEATEN STRUCTURALLY BEFORE REVIEW.** The Stage-1 synthesis predicted the *specific* Child-5 form of the pattern in advance ("decorator-stub + Iron-Law-as-sentence") and bound all 5 VETO gates (@paradigm decorator, faithfulness validator, Iron-Law executor, graduation middleware, tool-scope dispatch) as REAL code + a named real-path integration test + a killed-mutant + an **inverse-mutant** at Stage-1 by Rohan VETO authority (`synthesis_structural_enforcement_bound_by_veto` in `state/active.json`). At Stage-6 I mutated two of the five gates on disk myself: Gate-1 — no-op'd `assert_llm_tier_at_gateway()` → **5 tests RED** (3 killed-mutant `sql/ml/unset` + 1 inverse + 1 async); Gate-3 — flipped `WriteToolCall` `extra="ignore"`→`"allow"` + added an `amount_mu` field so an injected `magnitude_mu=9999999` sticks → **2 tests RED** (killed-mutant + inverse). Both reverted byte-identical. A vacuous gate stays green under mutation; these did not. **The discipline (predict the vacuous form at intake → bind the inverse-mutant → re-mutate at Stage-6) is what converted the recurrence from "caught at the bounce" (Children 1-4) to "structurally prevented at the build."** NOTE the secondary lesson: the round-1 BOUNCE was on the *supporting* controls (Memory k≥5 as a `LIMIT` not k-anonymity; spotlight `flagged` computed-but-never-consumed; Decision-Log with no correlation quad) — the same vacuous-control class, just not on the 5 named gates. Source: `05-stage1-synthesis.md`, `09-security-review.md` (round-1 BOUNCE), `09b`/`10b` (round-2 PASS), `11-final-review.md` (Rohan's 2 independent on-disk mutations), `14-retro.md`.

- **Child-6 (`feat-frontend-dashboard-morningbrief`, this run) — 7th occurrence; the named gates HELD, but the lineage surfaced a NEW vacuous-test form on a *supporting* control.** The three named integrity gates (G-BIGINT/G-IDEMPOTENT/G-REGISTRY-ONLY) were genuinely non-vacuous: at Stage-6 Rohan mutated each on disk (superjson removed → live HTTP wire contract breaks RED; traceability throw disabled → orphan-field test RED; dedup early-return disabled → double-write replay assertion RED), all reverted byte-identical. BUT two supporting-control tests were found vacuous in exactly the way this rule predicts: (a) the **H1 errorFormatter killed-mutant test asserts against a replica** (`buildFormatterOutput` + a `_config` structural double), so mutating the PRODUCTION `errorFormatter` closure did NOT turn the test RED — Rohan verified this directly; the fix is correct only by direct-read + live success-path UUID, not by the test (Shreya logged it honestly as SEC-C6-L2). (b) the **G-BIGINT gate test uses tRPC `createCaller`, which skips the serializer transformer**, so the test passes even with superjson removed — the real protection only exists on the HTTP wire (verified by the live boot, not the gate test). Both are the same root cause as Child-1's contextless RLS probe and Child-3's tautological HMAC test: a verification instrument that does not exercise the production path it claims to guard. Caught and dispositioned at Stage-6 (non-blocking here because the production code is independently verified correct and the success/log paths carry traceability), but they confirm the rule's sharpened form: **the killed-mutant must invoke the production code path; framework-internal closures (errorFormatter, serializer, middleware) need a real-HTTP/integration fixture, not a replica or a `createCaller` double.** Source: `09b-security-rereview.md` (SEC-C6-L2), `11-final-review.md` (Rohan's on-disk mutations of the 3 gates + the errorFormatter + the live-wire superjson break), `14-retro.md` lessons #2/#3.

≥3 distinct runs, identical root cause → meets the Stage-6 auto-candidate threshold. **Now 7 occurrences across 6 consecutive high-stakes children of this epic.** Child-6 (#7) shows the named-gate discipline now holds reliably (all 3 gates beaten under Stage-6 mutation), while the failure class migrated AGAIN to *un-named supporting* tests (the errorFormatter replica + the `createCaller`-skips-serializer gap) — the same migration pattern Child-5 exhibited, reinforcing that the rule must bind EVERY verification instrument in a change, and that the killed-mutant must invoke the production path (not a replica). **Earlier baseline: 6 occurrences across 5 children.** Child-4 contributed TWO data points: (#4) the *pre-emptive* Stage-1 catch by both personas, and (#5) the *materialized* in-child round-1 recurrence where the bound `CF-C4-VERIFY-THE-VERIFIER-1` was insufficient to prevent a vacuous gate shipping to review. Child-5 (#6) is the decisive *positive* control: when the inverse-mutant is bound at Stage-1 AND re-mutated at Stage-6, the named gates ship genuinely non-vacuous — but the failure simply migrated to the *un-bound supporting controls* (Memory/spotlight/traceability), proving the discipline must apply to EVERY security control in a change, not only the named VETO gates. This sharpens the rule (see Rule statement). A per-child binding CF is NOT enough on its own — the failure recurs even when the team knows to look for it — but a per-child binding CF + an inverse-mutant + a Stage-6 re-mutation DID hold for the gates it covered. Only a **standing, mechanically-enforced rule** (real-path entrypoint + negative control + killed mutant + **inverse-mutant on every security control**, captured at Stage 3 AND re-verified at Stage 5/6) closes it across the whole change. The Child-4 prediction ("likely to recur on Child-5 — an AI surface") materialized exactly as forecast.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Rely on the existing "mutation tests on high-stakes paths" QA guidance (informal) | It is already informal practice and still missed the gate three times; the failures were the test *double*, not the absence of a mutant. The rule must explicitly ban the gate-manufacturing double AND require the real integrated entrypoint + negative control, which the current guidance does not state mechanically. |
| Architect-only rule (plan must name the kill-test) | Necessary but insufficient — the plan named "mutation tests" for Child-1/2/3 and the gate still shipped inert. Enforcement must bite at Stage 3 (builder writes it) and Stage 5 (QA captures the killed-mutant output). |
| Block ALL gates (not just high-stakes) | Over-broad; would burden trivial checks (a getter, a config read) with mutation ceremony. The recurring damage is concentrated in irreversible/security-load-bearing gates — scope the rule there. |

---

## Cost of adoption

| Dimension | Impact |
|---|---|
| **Agent prompt changes needed** | `agents/backend-developer` + `agents/qa-agent` DoD sections (~6-10 lines each); `agents/architect` plan-template gate-listing (~4 lines). |
| **Doc updates needed** | `skills/verification-before-completion/SKILL.md` (codify the "real-path entrypoint + negative control + killed mutant" triad); `docs/feature-tiering.md` cross-ref for high-stakes lane. |
| **Schema / template changes** | `templates/architecture-plan.md` add a "high-stakes gate → kill-test + real-path test" row; `templates/qa-review.md` add a captured-mutant-output field. |
| **Throughput impact** | Slightly slower per high-stakes gate (~one extra test + one mutant capture); net FASTER across the epic by avoiding the bounce round that has hit 3/3 high-stakes children so far. |
| **Token cost impact** | Negligible (<2% over baseline) — a few extra test functions + captured output; far cheaper than a bounce-fix round. |

---

## Cost of NOT adopting

If rejected: the same false-GREEN class is likely to recur on Child-4 (metric registry / numeric materialization — a numeric-parity gate, exactly the Child-2 shape) and Child-5 (AI surface). The next occurrence may not be caught at review — the danger of an inert gate is precisely that it looks green. A missed RLS/PII/money gate that ships is a production isolation or compliance incident, not a test-quality nit.

---

## Decision

| Field | Value |
|---|---|
| **decided_at** | *(filled by /adopt-rule or /reject-rule)* |
| **decided_by** | rishabh *(Founder; agents cannot decide their own rules)* |
| **decision** | *(adopted / rejected / deferred)* |
| **rationale** | |
| **durable_rule_path** | |
