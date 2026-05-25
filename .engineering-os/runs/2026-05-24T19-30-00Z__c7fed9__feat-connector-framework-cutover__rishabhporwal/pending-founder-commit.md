# Pending Founder commit — feat-connector-framework-cutover (Child 3)

> Stage 6 PASS (Rohan), Stage 7 APPROVE signed under standing delegation. Per the autonomous-run no-commit policy, the pipeline staged the reviewed code but did NOT commit. **You commit.**
> Commit authorization requires your free-text "commit it" (harness guard; AskUserQuestion approval is not sufficient).
> Branch: `feature/feat-tenancy-auth-rls-hardening` (current; same feature branch carrying Child-1/Child-2 — merge to `development` is your PR, then `release`, then `master`).

## What this commit contains
Brain-native connector/ingestion framework (Child 3), Shape-A / Option-A, LOCAL-verified, ZERO live flip (HOLD-AT-CUTOVER). One generic `ingest_batch` primitive + Shopify adapter + Python session-context primitive + fail-closed PII gate + runtime workspace allowlist + residency assert + credential-custody interface (both backings stubbed) + `IntegrationEvent` Kafka envelope proto + raw event-store DDL (runbook-gated) + LOCAL parity harness + per-connector cutover runbook. Child-1 ledger updated with CF-C3-FORCE-UNLOCK-SCOPE-1.

## Mechanical commit command (explicit product paths — NO `git add -A`)

```bash
git add \
  "apps/ingestion-service/conftest.py" \
  "apps/ingestion-service/docker-compose.test.yml" \
  "apps/ingestion-service/pyproject.toml" \
  "apps/ingestion-service/migrations/manual/raw/README.md" \
  "apps/ingestion-service/migrations/manual/raw/down.sql" \
  "apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql" \
  "apps/ingestion-service/migrations/manual/raw/step-b-force.sql" \
  "apps/ingestion-service/runbooks/cutover/per-connector-ceremony.md" \
  "apps/ingestion-service/runbooks/cutover/shopify-cutover-runbook.md" \
  "apps/ingestion-service/src" \
  "apps/ingestion-service/tests" \
  "protos/events/integrations.proto" \
  "protos/buf.yaml" \
  "apps/core-service/migrations/manual/rls/README.md"

git commit -m "feat(child-3-connector): Brain-native connector framework — single ingest primitive + Shopify adapter, fail-closed PII gate, runtime allowlist, base64 HMAC, correlation 4-tuple, IntegrationEvent envelope, raw event-store DDL (runbook-gated), LOCAL parity harness, per-connector cutover runbook; HOLD-AT-CUTOVER (zero live flip)

Child 3 of EPIC chore-migrate-legacy-to-brain. Shape A / Option A (LOCAL-only + Stage-8 STEP-0.5 real-pooler IT). Single-Primitive: one ingest_batch + N adapters. No money in raw path (Child-2 converts at ACL). No live token/DDL/deploy. Custody both backings stubbed (Founder Option A/B = config swap, deferred to Stage-8). CF-C3-FORCE-UNLOCK-SCOPE-1 logged in Child-1 ledger. 183 unit+parity pass / 14 integration gated / 80% coverage / 3 mutants killed. Security PASS (09b), QA PASS (10b), Stage-6 independent re-verification reproduced every gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Hygiene confirmation (independently verified at Stage 6)
- `git diff -- "legacy project/"` = 0 lines (CF-BN-NOLEGACY-1).
- No live credential value / `.env` / private key in the staged diff.
- No live infra (kubectl/terraform/MSK/Glue/ALTER ROLE PASSWORD) in src.
- `FORCE ROW LEVEL SECURITY` confined to runbook-gated `step-b-force.sql`/`down.sql` (HELD).
- Proto codegen output (`packages/proto-ts/gen`, `pylibs/proto_py/_gen`) is NOT staged — `integrations.proto` is additive; codegen runs at the Stage-8 deploy ceremony (no live consumer this child).

## After you commit
1. PR `feature/feat-tenancy-auth-rls-hardening` → `development` (carries Child-1/2/3).
2. Stage-8 readiness (Jatin) — readiness-only, no live deploy.
3. The live single-owner cutover ceremony remains HELD until your Stage-8 gate + credential-custody Option A/B decision.
