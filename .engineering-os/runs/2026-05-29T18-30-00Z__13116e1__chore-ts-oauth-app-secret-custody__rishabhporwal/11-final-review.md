# 11 — Final Review (Stage 6) — chore-ts-oauth-app-secret-custody

**Reviewer:** Rohan (CTO Advisor, VETO) · **Stage:** 6 (final review + delegated Founder gate) · **2026-05-29**
**Lane:** high-stakes · **Paradigm:** `sql` · **Verdict:** **APPROVE-WITH-CAVEATS** (delegated Founder sign-off)
**Caveats:** all are HELD-for-Stage-8 (live cutover) + one staging-completeness ask on the commit manifest — none is a code defect, none is a bounce.

---

## 1. Drift check (requirement → plan → build)

Re-read `01-requirement.md`. The ask: close the env-injected interim for the **TS core-service Shopify OAuth consumers** of `SHOPIFY_CLIENT_SECRET` WITHOUT growing a Node AWS SM client (preserve CF-CC-OWNER-1). The build delivers exactly that — platform env-injection via a CDK ECS `secrets:` mapping + a boot-time presence assert + the AWS-SDK hard gate. **Zero drift.** No feature added beyond the 8-CF contract; the live task-role wiring + rotated value are explicitly HELD (matches the requirement's own Out-of-scope section).

## 2. Paradigm / cost audit

`@paradigm sql` on both new source files (`boot-assert.ts:1`, `core-service-task-def-stack.ts:40`). Zero LLM, zero ML, zero inference runtime, zero new managed resource. **₹0/month, 0 tokens/day.** Matches my Stage-1 first-pass and Aryan's Stage-2 sign-off. No paradigm escalation. PASS.

## 3. Multi-tenancy (4 layers)

N/A by construction — the secret is an app-level singleton (`brain/_app/…`, deliberately not `brain/{workspace_id}/`). No RLS / query-gateway / Kafka-envelope / JWT surface in the diff; `provider-config.ts` byte-untouched. Layer integrity preserved by not touching tenanted code. Documented, accepted.

## 4. Observability

Verified implemented and proportionate: the only new signal is the fatal-boot log line at `server.ts:359-362`, reusing the existing `assertBootableAuthConfig` fatal-boot pattern (`server.ts:349-351`). Var-name only, never the value. No new metrics/dashboards/traces (correct — over-build guard).

## 5. Code spot-check (5 files)

| File | Finding |
|---|---|
| `apps/core-service/src/application/connectors/boot-assert.ts` | Pure, env-injected param, presence/non-empty trim, returns var-name-bearing string or `null`. Zero `console`/`logger`/value-echo. Matches plan §5.2 exactly. |
| `apps/core-service/src/__tests__/no-aws-sdk-boundary.test.ts` | Real fs-grep of `src` (excludes `__tests__`), runtime-concatenated banned strings to avoid self-match, `length>0` sanity, pkg.json AWS-key check + never-log negatives. Non-vacuous (proven §6 below). |
| `apps/api-gateway/src/interfaces/server.ts:358-363` | Assert called inside `main()` BEFORE `buildServer` (`:365`) → fail-fast at boot, not first-OAuth. `process.exit(1)` on non-null. Correct. |
| `infra/cdk/lib/core-service-task-def-stack.ts` | Cross-stack `Fn.importValue` (no new secret), least-priv IAM scoped to the imported secret ARN + CMK ARN only (no `*`), residency guard throws off ap-south-1, empty plaintext `environment`, placeholder public image, `AUTHORED NOT DEPLOYED` banner. |
| `apps/core-service/src/application/connectors/index.ts` | Clean barrel re-export of the assert. |

## 6. Verify-the-verifier — re-mutation (LOAD-BEARING, re-run by Rohan)

The load-bearing gate is **CF-TS-NO-AWS-CLIENT-1** (an AWS import in core-service re-opens CF-CC-OWNER-1 = Founder escalation). I re-mutated it myself:

| Step | Action | Result |
|---|---|---|
| pre | `git hash-object boot-assert.ts` | `ddf80bcf1c6dd7d221b6eb8643311a0603b4387b` |
| 1 | Injected `import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager"` into `boot-assert.ts` | appended |
| 2 | `vitest run no-aws-sdk-boundary.test.ts` | **RED** — `AWS SDK imports found in: …/boot-assert.ts: expected [ Array(1) ] to have a length of +0 but got 1` (named the exact file) |
| 3 | `git checkout --` the file | restored |
| 4 | re-hash | `ddf80bcf1c6dd7d221b6eb8643311a0603b4387b` — **byte-identical** |
| 5 | `vitest run no-aws-sdk-boundary.test.ts` | **GREEN** — 6/6 |

**Non-vacuity independently confirmed.** Working tree byte-identical after (hash match). It is not a tautology — it caught the exact injected file.

## 7. Other gates re-run (≥3 required; I ran 5)

| Gate | Rohan's captured result | Matches Tanvi? |
|---|---|---|
| `provider-config.ts` diff (CF-TS-HMAC-CONST-1) | staged == 0 lines, worktree == 0 lines | ✓ |
| Full core-service suite | `262 passed | 30 skipped` | ✓ |
| boot-assert.test.ts (fail-fast non-tautology) | 11/11; whitespace/empty/present branches exercised | ✓ |
| CDK suite (infra/cdk) | `49 passed, 49 total` | ✓ |
| `cdk synth CoreServiceTaskDefStack` (CF-TS-INJECT-SYNTH-1 / RESIDENCY / SAME-KEY / NEVERLOG) | secrets via `Fn::ImportValue: brain-app-shopify-hmac-secret-arn`; 0 foreign-region; 0 `shpss_`; **0** new `AWS::SecretsManager::Secret`; **1** `AWS::ECS::TaskDefinition`; every IAM `Resource` = imported secret/CMK ARN, **no `"*"` wildcard** (the auto-added `DescribeSecret` is scoped to the same secret ARN — no widening) | ✓ |

I can replicate every Stage-5 PASS with my own captured output. No Stage-5 quality issue.

## 8. Over-engineering audit (mandatory)

- Files staged vs plan §17: exactly the 8 planned (5 TS + 3 CDK). No extra files. PASS.
- Observability/metrics/tests beyond plan: none — only the planned fatal-boot line + the planned tests. PASS.
- Deps beyond plan: none. `aws-cdk-lib/aws-ecs` is a sub-path of pinned `aws-cdk-lib@2.257.0`; **no `@aws-sdk/*` in core-service** (forbidden, and proven absent). PASS.
- New abstractions "for future use": none — boot-assert mirrors an existing pattern; CDK task-def is the minimal representative scaffold with explicit HELD-Stage-8 scope notes (no ALB/autoscaling/ECR/networking). PASS.
- Plan length proportionate to a high-stakes 8-CF security slice: yes. PASS.
- 30+ line WHAT-comments: no — comments are WHY/CF-citation, load-bearing. PASS.

**No over-engineering finding.**

## 9. Hard-rule deviation check (gates auto-approve)

| Hard rule | Status |
|---|---|
| Dependency violation | NONE — BUILD does not block on the held rotated value (env-injection keeps TS byte-identical); only the live cutover does. |
| Single-Primitive Rule | CLEAN — one mirrored micro-pattern, all else reuse-untouched. |
| Compliance gap (DPDP/PDPL/DLT/NCPR/calling-hours) | NONE — DPDP residency enforced (ap-south-1 pin + guard); all telecom/consent dimensions N/A (no outbound/PII surface). |
| Paradigm escalation beyond plan | NONE — `sql`, zero LLM/ML. |
| Gate-skip without codified exception | NONE — Stage 4 + 5 both ran full parallel reviews; real-network smoke is the architect-ruled synth substitute (no deployed container), documented not skipped. |

**No hard-rule deviation.** Founder standing delegation applies cleanly — I may sign.

## 10. 8-CF final verdict

| CF | Sev | Rohan verdict |
|---|---|---|
| CF-HMAC-TS-OWNER-INJECT-1 | HIGH | MET — synth `Secrets[].ValueFrom = Fn::ImportValue brain-app-shopify-hmac-secret-arn`; TS reads `process.env`. |
| CF-TS-NO-AWS-CLIENT-1 (=CF-CC-OWNER-1) | HIGH | MET — re-mutation RED→GREEN; pkg.json zero AWS. CF-CC-OWNER-1 preserved. |
| CF-TS-FAILFAST-1 | HIGH | MET — assert at `server.ts:358` precedes `buildServer:365`; `process.exit(1)`. |
| CF-TS-HMAC-CONST-1 | HIGH | MET — `provider-config.ts` diff == 0 (re-confirmed by me). |
| CF-TS-NEVERLOG-1 | HIGH | MET — var-name-only message; synth has no `shpss_` literal, no plaintext `Environment` secret. |
| CF-TS-RESIDENCY-1 | HIGH | MET — ap-south-1 pin + guard; zero foreign-region in synth; IAM ARN-scoped. |
| CF-TS-SAME-KEY-1 | MED | MET — 0 new `AWS::SecretsManager::Secret`; cross-stack import of existing secret. |
| CF-TS-INJECT-SYNTH-1 | HIGH | MET — `Template.fromStack` assertions; synth succeeds; 1 TaskDefinition; no `cdk deploy`. |

All 8 MET in this build.

## 11. HELD-for-Stage-8 (carried, not cleared by this slice)

1. The **full core-service Fargate service** — networking, ALB, autoscaling, ECR image, task-role attach (this slice ships only the representative task-def carrying the one `secrets:` mapping).
2. **Live task-role wiring** + a deployed core-service container/service.
3. The **rotated `SHOPIFY_CLIENT_SECRET`** value provisioned into SM `brain/_app/shopify/hmac_secret` (grandparent ceremony — **never printed**; refer only as `shpss_<REDACTED>`).
4. Live `secrets:` injection smoke (substituted at BUILD by the synth-level gate per the architect ruling).
5. No `cdk deploy`. No git commit without Founder "commit it".

## 12. Parent-closure note

This closes the parent's named TS follow-on (`chore-app-hmac-secret-custody` → `named_follow_on: chore-ts-oauth-app-secret-custody`) at **build level**. The interim env-injection is now backed by an authored CDK `secrets:` mapping + a fail-fast boot assert + the AWS-SDK boundary gate. **CF-CC-OWNER-1 preserved** (no Node AWS client introduced). Final parent-interim closure completes at the Stage-8 live cutover.

## 13. Carry-forward LOW (non-blocking)

- **L1** — `server.ts:350,360` use `// eslint-disable-next-line no-console` + `console.error` for the two fatal-boot lines. Consistent with the pre-existing `assertBootableAuthConfig` pattern (not a regression). Fold both into a structured boot logger when the gateway adopts one. Deferred.

## 14. Staging-completeness finding (act before commit — not a bounce)

Both Shreya and Tanvi flagged it and I re-confirmed via `git status`: the **3 CDK files are NOT staged** at review time —
`infra/cdk/bin/app.ts` (modified, unstaged), `infra/cdk/lib/core-service-task-def-stack.ts` (untracked), `infra/cdk/test/core-service-task-def-stack.test.ts` (untracked).
The build is correct and verified as-authored; this is a commit-manifest completeness item. I have augmented `pending-founder-commit.md` so the Founder's commit command stages **all 8 files** (5 TS + 3 CDK) together. The TS boot assert and the CDK `secrets:` mapping MUST ship in the same commit — they are two halves of one CF contract.

---

## Decision

**APPROVE-WITH-CAVEATS** — signed on the Founder's behalf under standing delegation (no hard-rule deviation; delegation applies). All 8 CFs MET; re-mutation non-vacuity confirmed; ₹0/mo; HELD-for-Stage-8 explicit; no-commit + held-live-wiring honored. The only pre-commit action is to stage the 3 CDK files per the augmented manifest.

**Not a bounce.** Routes to Stage 7 as a delegated auto-approve → Stage 8 readiness (HELD). Founder still personally authorizes the actual `git commit` ("commit it") and the Stage-8 live cutover.
