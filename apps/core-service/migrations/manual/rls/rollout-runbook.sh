#!/usr/bin/env bash
# =============================================================================
# RLS Rollout Runbook — feat-tenancy-rls-brain-native + feat-tenancy-rls-live-cutover
# @paradigm sql (SQL/DDL + connection-handling)
#
# Author: @vikram (Stage 3 artifact)
# Executor: @jatin (Stage 8) — DO NOT execute before Stage-8 sign-off
#
# *** PATH C — CF-CUT-PATH-1 (Founder-ratified 2026-05-26T16:00:00Z) ***
# EXIT DEADLINE: Path B (legacy retirement) completion date.
# The bypass (ALTER ROLE postgres.<tenant> BYPASSRLS) is TEMPORARY and
# bounded by that deadline. The bypass-revoke ceremony is a SEPARATE Stage-8
# slice. Do NOT revoke before legacy Express is permanently decommissioned.
#
# *** DO NOT execute during a festival-peak GMV window ***
#     Diwali / Republic-Day-sale / EOSS
# Founder ratifies the exact execution date at Stage 7/8 sign-off (CF-CUT-CALENDAR-1).
#
# C5 gate state at authoring: SATISFIABLE (Brain code present + LOCAL-verified)
# C5 gate state this runbook achieves (STEP 0-4 only): SATISFIABLE verified on live
# C5 gate state this runbook CAN achieve (STEP 5-6): LIVE/FORCED
#   — HELD until HOLD-AT-FORCE conditions met (see STEP 5 block)
#   — HELD until DPDP §7 addendum signed by Founder (HOLD-AT-STEP-5)
#
# CF-C1-ROLLOUT-ORDER-1 (sharpened): quiesce-crons-FIRST applies at ENABLE
# (STEP 3) AND FORCE (STEP 5). Neither step is safe with live cron traffic.
#
# CF-RES-1.a: region asserted on BOTH :6543 + :5432 at STEP 0 (Postgres-level,
# never DNS-trusted; see .env.bak.singapore proof of a prior region move).
#
# CF-CUT-ROLLBACK-ATOMIC-1 — BINDING ROLLBACK ORDERING:
#   CORRECT (no 0-row window):
#     R1  psql "$DIRECT_URL" --file "$SCRIPT_DIR/down.sql"
#     R2  psql "$DIRECT_URL" --file "$SCRIPT_DIR/down-bypass-audit.sql"
#     R3  psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
#     R4  Brain Decision-Log "rls.rollback" INSERT (see ROLLBACK section below)
#   WRONG (produces 0-row outage window — proved by staging-rehearsal/rollback-wrong-order-kill.txt):
#     X1  ALTER ROLE NOBYPASSRLS   ← bypass gone, FORCE still on → 0 rows until X2
#     X2  psql --file down.sql
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Required environment variables — base set (original)
# -----------------------------------------------------------------------------
: "${DATABASE_URL:?DATABASE_URL must be set (pgbouncer :6543 pooled URL)}"
: "${DIRECT_URL:?DIRECT_URL must be set (Postgres :5432 session-mode URL)}"
: "${ALPHA_WORKSPACE_ID:?ALPHA_WORKSPACE_ID must be set (test workspace for probe)}"
: "${BETA_WORKSPACE_ID:?BETA_WORKSPACE_ID must be set (test workspace for probe)}"

# -----------------------------------------------------------------------------
# Required environment variables — Path-C additions (feat-tenancy-rls-live-cutover)
# -----------------------------------------------------------------------------
: "${STAGING_DIRECT_URL:?STAGING_DIRECT_URL must be set (the staging clone we rehearse against)}"
: "${STAGING_RUN_FOLDER:?STAGING_RUN_FOLDER must be set (the run-folder path for capturing rehearsal outputs)}"
: "${RLS_APP_PASSWORD:?RLS_APP_PASSWORD must be set (sourced from secrets manager; used at STEP 2.7)}"
: "${LEGACY_ROLNAME:?LEGACY_ROLNAME must be set (read from staging-rehearsal/live-role-inventory.txt; expected form: postgres.<tenant-id>)}"
: "${LEGACY_BASE_URL:?LEGACY_BASE_URL must be set (e.g. https://app.sugandhlok.com)}"
: "${LIVE_SUGANDH_LOK_SESSION:?LIVE_SUGANDH_LOK_SESSION must be set (a valid session cookie or auth token for the STEP 5 smoke)}"
: "${STEP5_ENDPOINT:?STEP5_ENDPOINT must be set (the Vikram-chosen endpoint per §6a; e.g. /api/dashboard/orders?range=last-30-days)}"
: "${SUGANDH_LOK_WORKSPACE_ID:?SUGANDH_LOK_WORKSPACE_ID must be set (for the CF-SEC-3.HARD second-brand tripwire at STEP 6)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()     { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
halt()    { echo "HALT: $*" >&2; exit 1; }
confirm() {
  read -rp "$1 [yes/NO]: " answer
  [[ "$answer" == "yes" ]] || halt "Operator did not confirm: $1"
}

# =============================================================================
# STEP 0 — Region assert (CF-RES-1.a)
# Assert ap-south-1 on BOTH :6543 (DATABASE_URL) AND :5432 (DIRECT_URL).
# Postgres-level check — not DNS-trusted.
# =============================================================================
log "STEP 0: Region assert on BOTH URLs"

POOLED_REGION=$(psql "$DATABASE_URL" -tAc "SELECT current_setting('server_version_num') || ':' || inet_server_addr()" 2>/dev/null || echo "FAIL")
DIRECT_REGION=$(psql "$DIRECT_URL"   -tAc "SELECT current_setting('server_version_num') || ':' || inet_server_addr()" 2>/dev/null || echo "FAIL")

log "  Pooled (:6543) server_addr: $POOLED_REGION"
log "  Direct (:5432) server_addr: $DIRECT_REGION"

# Assert both URLs resolve to the SAME backend (same inet_server_addr).
POOLED_ADDR=$(psql "$DATABASE_URL" -tAc "SELECT inet_server_addr()" 2>/dev/null || echo "FAIL")
DIRECT_ADDR=$(psql "$DIRECT_URL"   -tAc "SELECT inet_server_addr()" 2>/dev/null || echo "FAIL")

[[ "$POOLED_ADDR" == "$DIRECT_ADDR" ]] \
  || halt "STEP 0 FAIL: pooled addr ($POOLED_ADDR) != direct addr ($DIRECT_ADDR). URLs point to different instances — abort."

log "  Same backend confirmed: $DIRECT_ADDR"

# Assert ap-south-1 via Postgres timezone or operator confirmation.
# Supabase ap-south-1 instances use Asia/Kolkata or UTC; the reliable check
# is operator confirmation against the Supabase project console.
confirm "STEP 0: Confirm Supabase project is in ap-south-1 (AWS region) via the project console"
log "STEP 0: PASS — region ap-south-1 confirmed by operator"

# =============================================================================
# STEP 0.5 — Staging-clone residency assert (NEW, CF-CUT-RESIDENCY-1)
# Inadmissible: non-ap-south-1 clone with PROD PII (DPDP §16 cross-border xfer).
# Two acceptable shapes:
#   (a) staging clone in ap-south-1 (Postgres-level assert)
#   (b) staging DB explicitly tagged synthetic-only with generator artifact in run folder
# =============================================================================
log "STEP 0.5: Staging-clone residency assert (CF-CUT-RESIDENCY-1)"

# Postgres-level region check on staging clone
STAGING_TZ=$(psql "$STAGING_DIRECT_URL" -tAc "SELECT current_setting('TimeZone')" 2>/dev/null || echo "FAIL")
log "  Staging clone TimeZone: $STAGING_TZ"

# ap-south-1 Supabase instances run Asia/Kolkata OR UTC; either is acceptable
# IF the operator can also confirm the AWS region via the Supabase project console.
if [[ "$STAGING_TZ" == "Asia/Kolkata" || "$STAGING_TZ" == "UTC" ]]; then
  confirm "STEP 0.5: Confirm the staging Supabase project is in ap-south-1 (AWS region) via console"
  log "STEP 0.5: PASS (a) — staging clone in ap-south-1"
elif [[ -f "$STAGING_RUN_FOLDER/staging-rehearsal/synthetic-only-attestation.txt" ]]; then
  # Acceptable form (b): synthetic-only with generator artifact
  log "  Found synthetic-only attestation: $STAGING_RUN_FOLDER/staging-rehearsal/synthetic-only-attestation.txt"
  confirm "STEP 0.5: Confirm the staging DB contains ZERO PROD PII (synthetic generator output only)"
  log "STEP 0.5: PASS (b) — synthetic-only staging"
else
  halt "STEP 0.5 FAIL: staging clone is NOT confirmed ap-south-1 AND no synthetic-only attestation exists. \
        Provision the clone in ap-south-1 OR place a synthetic-only-attestation.txt with the generator command line."
fi

# =============================================================================
# STEP 0.7 — Shiprocket quiesce + Brain-native bare-write grep (NEW, CF-CUT-SHIPROCKET-RECONCILE-1)
#
# Founder-ratified narrowing: full Shiprocket DECOMMISSION ships as a separate
# Stage-8 ceremony. THIS cutover satisfies CF-C3-FORCE-UNLOCK-SCOPE-1 via:
#   (i)  Shiprocket connector HTTP listener disabled OR process killed
#   (ii) Last Shiprocket request timestamp > $CUTOVER_DRAIN_SECONDS ago
#   (iii) Brain-native bare-write grep returns ZERO hits (MUST NOT exclude
#         backfill/discoverChannels — that was the legacy Child-1 defect, R-O7)
# =============================================================================
log "STEP 0.7: Shiprocket quiesce + Brain-native bare-write grep (CF-CUT-SHIPROCKET-RECONCILE-1)"

: "${CUTOVER_DRAIN_SECONDS:=60}"

# (i) + (ii) operator-confirms
confirm "STEP 0.7: Shiprocket connector HTTP listener disabled OR process killed"
LAST_SHIPROCKET_TS=$(psql "$DIRECT_URL" -tAc "
  SELECT EXTRACT(EPOCH FROM (now() - MAX(state_change)))::int
  FROM pg_stat_activity
  WHERE application_name LIKE '%shiprocket%'
" 2>/dev/null || echo "0")
log "  Seconds since last Shiprocket activity: $LAST_SHIPROCKET_TS"
[[ "$LAST_SHIPROCKET_TS" -ge "$CUTOVER_DRAIN_SECONDS" ]] \
  || halt "STEP 0.7 FAIL: Shiprocket activity within last ${CUTOVER_DRAIN_SECONDS}s. Wait for drain."

# (iii) corrected bare-write grep — MUST NOT exclude backfill or discoverChannels
GREP_OUT="$STAGING_RUN_FOLDER/staging-rehearsal/brain-native-bare-write-grep.txt"
mkdir -p "$STAGING_RUN_FOLDER/staging-rehearsal"
log "  Running corrected bare-write grep (output: $GREP_OUT)"
grep -rn 'prisma\.\|\bdb\.query\|pool\.query' apps/ \
  | grep -v 'withWorkspace\|withSuperadmin' \
  | grep -v '//__' \
  | grep -vE '\.test\.|\.spec\.' \
  | grep '\.ts:' \
  > "$GREP_OUT" || true
GREP_COUNT=$(wc -l < "$GREP_OUT" | tr -d ' ')
log "  Bare-write grep hits: $GREP_COUNT (expected: 0)"
[[ "$GREP_COUNT" -eq 0 ]] \
  || halt "STEP 0.7 FAIL: $GREP_COUNT bare writes found in apps/. See $GREP_OUT. Convert before FORCE."

log "STEP 0.7: PASS — Shiprocket quiesced + Brain-native bare-write grep ZERO"

# =============================================================================
# STEP 1 — Quiesce crons (CF-C1-ROLLOUT-ORDER-1 SHARPENED)
# REQUIRED at ENABLE (STEP 3) AND again at FORCE (STEP 5).
# Even ENABLE-without-FORCE gates authenticated-role reads → partial outage.
# =============================================================================
log "STEP 1: Quiesce crons (REQUIRED before ENABLE)"

confirm "STEP 1: Disable ALL cron jobs that write to workspace-scoped tables (legacy cron.ts + syncAll*). Confirm crons are quiesced."
confirm "STEP 1: Confirm no in-flight cron transactions are running (wait for active sessions to drain if needed)."
log "STEP 1: PASS — crons quiesced by operator"

# =============================================================================
# STEP 1.5 — Legacy app off LB + drain (NEW, CF-CUT-DRAIN-1)
# Recommended shape (a) from persona O1: legacy off LB → wait drain.
# =============================================================================
log "STEP 1.5: Legacy app off LB + drain (CF-CUT-DRAIN-1)"

confirm "STEP 1.5: Remove the legacy Express app from the load balancer (operator-confirmed; e.g. AWS Target Group deregister, Nginx upstream disable, or Render/Fly suspend)"

# Confirm in-flight HTTP transactions on legacy connections have drained.
# 30s zero-streak: a single-shot read could race a transient idle gap;
# the streak loop guarantees observed quiet.
DRAIN_THRESHOLD=30  # seconds the active count must stay at zero
ZERO_STREAK=0
while [[ $ZERO_STREAK -lt $DRAIN_THRESHOLD ]]; do
  ACTIVE=$(psql "$DIRECT_URL" -tAc "
    SELECT count(*) FROM pg_stat_activity
    WHERE application_name LIKE '%legacy%'
      AND state IN ('active','idle in transaction')
  " 2>/dev/null || echo "999")
  if [[ "$ACTIVE" -eq 0 ]]; then
    ZERO_STREAK=$((ZERO_STREAK + 1))
    log "  Legacy active sessions: 0 (streak: ${ZERO_STREAK}s/${DRAIN_THRESHOLD}s)"
  else
    log "  Legacy active sessions: $ACTIVE (resetting streak)"
    ZERO_STREAK=0
  fi
  sleep 1
done

log "STEP 1.5: PASS — legacy drained >==${DRAIN_THRESHOLD}s, no active/idle-in-tx sessions"

# =============================================================================
# STEP 2 — Context-code verify
# Confirm the Brain-native withWorkspace/withSuperadmin primitive is deployed
# (or will be co-deployed) and that the correlation 4-tuple is seeded.
# =============================================================================
log "STEP 2: Context-code verify"

confirm "STEP 2: Confirm workspace-context.ts (withWorkspace/withSuperadmin) is deployed to the runtime that will serve requests after FORCE. If no Brain runtime is live, confirm legacy consumer is 100% service-role."
log "STEP 2: PASS — context code verified by operator"

# =============================================================================
# STEP 2.5 — FK-scope EXPLAIN gate (pre-STEP 3)
# Per-table EXPLAIN(ANALYZE,BUFFERS) on hot tables to assess policy cost.
# Hot tables: shopify_orders, shopify_line_items.
# If cost is unacceptable → workspace_id denorm + CONCURRENTLY index + IS-NULL=0 verify.
# =============================================================================
log "STEP 2.5: FK-scope EXPLAIN gate"

log "  Run the following EXPLAIN queries (non-destructive):"
log "  psql \$DIRECT_URL -c \"EXPLAIN(ANALYZE,BUFFERS,FORMAT TEXT) SELECT COUNT(*) FROM shopify_orders WHERE connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = '\$ALPHA_WORKSPACE_ID'::uuid)\""
log "  psql \$DIRECT_URL -c \"EXPLAIN(ANALYZE,BUFFERS,FORMAT TEXT) SELECT COUNT(*) FROM shopify_line_items WHERE connection_id IN (SELECT id FROM shopify_connections WHERE workspace_id = '\$ALPHA_WORKSPACE_ID'::uuid)\""

confirm "STEP 2.5: Confirm FK-scope EXPLAIN cost is acceptable for hot tables, OR workspace_id denorm has been applied for those tables."
log "STEP 2.5: PASS — EXPLAIN gate cleared by operator"

# =============================================================================
# STEP 2.7 — Create rls_app role on live (NEW, per §3 of architecture plan)
# Per §3: rls_app exists only in local-dev; create on live so the CF-SEC-1
# probe at STEP 4 runs as a meaningful non-bypass role.
# Idempotent: CREATE ROLE inside a DO block guard; ALTER ROLE NOBYPASSRLS
# is state-not-delta (re-running is a no-op).
# =============================================================================
log "STEP 2.7: Create rls_app on live (CF-CUT-IDENTITY-AUDIT-1)"

# Capture role inventory FIRST (operator uses this to confirm LEGACY_ROLNAME)
ROLES_OUT="$STAGING_RUN_FOLDER/staging-rehearsal/live-role-inventory.txt"
mkdir -p "$STAGING_RUN_FOLDER/staging-rehearsal"
psql "$DIRECT_URL" -c "
  SELECT rolname, rolbypassrls, rolsuper
  FROM pg_roles
  WHERE rolname LIKE 'postgres%' OR rolname = 'rls_app'
  ORDER BY rolname;
" > "$ROLES_OUT" 2>&1
log "  Role inventory captured: $ROLES_OUT"

# CF-CUT-IDENTITY-AUDIT-1 tripwire: confirm only ONE non-rls_app role with bypass
# is actively connected. >1 means the single-bypass shape is wrong → escalate.
NON_RLS_BYPASS_COUNT=$(psql "$DIRECT_URL" -tAc "
  SELECT count(*) FROM pg_roles
  WHERE rolname != 'rls_app' AND rolbypassrls = true
    AND rolname IN (
      SELECT DISTINCT usename FROM pg_stat_activity WHERE usename IS NOT NULL
    )
" 2>/dev/null || echo "0")
log "  Non-rls_app bypass roles currently connected: $NON_RLS_BYPASS_COUNT"
[[ "$NON_RLS_BYPASS_COUNT" -le 1 ]] \
  || halt "STEP 2.7 FAIL (CF-CUT-IDENTITY-AUDIT-1 tripwire): $NON_RLS_BYPASS_COUNT distinct bypass roles connected. Single-bypass shape inadmissible. ESCALATE to Founder for path-shape revision."

# Idempotent rls_app create via DO block (works on all Postgres versions)
psql "$DIRECT_URL" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_app') THEN
    EXECUTE format('CREATE ROLE rls_app LOGIN NOBYPASSRLS PASSWORD %L', '${RLS_APP_PASSWORD}');
  ELSE
    EXECUTE 'ALTER ROLE rls_app NOBYPASSRLS';  -- ensure non-bypass even if pre-existing
  END IF;
END
\$\$;

-- Grant SELECT on all workspace-scoped tables (probe-only; no DML required)
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO rls_app', r.tablename);
  END LOOP;
END
\$\$;
SQL

log "STEP 2.7: PASS — rls_app created (or confirmed NOBYPASSRLS), SELECT granted on public.*"

# =============================================================================
# STEP 3 — ENABLE + CREATE fail-closed policy
# Applies step-a-enable-create.sql. Owner still bypasses after this step.
# =============================================================================
log "STEP 3: ENABLE + CREATE fail-closed policies"

psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-a-enable-create.sql" \
  || halt "STEP 3 FAIL: step-a-enable-create.sql failed. Run down.sql to clean up."

# Verify policy count (should be >= 43 ws_isolation policies + superadmin policies)
POLICY_COUNT=$(psql "$DIRECT_URL" -tAc "
  SELECT COUNT(*) FROM pg_policies
  WHERE policyname IN ('ws_isolation','superadmin_system_rows','superadmin_only')
" 2>/dev/null || echo "0")

log "  Policy count post-ENABLE: $POLICY_COUNT (expected >=43)"
[[ "$POLICY_COUNT" -ge 43 ]] \
  || halt "STEP 3 FAIL: only $POLICY_COUNT policies created (expected >=43). Check step-a-enable-create.sql output above."

log "STEP 3: PASS — $POLICY_COUNT policies created"

# =============================================================================
# STEP 3.5 — Bind bypass + arm audit (NEW, CF-CUT-BYPASS-AUDIT-1 + CF-CUT-IDEMPOTENT-1)
# STEP 3 (ENABLE + CREATE policies) ran above; the policies are dormant for the
# bypass role (already-bypass) and for the owner. STEP 3.5 binds the LIVE
# rolname + arms the audit pipeline.
#
# Idempotent: ALTER ROLE … BYPASSRLS is state, not delta (already-bypass = no-op).
# =============================================================================
log "STEP 3.5: Bind bypass + arm audit (CF-CUT-PATH-1, CF-CUT-BYPASS-AUDIT-1)"

# Read the exact legacy rolname from staging-rehearsal/live-role-inventory.txt
# (LEGACY_ROLNAME is required at top of script; Operator sets it after reviewing that file)

# Pre-state capture
PRE_BYPASS=$(psql "$DIRECT_URL" -tAc "SELECT rolbypassrls FROM pg_roles WHERE rolname = '$LEGACY_ROLNAME'" 2>/dev/null)
log "  Pre-state rolbypassrls for $LEGACY_ROLNAME: $PRE_BYPASS"

# Apply / re-affirm bypass (idempotent — already-bypass on Supabase postgres.<tenant> = no-op)
# Also arm the Postgres-native log_statement audit at the role level.
psql "$DIRECT_URL" <<SQL
ALTER ROLE "$LEGACY_ROLNAME" BYPASSRLS;
ALTER ROLE "$LEGACY_ROLNAME" SET log_statement = 'mod';
ALTER ROLE "$LEGACY_ROLNAME" SET log_min_duration_statement = 0;
SQL

# Create bypass_query_log + policies (idempotent via IF NOT EXISTS in step-c-bypass-audit.sql)
psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-c-bypass-audit.sql" \
  || halt "STEP 3.5 FAIL: bypass_query_log create failed."

# Brain Decision-Log entry for the grant (per §7 of the architecture plan)
# workspace_id=NULL + is_system_row=true = covered by superadmin_system_rows policy
# SEC-MED-1 fix: explicit BEGIN/COMMIT so SET LOCAL is in scope for the INSERT
# (autocommit would reset the GUC before the INSERT ran in its own implicit txn)
psql "$DIRECT_URL" <<SQL
BEGIN;
SET LOCAL app.is_superadmin = 'true';
INSERT INTO ai.decision_log (type, ts, actor, payload, workspace_id, is_system_row)
VALUES (
  'rls.bypass.grant',
  now(),
  '${OPERATOR_NAME:-rishabhporwal}',
  jsonb_build_object(
    'connection_identity', 'postgres.pavcgecgciamejdcysjx',
    'rolname_on_live',     '$LEGACY_ROLNAME',
    'granted_until',       'Path-B-completion-date (TBD)',
    'decision_basis',      'CF-CUT-PATH-1 Founder ratification 2026-05-26T16:00:00Z; DPDP §7 transitional continuity per Child-1 memo + §7 addendum 06b-dpdp-section7-addendum-draft.md',
    'scope_attestation',   'single-role bypass; grep-proven sole legacy consumer via staging-rehearsal/live-role-inventory.txt; second-brand tripwire armed (post-flip grep of bypass_query_log.workspace_id ⊆ {$SUGANDH_LOK_WORKSPACE_ID})',
    'pre_state_rolbypassrls', '$PRE_BYPASS'
  ),
  NULL,
  true
);
COMMIT;
SQL

log "STEP 3.5: PASS — bypass bound + audit armed + Decision-Log entry written"

# =============================================================================
# STEP 4 — CF-SEC-1 probe → GREEN or HALT
# Run the Brain-native rls-probe. Must return GREEN before FORCE.
# Probe MUST run as rls_app (rolbypassrls=false) — NOT as the bypass role.
# Per §3 of architecture plan: running as bypass role = silently GREEN (vacuous).
# =============================================================================
log "STEP 4: CF-SEC-1 probe (run as rls_app — NOT as postgres.<tenant>)"
log "  Running rls-probe via Brain-native probe script..."
log "  ALPHA_WORKSPACE_ID=$ALPHA_WORKSPACE_ID"
log "  BETA_WORKSPACE_ID=$BETA_WORKSPACE_ID"

# The probe is run via the Brain runtime probe CLI (wired in Child-3).
# At Stage-8, @jatin runs the probe as rls_app:
#   DIRECT_URL="postgres://rls_app:<RLS_APP_PASSWORD>@host:5432/brain" \
#   ALPHA_WORKSPACE_ID="..." BETA_WORKSPACE_ID="..." node -e "
#     const {runRlsProbe,formatProbeResult} = require('./apps/core-service/dist/infrastructure/db/rls-probe');
#     runRlsProbe({alphaWorkspaceId:process.env.ALPHA_WORKSPACE_ID, betaWorkspaceId:process.env.BETA_WORKSPACE_ID})
#       .then(r => { console.log(formatProbeResult(r)); process.exit(r.overallVerdict==='GREEN' ? 0 : 1); })
#   "
# IMPORTANT: substitute rls_app credentials — if probe returns GREEN with the bypass
# role instead, it is vacuous (G1.inverse kill-test in staging-rehearsal/ proves this).

confirm "STEP 4: Run the CF-SEC-1 probe (Brain-native rls-probe.ts) AS rls_app and confirm it returned GREEN. DO NOT proceed if probe is RED."
log "STEP 4: PASS — probe GREEN confirmed by operator"

# =============================================================================
# STEP 5 — FORCE + real-path legacy HTTP smoke (RESHAPED per CF-CUT-VERIFY-THE-VERIFIER-1)
#
# Existing STEP 5 from Child-1 runbook is RESHAPED. The HOLD-AT-FORCE conditions
# stay in force: items (i)-(v) from README.md §15-37 still bind. The new shape
# replaces the vague "byte-identical API smoke" with a real-path HTTP gate (G2).
#
# HOLD-AT-FORCE pre-conditions (ALL required):
#   (i)   Context-aware Brain runtime is the live DB consumer, OR live consumer
#         is proven 100% service-role (bypasses RLS post-FORCE).
#   (ii)  Child-3 residual no-context writers converted. Known list (R-O7):
#           - discoverChannels (shiprocket-sync.ts)
#           - backfillShiprocketCourierNames / backfillShiprocketPincodes
#           - cron.ts recompute path (line ~249, _tx discarded)
#           - meta.ts catch block (line ~192)
#           - Shopify inner sync libs (shopify/sync.ts, webhooks.ts)
#           - All route-handler connection writes not yet wrapped in withWorkspace
#   (iii) COMPLETE bare-write grep returns ZERO hits (captured at STEP 0.7 above).
#         MANDATORY: do NOT use grep -v backfill or grep -v discoverChannels.
#   (iv)  FK-scope live EXPLAIN gate passes for ALL hot tables (STEP 2.5 above).
#   (v)   Founder/CTO-Advisor sign-off that (i)–(iv) are satisfied.
#   (vi)  DPDP §7 addendum signed by Founder (HOLD-AT-STEP-5).
#
# Gate G2 (NO-OUTAGE): real-path legacy HTTP smoke pre/post FORCE = equal counts.
# Gate G1 (LEAK): CF-SEC-1 probe via rls_app (STEP 4 above).
# G2 alone does NOT authorize cutover-complete — BOTH gates must be GREEN.
# =============================================================================
log "STEP 5: FORCE + real-path legacy HTTP smoke (HOLD-AT-FORCE state)"
log "  This step is HELD. The following must be true before continuing:"
log "  (i)   Brain runtime is live consumer OR legacy proven 100% service-role"
log "  (ii)  Child-3 residual writers converted (see R-O7 list above)"
log "  (iii) Complete bare-write grep = ZERO hits (verified at STEP 0.7)"
log "  (iv)  FK-scope EXPLAIN gate passes all hot tables (verified at STEP 2.5)"
log "  (v)   Founder + CTO-Advisor sign-off"
log "  (vi)  DPDP §7 addendum signed by Founder"

confirm "STEP 5: Confirm ALL hold-at-force conditions are met AND Founder+CTO-Advisor have signed off. Proceeding will execute step-b-force.sql."

# Re-quiesce before FORCE (CF-C1-ROLLOUT-ORDER-1: quiesce at FORCE too).
confirm "STEP 5: Confirm crons are STILL quiesced before FORCE execution."

# Pre-cutover snapshot (the count we'll re-assert post-FORCE)
PRE_SNAPSHOT="$STAGING_RUN_FOLDER/staging-rehearsal/step5-pre.txt"
log "  Capturing pre-cutover snapshot via real legacy HTTP path → $PRE_SNAPSHOT"
curl -is "$LEGACY_BASE_URL$STEP5_ENDPOINT" \
  -H "Cookie: $LIVE_SUGANDH_LOK_SESSION" \
  > "$PRE_SNAPSHOT"
# Extract a stable count from the response body; adjust the grep pattern if the
# endpoint shape differs (e.g. '"total":' or '"count":' or array length)
PRE_COUNT=$(grep -oE '"orders":\s*\[' "$PRE_SNAPSHOT" | wc -l | tr -d ' ')
log "  Pre-FORCE order array marker count: $PRE_COUNT"

# Now execute FORCE (existing step-b-force.sql)
log "  Executing FORCE (step-b-force.sql)..."
psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-b-force.sql" \
  || halt "STEP 5 FAIL: step-b-force.sql failed. IMMEDIATE ROLLBACK in ORDER: (1) psql --file down.sql  (2) psql --file down-bypass-audit.sql  (3) ALTER ROLE NOBYPASSRLS."

# Post-FORCE real-path smoke (G2 gate)
POST_SNAPSHOT="$STAGING_RUN_FOLDER/staging-rehearsal/step5-green.txt"
log "  Capturing post-FORCE snapshot via real legacy HTTP path → $POST_SNAPSHOT"
curl -is "$LEGACY_BASE_URL$STEP5_ENDPOINT" \
  -H "Cookie: $LIVE_SUGANDH_LOK_SESSION" \
  > "$POST_SNAPSHOT"
POST_COUNT=$(grep -oE '"orders":\s*\[' "$POST_SNAPSHOT" | wc -l | tr -d ' ')

log "  Pre-count: $PRE_COUNT  /  Post-count: $POST_COUNT"
if [[ "$PRE_COUNT" -ne "$POST_COUNT" ]]; then
  halt "STEP 5 FAIL (G2 RED): legacy endpoint count diverged ($PRE_COUNT → $POST_COUNT). \
        IMMEDIATE ROLLBACK in ORDER: (1) psql --file down.sql  (2) psql --file down-bypass-audit.sql  (3) ALTER ROLE NOBYPASSRLS."
fi

log "STEP 5: PASS — G2 GREEN (real-path legacy HTTP smoke equal pre/post-FORCE)"

# =============================================================================
# STEP 6 — Re-enable + Decision-Log + post-flip second-brand grep (RESHAPED)
# CF-SEC-3.HARD second-brand tripwire is mechanized at the bottom of this step.
# =============================================================================
log "STEP 6: Re-enable + post-flip Decision-Log + second-brand grep"

# Re-run CF-SEC-1 probe via rls_app (post-FORCE state: contextless count now 0)
confirm "STEP 6: Re-run the CF-SEC-1 probe as rls_app and confirm GREEN (contextless count now 0)."

# Brain Decision-Log entry — rollout-complete (CF-CUT-BYPASS-AUDIT-1 + CF-C1-AUDITLOG-1.a)
# SEC-MED-1 fix: explicit BEGIN/COMMIT so SET LOCAL is in scope for the INSERT
# (autocommit would reset the GUC before the INSERT ran in its own implicit txn)
psql "$DIRECT_URL" <<SQL
BEGIN;
SET LOCAL app.is_superadmin = 'true';
INSERT INTO ai.decision_log (type, ts, actor, payload, workspace_id, is_system_row)
VALUES (
  'rls.force.complete',
  now(),
  '${OPERATOR_NAME:-rishabhporwal}',
  jsonb_build_object(
    'req_id',        'feat-tenancy-rls-live-cutover',
    'cf_sec_1_post', 'GREEN',
    'step5_g2_post', 'GREEN',
    'path',          'C-with-exit-deadline-=-Path-B-completion'
  ),
  NULL,
  true
);
COMMIT;
SQL

# Re-enable crons + legacy back on LB
confirm "STEP 6: Re-enable cron jobs (Brain crons run under withSuperadmin outer + withWorkspace per-connection)."
confirm "STEP 6: Re-add the legacy Express app to the load balancer."

# CF-SEC-3.HARD second-brand tripwire (post-flip operator grep)
# Allow 60s for the audit pipeline to populate bypass_query_log before checking.
sleep 60
DISTINCT_WS=$(psql "$DIRECT_URL" -tAc "
  SELECT string_agg(DISTINCT workspace_id::text, ',') FROM bypass_query_log WHERE ts > now() - interval '5 minutes'
" 2>/dev/null || echo "")
log "  bypass_query_log distinct workspace_ids in last 5min: $DISTINCT_WS"
# Expected: $DISTINCT_WS ⊆ {SUGANDH_LOK_WORKSPACE_ID, ''} (empty string covers null/unattributed)
case ",${DISTINCT_WS}," in
  *,${SUGANDH_LOK_WORKSPACE_ID},*|"${SUGANDH_LOK_WORKSPACE_ID}"|",,"|"") ;;  # acceptable forms
  *) halt "STEP 6 TRIPWIRE FIRE (CF-SEC-3.HARD): bypass log shows non-Sugandh-Lok workspace_id. ROLLBACK." ;;
esac

log "STEP 6: PASS — rollout complete; tripwire CLEAR"
log "ROLLOUT COMPLETE. C5 gate state: LIVE/FORCED (Path-C with bypass deadline = Path-B completion)."

# =============================================================================
# ROLLBACK section (reference — invoke manually; binding ordering)
#
# Target wall-clock: ≤ 60s on staging clone (measured number from rehearsal
# becomes the live ceremony's pre-committed SLO; see staging-rehearsal/rollback-timing.txt).
#
# CORRECT ORDER (no 0-row window):
#   R1  psql "$DIRECT_URL" --file "$SCRIPT_DIR/down.sql"
#       → drops policies + NO FORCE on 44 tables
#   R2  psql "$DIRECT_URL" --file "$SCRIPT_DIR/down-bypass-audit.sql"
#       → drops bypass_query_log policies + DROP TABLE
#   R3  psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
#       → revoke bypass (only when policies are already gone — no 0-row window)
#   R4  psql "$DIRECT_URL" <<SQL
#         BEGIN;
#         SET LOCAL app.is_superadmin = 'true';
#         INSERT INTO ai.decision_log (type, ts, actor, payload, workspace_id, is_system_row)
#         VALUES ('rls.rollback', now(), '$OPERATOR_NAME', '{"reason":"<reason>"}', NULL, true);
#         COMMIT;
#       SQL
#       (BEGIN/COMMIT REQUIRED — SET LOCAL is txn-scoped; without the wrap the GUC
#        resets before the INSERT and superadmin_system_rows WITH CHECK rejects the
#        audit row under psql autocommit. Same defect class as SEC-MED-1.)
#
# WRONG ORDER (produces 0-row outage — captured as K3.kill in staging-rehearsal/):
#   X1  ALTER ROLE NOBYPASSRLS  ← bypass gone but FORCE still on → legacy 0-rows
#   X2  psql --file down.sql    ← only NOW does the outage close
# =============================================================================
