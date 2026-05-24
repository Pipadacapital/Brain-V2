# Convention: Data Model — OLTP/OLAP Split

## The split
- **OLTP (Postgres):** transactional writes, domain aggregates, audit, billing, consent.
  One Postgres schema per bounded context.
- **OLAP (ClickHouse):** metric aggregations, time-series, large-scale analytics queries.
  The `brain_clickhouse` query gateway (Layer 4 of tenancy) is the only path to CH.

**Never query ClickHouse from a synchronous request path.** CH queries belong in
async analytics jobs and scheduled aggregations.

## Bounded context schema splits (Postgres)
Each service owns its Postgres schema. Schema is NOT shared across services.

| Service | Postgres schema(s) |
|---------|--------------------|
| `core-service` | `core` (orgs, workspaces, users, roles), `billing`, `audit`, `consent` |
| `analytics-service` | `analytics` |
| `intelligence-service` | `ai` (Decision Log: `ai.decision_log`) |
| `lifecycle-service` | `lifecycle` |
| `notifications-service` | `notifications` |
| `ingestion-service` | `ingestion` |

## Homes
- **Prisma 7 schema + RLS migrations:** each TS service's `src/infrastructure/`
- **ClickHouse query gateway:** `pylibs/brain_clickhouse/`
- **OLAP schema definitions:** `apps/analytics-service/src/infrastructure/`

## RLS policy pattern (all workspace-scoped tables)
```sql
ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON <schema>.<table>
  USING (workspace_id = current_setting('app.workspace_id')::uuid);
-- In every transaction:
SET LOCAL app.workspace_id = '<workspace_id>';
```

## Money
All monetary amounts in BIGINT (minor units) + `currency_code CHAR(3)`.
See `docs/conventions/money.md`.

## Timestamps
All timestamps explicit UTC (`TIMESTAMPTZ` in Postgres, `DateTime` in ClickHouse).
Display converts to `Asia/Kolkata` in the presentation layer only.
