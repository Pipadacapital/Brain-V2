# 14 — Retro — feat-credential-custody-aws-sm

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Author** | cto-advisor (Rohan), Stage 6 |
| **Lane** | high-stakes |
| **Outcome** | PASS / APPROVE (delegated gate); 1 mid-pipeline BOUNCE (Stage 5 → Maya), resolved + re-verified |
| **Timestamp** | 2026-05-29 |

## What worked

- **The verify-the-verifier discipline did exactly its job — at the meta level.** The whole point of the 3 gate-mutation tests is to catch a vacuous gate. This time the vacuous test WAS one of the gate-mutation tests itself: `test_2` exercised `case None` while its `# MUTATION:` comment targeted `case _:` — the paths never intersected, so it passed GREEN under its own named mutation. Tanvi's independent re-mutation (not just re-running the test, but applying the mutation on disk) caught it. This is the system working as designed: re-running a test proves nothing; re-mutating proves the test is non-vacuous.
- **Prescriptive plan depth was load-bearing, not padding.** Aryan's §10 spelled out the exact kill-test shape for all 3 mutations. That precision is what made the vacuous-gate finding crisp and the fix mechanical (correct the mutation target / drive both branches under one spy).
- **Fail-closed posture held under adversarial mutation.** Mutating EITHER held branch to return the AWS class now goes RED. The single-spy-both-branches structure is the right fix shape.
- **NEVERLOG was honest about its boundary.** The team scoped the never-log assertions to our application logger and explicitly named botocore's DEBUG wire-trace as a Stage-8 deployment precondition rather than pretending it's covered. Honest scoping > false completeness.
- **Reversibility is genuine.** Env flag defaults to held; CDK authored-not-deployed; `seal()` 7-day window; nothing live. A rollback is a no-op at runtime.

## What didn't work / friction

- **A gate-mutation test shipped vacuous to Stage 5.** Maya's original `test_2` and its `# MUTATION:` annotation pointed at different `case` arms. Shreya's Stage-4 re-mutation targeted the SAME `case _:` arm the comment named — and her compensating factory-selection tests DID catch it — so Stage 4 passed it as PASS without noticing the *named gate test* was the vacuous one. The defect survived to Tanvi. Shift-left (pass-1 self-review by Maya) and Stage-4 should both have caught "the test and its mutation comment exercise different branches."
- **Staging hygiene drift.** The BOUNCE-1 fix and the LOW-2 doc fix live in the working tree on top of a stale index (`MM`/`AM`). Without the §8 note, a Founder `git commit` of the *staged* tree would commit the pre-fix test + stale doc pointer. Caught and corrected in the commit instructions, but it's avoidable friction — the fixer should re-`git add` the corrected paths.

## What surprised us

- **The bounce was meta: the verifier verifying the verifier caught a flaw in the verifier.** The mutation-test framework's own test was the thing that was untrustworthy. This is the strongest possible argument for the "re-mutate, don't re-run" rule — and it's why I re-mutated all 3 gates myself at Stage 6 rather than trusting Tanvi's RE-VERIFY on paper.

## Durable-rule note — 11th occurrence of the verify-the-verifier rule (2026-05-26 sub-rule 7)

This run is the **11th recorded occurrence** of the durable rule "re-running a test proves nothing; re-mutate to prove the gate is non-vacuous; bounce if any expected-RED mutation stays GREEN." What makes this occurrence distinctive — and worth flagging — is that **the vacuous test was itself a gate-mutation test**: the very control designed to catch vacuous gates was, this time, the vacuous gate. The root cause class is precise and recurring:

> **A mutation-test's assertion path and its declared `# MUTATION:` target must provably intersect.** When the test exercises one code path (`case None`) and the mutation alters a different path (`case _:`), the test passes GREEN under its own named mutation and proves nothing. The fix is to drive *every* branch the mutation could touch under the same negative-control spy.

This is already covered by the existing durable rule in spirit, so I am NOT proposing a new rule — but I am recording the sharpened sub-pattern ("gate tests must intersect their own mutation target; drive all fail-closed branches under one spy") for the auto-candidate detection step. See §below.

## Auto-candidate rule detection (v0.8.0)

Root cause in one line: *"gate-mutation test exercises a different code branch than its declared mutation target → vacuous gate passes GREEN."*

Action: this is a **specialization of the existing adopted durable rule (2026-05-26 verify-the-verifier)**, not a new root cause. The general rule already mandates re-mutation and bouncing on a GREEN-when-should-be-RED gate. Codifying a *second* rule for the sub-pattern would be rule-sprawl. **No new rule proposal filed.** The lesson (intersect-the-mutation-target / drive-all-branches-under-one-spy) is captured here in the retro and folds into the existing rule's guidance. If this specific sub-pattern (mutation/test-path mismatch) recurs as a *distinct* root cause in ≥3 future runs, revisit for a sharpened sub-rule then.

## Action items

- **LOW-1 (Maya, tech debt):** fix the hatchling `pyproject.toml` build target (`[tool.hatch.build.targets.wheel] packages`) so `uv sync` works without `--no-sync`. Track under WS-1.
- **Staging hygiene (Founder commit):** commit the working-tree versions of `test_aws_secrets_manager_custody.py` + `custody.py` (re-`git add` per the commit command). Captured in `pending-founder-commit.md`.
- **Stage-8 ceremony runbook (HELD):** add the botocore/urllib3-DEBUG-off precondition + festival-freeze discipline + the per-connector vendor-200/parity legs + Shiprocket-last DELETE ordering.
