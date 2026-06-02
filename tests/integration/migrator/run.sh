#!/usr/bin/env bash
# =============================================================================
# Migrator correctness harness (advisor review P1-18) for scripts/migrate.sh.
#
# Spins disposable postgres:16-alpine + clickhouse 24.8-alpine, points the
# migrator at a TEMP COPY of the real migration dirs (so add/edit tests can't
# touch the repo), and asserts the contract:
#   1. fresh `up` applies every in-scope file; CH 0001/0002 are skipped (gated)
#   2. re-run is idempotent (0 newly applied)
#   3. adopt: drop the ledger on an at-head DB → `up` baselines (no re-run error)
#   4. incremental: a new file applies on its own, nothing else re-runs
#   5. drift: editing an already-applied file ABORTS
# Deterministic; no live data; needs Docker. 0 = conformant.
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PGC="brain-mig-pg-$$"; CHC="brain-mig-ch-$$"
TMP="$(mktemp -d)"
PASS=0; FAIL=0

cleanup(){ docker rm -f "$PGC" "$CHC" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

ok(){   echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad(){  echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

# --- disposable stores ------------------------------------------------------
echo "== starting disposable postgres + clickhouse =="
docker run -d --name "$PGC" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=brain_dev \
  -v "$ROOT/apps/core-service/docker/initdb-dev:/docker-entrypoint-initdb.d:ro" \
  postgres:16-alpine >/dev/null
docker run -d --name "$CHC" \
  -e CLICKHOUSE_DB=brain -e CLICKHOUSE_USER=brain_app -e CLICKHOUSE_PASSWORD=brain_app_pw \
  clickhouse/clickhouse-server:24.8-alpine >/dev/null

pg_ready=0; ch_ready=0
for i in $(seq 1 60); do docker exec "$PGC" pg_isready -U postgres -d brain_dev >/dev/null 2>&1 && { pg_ready=1; break; }; sleep 1; done
for i in $(seq 1 60); do docker exec "$CHC" clickhouse-client --user brain_app --password brain_app_pw --query "SELECT 1" >/dev/null 2>&1 && { ch_ready=1; break; }; sleep 1; done
[ "$pg_ready" = 1 ] || { echo "FATAL: postgres never became ready"; docker logs "$PGC" 2>&1 | tail -20; exit 1; }
[ "$ch_ready" = 1 ] || { echo "FATAL: clickhouse never became ready"; docker logs "$CHC" 2>&1 | tail -20; exit 1; }
# initdb roles run async on first boot; wait until rls_app exists so grants don't race.
for i in $(seq 1 30); do [ "$(docker exec "$PGC" psql -U postgres -d brain_dev -tAc "SELECT 1 FROM pg_roles WHERE rolname='rls_app'" 2>/dev/null)" = "1" ] && break; sleep 1; done

# --- temp copy of the migration dirs (mutable) ------------------------------
mkdir -p "$TMP/pg" "$TMP/ch"
cp "$ROOT"/apps/core-service/migrations/local-dev/*.sql        "$TMP/pg/"
cp "$ROOT"/apps/analytics-service/migrations/clickhouse/*.sql  "$TMP/ch/"

# Point the migrator at the disposable stores + temp dirs.
export PSQL="docker exec -i $PGC psql -U postgres -d brain_dev"
export CHCL="docker exec -i $CHC clickhouse-client --user brain_app --password brain_app_pw"
export PG_MIG_DIR="$TMP/pg" CH_MIG_DIR="$TMP/ch"
MIG="bash $ROOT/scripts/migrate.sh"

# In-scope = numbered files, minus down-migrations, minus `migrate: skip` (held).
PG_IN=$(ls "$TMP"/pg/[0-9]*.sql | grep -v '/down' | xargs grep -L 'migrate: skip' | wc -l | tr -d ' ')
CH_IN=$(ls "$TMP"/ch/[0-9]*.sql | xargs grep -L 'migrate: skip' | wc -l | tr -d ' ')
pg_ledger(){ docker exec "$PGC" psql -U postgres -d brain_dev -tAc "SELECT count(*) FROM public._brain_schema_migrations" 2>/dev/null | tr -d ' '; }
ch_ledger(){ docker exec "$CHC" clickhouse-client --user brain_app --password brain_app_pw --query "SELECT count() FROM brain._brain_schema_migrations" 2>/dev/null | tr -d ' '; }

# === TEST 1: fresh apply ====================================================
echo "== TEST 1: fresh up =="
OUT="$($MIG up 2>&1)" || { echo "$OUT"; bad "fresh up exited non-zero"; }
echo "$OUT" | grep -q 'skip (migrate: skip): 0001' && echo "$OUT" | grep -q 'skip (migrate: skip): 0002' \
  && ok "CH 0001/0002 skipped (runbook-gated)" || bad "CH gated files not skipped"
echo "$OUT" | grep -q 'skip (migrate: skip): 27-revoke' \
  && ok "PG 27 skipped (held A4b cutover)" || bad "PG held migration 27 not skipped"
[ "$(pg_ledger)" = "$PG_IN" ] && ok "PG ledger = $PG_IN (all in-scope applied)" || bad "PG ledger $(pg_ledger) ≠ $PG_IN"
[ "$(ch_ledger)" = "$CH_IN" ] && ok "CH ledger = $CH_IN (0003-0011 applied)"   || bad "CH ledger $(ch_ledger) ≠ $CH_IN"
[ "$(docker exec "$PGC" psql -U postgres -d brain_dev -tAc "SELECT to_regclass('public.connector_order_facts_hot') IS NOT NULL")" = "t" ] \
  && ok "PG schema really created (marker table present)" || bad "PG marker table missing"
[ "$(docker exec "$CHC" clickhouse-client --user brain_app --password brain_app_pw --query "EXISTS TABLE brain.connector_order_facts")" = "1" ] \
  && ok "CH schema really created (marker table present)" || bad "CH marker table missing"

# === TEST 2: idempotent re-run =============================================
echo "== TEST 2: idempotent up =="
OUT="$($MIG up 2>&1)" || bad "second up exited non-zero"
echo "$OUT" | grep -q 'Postgres: '"$PG_IN"' already applied, 0 newly applied' && ok "PG re-run is a no-op" || bad "PG re-run not idempotent"
[ "$(pg_ledger)" = "$PG_IN" ] && ok "PG ledger unchanged after re-run" || bad "PG ledger changed on re-run"

# === TEST 3: adopt an at-head pre-ledger DB =================================
echo "== TEST 3: adopt (drop ledger on at-head DB) =="
docker exec "$PGC" psql -U postgres -d brain_dev -c "DROP TABLE public._brain_schema_migrations" >/dev/null 2>&1
docker exec "$CHC" clickhouse-client --user brain_app --password brain_app_pw --query "DROP TABLE brain._brain_schema_migrations" >/dev/null 2>&1
OUT="$($MIG up 2>&1)" || { echo "$OUT" | tail -5; bad "adopt up exited non-zero (re-ran existing DDL?)"; }
echo "$OUT" | grep -q 'adopting at head' && ok "detected pre-ledger DB and adopted" || bad "did not adopt (would have re-run DDL)"
[ "$(pg_ledger)" = "$PG_IN" ] && [ "$(ch_ledger)" = "$CH_IN" ] && ok "ledgers rebuilt by baseline" || bad "baseline ledger counts wrong"

# === TEST 4: incremental new migration ======================================
echo "== TEST 4: incremental =="
cat > "$TMP/pg/99-migrator-probe.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public.migrator_probe (id int PRIMARY KEY);
SQL
OUT="$($MIG up 2>&1)" || bad "incremental up exited non-zero"
echo "$OUT" | grep -q 'apply: 99-migrator-probe.sql' && ok "new migration applied" || bad "new migration not applied"
[ "$(docker exec "$PGC" psql -U postgres -d brain_dev -tAc "SELECT to_regclass('public.migrator_probe') IS NOT NULL")" = "t" ] \
  && ok "incremental table really created" || bad "incremental table missing"
[ "$(pg_ledger)" = "$((PG_IN+1))" ] && ok "PG ledger grew by exactly 1" || bad "PG ledger != +1 ($(pg_ledger))"

# === TEST 5: drift detection ================================================
echo "== TEST 5: drift =="
echo "-- drift: edited after apply" >> "$TMP/pg/01-schema-onboarding.sql"
if $MIG up >/tmp/mig-drift.out 2>&1; then
  bad "drift NOT detected (up succeeded on an edited applied file)"
else
  grep -q 'DRIFT' /tmp/mig-drift.out && ok "drift detected → up aborted" || bad "exited non-zero but not with a DRIFT message"
fi

echo ""
echo "== RESULT: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && { echo "migrator: CONFORMANT"; exit 0; } || { echo "migrator: DRIFT"; exit 1; }
