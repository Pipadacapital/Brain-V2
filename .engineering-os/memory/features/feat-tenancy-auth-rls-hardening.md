# Feature journal — feat-tenancy-auth-rls-hardening

> Child 1 of EPIC chore-migrate-legacy-to-brain. First code-moving strangler-fig slice: establish RLS + session-scoped tenant context + Brain auth/role-claim on the LIVE shared Supabase Postgres (ap-south-1) without downtime/leak. Establishes the universal C5 hard gate (G1 RLS-live + G2 cron-session-scoped) every later slice depends on.

## Stage 1 — 2026-05-24T07:27:27Z — Rohan (cto-advisor)

**Decision:** ADVANCE (2 personas requested → synthesis pending).

**Scope:** split inside one requirement — **1a** data-layer isolation (RLS on all workspace-scoped tables incl. ~24 FK-transitively-scoped; `SET LOCAL app.workspace_id` correct under pgbouncer txn-pool; cron fan-out session-scoped; CF-SEC-1 fail-closed RLS-probe GREEN predicate) = the C5-gate-establishing unit, ships first, additive+reversible; **1b** Brain auth/role-claim contract (map existing Supabase JWT + 5-level WorkspaceRole) behind 1a.

**Lane:** high-stakes — auth, multi-tenancy, pii, india-compliance, schema-proto, connectors.

**Ground truth that shaped the call:** 45 models / 66 workspaceId refs / 0 RLS; ~21 direct-scoped vs ~24 FK-transitive (the RLS design problem); cron cross-workspace findMany (cron.ts:65,148 + syncAll{Shiprocket,MetaAds,GoogleAds}); singleton PrismaClient over pgbouncer txn-mode (:6543) = SET LOCAL footgun; WorkspaceRole already 5-level so 1b is claim-mapping not invention.

**Personas (2):** live-rls-rollout-safety-realist (engineering) + india-data-isolation-compliance-officer (compliance). Declined ai-cost-realist + generic-architecture.

**Binding contract:** inherited CF-RES-1/CF-SEC-1/CF-SEC-3/CF-SEC-5/CF-SEC-SECRETS-1 + new CF-C1-POOL-1, CF-C1-RLS-DEFAULT-1, CF-C1-FK-SCOPE-1, CF-C1-ZERO-BEHAVIOR-1, CF-C1-CRON-SCOPE-1, CF-C1-AUDITLOG-1.

**Paradigm:** SQL/DDL + connection-handling (no ML/LLM).

**Artifact:** `02-cto-advisor-review.md`. **Next:** personas (03/04) → Rohan synthesis → Architect (Aryan, Stage 2).

## Stage 1 (synthesis) — 2026-05-24T07:34:19Z — Rohan (cto-advisor)

**Decision:** ADVANCE -> Architect (Aryan) Stage 2. Personas 2/2 synthesized; 10 concerns folded (2 CRIT / 6 HIGH / 2 MED), none dropped.

**Both personas accepted** (each >=1 genuine concern, in lane, complementary): rollout-safety realist (engineering) attacked SET LOCAL × pgbouncer txn-pool, FORCE-RLS ordering, FK-transitive policy cost, fail-closed NULL-trap, cron data-loss; compliance officer attacked the partial-RLS quiesce-ordering DPDP §8(6) window, the missing DPA/§7 lawful basis, Postgres-level region assertion on both URLs, AuditLog dual-policy, ShopifyCustomer-PII-at-Child-1.

**Contract hardened:** 6 sharpened (CF-C1-POOL-1.a, CF-C1-FK-SCOPE-1.a, CF-C1-RLS-DEFAULT-1.a, CF-C1-CRON-SCOPE-1.a, CF-RES-1.a, CF-C1-AUDITLOG-1.a) + 3 new (CF-C1-ROLLOUT-ORDER-1, CF-C1-QUIESCE-1, CF-C1-PII-REGISTER-1). The two CRITICALs + two ordering-HIGHs converge into ONE binding harness-asserted 1a rollout sequence: region-assert(both URLs) -> quiesce-crons-first -> deploy context-code -> ENABLE+CREATE fail-closed policy -> CF-SEC-1 probe GREEN -> FORCE per table -> smoke; G1+G2 flip GREEN together; FORCE-rollback is a DDL not a flag; FK-scope live EXPLAIN is a pre-step.

**ESCALATED NOW — DPDP §4/§7 PII lawful basis.** No DPA / §7 memo / consent columns exist on record; CF-SEC-1 probe (Invitation.email) + any ShopifyCustomer denorm backfill are §4 processing acts at Child 1. Distinct from the residency tripwire (a fact the spike resolved) — this is a missing legal instrument only the Founder can supply, gating Stage 3. CF-SEC-3 -> CF-SEC-3.HARD. Mirrored to pending-founder-attention.md. build_gated_on = lawful-basis instrument before Stage 3.

**Maya (Stage 2):** NOT needed — pure RLS/DDL + connection-handling + JWT-claim mapping; no metric/money/AI/numeric-parity dimension.

**Artifact:** `05-stage1-synthesis.md`. **Next:** Architect (Aryan), Stage 2 (proceeds now); Stage 3 gated on the instrument.

## Stage 2 (architecture) — 2026-05-24T07:43:15Z — Aryan (architect)

**Decision:** Plan PRODUCED + build-ready, but **Stage-3 build HARD-GATED on CF-SEC-3.HARD** (DPDP lawful-basis instrument — DPA or §7 memo — not yet on record). DESIGN ONLY: zero live data touched, zero legacy/product code edited (git status = only .engineering-os/**).

**Artifact:** `06-architecture-plan.md` (18 sections + folded handoff).

**Paradigm:** SQL/DDL + connection-handling (no ML/LLM). No Maya co-owner needed.

**Scope:** 1a data-layer isolation (the C5 gate, ships first, reversible) -> 1b auth/role-claim. 1a independently committable with gate GREEN before 1b.

**Settled design decisions (do not relitigate — amend via Aryan):**
- **Pooling (CF-C1-POOL-1.a):** `rlsPrisma` second PrismaClient on `DIRECT_URL` :5432 session-mode + tx-local `set_config('app.workspace_id',$1,true)` inside explicit `$transaction` via `withWorkspace()`. Session-level SET banned; bind-param kills injection. Legacy singleton (:6543) stays for global/unprotected + un-migrated paths.
- **FK-scope (CF-C1-FK-SCOPE-1.a):** all 45 models classified (21 direct / ~18 connId-FK 1-hop / WoocommerceLineItem orderId-FK 2-hop / 4 global). Default JOIN-policy + per-table live `EXPLAIN(ANALYZE,BUFFERS)` decision-gate; escalate hot `shopify_orders`/`shopify_line_items` to `workspace_id` denorm via additive col + chunked(5000) online backfill + CONCURRENTLY index + IS-NULL=0 verify. Zero workspace-scoped table unprotected.
- **Fail-closed (CF-C1-RLS-DEFAULT-1.a):** `USING`/`WITH CHECK` = `(col = current_setting('app.workspace_id',true)::uuid)` -> 0 rows when unset. Banned: `OR ... IS NULL`, `COALESCE`, `USING(true)`, session-SET, bare-singleton RLS query. CF-SEC-1 probe RED-by-default -> GREEN on cross-read=0 AND contextless=0 per table; Decision-Log transition.
- **Rollout sequence (CF-C1-ROLLOUT-ORDER-1 + QUIESCE-1 + RES-1.a):** STEP0 region-assert BOTH URLs -> STEP1 quiesce-crons-FIRST -> STEP2 context-code -> STEP3 ENABLE+CREATE policy -> STEP4 probe GREEN -> STEP5 FORCE per table -> STEP6 byte-identical smoke + cron tick. **G1+G2 GREEN together, one deploy.** Rollback = `NO FORCE`+`DISABLE`+`DROP POLICY` (DDL, corrects A4 Child-1).
- **Cron (CF-C1-CRON-SCOPE-1.a):** wrap each `syncAll*` per-connection unit in `withWorkspace(c.workspaceId)`; outer enumeration under `withSuperadmin`; preserve per-connection try/catch + proof-of-attempt log; Shiprocket no-replay -> attempted-vs-connected alarm.
- **AuditLog (CF-C1-AUDITLOG-1.a):** dual-policy (ws-scoped + SUPERADMIN-only `app.is_superadmin` for null rows) + §12 erasure under `withSuperadmin` userId-only; compatible with deferred Child-5 sentinel.

**Ground-truth find that strengthened CF-RES-1.a:** `legacy project/backend/.env.bak.singapore` shows the DB was previously in `ap-southeast-1` (Singapore) — a region move ACTUALLY happened. Region must be live-asserted on BOTH :6543 + :5432, never trusted.

**10/10 persona concerns homed** (R1-R5 engineering; C1-C5 compliance) — see plan §§2b,3,4,5,6,7,11,12.

**Tracks (all BLOCKED on CF-SEC-3.HARD):** 1a-A..1a-F + 1b -> @vikram (1a-F exec @jatin Stage 8). No frontend (@ananya not needed). No new service -> no deploy-pipeline track (runbook is the deploy artifact).

**Next:** Orchestrator STOP after Stage 2 + surface to Founder (escalation in pending-founder-attention.md). Stage-3 @vikram only after Founder supplies the instrument + lifts the gate.

## Stage 3 (build) — 2026-05-24T08:26:13Z — Vikram (backend-developer)

**Gate lifted:** Founder authorized build on ownership grounds (Sugandh Lok own-brand data); formal governance to chore-security-governance-hardening-phase.

**Build complete.** 17 files staged across 7 tracks. All locally-runnable tests pass (26 tests, 0 fail). Live-DB tests deferred to Stage-5 (Tanvi) and Stage-8 (Jatin).

**Tracks completed:**
- **1a-A:** `src/lib/rls-prisma.ts` — rlsPrisma (DIRECT_URL :5432 session-mode, connection_limit=10), withWorkspace (tx-local set_config + AS context scrub), withSuperadmin, correlationStore (AsyncLocalStorage 4-tuple). CF-C1-POOL-1.a.
- **1a-B:** `src/middleware/workspace.ts` updated — assembles BrainClaim, seeds correlationStore 4-tuple (CF-SEC-5). `src/types/express.d.ts` updated with `claim?: BrainClaim`. `src/lib/brain-claim.ts` — assembleClaim(), requireRole(), assertRole(). CF-SEC-5.
- **1a-C:** `prisma/migrations/20260524_rls_hardening/` — step-a-enable-create.sql (44 tables), step-b-force.sql, up.sql, down.sql. All USING/WITH CHECK use sanctioned shapes; no banned patterns; AuditLog dual-policy; Notifications dual-policy; SystemSettings SUPERADMIN-only. CF-C1-RLS-DEFAULT-1.a, CF-C1-AUDITLOG-1.a.
- **1a-D:** `src/lib/rls-probe.ts` — per-table cross-read + context-less probe, RED-by-default GREEN predicate, Decision-Log write via withSuperadmin. CF-SEC-1.
- **1a-E:** `src/routes/cron.ts`, `src/lib/integrations/{shiprocket,meta,google}-sync.ts` — outer enumeration under withSuperadmin, per-connection sync under withWorkspace(c.workspaceId), per-connection try/catch preserved, proof-of-attempt logging, attempted-vs-connected alarm. CF-C1-CRON-SCOPE-1.a.
- **1a-F:** `scripts/rollout-runbook.sh` — 6-step harness (region-assert both URLs, quiesce-assert, context-code verify, ENABLE+CREATE via psql, probe GREEN, FORCE, smoke + re-probe). Rollback section included. CF-C1-ROLLOUT-ORDER-1, CF-C1-QUIESCE-1, CF-RES-1.a.
- **1b:** `src/lib/brain-claim.ts` — WorkspaceRole 5-level ordering, assembleClaim, requireRole/assertRole. `src/middleware/workspace.ts` — claim assembly + correlationStore seed. No re-login storm. CF auth/role-claim contract.

**Key decisions (within-authority):**
- Notifications model has nullable workspace_id (same as AuditLog) — applied dual-policy (ws_isolation + superadmin_system_rows) rather than plain policy; not in the plan's explicit list but follows the AuditLog dual-policy principle for any nullable-workspace_id table.
- withSuperadmin must be used for cron outer enumeration because all connection tables (ShopifyConnection, ShiprocketConnection, etc.) are Group A — after FORCE RLS, unscoped findMany returns 0 rows.
- The existing `prisma` singleton used inside syncShiprocketForConnection/etc. (inner sync functions) is correct for now — those functions use the singleton for writes that go through the service role which bypasses RLS until FORCE is applied. After FORCE, the inner sync functions will need their own withWorkspace wrapping (tracked for Child 3/connector framework migration).
- `legacy project/` is gitignored at root; force-added specific product code files only.

**Deferred to Stage 8 (Jatin) — live-DB steps:**
- FK-scope live EXPLAIN gate (CF-C1-FK-SCOPE-1.a) — pre-step before STEP 3 in runbook
- ShopifyCustomer/shopify_orders denorm backfill (if EXPLAIN fails) — §3c
- CF-SEC-1 probe live run (STEP 4 in runbook)
- Region assert live verification (STEP 0)
- Byte-identical API corpus smoke (STEP 6)

**Deferred to Stage 5 (Tanvi) — QA gates:**
- Interleaved-tenant pooling test on :6543 + :5432 (CF-C1-POOL-1.a)
- Fail-closed default test (context-less → 0 rows)
- Cron isolation + proof-of-attempt live test
- AuditLog dual-policy + erasure test
- Static SQL review (banned patterns, FORCE on every A/B/C table)
- 4-tuple presence on all new runtime paths

**Tests run + passed:** brain-claim (7/7), rls-policy-shapes (13/13), cron-scope (6/6). Total: 26/26.
**Secret hygiene:** CLEAN. No credential values in staged files.
**Handoff:** ADVANCE — parallel Security (Shreya) + QA (Tanvi) review (high-stakes lane).

## 2026-05-24T09:08:58Z — Security RE-REVIEW (round 2) — Shreya — PASS
- **Delta scope:** bounce-fix 07b (F1/M1 tx-threading) + typefix 07c (PrismaTx=Prisma.TransactionClient + 5 route-handler withWorkspace wraps).
- **F1/M1:** CONFIRMED resolved at code level. Grep proof: cron.ts, meta-sync.ts, google-sync.ts = ZERO bare-prisma writes; shiprocket-sync cron path fully tx-threaded. 37/37 tests pass (incl. 8 negative WITH-CHECK simulations).
- **5 route handlers (ads/google/meta/shiprocket):** SAFE. Each wrap = withWorkspace(validated workspaceId, (tx)=>sync(...,tx)); workspaceId == the id requireWorkspaceAdmin authorized; no withSuperadmin misuse; no wrong-id source; UUID guard active. meta.ts /sync fire-and-forget (void) is intentional + documented.
- **NEW M3 (MEDIUM, tracked, non-blocking, NOT a regression):** /api/integrations/* use requireAuth only and skip the correlation-seeding middleware (workspace.ts); on those paths withWorkspace binds workspaceId but requestId/traceId degrade to sentinel 'unset'. Pre-existing in the ported routes; tx-wrap delta did not introduce it. Pin: route-migration phase must mount correlation seeding (or requireWorkspace) on /api/integrations/* before FORCE-era prod traffic.
- **Residual bare writes (carry M1 hard-gate):** shiprocket backfill (courier/pincode) + discoverChannels (shiprocket-sync.ts) + cron recompute (cron.ts:249, _tx discarded) + unstaged Shopify inner sync libs still write via bare prisma — but run with NO workspace context (outside withWorkspace) ⇒ post-FORCE fail-CLOSED (enrichment/recompute outage), NOT fail-open. Same blocking-predecessor-before-FORCE on Child-3 + Stage-8 runbook STEP-5.
- **Fail-closed RLS:** intact (no NULL-trap in executable policy; only comment lines). **Secret hygiene:** CLEAN; .env not staged. **No DDL auto-applies** (FORCE is Stage-8/runbook-gated).
- **Verdict:** PASS. Returned to orchestrator (parallel mode); did NOT advance — Tanvi concurrent.

---

## Stage 6 — CTO Final Review (Rohan) — 2026-05-24T07:48:00Z

**Verdict: PASS → Founder gate (Stage 7). Recommendation: APPROVE.**

**Plan-binding:** OK. All 11 binding constraints satisfied in code or legitimately deferred-live to Stage 8 with concrete predicates. 1a independently committable + reversible; 1b ships behind it (no DDL).

**4 independent re-verifications (replicated reviewers' PASS with captured output):**
1. Fail-open NULL-trap ABSENT — 0 `IS NULL`/`COALESCE`/`USING(true)` in executable SQL; 90 `current_setting` all `missing_ok=true` (fail-closed); 43 distinct tables ENABLE+POLICY+FORCE reconciled (no lockout); down.sql full symmetry.
2. Secrets/.env clean in staged product diff.
3. F1 fix confirmed — cron paths 0 bare writes; 8 residuals confined to non-cron `discoverChannels`/`backfill*` (fail-CLOSED post-FORCE).
4. `node --test` 37/37 exit 0 + `tsc --noEmit` exit 0 — replicated.

**Over-engineering audit:** CLEAN. `notifications` dual-policy = within-authority correctness (not gold-plating). No out-of-plan files, no new deps, no Child 2-6 scope pulled forward.

**Deploy-gate ledger handed to Stage 8 (BINDING — see 10-cto-final-review.md §4):**
- **§4.A CRITICAL:** runbook STEP-5 prerequisite grep is DEFECTIVE (excludes `backfill`/`discoverChannels`). Corrected complete grep + conversion list bound before any FORCE: `discoverChannels`, `backfillShiprocketCourierNames`/`Pincodes`, shiprocket `/connect`+`/select-channels`, `cron.ts:249` recompute, `meta.ts:192` catch, unstaged Shopify sync libs (Child 3).
- **§4.B M3:** trace-ID seeding on `/api/integrations/*` before FORCE-era prod traffic.
- **§4.C:** Stage-8 live predicates — FK EXPLAIN, CF-SEC-1 probe (non-owner role), region-assert both URLs, quiesce, byte-identical smoke.
- **§4.D:** CF-SEC-3.HARD re-arms for third-party-brand PII at Child 3.

**Doc nit (retro):** "44 tables" in reports vs 43 distinct executable. Cosmetic; runbook asserts `POLICY_COUNT>=43`.

**Artifact:** `10-cto-final-review.md`. No code committed (Founder Stage-7 gate owns commit).

---

## 2026-05-24 — Founder directive: UNTRACK legacy implementation → rebuild Brain-native

**Decision (Founder):** Child 1's deliverable was implemented entirely **inside the legacy Express/Prisma backend** (22 files, deliberately force-added past `.gitignore`). Founder reaffirmed the legacy codebase is **reference-only** and must not sit on the active architecture path. Chose **"untrack & rebuild Brain-native"** over keeping the fix or re-homing it — with the open-P0 tradeoff stated explicitly.

**Action taken:** `git rm -r --cached "legacy project/"` — all 22 tracked files removed from the index, kept on disk as gitignored reference. Forward commit only; **no history rewrite** (`2580ba5` stays in history). Verified beforehand: zero Brain-native coupling, legacy not in pnpm/turbo workspace.

**Consequence — OPEN P0 (mirrored to pending-founder-attention.md):** the live shared Supabase Postgres still has **0 RLS** (45 models / 66 workspaceId refs). The reviewed fix was never deployed (was at Stage 8 awaiting commit) and is now untracked. **Tenant-isolation hole remains open in production** until a Brain-native RLS slice is built and shipped.

**Status:** this requirement's *legacy* implementation is **WITHDRAWN**. Tenant-isolation work to be **re-scoped Brain-native** via a new requirement; Rohan to amend the Child 0 strangler-fig plan so no future slice implements into legacy. RLS *design* (policy shapes, FK-scope map, runbook, cron scoping) preserved on disk as migration reference.

## Stage 3 bounce-fix — 2026-05-25T14:00:00Z — Vikram (backend-developer)

**req_id:** feat-ai-engine-intelligence (Child 5) | **bounce:** C5-SEC-003 HIGH traceability VETO

**Fix:** C5-SEC-003 traceability VETO resolved. Correlation quad (request_id + trace_id + workspace_id + actor_id) added to GatewayRequest (pinned contract — Maya populates call-sites), propagated into both _write_decision_log paths (synthesis in client.py + dropped-tool in graduation_middleware.py), and persisted as 3 new columns in ai.decision_log. OTel trace_id bound from active span at gateway entry. request_id surfaced on error responses (cap exceeded, faithfulness failure). Audit write failures now raise (not swallowed). assert_india_residency() wired into bootstrap.run_startup_assertions() (C5-SEC-005). Per-call cap check made non-vacuous via requested_fraction_bp param (C5-SEC-008). 5 VETO gate logic unchanged.

**Tests:** 154 intelligence-service unit + 14 brain_cost_router = 168 passing. 332 baselines = 0 regressions. 500 total, 0 failures.

**Status:** READY-FOR-SECURITY (round-2 Shreya + Tanvi)
