# Persona Review — live-rls-rollout-safety-realist
## feat-tenancy-auth-rls-hardening (Child 1 of chore-migrate-legacy-to-brain)

**Persona:** live-rls-rollout-safety-realist — a battle-scarred DBA/SRE who has caused (and cleaned
up) outages from RLS rollouts on live multi-tenant Postgres. I have seen session-mode context bleed,
FK-transitive policy performance collapses, and half-applied migrations that drove every API caller
to 0-row responses at 03:00. My job here is to prove this rollout will either break the live legacy
app or leak data across brands — and to name the acceptance tests that retire each risk.

**Timestamp (UTC):** 2026-05-24T07:30:25Z
**Binding constraints tested:** CF-C1-POOL-1, CF-C1-RLS-DEFAULT-1, CF-C1-FK-SCOPE-1,
CF-C1-ZERO-BEHAVIOR-1, CF-C1-CRON-SCOPE-1, CF-SEC-1

---

## Concern 1 — SET LOCAL DOES NOT SURVIVE TO THE QUERY under the legacy singleton + pgbouncer transaction-mode pool

**Severity: CRITICAL**

### Evidence from the live code

`lib/prisma.ts` creates one process-lifetime `PrismaClient` (`globalThis`-guarded, lines 13-26). That
singleton is connected to `DATABASE_URL` which uses `pgbouncer` in **transaction mode** on port 6543.

In pgbouncer transaction mode, a backend Postgres connection is leased only for the duration of one
client transaction — it is returned to the pool immediately when the transaction ends. The overwhelming
majority of Prisma calls in this codebase are NOT wrapped in an explicit `prisma.$transaction(...)`:
`requireWorkspace` (workspace.ts:30-52) runs two concurrent `prisma.find*` calls via `Promise.all`
outside any transaction; every route handler that does a simple `prisma.shopifyOrder.findMany(...)` is
autocommit. Autocommit single-query calls are each their own implicit transaction.

### The exact failure mode under transaction pooling

**Scenario:** Aryan implements RLS context-setting as:

```typescript
await prisma.$executeRaw`SET LOCAL app.workspace_id = ${workspaceId}`;
await prisma.shopifyOrder.findMany({ where: { connectionId } });
```

Step 1 (`SET LOCAL`) is an autocommit query. pgbouncer issues it to backend connection C7, which sets
`app.workspace_id` on C7's session config for the transaction — then the transaction ends and C7
is immediately returned to the pool. Step 2 (`findMany`) may be dispatched to backend connection C12
(or back to C7, but in transaction mode there is no guarantee of affinity). C12 has no `app.workspace_id`
set. The RLS policy `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)` on C12
evaluates `current_setting('app.workspace_id', true)` which returns NULL (missing key, `missing_ok=true`)
— `NULL::uuid = workspace_id` is NULL — so the USING clause is false for every row. **Result: 0 rows
returned for every workspace-scoped query. Every API endpoint that reads a workspace-scoped table
returns empty.** This is a live-app outage, not a security leak — but it fires the instant RLS is
enabled on the first table if the context-setting is not correctly wrapped.

**Failure mode variant — session-level SET (the leak path):**

If the implementation instead uses `SET app.workspace_id = 'W'` (no LOCAL, no transaction) — which
stays on the backend connection for the entire session lifetime — the risk inverts: in pgbouncer
transaction mode the connection is returned to the pool AFTER the SET, and the NEXT tenant's query
arriving on that same backend connection sees `app.workspace_id = W` (the previous tenant's workspace).
The RLS policy passes for the wrong workspace. This is a **direct cross-brand data read — the exact
breach the entire slice exists to prevent.**

### What the correct pattern is (and why it must be pinned as a constraint, not left to Aryan's judgment)

The only safe design is one of:
1. **tx-wrapped SET LOCAL:** every RLS-scoped read/write is inside an explicit `prisma.$transaction([...])` with `SET LOCAL app.workspace_id` as the FIRST statement inside the same transaction object, guaranteeing the same backend connection handles both the SET and the query.
2. **`set_config('app.workspace_id', $1, true)` as the first statement in the explicit transaction** — same guarantee; the `true` flag makes it transaction-local.
3. **Route all RLS-scoped traffic through `DIRECT_URL` (port 5432 session-mode)** — session-level SET survives because session-mode holds the connection for the client's lifetime. This means maintaining a SECOND PrismaClient instance (or a distinct connection pool) for RLS-scoped reads. The current singleton does not do this.

The plan's CF-C1-POOL-1 names the problem and asks Aryan to decide. My concern is that this decision
is non-trivially easy to get wrong: option 3 (DIRECT_URL) requires a code-split in the singleton
(the current `lib/prisma.ts` has exactly one client, no DIRECT_URL path for reads); options 1/2
require wrapping EVERY workspace-scoped Prisma call in an explicit transaction — which means touching
every route handler and every cron sync loop.

**The acceptance test that retires this concern (Tanvi must ship this before G1 goes GREEN):**

```sql
-- Simulated under the production pgbouncer transaction-pool config (6543):
-- Connection A: SET app.workspace_id = 'brand-alpha-uuid'; -- NO explicit tx
-- Connection B (same backend, next pool dispatch): SELECT workspace_id FROM shopify_orders LIMIT 1;
-- Expected: 0 rows (fail-closed, not Brand Alpha's data)
-- If rows returned from Brand Alpha: CRITICAL LEAK — G1 cannot go GREEN.
```

The test must be run against the ACTUAL `DATABASE_URL` (6543 pool), not DIRECT_URL — because only the
pooled path is the failure domain.

**Binding constraint this tests:** CF-C1-POOL-1, CF-C1-RLS-DEFAULT-1.

---

## Concern 2 — FORCE ROW LEVEL SECURITY BEFORE APP SETS CONTEXT = OUTAGE WINDOW

**Severity: HIGH**

### The ordering trap in the rollout sequence

RLS must be enabled with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` AND (for the table owner, who
bypasses RLS by default in Postgres) `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. Without FORCE RLS,
the Supabase `postgres` superuser/table-owner bypasses all policies — meaning the legacy app using
a privileged role would see ALL rows, not the RLS-filtered set. So the correct final state requires
FORCE RLS. But the window between enabling RLS policies and the app code being deployed with the
`SET LOCAL` context mechanism is a gap where:

- If FORCE RLS fires BEFORE the app is serving the `SET LOCAL` context: every query from the app
  (running as the table owner under the old code) now sees 0 rows. Full outage on any workspace-scoped
  table that has FORCE RLS applied.
- If policies are enabled WITHOUT FORCE RLS (to protect the legacy app): the Supabase privileged
  role bypasses RLS entirely — the policies are decorative and the isolation guarantee does not exist.
  G1 goes GREEN, but the leak is still possible via the privileged role.

### What Supabase specifically does (not a generic Postgres concern)

In Supabase, the application role is `postgres` (the db owner) OR a service-role key that connects as
a privileged role. Supabase's `service_role` key bypasses RLS by design. The legacy app uses the
`DATABASE_URL` connection string which likely uses the `postgres` role or the Prisma/service role —
which bypasses RLS unless FORCE ROW LEVEL SECURITY is set on the table.

This means the rollout has EXACTLY ONE safe ordering:
1. Deploy the app-layer `SET LOCAL` context code FIRST (zero user-visible change — no RLS yet)
2. Enable RLS policies (ENABLE ROW LEVEL SECURITY, CREATE POLICY) — additive; owner still bypasses
3. Verify policies are correct (cross-workspace probe, CF-SEC-1)
4. Only then: FORCE ROW LEVEL SECURITY — this is the moment the owner is also gated
5. Smoke-test every workspace-scoped endpoint before removing the toggle

If step 4 runs before step 1 is deployed, every request the legacy app makes to that table returns
0 rows until the new code is deployed. If deployments are blue-green or have any race window, this
produces a live outage on every workspace-scoped table in sequence.

The A4 rollback for Child 1 is "disable policies" — but FORCE RLS is a DDL operation, and the
rollback is `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` + `DISABLE ROW LEVEL SECURITY`. This
requires a Supabase DDL migration run, not a code flag flip. The plan's language "disable policies
(additive; app-layer scoping still present) — fully reversible" underspecifies this: the rollback
is a DDL operation, not a feature-flag toggle.

**The acceptance test that retires this concern:**

A runbook step in the rollout that PROVES: after step 1 (context-setting code deployed), before step
4 (FORCE RLS), the app responds correctly (no 0-row responses). The go/no-go for FORCE RLS is gated
on this smoke-test, not on a timer.

**Binding constraint this tests:** CF-C1-ZERO-BEHAVIOR-1, tests a gap in A4's rollback description.

---

## Concern 3 — FK-TRANSITIVE RLS ON THE 24 CHILD TABLES: JOIN-BASED POLICIES ARE A PER-ROW SUBQUERY ON A LIVE HIGH-WRITE TABLE

**Severity: HIGH**

### Evidence from the schema

The ~24 FK-transitively-scoped tables — `ShopifyOrder` (scoped via `connectionId`→`ShopifyConnection.workspaceId`), `ShopifyLineItem` (scoped via `connectionId` AND `orderId`), `ProductDailyAggregate` (scoped via `connectionId`), `ShopifyAnalyticsDaily` (scoped via `connectionId`), `meta_ads_daily_metrics` (scoped via `connection_id`→`meta_ads_connections.workspace_id`), `google_ads_daily_metrics`, `google_ads_funnel_daily`, `meta_ads_creative_daily`, `ShiprocketOrder`, `ShiprocketShipment`, `WoocommerceOrder`, `WoocommerceLineItem`, `ShopifyVariant`, `ShopifyProduct`, `ShopifyCustomer`, `shopify_refund_line_items`, `EmailPerformance`, etc. — none carry `workspace_id` directly.

A JOIN-based RLS policy for `shopify_orders` would be:

```sql
CREATE POLICY ws_isolation ON shopify_orders
  USING (
    connection_id IN (
      SELECT id FROM shopify_connections
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
```

This subquery **executes on every row evaluated** during a sequential or index scan of `shopify_orders`. With millions of order rows across all tenants, and an index on `(connection_id, processed_at)` for the common query shape, Postgres must evaluate the subquery to filter rows BEFORE the planner can push down the `connectionId` predicate. In practice, Postgres's RLS policy is applied as a rewrite — it adds the USING clause as a WHERE condition to the query. The planner CAN sometimes push this into an index scan if it can prove the subquery is constant for the session, but this requires the `app.workspace_id` setting to be recognized as stable. This is planner-version-dependent and not guaranteed on Supabase's Postgres 15.

The alternative — denormalizing `workspace_id` onto `shopify_orders`, `shopify_line_items`, `product_daily_aggregates`, etc. — requires:
- A `ALTER TABLE shopify_orders ADD COLUMN workspace_id UUID` migration
- A backfill: `UPDATE shopify_orders SET workspace_id = sc.workspace_id FROM shopify_connections sc WHERE shopify_orders.connection_id = sc.id`
- This backfill on a live high-write table (cron writes `ShopifyOrder` rows continuously during every
  sync tick) is itself a risk: a multi-minute UPDATE on a table with millions of rows holds lock or
  runs with high I/O, risking cron deadlock or statement timeout on Supabase's default 30s statement timeout.

**The concern is not "pick one" — it is that neither option has been proven safe on this specific schema and Supabase's Postgres version, and the plan does not name a spike/test for this before the DDL runs on the live DB.**

**Neither option is obviously wrong — but:**
- JOIN-based policies: risk plan-regression under load (policy subquery not inlined → sequential scan on FK-child tables)
- Denormalization + backfill: risk deadlock/timeout on live `shopify_orders` table during the backfill UPDATE

**The acceptance test that retires this concern:**

An `EXPLAIN (ANALYZE, BUFFERS)` on a representative FK-child table query (e.g., `SELECT * FROM shopify_orders WHERE connection_id = $1 AND processed_at > $2`) WITH the RLS policy applied, run on the Supabase Postgres instance (not a local dev DB), using actual data volumes. The plan must show the policy is either: (a) pushed into an index scan (no seqscan due to policy rewrite), or (b) a denormalized `workspace_id` index is present and the policy uses it directly. If seqscan or nested-loop on millions of rows: the design must be revised before G1 goes GREEN.

**Binding constraint this tests:** CF-C1-FK-SCOPE-1.

---

## Concern 4 — FAIL-CLOSED DEFAULT DESIGN HAS A COMMON NULL-COMPARISON TRAP

**Severity: HIGH**

### The trap

The correct fail-closed predicate for when `app.workspace_id` is not set is:

```sql
-- Safe: missing_ok=true returns NULL; NULL = any_uuid is NULL (not true); row denied.
USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
```

The dangerous variant that produces a silent full-table read leak:

```sql
-- DANGEROUS: if anyone adds this thinking "unset context = system path"
USING (
  current_setting('app.workspace_id', true) IS NULL
  OR workspace_id = current_setting('app.workspace_id', true)::uuid
)
```

The `IS NULL OR` variant means: when no context is set (cron running without workspace scope, or a
pre-context-setting request), the policy permits ALL rows from ALL workspaces. This is precisely the
cron fan-out cross-brand leak that existed before RLS — just re-implemented inside the policy itself.

The risk of this pattern materializing is highest in two places:
1. The `AuditLog` table, whose `workspaceId` is nullable (schema:658). An auditor or developer seeing
   null-workspace rows failing the standard policy might "fix" it with the OR-null variant.
2. The `Notification` table (schema:676), also with nullable `workspaceId?`. Same trap.
3. The cron context: `syncAllShiprocket`, `syncAllMetaAds`, `syncAllGoogleAds` run under the singleton
   client with NO workspace scope set (they fan-out across all connections, not one workspace). After
   RLS is enabled, if these crons do NOT have the `SET LOCAL` context mechanism applied, they will
   hit the policy with `app.workspace_id = NULL` — which under the correct fail-closed predicate means
   0 rows, which means **the cron reads no connections and performs no sync** (full cron outage).
   Under the dangerous OR-null variant, the cron reads all connections (the pre-RLS behavior preserved
   — but now the isolation guarantee is gone).

This creates a **forced choice that is not currently called out in the plan:** the cron paths either
get their own session-scoped context per workspace (which CF-C1-CRON-SCOPE-1 mandates) OR they get a
special policy exception (which CF-C1-RLS-DEFAULT-1 forbids). There is no middle ground. The plan
rightly mandates both (cron converted to per-workspace-scoped in G2), but the exact predicate design
for cron paths during the transition period (between G1/G2 being established but before the cron code
is refactored) is not specified. If cron code is refactored after RLS is enabled, there is a window
where the cron runs under RLS with no context → 0-row reads → no sync → stale data.

**The acceptance test that retires this concern:**

1. Policy predicate review: every USING clause for every table's RLS policy must be reviewed against the trap patterns. No `IS NULL OR`, no `COALESCE(current_setting(...), '')` fallback, no permissive catch-all. Tanvi must verify this as a static SQL review item.
2. A test asserting: `SET app.workspace_id = ''` (empty string) or with no SET at all, then `SELECT COUNT(*) FROM shopify_orders` — must return 0, not the full table count.
3. G1 and G2 must go GREEN together (RLS enabled + cron refactored) in a single coordinated deployment, not in two separate deployments with a gap.

**Binding constraint this tests:** CF-C1-RLS-DEFAULT-1, CF-C1-CRON-SCOPE-1, CF-SEC-1.

---

## Concern 5 — CRON FAN-OUT REFACTOR HAS A DATA-LOSS WINDOW THAT IS NOT ACKNOWLEDGED

**Severity: MEDIUM**

### Evidence from the live code

`syncAllShiprocket` (shiprocket-sync.ts:344-358) and `syncAllMetaAds` (meta-sync.ts:285-297) both do:
```
connections = prisma.{connector}Connection.findMany({ where: { status: 'CONNECTED' } })
for (const c of connections) { await syncFor(c.id) }
```

The cron.ts `/sync-ads` route (lines 64-125) for Shopify does:
```
const connections = await prisma.shopifyConnection.findMany(...)
for (const c of connections) { await Promise.all([syncOrders, syncProducts, syncCustomers]) }
```

Refactoring these to per-workspace-session-scoped invocations means each connection gets its own
session with `SET LOCAL app.workspace_id = c.workspaceId` inside a transaction. The correct refactor
is a per-connection-scoped unit of work.

**The data-loss window:** the Shiprocket integration has no historical event replay (A6.3, confirmed
in A1.3). If the cron-refactor introduces a bug that drops a connection from the fanout (e.g., a
workspace context assertion that fails silently for one connection and skips it), that workspace's
Shiprocket sync stops producing data — and there is no way to replay it. Unlike Shopify (60-day
API replay) or Meta (Insights API window), Shiprocket's missing rows are simply gone.

The concern is not that the refactor is wrong — it must happen per CF-C1-CRON-SCOPE-1. The concern
is that the refactor must produce a per-connection iteration that is ERROR-ISOLATED (one connection
failing context-setup must not stop other connections from syncing) AND has logging that proves
every connection in the CONNECTED set was attempted with a workspace-scoped context per tick.

The existing code structure for `syncAllShiprocket` already iterates per-connection with
`try/catch` per connection (shiprocket-sync.ts:362-380 shows try/catch per `c`), which is the
right shape. The refactor must preserve this error isolation.

**The acceptance test that retires this concern:**

A test that asserts: after the cron-refactor, a connection for Workspace B where `SET LOCAL
app.workspace_id = B` is applied correctly sees only B's Shiprocket shipments; a simulated failure
of context-setup for B does not block C's successful context-setup and sync in the same tick. The
test must run against the pooled `6543` URL, not `5432`.

**Binding constraint this tests:** CF-C1-CRON-SCOPE-1, G2.

---

## Named Outage-Risk Step and Named Leak-Risk Step

### Single step most likely to cause a LIVE OUTAGE:

**Applying `FORCE ROW LEVEL SECURITY` to any workspace-scoped table before the `SET LOCAL` context
mechanism is deployed and smoke-tested in production.**

Mechanism: the legacy app's Prisma client connects as the `postgres` (table-owner) role, which
bypasses standard `ENABLE ROW LEVEL SECURITY`. Only `FORCE ROW LEVEL SECURITY` removes the
owner bypass. If FORCE RLS fires while the legacy app is still running the old code (no context
setting), every single query to that table returns 0 rows — the dashboard shows empty, every metric
is zero, every order list is empty. This applies to ALL workspace-scoped tables simultaneously if
a migration applies FORCE RLS to all tables in one transaction.

**Spike / build acceptance test that retires it:** A pre-flight test on a Supabase branch or staging
environment that runs the FORCE RLS DDL with the OLD app code (no SET LOCAL) and asserts API
responses — must confirm 0-row response pattern fires — then deploys the new context-setting code
and asserts API responses return data. The go/no-go for FORCE RLS in production is gated on this
staged verification, not on confidence.

### Single step most likely to cause a SILENT LEAK:

**Using session-level `SET app.workspace_id = W` (without LOCAL) in any code path that runs under
the pgbouncer transaction-mode pooled connection (port 6543).**

Mechanism: in transaction mode, the backend connection is returned to the pool after the SET's
implicit transaction ends. The next tenant's autocommit query dispatched to that backend connection
inherits `app.workspace_id = W` at session level. The RLS USING clause evaluates to TRUE for the
wrong workspace. The query returns Brand W's data to Brand X's request. This does not throw an
error, generate a log line, or appear in any metric — it is silent. The only way to detect it is
an active cross-tenant probe.

**Spike / build acceptance test that retires it:** A pgbouncer-level interleaved-connection test:
two concurrent Postgres sessions (simulated as two connections from the pool) — session A runs
`SET app.workspace_id = 'brand-alpha-uuid'` outside a transaction; the test immediately dispatches
a query from session B (same backend connection, next pgbouncer dispatch) and asserts that
`current_setting('app.workspace_id', true)` returns NULL or 'brand-beta-uuid', not 'brand-alpha-uuid'.
This test MUST run against the actual `DATABASE_URL` (6543), not DIRECT_URL. If it fails (session A's
value bleeds to session B), the SET LOCAL / explicit transaction design is mandatory and the
implementation is blocked.

---

## One-liner bottom-line

The two highest-probability failure modes are both present in the current design gap: a `SET LOCAL`
issued outside an explicit transaction under pgbouncer transaction-mode will either produce a live
outage (0-row responses on every workspace-scoped endpoint) or a silent cross-brand data read (if
session-level SET is used instead) — and these failure modes are not retired by any named acceptance
test in the current plan; they must be.
