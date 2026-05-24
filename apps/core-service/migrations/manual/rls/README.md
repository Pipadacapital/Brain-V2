# RLS DDL — RUNBOOK-GATED / MANUAL (CF-BN-DDL-GATING-1)

**THIS DIRECTORY IS NOT SCANNED BY ANY MIGRATION RUNNER.**

No file in this directory will ever be executed by `prisma migrate deploy`,
`migrate up`, Flyway, or any other automated runner. The SQL here is
**Stage-8 only**, executed manually by a human operator (@jatin) following
`rollout-runbook.sh` exactly.

## Hold state: HOLD-AT-FORCE (C5)

Per Child-0 §A2.1 (amended by `feat-tenancy-rls-brain-native`, 2026-05-24):

The C5 gate is in the **SATISFIABLE** state (Brain code + LOCAL-verified).
It moves to **LIVE/FORCED** only at Stage-8 when ALL of:

1. A context-aware Brain runtime is the live DB consumer for the FORCE'd table
   set, OR the live consumer is proven 100% service-role.
2. Child-3 converts all residual no-context writers (backfill, discoverChannels,
   inner sync libs — enumerated in the runbook STEP-5 bare-write grep).
3. The complete bare-write grep returns ZERO hits (the runbook grep MUST NOT
   use `grep -v backfill` or `grep -v discoverChannels` — that was the DEFECT
   in the legacy implementation).
4. Per-table FK-scope EXPLAIN gate passes (documented in rollout-runbook.sh).

**FORCE IS HELD UNTIL ALL FOUR CONDITIONS ARE MET. Do not run step-b-force.sql
without Founder/CTO-Advisor sign-off that all four conditions are satisfied.**

## Files

| File | What it does | When to run |
|------|-------------|-------------|
| `step-a-enable-create.sql` | ENABLE RLS + CREATE fail-closed `ws_isolation` policy on all 44 workspace-scoped tables (4 FK-scope shapes) | Runbook STEP 3 — after quiesce-crons (STEP 1) |
| `step-b-force.sql` | FORCE ROW LEVEL SECURITY per table (44 tables) | Runbook STEP 5 — **HELD** until HOLD-AT-FORCE conditions met |
| `down.sql` | Symmetric rollback: NO FORCE → DISABLE → DROP POLICY for all 44 tables | Rollback only — `psql $DIRECT_URL --file down.sql` |
| `rollout-runbook.sh` | 6-step harness (STEP 0–STEP 6) with machine-asserted go/no-go | @jatin executes at Stage-8 |

## Policy shapes (CF-C1-RLS-DEFAULT-1.a)

All policies use only the APPROVED shapes:

- **Direct (22 tables):** `USING/WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid)`
- **connId-FK 1-hop (~17 tables):** `connection_id IN (SELECT id FROM <conn_table> WHERE workspace_id = current_setting(...)::uuid)`
- **orderId-FK 2-hop (1 table: woocommerce_line_items):** nested subquery through woocommerce_orders → woocommerce_connections
- **Dual-policy (3 tables: audit_logs, notifications, system_settings):** ws-scoped + `superadmin_system_rows` via `app.is_superadmin`

## Banned shapes (fail-closed enforcement)

The following shapes are BANNED and their absence is statically verified by
the Track T test suite:

- `OR ... IS NULL` (would allow null-context bypass)
- `COALESCE(...)` (same bypass risk)
- `USING (true)` (open policy — allows everyone)
- Session-level `SET` (leaks across pgbouncer txn-pool connections)

## GUC names (stable identifiers — do not rename)

- `app.workspace_id` — set per-tx to the workspace UUID by `withWorkspace()`
- `app.is_superadmin` — set to `'true'` by `withSuperadmin()`; `'false'` by `withWorkspace()`
