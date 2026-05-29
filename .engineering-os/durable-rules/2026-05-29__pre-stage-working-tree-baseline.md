# Durable Rule — pre-stage-working-tree-baseline

> Promoted to durable rule on 2026-05-29 by Founder. Source proposal:
> `.engineering-os/rule-proposals/2026-05-25__pre-stage-working-tree-baseline.md`.
> Evidence at adoption: **≥3 distinct runs** of the "uncommitted working-tree state contaminates
> a stage's verification or commit set" root-cause family (Child-1 + Child-2 divergent gate-copy;
> Child-6 stray staged files; `feat-store-order-fact-layer` pre-existing `login-form.tsx` breakage).
> The Stage-6 auto-candidate threshold (≥3 distinct runs) was crossed.

| Field | Value |
|---|---|
| **rule_id** | `pre-stage-working-tree-baseline` |
| **adopted_at** | 2026-05-29T18:00:00Z |
| **adopted_by** | rishabhporwal (Founder) — agents cannot decide their own rules |
| **target_scope** | `stage-3-developer` + `stage-5-qa` + `stage-6-cto-final-review` (enforced) |
| **status** | adopted |
| **adoption_decision_artifact** | `.engineering-os/decision-log/2026/05/2026-05-29.jsonl` (entry type: `rule-adoption`) |

---

## Rule statement (BINDING)

> At the START of a build/QA run, the responsible agent MUST capture a baseline of the
> working tree's test + parity state for the surfaces it will touch, and record it in the
> stage artifact. At Stage 5 (QA) and Stage 6 (final review), any FAILING test or stray/
> divergent file MUST be classified as either (a) caused by THIS requirement, or (b)
> pre-existing working-tree contamination NOT attributable to this requirement (with
> `git diff --name-only HEAD` evidence proving the requirement did not touch the file).
> A pre-existing failure is recorded as out-of-scope test-debt and surfaced to the Founder;
> it does NOT block the requirement, but it ALSO does not get silently absorbed into the
> requirement's green count. The commit doc (`pending-founder-commit.md`) MUST list explicit
> product-code paths for THIS requirement only (never `git add -A`) and explicitly EXCLUDE
> stray/divergent/pre-existing files.

---

## Why this is a rule (not a per-run lesson)

Brain runs an autonomous multi-child epic where work accumulates UNCOMMITTED across many runs
(Founder's "no commits until I say 'commit it'" + "build the epic, I review at the end"). Each
new requirement therefore starts on a tree already carrying unrelated uncommitted changes. Three
recurring failure modes (≥3 runs): a divergent gate/fixture copy contaminating verification;
stray staged files polluting the commit set; a pre-existing source change breaking unrelated
tests. Without a captured baseline + git-attribution discipline, a reviewer either wrongly blocks
a clean requirement or silently absorbs a real regression behind a green count. Both are
review-integrity failures; the absorbed regression is the worse one under end-of-run review.

## Enforcement

- **Stage 3 (developer):** record a working-tree baseline (failing tests + stray files) in the
  developer report before building.
- **Stage 5 (QA):** classify every failing test / stray file as slice-caused vs pre-existing via
  `git diff --name-only HEAD`; pre-existing → out-of-scope test-debt bucket, surfaced, not absorbed.
- **Stage 6 (final review):** the commit doc lists explicit product paths for THIS requirement
  only; stray/divergent/pre-existing files explicitly excluded; never `git add -A`.

## Cost

<1% tokens (a `git diff --name-only HEAD` + one classification line per failing test). Prompt
deltas to developer.md / qa-agent.md / cto-advisor.md final-review; a "pre-existing vs slice-caused"
bucket in the qa-report + final-review templates.
