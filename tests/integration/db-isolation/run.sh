#!/usr/bin/env bash
# =============================================================================
# A4 db-isolation negative-test — proves per-service Postgres roles are DENIED
# access outside their owned tables (isolation by permission, not just RLS).
#
# Spins a disposable postgres:16, applies the REAL role file
# (apps/core-service/docker/initdb-dev/02-create-service-roles.sql) + a
# representative seed + grants, then asserts the allow/deny matrix + that every
# svc_ role remains NON-BYPASSRLS (RLS still scopes rows). Deterministic; no live
# data; needs Docker. Exit 0 = conformant, 1 = drift.
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
ROLES_SQL="$ROOT/apps/core-service/docker/initdb-dev/02-create-service-roles.sql"
C="brain-a4-isolation-$$"
PASS=0; FAIL=0

cleanup(){ docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== starting disposable postgres =="
docker run -d --name "$C" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=brain_dev postgres:16-alpine >/dev/null
for i in $(seq 1 30); do
  docker exec "$C" pg_isready -U postgres -d brain_dev >/dev/null 2>&1 && break
  sleep 1
done

psql_su(){ docker exec -i "$C" psql -U postgres -d brain_dev -v ON_ERROR_STOP=1 "$@"; }

echo "== applying seed + REAL roles + grants =="
psql_su < "$HERE/seed.sql"        >/dev/null || { echo "seed failed"; exit 1; }
psql_su < "$ROLES_SQL"            >/dev/null || { echo "roles failed"; exit 1; }
psql_su < "$HERE/test-grants.sql" >/dev/null || { echo "grants failed"; exit 1; }

# assert <role> <sql> <expect: ok|deny> <label>
assert(){
  local role="$1" sql="$2" expect="$3" label="$4" got
  if docker exec "$C" psql -U "$role" -d brain_dev -v ON_ERROR_STOP=1 -tAc "$sql" >/dev/null 2>&1; then got=ok; else got=deny; fi
  if [ "$got" = "$expect" ]; then echo "  [PASS] $label"; PASS=$((PASS+1))
  else echo "  [FAIL] $label (expected $expect, got $got)"; FAIL=$((FAIL+1)); fi
}

echo "== deny matrix =="
assert svc_core         "SELECT 1 FROM customer_pii LIMIT 1"                                  ok   "svc_core reads its own customer_pii"
assert svc_core         "SELECT 1 FROM raw_shopify_orders LIMIT 1"                            deny "svc_core CANNOT read ingestion raw_*"
assert svc_core         "SELECT 1 FROM ai.decision_log LIMIT 1"                               deny "svc_core CANNOT read ai.* (no schema usage)"
assert svc_ingestion    "SELECT 1 FROM raw_shopify_orders LIMIT 1"                            ok   "svc_ingestion reads its own raw_*"
assert svc_ingestion    "SELECT 1 FROM customer_pii LIMIT 1"                                  deny "svc_ingestion CANNOT read core customer_pii"
assert svc_ingestion    "INSERT INTO customer_pii(workspace_id) VALUES (gen_random_uuid())"  deny "svc_ingestion CANNOT write core customer_pii"
assert svc_intelligence "SELECT 1 FROM ai.decision_log LIMIT 1"                               ok   "svc_intelligence reads its own ai.*"
assert svc_intelligence "SELECT 1 FROM customer_pii LIMIT 1"                                  deny "svc_intelligence CANNOT read public core (no usage)"
assert svc_analytics_ro "SELECT 1 FROM customer_pii LIMIT 1"                                  deny "svc_analytics_ro CANNOT read core tables"
assert svc_analytics_ro "INSERT INTO customer_pii(workspace_id) VALUES (gen_random_uuid())"  deny "svc_analytics_ro CANNOT write (read-only)"

echo "== RLS-still-applies: every svc_ role is NON-BYPASSRLS =="
bypass=$(docker exec "$C" psql -U postgres -d brain_dev -tAc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'svc\_%' AND rolbypassrls")
if [ "$bypass" = "0" ]; then echo "  [PASS] no svc_ role has BYPASSRLS"; PASS=$((PASS+1))
else echo "  [FAIL] $bypass svc_ role(s) have BYPASSRLS"; FAIL=$((FAIL+1)); fi

echo ""
echo "== RESULT: PASS=$PASS FAIL=$FAIL =="
if [ "$FAIL" -eq 0 ]; then echo "db-isolation: CONFORMANT"; exit 0; else echo "db-isolation: DRIFT"; exit 1; fi
