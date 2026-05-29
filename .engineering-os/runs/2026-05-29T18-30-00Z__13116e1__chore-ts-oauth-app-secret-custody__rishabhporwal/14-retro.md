# 14 — Retro (Stage 6) — chore-ts-oauth-app-secret-custody

**Author:** Rohan (CTO Advisor) · **2026-05-29** · Lane: high-stakes · Paradigm: sql

## What worked

- **Persona shifted the risk axis, didn't re-litigate the ruling.** The `secret-injection-boundary-realist:haiku` accepted the injection ruling and moved the question from "which mechanism" to "how do we prove it with no running container" → produced CF-TS-INJECT-SYNTH-1 (synth-level gate, not `cdk deploy`). That single reframing is what made the whole slice buildable + verifiable today.
- **Boundary-as-a-test beat boundary-as-a-policy.** CF-TS-NO-AWS-CLIENT-1 was bound to an executable fs-grep gate, not a review note. I re-mutated it (RED→GREEN, byte-identical after) and it caught the exact file. A policy line would not have.
- **Byte-identical proof on the untouched HMAC path.** `provider-config.ts` diff == 0 (staged + worktree) is a stronger CF-TS-HMAC-CONST-1 proof than "we didn't mean to change it." Cheap, deterministic, re-runnable by every downstream stage.
- **Authored-not-deployed CDK with synth assertions** gave a real verification surface for infra that has no live target yet — `Template.fromStack`, zero AWS calls, residency + SAME-KEY + NEVERLOG all asserted mechanically.
- Three reviewers (Shreya, Tanvi, me) independently re-ran the load-bearing gates and converged. No reviewer took another's PASS on faith.

## What didn't

- **The CDK files were never staged.** Vikram staged Track V (5 TS files); the Track-J CDK files (`bin/app.ts`, the new stack, its test) sat untracked/modified through Stage 4 and Stage 5. Both Shreya and Tanvi caught it and flagged it as a note, but it persisted to Stage 6 because no stage OWNS "stage the build before review." The build was correct; the commit manifest would have shipped half the contract (TS gate without the CDK mapping it gates) if a reviewer hadn't flagged it.

## What surprised us

- A naive `grep -c 'Resource:"\*"'` on the synth template returned 3 — alarming for a least-priv claim — but all three were the multi-line YAML form where `Resource:` precedes an indented `Fn::ImportValue` ARN. There was zero actual wildcard. **Lesson: assert IAM resource-scoping on the parsed structure (as the test does via `Match`), never on a flat-text grep of synth YAML** — the flat grep produces false alarms on multi-line resources.
- `ecs.Secret.fromSecretsManager` auto-adds a `secretsmanager:DescribeSecret` statement (alongside the developer's `GetSecretValue`). It's scoped to the same ARN, so no widening — but it's a CDK side-effect a reviewer must know to expect, or it reads like an unexplained third statement.

## Recurring-pattern check (auto-candidate-rule detection)

Root cause of the one real friction this run: **"builder staged only their own track; the cross-track / infra files were left unstaged, surfacing as a reviewer flag rather than a build-completeness gate."**

Semantic-recall + decision-log grep for this cause across prior runs: this is the **first** time it appears as a distinct, flagged staging-completeness gap in a multi-track (Track V + Track J, two builders) slice. The legacy-migration epic had a different shape (staged-uncommitted by Founder design, not an oversight). **No ≥3-run pattern yet** → this stays a lesson (captured here + carried to the commit manifest), NOT a rule proposal. If a second multi-builder slice ships with an unstaged cross-track file, that's occurrence #2 — watch for it; at #3 propose a "builder stages all in-plan files for their track before declaring Stage-3 complete; orchestrator verifies the staged set == plan §17 file list" rule.

## Carry-forward

- L1 console.error fatal-boot style (fold into structured boot logger) — deferred, non-blocking.
- HELD-Stage-8: full Fargate service + live task-role + rotated SM value + live smoke.
