# Final Review — feat-tenancy-rls-brain-native

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Validates against [schemas/final-review.schema.json](../schemas/final-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-24T17:10:00Z |
| **Verdict** | **PASS** |
| **Parent epic** | `chore-migrate-legacy-to-brain` — Brain-native rebuild of withdrawn legacy Child-1 |
| **Lane** | high-stakes |
| **Paradigm** | sql (SQL/DDL + connection-handling; zero LLM path) |
| **Bounce rounds before this review** | 1 (Shreya HIGH-1 + Tanvi F1/F2/F3/F4/F5 — all resolved on re-review) |

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | **PASS** | Shipped change is exactly Shape A: session-context primitive + RLS DDL (authored, not applied) + CF-SEC-1 probe + 6-step runbook + auth-claim + cron-fanout, all Brain-native in `core-service`, FORCE deferred to Stage-8. Matches the requirement's own success metric ("C5 gate **satisfiable** Brain-native", line 56) and non-goal (no live RLS DDL this run, line 70). No drift from `01-requirement.md`. |
| **Paradigm audit** | **PASS** | `@paradigm sql` on every code path; zero LLM tokens; no `frontier_llm`/`small_llm`/ML snuck in. Pure deterministic data-layer. Cost-routing audit clean. Confirmed against Stage-1 synthesis + Aryan's plan §3 + §18. |
| **Architecture quality** | **PASS** | Single-Primitive Rule held: `withWorkspace`/`withSuperadmin` built once in `workspace-context.ts`, consumed N times (probe, cron, auth seam, future runtime). No per-call-site re-implementation. No anti-pattern drift. The `pg`-driver-not-Prisma departure is justified (no Brain schema exists) and the exported interface is the contract, so a future Prisma adapter is a backing detail. |
| **Security review pass-through** | **PASS** | Shreya BOUNCE→PASS round 2 (`08c`). HIGH-1 (contextless arm inert) resolved + independently mutation-verified by her. G4 PASSED; 0 CRITICAL/HIGH, 0 compliance violations, 0 missing-traceability. |
| **QA review pass-through** | **PASS** | Tanvi BOUNCE→PASS round 2 (`09b`). F1 (CRITICAL/VETO BYPASSRLS), F2/F3/F4 (HIGH), F5 (MEDIUM) all resolved with captured evidence (9/9 integration, 3x no-flake, coverage ≥70%, BYPASSRLS guard confirmed firing). |
| **Observability complete** | **PASS (proportionate)** | Probe verdict gauge + cron proof-of-attempt 4-tuple logs + runbook machine-asserted go/no-go. No runtime dashboards — correctly, because there is no Brain runtime yet (a dashboard would be over-build). CF-SEC-5 4-tuple seeded in the primitive, consumed later. |
| **Cost estimate held** | **PASS** | ₹0 incremental this run (no live DDL, no runtime). 0 LLM tokens/day as planned. Variance 0%. |

---

## The headline — CF-BN-GATE-BOUNDARY-1 (the act I countersign)

**SIGNED.** I confirm the Child-0 §A2.2 amendment landed correctly, is decision-logged, and is reflected in `state/active.json` exit criteria.

**Verified against the source artifact** (`.../spike-legacy-migration-architecture/06-architecture-plan.md`):
- **§A2.1** now carries (a) the C5 three-states note (`NOT-SATISFIABLE → SATISFIABLE → LIVE/FORCED`) and (b) the named **HOLD-AT-FORCE** state block, gated on the four conditions (context-aware runtime OR 100% service-role; Child-3 residual-writer conversion; complete bare-write grep ZERO hits *not excluding backfill/discoverChannels*; FK-EXPLAIN per table). Both are present verbatim per plan §A0.1(d)/§A0.2.
- **§A2.2 Child-1 exit row (line 505)** changed from "RLS **live** + verified on all workspace-scoped tables" → "RLS **satisfiable Brain-native** … FORCE execution … DEFERRED to Stage-8 per the named HOLD-AT-FORCE state … the gate column G1/G2 reads SATISFIABLE (not LIVE) at end of this child." Matches §A0.1(a).
- **§A2.2 Child-1 gate column** → "ESTABLISHES the gate Brain-native (G1+G2 become SATISFIABLE here; they go LIVE at the Stage-8 FORCE ceremony under the HOLD-AT-FORCE state …)." Matches §A0.1(b).
- **§A2.2 Child-2 entry row (line 506)** → "RLS **satisfiable Brain-native AND the C5 FORCE-readiness pre-conditions met** … FORCE-ready, even if the Stage-8 FORCE ceremony … has not yet executed." Matches §A0.1(c). This is the fix to the persona's CRITICAL: Child-2's pre-flight dependency check now reads the *real* criterion, not the ghost "RLS live = false" that would have falsely blocked it.

**Decision-logged:** `architecture-gate-amendment` row present in `.engineering-os/decision-log/2026/05/2026-05-24.jsonl` (ts 2026-05-24T15:00:00Z, actor backend-developer, Track G). It cites the original line 501/502 language, the new wording, the rationale (no Brain runtime → FORCE-without-runtime = 0-rows outage), the Founder-visibility pointer (`pending-founder-attention.md`), and `signed_by_rohan_at: stage-6`. **I am that signature.**
  - *Note (non-blocking):* plan §A0.4 referenced the path `.engineering-os/memory/decision-log/...`; the row correctly landed at the canonical `.engineering-os/decision-log/...`. The path typo in the plan text is harmless — the artifact is in the right place. Logged as a retro lesson, not a finding.

**`state/active.json` exit_criteria:** confirmed `c5_gate_state: "SATISFIABLE"`, `force_deferred_to: "stage-8"`, `force_NOT_run_this_child: true`, `named_hold_state: "HOLD-AT-FORCE (...)"`, with the seven deliverables enumerated. Child-2's dependency check will read SATISFIABLE — machine-honest.

**Why I can sign this without escalating:** the amendment formalizes a discipline the Founder *already ratified* on the sibling slice (`feat-tenancy-auth-rls-hardening`, decision-log 2026-05-24T09:25:28Z: "HOLD at STEP-5 FORCE"). It was mirrored to `pending-founder-attention.md` for visibility at Stage 1. This is an architecture-governance act within my Stage-6 authority — visibility-not-permission, exactly as the synthesis (§4) assessed.

---

## Independent re-verification (≥3 — I ran these myself, captured output)

> Per Stage-6 mandate: spot-re-run Tanvi's gates and don't trust the reviewers. I ran six independent checks.

| # | Check | Command (mine) | Result |
|---|-------|----------------|--------|
| **1** | Fail-open patterns ZERO on **executable** DDL | `grep -vE '^\s*--'` then count `USING(true)`/`COALESCE`/`OR…IS NULL`/session-`SET` across step-a/step-b/down | **PASS** — 0/0/0/0 on every executable line of all 3 files; 90 fail-closed `current_setting('app.…',true)` calls present. (The COALESCE/USING(true) strings exist only in the doc-comment "BANNED shapes" block — confirmed by the comment-stripped grep.) |
| **2** | Probe contextless arm uses **non-bypass** `_rawQuery` + runtime `rolbypassrls=false` assertion exists | `grep -n rolbypassrls\|_rawQuery\|withSuperadmin rls-probe.ts workspace-context.ts` | **PASS** — contextless arm (`rls-probe.ts:247`) calls `runner.rawQuery → _rawQuery`; `_rawQuery` (`workspace-context.ts:127-133`) runs `SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user` and throws hard if true. `withSuperadmin` in the probe appears ONLY at the Decision-Log write (`:331`), not the contextless path. Dead `import().then` block: 0 hits. |
| **3** | `tsc --noEmit` + unit suite clean | `node_modules/.bin/tsc --noEmit` ; `pnpm test` | **PASS** — tsc exit 0, 0 errors. **158 passed / 9 skipped / 0 failed** (6/6 files). Matches both reviewers' captured numbers exactly. |
| **4** | **Mutation proof** of the GREEN predicate (HIGH-1/F3/F5 crux) | flipped `rls-probe.ts:269` `&&`→`||`, ran `probe-verdict.test.ts`, reverted | **PASS** — mutant **fails 3 tests** (was 0 in round 1). Confirms `contextlessCount` is a genuinely live term that can drive RED. Restored cleanly (predicate present, count=1). |
| **5** | 0 legacy files touched + FORCE not flipped | `git status --porcelain \| grep "legacy project"` ; `git diff HEAD~1 HEAD --name-only \| grep "legacy project"` ; `head step-b-force.sql` | **PASS** — 0 legacy files in working tree, staged, or last commit. step-b-force.sql HELD header intact with all 5 HOLD-AT-FORCE pre-conditions. 0 Prisma schema in Brain (DDL structurally un-applicable); 0 runner references to `manual/rls`. |
| **6** | DDL table-set symmetry | comment-stripped counts of ENABLE/FORCE/NO-FORCE/DISABLE + CREATE/DROP POLICY + distinct ALTER TABLE targets | **PASS** — executable: ENABLE 43 = FORCE 43 = NO-FORCE 43 = DISABLE 43; 43 distinct tables each. CREATE POLICY 45 = DROP POLICY 45 (42 `ws_isolation` + 2 `superadmin_system_rows` dual + 1 `superadmin_only`). Fully symmetric → `down.sql` is a clean reversal. (The "44/46" raw counts the reviewers and I first saw were comment-header artifacts; the executable set is symmetric.) |

**I replicated Tanvi's PASS independently** (checks 3, 4, 6 overlap her G5 gates; check 4 is the exact mutation she and Shreya ran). My captured output matches hers — no Stage-5 quality issue.

---

## Over-engineering audit (MANDATORY)

| Check | Finding |
|-------|---------|
| Files staged not in the architect's plan? | **None.** Every file maps to a Track in plan §17: primitive (A), DDL+README (B), probe (C), cron (D), auth (E), runbook (F), tests + index barrel (T), gate amendment (G). The two bounce-fix additions (`docker-compose.test.yml`, `docker/initdb/01-create-rls-app-role.sql`) are *required* by the plan's mandated LOCAL pgbouncer integration test (§10) and the non-BYPASSRLS role it needs — not gold-plating. |
| Observability/metrics/tests beyond plan? | **No.** Probe verdict + cron proof-of-attempt + runbook asserts only; no runtime dashboards (correctly — no runtime). Coverage 90.71% is high but driven by the injectable-runner unit tests the bounce-fix *required* (F4), not speculative tests. |
| Deps beyond plan? | **No.** Only `pg` (planned, justified — cheapest correct client, no premature Prisma) + a dev-only docker-compose for the integration test. No new prod deps. |
| New abstractions "for future use" (Single-Primitive violation)? | **No.** The one new primitive is mandated by the requirement + the Single-Primitive Rule with a one-sentence justification (plan §7). The `ProbeQueryRunner` injectable interface was added to make the probe unit-testable (F4 remediation) — a test seam, not a speculative abstraction. |
| Plan length proportionate? | **Yes.** Long sections are *inherited* contract enumeration (44-table map, CF-* list) + the headline amendment, not new derivation. Re-derivation was explicitly forbidden by synthesis. |
| 30+ line WHAT-not-WHY comments? | **No.** Comments explain WHY (e.g. why tx-local `set_config`, why the contextless arm must be bare, why session-SET is banned). The HOLD-AT-FORCE headers are operational gates, not redundant narration. |

**Over-engineering verdict: CLEAN.** No Child 2–7 scope pulled forward (FK-denorm backfill = design-only; live probe/region-assert/smoke = Stage-8; money/OLAP/connectors/AI all out).

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `apps/core-service/src/infrastructure/db/workspace-context.ts` | **Clean.** `set_config('app.workspace_id',$1,true)` bind-param (line 194); `withWorkspace` clears `is_superadmin='false'` (199), `withSuperadmin` clears `app.workspace_id=''` (247) — symmetric scrub. `_rawQuery` runtime `rolbypassrls` assertion (127-133). Comments are WHY-comments. |
| `apps/core-service/src/infrastructure/db/rls-probe.ts` | **Clean.** Contextless arm genuine (247-250); bi-conditional verdict live (269); hard-RED on rawQuery throw (255-262); `withSuperadmin` confined to the Decision-Log write. No dead code. |
| `apps/core-service/migrations/manual/rls/step-b-force.sql` | **Clean.** HELD header enumerates all 5 HOLD-AT-FORCE pre-conditions incl. the R-O7 "do NOT grep -v backfill/discoverChannels" correction. 43 executable FORCE statements, symmetric with down.sql. |
| `apps/core-service/src/domain/auth/brain-claim.ts` | **Clean.** `requireRole` uses `>=` (load-bearing, line 90); 5-level ordering OWNER(5)…VIEWER(1); claim-mapping only, no new RBAC. Mutation target documented. |
| `apps/core-service/migrations/manual/rls/rollout-runbook.sh` | **Clean.** `set -euo pipefail`; STEP-0 region-assert both URLs via `inet_server_addr()` (not DNS); quiesce at ENABLE (STEP 3) AND FORCE (STEP 5); STEP 5 HELD behind Founder/CTO sign-off; complete bare-write grep mandates including backfill/discoverChannels (R-O7). |

---

## Cost audit

| Field | Value |
|-------|-------|
| **Planned tokens/day** | 0 (paradigm sql; no LLM path) |
| **Simulated daily-tick tokens** | 0 |
| **Variance** | 0% |
| **Within ±20% tolerance?** | Yes |

No LLM call anywhere in the slice; nothing to simulate. ₹0 incremental infra this run (RLS is a property of the existing Postgres; the second session-mode `:5432` client is capped `connection_limit=10`, no new managed service).

---

## Risks remaining (all correctly deferred to Stage-8, none blocking this gate)

- **The FORCE flip itself (STEP 5)** — HELD under HOLD-AT-FORCE; Founder-gated. The structural moment where RLS applies to the owner role; without a context-aware live consumer it is a 0-rows outage. Correctly not run this child.
- **R-O7 residual no-context writers** (backfill / discoverChannels / inner sync libs) — these live in connector sync paths and are **Child-3's** conversion job. The HOLD-AT-FORCE state gates FORCE on their conversion + a *complete* bare-write grep (correcting the legacy DEFECTIVE grep). Carried correctly.
- **MED-2: probe Decision-Log `user_id` sentinel FK** (`00000000-…-001`) may fail the INSERT at Stage-8 if no such `users` row exists. Non-blocking this child (no live write). Must be verified before the Stage-8 live probe run.
- **FK-scope live EXPLAIN gate** — per-table cost decision (hot tables → `workspace_id` denorm); a Stage-8 pre-step, design-only this run.
- **CF-SEC-3.HARD re-arm** — satisfied this run (Founder owns Sugandh Lok, no live PII processed). **Re-arms before any third-party-brand PII** — carried verbatim; must be live before Child-3 onboards a non-Founder brand.

---

## Deploy-gate ledger for Stage 8 (@jatin — the live predicates that remain HELD/deferred)

> Everything below is **deferred-live with a concrete predicate**, not hand-waved. The runbook (`rollout-runbook.sh`) is the executable form. The FORCE flip is **Founder-gated (HOLD-AT-FORCE)**.

| # | Stage-8 live predicate | Where it lives | Gate |
|---|------------------------|----------------|------|
| 1 | **Region assert `ap-south-1` on BOTH URLs** (`:6543` pooled + `:5432` direct) via `inet_server_addr()` Postgres-level, same-backend cross-check | runbook STEP 0 (CF-RES-1.a) | HALT if either URL not ap-south-1 |
| 2 | **Quiesce crons** before ENABLE *and* again before FORCE | runbook STEP 1 + STEP 5 re-confirm (CF-C1-ROLLOUT-ORDER-1 sharpened) | operator confirm |
| 3 | **ENABLE + CREATE** fail-closed policies (additive; owner still bypasses) | runbook STEP 3 → `step-a-enable-create.sql` | manual psql only |
| 4 | **Live CF-SEC-1 probe GREEN** (cross-read=0 AND contextless=0 per table) **on a non-bypass role** | runbook STEP 4 → `runRlsProbe` | GREEN-or-HALT (probe RED blocks FORCE) |
| 5 | **FK-scope live EXPLAIN gate** per hot table | runbook STEP-3 pre-step | per-table decision (denorm if slow) |
| 6 | **Complete bare-write grep = ZERO hits** (must include backfill/discoverChannels — R-O7) | runbook STEP-5 prerequisite | ZERO-or-HOLD |
| 7 | **Child-3 residual-writer conversion** complete (context-aware live consumer, or proven 100% service-role) | HOLD-AT-FORCE condition (i)+(ii) | cross-child gate |
| 8 | **FORCE flip** (`step-b-force.sql`, 43 tables) | runbook STEP 5 — **HELD** | **Founder + CTO-Advisor sign-off (HOLD-AT-FORCE)** |
| 9 | **Byte-identical live smoke** + re-probe post-FORCE | runbook STEP 6 (CF-C1-ZERO-BEHAVIOR-1) | corpus parity-or-rollback (`down.sql`) |
| 10 | **CF-SEC-3.HARD re-arm** before any third-party-brand PII | carried constraint (state + plan §11) | must be live before Child-3 non-Founder brand |
| 11 | **MED-2 sentinel `user_id` FK** existence verified | probe Decision-Log write | verify-or-relax-FK before live probe |

Rollback for the eventual FORCE = `down.sql` (DDL: `NO FORCE → DISABLE → DROP POLICY`), not a feature flag. This run applies nothing live → trivially reversible.

---

## Standing rules confirmed

- **No commit happened.** I did not commit; the Founder owns commit. `git status` clean on the feature branch; the dev report's "Proposed commit message" is a *proposal* for the Founder, not an executed commit.
- **Feature-branch only.** Current branch `feature/feat-tenancy-auth-rls-hardening` (the epic feature branch); no push/merge to development/release/master.
- **CF-BN-NOLEGACY-1.** 0 files under `legacy project/` touched (re-verified by me, check #5).

---

## Production-readiness assessment

> Would Jatin's pre-deploy gates pass right now?

For **what this child ships** (Brain code + authored DDL + runbook, FORCE deferred): **yes** — tsc clean, 158 unit + 9 integration tests pass, coverage ≥70% all metrics, 0 CRITICAL/HIGH from both VETO reviewers, fail-closed DDL verified, no legacy touched, FORCE held. The deliverable is at the SATISFIABLE state the requirement asked for.

For the **eventual live FORCE** (Stage-8): **correctly NOT ready yet, by design** — gated behind the 11-item ledger above, the most load-bearing being Child-3's residual-writer conversion. The runbook is the executable gate; the HOLD-AT-FORCE state makes "satisfiable but not flipped" honest and machine-checkable. This is the right boundary for a child-sized slice when no Brain runtime exists.

---

## Recommendation to Founder

**APPROVE**

### Founder briefing (one paragraph)

> This is the Brain-native rebuild of the universal C5 tenant-isolation hard gate, and it is clean. It delivers the session-context primitive, the 43-table fail-closed RLS DDL, the verification probe, the auth-claim, the cron session-scoping, and the deploy runbook — all as new Brain code in `core-service`, mining the proven legacy logic without importing a line of legacy. Crucially, it does **not** flip RLS live on the shared production DB: there is no Brain runtime yet to hold workspace context, and forcing RLS without one would cause a 0-rows outage (not a leak), so the live FORCE is deferred to Stage-8 behind a Founder-gated HOLD-AT-FORCE state — the same discipline you already ratified on the legacy sibling. The one act I countersign at the architecture-governance level is the gate-language amendment to the binding Child-0 spike (RLS "live" → "satisfiable Brain-native + FORCE deferred"), which I verified landed correctly, is decision-logged, and is reflected in state so Child-2's dependency check reads the real criterion instead of a ghost. The work bounced once (the probe's fail-closed verification arm was inert and the integration test ran on a privileged role that bypasses RLS — a serious-but-caught defect), and the fix is genuine: I independently re-ran the mutation test (the GREEN predicate now fails 3 tests when broken; it failed 0 before) and confirmed the probe now runs on a non-privileged role. Zero compliance issues (DPDP §8(6) isolation is the point; no live PII processed; residency ap-south-1 asserted at Stage-8). Approving advances this to Stage-8 deploy prep where the live FORCE remains held for your explicit go.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T17:10:00Z",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "feat-tenancy-rls-brain-native",
  "verdict": "PASS",
  "recommendation": "APPROVE",
  "gate_amendment_signed": true,
  "gate_amendment_ref": "decision-log architecture-gate-amendment 2026-05-24T15:00:00Z (Track G); Child-0 06-architecture-plan.md A2.1+A2.2 lines 497-506",
  "independent_reverifications": [
    "executable-DDL fail-open grep = 0/0/0/0",
    "probe contextless arm = genuine _rawQuery + rolbypassrls assertion; withSuperadmin confined to Decision-Log",
    "tsc 0 errors; 158 pass / 9 skip / 0 fail (matches reviewers)",
    "mutation &&->|| fails 3 tests (was 0 round-1) — reverted",
    "0 legacy files touched; step-b-force HELD; 0 prisma schema",
    "DDL symmetry: ENABLE 43 = FORCE 43 = NO-FORCE 43 = DISABLE 43; CREATE POLICY 45 = DROP POLICY 45"
  ],
  "over_engineering_audit": "CLEAN",
  "security_rereview": "PASS (Shreya 08c)",
  "qa_rereview": "PASS (Tanvi 09b)",
  "force_NOT_run_this_child": true,
  "c5_gate_state": "SATISFIABLE",
  "no_commit": true,
  "feature_branch_only": true,
  "next_stage": "founder-gate (Stage 7)",
  "next_agent": "founder"
}
```
