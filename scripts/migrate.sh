#!/usr/bin/env bash
# =============================================================================
# Brain schema migrator (advisor review P1-18) — incremental, tracked,
# idempotent, drift-detecting. Replaces the old all-or-nothing marker probe in
# dev-up.sh that skipped EVERY migration once one table existed (so any migration
# added later was silently never applied).
#
# What it does, per store (Postgres OLTP + ClickHouse OLAP):
#   - keeps a ledger table `_brain_schema_migrations` (version, name, checksum,
#     applied_at) recording exactly which files have run;
#   - applies ONLY files not yet in the ledger, in filename order, recording each
#     (PG: one transaction per file via -1);
#   - re-run is a no-op (idempotent);
#   - DRIFT GUARD: if an already-applied file's checksum changed, it ABORTS — an
#     applied migration must never be edited in place;
#   - skips files that self-declare `RUNBOOK-GATED` (CH 0001/0002 — the Stage-8
#     legacy metric-engine lineage, applied by a separate Founder-gated runbook),
#     so the connector-fact stack (0003+) and any future file are picked up but
#     the gated lineage is never auto-run.
#
# Commands:
#   up        apply pending migrations to both stores (default)
#   status    show applied / pending per store
#   baseline  record all in-scope files as applied WITHOUT running them — adopts
#             an existing at-head DB (e.g. the local volume created before the
#             ledger existed) so `up` doesn't try to re-run already-applied DDL.
#
# Connection seam (override for CI / disposable containers):
#   PSQL  — psql command prefix   (default: docker exec into brain-postgres-dev)
#   CHCL  — clickhouse command prefix (default: docker exec into brain-clickhouse-dev)
# stdin is fed the .sql file; query helpers append their own flags.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PG_MIG_DIR=${PG_MIG_DIR:-apps/core-service/migrations/local-dev}
CH_MIG_DIR=${CH_MIG_DIR:-apps/analytics-service/migrations/clickhouse}
PSQL=${PSQL:-docker exec -i brain-postgres-dev psql -U postgres -d brain_dev}
CHCL=${CHCL:-docker exec -i brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw}

# Marker tables that signal "this is an established pre-ledger DB at head" — used
# only to auto-baseline on first `up` so an existing volume adopts cleanly.
# IMPORTANT: the marker MUST be a table from the LAST schema-creating migration, not an
# early one. Using an early table (e.g. connector_order_facts = CH 0003) made a PARTIALLY
# migrated CH look "at head", so `up` baselined 0004..0011 as applied WITHOUT running them
# — leaving brain.connector_shipment_facts (0007) missing and the logistics readers 500ing.
# CH head = connector_raw_events (0010, last table-creating migration; 0011 only adds cols).
PG_HEAD_MARKER=${PG_HEAD_MARKER:-public.connector_order_facts_hot}
CH_HEAD_MARKER=${CH_HEAD_MARKER:-connector_raw_events}

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

# Portable sha256 (linux: sha256sum, macOS: shasum -a 256) → bare hex digest.
sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# In-scope, ordered migration files for a store (exclude down-migrations).
pg_files() { ls "$PG_MIG_DIR"/[0-9]*.sql 2>/dev/null | grep -v '/down' | sort; }
ch_files() { ls "$CH_MIG_DIR"/[0-9]*.sql 2>/dev/null | sort; }

# A migration self-declares it is NOT part of the automatic local/CI apply with a
# `-- migrate: skip` directive in its header (HELD cutover steps, runbook-gated DDL).
# Explicit + greppable — never prose-matched, so a file that merely MENTIONS a held
# concept is not skipped by accident.
is_skip() { grep -q 'migrate: skip' "$1"; }

# --- Postgres helpers -------------------------------------------------------
pg_q()        { $PSQL -tAc "$1"; }
pg_exec_file(){ $PSQL -v ON_ERROR_STOP=1 -1 < "$1"; }
pg_ensure_ledger() {
  pg_q "CREATE TABLE IF NOT EXISTS public._brain_schema_migrations (
          version text PRIMARY KEY, name text NOT NULL,
          checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());" >/dev/null
}
pg_applied_checksum() { pg_q "SELECT checksum FROM public._brain_schema_migrations WHERE version = '$1'"; }
pg_ledger_empty()     { [ "$(pg_q "SELECT count(*) FROM public._brain_schema_migrations")" = "0" ]; }
pg_has_marker()       { [ "$(pg_q "SELECT to_regclass('$PG_HEAD_MARKER') IS NOT NULL")" = "t" ]; }
pg_record() {
  local ver="$1" name="$2" cs="$3"
  pg_q "INSERT INTO public._brain_schema_migrations (version, name, checksum)
        VALUES ('$ver', '$name', '$cs')
        ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now();" >/dev/null
}

# --- ClickHouse helpers -----------------------------------------------------
ch_q()        { $CHCL --query "$1"; }
ch_exec_file(){ $CHCL --multiquery < "$1"; }
ch_ensure_ledger() {
  ch_q "CREATE DATABASE IF NOT EXISTS brain"
  ch_q "CREATE TABLE IF NOT EXISTS brain._brain_schema_migrations (
          version String, name String, checksum String,
          applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY version"
}
ch_applied_checksum() { ch_q "SELECT checksum FROM brain._brain_schema_migrations WHERE version = '$1'"; }
ch_ledger_empty()     { [ "$(ch_q "SELECT count() FROM brain._brain_schema_migrations")" = "0" ]; }
ch_has_marker()       { [ "$(ch_q "EXISTS TABLE brain.$CH_HEAD_MARKER")" = "1" ]; }
ch_record() {
  local ver="$1" name="$2" cs="$3"
  ch_q "INSERT INTO brain._brain_schema_migrations (version, name, checksum) VALUES ('$ver', '$name', '$cs')"
}

# --- Generic apply loop -----------------------------------------------------
# args: store-label, files-fn, applied-checksum-fn, exec-file-fn, record-fn, mode
#   mode = apply | baseline  (baseline records without running)
apply_store() {
  local label="$1" filesfn="$2" csfn="$3" execfn="$4" recfn="$5" mode="$6"
  local applied=0 pending=0 skipped=0
  local f ver cs prev
  # Read the file list on fd 3: the apply step shells out to `docker exec -i`,
  # which would otherwise drain the loop's stdin and stop it after one file.
  while IFS= read -r f <&3; do
    [ -z "$f" ] && continue
    ver="$(basename "$f")"
    if is_skip "$f"; then
      info "skip (migrate: skip): $ver"; skipped=$((skipped+1)); continue
    fi
    cs="$(sha "$f")"
    prev="$($csfn "$ver" || true)"
    if [ -n "$prev" ]; then
      [ "$prev" != "$cs" ] && die "DRIFT: $label/$ver was applied with checksum $prev but the file is now $cs. An applied migration must not be edited; add a new migration instead."
      applied=$((applied+1)); continue
    fi
    if [ "$mode" = baseline ]; then
      info "baseline (record only): $ver"; $recfn "$ver" "$ver" "$cs"; pending=$((pending+1))
    else
      info "apply: $ver"; $execfn "$f"; $recfn "$ver" "$ver" "$cs"; pending=$((pending+1))
    fi
  done 3< <($filesfn)
  info "$label: $applied already applied, $pending $([ "$mode" = baseline ] && echo baselined || echo newly applied), $skipped skipped"
}

cmd_up() {
  say "Postgres migrations → $PG_MIG_DIR"
  pg_ensure_ledger
  if pg_ledger_empty && pg_has_marker; then
    info "Existing pre-ledger Postgres detected (marker $PG_HEAD_MARKER present, ledger empty) — adopting at head."
    apply_store Postgres pg_files pg_applied_checksum pg_exec_file pg_record baseline
  else
    apply_store Postgres pg_files pg_applied_checksum pg_exec_file pg_record apply
  fi

  say "ClickHouse migrations → $CH_MIG_DIR"
  ch_ensure_ledger
  if ch_ledger_empty && ch_has_marker; then
    info "Existing pre-ledger ClickHouse detected (marker $CH_HEAD_MARKER present, ledger empty) — adopting at head."
    apply_store ClickHouse ch_files ch_applied_checksum ch_exec_file ch_record baseline
  else
    apply_store ClickHouse ch_files ch_applied_checksum ch_exec_file ch_record apply
  fi
  say "Migrations up-to-date."
}

cmd_baseline() {
  say "BASELINE — recording all in-scope files as applied WITHOUT running them."
  pg_ensure_ledger; apply_store Postgres   pg_files pg_applied_checksum pg_exec_file pg_record baseline
  ch_ensure_ledger; apply_store ClickHouse ch_files ch_applied_checksum ch_exec_file ch_record baseline
}

cmd_status() {
  local f ver cs prev
  say "Postgres ($PG_MIG_DIR)"; pg_ensure_ledger
  while IFS= read -r f <&3; do
    [ -z "$f" ] && continue; ver="$(basename "$f")"
    if is_skip "$f"; then info "SKIP     $ver (migrate: skip — held/manual)"; continue; fi
    cs="$(sha "$f")"; prev="$(pg_applied_checksum "$ver" || true)"
    if [ -z "$prev" ]; then info "PENDING  $ver"
    elif [ "$prev" != "$cs" ]; then info "DRIFT    $ver (applied $prev ≠ file $cs)"
    else info "applied  $ver"; fi
  done 3< <(pg_files)
  say "ClickHouse ($CH_MIG_DIR)"; ch_ensure_ledger
  while IFS= read -r f <&3; do
    [ -z "$f" ] && continue; ver="$(basename "$f")"
    if is_skip "$f"; then info "SKIP     $ver (migrate: skip — held/runbook-gated)"; continue; fi
    cs="$(sha "$f")"; prev="$(ch_applied_checksum "$ver" || true)"
    if [ -z "$prev" ]; then info "PENDING  $ver"
    elif [ "$prev" != "$cs" ]; then info "DRIFT    $ver (applied $prev ≠ file $cs)"
    else info "applied  $ver"; fi
  done 3< <(ch_files)
}

case "${1:-up}" in
  up)       cmd_up ;;
  baseline) cmd_baseline ;;
  status)   cmd_status ;;
  *)        die "unknown command '${1}'. Use: up | status | baseline" ;;
esac
