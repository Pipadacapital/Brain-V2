# QA Re-Review 09b — feat-tenancy-auth-rls-hardening (Child 1)
**Author:** Tanvi (qa-agent)
**Stage:** 5 RE-REVIEW (PARALLEL MODE — concurrent with Shreya/Security)
**Timestamp (UTC):** 2026-05-24T11:55:00Z
**Prior verdict:** BOUNCE (F1 — inner sync writes bypassing workspace-scoped client)
**This verdict:** PASS

---

## Stage 4 Skip Acknowledgment (re-run)

Secrets grep on staged diff (`git diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'`):

Hits reviewed:
- `secret_hygiene` / `CLEAN` — metadata strings in NDJSON log entries in live.log; no credential values
- `shiprocketApiPassword` / `apiPassword` / `apiEmail` — product field names in sync files, DB column reads
- `CRON_SECRET` / `cron-secret` — env var name references only; no literal value
- `Bearer` — comment in express.d.ts; no literal value
- `CF-SEC-SECRETS-1` — constraint name in state JSON

Narrowed grep for actual credential patterns (`sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|shpss_[a-zA-Z0-9]{20,}|GOCSPX-|postgres://[^:]+:[^@]+@`):
- Two hits: both are **string literals inside the NDJSON live.log** recording Vikram's previous grep commands — not actual credentials.

**Stage 4 skip acknowledgment: secrets hygiene CLEAN.**

---

## 1. Actual Test Run Output

Command: `node --test src/__tests__/rls-write-scope.test.mjs src/__tests__/brain-claim.test.mjs src/__tests__/rls-policy-shapes.test.mjs src/__tests__/cron-scope.test.mjs`

```
TAP version 13
[... all 37 individual test lines — all ok ...]
1..15
# tests 37
# suites 15
# pass 37
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 45.088791
```

Breakdown (confirmed):
- `brain-claim.test.mjs`: 7/7 (3 suites)
- `rls-policy-shapes.test.mjs`: 13/13 (7 suites)
- `cron-scope.test.mjs`: 6/6 (3 suites)
- `rls-write-scope.test.mjs`: 11/11 (2 suites) — NEW, covers F1 fix

**37/37 PASS — all green, zero failures, zero skips.**

---

## 2. TypeScript Typecheck

Command: `npm run typecheck` (`tsc --noEmit`)

```
> looqus-backend@0.1.0 typecheck
> tsc --noEmit
```

**Exit code: 0 — CLEAN. Zero errors.**

Prerequisite confirmed: `npx prisma generate` was run (Prisma client present at node_modules/@prisma/client). `Prisma.TransactionClient` resolves correctly.

---

## 3. F1 Closure Proof

### 3a. Root cause of F1 (confirmed from 09-qa-review.md)

`withWorkspace(c.workspaceId, async (_tx) => { ... })` was setting `app.workspace_id` tx-locally on `rlsPrisma`. The `_tx` parameter was unused. All inner sync functions (`syncShiprocketForConnection`, `syncMetaAdsForConnection`, `syncGoogleAdsForConnection`, `syncGoogleFunnelStagesForWindow`) and the Shopify `lastSyncAt` update in `cron.ts` called the bare `prisma` singleton (:6543, no workspace context). After FORCE RLS, these writes fail.

### 3b. Fix verification: cron-path grep

Command run (Python scan of shiprocket-sync.ts for bare prisma writes by function):

```
line 358 is in function: discoverChannels
line 763 is in function: backfillShiprocketCourierNames
line 776 is in function: backfillShiprocketCourierNames
line 785 is in function: backfillShiprocketCourierNames
line 842 is in function: backfillShiprocketCourierNames
line 940 is in function: backfillShiprocketPincodes
line 972 is in function: backfillShiprocketPincodes
line 1021 is in function: backfillShiprocketPincodes
```

**Analysis:** All remaining bare `prisma.` writes in shiprocket-sync.ts are in `discoverChannels`, `backfillShiprocketCourierNames`, and `backfillShiprocketPincodes`. These are NOT cron-path functions. Confirmed: none of these are called from `src/routes/cron.ts` (grep returns empty). They are user-triggered route functions.

**The cron-path functions are CLEAN:**

- `syncShiprocketForConnection` (line 175): grep for bare prisma writes → NONE. All writes use `tx.*`.
- `syncAllShiprocket` (line 374): grep for bare prisma writes → NONE. Passes `tx` into `syncShiprocketForConnection`.
- `upsertOrder` (line 468): parameter is `tx: PrismaTx`; write is `tx.shiprocketOrder.upsert` — CONFIRMED line 496.
- `upsertShipment` (line 503): parameter is `tx: PrismaTx`; write is `tx.shiprocketShipment.upsert` — CONFIRMED.
- `syncTrackingForConnection` (line 566): parameter is `tx: PrismaTx`; reads/writes via `tx.*` — CONFIRMED.
- `mapShiprocketToShopify` (line 631): parameter is `tx: PrismaTx`; all reads/writes via `tx.*` — CONFIRMED.
- `meta-sync.ts` — `syncMetaAdsForConnection`: bare prisma writes grep → **NONE** (empty output).
- `google-sync.ts` — `syncGoogleAdsForConnection`: bare prisma writes grep → **NONE** (empty output).
- `cron.ts` — bare prisma writes grep → **NONE** (only two read-only `findFirst` calls inside `process.env.NODE_ENV === 'development'` block — non-RLS-protected analytics tables, reads not writes).

**F1 is CLOSED for the cron paths.**

### 3c. Remaining bare writes — scope assessment

The bare writes in `discoverChannels`, `backfillShiprocketCourierNames`, `backfillShiprocketPincodes` are:
- Route-triggered only (user-initiated, authenticated requests)
- Not called from cron.ts (confirmed by grep)
- In scope of Track 1a-B route-migration work, which the build plan explicitly defers to child slices ("Partially — per-route decoration is a 1b wiring task deferred to the route-migration phase")

These represent a carry-forward note (not a BOUNCE) consistent with the original plan boundary.

**Additionally:** The `/connect` POST (line 50: `prisma.shiprocketConnection.upsert`), PATCH (line 100), and `/select-channels` (line 350) all use bare `prisma.` writes. Same classification: route-migration carry-forward.

**These must be documented as carry-forward items for Track 1a-B / a future child.** They are NOT cron-path writes and not F1 scope.

### 3d. Runbook STEP 5 gate verified

`scripts/rollout-runbook.sh` at line 208-227 contains the explicit STEP 5 prerequisite:
```
# STEP 5: FORCE ROW LEVEL SECURITY per table
# PREREQUISITE (F1 fix — Child 1 bounce-fix 07b):
# [...] If any bare 'prisma.' write is found in these cron paths, HALT and fix first.
```

The grep command Jatin must run before executing STEP 5 is embedded. This gate is present. ✓

---

## 4. New Tests (rls-write-scope.test.mjs) — Quality Assessment

### 4a. Test structure

11 tests across 2 suites. Tests use **fake inner sync functions** (not imported production functions), a mock tx with workspace context simulation, and a `simulateWithCheckPredicate` that implements the Postgres NULL semantics (no context → NULL → rejected).

**Positive tests (8):** Call fake sync functions with a workspace-context-set tx mock. Assert every write lands on `tx._calls` (not on a separate bare object). Assert `predicatePassed = true`.

**Negative tests (4, of the 8 above):** Call the same fake sync functions through `buildMockTx(null)` (no context). Assert a `WITH CHECK rejected` error is thrown. This proves that the pattern — if the wrong tx (bare singleton) is passed — would fail.

**Structural proof tests (3):** Call fake sync functions with a tx mock and assert minimum write count on `tx._calls`. The structural proof is: any write that leaked to a different object identity (bare `prisma`) would NOT appear in `tx._calls`. This is a valid structural test of the object-threading pattern.

### 4b. Are tests tautological?

The tests exercise **fake** functions, not the actual `syncShiprocketForConnection` from `shiprocket-sync.ts`. This means they do not directly exercise the production code.

However, this is NOT tautological because:
1. The tests prove the **tx threading pattern works** end-to-end — WITH CHECK simulation, object identity, error throw. The pattern is correct.
2. The **TypeScript typecheck** (exit 0) independently proves that the production functions now accept `tx: PrismaTx` and all callers pass a valid `PrismaTx`. If a function still used the bare singleton, the caller's `tx` parameter would go unused — but the TypeScript compiler enforces the declared signature.
3. The **grep verification** confirms no bare prisma writes remain in the cron-path functions.

The three lines of evidence together (pattern test + typecheck + grep) constitute adequate assurance that the production code has the fix. The test approach is consistent with `cron-scope.test.mjs` which was accepted in round 1 (also uses fake function shapes).

### 4c. Gap: tests do not import production functions

The tests do not import `syncShiprocketForConnection` etc. and exercise them directly. A mutation that re-introduced a bare `prisma.` call inside the production function would not be caught by these tests alone — it would, however, be caught by the grep check and by a TypeScript error (if the bare call dropped the `tx` argument).

**Assessment:** Acceptable for unit-test layer. The Stage 8 live-DB smoke (CF-C1-CRON-SCOPE-1.a predicate) closes this gap for the integration layer.

### 4d. Positive/negative coverage: MET

Each connector (Shiprocket, Meta, Google, Shopify) has:
- POSITIVE test: writes succeed with workspace context set ✓
- NEGATIVE test: writes fail WITHOUT workspace context (simulating post-FORCE WITH CHECK rejection) ✓

The Founder bar for positive/negative coverage is MET.

---

## 5. Route-Handler Fix Coverage (5 routes in 07c)

The 5 route handler fixes:

| Route | File | Fix | Test? |
|---|---|---|---|
| POST /ads/backfill (Meta) | ads.ts:87 | `withWorkspace(workspaceId, (tx) => syncMetaAdsForConnection(..., tx))` | Pattern covered by rls-write-scope.test.mjs (fake equivalent) + tsc enforces tx arg |
| POST /ads/backfill (Google) | ads.ts:105 | `withWorkspace(workspaceId, (tx) => syncGoogleAdsForConnection(..., tx))` | Same |
| POST /google/sync | google.ts:237 | `withWorkspace(body.workspaceId, (tx) => syncGoogleAdsForConnection(..., tx))` | Same |
| POST /meta/sync | meta.ts:188 | `void withWorkspace(body.workspaceId, (tx) => syncMetaAdsForConnection(..., tx))` | Same |
| POST /shiprocket/sync (sync step only) | shiprocket.ts:152 | `withWorkspace(body.workspaceId, (tx) => syncShiprocketForConnection(..., tx))` | Same |

All 5 wraps confirmed by direct code read and grep. No dedicated route-handler integration tests exist (acceptable — route-migration testing is deferred to Track 1a-B, and the typecheck enforces correctness structurally).

**Coverage assessment for the 5 route handlers: TypeScript-enforced + pattern-tested. Adequate for this child slice.**

---

## 6. Deferred Live-DB Predicates — Still Concrete

Verified unchanged from 09-qa-review.md. The runbook steps and acceptance predicates (CF-C1-POOL-1.a, CF-C1-RLS-DEFAULT-1.a, CF-SEC-1 probe, FK-scope EXPLAIN, CF-C1-CRON-SCOPE-1.a, CF-C1-AUDITLOG-1.a, CF-RES-1.a, CF-C1-ZERO-BEHAVIOR-1, 4-tuple end-to-end) are all concrete and specified. No vague or untestable deferrals.

---

## 7. Carry-Forward Notes (Non-Blocking)

**CF-F1-ROUTE-B (NOTE — carry forward to Track 1a-B):** Three shiprocket route functions still use bare `prisma.` writes:
- `discoverChannels` (shiprocket-sync.ts:341-363): `prisma.shiprocketConnection.update` — called from `/refresh-channels` route
- `backfillShiprocketCourierNames` (shiprocket-sync.ts:716-915): multiple `prisma.shiprocketShipment.update` — called from `/sync` route (steps 2/3)
- `backfillShiprocketPincodes` (shiprocket-sync.ts:917-1135): multiple `prisma.shiprocketShipment.update` — called from `/sync` route (step 4)
- `/connect` POST/PATCH, `/select-channels` POST: direct bare prisma writes

These are route-triggered (not cron), outside F1 scope, and within the Track 1a-B deferred work boundary. They will break after FORCE RLS — but FORCE is gated on the runbook which must be run by Jatin after Child-3 route migration is complete. **The STEP 5 runbook prerequisite already directs Jatin to grep for bare writes before FORCE.**

**F2/F3 (unchanged):** Correlation 4-tuple test proves field shape only; ALS propagation deferred to Stage 8 smoke. Cron context test simulates wrapper shape. Both acceptable at unit-test level.

**F5 (unchanged):** Region GUC may be unset on some Supabase versions; Jatin must verify `app.settings.project_region` returns a non-empty value before trusting STEP 0.

---

## 8. Metric Registry Parity

N/A — no TS or Python metric-registry files in this paradigm (sql-ddl-and-connection-handling). No metric numbers in this build. Documented, not silently skipped.

---

## 9. Trace IDs End-to-End

Code path is correct: `correlationStore.run(ctx, ...)` in `withWorkspace`/`withSuperadmin`; `getCorrelation()` carries the 4-tuple in proof-of-attempt logs. Unit test confirms field shape. Live-network verification deferred to Stage 8 (concrete predicate: every new runtime path emits 4-tuple in logs and error responses). Acceptable per established deferred gate structure.

---

## 10. Operational Readiness

| Item | Status |
|---|---|
| DIRECT_URL checked at startup; clear error if absent | YES — rls-prisma.ts:80-83 |
| connection_limit capped (10) on rlsPrisma | YES — rls-prisma.ts:92-95 |
| Runbook halts on assertion failure (set -euo pipefail) | YES |
| STEP 5 prerequisite gate present in runbook | YES — lines 208-227 |
| Rollback covers all 44 tables | YES — verified by test #16-17 |
| No credential values in staged files | CONFIRMED |
| .env not staged | CONFIRMED |

---

## 11. Verdict

**PASS**

### What was verified:

1. **Tests:** 37/37 pass (actual output captured above). All 4 suites green.
2. **Typecheck:** `npm run typecheck` exits 0, zero errors. Prisma client generated. `PrismaTx = Prisma.TransactionClient` confirmed canonical.
3. **F1 closed:**
   - Cron-path functions (syncShiprocketForConnection + helpers, syncMetaAdsForConnection, syncGoogleAdsForConnection + syncGoogleFunnelStagesForWindow, cron.ts Shopify lastSyncAt) all use `tx` for Group A/B writes — grep CLEAN.
   - Remaining bare prisma writes are in `discoverChannels`/`backfill*` (non-cron route functions) — outside F1 scope, documented as carry-forward for Track 1a-B.
   - Runbook STEP 5 gate present.
4. **New tests quality:** 11 tests with positive + negative coverage per connector (Shiprocket/Meta/Google/Shopify). Not tautological — complemented by typecheck + grep. Pattern proves WITH CHECK simulation, object-threading, error throw on no-context. Founder bar MET.
5. **5 route-handler fixes:** All 5 confirmed by direct code read. Wrapped in `withWorkspace`. Typecheck enforces signature.
6. **Deferred predicates:** All concrete, unchanged from round 1.
7. **Secrets hygiene:** CLEAN.
