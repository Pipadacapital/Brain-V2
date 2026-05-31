# infra/migrations — schema migration index

Per the Brain spec, this is the single index of all DB migrations (Postgres via Prisma +
ClickHouse SQL). Honoring **one-writer-per-store**, migration *files* live next to their
owning service; this index records where each owner keeps them.

| Store | Owner service | Migration location |
|---|---|---|
| Postgres `core.*` / `billing.*` / `audit.*` / `consent` | core-service | `apps/core-service/migrations/` (`local-dev/`, `manual/`) |
| ClickHouse raw + canonical + derived | analytics-service | `apps/analytics-service/migrations/clickhouse/` |
| ClickHouse raw ingest + Postgres mirror + watermarks | ingestion-service | `apps/ingestion-service/migrations/manual/` |
| Postgres `ai.*` (Memory Layer, pgvector) | intelligence-service | `apps/intelligence-service/migrations/postgres/` |
| Postgres `lifecycle.*` / `support.*` | lifecycle-service | (Phase-2 build) |
| Postgres `notifications.*` | notifications-service | (Phase-2 build) |

Legacy→Brain ETL (one-shot, reference): `tools/migrate-legacy/`.
