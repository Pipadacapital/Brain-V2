#!/usr/bin/env bash
# =============================================================================
# post-flip-second-brand-grep.sh
# @paradigm sql
#
# CF-SEC-3.HARD second-brand tripwire (T3.2 of Track T3).
#
# Queries bypass_query_log for distinct workspace_ids in the last N minutes.
# Exits non-zero if any workspace_id OTHER than SUGANDH_LOK_WORKSPACE_ID appears.
# NULL rows (unattributed bypass queries) are NOT a tripwire — they are expected
# (system-level or context-less queries from legacy internal paths).
#
# Extracted from STEP 6 of rollout-runbook.sh for re-runnability.
# Run: at STEP 6 AND on demand post-cutover (e.g. every 15 minutes via cron).
#
# Usage:
#   DIRECT_URL="postgres://..." \
#   SUGANDH_LOK_WORKSPACE_ID="<uuid>" \
#     ./post-flip-second-brand-grep.sh
#
# Optional:
#   LOOKBACK_MINUTES  — minutes to look back in bypass_query_log (default: 15)
#
# Exit codes:
#   0 — CLEAR: only Sugandh-Lok workspace_id (or null) observed
#   1 — TRIPWIRE: non-Sugandh-Lok workspace_id found; immediate rollback required
#   2 — ERROR: could not query DB
#
# Required environment variables:
#   DIRECT_URL                  — Postgres :5432 session-mode URL
#   SUGANDH_LOK_WORKSPACE_ID    — the UUID of the Sugandh-Lok workspace
# =============================================================================

set -uo pipefail

: "${DIRECT_URL:?DIRECT_URL must be set}"
: "${SUGANDH_LOK_WORKSPACE_ID:?SUGANDH_LOK_WORKSPACE_ID must be set}"

LOOKBACK_MINUTES="${LOOKBACK_MINUTES:-15}"

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] second-brand-grep: $*"; }
fail() { echo "TRIPWIRE: $*" >&2; exit 1; }
err()  { echo "ERROR: $*" >&2; exit 2; }

log "Checking bypass_query_log for non-Sugandh-Lok workspace_ids in last ${LOOKBACK_MINUTES} minutes..."

# Query distinct non-null workspace_ids that are NOT Sugandh-Lok
FOREIGN_WS=$(psql "$DIRECT_URL" -tAc "
  SELECT string_agg(DISTINCT workspace_id::text, E'\n')
  FROM bypass_query_log
  WHERE ts > now() - interval '${LOOKBACK_MINUTES} minutes'
    AND workspace_id IS NOT NULL
    AND workspace_id != '${SUGANDH_LOK_WORKSPACE_ID}'::uuid
" 2>/dev/null) || err "psql query failed — check DIRECT_URL and table existence."

if [[ -z "$FOREIGN_WS" ]]; then
  log "CLEAR — no non-Sugandh-Lok workspace_ids in last ${LOOKBACK_MINUTES}min."
  exit 0
else
  log "TRIPWIRE FIRE (CF-SEC-3.HARD): foreign workspace_ids found:"
  echo "$FOREIGN_WS"
  log "ACTION REQUIRED: immediate rollback per CF-CUT-ROLLBACK-ATOMIC-1 ordering:"
  log "  R1  psql \$DIRECT_URL --file down.sql"
  log "  R2  psql \$DIRECT_URL --file down-bypass-audit.sql"
  log "  R3  psql \$DIRECT_URL -c \"ALTER ROLE \\\"\$LEGACY_ROLNAME\\\" NOBYPASSRLS\""
  log "  R4  Brain Decision-Log rls.rollback INSERT"
  fail "non-Sugandh-Lok workspace_id detected in bypass_query_log"
fi
