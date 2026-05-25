# Retro — feat-ai-engine-intelligence (Child 5)

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only.

| Field | Value |
|-------|-------|
| **req_id** | `feat-ai-engine-intelligence` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (epic; child-5-ai-engine) |
| **Shipped at** | 2026-05-25T15:30:00Z (PASS; HELD-AT-SERVE; not committed) |
| **Author** | cto-advisor (Rohan, on Founder's behalf under delegation) |

---

## What worked (concrete patterns to replicate)

- **Binding the 5 VETO gates as REAL-code-with-killed+inverse-mutant at Stage-1, by Rohan VETO authority, finally beat the verify-the-verifier failure class structurally.** Children 1–4 each shipped a vacuous gate to review; Child-5's Stage-1 synthesis named the *specific* Child-5 form in advance ("decorator-stub + Iron-Law-as-sentence") and required each of the 5 gates carry a real-path integration test + a killed-mutant + an inverse-mutant. At Stage-6 I mutated two gates on disk myself (Gate-1 no-op assert → 5 RED; Gate-3 schema `extra=allow`+magnitude field → 2 RED) and both were caught. This is the pattern: *predict the gate's vacuous form at intake, bind the inverse-mutant, re-mutate at Stage-6.*
- **Splitting 5a (prove the primitives on ONE read-only non-chat agent) from 5b (stress-test on chat/Morning-Brief) was the right call** — both Stage-1 personas independently converged that chat + the Morning-Brief fan-out are the two highest-risk surfaces, so they must be the surfaces that *stress* the proven gate stack, never the ones that prove it. The pnl read-only agent meant the 5a live attack surface is narration-pollution only (the executor is built + mutation-tested but never reached at runtime).
- **De-duping cost-C4 (2.4× N-agent narration trap) and injection-INJ3 (prior-LLM-output re-enters as trusted text) into ONE constraint (CF-C5-MORNING-BRIEF-PATTERN-B-1)** — two personas on orthogonal lanes (cost vs safety) named the same structural seam; recognizing it as one constraint kept the architecture from carrying two overlapping guards.
- **The Memory-anonymity fix resolved an architectural contradiction, not just a code bug** — round-1 the cross-brand query was both broken (RLS returns only the caller's own row) AND leaky-if-relaxed. The fix (dedicated non-RLS `ai.cross_brand_pattern` cohort table, CHECK k≥5, no workspace_id) is the correct shape, not a patch. Replicate: when a security finding is "broken AND leaky," the answer is usually a schema/architecture reshape.

---

## What didn't work (concrete patterns to avoid)

- **Three of the round-1 findings (Memory anonymity CRITICAL, spotlight escape HIGH, traceability HIGH) were "looks-done but vacuous" — the same class the gates were built to catch, but on the *supporting* controls.** The team correctly hardened the 5 headline gates but shipped a spotlight that detected `</data>` and never consumed `flagged`, and a Decision-Log with no correlation quad. Lesson: the verify-the-verifier discipline must extend to *every* security control in the change, not only the named VETO gates. A "detect-but-don't-act" control (flagged computed, never raised) is the spotlight analogue of a vacuous gate.
- **The commit manifest is incomplete at PASS time** — load-bearing Track-M source (signals, context_builders, evals, prompts, telemetry, package inits, 3 test files) is untracked, and a duplicate divergent migration (`src/infrastructure/db/migrations/`) exists alongside the canonical one. The tests pass only because the files are on disk; a commit of the staged set alone would not import. Recurring Track-M git-add gap (also seen prior children).

---

## What surprised us

- **The faithfulness gate is a COST defect, not just a safety control** (cost persona Concern 3). A false-reject (model writes "₹1.2L", signal is `120000`, naive compare fails) forces a retry = a second LLM call. The fix (canonical-integer normalize BOTH sides before set-compare + a locale-format PASS case in the eval harness + retry-rate telemetry) turned a safety gate into a cost-correct one. Safety and cost were the same bug here.
- **The per-call cap check was vacuous-by-construction** (C5-SEC-008) — `resolve_magnitude` returned exactly `per_call_max_mu`, so `magnitude > per_call_max_mu` could never fire. The bounce-fix added `requested_fraction_bp` so a >100% fraction is rejectable and the check is load-bearing. A cap that can never be exceeded is not a cap — caught only because Shreya read the arithmetic.
- **C5-SEC-009 emerged from the bounce-fix itself** — adding `ai.cross_brand_pattern` to up.sql but not down.sql means a rollback orphans the table / fails the schema drop. A fix can introduce a new (smaller) hygiene defect; the re-review caught it.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | Verify-the-verifier discipline (real-path test + killed-mutant + inverse-mutant) must cover EVERY security control in a change, not only the named VETO gates — a detect-but-don't-act control (flagged computed, never raised) is a vacuous gate in disguise. | security, agent-discipline, process | round-1 C5-SEC-002 (spotlight flagged unused) + C5-SEC-001 (k≥5 as LIMIT not k-anonymity); `09-security-review.md` |
| 2 | A faithfulness/parity gate that compares un-normalized representations is BOTH a safety hole and a cost multiplier (false-reject → retry → extra LLM call); normalize both sides to canonical integer before compare and emit retry-rate telemetry. | cost-routing, numeric-parity, code | cost persona C3 → CF-C5-FAITHFULNESS-COST-1; `extraction.py`/`validator.py`; `10b-qa-rereview.md` |
| 3 | A server-side cap that returns exactly the max can never be exceeded — the check is vacuous; make the resolved value capable of exceeding the limit (fraction/granularity) so the gate is load-bearing. | code, security | C5-SEC-008; `executor.resolve_magnitude` `requested_fraction_bp` fix |
| 4 | When a security finding is "broken AND leaky" (RLS returns own-row only, but relaxing it leaks identity), the fix is a schema/architecture reshape (dedicated anonymized aggregate table), not a query patch. | security, india-compliance, architecture | C5-SEC-001 → `ai.cross_brand_pattern` CHECK(k≥5), no workspace_id; `08b-bounce-fix-report-maya.md` |
| 5 | A bounce-fix can introduce a smaller new defect (new table added to up.sql but not down.sql) — re-review must regression-scan migration reversibility, not only the named fix. | migration, process | C5-SEC-009; `09b-security-rereview.md` |
| 6 | Recurring Track-M git-add gap: split-track builds leave load-bearing source untracked + leave duplicate divergent migrations; the commit manifest must be reconciled against the import graph + dedup migrations at Stage-6. | pipeline-mechanics, process | untracked signals/context_builders/evals/prompts + duplicate `src/infrastructure/db/migrations/`; `pending-founder-commit.md` |

**Applies-to tags used:** `security`, `cost-routing`, `numeric-parity`, `code`, `india-compliance`, `migration`, `process`, `agent-discipline`, `pipeline-mechanics`, `architecture`.

---

## Action items for next child (5b)

- [ ] Extend the verify-the-verifier killed+inverse-mutant requirement to EVERY security control in the change (spotlight, traceability, caps), not only the 5 named gates.
- [ ] Before any 5b agent reaches a write tool: harden Gate-2 faithfulness unit-binding (C5-SEC-004) and validate parsed insights against the typed contract (C5-SEC-006).
- [ ] 5b India-resident tripwire: if the eval-passing FRONTIER model for chat/global/Morning-Brief synthesis has NO India-resident inference option, `/escalate` (DPDP §16 cross-border vs model-quality, Founder-priced).
- [ ] Reconcile the commit manifest against the import graph at Stage-3 (not Stage-6) — stage every Track-M source file + dedup divergent migrations as part of the build, not the review.
- [ ] Morning-Brief 5b: enforce Pattern-B (13 Tier-A signal bundles → ONE Sonnet synthesis); any per-agent Tier-B narration before synthesis = Stage-6 BOUNCE.

---

## Cost + paradigm reality vs plan

| Metric | Planned | Actual | Variance |
|---|---|---|---|
| Monthly $ cost | ~₹440/mo @ Sugandh-Lok (persona projection) | ₹0 in build (mocked) | n/a — no live spend this child |
| LLM tokens / day | ~1,400 in / 500 out per standard-page call | mocked golden-set | n/a |
| Wall-clock duration | 1 intake + 1 plan + parallel build + 1 bounce round | as planned (1 bounce round, both reviewers PASS round-2) | on plan |
| Paradigm declared | MIXED (sql/ml Tier-A + small_llm Tier-B; no frontier) | MIXED exactly (sql everywhere + one small_llm) | MATCH |
| Persona count | 2 (ai-cost-realist:sonnet + prompt-injection-action-injection-realist:sonnet) | 2; both surfaced ≥1 grounded concern (14 total) | MATCH |

**Calibration note for next time:** the 2-persona cost+safety pairing on the highest-trigger-surface child was exactly right — their independent convergence on chat + Morning-Brief as the two danger surfaces drove the 5a/5b split and the de-dupe. For 5b, the same two dimensions intersect with the India-resident frontier-model question — keep the pairing, and add the residency tripwire as a pre-bound `/escalate` predicate rather than a persona.
