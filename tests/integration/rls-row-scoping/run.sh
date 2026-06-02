#!/usr/bin/env bash
# =============================================================================
# Runtime RLS row-scoping negative-test (advisor review P1-14).
#
# Proves the ws_isolation RLS policy SCOPES ROWS at runtime on a role that holds
# the table grant: tenant A sees only A's rows, a context-less read returns 0
# (fail-closed), cross-tenant reads/writes are denied. Complements ../db-isolation
# (which proves grant-level table isolation + NON-BYPASSRLS).
#
# Spins a disposable postgres:16-alpine, applies the REAL role file + a
# representative table carrying the byte-identical live policy expression, then
# runs the deny matrix as svc_core (a real NON-BYPASSRLS app role) flipping
# app.workspace_id. Deterministic; no live data; needs Docker. 0 = conformant.
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
ROLES_SQL="$ROOT/apps/core-service/docker/initdb-dev/02-create-service-roles.sql"
WS_A="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
WS_B="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
C="brain-rls-rowscope-$$"
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

echo "== applying REAL roles + seed (table + policy + grant) =="
psql_su < "$ROLES_SQL"     >/dev/null || { echo "roles failed"; exit 1; }
psql_su < "$HERE/seed.sql" >/dev/null || { echo "seed failed";  exit 1; }

# assert_count <role> <set-guc-sql-or-empty> <select-sql> <expected-count> <label>
# Runs (optional SET) and the SELECT in ONE session so the GUC applies to the read.
assert_count(){
  local role="$1" setguc="$2" sql="$3" expect="$4" label="$5" got
  # SET emits a "SET" command tag before the count; keep only the numeric line.
  got=$(docker exec "$C" psql -U "$role" -d brain_dev -tAc "${setguc:+$setguc;} $sql" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)
  if [ "$got" = "$expect" ]; then echo "  [PASS] $label"; PASS=$((PASS+1))
  else echo "  [FAIL] $label (expected $expect, got '${got:-<error>}')"; FAIL=$((FAIL+1)); fi
}

# assert_write <role> <set-guc-sql> <write-sql> <expect: ok|deny> <label>
assert_write(){
  local role="$1" setguc="$2" sql="$3" expect="$4" label="$5" got
  if docker exec "$C" psql -U "$role" -d brain_dev -v ON_ERROR_STOP=1 -tAc "${setguc:+$setguc;} $sql" >/dev/null 2>&1; then got=ok; else got=deny; fi
  if [ "$got" = "$expect" ]; then echo "  [PASS] $label"; PASS=$((PASS+1))
  else echo "  [FAIL] $label (expected $expect, got $got)"; FAIL=$((FAIL+1)); fi
}

echo "== RLS row-scoping deny matrix (as svc_core, NON-BYPASSRLS) =="
# 1. No GUC → fail-closed → 0 rows (NOT the 4 seeded rows).
assert_count svc_core "" \
  "SELECT count(*) FROM rls_probe_facts" 0 \
  "context-less read returns 0 rows (fail-closed)"
# 2. Tenant A context → sees ONLY A's 3 rows.
assert_count svc_core "SET app.workspace_id = '$WS_A'" \
  "SELECT count(*) FROM rls_probe_facts" 3 \
  "tenant A sees only A's 3 rows"
# 3. Tenant B context → sees ONLY B's 1 row.
assert_count svc_core "SET app.workspace_id = '$WS_B'" \
  "SELECT count(*) FROM rls_probe_facts" 1 \
  "tenant B sees only B's 1 row"
# 4. Cross-tenant by id: as A, explicitly target B's rows → 0 (policy, not filter).
assert_count svc_core "SET app.workspace_id = '$WS_A'" \
  "SELECT count(*) FROM rls_probe_facts WHERE workspace_id = '$WS_B'" 0 \
  "tenant A cannot read B's rows even when targeting them"
# 5. Empty-string GUC → NULLIF → NULL → 0 rows (the documented cast-safe path).
assert_count svc_core "SET app.workspace_id = ''" \
  "SELECT count(*) FROM rls_probe_facts" 0 \
  "empty-string GUC is fail-closed (no cast error)"
# 6. WITH CHECK: as A, INSERT a row tagged for B → denied (no cross-tenant write).
assert_write svc_core "SET app.workspace_id = '$WS_A'" \
  "INSERT INTO rls_probe_facts(workspace_id, amount_mu) VALUES ('$WS_B', 1)" deny \
  "tenant A cannot INSERT a row tagged for tenant B (WITH CHECK)"
# 7. WITH CHECK positive: as A, INSERT a row tagged for A → allowed.
assert_write svc_core "SET app.workspace_id = '$WS_A'" \
  "INSERT INTO rls_probe_facts(workspace_id, amount_mu) VALUES ('$WS_A', 1)" ok \
  "tenant A CAN INSERT a row tagged for itself"

echo ""
echo "== RESULT: PASS=$PASS FAIL=$FAIL =="
if [ "$FAIL" -eq 0 ]; then echo "rls-row-scoping: CONFORMANT"; exit 0; else echo "rls-row-scoping: DRIFT"; exit 1; fi
