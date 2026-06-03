#!/usr/bin/env bash
# =============================================================================
# Brain — one-shot local bring-up.
#
#   ./scripts/dev-up.sh        (or:  make up)
#
# Idempotent: ensures the external data volumes exist, starts the databases,
# applies the schema migrations ONLY on a fresh DB (detected by a marker table),
# then builds + starts the api-gateway + web, and waits for /ready.
# Safe to re-run — on an already-initialised DB it skips the migration step.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file .env.docker"
PG="docker exec -i brain-postgres-dev psql -U postgres -d brain_dev"
CH="docker exec -i brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

# 0. .env.docker must exist (compose reads it + bakes the web build-args).
if [ ! -f .env.docker ]; then
  if [ -f .env.docker.example ]; then
    cp .env.docker.example .env.docker
    echo "WARNING: created .env.docker from the example — fill in SUPABASE_* / OAuth / custody before a real run."
  else
    echo "FATAL: .env.docker is missing and there is no .env.docker.example to copy."; exit 1
  fi
fi

# 1. External data volumes (compose declares them external: true).
say "Ensuring data volumes exist"
docker volume create core-service_brain-pgdata-dev    >/dev/null
docker volume create analytics-service_brain-chdata-dev >/dev/null

# 2. Databases first, then wait until both are healthy.
say "Starting databases (postgres-dev + clickhouse-dev)"
$COMPOSE up -d postgres-dev clickhouse-dev
say "Waiting for databases to be healthy"
for _ in $(seq 1 60); do
  pg=$(docker inspect -f '{{.State.Health.Status}}' brain-postgres-dev 2>/dev/null || echo starting)
  ch=$(docker inspect -f '{{.State.Health.Status}}' brain-clickhouse-dev 2>/dev/null || echo starting)
  [ "$pg" = healthy ] && [ "$ch" = healthy ] && break
  sleep 2
done
echo "  postgres=$pg clickhouse=$ch"

# 3. Apply migrations via the tracked migrator (scripts/migrate.sh). It keeps a
#    per-store ledger and applies ONLY un-applied files in order — so a migration
#    added later actually runs (the old marker-probe here skipped EVERY migration
#    once one table existed). Idempotent: re-run is a no-op. An existing pre-ledger
#    volume is auto-adopted at head. Held/runbook-gated files (`-- migrate: skip`)
#    are not auto-applied.
say "Applying schema migrations (tracked migrator)"
PSQL="$PG" CHCL="$CH" bash scripts/migrate.sh up
echo "  NOTE: schema only — no rows. Real-data load is the Founder-gated tools/migrate-legacy step;"
echo "        for a demo UI set BRAIN_GATEWAY_LOCAL_HARNESS=true on the gateway."

# 3.5 LOCAL-ONLY real-time webhook fixtures (raw_* tables + grants + identity-map
#     seed). Idempotent. Lets the local Shopify webhook path resolve out of the
#     box; prod applies these via the gated Stage-8 runbook, never here.
say "Applying local real-time webhook fixtures"
PSQL="$PG" bash scripts/seed-local-realtime.sh

# 3.6 LOCAL-ONLY metric-engine bring-up (workspace_daily_metrics DDL + MV + the
#     daily rollup from connector facts). Lets query_metrics / the Morning Brief
#     read real metrics; no-op-safe with no migrated data. Prod uses the gated
#     Stage-8 runbook + a real scheduler, never here.
say "Applying local metric-engine (DDL + daily recompute)"
CH="$CH" bash scripts/seed-local-metric-engine.sh

# 4. Build + start the FULL app: api-gateway + web AND the profile-gated
#    services (ingestion + analytics + intelligence). `--profile data` with no
#    service args brings up every service in the default + data profiles, so a
#    single `make up` stands up the whole stack (DBs already started above are
#    a no-op here). Drop the `--profile data` flag for a lighter web-only run.
say "Building + starting the full stack (web + gateway + ingestion/analytics/intelligence)"
$COMPOSE --profile data up -d --build

# 5. Wait for the gateway to report ready (probes PG + CH).
say "Waiting for the gateway /ready"
for _ in $(seq 1 40); do
  if curl -fs localhost:3001/ready >/dev/null 2>&1; then break; fi
  sleep 3
done
echo ""
$COMPOSE --profile data ps
echo ""
echo "  /ready : $(curl -s localhost:3001/ready 2>/dev/null || echo 'not-ready-yet')"
echo ""
say "Up. Web → http://localhost:3000   API → http://localhost:3001   (intelligence/analytics on brain-net)"
