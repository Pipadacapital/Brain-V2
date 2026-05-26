#!/usr/bin/env bash
# Apply ClickHouse DDL in order, idempotent. Re-runnable.
# Each file uses CREATE TABLE IF NOT EXISTS so re-runs are safe.
# Plan: docs/data-architecture-plan-v2.md §4.2.
set -euo pipefail

CH_HOST="${CH_HOST:-localhost}"
CH_PORT="${CH_PORT:-9000}"
CH_USER="${CH_USER:-brain_app}"
CH_PASSWORD="${CH_PASSWORD:-brain_app_pw}"
CH_DB="${CH_DB:-brain}"
CONTAINER="${CH_CONTAINER:-brain-clickhouse-dev}"

# In local dev we apply via `docker exec` into the running container so the
# clickhouse-client binary is always available (no host install required).
# We do NOT halt on per-file failures so one broken canon file doesn't block the
# remaining DDL — each failure is reported instead.
fails=0
for f in apps/analytics-service/migrations/clickhouse/0*.sql; do
  case "$(basename "$f")" in _*) continue ;; esac     # skip _divop_template.sql etc.
  echo ">>> $f"
  if ! docker exec -i "$CONTAINER" clickhouse-client \
      --user "$CH_USER" --password "$CH_PASSWORD" --database "$CH_DB" \
      --multiquery < "$f"; then
    echo "❌ $f FAILED (continuing)"
    fails=$((fails + 1))
  fi
done
echo "✓ ClickHouse bootstrap complete ($fails failures)."
exit "$fails"
