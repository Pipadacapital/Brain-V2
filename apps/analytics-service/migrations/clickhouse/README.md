# ClickHouse DDL Runbook — Brain analytics-service

## Status: STAGE-8 APPLY ONLY

**ZERO of these files are executed this child (Child 4).**
The DDL is a runbook artifact. Execution is a Stage-8 named-ownership gate.

This mirrors the `apps/core-service/migrations/manual/rls/` discipline from Child-1:
runbook-as-deploy-artifact, Founder-reviewed, Jatin-applied.

---

## Pre-apply checklist (Stage-8 gate)

Before executing ANY file in this directory:

- [ ] **Residency verified:** confirm ClickHouse endpoint is in `ap-south-1` (the service startup
      assertion will refuse to start on mismatch, but this is a belt-and-suspenders check).
      CF-C4-RESIDENCY-1.
- [ ] **Analytics Postgres read-only role provisioned** on the live DB (@jatin):
      the `brain_analytics_ro` role must be granted SELECT only — no INSERT/UPDATE/DELETE.
      CF-C4-SINGLE-WRITER-GREP-2 / analytics-service startup assertion.
- [ ] **`brain` database created:** `CREATE DATABASE IF NOT EXISTS brain;`
- [ ] **No live read-source flip yet:** legacy Postgres rollup remains authoritative until
      the flip gate (separate Stage-8 step with Rohan DDR sign-off).
- [ ] **cogs_mu scheduler configured:** the scheduled full daily recompute job must be
      deployed before the MV is applied. CF-C4-COGS-MV-REFRESH-1.
      DO NOT use an incremental MV for cogs_mu — see §COGS note below.

---

## Apply order

```
1. 0001_base_workspace_daily_metrics.sql     — base/raw table
2. 0002_mv_computed_ratios.sql               — computed-ratio target + MV
```

Apply via ClickHouse client:
```bash
clickhouse-client --host <ap-south-1-endpoint> --user <admin> --password <secret> \
    --queries-file apps/analytics-service/migrations/clickhouse/0001_base_workspace_daily_metrics.sql

clickhouse-client --host <ap-south-1-endpoint> --user <admin> --password <secret> \
    --queries-file apps/analytics-service/migrations/clickhouse/0002_mv_computed_ratios.sql
```

---

## COGS note (CF-C4-COGS-MV-REFRESH-1)

`cogs_mu` is populated by a **scheduled full daily recompute**, NOT by an incremental MV.

Rationale: a true incremental ClickHouse MV is permanently wrong on a `coq`-settings-change
day. The MV captures the old `coq` for events inserted before the settings change and the new
`coq` for events after. The legacy `compute-daily.ts` re-runs the full day each night, always
using the current `coq`. The scheduled full-recompute model preserves exact-integer-equality
with legacy by construction.

The `cogs_mu` column in the base table is populated by the nightly scheduled job. The ratio
MV (`0002`) reads `cogs_mu` as-is and does NOT derive it incrementally.

---

## intDiv guard (CF-C4-RATIO-DIVOP-1)

Every ratio expression in the DDL follows the template in `_divop_template.sql`:

```sql
if(<denom> > 0, intDiv(<num>, <denom>), NULL)
```

The static grep gate (enforced in Brain CI / check-metrics-parity.sh) will RED on any `/`
operator appearing near a metric column. Do NOT introduce `/` in any future MV expression.

---

## Read-only role provisioning note (@jatin)

The `brain_analytics_ro` Postgres role must be created with SELECT-only grants before
Stage-8 go-live. The analytics-service asserts at startup that its Postgres connection role
is read-only. If the role has write permissions, the service refuses to start.

```sql
-- Postgres (Supabase ap-south-1)
CREATE ROLE brain_analytics_ro WITH LOGIN PASSWORD '<secret>';
GRANT CONNECT ON DATABASE brain TO brain_analytics_ro;
GRANT USAGE ON SCHEMA public TO brain_analytics_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO brain_analytics_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO brain_analytics_ro;
-- Explicitly REVOKE write grants (belt-and-suspenders):
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM brain_analytics_ro;
```

---

## Reversibility

Fully reversible at Stage-8 if needed:
```sql
DROP MATERIALIZED VIEW IF EXISTS brain.workspace_daily_metrics_mv;
DROP TABLE IF EXISTS brain.workspace_daily_metrics_computed;
DROP TABLE IF EXISTS brain.workspace_daily_metrics_base;
```

The legacy Postgres rollup remains the single writer and authoritative source
until the live read-source flip is executed (separate Stage-8 step).
