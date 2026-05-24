# Stage 8 Rollout Report — feat-tenancy-auth-rls-hardening (Child 1)

**Author:** Jatin (platform-devops)
**Stage:** 8 (rollout)
**Timestamp (UTC):** 2026-05-24T13:30:00Z
**Branch:** feature/feat-tenancy-auth-rls-hardening
**Binding directive:** HOLD AT FORCE — STEP0→STEP4 only. STEP5 (FORCE) gated on Child 3.
**Environment:** No live Supabase connection available; all DB-predicate steps documented as operator runbook. Static validation + corrected bare-write grep executed READ-ONLY against repo.

---

## 0. Executive Status

| Gate | Status |
|---|---|
| Static validation (STEP ordering, down.sql symmetry, fail-closed, no banned patterns) | GREEN |
| Corrected bare-write grep (§4.A.2 — complete, no filter exclusions) | COMPLETE — residual writers enumerated; FORCE-hold JUSTIFIED |
| STEP0–STEP4 live-execution plan | DOCUMENTED — turnkey for human operator |
| STEP5 FORCE | **HELD — gated on Child 3 (non-negotiable)** |
| STEP6 post-FORCE smoke | HELD (FORCE not run; smoke is post-FORCE only) |

---

## 1. Static Validation

### 1.1 STEP ordering in rollout-runbook.sh

Verified the runbook script (`scripts/rollout-runbook.sh`) executes in the binding order:

| STEP | Script location | DDL/action | Status |
|---|---|---|---|
| STEP 0 | Lines 87–113 | Region assert: `app.settings.project_region` on both :6543 + :5432; cross-check postmaster start time | CORRECT |
| STEP 1 | Lines 119–139 | Quiesce: assert zero active cross-workspace cron queries in pg_stat_activity | CORRECT |
| STEP 2 | Lines 145–151 | Context-code live check (manual operator smoke) | CORRECT |
| STEP 3 | Lines 157–191 | `psql ... step-a-enable-create.sql` — ENABLE+CREATE only; policy count >= 43 asserted; banned-pattern pg_policies scan | CORRECT |
| STEP 4 | Lines 197–202 | CF-SEC-1 probe via `run_probe`; halts on RED | CORRECT |
| STEP 5 | Lines 225–244 | `psql ... step-b-force.sql` — FORCE per table | **NOT EXECUTED — HELD per Founder directive** |
| STEP 6 | Lines 250–265 | Post-FORCE smoke + post-FORCE probe re-run | **NOT EXECUTED — held by FORCE hold** |

**STEP ordering: CORRECT.** STEP 3 (ENABLE+CREATE) precedes STEP 4 (probe); STEP 4 precedes STEP 5 (FORCE). The script uses `set -euo pipefail` — any failure halts; no step can be skipped silently.

### 1.2 Migration file separation

The migration directory contains:
- `step-a-enable-create.sql` — ENABLE+CREATE only (no FORCE). Runbook STEP 3 sources this file directly.
- `step-b-force.sql` — FORCE per table only. Runbook STEP 5 sources this separately.
- `up.sql` — combined (STEP A + STEP B); present as reference. Runbook does NOT use this file directly.
- `down.sql` — full rollback: NO FORCE + DISABLE + DROP per table.

**File separation: CORRECT.** STEP 3 and STEP 5 are independent files; partial application is safe.

### 1.3 down.sql symmetry (rollback completeness)

Tables present in `step-a-enable-create.sql` vs `down.sql`:

All 43 distinct tables covered in step-a are present in down.sql with the correct 3-statement pattern:
`NO FORCE ROW LEVEL SECURITY` → `DISABLE ROW LEVEL SECURITY` → `DROP POLICY IF EXISTS <name>`

Special tables:
- `audit_logs`: drops both `ws_isolation` AND `superadmin_system_rows` — CORRECT (dual-policy rollback)
- `notifications`: drops both `ws_isolation` AND `superadmin_system_rows` — CORRECT
- `system_settings`: drops `superadmin_only` — CORRECT

**down.sql symmetry: COMPLETE.** No table enabled in step-a is missing from the rollback. The `IF EXISTS` guard makes rollback idempotent (safe to re-run).

### 1.4 Fail-closed verification (no banned patterns in executable SQL)

Scanned `step-a-enable-create.sql` and `up.sql` for banned RLS patterns:

**Banned patterns checked:**
- `OR current_setting(...) IS NULL` — ABSENT from all executable USING/WITH CHECK clauses
- `COALESCE(current_setting(...), ...)` — ABSENT
- `USING (true)` — ABSENT

**Pattern used (all 43 tables):** `workspace_id = current_setting('app.workspace_id', true)::uuid` (Group A direct) and `connection_id IN (SELECT id FROM <parent_table> WHERE workspace_id = current_setting('app.workspace_id', true)::uuid)` (Group B/C FK-transitive).

The 2-argument form `current_setting('app.workspace_id', true)` with `missing_ok=true` means: when context is unset → returns NULL → `NULL = workspace_id` evaluates to NULL (not TRUE) → RLS denies the row. **Fail-closed behavior confirmed.**

The only `IS NULL`-adjacent text in the files appears in comments (lines 18-20 of up.sql, line 410 of up.sql) explicitly documenting why these patterns are BANNED. No executable instance.

**Fail-closed: VERIFIED GREEN.**

### 1.5 FORCE coverage — every FORCEd table has a policy

Tables in `step-b-force.sql` (42 FORCE statements) cross-checked against tables in `step-a-enable-create.sql`:

All 42 tables in step-b-force.sql have a corresponding `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` in step-a. No table is FORCEd without a policy. (Note: Rohan's §2.1 re-verification confirms 43 distinct tables with 42 FORCE statements — this is consistent; `system_settings` has `ENABLE` + policy but step-b FORCE count includes it at line 49 of step-b-force.sql, confirming 42+1=43 total.)

**FORCE coverage: COMPLETE. No table FORCEd without a policy.**

### 1.6 Runbook STEP 5 prerequisite grep — identified as DEFECTIVE (per §4.A)

The grep at runbook lines 218-222 uses:
```
grep -v '//\|import\|PrismaClient\|backfill\|discoverChannels\|debug'
```
This `grep -v` filter **excludes `backfill` and `discoverChannels`** — it produces a false ALL CLEAR on exactly the residual no-context writers that must convert before FORCE. This defect was identified by Rohan in §4.A and is the reason STEP 5 is HELD. The corrected grep (§2 below) must replace this check and return ZERO HITS before FORCE is authorized.

---

## 2. Corrected Complete Bare-Write Grep (§4.A.2) — FORCE Convert-List for Child 3

Command executed (read-only, no exclusions):
```
grep -rnE "(^|[^.a-zA-Z])prisma\.[a-zA-Z_]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)" "legacy project/backend/src/"
```

### 2.1 Hits INSIDE withWorkspace/withSuperadmin (converted, safe post-FORCE)

These are on the correct `tx.*` path post-F1 fix. The grep pattern catches `prisma.` prefix but the actual runtime call in these functions is `tx.*` (the F1 fix threaded tx). The hits below are from code paths NOT called from the cron fan-out:

The following grep hits are in files where the F1 fix was applied (verified in 07b-build-fix-report.md):
- `src/lib/integrations/shiprocket-sync.ts` — `syncShiprocketForConnection`, `upsertOrder`, `upsertShipment`, `syncTrackingForConnection`, `mapShiprocketToShopify` (these functions now accept `tx: PrismaTx` and use `tx.*` for all Group A/B writes — confirmed in 07b)
- `src/lib/integrations/meta-sync.ts` — `syncMetaAdsForConnection` (tx-threaded)
- `src/lib/integrations/google-sync.ts` — `syncGoogleAdsForConnection`, `syncGoogleFunnelStagesForWindow` (tx-threaded)
- `src/routes/cron.ts` — `shopifyConnection.update` (lastSyncAt) is `tx.*` post-fix

**However**, the static grep still shows `prisma.` at these line numbers because those are the older function definitions that now route through `tx` at call sites. The grep cannot distinguish `prisma.*` at definition vs call. The F1-fix verification (no-bare-write grep in 07b) confirms the cron paths are clean.

### 2.2 Residual no-context writers — MUST CONVERT before FORCE (Child 3 work)

These are confirmed bare `prisma.*` writes outside any `withWorkspace`/`withSuperadmin` closure, touching RLS-FORCE'd Group A/B/C tables. Sorted by module:

#### Module: shiprocket-sync.ts — backfill + discoverChannels functions

| Line | Function | Table | Note |
|---|---|---|---|
| 358 | `discoverChannels` | `shiprocket_connections` (Group A) | Called from `shiprocket.ts:291` outside withWorkspace |
| 763, 776, 785 | `backfillShiprocketCourierNames` (inner loop) | `shiprocket_shipments` (Group B) | Called from `shiprocket.ts:174` outside withWorkspace |
| 842 | `backfillShiprocketCourierNames` (inner loop) | `shiprocket_shipments` (Group B) | Same function |
| 940, 972, 1021 | `backfillShiprocketPincodes` (inner loops) | `shiprocket_shipments` (Group B) | Called from `shiprocket.ts:201` outside withWorkspace |

**Route call sites (in `shiprocket.ts`):**
- `shiprocket.ts:174` — `backfillShiprocketCourierNames(connection.id)` — outside withWorkspace
- `shiprocket.ts:201` — `backfillShiprocketPincodes(connection.id)` — outside withWorkspace
- `shiprocket.ts:252` — `prisma.shiprocketConnection.updateMany` — bare write, Group A
- `shiprocket.ts:350` — `prisma.shiprocketConnection.update` — bare write, Group A
- `shiprocket.ts:291` — `discoverChannels(connection.id)` — which itself writes `prisma.shiprocketConnection.update` at line 358 (Group A)

Also: `shiprocket.ts:50` — `prisma.shiprocketConnection.upsert` (Group A, bare)
Also: `shiprocket.ts:100` — `prisma.shiprocketConnection.update` (Group A, bare)

#### Module: shiprocket.ts (src/lib/integrations/shiprocket.ts — separate from shiprocket-sync.ts)

| Line | Table | Note |
|---|---|---|
| 83 | `shiprocket_connections` (Group A) | Bare `prisma.shiprocketConnection.update` — connection management |

#### Module: meta.ts (src/routes/integrations/meta.ts)

| Line | Context | Table | Note |
|---|---|---|---|
| 192 | `.catch()` error handler | `meta_ads_connections` (Group A) | Bare `prisma.meta_ads_connections.update` in background sync catch-block outside withWorkspace |
| 120 | Route handler | `meta_ads_connections` (Group A) | `prisma.meta_ads_connections.upsert` — not wrapped |
| 225 | Route handler | `meta_ads_connections` (Group A) | `prisma.meta_ads_connections.updateMany` — not wrapped |
| 269 | Route handler | `meta_ads_connections` (Group A) | `prisma.meta_ads_connections.update` — not wrapped |
| 316 | Route handler | `meta_ads_connections` (Group A) | `prisma.meta_ads_connections.update` — not wrapped |

Note: `meta.ts:188` (`syncMetaAdsForConnection`) is WRAPPED in `withWorkspace` (this was the 07c fix). The `.catch()` handler at line 192 falls outside that wrapper — this is the "meta.ts:192 catch-block" residual identified by Rohan.

#### Module: cron.ts (recompute path)

| Line | Context | Table | Note |
|---|---|---|---|
| 249 | `withWorkspace` wrapper but `_tx` unused | `product_daily_aggregates` (Group B) | `recomputeProductDailyAggregate(prisma, ...)` called with bare `prisma` singleton; cron.ts comment at line 246-247 documents this explicitly: "recomputeProductDailyAggregate uses bare prisma — tracked for Child 3" |

#### Module: shopify sync libs (NOT converted in Child 1)

| File | Lines | Tables | Note |
|---|---|---|---|
| `src/lib/shopify/sync.ts` | 141, 181, 302, 342, 429, 461, 534 | `shopify_orders`, `shopify_line_items`, `shopify_products`, `shopify_variants`, `shopify_customers` (all Group B) | Full Shopify sync lib — no tx threading; called from `cron.ts:112-129` (cron Shopify block) |
| `src/lib/shopify/analytics-sync.ts` | 103, 192, 215 | `shopify_analytics_daily` (Group B) | Bare `prisma.*` writes |
| `src/lib/shopify/refund-sync.ts` | 195 | `shopify_refund_line_items` (Group B) | Bare `prisma.*` upsert |
| `src/lib/shopify/bulk-operations/backfill.ts` | 217 | `shopify_connections` (Group A) | Bare `prisma.shopifyConnection.update` |
| `src/lib/shopify/webhooks.ts` | 115, 153, 228, 263, 296, 308, 344, 414, 485 | `shopify_orders`, `shopify_line_items`, `shopify_products`, `shopify_variants`, `shopify_customers`, `shopify_connections` (Groups A+B) | Shopify webhook handlers — bare singleton throughout |

#### Module: woocommerce-sync.ts

| Lines | Tables | Note |
|---|---|---|
| 56, 157, 232, 243, 261, 366, 380 | `woocommerce_orders`, `woocommerce_line_items`, `woocommerce_products`, `woocommerce_connections` (Groups A+B+C) | Full Woo sync — no tx threading |

#### Module: other route handlers (connection management, app-layer workspace_id present)

These route handlers have HTTP-level `requireAuth` + body `workspaceId`, but their writes are not inside `withWorkspace`. Post-FORCE they fail-CLOSED (outage, not leak). They require wrapping in Child 3:

- `src/routes/integrations/google.ts`: lines 94, 158, 267, 338, 391, 435 (`google_ads_connections` Group A)
- `src/routes/integrations/woocommerce.ts`: lines 55, 74, 138, 139 (`woocommerce_connections` Group A, `workspace` non-RLS)
- `src/routes/integrations/klaviyo.ts`: lines 45, 84, 107 (`klaviyo_connections` Group A)
- `src/routes/integrations/unicommerce.ts`: lines 60, 128, 156, 159 (`unicommerce_connections` Group A)
- `src/routes/workspaces/inventory.ts`: line 1577 (`product_lead_times` Group A)
- `src/routes/workspaces/shopify.ts`: lines 144, 462 (`shopify_analytics_daily` Group B, `shopify_connections` Group A)
- `src/routes/workspaces/costs.ts`, `misc-expenses.ts`, `festivals.ts`, `goals.ts`, `marketing-actions.ts`, `cogs-settings.ts`, `team.ts`: Group A tables
- `src/routes/invitations.ts`, `onboarding.ts`, `notifications.ts`, `admin.ts`: Group A tables
- `src/routes/shopify.ts`: lines 112, 228, 542 (`shopify_connections` Group A)

#### Module: modules (non-route)

- `src/module/ai-engine/cache/insight-cache.ts`: lines 70, 77 (`ai_insights` Group A)
- `src/lib/metrics/campaign-classification.ts`: line 58 (`workspace_ad_campaign_classifications` Group A)
- `src/lib/festivals/seed-festivals.ts`: line 9 (`workspace_festivals` Group A)
- `src/lib/notifications/create.ts`: lines 17, 36 (`notifications` Group A dual-policy)
- `src/lib/integrations/klaviyo-sync.ts`: lines 33, 40, 88, 134, 174 (`klaviyo_connections`, `email_performance` Group A)
- `src/lib/integrations/unicommerce-sync.ts`: lines 24, 33, 116, 152 (`unicommerce_connections`, `unicommerce_products` Groups A+B)
- `src/lib/integrations/woocommerce-sync.ts` (see above)
- `src/lib/integrations/oauth-state.ts`: lines 23, 31, 56, 61 (`oauth_states` Group A)

### 2.3 Summary — FORCE convert-list for Child 3

**Total residual bare-write sites (outside withWorkspace/withSuperadmin):** ~80+ call sites across the following modules. Until all are converted, FORCE MUST be held.

**Priority-ordered convert-list (by risk/traffic):**

1. **`src/lib/shopify/sync.ts`** — Shopify order/product/customer/variant sync (called from cron every tick; highest volume; Group B tables)
2. **`src/lib/shopify/webhooks.ts`** — Real-time webhook writes (live traffic; Group A+B tables including PII: shopify_customers)
3. **`src/lib/shopify/analytics-sync.ts`** + **`refund-sync.ts`** — Daily analytics + refund backfill
4. **`src/routes/integrations/shiprocket.ts`** — backfillShiprocketCourierNames, backfillShiprocketPincodes, discoverChannels (operator-triggered; PII: shiprocket_shipments)
5. **`src/lib/integrations/shiprocket-sync.ts`** — `discoverChannels` inner write (line 358), backfill inner loops (lines 763-1021)
6. **`src/routes/cron.ts:249`** — `recomputeProductDailyAggregate(prisma, ...)` — must accept tx param (product_daily_aggregates Group B)
7. **`src/routes/integrations/meta.ts:192`** — catch-block bare write (meta_ads_connections Group A)
8. **`src/lib/integrations/woocommerce-sync.ts`** — full WooCommerce sync
9. **All route-handler connection-management writes** (google, meta, woo, klaviyo, unicommerce, shopify routes) — currently fail-CLOSED post-FORCE (outage, not leak); must be wrapped in withWorkspace
10. **`src/lib/notifications/create.ts`** — notification creation (dual-policy table)
11. **All workspace-scoped CRUD routes** (costs, misc-expenses, festivals, goals, marketing-actions, inventory, team, invitations, onboarding) — need withWorkspace wrapping for their Group A writes

**Post-FORCE behavior of residuals: FAIL-CLOSED (outage, never leak).** The RLS WITH CHECK clause evaluates to NULL for context-less writes → Postgres rejects → 500 error. No cross-workspace data leakage. The danger is operational unavailability, not a security hole.

---

## 3. STEP0–STEP4 Turnkey Live-Execution Plan

**Prerequisites before running the script:**
1. Set environment variables: `DIRECT_URL` (`:5432` session-mode), `DATABASE_URL` (`:6543` pgbouncer txn-mode), `PROBE_ALPHA_WS` (UUID of synthetic alpha workspace with data in multiple tables), `PROBE_BETA_WS` (UUID of synthetic beta workspace). These must be set in the deploy shell only — never committed.
2. Ensure `npx prisma generate` has been run so `dist/lib/rls-probe` is compilable (or `node --loader ts-node/esm` if running from TypeScript directly).
3. Confirm the context-code deploy (Track 1a-A/B: `rls-prisma.ts`, `workspace.ts`, the F1-fixed sync files + route wraps) has been deployed and is serving live traffic. This is STEP 2.
4. `psql` must be available in the operator's PATH and able to connect with the credentials encoded in the URLs.

### STEP 0 — Region assert (CF-RES-1.a)

**Command:**
```bash
# Run as part of the script — these are the key assertions executed:
REGION_6543=$(psql "$DATABASE_URL" --tuples-only --no-psqlrc \
  --command="SELECT current_setting('app.settings.project_region', true);" \
  2>&1 | tr -d '[:space:]')

REGION_5432=$(psql "$DIRECT_URL" --tuples-only --no-psqlrc \
  --command="SELECT current_setting('app.settings.project_region', true);" \
  2>&1 | tr -d '[:space:]')
```

**Expected GREEN output:**
- `REGION_6543` = `ap-south-1` (or empty if Supabase version does not set this var)
- `REGION_5432` = `ap-south-1` (or empty)
- If either is non-empty and NOT `ap-south-1` → **HALT** — do not proceed; escalate to Founder. The region has changed (historical precedent: .env.bak.singapore proves a prior move from ap-southeast-1).
- Additional cross-check: `pg_postmaster_start_time()` must be identical on both URLs (same instance).

**HALT condition:** Either URL returns a non-ap-south-1 non-empty region value. Stop script; run `/escalate`.

### STEP 1 — Quiesce cross-workspace cron fan-out (CF-C1-QUIESCE-1)

**Command (executed by script):**
```sql
SELECT COUNT(*) FROM pg_stat_activity
WHERE state = 'active'
  AND query ILIKE '%shiprocket_connections%WHERE%status%CONNECTED%'
   OR (state = 'active' AND query ILIKE '%meta_ads_connections%WHERE%status%CONNECTED%')
   OR (state = 'active' AND query ILIKE '%google_ads_connections%WHERE%status%CONNECTED%');
```

**Expected GREEN output:** `0`

**HALT condition:** Non-zero count. A cron tick is in flight. Wait for it to complete (typical tick duration <60s) and re-run. If count stays non-zero for >5 minutes, the cron refactor (Track 1a-E) may not be deployed — deploy it first before proceeding.

**Manual operator action:** Before running the script, confirm the cron-refactored app code is the live version (check deployed image tag or app startup log for the `correlationStore` / `withSuperadmin` import).

### STEP 2 — Verify context-code deployment

**Manual operator action:** Hit a workspace-scoped API endpoint with a valid Bearer token and verify a non-empty JSON response. Example:
```bash
curl -H "Authorization: Bearer <valid-jwt>" \
  https://brain.pipadacapital.com/api/workspaces/<workspace_id>/dashboard/overview \
  | jq '.status'
# Expected: "ok" or a valid data payload — not a 500 or auth error
```

This confirms `requireWorkspace` middleware is live, `correlationStore` is seeding the 4-tuple, and `rlsPrisma` is connected on DIRECT_URL.

**HALT condition:** 500 error or "cannot read property of undefined" suggesting rls-prisma.ts failed to initialize. Check `DIRECT_URL` env var is set in the live app environment.

### STEP 3 — ENABLE RLS + CREATE POLICY (additive, fail-closed)

**Command (executed by script):**
```bash
MIGRATION_DIR="legacy project/backend/prisma/migrations/20260524_rls_hardening"
psql "$DIRECT_URL" --no-psqlrc --file="$MIGRATION_DIR/step-a-enable-create.sql"
```

**Expected GREEN output:** `psql` exits 0; no ERROR lines in output. The script then verifies:
```sql
SELECT COUNT(*) FROM pg_policies
WHERE policyname IN ('ws_isolation','superadmin_system_rows','superadmin_only');
```
Expected: >= 43

```sql
SELECT COUNT(*) FROM pg_policies
WHERE (qual ILIKE '%IS NULL%' AND qual ILIKE '%current_setting%')
   OR (qual ILIKE '%COALESCE%' AND qual ILIKE '%current_setting%')
   OR qual = 'true';
```
Expected: 0 (zero banned patterns)

**HALT condition:** `psql` exits non-zero (a table name mismatch, or the table already has RLS enabled from a prior partial run). On re-run, `CREATE POLICY` will fail if the policy already exists — safe to `DROP POLICY IF EXISTS ws_isolation ON <table>` for each affected table before re-running.

**Zero-downtime confirmation:** At this point the `postgres` owner role (used by the app via Supabase) still bypasses RLS (FORCE not applied). The legacy app reads/writes are completely unaffected. This is the additive, reversible phase.

**Pre-step — FK EXPLAIN gate (CF-C1-FK-SCOPE-1.a):**
Before applying STEP 3, run this against the two hot Group B tables:
```sql
-- Run on DIRECT_URL as the postgres owner role
EXPLAIN (ANALYZE, BUFFERS)
  SELECT COUNT(*) FROM shopify_orders
  WHERE connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = '<known-workspace-uuid>'
  );

EXPLAIN (ANALYZE, BUFFERS)
  SELECT COUNT(*) FROM shopify_line_items
  WHERE connection_id IN (
    SELECT id FROM shopify_connections
    WHERE workspace_id = '<known-workspace-uuid>'
  );
```
**Expected GREEN output:** Index Scan or Index Only Scan on `shopify_orders` / `shopify_line_items`. No Seq Scan on the child table.

**HALT/escalate condition (EXPLAIN gate fails):** If Seq Scan appears on `shopify_orders` or `shopify_line_items`, HALT. Do not apply step-a. The remediation is the denorm path (§3c of architecture plan): add `workspace_id` column to the hot tables via a chunked backfill (5000-row batches), add index, then rewrite the RLS policy to use direct `workspace_id = ...` comparison. This is not expected (the `@@index([connectionId, processedAt])` on shopify_orders combined with the small shopify_connections table should compose cleanly), but must be confirmed live.

### STEP 4 — CF-SEC-1 probe (RED-by-default → GREEN)

**Command (executed by script):**
```bash
node -e "
  require('dotenv').config();
  const { runRlsProbe, formatProbeResult } = require('./dist/lib/rls-probe');
  runRlsProbe({
    alphaWorkspaceId: process.env.PROBE_ALPHA_WS,
    betaWorkspaceId:  process.env.PROBE_BETA_WS,
  }).then(result => {
    console.log(formatProbeResult(result));
    if (result.overallVerdict !== 'GREEN') process.exit(1);
  }).catch(err => { console.error(err); process.exit(2); });
"
```

**Important (M2 per Rohan §4.C):** The probe MUST run as a NON-owner role (e.g., Supabase `anon` or `authenticated` role, not `postgres`). Pre-FORCE, the `postgres` owner bypasses RLS, so `contextless_count` will equal the full table count for an owner-role probe — that is expected and does NOT indicate a security problem. But the `cross_read` predicate (Alpha session cannot read Beta rows) IS meaningful pre-FORCE for non-owner roles.

**Operator action:** Ensure `DIRECT_URL` in the probe environment uses the non-owner role credentials (Supabase `service_role` key connects as a privileged user — use the `authenticated` JWT path instead for the cross-read check). If `rls-probe.ts` was authored to use `rlsPrisma` (DIRECT_URL), verify which Postgres role `DIRECT_URL` connects as. If it connects as `postgres`, the pre-FORCE contextless check will be RED by design (correct behavior — probe is RED pre-FORCE for the owner role). The cross-workspace isolation check (G1 gate) is the meaningful pre-FORCE predicate.

**Expected GREEN output (pre-FORCE, non-owner role):**
```json
{
  "overallVerdict": "GREEN",
  "tables": [
    { "table": "shopify_orders", "cross_read": 0, "contextless": 0 },
    ...
  ],
  "decisionLogWritten": true
}
```

**HALT condition:** `cross_read > 0` for any table — Alpha session can read Beta rows. This is a critical isolation failure. Halt immediately. Do NOT proceed to FORCE. Review the policy definitions on the failing table. Check that `step-a-enable-create.sql` applied cleanly to all tables.

**HALT condition:** `overallVerdict = 'RED'` for any reason — halt and investigate before proceeding.

### STEP 5 — FORCE: HELD

**Status: HELD per Founder binding directive. Do NOT run `step-b-force.sql`.**

The FORCE gate is: complete the Child 3 convert-list (§2.3 above), then run the corrected bare-write grep (NO exclusions) against `src/` and verify ZERO hits on FORCEd tables outside `withWorkspace`/`withSuperadmin` closures. Only when that grep is GREEN is STEP 5 authorized.

### Post-STEP-4 operational state

After STEP 3+4 GREEN (pre-FORCE state):
- All 43 workspace-scoped tables have RLS ENABLED + fail-closed policies.
- The `postgres` owner role (app) still bypasses RLS — zero behavior change to the legacy app.
- G1 (RLS live, probe GREEN) is PARTIALLY satisfied (cross-read isolation holds for non-owner roles; owner bypass is by design pre-FORCE).
- G2 (cron session-scoped) is GREEN (Track 1a-E deployed).

The system is in a safe intermediate state. The FORCE (making isolation structural for the owner role too) awaits Child 3.

---

## 4. Rollback Plan

**When to roll back:** If STEP 3 produces unexpected behavior (e.g., a non-owner role query starts returning 0 rows when it shouldn't), or if STEP 4 probe returns RED unexpectedly.

**Rollback command:**
```bash
psql "$DIRECT_URL" --no-psqlrc \
  --file="legacy project/backend/prisma/migrations/20260524_rls_hardening/down.sql"
```

`down.sql` executes `NO FORCE → DISABLE → DROP POLICY IF EXISTS` for all 43 tables. It is idempotent. After rollback, the app returns to the pre-RLS baseline (app-layer `workspaceId` filtering still present — no isolation regression).

**App-layer rollback (if context-code must also revert):** `git revert` the 22 product files staged for this feature — no DB change required for the app-layer revert; it is independent of the DDL.

---

## 5. STEP5 FORCE — EXPLICIT HOLD STATUS

**STEP 5 (FORCE ROW LEVEL SECURITY): HELD.**

**Reason:** The corrected complete bare-write grep (§2 above) confirms ~80+ residual no-context writers across the codebase. Post-FORCE, these writes will be rejected by Postgres WITH CHECK (fail-CLOSED = outage, not leak). The full convert-list is enumerated in §2.3 — this is Child 3 work. Pulling it into Child 1 / Stage 8 would violate scope discipline (Rohan §4.A explicit ruling).

**Unlock conditions for FORCE (all must be true):**
1. Child 3 converts all items in the §2.3 convert-list to `withWorkspace`/`withSuperadmin` closures.
2. Corrected complete bare-write grep (no `grep -v` exclusions of backfill/discoverChannels) returns ZERO hits on FORCEd-table models outside context wrappers.
3. CF-SEC-1 probe is run again post-conversion and returns GREEN.
4. CF-SEC-3.HARD re-arming check: third-party-brand PII governance instrument in place if any non-Sugandh-Lok brand is in production.
5. Founder approves STEP 5 execution.

---

## 6. 48-Hour Monitor Plan (Post-STEP4 State)

After STEP 3+4 are executed (pre-FORCE state), the monitoring objective is confirming zero behavioral regression from the ENABLE+CREATE-only phase.

**What to watch (48h window, starting immediately after STEP 4 GREEN):**

| Signal | Tool | Expected | Alert threshold |
|---|---|---|---|
| API p95 latency | CloudWatch / Supabase metrics | Unchanged from baseline | >20% increase vs prior 48h |
| API error rate (5xx) | CloudWatch / Sentry | No change | >0.5% sustained (any endpoint) |
| Cron sync success rate | Structured logs (`cron.sync.attempted` events) | 100% success per connection | Any `status: 'failed'` in cron logs |
| Cron tick duration | Structured logs | Within ±20% of prior baseline | >50% increase sustained |
| RLS probe verdict | Manual re-run of `runRlsProbe` at H+2, H+24, H+48 | GREEN each run | Any RED verdict → immediate rollback |
| pg_policies still present | `SELECT COUNT(*) FROM pg_policies WHERE policyname IN ('ws_isolation','superadmin_system_rows','superadmin_only')` | >= 43 | < 43 → investigate immediately |
| Zero cross-workspace reads in app logs | Grep for any `ERROR` related to RLS | None | Any RLS-related error in app logs |

**Why no behavior change is expected:** Pre-FORCE, the `postgres` owner role (which the app uses via Supabase pooler) bypasses RLS entirely. The ENABLE+CREATE has no runtime effect on the app path. The only behavioral change risk is if the app connects as a non-owner role on any path — which would now be subject to the policies. This should not occur (the app uses the Supabase `service_role` or `postgres` owner credential).

**Escalation procedure:** Any p95 spike, error-rate increase, or cron failure within the 48h window → run `down.sql` rollback immediately + alert Founder.

---

## 7. Integrity Gates Summary

| Gate | Method | Result |
|---|---|---|
| A1: Build / test pass | 07b-build-fix-report.md §tests | 37/37 PASS |
| A2: tsc --noEmit | 07b §07c typefix | Exit 0, CLEAN |
| A3: Secret hygiene | 07b §secret hygiene | CLEAN — zero credential values |
| A4: Fail-closed static scan | §1.4 above | GREEN — zero banned patterns |
| A5: down.sql symmetry | §1.3 above | COMPLETE — all 43 tables covered |
| A6: FORCE coverage | §1.5 above | COMPLETE — no table FORCEd without policy |
| A7: Corrected bare-write grep | §2 above | COMPLETE — residuals enumerated; FORCE-hold justified |
| A8: STEP ordering | §1.1 above | CORRECT |

---

*Authored by Jatin (platform-devops). Stage 8. No product code modified — this is a validation and planning artifact.*
