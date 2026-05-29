# 09 — Security Review (Stage 4) — chore-ts-oauth-app-secret-custody

**Reviewer:** Shreya (security-reviewer, VETO) · **Stage:** 4 · **2026-05-29**
**Mode:** PARALLEL REVIEW (Shreya ∥ Tanvi) · **Lane:** high-stakes · **Paradigm:** sql
**Verdict:** **PASS** — 0 CRITICAL, 0 HIGH. Advance to Stage 5 (Tanvi).

---

## Change-class scope (declared FIRST)

This is a **config/crypto/infra-IO** slice (`sql` paradigm): a boot-time presence assert in TS + a representative, authored-not-deployed CDK ECS task-def `secrets:` mapping. It moves the existing `SHOPIFY_CLIENT_SECRET` onto platform env-injection while keeping core-service AWS-SDK-free.

**ALWAYS-ON checks (run regardless of class):**
- Secrets-grep on the staged diff — run (no real `shpss_` literal anywhere; only the explicit `shpss_FAKE_TEST_VALUE_NOT_REAL` test fixture).
- Supply-chain / new-dependency check — run (zero new deps; `aws-cdk-lib/aws-ecs` is a sub-path of pinned `aws-cdk-lib@2.257.0`; no `@aws-sdk/*` added to core-service).
- Input-validation — N/A (no external input surface; the boot assert reads `process.env` only).
- Money/minor-units/no-float — N/A (no money-derived code in the diff; `provider-config.ts` byte-untouched).
- Heavy vuln scanners (pnpm audit / Snyk / Trivy / OWASP-DC) — not re-run for a zero-new-dependency diff; supply-chain surface is unchanged from the merged baseline. No CRITICAL/HIGH dependency surface introduced.

**Surface-specific gates:**
- **Multi-tenancy (4-layer):** N/A by construction — the secret is an app-level singleton (`brain/_app/…`, deliberately not `brain/{workspace_id}/`); no RLS / query-gateway / Kafka-envelope / JWT surface in the diff. Layer integrity preserved by *not touching* tenanted code.
- **Outbound channel / DLT / NCPR / 9pm window / WhatsApp / AI-voice / recording consent:** N/A — no outbound action fires in this diff.
- **OAuth connector encryption / webhook signature:** N/A here — `exchangeShopify`/`validateShopifyHmac` are byte-untouched (verified `git diff == 0`); this slice only changes *where the env var is sourced*, not the OAuth/HMAC logic.
- **MCP tool / agent-emitted action:** N/A — no agent/LLM/MCP surface.
- **PII-in-logs:** the one new log path (`console.error(FATAL: ${shopifyFatal})`) carries a var-NAME-only message; reviewed below (CF-TS-NEVERLOG-1).

**India-compliance section (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** the only in-scope compliance dimension is **DPDP data-residency** — enforced (ap-south-1 pin + residency guard, see CF-TS-RESIDENCY-1). All telecom/WhatsApp/consent/recording dimensions: **N/A — out of scope (no outbound/PII-processing surface)**, per the scope declaration above.

---

## Per-CF verdict (8-CF acceptance contract, §17b)

| CF | Sev | Verdict | Evidence |
|---|---|---|---|
| **CF-TS-NO-AWS-CLIENT-1** (=CF-CC-OWNER-1) | HIGH | **PASS** | `grep -rE "@aws-sdk\|aws-sdk" apps/core-service/src apps/core-service/package.json` → only matches are inside `no-aws-sdk-boundary.test.ts` (comments + runtime-concatenated assert fragments `'aws'+'-sdk'`), zero production-source import. `package.json` deps = `@brain/lib-clickhouse-ts`, `@brain/lib-logger`, `pg` only; no `@aws-sdk/*`/`aws-sdk` key. Boundary test re-run: 2 files / 17 tests pass; the grep-gate is real (scans the live `src` tree via Node fs, excludes `__tests__`, `expect(files.length).toBeGreaterThan(0)` sanity). |
| **CF-TS-NEVERLOG-1** | HIGH | **PASS** | `boot-assert.ts:34-47` — presence/non-empty trim check; the value is never read into the message, returned, or logged. Returns either a var-NAME-bearing fatal string or `null`. boot-assert.ts has **zero** `console`/`logger` calls. Gateway log path `server.ts:361` logs `${shopifyFatal}` (the assert return), never the value. Synth template: no `shpss_` literal anywhere (`grep` clean); `SHOPIFY_CLIENT_SECRET` appears only as the `Secrets[].Name` key + an `Fn::ImportValue` ARN reference, never as a plaintext value. Negative tests assert `not.toContain('shpss_')` + `not.toMatch(/shpss_[A-Za-z0-9_]+/)` on the unset path. |
| **CF-TS-FAILFAST-1** | HIGH | **PASS** | `server.ts:358-362` — `assertShopifyOAuthSecretsPresent()` called inside `main()` **before** `const server = await buildServer(cfg)` and `server.listen`, immediately after `assertBootableAuthConfig`. `process.exit(1)` on non-null fatal. Confirmed the wiring point precedes any request handling. Unit tests cover unset/empty/whitespace → fatal; present → null. |
| **CF-TS-HMAC-CONST-1** | HIGH | **PASS** | `git diff --cached -- provider-config.ts` == 0 lines AND `git diff` (worktree) == 0 lines — byte-untouched. `validateShopifyHmac`/`exchangeShopify`/`requireEnv` unchanged; `timingSafeEqual` constant-time compare preserved. No second verifier introduced. Full core-service suite (incl. `provider-config.test.ts`) 262 passed. |
| **CF-HMAC-TS-OWNER-INJECT-1** | HIGH | **PASS** | `cdk synth` → container `Secrets: [{ Name: SHOPIFY_CLIENT_SECRET, ValueFrom: { Fn::ImportValue: brain-app-shopify-hmac-secret-arn } }]`. Platform env-injection at the task boundary; TS reads `process.env` unchanged. No SM-client import in core-service. |
| **CF-TS-RESIDENCY-1** | HIGH | **PASS** | Stack `env.region` pinned `ap-south-1` (`bin/app.ts`); constructor residency guard `core-service-task-def-stack.ts:76-82` throws on non-ap-south-1 (test #6 verifies throw on `us-east-1`). Synth template: zero `us-east-1`/`us-west-2`/`eu-west-1`/`eu-central-1` strings. IAM least-priv: every statement `Resource` scoped to the imported secret ARN or CMK ARN — **zero `"*"` wildcard**. The auto-added `DescribeSecret` (from `ecs.Secret.fromSecretsManager`) is scoped to the same secret ARN; no widening. |
| **CF-TS-SAME-KEY-1** | MED | **PASS** | Synth: `AWS::SecretsManager::Secret` resource count in this stack = **0** (test #4 asserts). `Fn::importValue("brain-app-shopify-hmac-secret-arn")` references the existing `appShopifyHmacSecret` owned by `CredentialCustodyStack` — one value, no duplicate secret path. |
| **CF-TS-INJECT-SYNTH-1** | HIGH | **PASS** | `Template.fromStack` assertions (zero real AWS calls); `cdk synth CoreServiceTaskDefStack` succeeds; `AWS::ECS::TaskDefinition` count = 1. CDK suite 49/49 pass. No `cdk deploy` attempted. |

---

## Traceability check

No endpoint / Kafka consumer / frontend request / agent-or-LLM invocation is introduced by this diff. The single new runtime code path is a synchronous **boot-time** assert that runs before request handling and carries no request context (no correlation ID applies pre-listen). The fatal-boot log mirrors the existing `assertBootableAuthConfig` fatal line. **No missing-traceability finding.** PASS.

---

## Findings

- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 0
- **LOW (non-blocking, tech-debt note — not a bounce):**
  - **L1** — `server.ts:350,360` use `// eslint-disable-next-line no-console` + `console.error` for the two fatal-boot lines. This mirrors the *existing* gateway boot-fail pattern (the prior `assertBootableAuthConfig` block at `:349-351`), so it is consistent, not a regression. Carried as a note: when the gateway adopts a structured boot logger, fold both fatal lines into it. Does not block.

No finding rises to must-fix-now under `docs/finding-severity-rubric.md` (conservative tie-break applied: L1 is a pre-existing, consistent pattern with no security delta).

---

## Verification commands run (read-only)

- `git diff --cached --stat / --name-only` — staged set = 5 files (TS). CDK files (`core-service-task-def-stack.ts`, its test, `bin/app.ts`) are present in the worktree but **not staged**; reviewed from the worktree as authored. *(Staging note carried to handoff — see below.)*
- `grep -rE "@aws-sdk|aws-sdk" apps/core-service/src apps/core-service/package.json` → only the boundary-test self-references; production source clean.
- `pnpm vitest run boot-assert.test.ts no-aws-sdk-boundary.test.ts` → 2 files / 17 tests PASS.
- `pnpm vitest run` (full core-service) → 262 passed | 30 skipped; `provider-config.test.ts` green (HMAC regression intact).
- `npm test` (infra/cdk) → 49 passed (both suites).
- `npx cdk synth CoreServiceTaskDefStack` → success; inspected template: secrets mapping via `Fn::ImportValue`, IAM ARN-scoped (no `*`), 0 `AWS::SecretsManager::Secret`, 1 `AWS::ECS::TaskDefinition`, no foreign-region string, no `shpss_` literal, no plaintext `Environment` secret.
- `git diff --cached/-- provider-config.ts` == 0; `git diff --stat -- "legacy project/"` == 0; staged-diff grep for real `shpss_` literal → NONE.

---

## Gate (G4) result

- [x] Zero CRITICAL · [x] Zero HIGH · [x] Zero compliance violations (DPDP residency PASS; others N/A out of scope)
- [x] Zero missing-traceability findings · [x] Mutation endpoints — N/A (no endpoint) · [x] MCP tools — N/A
- [x] Connector OAuth/webhook — untouched (provider-config byte-identical) · [x] PII not in logs (var-name-only fatal) · [x] Vuln scans clean on CRITICAL/HIGH (zero new dep surface)

**G4: PASS.**

---

## Handoff

**SECURITY: PASS.** Parallel-review mode — returning verdict to the orchestrator; NOT advancing the stage. Orchestrator reconciles with Tanvi (Stage 5).

**Note carried to orchestrator + Tanvi (not a security finding):** the CDK files are authored in the worktree but were not yet `git add`-ed at review time (TS 5 files staged; CDK 3 files untracked/modified). Reviewed as-authored — security verdict stands. The staging set must be completed before any Founder commit so the CDK construct + synth test ship together with the TS boot assert.
