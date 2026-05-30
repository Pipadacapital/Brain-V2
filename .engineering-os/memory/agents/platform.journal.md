# Platform/DevOps Engineer — Journal

> Append-only. See /Users/rishabhporwal/.claude/plugins/cache/brain-engineering-os-marketplace/brain-engineering-os/0.23.0/docs/role-empowerment-model.md for entry shape.

## 2026-05-23T12:48:01Z — system — bootstrap
**Action:** Journal initialized by /eos init on 2026-05-23T12:48:01Z.

## 2026-05-24T00:06:57Z — Jatin (platform-devops) — chore-scaffold-monorepo
**Stage:** 8 (deploy gate)
**Action:** Founder approval received (`/approve chore-scaffold-monorepo`, 12-founder-decision.json). State → approved/stage 8/owner platform-devops. Spawning Stage 8 to assess deploy + monitor for the monorepo scaffold (structure + toolchain, no runtime infra by design).

## 2026-05-24T00:09:30Z — Jatin (platform-devops) — chore-scaffold-monorepo
**Stage:** 8
**Action:** DEPLOY-READINESS-VERIFIED (scaffold — no runtime by design)
**CI:** N/A (no CI pipeline yet — scaffold is the prerequisite)
**Staging:** N/A (scaffold — no ArgoCD Application, no ECR image, no Fargate/EKS)
**Strategy:** N/A-for-scaffold
**Monitor (so far):** N/A — no runtime; acceptance contract is the equivalent guard (fails loud on clean checkout)
**Skills loaded:** operational-readiness, progressive-delivery, verification-before-completion, finishing-a-development-branch
**Dashboards:** N/A (no runtime service)
**Re-verification checks (all PASS):** staged=105, stubs-not-staged=0, pnpm install EXIT 0 (12 projects), check:metrics-parity EXIT 0, docker:build:ingestion dry-run EXIT 0 (file-hash inputs correct), uv sync --all-packages EXIT 0, all 5 Python imports PASS (uv run python), buf generate EXIT 0 (TS+Python stubs on disk), buf lint EXIT 0, buf build EXIT 0, structural assertions PASS (9 apps, 5 DDD×7, no controllers, 5 pins, DECISIONS.md 160 lines)
**Deploy class:** scaffold — no ArgoCD sync, no ECR push, no EAS (skipped by design; consuming services inherit at their own CI wiring requirements)
**48h monitor:** N/A-scaffold; guard = acceptance contract on clean checkout
**Staged for Founder commit:** 105 product files; NO git commit by Jatin per standing rule
**Follow-ups owned:** per-service ECR+ArgoCD+canary (when first service req ships), pin buf plugin digests (S-2), align CI to Node 24 (S-5), replace health.proto placeholder at first real contract
**Deploy report:** 13-deploy-report.md
**Next:** SHIPPED — awaiting Founder commit (product code staged; pending-founder-commit.md has the mechanical command)

## 2026-05-24T13:30:00Z — Jatin (platform-devops) — feat-tenancy-auth-rls-hardening
**Stage:** 8 (rollout — HOLD AT FORCE)
**Action:** STAGE-8-PLAN-COMPLETE — static validation GREEN, corrected bare-write grep run, STEP0-STEP4 turnkey operator plan documented, FORCE explicitly held
**CI:** N/A (no new CI pipeline — legacy monolith; runbook is the deploy artifact)
**Staging:** N/A (legacy Supabase/Fargate — no ArgoCD Application for this slice; deploy_class = db-ddl-migration, app-layer code ships with Founder commit + Heroku/Supabase deploy)
**Strategy:** Incremental DDL rollout — STEP0 (region-assert) → STEP1 (quiesce) → STEP2 (context-code verify) → STEP3 (ENABLE+CREATE, additive) → STEP4 (CF-SEC-1 probe GREEN) → HOLD. STEP5 FORCE gated on Child 3.
**Monitor (so far):** Pre-FORCE state; 48h monitor plan in §6 of report. Key signals: API p95 (no change expected pre-FORCE), cron success rate, RLS probe re-runs at H+2/H+24/H+48.
**Skills loaded:** operational-readiness, progressive-delivery, verification-before-completion, finishing-a-development-branch, data-residency-enforcement, incident-response
**Dashboards:** N/A (no new service; probe output is the observability signal)
**Static validation results:** STEP ordering CORRECT. Migration file separation CORRECT (step-a and step-b independent files). down.sql symmetry COMPLETE (43 tables, all policies dropped). Fail-closed verified (zero IS NULL/COALESCE/USING true in executable SQL). FORCE coverage COMPLETE (no table FORCEd without policy). Runbook STEP5 grep CONFIRMED DEFECTIVE (excludes backfill/discoverChannels per Rohan §4.A).
**Corrected bare-write grep:** Run READ-ONLY across full src/. ~80+ residual bare-write sites enumerated (priority convert-list in §2.3 of report): shopify/sync.ts (7 sites, Groups B), shopify/webhooks.ts (9 sites, Groups A+B+PII), shiprocket backfill/discoverChannels (8 sites), woocommerce-sync.ts, cron.ts:249 recompute (bare prisma to product_daily_aggregates), meta.ts:192 catch-block, all route-handler connection-management writes across ~12 routes. All fail-CLOSED post-FORCE (outage, not leak).
**FORCE status:** HELD. Explicit. Non-negotiable until Child 3 convert-list GREEN + corrected grep ZERO hits + probe GREEN re-run.
**Deploy report:** 11-stage8-rollout-report.md
**Next:** Founder commits + deploys product code (22 files staged). Human operator runs STEP0-STEP4 against prod Supabase using the turnkey plan in §3. 48h monitor. Child 3 converts residual writers → FORCE unlocked.

## 2026-05-24T07:13:35Z — Founder approval received — spike-legacy-migration-architecture
- Founder /approve at 2026-05-24T01:40:00Z. Architecture accepted as BINDING for the 7-child legacy-migration epic; Child 1 greenlit.
- Residency tripwire RESOLVED: legacy Supabase/Postgres confirmed in ap-south-1 (no DPDP s16 escalation).
- Stage 8 = no-op readiness analogue for a no-code spike (runtime_deployed:false). Driving platform-devops now.
- SECURITY: Founder shared live legacy env secrets in chat; NOT persisted to repo; to be provisioned via Secrets Manager in Child 1; rotation advised.

## 2026-05-24T07:14:41Z — Jatin (platform-devops) — spike-legacy-migration-architecture
**Stage:** 8 (no-op readiness analogue)
**Action:** SPIKE-CLOSEOUT (no runtime deployed; architecture accepted as binding; carry-forward ledger captured)
**CI:** N/A (no code; no CI pipeline target)
**Staging:** N/A (no ArgoCD Application, no ECR image, no service)
**Strategy:** N/A-spike-no-op
**Monitor (so far):** N/A — no runtime; 48h_monitor: n/a-no-code-spike
**Skills loaded:** operational-readiness, verification-before-completion, finishing-a-development-branch, data-residency-enforcement
**Dashboards:** N/A (no runtime service)
**Readiness checks (6/6 PASS):**
  - R1 no-prod-code-guardrail: PASS (git status = .engineering-os/** only; zero product code)
  - R2 secret-hygiene: CLEAN (zero credential values; project-ref + pooler-host are region-fact identifiers, not secrets)
  - R3 residency: RESOLVED (ap-south-1 confirmed; CF-RES-1 now confirmation-mode gate-zero for Child 1)
  - R4 architecture binding: CONFIRMED (A1-A6 + 9 persona concerns + 11 carry-forward constraints)
  - R5 carry-forward ledger: CAPTURED in 13-deploy-report.md §5 + state.stage8_deploy_report
  - R6 epic ready: READY to spawn child-1-tenancy-auth-rls-hardening
**Deploy class:** spike-no-op; runtime_deployed: false
**Deploy report:** 13-deploy-report.md
**Epic update:** chore-migrate-legacy-to-brain -> architecture_binding:true, next_child_to_file:child-1-tenancy-auth-rls-hardening
**Spike status:** done (completed_at: 2026-05-24T07:14:41Z)
**Next:** Founder files Child 1 (/requirement to file child-1-tenancy-auth-rls-hardening with carry-forward ledger attached)

## 2026-05-24T11:24:00Z — Jatin (platform-devops) — feat-tenancy-rls-brain-native
**Founder approval received** (12-founder-decision.json, approved by rishabh). Advancing to Stage 8 (deploy-readiness). FORCE flip remains HELD per HOLD-AT-FORCE; this Stage 8 is rollout-readiness + monitor plan, NOT a live RLS cutover. No git commit authorized by approval.

## 2026-05-24T17:30:00Z — Jatin (platform-devops) — feat-tenancy-rls-brain-native
**Stage:** 8
**Action:** READINESS-COMPLETE (deploy-class=db-ddl-migration; HOLD-AT-FORCE; no live DDL applied)
**CI:** PASS (local) — tsc exit 0; 158 unit tests passed / 9 skipped / 0 failed; integration 9/9 (Docker stack, rls_app role); coverage 90.71% stmt / 71.42% branch (all ≥ 70%); bash -n runbook PASS; fail-open grep 0 hits; DDL symmetry ENABLE 43 = FORCE 43 = DROP POLICY 45
**Staging:** N/A — no ArgoCD Application, no ECR image, no Brain runtime; DDL ships via operator-run psql
**Strategy:** HOLD-AT-FORCE — STEP 0-4 (region-assert, quiesce, ENABLE+CREATE, probe) are READY-IN-RUNBOOK; STEP 5 FORCE HELD until Child-3 + Founder/CTOA sign-off
**Monitor (so far):** N/A — no runtime; 48h monitor plan DEFINED (probe-RED alarm, cron ctxless gap, 0-rows outage canary) as ARMED-AT-ROLLOUT predicates in 13-deployment-report.md §4-deferred
**Skills loaded:** devops-aws, progressive-delivery, incident-response, data-residency-enforcement, observability, operational-readiness, finishing-a-development-branch
**Dashboards:** N/A (no runtime; probe verdict + cron 4-tuple logs are the observability signal at rollout)
**FORCE status:** NOT FLIPPED. step-b-force.sql HELD header confirmed intact. No psql against any live URL with irreversible DDL. No git commit by Jatin. No legacy files touched.
**Deploy gate ledger:** 2 READY-IN-RUNBOOK / 1 HELD (FORCE — Founder+CTOA) / 1 HELD cross-child (Child-3 residual-writer conversion) / 7 DEFERRED-TO-ROLLOUT-WINDOW (all with exact predicates)
**Deploy report:** 13-deployment-report.md
**Next:** READINESS-COMPLETE. Awaiting: (1) Founder commits product code; (2) Child-3 residual-writer conversion; (3) Founder+CTOA FORCE ceremony sign-off; (4) live runbook execution by operator.

## 2026-05-29T23:30:00Z — Jatin (platform-devops) — connector-webhook-intake (Stage-8 turnkey prep)
**Stage:** 8 (live-cutover turnkey — offline verification only; no AWS action performed)
**Affected:** connector-webhook-intake (T0/T1/T2/T3 + T-GEN-A + T-GEN-B) + credential-custody + chore-app-hmac-secret-custody + feat-tenancy-rls-live-cutover + feat-credential-custody-aws-sm
**Canary:** N/A — no deployment performed (authored-not-deployed posture; NO valid AWS credentials in environment confirmed)
**Monitor:** N/A — no live deploy; checklist produced for Founder-at-console execution

**CDK synth result:**
- `cdk list`: CredentialCustodyStack, CoreServiceTaskDefStack (2 stacks — exactly as expected)
- `cdk synth`: `Successfully synthesized to .../cdk.out` — ZERO errors, ZERO warnings (74 feature flags advisory only)
- `npm test`: 49/49 PASS, 2 suites (credential-custody-stack.test.ts + core-service-task-def-stack.test.ts), 0 failed, 0 skipped

**Stage-8 execution kit drift findings (vs actual code + stacks):**
1. DRIFT (NEW HOLD — not in original kit P2): `connector_identity_map` DDL (step-a-create.sql) and seed row (`('shopify', 'sugandhlok.myshopify.com', <ws_id>)`) are NEW Stage-8 items not listed in the original kit. Required before P7 (webhook registration).
2. DRIFT (NEW HOLD — not in kit): gRPC server bind (`webhook_server.py`) and gateway route registration (route.webhook.ts is exported-not-registered in server.ts). Both are explicit HOLD-AT-CUTOVER annotations added by Maya/Vikram.
3. DRIFT (NEW HOLD — not in kit): public `POST /webhooks/:vendor` ingress + WAF/TLS. Kit P2 covers custody stack only; the public webhook ingress is a separate ceremony.
4. DRIFT (MED-1 — must fix before deploy): `grpcio>=1.68.0` floor in pyproject.toml. Shreya flagged this as MED-1 (admits DoS-vulnerable pre-1.70 versions). Must raise to `>=1.70.0` before Stage-8 image is built.
5. DRIFT (MED-2 — dead code): `shop_resolver.py` is an orphaned dead file on disk (superseded by `identity_resolver.py` but never deleted). Confirmed present at `apps/ingestion-service/src/interfaces/grpc/shop_resolver.py`. Must delete before commit.
6. MATCH: secret name `brain/_app/shopify/hmac_secret` — matches kit P2 step 4 exactly (IAM resource `brain/*` prefix covers it — CF-CC-IAM-LEASTPRIV-1 confirmed by test assertions).
7. MATCH: region ap-south-1 — both stack constructors enforce residency guard at synth time; tests confirm.
8. MATCH: stack names `CredentialCustodyStack` + `CoreServiceTaskDefStack` — confirmed by `cdk list`.
9. MATCH: kit P5 (Google OAuth) is still valid and unchanged.
10. NEW ITEM (not in kit): `connector_identity_map` RLS asymmetry is intentional (system routing table, no PII, pre-workspace lookup) — documented in migration DDL + architecture plan §11.

**Checklist written:** `.engineering-os/LIVE-CUTOVER-CHECKLIST.md` — 8 phases (P1–P8 + DECOM + monitoring), safe dependency order, exact commands, preconditions, expected outputs, safety gates, reversibility recipe.

**Skills loaded:** devops-aws, operational-readiness, security-baseline, verification-before-completion, finishing-a-development-branch
**Staging smoke:** N/A (no live deploy)
**Next:** Founder executes P1 (secret rotation — URGENT), then P2 at console with real AWS creds. Two pre-deploy code fixes required before any image build: raise grpcio floor + delete shop_resolver.py.
