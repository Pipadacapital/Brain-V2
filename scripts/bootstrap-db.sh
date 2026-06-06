#!/usr/bin/env bash
# =============================================================================
# Brain — database bootstrap (SINGLE SOURCE OF TRUTH).
#
#   bash scripts/bootstrap-db.sh        (or:  make bootstrap)
#
# Creates the ENTIRE schema if it does not already exist:
#   - Postgres OLTP  → infra/bootstrap/bootstrap-pg.sql  (roles, 46 tables,
#                       2 security_invoker views, indexes, constraints, RLS)
#   - ClickHouse OLAP → infra/bootstrap/bootstrap-ch.sql (brain db + facts + MV)
#
# Sentinel-gated + idempotent: applies a store's bootstrap ONLY when its anchor
# object is absent, so re-running on a populated DB is a safe no-op. This replaces
# the retired per-migration pipeline (scripts/migrate.sh + the seed scripts).
#
# Connection commands are overridable for CI/disposable containers:
#   PSQL — a psql invocation connected as a SUPERUSER to the target DB
#   CHCL — a clickhouse-client invocation (multiquery-capable)
# Defaults target the local docker-compose containers.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="${PSQL:-docker exec -i brain-postgres-dev psql -U postgres -d brain_dev}"
CHCL="${CHCL:-docker exec -i brain-clickhouse-dev clickhouse-client}"

PG_SQL="infra/bootstrap/bootstrap-pg.sql"
PG_AI_SQL="infra/bootstrap/bootstrap-pg-ai.sql"
CH_SQL="infra/bootstrap/bootstrap-ch.sql"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

# --- Postgres -----------------------------------------------------------------
pg_ready=$($PSQL -tAc "SELECT to_regclass('public.users') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]' || true)
if [ "$pg_ready" = "t" ]; then
  say "Postgres already bootstrapped (public.users present) — skipping"
else
  say "Bootstrapping Postgres schema → $PG_SQL"
  $PSQL -v ON_ERROR_STOP=1 -q -f - < "$PG_SQL"
  echo "  Postgres schema created."
fi

# --- Postgres: AI + Memory schema (OPTIONAL, pgvector-gated) -------------------
# memory.brand_fingerprint needs the `vector` extension. The local dev image does
# not ship it; ap-south-1 Supabase does. Apply only where it is installable.
ai_ready=$($PSQL -tAc "SELECT to_regclass('ai.decision_log') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]' || true)
if [ "$ai_ready" = "t" ]; then
  say "AI/Memory schema already present (ai.decision_log) — skipping"
elif [ "$($PSQL -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector';" 2>/dev/null | tr -d '[:space:]' || true)" = "1" ]; then
  say "Bootstrapping AI/Memory schema → $PG_AI_SQL (pgvector available)"
  $PSQL -v ON_ERROR_STOP=1 -q -f - < "$PG_AI_SQL"
  echo "  AI/Memory schema created."
else
  say "Skipping AI/Memory schema — pgvector not available on this Postgres (local dev). Apply $PG_AI_SQL on a pgvector-enabled instance."
fi

# --- ClickHouse ---------------------------------------------------------------
ch_ready=$($CHCL -q "EXISTS TABLE brain.connector_order_facts" 2>/dev/null | tr -d '[:space:]' || true)
if [ "$ch_ready" = "1" ]; then
  say "ClickHouse already bootstrapped (brain.connector_order_facts present) — skipping"
else
  say "Bootstrapping ClickHouse schema → $CH_SQL"
  $CHCL -n < "$CH_SQL"
  echo "  ClickHouse schema created."
fi

say "Bootstrap complete (schema only — no rows; connectors/webhooks populate data going forward)."
