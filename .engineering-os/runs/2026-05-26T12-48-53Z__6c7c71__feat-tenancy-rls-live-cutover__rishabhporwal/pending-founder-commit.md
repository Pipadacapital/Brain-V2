# Pending Founder Commit — feat-tenancy-rls-live-cutover (Stage 3)

Stage 3 build complete. Files are STAGED (not committed).
Commit after Stage 4/5/6 reviews pass and Founder approves.

## Staged files (`git diff --cached --name-only`)

```
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/brain-native-bare-write-grep.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/cf-sec-1-green.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/cf-sec-1-inverse.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/cf-sec-1-kill.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/live-role-inventory.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/rollback-right-order.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/rollback-timing.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/rollback-wrong-order-kill.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/step5-green.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/step5-inverse.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/step5-kill.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/step5-pre.txt
.engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/staging-rehearsal/synthetic-only-attestation.txt
apps/core-service/migrations/manual/rls/README.md
apps/core-service/migrations/manual/rls/down-bypass-audit.sql
apps/core-service/migrations/manual/rls/rollout-runbook.sh
apps/core-service/migrations/manual/rls/scripts/parse-pg-log-to-bypass-audit.sh
apps/core-service/migrations/manual/rls/scripts/post-flip-second-brand-grep.sh
apps/core-service/migrations/manual/rls/step-c-bypass-audit.sql
```

(20 files total)

## Proposed commit message

```
feat(rls-cutover): Stage-3 build — Path-C runbook + bypass audit + T3 scripts

- NEW step-c-bypass-audit.sql: bypass_query_log table + 3 indexes + RLS + dual-policy
  (ws_isolation + superadmin_system_rows); §12 erasure-scopable; all banned shapes absent
- NEW down-bypass-audit.sql: symmetric rollback; binding ordering documented (down.sql
  BEFORE NOBYPASSRLS per CF-CUT-ROLLBACK-ATOMIC-1)
- EXTEND rollout-runbook.sh: new STEPS 0.5/0.7/1.5/2.7/3.5; reshape STEP 5 (real-path
  HTTP smoke, G2 gate); reshape STEP 6 (Decision-Log + second-brand tripwire); calendar
  constraint + exit-deadline headers; ROLLBACK ordering section; all new env-var guards
- EXTEND README.md: Path-C bypass+audit section; new files table; ROLLBACK ordering;
  new HOLD states; exit ceremony template
- NEW scripts/parse-pg-log-to-bypass-audit.sh: postgresql.log parser; best-effort
  workspace_id extraction; INSERTs into bypass_query_log; cron-able
- NEW scripts/post-flip-second-brand-grep.sh: CF-SEC-3.HARD second-brand tripwire;
  exit non-zero on foreign workspace_id
- staging-rehearsal/: 1 real capture (brain-native-bare-write-grep.txt = 0 hits);
  1 attestation (synthetic-only); 18 DEFERRED files with exact commands for Stage-7/8

CF-CUT-PATH-1 / CF-CUT-RUNBOOK-AUG-1 / CF-CUT-BYPASS-AUDIT-1 / CF-CUT-ROLLBACK-ATOMIC-1
@paradigm sql — zero new package deps
```

## Reversibility recipe

The runbook itself is the reversibility recipe. In order:

1. `psql "$DIRECT_URL" --file apps/core-service/migrations/manual/rls/down.sql`
   (drops 44-table policies + NO FORCE)
2. `psql "$DIRECT_URL" --file apps/core-service/migrations/manual/rls/down-bypass-audit.sql`
   (drops bypass_query_log policies + DROP TABLE)
3. `psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"`
   (revoke bypass — ONLY after steps 1+2)
4. Brain Decision-Log `rls.rollback` INSERT under `app.is_superadmin=true`

These files are additive to the existing `down.sql` (unchanged). Reversibility is
the same as the predecessor, with the bypass_query_log table added to step 2.

## Self-review — In-lane DoD

| DoD Item | Status |
|----------|--------|
| `@paradigm sql` on every new artifact | PASS: header on all 4 SQL+shell files |
| No LLM token budget needed | N/A: `@paradigm sql`, zero LLM |
| Idempotency keys on all writes | PASS: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS` not needed (policies not IF NOT EXISTS in Postgres, but step runs idempotently via IF NOT EXISTS on table + idempotent ALTER ROLE) |
| Zod schemas on every API input | N/A: no API surface — pure DDL + shell |
| Timestamps UTC | PASS: `TIMESTAMPTZ DEFAULT now()` + all shell log() uses `date -u` |
| workspace_id assertion in every gRPC handler | N/A: no gRPC this slice |
| requireRole on every mutation | N/A: no tRPC/HTTP this slice |
| Cursor pagination on every list | N/A: no list endpoints this slice |
| No sequential DB queries in layout | N/A: no app-layer queries |
| CloudWatch metrics + Sentry | N/A: §14 explicitly zero new observability |
| Trace-instrumented endpoints | N/A: pure DDL/shell slice |
| Real-network smoke captured | PARTIAL: T4.2 (bare-write grep) is REAL. T4.1/T4.3–T4.10 DEFERRED (no psql, no staging clone in build env). See staging-rehearsal/*.txt DEFERRED files. |
| Coverage ≥70% on new code | N/A: §13 explicitly skips unit tests; integration = rehearsal (DEFERRED) |
| banned-shape grep clean | PASS: `grep -v '^[0-9]*:--'` = 0 non-comment hits |
| bash -n syntax check | PASS: all 3 shell files |
| legacy project/ diff = 0 | PASS: `git diff --stat -- "legacy project/"` = empty |
| AC15 confirmed | PASS |

## SEC-MED-1 closed (2026-05-29)

Wrapped both live `SET LOCAL` heredocs in `BEGIN;`/`COMMIT;`: rollout-runbook.sh lines 350-370 (STEP 3.5 grant) and lines 484-502 (STEP 6 complete). `bash -n` PASS. `git diff --stat -- "legacy project/"` = 0.

## QA-LOW-1 closed (2026-05-29)

Wrapped the ROLLBACK R4 reference comment block in `BEGIN;`/`COMMIT;` (rollout-runbook.sh lines 538-544) + added an explanatory note ("BEGIN/COMMIT REQUIRED — SET LOCAL is txn-scoped…"), so an operator copy-pasting R4 in an emergency rollback won't hit the same autocommit GUC-reset defect SEC-MED-1 fixed in the live paths. Comment-only change; `bash -n` PASS.

## Stage-6 final review (Rohan, 2026-05-29) — commit manifest CONFIRMED

The existing 6-product-file manifest above is COMPLETE and covers both review fixes (no augmentation needed beyond the two notes above). Mechanical commit command for the Founder (explicit paths, NO `git add -A`):

```
git add \
  apps/core-service/migrations/manual/rls/step-c-bypass-audit.sql \
  apps/core-service/migrations/manual/rls/down-bypass-audit.sql \
  apps/core-service/migrations/manual/rls/rollout-runbook.sh \
  apps/core-service/migrations/manual/rls/scripts/parse-pg-log-to-bypass-audit.sh \
  apps/core-service/migrations/manual/rls/scripts/post-flip-second-brand-grep.sh \
  apps/core-service/migrations/manual/rls/README.md \
  .engineering-os/runs/2026-05-26T12-48-53Z__6c7c71__feat-tenancy-rls-live-cutover__rishabhporwal/
git commit   # Founder gives free-text "commit it" per standing rule
```

**NOTE:** committing the code is NOT the live flip. The FORCE flip stays HELD (Founder-at-console, Stage 8) behind the §7-addendum signature, the staging rehearsal + Rohan's `stage6-remutate/` captures, a real Path-B date, and a festival-safe window. See `12-founder-decision.json`.
