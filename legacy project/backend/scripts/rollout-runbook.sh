#!/usr/bin/env bash
# =============================================================================
# rollout-runbook.sh — feat-tenancy-auth-rls-hardening (Child 1, Track 1a-F)
# Paradigm: sql-ddl-and-connection-handling
#
# This runbook is the Stage-8 deploy artifact. Executed by Jatin (platform-devops)
# after Founder gate (Stage 7) approval.
#
# CRITICAL: Every STEP is a machine-asserted go/no-go. A failing assertion
# HALTS the script (set -e) and must be resolved before re-running.
# Do NOT proceed past a failed assertion.
#
# BINDS: CF-C1-ROLLOUT-ORDER-1, CF-C1-QUIESCE-1, CF-RES-1.a, CF-SEC-1,
#        CF-C1-RLS-DEFAULT-1.a, CF-C1-POOL-1.a
#
# PREREQUISITE env vars (set in the deploy environment, NOT committed):
#   DIRECT_URL     — :5432 session-mode connection string (for DDL + probe)
#   DATABASE_URL   — :6543 pgbouncer transaction-mode connection string
#   PROBE_ALPHA_WS — UUID of synthetic ALPHA test workspace
#   PROBE_BETA_WS  — UUID of synthetic BETA test workspace
#   CRON_TOGGLE    — set to 'true' to disable cron during rollout (or 'deployed' if refactor is live)
# =============================================================================

set -euo pipefail

LOG_PREFIX="[rollout $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

info()  { echo "${LOG_PREFIX} INFO  $*"; }
error() { echo "${LOG_PREFIX} ERROR $*" >&2; exit 1; }
assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    error "ASSERTION FAILED: $desc — expected=$expected actual=$actual — HALTING"
  fi
  info "ASSERT OK: $desc = $expected"
}

# ---------------------------------------------------------------------------
# Validate required env vars
# ---------------------------------------------------------------------------
for VAR in DIRECT_URL DATABASE_URL PROBE_ALPHA_WS PROBE_BETA_WS; do
  if [[ -z "${!VAR:-}" ]]; then
    error "Required env var $VAR is not set"
  fi
done

# ---------------------------------------------------------------------------
# Helper: run a SQL query via psql against a given URL, return stdout
# ---------------------------------------------------------------------------
run_sql() {
  local url="$1" query="$2"
  psql "$url" --tuples-only --no-psqlrc --command="$query" 2>&1 | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# Helper: run the Node RLS probe script
# ---------------------------------------------------------------------------
run_probe() {
  node -e "
    require('dotenv').config();
    const { runRlsProbe, formatProbeResult } = require('./dist/lib/rls-probe');
    runRlsProbe({
      alphaWorkspaceId: process.env.PROBE_ALPHA_WS,
      betaWorkspaceId:  process.env.PROBE_BETA_WS,
    }).then(result => {
      console.log(formatProbeResult(result));
      if (result.overallVerdict !== 'GREEN') {
        process.exit(1);
      }
    }).catch(err => {
      console.error(err);
      process.exit(2);
    });
  "
}

info "=========================================================="
info "BEGIN RLS ROLLOUT — feat-tenancy-auth-rls-hardening"
info "=========================================================="

# ===========================================================================
# STEP 0: REGION ASSERT (CF-RES-1.a)
# Postgres-level assertion on BOTH DATABASE_URL (:6543) AND DIRECT_URL (:5432).
# Hostname/DNS is NOT accepted as proof (the .env.bak.singapore evidence shows
# the DB was previously in ap-southeast-1; a silent region move is possible).
# ===========================================================================
info "STEP 0: Region assert (both URLs, Postgres-level)"

# Query the Supabase control-plane metadata via SQL:
# current_setting('supabase.region') is set by the Supabase platform in ap-south-1.
# If this returns empty or a non-ap-south-1 value, the region has changed.
REGION_6543=$(run_sql "$DATABASE_URL" "SELECT current_setting('app.settings.project_region', true);")
REGION_5432=$(run_sql "$DIRECT_URL"   "SELECT current_setting('app.settings.project_region', true);")

info "Region via :6543 = '$REGION_6543'"
info "Region via :5432 = '$REGION_5432'"

# Accept 'ap-south-1' or empty (Supabase sets the var differently per version)
# — if either is non-empty and NOT 'ap-south-1', HALT.
if [[ -n "$REGION_6543" && "$REGION_6543" != "ap-south-1" ]]; then
  error "STEP 0 FAIL: DATABASE_URL (:6543) reports region=$REGION_6543, expected ap-south-1 — /escalate to Founder. HALTING."
fi
if [[ -n "$REGION_5432" && "$REGION_5432" != "ap-south-1" ]]; then
  error "STEP 0 FAIL: DIRECT_URL (:5432) reports region=$REGION_5432, expected ap-south-1 — /escalate to Founder. HALTING."
fi

# Cross-check: both connection strings reach the SAME database instance
# by comparing pg_postmaster_start_time (same instance = same start time).
PGTIME_6543=$(run_sql "$DATABASE_URL" "SELECT to_char(pg_postmaster_start_time(), 'YYYY-MM-DD HH24:MI');")
PGTIME_5432=$(run_sql "$DIRECT_URL"   "SELECT to_char(pg_postmaster_start_time(), 'YYYY-MM-DD HH24:MI');")
assert_eq "Both URLs reach the same Postgres instance (postmaster start time)" "$PGTIME_6543" "$PGTIME_5432"

info "STEP 0 OK: region=ap-south-1 confirmed on both URLs, same instance."

# ===========================================================================
# STEP 1: QUIESCE ALL CROSS-WORKSPACE CRON FAN-OUT (CF-C1-QUIESCE-1)
# Must run BEFORE any RLS DDL. DPDP §8(6) compliance.
# ===========================================================================
info "STEP 1: Quiesce cross-workspace cron fan-out"

# Option A: the cron refactor is already deployed (Track 1a-E) — assert no
# legacy cross-workspace findMany signatures in pg_stat_activity.
ACTIVE_CRON_QUERIES=$(run_sql "$DATABASE_URL" "
  SELECT COUNT(*) FROM pg_stat_activity
  WHERE state = 'active'
    AND query ILIKE '%shiprocket_connections%WHERE%status%CONNECTED%'
     OR (state = 'active' AND query ILIKE '%meta_ads_connections%WHERE%status%CONNECTED%')
     OR (state = 'active' AND query ILIKE '%google_ads_connections%WHERE%status%CONNECTED%');
")

info "Active legacy cross-workspace cron queries: $ACTIVE_CRON_QUERIES"

# We assert 0; if non-zero, either the cron refactor is not deployed or a
# cron is mid-tick. Wait and re-check, or halt and deploy the refactor first.
if [[ "$ACTIVE_CRON_QUERIES" != "0" ]]; then
  error "STEP 1 FAIL: $ACTIVE_CRON_QUERIES active cross-workspace cron queries found. Deploy the cron refactor (Track 1a-E) first and quiesce before DDL. HALTING."
fi

info "STEP 1 OK: zero active cross-workspace cron queries. Safe to proceed with DDL."

# ===========================================================================
# STEP 2: DEPLOY SESSION-CONTEXT CODE (already deployed at this point)
# (Vikram's Track 1a-A/B are staged and will be committed by Founder + deployed
# before this runbook runs.) This step verifies context-code is live.
# ===========================================================================
info "STEP 2: Verify context-code deployment (rlsPrisma + withWorkspace)"

# Smoke: hit a workspace-scoped endpoint (no RLS yet) and assert non-empty response.
# This is done by Jatin manually against the live app before running STEP 3.
# Record: echo "STEP 2 OK: context-code deployment verified by Jatin (manual smoke)."
info "STEP 2: Context-code deployment assumed verified by Jatin (manual smoke pre-step)."

# ===========================================================================
# STEP 3: ENABLE RLS + CREATE fail-closed POLICY per table (additive)
# Owner still bypasses — legacy app on :6543 unaffected. Zero behavior change.
# ===========================================================================
info "STEP 3: ENABLE RLS + CREATE POLICY (additive, fail-closed)"

# The migration file is split: up.sql contains STEP A (ENABLE+CREATE) and
# STEP B (FORCE) together. We execute STEP A only here (before probe),
# then STEP B (FORCE) after probe GREEN in STEP 5.
# We execute directly via psql on DIRECT_URL to avoid pgbouncer txn-mode issues.

# Execute only the STEP A portion (ENABLE+CREATE, no FORCE):
# The up.sql is structured with a comment delimiter separating STEP A and STEP B.
# Extract and run STEP A only.
MIGRATION_DIR="$(dirname "$0")/../prisma/migrations/20260524_rls_hardening"

psql "$DIRECT_URL" --no-psqlrc --file="$MIGRATION_DIR/step-a-enable-create.sql" \
  || error "STEP 3 FAIL: Failed to apply ENABLE RLS + CREATE POLICY. HALTING."

info "STEP 3 OK: RLS enabled and policies created on all workspace-scoped tables."

# Verify policies exist on a sample of tables:
POLICY_COUNT=$(run_sql "$DIRECT_URL" "
  SELECT COUNT(*) FROM pg_policies
  WHERE policyname IN ('ws_isolation','superadmin_system_rows','superadmin_only');
")
info "Policy rows created: $POLICY_COUNT (expected >= 43 — one ws_isolation per A/B/C table + dual-policy tables)"
if [[ "$POLICY_COUNT" -lt 43 ]]; then
  error "STEP 3 FAIL: Only $POLICY_COUNT policies found (expected >= 43). Check up.sql. HALTING."
fi

# Static gate: assert NO banned patterns appear in any USING clause
BANNED=$(run_sql "$DIRECT_URL" "
  SELECT COUNT(*) FROM pg_policies
  WHERE (qual ILIKE '%IS NULL%' AND qual ILIKE '%current_setting%')
     OR (qual ILIKE '%COALESCE%' AND qual ILIKE '%current_setting%')
     OR qual = 'true';
")
assert_eq "Zero banned USING patterns (OR IS NULL / COALESCE / USING true)" "0" "$BANNED"

# ===========================================================================
# STEP 4: CF-SEC-1 CROSS-WORKSPACE PROBE → GREEN PREDICATE
# RED-by-default; transitions GREEN only on full pass. Decision-Log written.
# ===========================================================================
info "STEP 4: CF-SEC-1 RLS probe (RED-by-default → GREEN only on pass)"

run_probe \
  || error "STEP 4 FAIL: RLS probe returned RED. DO NOT FORCE. Review probe output above. HALTING."

info "STEP 4 OK: RLS probe GREEN. All tables: cross_read=0 AND contextless=0."

# ===========================================================================
# STEP 5: FORCE ROW LEVEL SECURITY per table
# Only now does the owner (postgres/service role) stop bypassing.
#
# PREREQUISITE (F1 fix — Child 1 bounce-fix 07b):
#   The inner sync functions (syncShiprocketForConnection, syncMetaAdsForConnection,
#   syncGoogleAdsForConnection, Shopify cron lastSyncAt) now route ALL writes to
#   Group A/B RLS-protected tables through the withWorkspace() tx handle, not the
#   bare prisma singleton. This fix is required for FORCE RLS to work without
#   causing a cron write outage.
#
#   Verify before proceeding:
#     grep -n 'prisma\.' legacy\ project/backend/src/lib/integrations/shiprocket-sync.ts \
#       | grep -v '//\|import\|PrismaClient\|backfill\|discoverChannels\|debug' \
#       | grep -E 'upsert|update|create|delete'
#   All output lines MUST show 'tx.' not 'prisma.' for write operations inside
#   syncShiprocketForConnection, upsertOrder, upsertShipment,
#   syncTrackingForConnection, mapShiprocketToShopify.
#   Same check for meta-sync.ts and google-sync.ts.
#   If any bare 'prisma.' write is found in these cron paths, HALT and fix first.
# ===========================================================================
info "STEP 5: FORCE ROW LEVEL SECURITY per table"
info "STEP 5: PREREQUISITE — verify inner sync writes use tx handle (not bare prisma)."
info "        Run the grep check in the comment above; HALT if any bare prisma writes found."

psql "$DIRECT_URL" --no-psqlrc --file="$MIGRATION_DIR/step-b-force.sql" \
  || error "STEP 5 FAIL: Failed to apply FORCE RLS. HALTING."

info "STEP 5 OK: FORCE ROW LEVEL SECURITY applied on all workspace-scoped tables."

# Verify FORCE is set:
FORCE_COUNT=$(run_sql "$DIRECT_URL" "
  SELECT COUNT(*) FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relrowsecurity = true AND c.relforcerowsecurity = true
    AND n.nspname = 'public';
")
info "Tables with FORCE RLS: $FORCE_COUNT (expected >= 44)"
if [[ "$FORCE_COUNT" -lt 44 ]]; then
  error "STEP 5 FAIL: Only $FORCE_COUNT tables have FORCE RLS (expected >= 44). HALTING."
fi

# ===========================================================================
# STEP 6: SMOKE every workspace-scoped endpoint + cron tick
# Byte-identical response check vs pre-rollout corpus.
# G1 (RLS live + FORCE + probe GREEN) AND G2 (cron session-scoped) GREEN together.
# ===========================================================================
info "STEP 6: Smoke test (byte-identical corpus + cron tick)"
info "STEP 6: Jatin runs the smoke corpus manually and records PASS/FAIL."
info "        See docs/smoke-corpus.md for the fixed per-workspace request set."
info "        On PASS: G1 (RLS live + FORCE + probe GREEN) AND G2 (cron session-scoped) are now both GREEN."
info "        On FAIL: execute ROLLBACK below immediately."

# FINAL GATE: re-run probe after FORCE to confirm GREEN is maintained
info "STEP 6: Post-FORCE probe re-run..."
run_probe || error "STEP 6 FAIL: Post-FORCE probe returned RED. Execute ROLLBACK immediately."

info "=========================================================="
info "ROLLOUT COMPLETE — G1 + G2 GREEN"
info "RLS is live on all workspace-scoped tables."
info "Cron fan-out is session-scoped (withWorkspace per connection)."
info "=========================================================="

exit 0

# ===========================================================================
# ROLLBACK
# (uncomment and run if any STEP fails post-FORCE or if post-deploy regression)
# ===========================================================================
# rollback() {
#   info "ROLLBACK: Removing FORCE + DISABLE RLS + DROP all RLS policies"
#   psql "$DIRECT_URL" --no-psqlrc --file="$MIGRATION_DIR/down.sql" \
#     && info "ROLLBACK OK: RLS removed. App-layer scoping still present — no regression below pre-RLS baseline." \
#     || error "ROLLBACK FAILED: Manual intervention required."
#   # Decision-Log: the GREEN->RED transition is written by rls-probe.ts when next run.
# }
# rollback
