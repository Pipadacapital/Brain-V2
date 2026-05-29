# 11 — Final Review (Stage 6, Rohan / CTO Advisor — VETO) — feat-credential-custody-aws-sm

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Actor** | cto-advisor (Rohan) |
| **Stage** | 6 (final review + delegated Founder gate) |
| **Lane** | high-stakes |
| **Timestamp** | 2026-05-29T16:00:00Z (run) / reviewed 2026-05-29 |
| **Verdict** | **PASS → APPROVE (delegated Founder gate signed on Founder's behalf)** |
| **Delegation basis** | `feedback_founder_delegates_to_cto_advisor` — Founder standing delegation: Rohan signs every Founder gate. |

---

## 0. Scope of this review (delegated-gate guardrails)

This build ships **code + IaC (CDK) + mocked-boto3 tests ONLY**. The Founder delegation covers signing the Stage-6/7 gate; it does **NOT** authorize: a `git commit` (Founder free-text "commit it" still required), real AWS provisioning, `cdk deploy`, or live token rotation. Those remain HELD for the Stage-8 console ceremony. I verified the hard-rule deviation scan (step 9) is clean — there are NO dependency violations, NO Single-Primitive violation, NO compliance gap, NO paradigm escalation, NO un-codified gate-skip — so the delegated auto-approve is in-bounds.

---

## 1. Drift check (requirement → plan → code)

Re-read `01-requirement.md` against the staged code. **No drift.**

- Requirement asks for: real boto3 `get/put/seal`, activation-gated factory, ap-south-1 + KMS CMK residency, least-priv IAM in CDK, moto tests, ZERO real AWS, only the `CF-C7` "real seal()/get()" leg satisfied, everything live HELD. Every one of those is present and bounded exactly as scoped.
- No new public surface (no proto/tRPC/MCP/REST) — matches plan §4.
- No DB migration — matches plan §5.
- The TS `core-service` is untouched (no parallel AWS backing) — `CF-CC-OWNER-1` honored.

## 2. Over-engineering audit (mandatory)

| Check | Finding |
|-------|---------|
| Files staged not in the architect's plan? | **NONE.** Staged set == plan §17 exactly: `held_custody.py`, `custody_factory.py` (NEW), `aws_secrets_manager_custody.py` + `custody.py` (MODIFIED), 2 test files, `pyproject.toml` + `uv.lock`, the HMAC follow-up stub, and `infra/cdk/` (10 files). No "while we're in there" files. |
| Observability/metrics/tests beyond plan? | **NONE.** One ids-only structured log line per op (mandated by NEVERLOG); zero new metrics/dashboards/alarms (plan §9 explicitly says none). Test matrix is proportionate to a high-stakes security path (moto matrix + 3 gate mutations + validation matrix), not padded. |
| Deps beyond plan? | **NONE beyond the 3 justified.** `boto3>=1.38.0` (runtime — required for ANY real AWS backing; the stub deliberately deferred it), `moto[secretsmanager]>=5.1.0` (test-only — the only way to exercise the real boto3 path with zero AWS), `aws-cdk-lib`/`constructs` (the IaC; no CDK app existed). Each justified in plan §17b. |
| New abstractions "for future use" (Single-Primitive)? | **NONE.** The factory MIRRORS the existing TS `custody-factory.ts` — it is not a new abstraction. The rejected Option-B (`supabase_column_custody.py`) stays a stub (no speculative dead code). No bulk-erasure API built (erasure path is documented + composable from `seal()`). No TS AWS backing built. |
| Plan length proportionate? | **YES.** Prescriptive band is correct for a high-stakes, security-critical, false-GREEN-trap, Shreya-VETO surface. The depth is load-bearing (it is exactly what caught the lazy-client / fail-closed / never-log risks pre-build). |
| 30+ line WHAT comments? | **NO.** Comments explain WHY (the `ForceDeleteWithoutRecovery` "DO NOT add this" rationale; the lazy-import CF references; the never-log re-raise reasoning). Appropriate for a security-critical file where the WHY is the safety property. |

**Over-engineering audit: PASS.**

## 3. Paradigm / cost audit

- `@paradigm: sql` on all 5 Python secrets files (grep-confirmed); CDK is TS IaC. **ZERO** `@paradigm ml/small_llm/frontier_llm` anywhere → AC-14 PASS.
- Deterministic AWS-API I/O + JSON + input validation + IaC. No inference, no ranking, no NL generation, no gateway routing.
- **Cost: ₹0/mo recurring this build** (CI runs against moto; zero real AWS calls). HELD live cost for Founder awareness (not incurred until Stage-8 provisioning): AWS Secrets Manager ~$0.40/secret/mo + ~$0.05/10k API calls + 1 KMS CMK ~$1/mo — order ₹100s/mo at small connector counts, %-of-GMV pricing unaffected. No cost-model threat.

## 4. Multi-tenancy layer verification

AWS-SM is not a Postgres/Kafka store, so the canonical 4 layers map by store type (plan §8, accepted by persona-2 C2 + Shreya):
- **JWT** — N/A at this layer; caller is workspace-scoped upstream at `ingest.py:418` (allow-list check BEFORE `custody.get`). Unchanged.
- **Service-side** — `_validate_id` rejects None/empty/whitespace/`/`/`..`/`*` so a crafted `workspace_id` cannot escape `brain/{ws}/{vendor}/credential` or widen the IAM match. This is the isolation primitive for the secret store. Verified on disk (`aws_secrets_manager_custody.py:102-152`). **PASS.**
- **DB RLS** — N/A (not Postgres). IAM resource scope `secret:brain/*` is the single shared ingestion-runtime identity (legitimate — one runtime syncs all workspaces); the path + input validation stands between workspace A and B.
- **Kafka envelope** — N/A (no Kafka surface).

## 5. Observability verification

Plan §9 commits to exactly one ids-only structured log line per `get/put/seal` and zero new metrics/dashboards/alarms. Verified on disk: every `logger.{debug,info,warning,error}` call carries only `(workspace_id, vendor, secret_name, op, outcome, error_code)` — my own grep found **NO** `content`/`SecretString`/`token`/`secret_string` in any logger call. Observability is complete and proportionate. **PASS.**

## 6. Code spot-check (5 files)

| File | Finding |
|------|---------|
| `custody_factory.py` | Fail-closed match: `None/''/local`→Held, `aws-secrets-manager`→AWS, `_`→Held. boto3 NOT imported at module top; AWS class imported only inside the opt-in branch. Mirrors `custody-factory.ts`. Clean. |
| `aws_secrets_manager_custody.py` | `__init__` sets `_boto3_client=None` (no client); `_client()` lazy + region assert + refuse-to-start; `_validate_id` blocks traversal; `get` maps `ResourceNotFoundException`→`KeyError`; `seal` `RecoveryWindowInDays=7`, force-delete absent (comments only); ids-only re-raises with `from None`. Clean. |
| `held_custody.py` | Fail-closed default; DPDP erasure path documented (seal-across-vendors + 7-day bounded retention tail) — AC-10. Clean. |
| `custody.py` | HMAC follow-up pointer note present; LOW-2 path corrected in the working tree (see §8). |
| `infra/cdk/lib/credential-custody-stack.ts` | IAM = exact 6 SM actions + Tag, 2 KMS actions, `secret:brain/*` resource (path prefix, NOT a `*` wildcard), CMK ARN-scoped, region pin + constructor residency guard. No bare `*`, no `secretsmanager:*`/`kms:*`. Clean. |

## 7. Verify-the-verifier — MY OWN re-mutation (durable-rule sub-rule 7; this slice's BOUNCE was the rule's 11th occurrence, caught in the gate's OWN test)

I re-ran the load-bearing gates against the live tree, on disk, captured output, and reverted clean. Baseline: `TestGateMutations` 3/3 GREEN.

| # | Mutation (on disk) | Gate test | Result | Revert |
|---|--------------------|-----------|--------|--------|
| A | `custody_factory.py` `case None \| "" \| "local":` → return `AwsSecretsManagerCustody()` | `test_2_fail_closed_default_no_aws_call` | **RED** — assertion (i): `Got AwsSecretsManagerCustody, expected HeldProductionCustody … MUTATION: case None … → this FAILS` | `git diff --stat` == 0 (CLEAN) |
| B | `custody_factory.py` `case _:` → return `AwsSecretsManagerCustody()` | `test_2_fail_closed_default_no_aws_call` | **RED** — assertion (ii): `Got AwsSecretsManagerCustody … MUTATION: case _: … → this FAILS` | `git diff --stat` == 0 (CLEAN) |
| C | `aws_secrets_manager_custody.py` `_client()` residency assert removed | `test_3_wrong_region_kill` | **RED** — `Failed: DID NOT RAISE AwsRegionMismatchError` | `git diff --stat` == 0 (CLEAN) |

**This independently replicates Tanvi's RE-VERIFY result.** The BOUNCE-1 fix is REAL on disk: the strengthened `test_2` now drives BOTH fail-closed branches under a single boto3 spy (branch (i) via `select_custody()`→`effective=None`; branch (ii) via `select_custody(backing="some-unknown-backing")`→`case _:`). The vacuous-gate finding is genuinely closed — the gate test now fails RED under a mutation of EITHER held branch, which is exactly what it claims to verify. Full suite on the reverted tree: **226 passed, 14 skipped.**

I can replicate every PASS Tanvi reported. No Stage-5 quality issue. This one was runnable here (moto, no real AWS) so there is NO deferral — unlike the RLS slice, the verify-the-verifier is fully discharged at Stage 6.

## 8. Working-tree vs index note (load-bearing for the commit)

`git status` shows `MM`/`AM` on two files — the **working tree carries the fixes; the index (staged) carries the pre-fix versions.** The Founder commit MUST capture the WORKING-TREE versions:
- `test_aws_secrets_manager_custody.py` — working tree has the BOUNCE-1 fix (strengthened `test_2`, +42/-23 vs index). This is the version my re-mutation and Tanvi's RE-VERIFY validated.
- `custody.py` — working tree has the LOW-2 fix applied (`requirements/` → `requirements-draft/` pointer corrected). LOW-2 is therefore **resolved on disk**, just not re-staged.

The commit command in §11 / `pending-founder-commit.md` re-stages these explicit paths so the committed tree == the reviewed tree. This is a staging-hygiene note, not a defect.

## 9. Per-AC final verdict (14 rows)

| AC / CF | Verdict | Note |
|---------|---------|------|
| AC-1 CF-CC-OWNER-1 | PASS | Real backing only in Python; TS untouched. |
| AC-2 CF-CC-GATE-1 | PASS | Fail-closed both branches; my re-mutation A+B RED. |
| AC-3 CF-CC-LAZY-1 | PASS | `_client()` lazy; import-time zero-call gate non-vacuous. |
| AC-4 CF-CC-NOREAL-AWS-1 | PASS | moto matrix; 3 gate mutations non-vacuous (my re-run + Tanvi). ZERO real AWS. |
| AC-5 CF-CC-IAM-LEASTPRIV-1 | PASS | Exact action sets, `brain/*` scope, CMK-scoped KMS; my grep + 22 CDK assertions. |
| AC-6 CF-CC-SEAL-RECOVERY-1 | PASS | `RecoveryWindowInDays=7`; force-delete comments-only (my grep). |
| AC-7 CF-CC-RESIDENCY-1 | PASS | region pin + refuse-to-start + CDK guard; my re-mutation C RED. |
| AC-8 CF-CC-WS-ISOLATION-1 | PASS | `_validate_id` blocks traversal/wildcard. |
| AC-9 CF-CC-NEVERLOG-1 | PASS | ids-only sinks (my grep clean). botocore-DEBUG-off → HELD Stage-8 precondition (below). |
| AC-10 CF-CC-ERASURE-PATH-1 | PASS | seal-across-vendors + 7-day tail documented; no bulk API. |
| AC-11 CF-CC-SHOPIFY-HMAC-1 | PASS | Follow-up filed; pointer note; LOW-2 path fix applied in working tree. NOT folded in. |
| AC-12 CF-CC-C7-LEG-1 | PASS (HELD legs intact) | Only real seal()/get() leg satisfied; vendor-200 + parity + DELETE PoNR remain HELD. No HELD leg executed or claimed-done. |
| AC-13 CF-CC-NO-LIVE-1 | PASS | Zero real AWS; CDK synth/test only; not deployed; not committed. |
| AC-14 paradigm | PASS | `sql` only; no ml/small_llm/frontier_llm. |

## 10. What stays HELD for the Stage-8 console ceremony (enumerated)

1. **Real AWS provisioning** — Secrets Manager secrets + the **customer-managed KMS CMK** + the **IAM role creation** / policy attachment in a real ap-south-1 account (`cdk deploy`, Founder/Jatin-at-console).
2. **Live connector-token rotation** into Secrets Manager (real `put` against real AWS, real cost).
3. **`CF-C7-CUSTODY-PROOF-1` remaining legs:** a Brain call via the PRODUCTION custody path returning vendor 200, AND parity GREEN — both still HELD (this build satisfies only the real-`seal()`/`get()` non-NotImplementedError leg).
4. **The legacy-plaintext DELETE point-of-no-return** — gated on ALL `CF-C7` legs, signed per-connector, **Shiprocket LAST** (no replay).
5. **botocore-DEBUG-off precondition** (Shreya's flagged Stage-8 precondition): the ceremony runbook MUST confirm botocore/urllib3 loggers are NOT at DEBUG when the live backing is activated, so the boto3 wire-trace cannot emit request bodies. Our application logger is clean (NEVERLOG verified); this is a deployment logging-config gate, not a code defect.
6. **Festival-freeze discipline** for any live rotation (no Diwali/Republic-Day/EOSS window) — process note for the ceremony.

## 11. Carry-forward LOW

- **LOW-1 (tech debt, carried forward):** `uv sync`/`uv run` (with sync) fails on a hatchling wheel-build heuristic (missing `[tool.hatch.build.targets.wheel] packages` entry for `ingestion_service`). Tests run clean with `--no-sync`. Pre-existing packaging-config gap surfaced by the new dep add, NOT introduced by this change's logic. Non-blocking; log for Maya to fix the build target. **Does not block approval.**
- **LOW-2 (doc accuracy):** RESOLVED on disk — `custody.py` pointer corrected to `requirements-draft/` in the working tree. The commit must capture the working-tree version (see §8).

## 12. Hard-rule deviation scan (step 9)

Dependency violation: NONE. Single-Primitive violation: NONE. Compliance gap (DPDP residency / never-log / erasure): NONE (all satisfied). Paradigm escalation beyond plan: NONE. Gate-skip without codified exception: NONE. **The delegated auto-approve is in-bounds — no surface-to-Founder-and-stop condition triggered.**

---

## Gate G6 result

- [x] Drift check clean
- [x] Over-engineering audit PASS
- [x] Paradigm `sql`, ₹0 recurring, no cost-model threat
- [x] Multi-tenancy (by store type) verified
- [x] Observability complete + proportionate (NEVERLOG grep clean)
- [x] Code spot-check (5 files) clean
- [x] **MY OWN re-mutation: 3 load-bearing gates RED then reverted clean — replicates Tanvi**
- [x] BOUNCE-1 fix real on disk (test_2 drives both branches)
- [x] HELD legs intact (no HELD leg executed/claimed)
- [x] Hard-rule deviation scan clean
- [x] No real AWS / no cdk deploy / no commit

**VERDICT: PASS → APPROVE (delegated Founder gate). Advance to Stage 8 readiness; everything live remains HELD behind the named ceremony gates. Founder action: free-text "commit it" to commit the reviewed working tree.**
