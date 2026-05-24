#!/usr/bin/env bash
# =============================================================================
# RLS Rollout Runbook — feat-tenancy-rls-brain-native
# @paradigm sql (SQL/DDL + connection-handling)
#
# Author: @vikram (Stage 3 artifact)
# Executor: @jatin (Stage 8) — DO NOT execute before Stage-8 sign-off
#
# C5 gate state at authoring: SATISFIABLE (Brain code present + LOCAL-verified)
# C5 gate state this runbook achieves (STEP 0-4 only): SATISFIABLE verified on live
# C5 gate state this runbook CAN achieve (STEP 5-6): LIVE/FORCED
#   — HELD until HOLD-AT-FORCE conditions met (see STEP 5 block)
#
# CF-C1-ROLLOUT-ORDER-1 (sharpened): quiesce-crons-FIRST applies at ENABLE
# (STEP 3) AND FORCE (STEP 5). Neither step is safe with live cron traffic.
#
# CF-RES-1.a: region asserted on BOTH :6543 + :5432 at STEP 0 (Postgres-level,
# never DNS-trusted; see .env.bak.singapore proof of a prior region move).
#
# ROLLBACK: psql "$DIRECT_URL" --file down.sql (idempotent)
# =============================================================================

set -euo pipefail

# Required environment variables
: "${DATABASE_URL:?DATABASE_URL must be set (pgbouncer :6543 pooled URL)}"
: "${DIRECT_URL:?DIRECT_URL must be set (Postgres :5432 session-mode URL)}"
: "${ALPHA_WORKSPACE_ID:?ALPHA_WORKSPACE_ID must be set (test workspace for probe)}"
: "${BETA_WORKSPACE_ID:?BETA_WORKSPACE_ID must be set (test workspace for probe)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
halt() { echo "HALT: $*" >&2; exit 1; }
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
# STEP 1 — Quiesce crons (CF-C1-ROLLOUT-ORDER-1 SHARPENED)
# REQUIRED at ENABLE (STEP 3) AND again at FORCE (STEP 5).
# Even ENABLE-without-FORCE gates authenticated-role reads → partial outage.
# =============================================================================
log "STEP 1: Quiesce crons (REQUIRED before ENABLE)"

confirm "STEP 1: Disable ALL cron jobs that write to workspace-scoped tables (legacy cron.ts + syncAll*). Confirm crons are quiesced."
confirm "STEP 1: Confirm no in-flight cron transactions are running (wait for active sessions to drain if needed)."
log "STEP 1: PASS — crons quiesced by operator"

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
# STEP 4 — CF-SEC-1 probe → GREEN or HALT
# Run the Brain-native rls-probe. Must return GREEN before FORCE.
# Probe must run as a non-owner role (subject to RLS) for a meaningful GREEN.
# =============================================================================
log "STEP 4: CF-SEC-1 probe"
log "  Running rls-probe via Brain-native probe script..."
log "  ALPHA_WORKSPACE_ID=$ALPHA_WORKSPACE_ID"
log "  BETA_WORKSPACE_ID=$BETA_WORKSPACE_ID"

# The probe is run via the Brain runtime probe CLI (to be wired in Child-3).
# At Stage-8, @jatin runs the probe as a non-owner DB role:
#   DIRECT_URL="postgres://rls_test_role:password@host:5432/brain" \
#   ALPHA_WORKSPACE_ID="..." BETA_WORKSPACE_ID="..." node -e "
#     const {runRlsProbe,formatProbeResult} = require('./apps/core-service/dist/infrastructure/db/rls-probe');
#     runRlsProbe({alphaWorkspaceId:process.env.ALPHA_WORKSPACE_ID, betaWorkspaceId:process.env.BETA_WORKSPACE_ID})
#       .then(r => { console.log(formatProbeResult(r)); process.exit(r.overallVerdict==='GREEN' ? 0 : 1); })
#   "

confirm "STEP 4: Run the CF-SEC-1 probe (Brain-native rls-probe.ts) and confirm it returned GREEN. DO NOT proceed if probe is RED."
log "STEP 4: PASS — probe GREEN confirmed by operator"

# =============================================================================
# STEP 5 — FORCE ROW LEVEL SECURITY — *** HELD *** (HOLD-AT-FORCE state)
#
# DO NOT RUN step-b-force.sql until ALL conditions below are met.
# This is the structural moment: after FORCE, any caller without workspace
# context gets 0 rows — including legacy sync paths.
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
#   (iii) COMPLETE bare-write grep returns ZERO hits.
#         MANDATORY: do NOT use grep -v backfill or grep -v discoverChannels.
#         The legacy Child-1 grep was DEFECTIVE by excluding those paths (R-O7).
#         Correct grep:
#           grep -rn "prisma\.\|db\.\|pool\." apps/core-service/src/ \
#             | grep -v "withWorkspace\|withSuperadmin\|//\|\.test\.\|\.spec\."
#         (Adapt pattern for the actual ORM/client name in use at Child-3.)
#   (iv)  FK-scope live EXPLAIN gate passes for ALL hot tables (STEP 2.5 above).
#   (v)   Founder/CTO-Advisor sign-off that (i)–(iv) are satisfied.
# =============================================================================
log "STEP 5: FORCE — HELD (HOLD-AT-FORCE state)"
log "  This step is HELD. The following must be true before continuing:"
log "  (i)   Brain runtime is live consumer OR legacy proven 100% service-role"
log "  (ii)  Child-3 residual writers converted (see R-O7 list above)"
log "  (iii) Complete bare-write grep = ZERO hits (must NOT grep -v backfill/discoverChannels)"
log "  (iv)  FK-scope EXPLAIN gate passes all hot tables"
log "  (v)   Founder + CTO-Advisor sign-off"
log ""
log "  COMPLETE BARE-WRITE GREP (STEP 5 prerequisite — run this and verify 0 hits):"
log "  grep -rn 'prisma\\|\\bdb\\.query\\|pool\\.query' apps/ \\"
log "    | grep -v 'withWorkspace\\|withSuperadmin' \\"
log "    | grep -v '//__' \\"
log "    | grep -v '\\.test\\.\|\.spec\\.' \\"
log "    | grep '\\.ts:'"
log "  NOTE: backfill and discoverChannels MUST appear in this grep — do not exclude them."
log "  If any line appears, those writers must be converted before FORCE."
log ""
log "  TO FORCE (when all conditions met):"
log "  psql \"\$DIRECT_URL\" --file \"\$SCRIPT_DIR/step-b-force.sql\""
log ""

confirm "STEP 5: Confirm ALL hold-at-force conditions are met AND Founder+CTO-Advisor have signed off. Proceeding will execute step-b-force.sql."

# Re-quiesce before FORCE (CF-C1-ROLLOUT-ORDER-1: quiesce at FORCE too).
confirm "STEP 5: Confirm crons are STILL quiesced before FORCE execution."

psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-b-force.sql" \
  || halt "STEP 5 FAIL: step-b-force.sql failed. Run down.sql to roll back."

log "STEP 5: PASS — FORCE applied"

# =============================================================================
# STEP 6 — Byte-identical smoke + re-probe
# =============================================================================
log "STEP 6: Byte-identical smoke + re-probe"

log "  Re-running CF-SEC-1 probe post-FORCE (should be GREEN; now contextless=0 too)..."
confirm "STEP 6: Run the CF-SEC-1 probe again (post-FORCE) and confirm GREEN. Contextless count should now be 0."

log "  Running byte-identical API smoke..."
confirm "STEP 6: Run the byte-identical API corpus smoke against a fixed request set and confirm all responses are identical pre/post RLS."

log "  Re-enabling crons..."
confirm "STEP 6: Re-enable cron jobs (they now run under withSuperadmin outer enumeration + withWorkspace per-connection)."

log "STEP 6: PASS — smoke GREEN, probe GREEN, crons re-enabled"
log ""
log "ROLLOUT COMPLETE. C5 gate state: LIVE/FORCED."
log "Decision-Log entry for this run: see audit_logs (rls.probe.transition action, workspace_id=NULL)."

# =============================================================================
# ROLLBACK section (reference — do not source from here; run manually)
# =============================================================================
# psql "$DIRECT_URL" --file "$SCRIPT_DIR/down.sql"
# Verify: SELECT COUNT(*) FROM pg_policies WHERE policyname = 'ws_isolation';
# Expected: 0
