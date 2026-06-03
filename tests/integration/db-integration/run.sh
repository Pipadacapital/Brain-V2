#!/usr/bin/env bash
# =============================================================================
# DB-backed integration tests (advisor review P1-12).
#
# The ingestion-service integration tests (raw-write + RLS session-context)
# need a REAL Postgres — they were SKIPPED everywhere, so the whole class of
# "works against mocks, breaks against real psycopg" bug (the realtime epic
# surfaced four of them) could merge green. This harness provisions a disposable
# Postgres + ClickHouse exactly like local dev (real role files + the tracked
# migrator + the raw DDL), then runs the integration suite against it.
#
# Spins disposable postgres:16-alpine (host port 5499) + clickhouse 24.8-alpine,
# applies initdb roles → migrate.sh up → raw landing DDL, then runs
# `uv run pytest tests/integration`. Needs Docker + uv. 0 = pass.
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"
PGC="brain-it-pg-$$"; CHC="brain-it-ch-$$"
PG_PORT=5499
INITDB="$ROOT/apps/core-service/docker/initdb-dev"
RAW_DDL="$ROOT/apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql"

cleanup(){ docker rm -f "$PGC" "$CHC" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== starting disposable postgres (:$PG_PORT) + clickhouse =="
docker run -d --name "$PGC" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=brain_dev \
  -p "$PG_PORT:5432" postgres:16-alpine >/dev/null
docker run -d --name "$CHC" -e CLICKHOUSE_DB=brain -e CLICKHOUSE_USER=brain_app \
  -e CLICKHOUSE_PASSWORD=brain_app_pw clickhouse/clickhouse-server:24.8-alpine >/dev/null

for i in $(seq 1 60); do docker exec "$PGC" pg_isready -U postgres -d brain_dev >/dev/null 2>&1 && break; sleep 1; done
for i in $(seq 1 60); do docker exec "$CHC" clickhouse-client --user brain_app --password brain_app_pw --query "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done

PSQL_SU="docker exec -i $PGC psql -U postgres -d brain_dev -v ON_ERROR_STOP=1"

echo "== applying initdb roles (rls_app + svc_*) =="
$PSQL_SU < "$INITDB/01-create-rls-app-role.sql"   >/dev/null
$PSQL_SU < "$INITDB/02-create-service-roles.sql"  >/dev/null

echo "== applying schema migrations via the tracked migrator =="
PSQL="docker exec -i $PGC psql -U postgres -d brain_dev" \
CHCL="docker exec -i $CHC clickhouse-client --user brain_app --password brain_app_pw" \
  bash "$ROOT/scripts/migrate.sh" up >/dev/null

echo "== applying raw landing DDL (rls_app auto-granted via default privileges) =="
$PSQL_SU < "$RAW_DDL" >/dev/null

echo "== running ingestion integration tests =="
cd "$ROOT/apps/ingestion-service"
INTEGRATION_TEST=1 \
DIRECT_URL="postgresql://rls_app:rls_app_pw@localhost:$PG_PORT/brain_dev" \
DATABASE_URL="postgresql://rls_app:rls_app_pw@localhost:$PG_PORT/brain_dev" \
  uv run pytest tests/integration -q
rc=$?

echo ""
[ "$rc" -eq 0 ] && echo "db-integration: PASS" || echo "db-integration: FAIL (rc=$rc)"
exit "$rc"
