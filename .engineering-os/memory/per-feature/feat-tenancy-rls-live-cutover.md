# Per-feature journal — feat-tenancy-rls-live-cutover

> Per-feature continuity log. Each stage appends; previous stages preserved.

## 2026-05-26T12:48:53Z — Stage 1 (intake) — Rohan (cto-advisor)

**Slice purpose:** close the OPEN P0 (live Supabase shared Postgres in ap-south-1 has zero RLS, open since 2026-05-24) by designing + executing the live FORCE-flip ceremony for the Brain-native RLS that already shipped via PRs #1+#2 (predecessor `feat-tenancy-rls-brain-native`, HOLD-AT-FORCE).

**The load-bearing dimension:** the legacy Express/Prisma app still hits the same prod DB and does NOT call `set_config('app.workspace_id', …)` on its connections. Without explicit handling, FORCE = 0-row outage for every brand on the legacy frontend.

**Lane:** high-stakes. Trigger surfaces: multi-tenancy, pii, india-compliance, schema-proto, connectors.

**Paradigm:** sql.

**Persona count:** 2 (high-stakes cap) — compliance + strangler, both `:sonnet` (reasoning-heavy).

**Personas:**
- `india-data-isolation-compliance-officer:sonnet` — 5 concerns (1 escalation-recommendation on path choice).
- `live-rollout-strangler-realist:sonnet` — 7 concerns (1 CRITICAL on STEP-5 verify-the-verifier).

**Dependency check:** PASS. Predecessor `feat-tenancy-rls-brain-native` is `merged-on-development` (SHA `860aeee`, HOLD-AT-FORCE).

**Intake decision:** ADVANCE.

## 2026-05-29T00:00:00Z — Stage 3 (build) — Vikram (backend-developer)

**Stage:** 3
**Track:** T1 / T2 / T3 / T4 (T5 = handoff)
**Action:** Built all Stage-3 deliverables for feat-tenancy-rls-live-cutover (Path C)
**Skills loaded:** backend-fastify-trpc-grpc, domain-driven-design, database-design, audit-log-immutability, operational-readiness, defense-in-depth-validation, engineering-discipline, verification-before-completion
**Paradigm:** sql

**Decisions:**
- T4 staging-rehearsal captures split into REAL (T4.2 bare-write grep = 0, captured) and DEFERRED (T4.1 + T4.3–T4.10) because psql is not installed in Stage-3 build env and local brain_dev is not an ap-south-1 staging clone. All deferred files document exact commands + expected outputs for Stage-7/8 rehearsal. This is the honest call per the T4 scoping note in the plan.
- `step-c-bypass-audit.sql` uses only the approved fail-closed current_setting form. No banned shapes in live SQL (comment-only hits on the BANNED header block — confirmed by non-comment grep pass).
- `rollout-runbook.sh` rewritten to insert new steps 0.5/0.7/1.5/2.7/3.5 and reshape STEP 5/6 while preserving STEPS 0/1/2/2.5/3/4 verbatim. Calendar constraint header + exit deadline header + ROLLBACK ordering section added.
- `down-bypass-audit.sql` documents the binding ordering (R1 down.sql → R2 down-bypass-audit.sql → R3 NOBYPASSRLS) in the header comment to make the G3 kill-test rationale self-contained.

**Files touched:**
- NEW: apps/core-service/migrations/manual/rls/step-c-bypass-audit.sql
- NEW: apps/core-service/migrations/manual/rls/down-bypass-audit.sql
- NEW: apps/core-service/migrations/manual/rls/scripts/parse-pg-log-to-bypass-audit.sh
- NEW: apps/core-service/migrations/manual/rls/scripts/post-flip-second-brand-grep.sh
- EXTENDED: apps/core-service/migrations/manual/rls/README.md (Path-C section)
- EXTENDED: apps/core-service/migrations/manual/rls/rollout-runbook.sh (steps 0.5/0.7/1.5/2.7/3.5, reshape 5/6, ROLLBACK section, env-var guards, headers)
- NEW: staging-rehearsal/ (20 files: 1 REAL + 1 attestation + 18 DEFERRED)

**Verification:**
- Command: `grep -rn 'OR.*IS NULL\|COALESCE\|USING\s*(true)' step-c-bypass-audit.sql | grep -v '^[0-9]*:--'`
- Output: (empty — no hits outside comments)
- Passed: TRUE
- Command: `bash -n rollout-runbook.sh && bash -n parse-pg-log-to-bypass-audit.sh && bash -n post-flip-second-brand-grep.sh`
- Output: all PASS
- Passed: TRUE
- Command: `git diff --stat -- "legacy project/"`
- Output: (empty)
- Passed: TRUE (AC15)
- Command: `grep -rn 'prisma\.\|\bdb\.query\|pool\.query' apps/ | grep -v 'withWorkspace\|withSuperadmin' | grep -v '//__' | grep -vE '\.test\.|\.spec\.' | grep '\.ts:'`
- Output: 0 hits
- Passed: TRUE (AC9, T4.2 REAL capture)

**Open questions:** None. T4 deferred captures are expected per T4 scoping note; exact commands documented in each DEFERRED file.

**Handoff signal:** READY-FOR-SECURITY (parallel: Shreya security-reviewer + Tanvi qa-agent)

---

## 2026-05-26T12:55:00Z — Stage 1 (synthesis) — Rohan (cto-advisor)

**Synthesis decision:** ADVANCE → Architect (Aryan), Stage 2. Default Stage-2 design = Path C with exit deadline = Path B completion date.

**Escalation FIRED:** CF-CUT-PATH-1 (Founder picks {Path C with hard exit deadline, Path A2}; A1 barred by `feedback_legacy_is_reference_only.md`; B-as-immediate-close canon-incompatible with §8(6) notice timeline). Mirrored to `.engineering-os/pending-founder-attention.md`.

**Critical finding:** Persona 2's O2 — STEP-5's "legacy smoke renders the same row counts" gate is the canonical verify-the-verifier hazard (10th occurrence of the durable-rule's target class would have landed in prod if STEP 5 had shipped as a psql double of the bypass role). Bound CF-CUT-VERIFY-THE-VERIFIER-1 CRITICAL with 3 captured pre-ceremony kill-tests on the staging clone (STEP-5 kill, STEP-5 inverse-mutant, rollback-wrong-order) + Stage-6 disk re-mutation per durable-rule sub-rule 7.

**Binding contract (11 new/sharpened):** CF-CUT-PATH-1 / CF-CUT-RUNBOOK-AUG-1 / CF-CUT-VERIFY-THE-VERIFIER-1 / CF-CUT-ROLLBACK-ATOMIC-1 / CF-CUT-DRAIN-1 / CF-CUT-SHIPROCKET-RECONCILE-1 / CF-CUT-RESIDENCY-1 / CF-CUT-BYPASS-AUDIT-1 / CF-CUT-DPDP-ADDENDUM-1 / CF-CUT-IDEMPOTENT-1 / CF-CUT-CALENDAR-1. Inherited (Child-1, unchanged): CF-RES-1.a / CF-SEC-1 / CF-SEC-3.HARD / CF-SEC-5 / CF-C1-POOL-1.a / CF-C1-RLS-DEFAULT-1.a / CF-C1-CRON-SCOPE-1.a / CF-C1-AUDITLOG-1.a / CF-C1-ROLLOUT-ORDER-1 / CF-C1-ZERO-BEHAVIOR-1 / CF-BN-NOLEGACY-1.

**Build gated on:** CF-CUT-PATH-1.

**Open Stage-2 obligations (Aryan):** 10 named, headline = pick path (default C-with-deadline) + bind STEP-5 real-path + 3 kill-tests.

**Next:** Aryan picks up Stage 2 on default Path C. Intake artifacts on branch `chore/intake-feat-tenancy-rls-live-cutover` (off `origin/development`); the live-cutover code work itself ships on its own feature branch when Stage 2 begins.

---

## 2026-05-29T00:00:00Z — Shreya (security-reviewer) — feat-tenancy-rls-live-cutover
**Stage:** 4
**Action:** Security review PASS (parallel-review mode)
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 1 — SEC-MED-1 `SET LOCAL app.is_superadmin='true'` precedes the `ai.decision_log` INSERT in two psql heredocs (rollout-runbook.sh:349, :479) with no `BEGIN;`/`COMMIT;` wrap; under psql autocommit, SET LOCAL is txn-scoped and resets before the INSERT runs in its own implicit txn, so `superadmin_system_rows` WITH CHECK rejects the workspace_id=NULL grant/complete audit row. Audit-write correctness bug (fails LOUD at the staging rehearsal STEP 3.5/STEP 6), not a tenant leak. Tech debt: wrap each heredoc in `BEGIN; SET LOCAL ...; INSERT ...; COMMIT;` (or use `SELECT set_config('app.is_superadmin','true',true)` inside an explicit txn). MUST be verified GREEN at the Stage-7/8 rehearsal before the grant entry is relied upon as the bypass audit trace.
**Compliance gates (DPDP/residency):** ALL PASS — §7 addendum (06b) enumerates 4 transitional acts on §8(2)+§7 basis, ap-south-1 in-region (STEP 0 + 0.5), §12 erasure-scopable (statement_class not raw SQL; DELETE WHERE workspace_id), second-brand CF-SEC-3.HARD tripwire mechanized. Addendum UNSIGNED-DRAFT (HOLD-AT-STEP-5; Founder signs Stage 7/8) — correct posture, not a defect.
**Traceability:** PASS for the cutover ceremony — bypass grant/revoke/complete Decision-Log entries carry decision_basis + scope_attestation + rolname_on_live; bypass_query_log keyed by workspace_id + application_name. (SEC-MED-1 threatens the write of those entries — flagged.)
**4 bounce conditions:** (1) all 17 ACs met or honestly DEFERRED-TO-STAGING (5 DB/HTTP-dependent gates deferred with exact runnable commands; none claim un-run green) — PASS; (2) no captured kill/inverse shows expected-RED as GREEN (10 are deferred placeholders, 1 honest synthetic-only negative) — PASS; (3) `git diff -- "legacy project/"` = 0 (cached + working + untracked) — PASS; (4) zero banned shapes in step-c policy lines (4 grep hits all on comment lines 12/13/14/44; policies use only fail-closed `current_setting(...,true)::uuid`) — PASS.
**Security-specific:** bypass = ONE named role; CF-CUT-IDENTITY-AUDIT-1 ≤1-bypass tripwire coded STEP 2.7 fail-closed; CF-SEC-3.HARD second-brand tripwire coded STEP 6 + standalone post-flip-second-brand-grep.sh (exit 1 on foreign workspace_id); rollback ordering down.sql BEFORE NOBYPASSRLS documented in runbook header + README + down-bypass-audit.sql with the wrong-order 0-row hazard named; rls_app created NOBYPASSRLS so CF-SEC-1 probe is load-bearing.
**Bounced to:** NONE
**Rationale:** Zero CRITICAL/HIGH/compliance/traceability-blocking findings; 4 bounce conditions all PASS; one MED audit-write correctness bug logged as tech debt + rehearsal-verify gate. PASS to Stage 5.

## 2026-05-29T00:00:00Z — Vikram (backend-developer) — SEC-MED-1 bounce-fix

**Stage:** 3 (bounce-fix)
**Action:** SEC-MED-1 closed — wrapped both live `SET LOCAL` psql heredocs in explicit `BEGIN;`/`COMMIT;`
**Files touched:** apps/core-service/migrations/manual/rls/rollout-runbook.sh (STEP 3.5 lines 350-370; STEP 6 lines 484-502)
**Verification:**
- Command: `bash -n rollout-runbook.sh`
- Output: PASS
- Command: `git diff --stat -- "legacy project/"`
- Output: (empty — 0)
- Passed: TRUE
**Handoff signal:** READY-FOR-STAGE-5 (SEC-MED-1 resolved; no other open findings)

---

## 2026-05-29T00:00:00Z — Stage 5 (QA review) — Tanvi (qa-agent)

**Stage:** 5
**Action:** QA PASS
**Test runs:** 0 unit / 0 integration (rehearsal deferred to Stage-7/8 by design) / 0 contract / 0 e2e
**Static checks:** 3 shell `bash -n` PASS; banned-shape grep on `step-c-bypass-audit.sql` PASS (comment-only hits); `git diff -- "legacy project/"` = 0
**Real-network smoke:** LEGITIMATELY DEFERRED — no ap-south-1 staging clone; exact commands + expected outputs documented in all 9 deferred captures; no vacuous GREEN claimed; hard operator-interactive gates prevent skipping at Stage 7/8
**Metric registry parity (TS↔Python):** N/A — zero metric changes in this slice
**Trace IDs end-to-end:** CONFIRMED — SEC-MED-1 fix applied; both Decision-Log heredocs (STEP 3.5 grant + STEP 6 complete) wrapped in `BEGIN; SET LOCAL …; INSERT …; COMMIT;` at lines 351–369 and 485–501
**Operational-readiness:** PASS — 12 env-var guards, idempotent steps, calendar constraint header, exit deadline written
**Mutation tests on high-stakes:** DEFERRED (staging-clone required) — 3 kill-tests (G1/G2/G3) + 2 inverse-mutants all carry valid RED/divergent expected-output shapes; no fabricated outputs
**Coverage:** N/A — pure DDL + shell slice
**Bounced to:** NONE
**Findings:** 1 LOW (QA-LOW-1 — ROLLBACK R4 comment block has `SET LOCAL` without `BEGIN/COMMIT`; operator copy-paste hazard in emergency rollback; comment-only, not executed; defer to next PR)
**Stage-5 bounce conditions (§17b):** ALL PASS — no capture claims GREEN it did not run; all negative-control proofs carry honest RED/divergent expected forms
**Stage-6 obligations for Rohan:** re-mutate G1/G2/G3 kills on staging clone per durable-rule sub-rule 7; fix QA-LOW-1 before final ship

---

## 2026-05-29T14:00:00Z — Stage 6 (final review + delegated Founder gate) — Rohan (cto-advisor)

**Stage:** 6
**Action:** FINAL REVIEW — verdict PASS (Stage-8-READY-BEHIND-HOLDS); delegated Founder gate signed APPROVE-WITH-CAVEATS on Founder's behalf.
**Per-CF audit:** every CF in plan §11 satisfied, honestly deferred-with-gate, or held for the Founder ceremony. No silent gap. (CF-CUT-PATH-1 ratified; CF-CUT-RUNBOOK-AUG-1 all steps present; CF-CUT-BYPASS-AUDIT-1 §12-scopable; CF-CUT-VERIFY-THE-VERIFIER-1 shapes valid, live re-mutation held.)
**Two review fixes verified on disk:** SEC-MED-1 (BEGIN/COMMIT at STEP 3.5 lines 351-369 + STEP 6 lines 485-501) AND QA-LOW-1 (R4 comment block lines 538-544 wrapped + note). My own grep: 3 BEGIN; / 3 COMMIT;.
**My independent verifier re-run (4 of Tanvi's gates):** legacy-diff=0, bash -n ×3 OK, bare-write-grep=0 bytes, txn-wraps present — all reproduce her PASS.
**Re-mutation decision (durable-rule sub-rule 7, 10th occurrence):** (b) BIND as HARD Stage-7/8 pre-flip precondition. CANNOT fabricate — no ap-south-1 staging clone / live legacy HTTP / psql in env. Re-mutated kill-test SHAPES on disk (non-vacuous, gate-independence confirmed); bound live re-mutation to stage6-remutate/. NOT signed as done.
**Over-engineering audit:** CLEAN — exactly 6 plan-named product files staged; zero deps; one justified new primitive; observability minimal-by-design (§14).
**Hard-rule deviation check (§9):** NONE — delegated auto-approve in scope.
**Paradigm:** sql confirmed; 0 LLM; ~₹0/mo.
**HOLDs persisted:** HOLD-AT-FORCE, HOLD-AT-STEP-5 (§7 addendum signature), HOLD-AT-BYPASS-REVOKE (Path B), HOLD-AT-RE-MUTATION (stage6-remutate/), DEFERRED-STAGING-REHEARSAL (11 captures).
**Founder asks:** (1) "commit it" → 6 product files to feature branch; (2) sign §7 addendum 06b-… at Stage 7/8 BEFORE STEP 5; (3) set REAL Path-B date for granted_until; (4) pick festival-safe window (no Diwali/Republic-Day/EOSS).
**Artifacts:** 11-final-review.md, 14-retro.md, 12-founder-decision.json; pending-founder-commit.md augmented (QA-LOW-1 note + mechanical commit command).
**Next:** Founder gate — the live FORCE flip stays Founder-at-console at Stage 8; code may be committed to feature branch on Founder free-text "commit it".
