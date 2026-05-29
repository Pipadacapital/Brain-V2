# 09 — Security Review (Stage 4, Shreya — VETO) — feat-credential-custody-aws-sm

| Field | Value |
|-------|-------|
| **req_id** | `feat-credential-custody-aws-sm` |
| **Actor** | security-reviewer (Shreya) |
| **Stage** | 4 (VETO gate G4) |
| **Lane** | high-stakes |
| **Timestamp** | 2026-05-29 |
| **Verdict** | **PASS** |

## Change-class scope (declared FIRST)

This change touches **secrets-handling, IAM (IaC), multi-tenancy isolation, PII/DPDP residency** — squarely in the VETO domain. Surface-specific gates IN scope: never-log, activation-gate/fail-closed, lazy client, IAM least-privilege, workspace isolation, seal recovery, residency, DPDP erasure. ALWAYS-ON gates run: input validation, supply-chain (boto3/moto/aws-cdk-lib), secrets-grep-on-code.

Gates marked **N/A** with justification:
- Outbound channels / DLT / NCPR / calling-window / WhatsApp / AI-voice / recording-consent — **N/A: no outbound communication surface** (custody is an internal AWS-API adapter; no SMS/voice/WhatsApp).
- Money-handling / minor-units / no-float — **N/A: no monetary computation** (paradigm `sql`, deterministic AWS I/O + JSON).
- Postgres RLS / Kafka envelope / JWT-at-this-layer — **N/A by store type**: AWS-SM is not Postgres/Kafka; caller is workspace-scoped upstream at `ingest.py:418`. Isolation here is the secret-name path + `_validate_id` + IAM resource scope (per plan §8, accepted by persona-2 C2).
- Real-network AWS smoke — **N/A this build: HELD Stage-8 ceremony** (`CF-CC-NO-LIVE-1`). The moto-backed matrix is the proof-of-real-path.

## Verification run (evidence captured)

- **Python tests:** `uv run --no-sync pytest test_aws_secrets_manager_custody.py test_custody_stubs.py` → **56 passed** (0.46s). (Note: `uv run` with sync triggers a hatchling wheel-build error — a packaging-config issue in `[tool.hatch.build]`, NOT a test failure; tests run clean against the existing env. Flagged LOW below.)
- **CDK assertions:** `npm test` (jest) → **22 passed**.
- **Legacy guard:** `git diff --stat -- "legacy project/"` → **0 changes**. PASS (memory: legacy is reference-only).
- **Deps resolved+pinned:** boto3 1.43.17, moto 5.2.1 (importable; pyproject floor pins `boto3>=1.38.0`, `moto[secretsmanager]>=5.1.0`; uv.lock pins exact).
- **Re-mutation (durable rule 2026-05-26 sub-rule 3 — I re-mutated on disk myself):**
  - **Fail-closed default** (factory `case _:` → return `AwsSecretsManagerCustody()`): `test_unknown_value_returns_held_not_aws` + `test_env_var_unknown_selects_held` → **FAILED** (real negative control). Reverted; tree clean.
  - **Residency assert** (`!= _REQUIRED_REGION` → `... and False`): `test_wrong_region_raises_region_mismatch_error` + `test_3_wrong_region_kill` → **FAILED** (real negative control). Reverted; tree clean.
  - Confirmed `git diff` on both mutated files == 0 after revert; staged versions are the originals.

## Per-CF verdict (13 CFs + paradigm)

| AC / CF | Verdict | Evidence (file:line) |
|---------|---------|----------------------|
| AC-1 CF-CC-OWNER-1 | PASS | Real backing only in `aws_secrets_manager_custody.py`; no TS `core-service` AWS backing in diff. |
| AC-2 CF-CC-GATE-1 | PASS | `custody_factory.py:64-99` — `None/''/local`→Held, `aws-secrets-manager`→AWS, `_`→Held (fail-closed). Re-mutation confirms non-vacuous. |
| AC-3 CF-CC-LAZY-1 | PASS | `__init__` sets `self._boto3_client=None` (`:171-174`); client built in `_client()` (`:186-189`); module-load `assert isinstance` (`:493`) makes no client. Import-time zero-call test `:527`. |
| AC-4 CF-CC-NOREAL-AWS-1 | PASS (Tanvi owns final) | `@mock_aws` matrix `:272-455`; 3 `# MUTATION:` tests `:527,567,610`; zero real AWS. |
| AC-5 CF-CC-IAM-LEASTPRIV-1 | **PASS (my gate)** | `credential-custody-stack.ts:37-44` exact SM action set, `:198` `secret:brain/*` only, `:210` exact CMK ARN; no `"*"`/`sm:*`/`kms:*` (grep clean — only in comments). Test `:131-312`. |
| AC-6 CF-CC-SEAL-RECOVERY-1 | PASS | `seal` uses `RecoveryWindowInDays=7` (`:448`); `ForceDeleteWithoutRecovery` only in comments (`:449-452,53,415`), never in an API call. Test `:307,350`. |
| AC-7 CF-CC-RESIDENCY-1 | PASS | Python `region_name=ap-south-1` (`:189`) + refuse-to-start (`:194-201`); CDK stack guard (`stack.ts:87-92`) + CMK (`:109`) + CMK-encrypted secret (`:144`) + `app.ts:25` region pin. Re-mutation confirms non-vacuous. |
| AC-8 CF-CC-WS-ISOLATION-1 | PASS | `_validate_id` rejects None/empty/whitespace/`/`/`..`/`*` (`:102-152`); `_secret_name` (`:207-218`). Tests `:81-148`, multi-workspace `:435`. |
| AC-9 CF-CC-NEVERLOG-1 | **PASS (my VETO)** | All logger calls carry only `(workspace_id, vendor, secret_name, op, outcome, error_code)` — grep confirms NO `content`/`SecretString`/`token` in any logger call. Error re-raises drop `exc`/`str(exc)` deliberately (`:283-298, 392-406, 474-487`). KeyError/ValueError carry ids only. Negative tests `:377,392,415,503`. See note on botocore below. |
| AC-10 CF-CC-ERASURE-PATH-1 | PASS | `held_custody.py:20-31` documents seal-across-vendors + 7-day bounded retention tail; no bulk API. |
| AC-11 CF-CC-SHOPIFY-HMAC-1 | PASS (w/ LOW note) | Follow-up filed `requirements-draft/chore-app-hmac-secret-custody.md`; pointer note `custody.py:26-31`. Path discrepancy — see LOW-2. |
| AC-12 CF-CC-C7-LEG-1 | PASS (Rohan S6 owns) | Only real `seal()/get()` leg satisfied; vendor-200/parity/DELETE PoNR remain HELD per module docstring `:10-19`. |
| AC-13 CF-CC-NO-LIVE-1 | PASS | Zero real AWS (moto only); CDK synth/test only, not deployed (`stack.ts:4-8`, `app.ts:5-8`). No commit (staged, uncommitted). |
| AC-14 paradigm | PASS | `@paradigm: sql` on every touched file; no ml/small_llm/frontier_llm decorator (grep clean). |

## Stage-4 bounce-condition checks (plan §17b)

- `*` resource / wildcard action / read-only IAM → **NONE** (exact enumerated sets + path-scoped resource + CMK ARN). 
- Force-delete present / recovery != 7 → **NONE**.
- Default/unknown selects AWS, or no factory → **NONE** (fail-closed verified by re-mutation).
- Client in `__init__`/module scope, or import makes AWS call → **NONE** (lazy verified).
- Token/SecretString can reach a sink → **NONE** (NEVERLOG verified by grep + negative tests).
- Crafted id escapes namespace → **NONE** (`_validate_id` + tests).
- Wrong region accepted / default AWS key / CMK not ap-south-1 → **NONE**.

## Findings

**CRITICAL: 0 · HIGH: 0 · Compliance violations: 0 · Missing-traceability: 0**

- **MED: 0**
- **LOW-1 (tech debt):** `uv sync` / `uv run` (with sync) fails on a hatchling wheel-build heuristic (`Unable to determine which files to ship` — no `[tool.hatch.build.targets.wheel] packages` entry for the `ingestion_service` project). Tests run clean with `--no-sync`. This is a pre-existing packaging-config gap surfaced by the new dep add, not introduced by this change's logic. Does not block — log for Maya to fix the `pyproject` build target. Tracked tech debt.
- **LOW-2 (doc accuracy):** `custody.py:30` references the HMAC follow-up at `.engineering-os/requirements/chore-app-hmac-secret-custody.md`, but the file is actually at `.engineering-os/requirements-draft/chore-app-hmac-secret-custody.md`. Stale path pointer; non-blocking. Note for Maya.

### NEVERLOG-1 botocore-scope judgment (explicit, my VETO surface)
The agent scoped the never-log negative assertions to OUR logger (`src.infrastructure.secrets.aws_secrets_manager_custody`), noting botocore's own DEBUG wire-trace can emit request bodies. **Judgment: this is honest and correct, and NOT a leak we own.** Reasoning: (1) our application logger never receives `content`/`SecretString` (grep-confirmed; all sinks carry ids only); (2) botocore DEBUG-level wire logging is a deployment logging-config concern (botocore loggers default to WARNING and are not enabled at DEBUG in our runtime), not a code defect in this module; (3) the residency/lazy gates mean no real botocore call happens until the Founder-gated Stage-8 activation. The Stage-8 ceremony runbook MUST confirm botocore/urllib3 loggers are not at DEBUG when the live backing is activated — I am flagging this as a **HELD Stage-8 ceremony precondition** (not a Stage-4 blocker, since no real AWS call occurs this build). Recorded for Rohan's S6 gate + the ceremony runbook.

## Gate G4 result

- [x] Zero CRITICAL · [x] Zero HIGH · [x] Zero compliance violations · [x] Zero missing-traceability
- [x] Mutation surfaces guarded (gate/lazy/residency) — re-mutated by me, real negative controls
- [x] IAM least-privilege (no `*`, exact action set, CMK-scoped) — my gate
- [x] NEVERLOG (no content/token in any sink) — my VETO surface
- [x] Workspace isolation (`_validate_id`) · [x] Residency ap-south-1 (Python + CDK)
- [x] DPDP erasure path documented · [x] No real AWS / no deploy / no commit
- [x] Vuln/supply-chain: boto3/moto/aws-cdk-lib are reputable pinned deps; no CRITICAL/HIGH

**VERDICT: PASS → advance to Stage 5 (Tanvi, QA).** Tanvi independently re-runs the 3 mutation gates (AC-4 is her owned gate) and the moto matrix.
