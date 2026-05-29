# Retro — `feat-tenancy-rls-live-cutover`

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only.
> Feeds the lessons-learned registry at `.engineering-os/lessons-learned.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (Child-1 follow-on of `feat-tenancy-rls-brain-native`) |
| **Shipped at** | 2026-05-29 (Stage-6 PASS, behind Stage-8 HOLDs — not yet flipped live) |
| **Author** | cto-advisor (Rohan, on Founder's behalf under delegation) |

---

## What worked (concrete patterns to replicate)

- **The verify-the-verifier durable rule did its job at Stage 1, not Stage 6.** Persona 2 (`live-rollout-strangler-realist`) caught O2 — the vacuous-GREEN hazard on STEP 5 (a psql double of the bypass role would false-GREEN) — and the synthesis converted it into CF-CUT-VERIFY-THE-VERIFIER-1 with a *named kill-test pair* before a line was built. By Stage 3 the kill-tests were already shaped; by Stage 6 there was nothing vacuous to bounce. This is the rule working as a shift-left, not a Stage-6 catch. (`05-stage1-synthesis.md` §2 O2.)
- **Honest deferral beat fabricated GREEN, end to end.** No agent claimed a capture it didn't run. `synthetic-only-attestation.txt` explicitly says "STEP 0.5 CANNOT be rehearsed against local brain_dev." Every deferred capture carries the exact runnable command + expected outcome. Tanvi classified 11 honest-deferred / 1 real / 0 vacuous, and I reproduced that on my own grep. This is the right posture when the test environment genuinely doesn't exist yet.
- **Path C with four named controls (narrow scope + audit + tripwire + deadline) made an otherwise-indefensible standing bypass lawful for a bounded interval.** The §7 addendum (`06b-…`) ties the lawful basis directly to those four controls (C.5: "defensible ONLY because of C.1-C.4"). Replicable pattern for any transitional dispensation.
- **SEC-MED-1 → QA-LOW-1 chain shows the review layers compounding.** Shreya caught the autocommit/`SET LOCAL` GUC-reset defect in the live heredocs; Tanvi caught the SAME defect class surviving in the R4 *comment* block (a copy-paste hazard for an emergency operator). Both fixed and independently re-verified by me. The second catch is exactly what a distinct QA pass is for.

---

## What didn't work (concrete patterns to avoid)

- **The entire verification leg is un-rehearsable in the build environment.** No ap-south-1 staging clone, no live legacy HTTP path, no `psql` — so 11 of 12 captures are deferred and my Stage-6 re-mutation cannot run. This is honest, but it means the durable rule's Stage-6 re-mutation step (sub-rule 7) structurally cannot be satisfied at Stage 6 for any live-cutover slice; it can only be bound forward to the ceremony. We should stop pretending Stage 6 is the re-mutation gate for live-prod ceremonies — for this class it is a *binding* gate, not an *execution* gate.
- **`feat-connector-data-ingestion` sits at stage 7 and Path B has no date.** The exit deadline (`granted_until`) is "Path-B-completion-date" as a placeholder, not a real date. A bounded dispensation with an unbounded deadline is weakly bounded. The Founder must set a real date or the §7 defensibility decays over time.

---

## What surprised us

- **A "code review" stage with almost no executable code.** This slice's product is a 551-line shell runbook + 2 small DDL files + 2 audit scripts; the real artifact is the *ceremony discipline*, not logic. The Single-Primitive sweep and over-engineering audit mattered more than any code smell. Stage 6 for ceremony-slices is mostly a contract-and-gating audit, not a code audit.
- **The durable rule hit its 10th occurrence here and the honest answer was "I cannot re-mutate."** The rule's whole point is to prevent vacuous gates — and the most rule-faithful action at Stage 6 was to *refuse* to produce a re-mutation capture rather than fake one. The rule protected itself: a fabricated `stage6-remutate/` capture would have been the exact failure mode it exists to stop.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | For live-prod cutover slices, the durable-rule sub-rule-7 Stage-6 re-mutation is a BINDING (not executable) gate — bind it as a hard pre-flip precondition captured to `stage6-remutate/`, never fabricate it against a non-staging-clone env. | `migration`, `agent-discipline`, `pipeline-mechanics` | This run's re-mutation decision; `11-final-review.md` "re-mutation deferral decision"; durable rule 10th occurrence. |
| 2 | A transitional bypass is lawful under DPDP §7 ONLY when scope-narrowed + audited (2 channels) + tripwired + hard-deadlined; the deadline must be a real date, not a placeholder, or defensibility decays. | `india-compliance`, `migration` | `06b-…` §3 Act C (C.1-C.5); Path-B has no date yet. |
| 3 | A defect-class found in live code (SEC-MED-1) should be grepped for in comment/reference blocks too — operators copy-paste emergency-rollback comments verbatim (QA-LOW-1). | `code`, `security`, `process` | SEC-MED-1 + QA-LOW-1 are the same autocommit/`SET LOCAL` defect, live vs comment. |

---

## Action items for next child

- [ ] Next live-cutover intake: pre-classify the durable-rule Stage-6 re-mutation as BINDING-not-EXECUTABLE up front, and put the `stage6-remutate/` capture in the Stage-8 ceremony checklist — don't wait until Stage 6 to discover the env can't run it.
- [ ] Before the Stage-8 flip, get a REAL Path-B completion date from the Founder and write it into `granted_until` + the runbook header (replace the placeholder).
- [ ] When provisioning the ap-south-1 staging clone, run ALL 11 deferred captures + my 3 re-mutations in one rehearsal pass so the verification leg is retired atomically.

---

## Cost + paradigm reality vs plan

| Metric | Planned | Actual | Variance |
|---|---|---|---|
| Monthly $ cost | ~₹0/mo | ~₹0/mo | 0% |
| LLM tokens / day | 0 | 0 | 0% |
| Wall-clock duration | n/a (ceremony slice) | Stage 1→6 over 2026-05-26→29 | — |
| Paradigm declared | `sql` | `sql` (zero LLM/ML confirmed at Stage 6) | MATCH |
| Persona count | 2 (high-stakes) | 2 (compliance + strangler, both load-bearing) | MATCH |

**Calibration note for next time:** the 2-persona high-stakes call was exactly right — both personas surfaced load-bearing CRITICAL/HIGH concerns (O2 verify-the-verifier, C1 path-lawfulness) that shaped the entire binding contract. Zero persona waste.

---

## Durable-rule 10th-occurrence note

`2026-05-26__verify-the-verifier-mutation-on-gate` reached its **10th recorded occurrence** with this slice. It performed as designed at the front of the pipeline (Stage-1 persona caught the vacuous-GREEN hazard; synthesis bound the kill-test pair). At the back of the pipeline its Stage-6 re-mutation sub-rule could not execute (no live staging clone) and the rule-faithful action was to refuse fabrication and bind it forward. No new candidate-rule proposal is generated from this run: the recurring pattern ("Stage-6 re-mutation un-executable for live-cutover slices") is captured as Lesson #1 above and as an action item; it is not yet a ≥3-distinct-run pattern that would warrant codifying a NEW rule beyond the existing one (the existing rule already covers it — this is a refinement of how to APPLY it, filed as a lesson, not a new rule).
