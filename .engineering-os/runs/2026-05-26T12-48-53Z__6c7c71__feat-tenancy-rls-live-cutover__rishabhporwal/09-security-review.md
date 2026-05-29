# Stage 4 — Security Review — `feat-tenancy-rls-live-cutover`

> Reviewer: Shreya (security-reviewer, VETO). Mode: parallel-review (high-stakes).
> Verdict persisted by orchestrator from Shreya's Stage-4 return (she is read-only).

## VERDICT: SECURITY PASS

Zero CRITICAL, zero HIGH, zero compliance violations, zero traceability-blockers.
All 4 §17b bounce conditions PASS. One MED logged (SEC-MED-1) — fix scheduled before
Stage-5 handoff.

## The 4 bounce conditions (§17b)

1. **ACs met or honestly deferred — PASS.** All 17 ACs present. The 5 DB/HTTP-dependent
   gates (live role inventory, CF-SEC-1 green/kill/inverse, STEP-5 pre/green/kill/inverse,
   rollback right/wrong/timing, residency) are `DEFERRED-TO-STAGING-REHEARSAL` because no
   ap-south-1 staging clone / psql / live HTTP exists in the build env. Each deferral
   carries the exact runnable command for Stage 7/8. Honest deferrals, not vacuous dodges.
   The synthetic-only attestation is an honest negative (local brain_dev holds real ETL'd
   data → neither ap-south-1 nor synthetic → STEP 0.5 must defer).
2. **No vacuous green — PASS.** No deferred capture claims a GREEN/RED it did not run.
   The reproducible STEP 0.7 bare-write grep genuinely returns 0 hits (AC9 met).
3. **`git diff -- "legacy project/"` = 0 — PASS.** Verified cached + working-tree +
   untracked: zero lines. CF-BN-NOLEGACY-1 honored.
4. **No banned shape in `step-c-bypass-audit.sql` policy lines — PASS.** Grep hits land
   only on comment lines (12/13/14/44). Both policies use the approved fail-closed form
   `current_setting('app.workspace_id', true)::uuid` with matched `WITH CHECK`. The `, true`
   arg is `missing_ok`, not a `USING (true)` body. No `OR … IS NULL`, no `COALESCE`, no
   session-level `SET` in policy bodies.

## Security-specific findings

- **Bypass = ONE named role.** CF-CUT-IDENTITY-AUDIT-1 ≤1-bypass tripwire coded at STEP 2.7
  (`rollout-runbook.sh:260-269`), fails closed via `halt`. CF-SEC-3.HARD second-brand
  tripwire coded at STEP 6 (`:500-511`) and as standalone `post-flip-second-brand-grep.sh`
  (exit 1 on any non-Sugandh-Lok workspace_id).
- **Probe is load-bearing.** `rls_app` created `NOBYPASSRLS` at STEP 2.7; G1.inverse capture
  documents that running the probe as the bypass role is silently-GREEN/vacuous — STEP 4
  explicitly binds `rls_app`.
- **Rollback ordering correct.** `down.sql` BEFORE `NOBYPASSRLS` documented in runbook header
  (`:31-39`), README (`:89-102`), and `down-bypass-audit.sql:5-12`, each naming the
  wrong-order 0-row outage hazard.
- **DPDP/residency — ALL PASS.** §7 addendum (`06b-…`) covers 4 transitional acts on
  §8(2)+§7 basis; ap-south-1 in-region (STEP 0 + 0.5); `bypass_query_log` stores
  `statement_class` not raw SQL and is §12-erasure-scopable. Addendum correctly
  UNSIGNED-DRAFT under HOLD-AT-STEP-5 (Founder signs at Stage 7/8) — designed posture.

## MED finding (tech debt — does not block Stage 4 PASS)

- **SEC-MED-1 — autocommit / `SET LOCAL` mismatch in the Decision-Log audit write.**
  `rollout-runbook.sh:348-366` (STEP 3.5 grant) and `:478-491` (STEP 6 complete): each psql
  heredoc runs `SET LOCAL app.is_superadmin = 'true';` then `INSERT INTO ai.decision_log
  (… workspace_id=NULL, is_system_row=true)` with no `BEGIN;`/`COMMIT;` wrap. Under psql
  autocommit, `SET LOCAL` is transaction-scoped and resets at end of its own statement, so
  the GUC is unset when the INSERT runs in its own implicit transaction → the
  `superadmin_system_rows WITH CHECK` evaluates `''` and rejects the row — the bypass
  grant/complete audit entries silently fail to persist. MED (no tenant leak, fails loud at
  rehearsal). Contrast: STEP 2.7's `DO $$…$$` blocks are correctly transaction-wrapped.
  **Fix:** wrap each heredoc `BEGIN; SET LOCAL app.is_superadmin='true'; INSERT …; COMMIT;`
  (or `SELECT set_config('app.is_superadmin','true', true)` inside an explicit txn).
  **Gate:** verified GREEN at Stage-7/8 rehearsal before the grant entry is relied on.

## Handoff

- **Verdict:** SECURITY PASS → Stage 5 (Tanvi, QA).
- **Carry-forward:** SEC-MED-1 fixed by Vikram before Stage-5 review (orchestrator decision —
  cheap one-block fix, on the compliance audit path).
