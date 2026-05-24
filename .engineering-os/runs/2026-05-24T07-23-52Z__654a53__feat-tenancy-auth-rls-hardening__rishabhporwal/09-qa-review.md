# QA Review — feat-tenancy-auth-rls-hardening (Child 1)
**Author:** Tanvi (qa-agent)
**Stage:** 5 (PARALLEL REVIEW MODE — concurrent with Shreya/Security)
**Timestamp (UTC):** 2026-05-24T09:15:00Z
**Verdict:** BOUNCE

---

## Stage 4 Skip Acknowledgment

Secrets grep on staged diff (`git diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'`):

Hits found and reviewed:
- `shiprocketApiPassword` / `apiPassword` / `apiEmail` / `apiUserToken` — product field names in shiprocket-sync.ts, reading from DB columns, no literal credential values
- `cron-secret` / `requireCronSecret` / `CRON_SECRET` — env var name references only; no literal value
- `Bearer token` — comment in express.d.ts type annotation; no literal value
- `secret_hygiene` — metadata field in decision-log/state JSON; no literal value
- `CF-SEC-SECRETS-1` — constraint name references; no literal value

Narrowed grep for actual credential strings (`sk-[a-zA-Z0-9]{20,}|ghp_|shpss_|GOCSPX-|aws_secret|aws_access_key`): **CLEAN — zero hits.**

No `.env` files staged (confirmed). **Stage 4 skip acknowledgment: secrets hygiene CLEAN.**

---

## 1. Actual Test Run Output

### brain-claim.test.mjs
```
TAP version 13
# tests 7
# suites 3
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 37.559
```
Suites: `assembleClaim` (3 tests), `requireRole level-ordered guard` (3 tests), `Role level ordering` (1 test).

### rls-policy-shapes.test.mjs
```
TAP version 13
# tests 13
# suites 7
# pass 13
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 42.876958
```
Suites: banned USING patterns (3), banned WITH CHECK patterns (1), sanctioned shapes (3), FORCE coverage (1), rollback coverage (2), fail-closed proof (2), 4-tuple structure (1).

### cron-scope.test.mjs
```
TAP version 13
# tests 6
# suites 3
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 36.55
```
Suites: per-connection error isolation (3), silent-skip alarm (2), proof-of-attempt log fields (1).

**Total: 26/26 PASS. Claimed count confirmed.**

---

## 2. Coverage Matrix — Positive AND Negative per Behavior

| Behavior | Positive test? | Negative test? | Gap? |
|---|---|---|---|
| Brain claim assembly (OWNER level) | YES (brain-claim.test #1) | — | n/a — pure data assembly |
| Brain claim assembly (VIEWER level) | YES (brain-claim.test #2) | — | n/a |
| SUPERADMIN systemRole preserved | YES (brain-claim.test #3) | — | n/a |
| requireRole — OWNER satisfies all roles | YES (#4) | — | n/a |
| requireRole — VIEWER denied all higher roles | YES (negative: fails ANALYST/MANAGER/ADMIN/OWNER) | YES | COVERED |
| requireRole — MANAGER boundary | YES / YES (boundary is a negative test) | YES | COVERED |
| Role level ordering invariant | YES (#7) | — | n/a |
| USING clause: no OR IS NULL banned pattern | — | YES (#8) | COVERED |
| USING clause: no COALESCE banned pattern | — | YES (#9) | COVERED |
| USING clause: no bare true | — | YES (#10) | COVERED |
| WITH CHECK: no OR IS NULL | — | YES (#11) | COVERED |
| Sanctioned current_setting or is_superadmin shape | YES (#12) | — | partial |
| Direct table ::uuid cast present (>=22 occurrences) | YES (#13) | — | n/a |
| USING count == WITH CHECK count (write protection) | YES (#14) | — | n/a |
| FORCE RLS all 44 expected tables | YES (#15, all 44 named) | — | n/a |
| Rollback: NO FORCE+DISABLE+DROP for audit_logs | YES (#16) | — | n/a |
| Rollback: NO FORCE+DISABLE+DROP for shopify_orders | YES (#17) | — | n/a |
| Fail-closed proof: NULL context → row excluded | YES (sim positive: ALPHA sees own) | YES (null context → null, excluded) | COVERED |
| Fail-closed proof: empty string context | — | YES (empty string ≠ any UUID) | COVERED |
| withSuperadmin context: tenant policy excludes | YES | YES | COVERED |
| withSuperadmin context: superadmin policy includes | YES | YES | COVERED |
| Correlation 4-tuple has required fields | YES (#24) | — | partial — see F2 below |
| Cron: middle failure doesn't block others | YES | YES (#25, simulated failure) | COVERED |
| Cron: per-connection workspace context | YES (#26) | — | partial — see F3 |
| Cron: proof-of-attempt for all connections | YES (#27, including failures) | — | COVERED |
| Cron: no alarm when attempted == total | YES (#28) | — | n/a |
| Cron: alarm fires when attempted < total | — | YES (#29, direct logic) | COVERED |
| Cron: log carries connectionId/workspaceId/status | YES (#30) | — | n/a |
| **context-UNSET → ZERO rows (fail-closed negative — the Founder bar critical case)** | YES (sim) | YES (sim, NULL semantics) | **SIMULATION ONLY — no real DB test; deferred correctly to Stage 8 with concrete predicate** |
| **cross-tenant attempt → denied (BETA cannot see ALPHA rows)** | — | **NO real test; probe deferred to Stage 8** | **DEFERRED — concrete predicate specified** |
| **wrong/missing role → requireRole returns false** | YES (VIEWER tests) | YES | COVERED |
| **cron per-connection isolation: one-failure-doesn't-block** | YES | YES | COVERED |
| **AuditLog dual-policy: tenant cannot see null-workspace rows** | YES (sim logic) | YES (sim) | **SIMULATION ONLY — no real DB test; deferred to Stage 8 with concrete predicate** |
| **Inner sync writes on RLS-protected tables via bare :6543 after FORCE** | — | **NO test — not even deferred predicate** | **CRITICAL GAP — see F1** |

---

## 3. Founder Bar — Clean Code + Positive/Negative Coverage

### Test clarity
Tests are clearly named, well-structured with arrange/act/assert, and each covers one behavior. `brain-claim.test.mjs` and `cron-scope.test.mjs` are self-explanatory. `rls-policy-shapes.test.mjs` is thorough on static SQL checks. **PASS — test clarity is good.**

### Code clarity
`rls-prisma.ts`, `brain-claim.ts`, `workspace.ts` are clean and well-commented. Each design decision (why :5432, why tx-local, why `set_config` over `SET LOCAL`) is inline-documented. **PASS — code is easy to read and debug.**

### Positive AND negative coverage per behavior
- The isolation negative cases (cross-tenant read denied, context-unset = 0 rows) are correctly tested in simulation for the pure-logic layer. The deferred live-DB tests each have a concrete runnable predicate. **MEETS the deferred test bar.**
- One coverage gap is not a deferral issue — it is an untested behavior hole (see F1).

**Founder bar for coverage: PARTIALLY MET — conditional on resolving F1.**

---

## 4. Acceptance-Predicate Completeness for Deferred Live-DB Gates

Each deferred gate was checked against the arch plan (§10) and the runbook (§5).

| Deferred Gate | Concrete predicate? | Where specified |
|---|---|---|
| CF-C1-POOL-1.a: interleaved-tenant pooling | YES — three-part predicate: (i) :6543 session-SET bleed → 0 rows, (ii) context-less → 0, (iii) :5432 withWorkspace interleave isolated | Arch plan §2b + build report §7.1 |
| CF-C1-RLS-DEFAULT-1.a: fail-closed default | YES — `SET app.workspace_id=''`/unset → `COUNT(*) shopify_orders` = 0 | Arch plan §4b + build report §7.2 |
| CF-SEC-1 probe live run | YES — `runRlsProbe({alphaWorkspaceId, betaWorkspaceId})` returns `overallVerdict='GREEN'`; Decision-Log row written | arch plan §4c + runbook STEP 4 |
| FK-scope live EXPLAIN gate | YES — index scan (not seqscan/nested-loop) per table; or denorm used directly | Arch plan §3b + runbook STEP 3 pre-step |
| CF-C1-CRON-SCOPE-1.a: live cron tick | YES — B sees only B's shipments; B failure doesn't block C; every CONNECTED connection logs | Arch plan §6 + build report §7.5 |
| CF-C1-AUDITLOG-1.a: dual-policy + erasure | YES — workspace DELETE can't reach null rows; SUPERADMIN erasure can; tenant never sees system row | Arch plan §7 + build report §7.6 |
| CF-RES-1.a: region assert both URLs | YES — Postgres-level ap-south-1 on :6543 AND :5432; non-zero exit on fail | Runbook STEP 0 |
| CF-C1-ZERO-BEHAVIOR-1: byte-identical corpus | YES — fixed per-workspace corpus vs pre-rollout baseline; runbook STEP 6 | Runbook STEP 6 |
| 4-tuple presence in real network path | YES — every new runtime path emits 4-tuple | Arch plan §9; already covered by ALS wiring |

**Verdict: deferral predicates are CONCRETE, not hand-waved. This gate PASSES.**

---

## 5. The Deferred Inner-Sync-Writes Gap (Critical Finding)

This is the most material QA finding and the reason for BOUNCE.

**Finding F1 (BOUNCE-level):** The cron refactor wraps each per-connection sync in `withWorkspace(c.workspaceId, ...)` on `rlsPrisma` (:5432 session-mode). However, the inner sync functions (`syncShiprocketForConnection`, `syncMetaAdsForConnection`, `syncGoogleAdsForConnection`, the Shopify sync functions) execute their actual DB **writes** on the bare singleton `prisma` client (:6543 transaction-mode). After FORCE RLS is applied (STEP 5 in the runbook), the Postgres table owner role still has RLS enforced — and the bare `:6543` client operating as those functions does will be subject to RLS. The `withWorkspace` wrapper sets `app.workspace_id` tx-locally on `rlsPrisma`'s transaction, but the writes inside the inner sync functions run on a **separate** `:6543` connection that has NO `app.workspace_id` set. Under FORCE RLS, those writes will fail with `0 rows affected` on `WITH CHECK` rejection, or throw a Postgres error depending on the operation.

Specific instances confirmed in the staged code:
- `src/lib/integrations/shiprocket-sync.ts`: `prisma.shiprocketOrder.upsert` (line ~463), `prisma.shiprocketShipment.upsert` (line ~518), and multiple `prisma.shiprocketShipment.update` calls — all using the bare `:6543` singleton on Group B RLS-protected tables.
- `src/lib/integrations/meta-sync.ts`: `prisma.$executeRaw` writing to `meta_ads_daily_metrics` (line ~147) and `meta_ads_creative_daily` (line ~208) — Group B RLS-protected tables.
- `src/lib/integrations/google-sync.ts`: `prisma.google_ads_daily_metrics.upsert` (line ~152), `prisma.google_ads_funnel_daily.deleteMany` (line ~581), `prisma.google_ads_funnel_daily.createMany` (line ~639) — Group B RLS-protected tables.
- `src/routes/cron.ts`: `prisma.shopifyConnection.update` (line ~133) inside the `withWorkspace` block — `shopify_connections` is Group A, RLS-protected.

**The `withWorkspace(c.workspaceId, _tx)` callback passes `_tx` (the rlsPrisma transaction) but the inner sync functions do not accept `tx` — they call the bare `prisma` singleton directly.**

**What this means at runtime after FORCE RLS:** All these writes will run on the bare `:6543` client with NO `app.workspace_id` context set in that connection's session. Under FORCE RLS, the `WITH CHECK` clause (`workspace_id = current_setting('app.workspace_id', true)::uuid`) evaluates to NULL (because `current_setting` returns NULL when unset). A NULL WITH CHECK is treated as FALSE → the write is **rejected by Postgres.** All cron sync writes to Group A/B tables will silently fail or throw after FORCE.

**Is there a test for this?** No. The build report §3 (DoD) notes: "Idempotency: N/A — DDL migration; withWorkspace is idempotent (tx-local set_config scrubbed)." The cron tests (cron-scope.test.mjs) simulate the loop structure but do NOT test whether inner sync writes succeed post-FORCE. There is no negative test covering "cron WRITES still work after FORCE RLS."

**Is this deferred to Child 3?** The build report acknowledges: "requireRole on every mutation endpoint: Partially — per-route decoration is a 1b wiring task deferred to the route-migration phase." But the inner-sync-writes gap is a correctness hole specific to the FORCE RLS deployment (Stage 8 STEP 5), not a route decoration concern. The arch plan §6 describes the refactor as wrapping "each per-connection unit of work in `withWorkspace(c.workspaceId, …)`" — but the inner functions' actual writes bypass the wrapper's `rlsPrisma` transaction by calling `prisma` directly.

**Impact:** After STEP 5 (FORCE), ALL Shiprocket/Meta/Google cron sync writes will fail. Shopify `shopifyConnection.update` will fail (Group A). This is a data-loss scenario for Shiprocket (no replay, per R5).

**Required fix:** Either (a) migrate the inner sync functions to accept and use the passed `tx` parameter (the `rlsPrisma` transaction that already has `app.workspace_id` set), or (b) wrap the inner sync DB writes in their own `withWorkspace(c.workspaceId, ...)` calls, or (c) ensure the runbook's STEP 5 (FORCE) is blocked on this being resolved. The fix does not have to land in Child 1 IF the runbook is updated to hard-gate STEP 5 on this being verified first — but currently the runbook has no such gate.

---

## 6. Supplementary Findings

**F2 (Note, not bounce):** The `getCorrelation()` 4-tuple unit test in `rls-policy-shapes.test.mjs` (suite "Correlation 4-tuple structure") tests only the field existence on the default/fallback return — it does not test that the ALS propagation actually flows through `withWorkspace` (e.g., that `correlationStore.run(ctx, ...)` in `withWorkspace` propagates the context to code called inside the callback). This is a thin test for a critical path. The product code in `rls-prisma.ts` implements it correctly (the `correlationStore.run(ctx, () => rlsPrisma.$transaction(...))` pattern is correct), but the test only proves the shape of the fallback, not the propagation. This is acceptable as a unit test limitation (ALS propagation requires a live runtime), but should be noted as a gap Tanvi would close at Stage 8.

**F3 (Note, not bounce):** The cron test "Each connection has its own workspace context (withWorkspace called per-connection)" tests the simulation via `contextSetFor` array — this proves the loop calls the wrapper per-connection, but the simulation does not actually invoke `withWorkspace` from `rls-prisma.ts` (it simulates it with `contextSetFor.push(c.workspaceId)`). This is correct for a unit test of the loop structure; the real integration is deferred to Stage 8. Acceptable.

**F4 (Note):** In `cron.ts` (line ~133 inside the Shopify `withWorkspace` block), `prisma.shopifyConnection.update` uses the bare singleton. This is specifically `shopify_connections` (Group A table). While this is an instance of the F1 write problem, it is worth calling out separately: the `lastSyncAt` update runs inside `withWorkspace(..., _tx)` scope but on the bare `prisma` not on `_tx`. After FORCE, this update will fail.

**F5 (Note):** The region assertion in `rollout-runbook.sh` STEP 0 uses `current_setting('app.settings.project_region', true)` — this is a Supabase-platform-set GUC. The plan noted "hostname/DNS is NOT accepted as proof" and requires a "Postgres-level region signal." This specific GUC exists only if the Supabase platform sets it; if it is not set (returns empty string), the script accepts it (`if [[ -n "$REGION_6543" && ... ]]`). This means an empty return is treated as "inconclusive but OK" rather than "assertion failed." Jatin should be aware: if the GUC is not populated on this Supabase version, STEP 0 silently passes without verifying the region. The cross-check on `pg_postmaster_start_time` (same instance on both URLs) is a useful additional check but does not prove region. Flag for Jatin to verify the GUC is populated before relying on STEP 0.

**F6 (Metric registry parity check):** This paradigm is `sql-ddl-and-connection-handling` with no ML/LLM and no metric registry (no TS↔Python metric definitions). The metrics named in the arch plan §9 (`rls_probe_verdict`, `cron_connections_attempted`, `cron_connections_connected`) are observability intentions in prose, not implemented as a metric-registry registration in this build. No TS or Python metric-registry files are in the staged set. TS↔Python parity is N/A (no Python, no metric-registry code in this slice). **Metric registry parity: N/A — documented, not silently skipped.**

**F7 (Trace ID end-to-end):** The correlation 4-tuple (`requestId`, `traceId`, `workspaceId`, `userId`) is correctly wired via AsyncLocalStorage in `rls-prisma.ts` and seeded in `workspace.ts` (middleware) and `cron.ts` (per-tick context). The `withWorkspace` and `withSuperadmin` wrappers both run inside `correlationStore.run(ctx, ...)`. The proof-of-attempt logs carry `requestId`/`traceId` from `getCorrelation()`. The 4-tuple is structurally present end-to-end in the code. **However, the live-network trace-ID verification (ALS context actually propagated in a real request → DB call → log) is deferred to Stage 8.** This is acceptable per the deferred gate structure, but flagged as a Stage 8 VETO item. The unit test proves the shape; the Stage 8 smoke proves the propagation. No VETO at this stage because the code path is provably correct (ALS pattern is standard Node.js and the implementation matches the canonical form).

---

## 7. Mutation Testing Assessment

Isolation is a high-stakes path by definition. The fail-closed assertion in `rls-policy-shapes.test.mjs` tests the static SQL via regex against the actual migration files — a mutation of the USING clause (e.g., adding `OR IS NULL`) would be caught. However, the simulation-based fail-closed proof (`simulateUsingClause`) is a logic simulation, not a DB-level mutation test. A mutation that changed `current_setting(..., true)` to `current_setting(..., false)` (session-scoped instead of tx-local) in `rls-prisma.ts` would not be caught by any existing test — the distinction between `true` and `false` in `set_config` is the critical isolation mechanism (tx-local vs session-scoped). No mutation test covers this.

This gap is acceptable at Stage 5 given that (a) the live-DB integration tests at Stage 8 effectively serve as mutation detectors at the system level, and (b) a static grep of the product code confirms `set_config('app.workspace_id', ${workspaceId}::text, true)` — the `true` is present in `rls-prisma.ts:144`. The F1 finding (inner sync writes) is a more severe and more immediately actionable gap than the mutation test gap.

---

## 8. Summary of Findings by Severity

| ID | Severity | Description |
|---|---|---|
| F1 | **BOUNCE** | Inner sync functions (shiprocket-sync, meta-sync, google-sync, shopify inside cron.ts) use bare `:6543` singleton `prisma` for Group A/B write operations. After FORCE RLS, these writes will fail. No test covers this. No runbook gate blocks STEP 5 on this being resolved. Deferred to Child 3 per plan but the FORCE gate has no protection against this. |
| F2 | NOTE | Correlation 4-tuple test proves field shape only; ALS propagation through `withWorkspace` is not unit-tested (acceptable, deferred to Stage 8 smoke). |
| F3 | NOTE | Cron workspace-context test simulates the wrapper, does not invoke real `withWorkspace`. Acceptable as unit test. |
| F4 | NOTE | `prisma.shopifyConnection.update` (Group A table) inside `withWorkspace` block but using bare singleton — subset of F1. |
| F5 | NOTE | Region GUC (`app.settings.project_region`) may be empty on some Supabase versions; STEP 0 treats empty as "OK." Jatin must verify. |
| F6 | INFO | Metric registry TS↔Python parity N/A (no metrics code in this paradigm). Documented, not skipped. |
| F7 | INFO | Trace ID end-to-end: code is correct; live-network verification deferred to Stage 8 per accepted gate structure. |

---

## 9. Operational Readiness Checklist

| Item | Status |
|---|---|
| DIRECT_URL env var checked at startup; throws clear error if absent | YES — `rls-prisma.ts:80-83` throws `[rls-prisma] DIRECT_URL is not set` |
| connection_limit conservatively capped (10) on rlsPrisma | YES — `rls-prisma.ts:92-95` |
| Runbook halts (set -euo pipefail) on any assertion failure | YES — `rollout-runbook.sh:24` |
| Rollback script (down.sql) covers all 44 tables + dual-policy drops | YES — verified by test #16-17 + reading down.sql |
| Proof-of-attempt alarm for silent-skip | YES — cron routes + sync functions |
| No credential values in staged files | CONFIRMED — secrets grep CLEAN |
| .env not staged | CONFIRMED |

---

## 10. Verdict

**BOUNCE** — one blocking finding (F1).

The 26 tests all genuinely pass. The static SQL is correct. The pooling mechanism (rlsPrisma/:5432 + tx-local set_config) is correctly implemented. The deferral predicates for Stage 8 are concrete. The code is clean and readable.

The BOUNCE is narrow and specific: **after FORCE RLS (STEP 5), the inner sync functions' DB writes will fail because they call the bare `:6543` singleton, which has no `app.workspace_id` set, and Postgres rejects the WITH CHECK.** There is no test for this (positive or negative), and the runbook has no gate blocking STEP 5 until this is resolved. For Shiprocket specifically, failed writes = permanent data loss (no replay, CF-C1-CRON-SCOPE-1.a R5).

**Required to unblock (one of these, not all):**
1. Migrate inner sync function DB writes to accept and use the `tx` parameter from `withWorkspace`, OR wrap them in `withWorkspace(c.workspaceId, ...)` — and add a test proving cron WRITES succeed post-FORCE (a mocked test asserting `withWorkspace` is called for writes, or a Stage 8 predicate that is explicitly named in the runbook as a STEP 5 pre-gate).
2. OR: add a runbook gate at STEP 3/4 that explicitly names this gap and makes STEP 5 (FORCE) contingent on resolving it in a future child — but this means G1 cannot be declared fully GREEN until Child 3 lands, which contradicts the plan's "G1 GREEN at Child 1."

Option 1 is the correct fix. It is a targeted change to three sync files + a test addition.

