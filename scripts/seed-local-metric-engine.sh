#!/usr/bin/env bash
# =============================================================================
# LOCAL-ONLY metric-engine bring-up.
#
# query_metrics (and the Morning Brief via the B2 gRPC client) reads
# brain.workspace_daily_metrics_computed (← MV 0002 ← workspace_daily_metrics_base).
# Those CH tables + the MV are RUNBOOK-GATED (`-- migrate: skip`), so the migrator
# doesn't apply them and nothing populates the base. This applies the DDL + runs the
# daily rollup so the metric-engine has data on local dev.
#
# Idempotent: CREATE ... IF NOT EXISTS for the DDL; the recompute is a full
# DELETE+INSERT per workspace/day. No-op-safe: zero connector facts → zero rows.
#
# PROD applies 0001/0002 via the gated Stage-8 runbook and runs the recompute from a
# real daily-tick scheduler (Phase-D) — NEVER this script. CH target is PINNED to the
# LOCAL container here so it can never touch a prod cluster.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

CH=${CH:-docker exec -i brain-clickhouse-dev clickhouse-client --user brain_app --password brain_app_pw}
DDL_DIR="apps/analytics-service/migrations/clickhouse"

# Idempotent CH schema SAFETY NET (local-dev): apply EVERY CH migration DDL
# (0001..0011), not just the metric-engine pair. The tracked migrator (scripts/migrate.sh)
# is the primary path, but its ledger/adopt-at-head heuristic can leave the local CH
# with a partial connector schema (observed: only connector_order_facts present, so the
# logistics readers 500 on a missing brain.connector_shipment_facts). Every file is
# `CREATE ... IF NOT EXISTS`, so re-applying them here is a no-op when the migrator already
# ran, and self-heals when it didn't. This guarantees the FULL local CH schema after
# `make up`. Runs last in the bring-up so it wins regardless of migrator state.
# PROD is unaffected: this script is local-only; prod uses the gated Stage-8 runbook.
echo "  + CH schema DDL (0001..0011: metric-engine + all connector facts) → local CH"
for f in $(ls "$DDL_DIR"/[0-9]*.sql | sort); do
  name=$(basename "$f")
  if $CH --multiquery < "$f" >/dev/null 2>/tmp/ch-seed-err; then
    :
  else
    echo "    WARN: $name did not fully apply → $(head -1 /tmp/ch-seed-err)"
  fi
done

# Recompute every workspace with connector facts, over its full order-date window.
# PINNED to the local CH container (never prod). Best-effort: needs uv + the analytics
# env on the host; on a fresh DB with no migrated facts this inserts 0 rows (fine).
echo "  + recompute daily metrics (--all workspaces) from connector facts"
# LOCAL CH is host=localhost port=8123 (HTTP); analytics' client defaults to 8443/HTTPS
# (the ap-south-1 prod shape), so the host/port are set explicitly here. Module path is
# `src.application...` (analytics pytest pythonpath=["."]; run from the service dir).
RECOMPUTE_ENV='CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_USER=brain_app CLICKHOUSE_PASSWORD=brain_app_pw CLICKHOUSE_DATABASE=brain'
RECOMPUTE_CMD="uv run python -m src.application.contexts.metric_engine.recompute_daily --all"
if command -v uv >/dev/null 2>&1; then
  ( cd apps/analytics-service \
    && env CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_USER=brain_app \
           CLICKHOUSE_PASSWORD=brain_app_pw CLICKHOUSE_DATABASE=brain \
       uv run python -m src.application.contexts.metric_engine.recompute_daily --all 2>&1 | tail -3 ) \
    || echo "    NOTE: recompute skipped/failed — run after the legacy data load:
      cd apps/analytics-service && env $RECOMPUTE_ENV $RECOMPUTE_CMD"
else
  echo "    NOTE: uv not found — skipping recompute. After installing uv + loading data, run:"
  echo "      cd apps/analytics-service && env $RECOMPUTE_ENV $RECOMPUTE_CMD"
fi

echo "  Local metric-engine ready. query_metrics now reads real workspace_daily_metrics."
