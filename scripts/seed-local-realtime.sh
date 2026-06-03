#!/usr/bin/env bash
# =============================================================================
# LOCAL-ONLY real-time webhook fixtures.
#
# A fresh `make up` gets the connector_identity_map TABLE via the migrator
# (migration 30), but not the raw_* landing tables, the rls_app grants, or the
# identity-map SEED — so the local Shopify webhook path wouldn't resolve out of
# the box. This applies those, idempotently, for LOCAL DEV ONLY.
#
# PROD applies the raw DDL via the gated Stage-8 per-connector webhook runbook
# (apps/ingestion-service/migrations/manual/raw/, CF-BN-DDL-GATING-1) and seeds
# connector_identity_map per real shop at the ceremony — NEVER this script.
#
# Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT seed + guarded grants.
# PSQL overridable (defaults to the local docker-exec form, matching dev-up.sh).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL=${PSQL:-docker exec -i brain-postgres-dev psql -U postgres -d brain_dev}
RAW_DDL="apps/ingestion-service/migrations/manual/raw/step-a-enable-create.sql"
SEED="tools/seed/connector-identity-map.local.sql"

# Apply the raw DDL only on a fresh DB — its CREATE POLICY statements are not
# idempotent (the held prod artifact has no DROP POLICY IF EXISTS, and we don't
# churn it). The grants + seed below ARE safe to re-run.
if [ "$($PSQL -tAc "SELECT to_regclass('public.raw_shopify_orders') IS NOT NULL")" = "t" ]; then
  echo "  raw_* tables already present — skipping DDL"
else
  echo "  + raw_* landing tables + RLS ($RAW_DDL)"
  $PSQL -v ON_ERROR_STOP=1 < "$RAW_DDL" >/dev/null
fi

# The local gateway/ingestion connect as rls_app (migration 27 — the per-service
# role cutover — is held/skipped locally), so rls_app needs the raw_* grants.
echo "  + GRANT raw_* to rls_app (local connect role)"
$PSQL -v ON_ERROR_STOP=1 -c "
DO \$\$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'raw_%' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO rls_app', t);
  END LOOP;
END \$\$;" >/dev/null

echo "  + connector_identity_map seed ($SEED)"
$PSQL -v ON_ERROR_STOP=1 < "$SEED" >/dev/null

echo "  Local real-time webhook fixtures applied. Demo: bash tools/demo/realtime-webhook.sh"
