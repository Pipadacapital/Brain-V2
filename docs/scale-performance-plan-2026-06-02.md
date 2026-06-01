# Brain — Scale & Performance Plan

**Date:** 2026-06-02 · **Author:** Aryan (Architect), at Founder request · **Paradigm:** sql (infra/data-plane; no LLM lever).
**Context:** one anchor brand (Sugandhlok ~83k orders). A4a per-service Postgres roles/grants are KEPT (security + future-physical-split seam; ~zero perf cost — NOT a perf lever).

## Headline
At 83k orders / one brand, nothing is bottlenecked by a missing heavy infra layer. The genuine "now" work is cheap hardening; everything heavy (Redis, replicas, instance split, CDC, sharding) is correctly deferred to triggers.

> **Correction (2026-06-02, post-investigation):** Aryan's first-pass audit said dashboard reads run through the 2,732-line `loopback-data-plane.ts` mirror. That is the **stub/demo fallback**, not the live path. The real read path is `DispatchingDataPlane → LocalDbDataPlane → @brain/core-connectors`, and the connector read functions in `fact-analytics.ts` branch `if (READ_FROM_CH) → fact-analytics-ch.ts` (the `chQuery`/lib-clickhouse-ts companion reading `brain.connector_*_facts`). `docker-compose.yml` sets `READ_FROM_CH: "true"`. **So the ClickHouse read-flip is already built + flag-on** (18 of 24 surfaces have CH companions; the rest fall back to PG). It reads the raw `connector_*_facts` (compute-on-read), NOT the pre-aggregated `workspace_daily_metrics_*` MV — using the MV is the remaining *scale* optimization, not needed at 83k. The genuinely-missing items are the query timeouts (now shipped) + PG indexes + (later) MV pre-aggregation + applying CH migrations in prod.

## Per-lever inventory
| Lever | Buys at scale | Current state | Classification / trigger |
|-------|---------------|---------------|--------------------------|
| ClickHouse OLAP read path | columnar, partition-pruned, ws-scoped reads; removes OLTP load | BUILT + TESTED (`query_gateway.py`, MV `0002_mv_computed_ratios.sql`) but NOT serving live + migrations not applied | **BUILD-NOW (highest leverage)** |
| Query timeouts | caps blast radius of pathological queries | GAP — no CH `max_execution_time=30s`, no PG `statement_timeout` | **BUILD-NOW (trivial)** |
| PG composite indexes `(workspace_id, sort_key)` | cheap RLS + cheap keyset on hot tables | likely gaps on OFFSET/admin tables | **BUILD-NOW (cheap)** |
| `cogs_mu` scheduled rollup | correct CH cost ladder after read-flip | described (`CF-C4-COGS-MV-REFRESH-1`) but no scheduler | **BUILD-NOW (read-flip prereq)** |
| Keyset pagination (full) | removes O(n) deep-page cliff | bounded-OFFSET guard live (`application/shared/pagination.ts`); full conversion = `req-keyset-pagination-admin-tables` | TRIGGER: Scale-tier / 2nd large brand |
| Redis / ElastiCache cache-aside | cached read = CH/LLM call not paid | SEAM-ONLY (idempotency/rate-limit are in-process) | TRIGGER: gateway >1 instance OR repeated-read cost shows up → **Founder/Rohan (new infra)** |
| Connection pooling (Supabase `:6543`) | survive connection storms | PARTIAL — session-mode direct `:5432`, `Pool max:10`. RLS `set_config` per-tx breaks under STATEMENT pooling | TRIGGER: instances×pool nears ceiling. **Builder heads-up: must be tx/session mode** |
| Read replica | isolate analytics/backfill from OLTP | ABSENT (correct; mostly mooted by the CH read-flip) | TRIGGER: Phase-2 → **Founder/Rohan** |
| Physical instance-per-service split | true DB-per-service + independent scaling | SEAM-ONLY (A4a roles) | TRIGGER: diverging scaling / team >4 / Phase-2 → **Founder/Rohan** |
| CH `LowCardinality`/`FINAL`, partitioning | read efficiency | ORDER BY ws-first + monthly partition present; verify LowCardinality/FINAL on fact tables `0003–0010` | verify at read-flip |
| N+1 / sequential layout | — | CLEAN (no antipattern found) | none |
| Debezium 90-day mirror / CDC | lean OLTP + columnar history | SEAM-ONLY | TRIGGER: >1 consumer needs the mirror (Phase-2) → **Founder/Rohan** |

## BUILD-NOW set (architect-authorized, additive, real value at current scale)
Sequence — **first item is the highest leverage**:
1. **ClickHouse read-flip** — apply CH migrations `0001–0010`; ensure ingestion/analytics populate `workspace_daily_metrics_base`; flip `DataPlanePort` metric surfaces from loopback/PG → `query_metrics`; verify `LowCardinality`/`FINAL`. *Only item with real risk → gets a HOLD-AT-READ-FLIP runbook + real-network CH smoke.*
2. **`cogs_mu` scheduled rollup** — EventBridge→in-service handler (read-flip correctness prereq).
3. **Query timeouts** — CH `max_execution_time=30s` in `query_gateway.py` + PG `statement_timeout` on the pool (trivial; do alongside #1).
4. **PG composite indexes** on hot RLS/OFFSET tables (sets up cheap RLS now + cheap keyset later).

## Honest verdict
At 83k orders / one brand: do the narrow, cheap "now" work (flip onto ClickHouse + timeouts + a few indexes + COGS rollup). Everything else (Redis, pooler, replica, instance split, CDC, sharding, full keyset) is **correctly deferred** — the seams already make later graduation mechanical. Pulling heavy infra forward now is premature optimization that adds cost the load doesn't justify.

## Escalation
- **Architect-authorized:** CH read-flip, timeouts, PG indexes, COGS rollup schedule, and when each ships.
- **Founder/Rohan (real AWS cost/ops):** ElastiCache/Redis, read replica, physical instance-per-service split, provisioned MSK/Debezium.
- **Builder heads-up (not escalation):** before enabling Supabase transaction pooler `:6543`, confirm tx/session mode — statement-mode pooling breaks the RLS `set_config`-per-tx design (`workspace-context.ts:199`).
