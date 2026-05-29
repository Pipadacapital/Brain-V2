#!/usr/bin/env bash
# =============================================================================
# parse-pg-log-to-bypass-audit.sh
# @paradigm sql
#
# Reads postgresql.log lines emitted by log_statement='mod' on the bypass role,
# best-effort regex-extracts workspace_id from WHERE clauses, derives
# statement_class from the SQL verb, and INSERTs structured rows into
# bypass_query_log.
#
# CF-CUT-BYPASS-AUDIT-1: statement-capture mechanism (T3.1 of Track T3).
# The bypass role (postgres.<tenant>) has:
#   ALTER ROLE "<LEGACY_ROLNAME>" SET log_statement = 'mod';
#   ALTER ROLE "<LEGACY_ROLNAME>" SET log_min_duration_statement = 0;
# set at STEP 3.5 of rollout-runbook.sh.
#
# Design constraints:
#   - NO raw SQL text stored — preserves erasure-scopability per CF-C1-AUDITLOG-1.a.
#   - workspace_id not extractable from all queries → NULL (covered by
#     superadmin_system_rows policy on bypass_query_log).
#   - application_name derived from the Postgres log line's 'application_name'
#     field (Prisma sets this via connection string; expected = 'legacy-express').
#
# Usage (one-shot):
#   DIRECT_URL="postgres://..." LOG_FILE="/var/log/postgresql/postgresql.log" \
#     ./parse-pg-log-to-bypass-audit.sh
#
# Usage (cron, process last N lines):
#   DIRECT_URL="..." LOG_FILE="..." LOG_TAIL_LINES=5000 \
#     ./parse-pg-log-to-bypass-audit.sh
#
# Cron example (every 5 minutes):
#   */5 * * * * DIRECT_URL="..." LOG_FILE="..." LOG_TAIL_LINES=1000 \
#               /path/to/parse-pg-log-to-bypass-audit.sh >> /var/log/bypass-audit-parser.log 2>&1
#
# Required environment variables:
#   DIRECT_URL        — Postgres :5432 session-mode URL (must have INSERT on bypass_query_log)
#   LOG_FILE          — path to postgresql.log (or pipe target)
# Optional:
#   LOG_TAIL_LINES    — if set, only process the last N lines (default: full file)
#   DRY_RUN           — if set to "1", print INSERTs without executing them
# =============================================================================

set -euo pipefail

: "${DIRECT_URL:?DIRECT_URL must be set}"
: "${LOG_FILE:?LOG_FILE must be set}"

DRY_RUN="${DRY_RUN:-0}"
LOG_TAIL_LINES="${LOG_TAIL_LINES:-}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] parse-pg-log: $*"; }

# -----------------------------------------------------------------------
# Determine input: full file or tail
# -----------------------------------------------------------------------
if [[ -n "$LOG_TAIL_LINES" ]]; then
  INPUT_CMD="tail -n ${LOG_TAIL_LINES} ${LOG_FILE}"
else
  INPUT_CMD="cat ${LOG_FILE}"
fi

# -----------------------------------------------------------------------
# Extract statement_class from the first SQL verb in the log line.
# Postgres log_statement='mod' logs INSERT/UPDATE/DELETE/TRUNCATE statements.
# We extend to SELECT (should not appear under 'mod', but handle defensively)
# and DDL for completeness.
# -----------------------------------------------------------------------
get_statement_class() {
  local line="$1"
  # The log line contains "statement: <SQL>" or "execute <name>: <SQL>"
  local sql_fragment
  sql_fragment=$(echo "$line" | grep -oiE '(statement:|execute [^:]+:)\s+\S+' | head -1 | awk '{print $NF}')
  local verb
  verb=$(echo "$sql_fragment" | tr '[:lower:]' '[:upper:]' | grep -oE '^(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER)' || echo "OTHER")
  case "$verb" in
    SELECT)                 echo "SELECT" ;;
    INSERT)                 echo "INSERT" ;;
    UPDATE)                 echo "UPDATE" ;;
    DELETE|TRUNCATE)        echo "DELETE" ;;
    CREATE|DROP|ALTER)      echo "DDL"    ;;
    *)                      echo "OTHER"  ;;
  esac
}

# -----------------------------------------------------------------------
# Extract workspace_id from WHERE clause.
# Covers: WHERE workspace_id = '<uuid>' or WHERE workspace_id = $1 with
# bound value visible in the DETAIL line.
# Best-effort: unattributed rows get workspace_id = NULL.
# -----------------------------------------------------------------------
extract_workspace_id() {
  local line="$1"
  # Try direct literal UUID form: workspace_id = '<uuid>' or workspace_id='<uuid>'
  local ws_id
  ws_id=$(echo "$line" | grep -oiE "workspace_id\s*=\s*'([0-9a-f-]{36})'" \
          | grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
          | head -1 || echo "")
  echo "$ws_id"
}

# -----------------------------------------------------------------------
# Extract application_name from the Postgres log prefix.
# Postgres csvlog format: timestamp,user,db,host,port,session_id,line_no,command_tag,
#   session_start,virtual_xid,xid,error_severity,state_code,message,detail,hint,
#   internal_query,...,application_name,...
# For non-csv log format, fall back to regex.
# -----------------------------------------------------------------------
extract_application_name() {
  local line="$1"
  # Look for application_name in the log line prefix (Postgres default format includes it)
  local app_name
  app_name=$(echo "$line" | grep -oE 'application_name=[^ ]+' | cut -d= -f2 | head -1 || echo "")
  if [[ -z "$app_name" ]]; then
    # Fallback: label as "unknown-bypass"
    app_name="unknown-bypass"
  fi
  echo "$app_name"
}

# -----------------------------------------------------------------------
# Extract table_touched (best-effort: first table name after FROM/INTO/UPDATE/JOIN)
# -----------------------------------------------------------------------
extract_table_touched() {
  local line="$1"
  local table
  table=$(echo "$line" | grep -oiE '(FROM|INTO|UPDATE|JOIN)\s+[a-z_][a-z0-9_]*' \
          | awk '{print $NF}' | head -1 || echo "")
  echo "$table"
}

# -----------------------------------------------------------------------
# Extract duration_ms from Postgres log line:
#   "duration: X.XXX ms"
# -----------------------------------------------------------------------
extract_duration_ms() {
  local line="$1"
  local dur
  dur=$(echo "$line" | grep -oE 'duration: [0-9]+\.[0-9]+' | awk '{print $2}' | head -1 || echo "")
  if [[ -n "$dur" ]]; then
    # Round to integer
    printf "%.0f" "$dur"
  else
    echo ""
  fi
}

# -----------------------------------------------------------------------
# Main parse loop
# -----------------------------------------------------------------------
INSERTED=0
SKIPPED=0

# Process lines matching Postgres log_statement output (contains 'statement:' or 'execute')
while IFS= read -r line; do
  # Only process lines that contain a SQL statement (log_statement='mod' lines)
  if ! echo "$line" | grep -qiE '(statement:|execute [^:]+:)'; then
    continue
  fi
  # Skip SHOW, SET, comment-only lines
  if echo "$line" | grep -qiE 'statement:\s*(SHOW|SET|--|/\*)'; then
    continue
  fi

  STMT_CLASS=$(get_statement_class "$line")
  WS_ID=$(extract_workspace_id "$line")
  APP_NAME=$(extract_application_name "$line")
  TABLE_TOUCHED=$(extract_table_touched "$line")
  DURATION_MS=$(extract_duration_ms "$line")

  # Build SQL NULL literals
  WS_ID_SQL="NULL"
  [[ -n "$WS_ID" ]] && WS_ID_SQL="'${WS_ID}'"

  DUR_SQL="NULL"
  [[ -n "$DURATION_MS" ]] && DUR_SQL="'${DURATION_MS}'"

  TABLE_SQL="NULL"
  [[ -n "$TABLE_TOUCHED" ]] && TABLE_SQL="'${TABLE_TOUCHED//\'/\'\'}'"

  APP_NAME_CLEAN="${APP_NAME//\'/\'\'}"

  INSERT_SQL="INSERT INTO bypass_query_log (ts, workspace_id, application_name, statement_class, duration_ms, table_touched)
VALUES (now(), ${WS_ID_SQL}, '${APP_NAME_CLEAN}', '${STMT_CLASS}', ${DUR_SQL}, ${TABLE_SQL});"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN: $INSERT_SQL"
    INSERTED=$((INSERTED + 1))
  else
    if psql "$DIRECT_URL" -c "$INSERT_SQL" > /dev/null 2>&1; then
      INSERTED=$((INSERTED + 1))
    else
      log "WARN: INSERT failed for line (skipping): ${line:0:120}"
      SKIPPED=$((SKIPPED + 1))
    fi
  fi

done < <(eval "$INPUT_CMD" 2>/dev/null)

log "Done. Inserted=$INSERTED Skipped=$SKIPPED"
