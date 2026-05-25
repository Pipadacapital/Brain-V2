# Rule Proposal — pre-stage-working-tree-baseline

> A proposed change to the team's operating rules. Lives at `.engineering-os/rule-proposals/<ISO-ts>__<slug>.md`.
> ADOPTED only when Founder runs `/brain-engineering-os:adopt-rule <proposal-path>`.
> Agents CANNOT self-promote a proposal to a durable rule.

| Field | Value |
|---|---|
| **proposal_id** | `pre-stage-working-tree-baseline` |
| **proposed_by** | `cto-advisor (Rohan)` |
| **proposed_at** | 2026-05-25T13:46:00Z |
| **target_scope** | stage-3-developer + stage-5-qa + stage-6-final-review |
| **status** | proposed |

---

## Proposed text

> At the START of a build/QA run, the responsible agent MUST capture a baseline of the
> working tree's test + parity state for the surfaces it will touch, and record it in the
> stage artifact. At Stage 5 (QA) and Stage 6 (final review), any FAILING test or stray/
> divergent file MUST be classified as either (a) caused by THIS requirement, or (b)
> pre-existing working-tree contamination NOT attributable to this requirement (with
> `git diff --name-only HEAD` evidence proving the requirement did not touch the file).
> A pre-existing failure is recorded as out-of-scope test-debt and surfaced to the Founder;
> it does NOT block the requirement, but it ALSO does not get silently absorbed into the
> requirement's green count. The commit doc (pending-founder-commit.md) MUST list explicit
> product-code paths for THIS requirement only (never `git add -A`) and explicitly EXCLUDE
> stray/divergent/pre-existing files.

---

## Rationale

Brain runs an autonomous multi-child epic where work accumulates UNCOMMITTED across many runs
(per the Founder's "no commits until I say 'commit it'" + "build the whole epic, I review at the
end" directives). This means each new requirement starts on a working tree already carrying
unrelated uncommitted changes from prior children. Three failure modes recur:
1. A divergent COPY of a gate/fixture contaminates verification (Child-1, Child-2).
2. Stray staged files (`.bak`, `package-lock.json`) pollute the commit set (Child-6).
3. A pre-existing uncommitted source modification breaks tests that have nothing to do with
   the current requirement (this slice: `login-form.tsx` `useRouter()` change breaks 6
   login-form tests with "app router not mounted" — `feat-store-order-fact-layer` touched
   ZERO files under `auth/`).
Without a captured baseline + explicit attribution discipline, a reviewer can either (a) wrongly
block a clean requirement for unrelated breakage, or (b) wrongly pass over a real regression by
assuming it's "pre-existing." Both are review-integrity failures.

---

## Evidence

- `feat-store-order-fact-layer` (THIS run) — `10-qa-report.md` finding B0 + `11-final-review.md`:
  6 `login-form.test.tsx` failures (`invariant expected app router to be mounted`) traced via
  `git diff --name-only HEAD` to a pre-existing working-tree change to `login-form.tsx`; the slice
  touched no `auth/` files. Recorded out-of-scope, did not block.
- `feat-money-minor-units-parity` decision-log 2026-05-24T19:05:00Z — Rohan Stage-6:
  `"single-source/divergent-copy-of-gate root cause now in 2 distinct runs (Child-1 RLS, Child-2
  money); below the >=3 threshold; remains a lesson in 14-retro, watch for 3rd occurrence."`
- `feat-frontend-dashboard-morningbrief` state entry — `"Two stray staged files flagged for
  EXCLUSION: definitions.ts.bak3 + apps/web/package-lock.json."`

Root-cause family ("uncommitted working-tree state contaminates a stage's verification or commit
set") now appears in ≥3 distinct runs → crosses the codification threshold.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Require a clean working tree before each run | Violates the Founder's "accumulate uncommitted, review at end" directive; not workable for the autonomous epic. |
| Just keep it as a per-run lesson | It's already recurred ≥3 times; lessons that recur are exactly what should graduate to a rule (the v0.8.0 auto-candidate mechanism). |
| Block any requirement whose run has ANY failing test | Would wrongly block clean requirements for unrelated pre-existing breakage — the opposite integrity failure. |

---

## Cost of adoption

| Dimension | Impact |
|---|---|
| **Agent prompt changes needed** | developer.md + qa-agent.md + cto-advisor.md final-review (≈6–10 lines each: "capture baseline; classify failures by git-attribution") |
| **Doc updates needed** | verification-before-completion skill (add the baseline+attribution step) |
| **Schema / template changes** | qa-report + final-review templates gain a "pre-existing vs slice-caused" finding bucket |
| **Throughput impact** | same (a `git diff --name-only HEAD` + one classification line per failing test) |
| **Token cost impact** | <1% (a couple of git calls + a short classification) |

---

## Cost of NOT adopting

Reviewers keep ad-hoc-classifying working-tree breakage. Eventually one of two integrity failures
lands: a real regression gets waved through as "pre-existing," or a clean requirement gets bounced
for unrelated breakage. In an autonomous epic with a single end-of-run Founder review, an
absorbed regression is the worse outcome — it ships behind a green count that wasn't really green.

---

## Decision

| Field | Value |
|---|---|
| **decided_at** | {{DECIDED_AT}} |
| **decided_by** | rishabh (Founder; agents cannot decide their own rules) |
| **decision** | {{DECISION}} |
| **rationale** | {{DECISION_RATIONALE}} |
| **durable_rule_path** | {{DURABLE_RULE_PATH}} |
