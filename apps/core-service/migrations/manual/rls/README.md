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
   **CF-C3-FORCE-UNLOCK-SCOPE-1 (added 2026-05-24, Child-3 Stage-3):**
   The legacy bare writers (`discoverChannels`, `backfillShiprocketCourierNames`,
   `backfillShiprocketPincodes`) in `legacy project/backend/src/services/shiprocket-sync.ts`
   stay LIVE until the **Shiprocket connector is DECOMMISSIONED** (the last connector,
   sequenced LAST in the Stage-8 HOLD-AT-CUTOVER ceremony). Building the Brain
   framework (Child-3) does NOT silence the legacy writers — only retiring the legacy
   caller at Shiprocket decommission does. Therefore:
   - Condition 2 is NOT satisfied by shipping the Brain framework (Child-3).
   - Condition 2 IS satisfied after Shiprocket decommission + bare-write grep ZERO hits.
   - FORCE IS HELD until Shiprocket decommission + all four conditions met.
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

---

## Path-C bypass + audit (feat-tenancy-rls-live-cutover, Stage 3)

This section covers the files added and the binding constraints introduced by the
`feat-tenancy-rls-live-cutover` slice (Path C ratified by Founder 2026-05-26T16:00:00Z,
CF-CUT-PATH-1). The 44-table DDL above is **unchanged**; these files are additive.

### New files

| File | What it does | When to run |
|------|-------------|-------------|
| `step-c-bypass-audit.sql` | CREATE `bypass_query_log` table + 3 indexes + RLS enable + `ws_isolation` policy + `superadmin_system_rows` policy | Runbook STEP 3.5 — after STEP 3 ENABLE+CREATE, before STEP 4 CF-SEC-1 probe |
| `down-bypass-audit.sql` | DROP policies + DROP TABLE IF EXISTS `bypass_query_log` (idempotent; run BEFORE bypass-revoke per ordering below) | Rollback step 2 — AFTER `down.sql`, BEFORE `ALTER ROLE … NOBYPASSRLS` |
| `scripts/parse-pg-log-to-bypass-audit.sh` | Parses `postgresql.log` mod-statement lines; best-effort regex-extracts `workspace_id`; INSERTs into `bypass_query_log` | Run one-shot or cron'd post-cutover |
| `scripts/post-flip-second-brand-grep.sh` | CF-SEC-3.HARD second-brand tripwire — exit non-zero if non-Sugandh-Lok workspace_id appears in last N minutes | Run at STEP 6 and on demand |

### Path-C ROLLBACK ordering (CF-CUT-ROLLBACK-ATOMIC-1 — BINDING)

The rollback order MUST be:

```
R1  psql "$DIRECT_URL" --file down.sql              # drops all 44-table policies + NO FORCE
R2  psql "$DIRECT_URL" --file down-bypass-audit.sql # drops bypass_query_log policies + DROP TABLE
R3  psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"  # revoke bypass LAST
R4  Brain Decision-Log "rls.rollback" INSERT under app.is_superadmin=true
```

**Why this order matters (G3 kill-test evidence):**

If bypass is revoked (R3) BEFORE the FORCE is removed (R1), the legacy
`postgres.<tenant>` role loses its BYPASSRLS while FORCE ROW LEVEL SECURITY is
still on. With no `app.workspace_id` GUC set (legacy app sets none), every query
on a FORCE'd table returns 0 rows — a silent data outage until R1 runs. The
staging-clone G3.kill capture (`staging-rehearsal/rollback-wrong-order-kill.txt`)
proves this window is real. Target wall-clock for R1→R2→R3 in the correct order:
≤ 60s (bound by the staging-rehearsal timing capture in `rollback-timing.txt`).

### Hold states added by this slice

- **HOLD-AT-BYPASS-REVOKE** (NEW): bypass revoke ceremony is a SEPARATE Stage-8
  slice (Path B legacy retirement). Do NOT run `ALTER ROLE … NOBYPASSRLS` until
  the legacy Express app is permanently off LB and decommissioned.
- **HOLD-AT-STEP-5** (NEW): the DPDP §7 addendum (`06b-dpdp-section7-addendum-draft.md`)
  must be signed by Founder BEFORE Stage-8 STEP 5 executes.

### Exit ceremony (Path-B completion — separate Stage-8 slice)

When the legacy app is retired:

```
E1  Confirm legacy Express permanently off LB (decommissioned)
E2  psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
E3  Brain Decision-Log "bypass.revoke.path-b-completion" INSERT
E4  Re-run CF-SEC-1 probe via rls_app → confirm still GREEN
E5  psql "$DIRECT_URL" --file down-bypass-audit.sql  (drops bypass_query_log)
```
