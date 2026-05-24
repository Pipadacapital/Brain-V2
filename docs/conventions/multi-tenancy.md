# Convention: Multi-Tenancy Enforcement (4 Layers)

Every workspace-scoped resource must pass through ALL four enforcement layers.
"No home existed" is not a valid reason to skip a layer — each layer has a home here.

## Layer 1 — JWT claim validation (api-gateway)
- Home: `apps/api-gateway/src/interfaces/` + `apps/api-gateway/src/application/`
- JWT carries: `user_id`, `active_workspace_id`, `role`, accessible-workspace list.
- api-gateway validates the token, extracts `active_workspace_id`, and rejects any
  request where the requested resource workspace does not match the token claim.
- Implement `TenancyInterceptor` in `apps/api-gateway/src/interfaces/`.

## Layer 2 — Service-side assertion
- Home: each service's `src/application/` use-cases (the command/query handlers).
- Assert `request.workspace_id == metadata.workspace_id` on every inbound gRPC call.
- `requireRole(role, workspaceId)` must appear on every mutation use-case.
- `TenancyInterceptor` home: each service's `src/interfaces/`.

## Layer 3 — Postgres RLS
- Home: each TS service's `src/infrastructure/` (Prisma schema + RLS migration).
- Pattern: `CREATE POLICY ws_isolation ON <table> USING (workspace_id = current_setting('app.workspace_id'));`
- Every workspace-scoped table carries this RLS policy.
- `SET LOCAL app.workspace_id = $1` in every transaction before any query.

## Layer 4 — ClickHouse workspace_id predicate
- Home: `pylibs/brain_clickhouse/` (query gateway primitive).
- The CH gateway must reject any query that lacks a `workspace_id` predicate.
- Partition key is `workspace_id` on all ClickHouse tables.

## Kafka envelope (cross-cutting)
- Every Kafka message envelope carries `workspace_id` as a required field.
- Consumer assertion home: each service's `src/infrastructure/` Kafka consumers.
- Convention detail: `docs/conventions/events.md`.

## Idempotency (cross-cutting)
- Every write carries an `idempotency_key` (UUID, caller-generated).
- Cache: Redis (ElastiCache), workspace-scoped key `ws:<workspace_id>:idem:<idempotency_key>`.
- TTL: 24 hours.
- Convention detail: `docs/conventions/events.md`.
