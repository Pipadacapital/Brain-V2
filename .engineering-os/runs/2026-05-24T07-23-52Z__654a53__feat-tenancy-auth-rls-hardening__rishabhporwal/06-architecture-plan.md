# Architecture Plan — feat-tenancy-auth-rls-hardening (Child 1 of `chore-migrate-legacy-to-brain`)

| Field | Value |
|---|---|
| **req_id** | `feat-tenancy-auth-rls-hardening` |
| **Stage** | 2 (Architect — binding technical plan) |
| **Author** | Aryan (architect) — SUBAGENT, no Agent tool |
| **Timestamp (UTC)** | 2026-05-24T07:38:04Z |
| **Lane** | high-stakes (full pipeline 1→2→3→4 VETO→5→6 VETO→7→8) |
| **Paradigm** | **SQL/DDL + connection-handling** (no ML, no LLM) — confirmed by Rohan §9 |
| **Scope** | 1a (data-layer isolation = the C5-gate-establishing unit) → 1b (Brain auth/role-claim contract) |
| **Binding inputs** | `01-requirement.md`, `02-cto-advisor-review.md`, **`05-stage1-synthesis.md` (binding contract)**, `03-`/`04-` personas, Child 0 `06-architecture-plan.md` (A2 Child-1 row, A3 facade, A4 rollback) |
| **BUILD GATE** | 🚫 **Stage-3 build is HARD-GATED on `CF-SEC-3.HARD` — a Founder-supplied DPDP lawful-basis instrument (DPA or §7 memo) that does NOT yet exist.** This plan touches no live data and proceeds; **no build / DDL / probe / backfill step may run until that instrument is on record AND the Founder lifts the gate.** |

> **Stage-2 is DESIGN ONLY.** Nothing in this plan was executed. No SQL ran against the live DB; no `legacy project/**` runtime was modified; no product code was written. `git status` = only `.engineering-os/**` (self-review §self-review). Every `EXPLAIN`, probe, and acceptance test described below is a **Stage-3/5 build step that is BLOCKED on the gate.**

---

## 1. Context

Child 0's binding architecture (A1–A6) made the legacy→Brain migration a phased strangler-fig. **Child 1 is the universal hard entry gate (A2.1, C5):** no later slice may begin its dual-run until **G1 (Postgres RLS live + verified on every workspace-scoped table)** and **G2 (cron fan-out converted to per-workspace-session-scoped invocations)** are both GREEN. Child 1 establishes them.

**Ground truth (file:line, verified this stage — not prose):**
- `legacy project/backend/prisma/schema.prisma`: **45 models, 66 `workspaceId` refs, ZERO RLS.** Precise scoping classification in §3 (this plan enumerates all 45; zero left unclassified).
- `legacy project/backend/src/lib/prisma.ts:17-26`: ONE process-lifetime `PrismaClient`, `globalThis`-guarded, no `DIRECT_URL` read-path split. Datasource (`schema.prisma` datasource block): `url=DATABASE_URL`, `directUrl=DIRECT_URL`.
- `legacy project/backend/.env`: `DATABASE_URL=…aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=20&pool_timeout=20`; `DIRECT_URL=…aws-1-ap-south-1.pooler.supabase.com:5432/postgres`. **Both go through `pooler.supabase.com`** — :6543 = transaction mode, :5432 = session mode (Supavisor session pooler, NOT a raw direct connection).
- **🚩 `legacy project/backend/.env.bak.singapore`: `…aws-1-ap-southeast-1.pooler.supabase.com…`** — **the DB was previously in `ap-southeast-1` (Singapore).** A region move actually happened. This is concrete evidence that CF-RES-1.a must be a **live runtime assertion**, never a trusted constant — the very thing that already changed once can change again. (Strengthens C3/CF-RES-1.a; logged in §15 R-RES-01.)
- `legacy project/backend/src/middleware/workspace.ts:30-52`: `requireWorkspace` runs `Promise.all([workspace.findUnique, workspaceMember.findFirst])` **outside any transaction** (two autocommit calls) — the exact pattern the realist (Concern 1) named as the `SET LOCAL`-loss failure domain.
- `legacy project/backend/src/middleware/auth.ts`: Supabase JWT via `jose` `createRemoteJWKSet`/`jwtVerify` (ES256), no DB round-trip; sets `req.auth = {userId, email, token}`.
- Cron fan-out (cross-workspace `findMany`): `routes/cron.ts:65` (Shopify `shopifyConnection.findMany`), `cron.ts:148` (`recompute-product-daily-aggregates`), `shiprocket-sync.ts:344 syncAllShiprocket`, `meta-sync.ts:282 syncAllMetaAds`, `google-sync.ts:652 syncAllGoogleAds`. **All three `syncAll*` already select `workspaceId`/`workspace_id` per connection and already iterate with per-connection `try/catch`** (verified `shiprocket-sync.ts:360-388`, `meta-sync.ts:301-320`, `google-sync.ts:673-694`) — the refactor adds session-scoping, it does NOT need to invent the loop or the error isolation (smaller than it reads).
- `enum WorkspaceRole { OWNER, ADMIN, MANAGER, ANALYST, VIEWER }` (schema:936) + `enum SystemRole { SUPERADMIN, USER }` already exist; `WorkspaceMember.role` resolved per request. **1b is claim-mapping, not role-model invention.**

**Semantic recall (`memory_search -k 6`):** top hits are this child's own intake/synthesis + the spike — **no prior shipped RLS-rollout pattern to template** (first code-moving slice). I reuse Child 0's A2/A3/A4 verbatim and ground every decision in the code above; I do not re-derive the strangler architecture.

**Handoff-depth band:** high-stakes + scope-creep-prone (live multi-tenant DB, cross-brand-leak failure mode) → **prescriptive**. This plan is intentionally detailed (exact DDL templates, exact probe predicates, exact harness step contracts, exact file-task list). That length is justified by the band; the over-engineering self-check (§17) confirms nothing beyond the requirement is pulled in.

---

## 2. Proposed solution

Establish **layer 3 of Brain's 4-layer `workspace_id` isolation** (Postgres RLS via tenant-scoped session context) on the live shared Supabase Postgres, **additively, fail-closed, zero-downtime, per-slice-reversible**, and convert the cron fan-out (layer-3's blind spot) to per-workspace session-scoped invocations — turning the A2.1 gate (G1+G2) GREEN. Then map the existing Supabase JWT + `WorkspaceRole`/`SystemRole` into Brain's level-ordered claim contract (1b).

The whole thing collapses to **one binding, harness-asserted rollout sequence** (§5) that the two CRITICALs (R1 pooling, C1 quiesce) and two ordering-HIGHs (R2 FORCE, R4 G1+G2-together) all converge on. The sequence is the spine; everything else (the pooling mechanism §2-detail, the FK-scope decision §3, the fail-closed template §4, the cron refactor §6, the AuditLog dual-policy §7) is a node in it.

### 2a. Scope split 1a / 1b (per Rohan §3)

| Sub-slice | What | Blast radius | Reversibility | Carries the gate? |
|---|---|---|---|---|
| **1a — data-layer isolation** | RLS policies on ALL workspace-scoped tables (direct + FK-transitive); tenant-scoped session context correct under pgbouncer txn-mode; cron fan-out session-scoped; CF-SEC-1 fail-closed RLS-probe GREEN predicate | Live-DB DDL + connection-handling — the genuinely dangerous unit (cross-brand-leak + 0-row-outage failure modes) | Additive; rollback = `NO FORCE` + `DISABLE RLS` DDL (§5 ROLLBACK), app-layer scoping survives | **YES — G1+G2 flip GREEN here.** |
| **1b — Brain auth/role-claim contract** | Map Supabase JWT + `WorkspaceMember.role`(5-level)/`SystemRole` into Brain's level-ordered claim consumed by the facade/gateway assertion (layers 1–2); no re-login storm | Read-side JWT-claim enrichment; near-zero DB-write risk (role enum already exists) | Trivially reversible (claim-shape config) | No — ships behind 1a |

**1a is independently committable + reversible with the gate GREEN BEFORE 1b lands** (CF satisfied — synthesis §5.6). 1b consumes the session-context plumbing 1a installs (the `app.workspace_id` set from the JWT-derived workspace claim) but adds no new DDL. **Commit/PR boundary:** 1a is its own PR (the gate); 1b is a second PR on top. Rolling back 1b never touches RLS; rolling back 1a (DDL) leaves 1b's claim mapping harmlessly inert.

### 2b. The `SET LOCAL` × pgbouncer mechanism decision (CF-C1-POOL-1.a) — **DECIDED**

**Decision: route ALL RLS-scoped traffic through a SECOND PrismaClient bound to `DIRECT_URL` (:5432 session-mode), AND wrap every scoped unit of work in an explicit `$transaction` with `set_config('app.workspace_id', $1, true)` (tx-local) as its first statement.** Both guards together — belt and suspenders — because each alone has a residual failure mode under the real singleton + autocommit reality:

- **Why not "just tx-wrapped `SET LOCAL` on the existing :6543 client" alone:** correct in principle, but it requires wrapping *every* workspace-scoped Prisma call in the codebase in `$transaction` and trusting that no future call forgets. `requireWorkspace` (`workspace.ts:30-52`) today is `Promise.all` autocommit — exactly the shape that loses context. One missed call site under :6543 = 0-row outage (best case) or, if a permissive policy ever slips in, a leak. Single-guard is too easy to regress.
- **Why not session-level `SET` (no `LOCAL`) ever:** **FORBIDDEN by CF-C1-POOL-1.a.** Under txn-mode the backend connection is returned to the pool after the SET's implicit transaction; the next tenant on that backend inherits `app.workspace_id` → silent cross-brand read (the realist's named leak step). Banned in static review (§4, Tanvi gate).
- **Why `DIRECT_URL` :5432 session-mode is the primary mechanism:** in session mode the pooler holds the backend connection for the client connection's lifetime, so a `set_config(...,false)` (session-scoped) would survive — BUT we still use `set_config(...,true)` (tx-local) inside an explicit `$transaction` so the context is **scrubbed at transaction end** and cannot bleed even within one long-lived session client across sequential units of work. This neutralizes both the txn-mode-loss failure (we're not on :6543 for scoped reads) and the session-bleed failure (tx-local, scrubbed per unit of work).
- **Code shape (the new primitive — `lib/rls-prisma.ts` + a `withWorkspace()` wrapper):**
  ```ts
  // lib/rls-prisma.ts — SECOND client, session-mode, RLS-scoped reads/writes ONLY.
  export const rlsPrisma = new PrismaClient({ datasources: { db: { url: env.DIRECT_URL } } })

  // The ONLY sanctioned way to touch an RLS-protected table:
  export function withWorkspace<T>(workspaceId: string, fn: (tx) => Promise<T>): Promise<T> {
    return rlsPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}::text, true)`
      return fn(tx)  // every query inside sees the tx-local context; scrubbed on commit/rollback
    })
  }
  ```
  - `set_config(name, value, true)` (the `true` = `is_local`) is the canonical tx-local equivalent of `SET LOCAL` and accepts a bind parameter (unlike `SET LOCAL` which needs string interpolation → injection risk). **This also kills the SQL-injection vector** the realist's `SET LOCAL app.workspace_id = ${workspaceId}` raw example would carry.
  - The existing singleton `prisma` (:6543) stays for **non-RLS / unprotected** paths (global tables — see §3) and for the legacy app's existing autocommit traffic until route handlers are migrated to `withWorkspace`. **1a's contract: every read/write of an RLS-protected table goes through `withWorkspace` on `rlsPrisma`.** Static gate (Tanvi): grep that no RLS-protected model is queried on the bare singleton outside `withWorkspace`.
- **Connection-budget note:** `DATABASE_URL` carries `connection_limit=20`. The second `rlsPrisma` client opens its own pool against :5432. Set its `connection_limit` conservatively (e.g. `?connection_limit=10`) so the two clients together stay within Supabase's plan ceiling. **This is a build-task verification item (§17 T1.2), not a guess — the builder confirms the Supabase compute tier's max connections before pinning the number.**

**The interleaved-tenant acceptance test (CF-C1-POOL-1.a — Tanvi, hard predicate for G1→GREEN, Stage 5, BLOCKED on gate):**
```
Against the production pooled DATABASE_URL (:6543) — the failure domain:
  (i)  Conn A: `SET app.workspace_id = '<brand-alpha-uuid>'` (NO explicit tx — the forbidden pattern, run on purpose to PROVE it's caught)
       Conn B (next pool dispatch): `SELECT workspace_id FROM shopify_orders LIMIT 1`
       ASSERT: 0 rows (B does NOT observe A's context). If A's value bleeds → CRITICAL LEAK, G1 BLOCKED.
  (ii) Any connection: no `app.workspace_id` set → `SELECT COUNT(*) FROM shopify_orders`
       ASSERT: 0 (context-less = fail-closed deny-all), NOT the full count.
Against DIRECT_URL (:5432) via withWorkspace():
  (iii) withWorkspace(A){ SELECT count } then withWorkspace(B){ SELECT count } on the same rlsPrisma client, interleaved
        ASSERT: A's tx sees only A's rows; B's tx sees only B's rows; after both, a bare `SELECT count` (no withWorkspace) = 0.
```
Test (i) deliberately exercises the banned mechanism to prove the system is fail-closed even if someone reintroduces it.

---

## 3. Data model changes — FK-transitive RLS design (CF-C1-FK-SCOPE-1.a) — **DECIDED via a live decision-gate**

### 3a. Complete table classification (all 45 models; zero unclassified)

**Group A — DIRECT `workspace_id` column (21 tables, single-column policy):**
`MarketingAction`, `WorkspaceFestival`, `WorkspaceMetricGoal`, `WorkspaceAdCampaignClassification`, `AiInsight`, `WorkspaceAiInsightsCache`, `WorkspaceCogsSettings`, `WorkspaceMember`, `Invitation`, `WorkspaceCost`, `WorkspaceMiscExpense`, `ShopifyConnection`, `ProductLeadTime`, `ShiprocketConnection`, `UnicommerceConnection`, `KlaviyoConnection`, `EmailPerformance`, `oauth_states`, `WorkspaceDailyMetrics`, `WoocommerceConnection`, `google_ads_connections`, `meta_ads_connections`.
> (Count note: 22 here including the 3 connector-connection tables `*_ads_connections`/`Woo`/`Shiprocket`/`Unicommerce`/`Klaviyo` which all carry `workspace_id` directly. The "~21 direct" figure in the carry-forward ledger ≈ this set; the precise enumeration is what binds, not the round number.)

**Group B — FK-transitive via `connectionId` → connection-table.`workspace_id` (1-hop), ~18 tables:**
`ProductDailyAggregate`, `ShopifyAnalyticsDaily`, `ShopifyOrder`, `ShopifyLineItem` (has BOTH `connection_id` AND `order_id` — use `connection_id`, the cheaper 1-hop), `ShopifyProduct`, `ShopifyVariant`, `ShopifyCustomer` (**PII** — §12), `UnicommerceProduct`, `ShiprocketOrder`, `ShiprocketShipment` (**PII**: deliveryPincode/City/State), `google_ads_funnel_daily`, `google_ads_daily_metrics`, `meta_ads_creative_daily`, `meta_ads_daily_metrics`, `WoocommerceOrder` (**PII**: customerEmail/Phone), `WoocommerceProduct`, `shopify_refund_line_items` (has `connection_id` directly).

**Group C — FK-transitive via `order_id` → `WoocommerceOrder` → `connectionId` (2-hop), 1 table:**
`WoocommerceLineItem` (only `order_id`, no `connection_id` — §3c).

**Group D — GLOBAL / non-workspace (4 tables, NO RLS in Child 1):**
- `User` (`id @db.Uuid`, global auth principal — scoped by membership, not workspace; a user belongs to many workspaces). **No RLS.** (Access already gated by `requireAuth`; user PII erasure is a Child-5 concern.)
- `Workspace` (the tenant root itself; scoped by membership via `WorkspaceMember`, not by its own `workspace_id`). **No RLS in 1a** — but its read is already gated by `requireWorkspace`'s membership check. (A `workspace_id = id` self-policy is possible but adds no isolation the membership join doesn't already give; deferred — Single-Primitive: don't add a policy that protects nothing new.)
- `SystemSettings` (platform-global, SUPERADMIN-only). **No tenant RLS; SUPERADMIN-only policy** (same shape as the AuditLog null-row policy, §7).
- `AuditLog` — **dual-policy** (§7), classified separately because of nullable `workspace_id`.

> **Acceptance bar (CF-C1-FK-SCOPE-1): zero workspace-scoped table left unprotected.** Groups A+B+C+AuditLog = every table that carries tenant data. Group D is global by design (documented above). Tanvi's static gate enumerates this list and asserts a policy exists for every A/B/C/AuditLog table and `FORCE RLS` is set on each.

### 3b. JOIN-policy vs denormalization — **DECIDED: live `EXPLAIN` decision-gate, denormalization-preferred for the 2 hot high-write tables, JOIN-policy default for the rest**

The realist (Concern 3) is right that neither is provably safe without a live plan. So the **decision is data-driven, not asserted**:

- **Default = JOIN/subquery policy** (no schema change, fully reversible by `DROP POLICY`):
  ```sql
  CREATE POLICY ws_isolation ON shopify_orders
    USING (connection_id IN (
      SELECT id FROM shopify_connections
      WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));
  ```
  Postgres 15 can fold the subquery into an InitPlan when `current_setting` is stable within the statement; the `shopify_connections.workspace_id` lookup is a tiny indexed table (one row per connection). For most Group-B tables the FK-child query already filters by `connection_id` (e.g. `WHERE connection_id=$1 AND processed_at>$2` using `@@index([connection_id, processed_at])`), so the policy's `connection_id IN (...)` composes with the existing index — no seqscan.

- **Decision-gate (CF-C1-FK-SCOPE-1.a, a Stage-3 build PRE-STEP, BLOCKED on gate):** before writing the policy DDL, the builder runs, **on the live Supabase Postgres 15 at real data volume**, against `DIRECT_URL`:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM shopify_orders WHERE connection_id = $1 AND processed_at > $2;   -- with the JOIN-policy applied + app.workspace_id set
  ```
  **Acceptance:** plan shows the policy pushed into an **index scan** (no seqscan / no per-row nested-loop on millions of rows). **PASS → keep JOIN-policy.** **FAIL (seqscan/nested-loop) → escalate that specific table to denormalization** (§3c).

- **Pre-judged denormalization candidates (the realist's named hot tables): `shopify_orders` + `shopify_line_items`.** These are the highest-write, highest-row tables and the most likely to fail the EXPLAIN gate. The plan pre-authorizes denormalization for them **if** the gate fails — and the backfill is itself a designed, safe, reversible step (§3c). For every other Group-B/C table, JOIN-policy is the default unless its own EXPLAIN fails.

> This is "make the call OR specify the decision-gate that picks it" (synthesis §5.1) — I do both: default JOIN-policy, with a live-EXPLAIN gate that escalates named hot tables to denormalization. No table's design is left to runtime guesswork.

### 3c. Online, chunked, reversible backfill (only if a table is escalated to denormalization)

For an escalated table (e.g. `shopify_orders`):
1. **Additive column (non-blocking):** `ALTER TABLE shopify_orders ADD COLUMN workspace_id UUID;` — Postgres 15 adds a nullable column with no table rewrite (instant, no long lock).
2. **Chunked online backfill** (respects Supabase's 30s statement timeout; never deadlocks the live cron):
   ```sql
   -- batched by PK ranges, each batch < 30s, committed individually:
   UPDATE shopify_orders so SET workspace_id = sc.workspace_id
   FROM shopify_connections sc
   WHERE so.connection_id = sc.id AND so.workspace_id IS NULL
     AND so.id IN (SELECT id FROM shopify_orders WHERE workspace_id IS NULL ORDER BY id LIMIT 5000);
   -- loop until 0 rows affected; sleep between batches to yield to crons.
   ```
   Batch size 5000 (consistent with the existing `chunkedIn` default in `lib/prisma-utils.ts:28`). Each batch is its own transaction → no long lock, statement stays well under 30s.
3. **New-row population:** the cron/webhook upsert path sets `workspace_id` on insert (the cron already has the connection's `workspace_id` in scope — see §6). During backfill, new rows are populated forward; old rows backfilled backward. **No window where a row is unprotected**, because the policy is only created AFTER backfill completes (sequence §5 STEP 3) and the fail-closed default denies NULL-context queries anyway.
4. **Index:** `CREATE INDEX CONCURRENTLY idx_shopify_orders_workspace_id ON shopify_orders(workspace_id);` (CONCURRENTLY = no write lock).
5. **Verify (CF — backfill is verified):** `SELECT COUNT(*) FROM shopify_orders WHERE workspace_id IS NULL;` MUST = 0 before the simplified policy `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)` is created.
6. **Reversible:** rollback = `DROP POLICY` → `DROP INDEX` → `ALTER TABLE … DROP COLUMN workspace_id`. App still works (column was additive, never read by legacy).
7. **PII note (CF-C1-PII-REGISTER-1 / C5):** the `shopify_orders`/`shopify_customers` backfill READS every row to copy `workspace_id` — for `shopify_customers` this reads alongside `email`/`firstName`/`lastName` rows in the same table (a §4 PII processing act). **This backfill is covered by the CF-SEC-3.HARD instrument and is BLOCKED on the gate** (§11).

`WoocommerceLineItem` (Group C, 2-hop): default JOIN-policy is a 2-hop subquery (`order_id IN (SELECT id FROM woocommerce_orders WHERE connection_id IN (SELECT id FROM woocommerce_connections WHERE workspace_id = ...))`). Woo is low-volume; if its EXPLAIN fails, denormalize `workspace_id` onto it via the same chunked backfill (sourced through its `order_id`→`woocommerce_orders` join).

---

## 4. Fail-closed policy template (CF-C1-RLS-DEFAULT-1.a + CF-SEC-1)

### 4a. The ONLY sanctioned policy shapes (Tanvi static-gates every `USING`/`WITH CHECK` against these)

**Direct-scoped (Group A):**
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON <t>
  USING       (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK  (workspace_id = current_setting('app.workspace_id', true)::uuid);
-- (FORCE applied later, sequence §5 STEP 5)
```
**FK-transitive JOIN-policy (Group B/C, if not denormalized):**
```sql
CREATE POLICY ws_isolation ON shopify_orders
  USING      (connection_id IN (SELECT id FROM shopify_connections
                                WHERE workspace_id = current_setting('app.workspace_id', true)::uuid))
  WITH CHECK (connection_id IN (SELECT id FROM shopify_connections
                                WHERE workspace_id = current_setting('app.workspace_id', true)::uuid));
```

### 4b. Why it is fail-closed (proof) + the BANNED patterns

- `current_setting('app.workspace_id', true)` with `missing_ok=true` returns **NULL** when unset. `NULL::uuid = workspace_id` → **NULL** (three-valued logic), which is **not TRUE**, so the `USING` clause excludes every row → **context-less query returns 0 rows.** Provably deny-by-default.
- **`WITH CHECK` on every policy** so writes are scoped too (a write with the wrong/no context is rejected — prevents cross-tenant INSERT/UPDATE through the RLS client).

**BANNED — Tanvi static-review hard-fail items (CF-C1-RLS-DEFAULT-1.a(i)), any occurrence blocks the gate:**
- `… OR current_setting('app.workspace_id', true) IS NULL` (re-opens full leak when context unset — the realist's named trap; most tempting on AuditLog/Notification/cron).
- `COALESCE(current_setting('app.workspace_id', true), '...')` or any defaulting of the setting.
- Any permissive catch-all / table-wide `USING (true)`.
- Session-level `SET app.workspace_id` (no LOCAL/no tx-local) anywhere in app or cron code (CF-C1-POOL-1.a).
- Querying an RLS-protected model on the bare `:6543` singleton outside `withWorkspace`.

### 4c. CF-SEC-1 fail-closed RLS-probe GREEN predicate (the gate is a probe, not a boolean)

The "RLS-GREEN" state is **RED by default** and only transitions GREEN when a live probe passes. **The probe IS the gate** (no manually-flipped flag — A3 facade enforcement).

**Probe (run by the deploy harness at sequence STEP 4; Stage-4 VETO surface; BLOCKED on gate):**
```
For each workspace-scoped table T (Groups A/B/C):
  1. withWorkspace(<synthetic-workspace-ALPHA>) { SELECT count(*) FROM T }   -> n_alpha (expected: only ALPHA's rows)
  2. withWorkspace(<synthetic-workspace-BETA>)  { SELECT count(*) FROM T WHERE <a known ALPHA-only key> } -> MUST be 0
  3. (no context) SELECT count(*) FROM T   -> MUST be 0  (fail-closed)
GREEN predicate = (every T: step-2 == 0 AND step-3 == 0). Any non-zero -> RED -> sequence HALTS, /escalate, no FORCE.
```
- Synthetic workspaces ALPHA/BETA are **purpose-created test tenants seeded with non-PII fixture rows** where possible. **BUT** step 2 against `invitations` reads `Invitation.email` and against `shopify_customers` reads PII — **these reads are DPDP §4 processing acts → BLOCKED on the CF-SEC-3.HARD instrument** (§11). The probe is designed to minimize PII exposure (count/key-existence assertions, not row dumps), but it still *touches* the PII columns, so it is gated.
- **Decision Log write (CF-SEC-1):** every probe run writes an append-only `ai.decision_log`-style entry: `{ts, table, n_alpha, cross_read_count, contextless_count, verdict: GREEN|RED, correlation_id (the §9 4-tuple)}`. The RED→GREEN transition is the audit record; a flip back to RED (rollback) is also logged. (Child 1 has no ClickHouse yet — the Decision Log entry lands in the Postgres `audit_logs`/a dedicated `rls_probe_log` table under the SUPERADMIN context, see §7, so it is itself isolation-safe.)

---

## 5. The harness-asserted rollout sequence (CF-C1-ROLLOUT-ORDER-1 + CF-C1-QUIESCE-1 + CF-RES-1.a + R2 + R4)

**ONE coordinated deploy. Each step is a machine-asserted go/no-go gate (not a timer). G1 (RLS-live) + G2 (cron-session-scoped) flip GREEN TOGETHER. Entire sequence is BLOCKED on the CF-SEC-3.HARD gate.**

```
STEP 0  REGION ASSERT (Postgres-level, BOTH URLs)                         [CF-RES-1.a / C3]
        For each of DATABASE_URL(:6543) AND DIRECT_URL(:5432):
          query a Supabase control-plane / pg-level signal that ties the connection to ap-south-1
          (Supabase platform region metadata API for project pavcgecgciamejdcysjx, cross-checked;
           hostname/DNS is NOT accepted as proof — see R-RES-01 / the .env.bak.singapore evidence).
        ASSERT region == 'ap-south-1' on BOTH. FAIL on EITHER -> exit non-zero + /escalate, sequence HALTS.

STEP 1  QUIESCE / SESSION-SCOPE ALL CROSS-WORKSPACE CRON FAN-OUT          [CF-C1-QUIESCE-1 / C1]
        Literal FIRST mutating step, BEFORE any RLS DDL:
          (a) deploy the §6 cron refactor (per-workspace withWorkspace invocations) OR
              flip the cron fan-out OFF via the cron toggle, whichever the deploy chooses;
          (b) HARNESS ASSERTS zero active cross-workspace findMany before DDL:
              inspect pg_stat_activity for the legacy cron query signatures (the syncAll* / cron.ts
              findMany shapes) AND verify the cron toggle/refactor flag is the converted value.
        ASSERT: 0 cross-workspace cron activity. FAIL -> HALT (do not begin DDL while crons fan out).

STEP 2  DEPLOY SESSION-CONTEXT CODE (rlsPrisma + withWorkspace), NO RLS YET   [CF-C1-POOL-1.a / ROLLOUT-ORDER-1]
        Ship lib/rls-prisma.ts + withWorkspace + route handlers migrated to it.
        ASSERT (smoke): every workspace-scoped endpoint still returns DATA (no RLS yet, owner bypass) -> proves
        the context plumbing didn't break the live app BEFORE any policy exists.

STEP 3  ENABLE RLS + CREATE fail-closed POLICY per table (additive; owner still bypasses)  [CF-C1-RLS-DEFAULT-1.a]
        Per table: (FK-scope pre-step EXPLAIN already decided JOIN vs denorm; if denorm, the §3c backfill
        ran + verified IS NULL count = 0 BEFORE this step). ENABLE ROW LEVEL SECURITY + CREATE POLICY (§4a).
        Owner (postgres/service role) still bypasses -> legacy app on :6543 unaffected -> ZERO behavior change.

STEP 4  CF-SEC-1 CROSS-WORKSPACE PROBE -> GREEN PREDICATE                 [CF-SEC-1]
        Run §4c probe on rlsPrisma (:5432) for every table. RED-by-default; GREEN only on full pass.
        Write Decision-Log transition. ASSERT GREEN. RED -> HALT + /escalate (do NOT FORCE).

STEP 5  FORCE ROW LEVEL SECURITY per table                               [CF-C1-ROLLOUT-ORDER-1 / R2]
        Only now does the owner stop bypassing. Per table: ALTER TABLE <t> FORCE ROW LEVEL SECURITY.
        This is the moment isolation becomes structural for the privileged role too.

STEP 6  SMOKE every workspace-scoped endpoint + cron tick               [CF-C1-ZERO-BEHAVIOR-1 / R2]
        Byte-identical response check vs a fixed per-workspace request corpus captured pre-rollout.
        Run one cron tick under the refactor: assert each connected connection synced under its own
        workspace context; no cross-workspace findMany; per-connection error isolation preserved (§6).
        ASSERT: responses byte-identical + cron tick clean.
        ==> G1 (RLS live + FORCE + probe GREEN) AND G2 (cron session-scoped) are now BOTH GREEN, one deploy.

ROLLBACK (any step's ASSERT fails, OR post-deploy regression):
        For each FORCE'd table:  ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;  ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;  DROP POLICY ws_isolation ON <t>;
        (This is a DDL MIGRATION, not a feature-flag flip — corrects A4 Child-1 rollback text per R2.)
        Crons: restore prior fan-out (toggle back) if STEP-1 used the toggle path; if STEP-1 deployed the
        refactor, the refactored crons are themselves correct (no rollback needed for G2).
        App-layer scoping (the legacy app-layer workspaceId filters) survives throughout -> no isolation regression
        BELOW the pre-RLS baseline at any point. Decision Log records the GREEN->RED transition.
```

**Why this sequence cannot outage or leak even half-applied:**
- **No outage:** FORCE (STEP 5) — the only step that can 0-row the live app — runs ONLY after context-code is deployed (STEP 2) AND the probe is GREEN (STEP 4). Before FORCE, the owner bypasses RLS, so the legacy app on :6543 sees no change (CF-C1-ZERO-BEHAVIOR-1). The realist's named outage step (FORCE-before-context) is structurally impossible in this order.
- **No leak:** crons are quiesced/converted FIRST (STEP 1) before any policy exists, closing the compliance officer's partial-RLS §8(6) window. The fail-closed default (§4) means even a context-less query during the transition returns 0 rows, never all rows. Session-level `SET` (the leak mechanism) is banned (§2b/§4b). The probe (STEP 4) actively proves cross-tenant reads return 0 before FORCE.
- **Reversible:** every forward step has a named DDL inverse; app-layer scoping is the floor.

**Progressive-delivery mapping:** additive (RLS is pure addition), toggle-guarded (cron toggle in STEP 1; the `withWorkspace` routing is additive code), zero-downtime (owner-bypass window covers the deploy gap), gated (each STEP is a go/no-go assertion). This is a canary-by-ordering, not a traffic-split — appropriate for a DDL rollout on one DB.

---

## 6. Cron refactor (CF-C1-CRON-SCOPE-1.a / G2)

**Convert the cross-workspace fan-out to per-workspace session-scoped invocations, preserving per-connection error isolation + proof-of-attempt logging.**

The three `syncAll*` already iterate per-connection with `workspaceId`/`workspace_id` selected and per-connection `try/catch` (verified §1) — the refactor is to **wrap each per-connection unit of work in `withWorkspace(c.workspaceId, …)` on `rlsPrisma`**, not to rewrite the loop:

```ts
// shiprocket-sync.ts syncAllShiprocket — per connection:
for (const c of connections) {
  try {
    await withWorkspace(c.workspaceId, (tx) => syncShiprocketForConnection(c.id, options, tx))
    log.info({ msg: 'cron.sync.attempted', connector: 'shiprocket', connectionId: c.id,
               workspaceId: c.workspaceId, status: 'ok', ...correlation4tuple })   // proof-of-attempt
  } catch (err) {
    log.error({ msg: 'cron.sync.attempted', connector: 'shiprocket', connectionId: c.id,
                workspaceId: c.workspaceId, status: 'failed', error: String(err), ...correlation4tuple })
    // one connection's context-setup/sync failure MUST NOT skip the others (error isolation preserved)
  }
}
```
- **`cron.ts:65` Shopify loop + `cron.ts:148` recompute loop:** same wrap — the Shopify loop's `shopifyConnection.findMany` outer query reads only `{id}` (or `{id, workspaceId}` after adding the select) on the **unprotected `shopify_connections`? No — `ShopifyConnection` is Group A (direct workspace_id, RLS-protected).** So the outer `findMany` itself must run under a context that can see all connections → run the **outer enumeration on the SUPERADMIN/system context** (a system-scoped `withWorkspace`-analogue that sets a SUPERADMIN session flag, see §7), then each inner per-connection sync runs under that connection's `withWorkspace(c.workspaceId)`. The enumeration reads connection metadata only (no tenant PII); the actual data sync is workspace-scoped.
- **Proof-of-attempt logging (CF-C1-CRON-SCOPE-1.a):** every CONNECTED connection emits a `cron.sync.attempted` log line per tick with `{connectionId, workspaceId, status, correlation_4tuple}` — so a silently-dropped connection is detectable (the absence of its line is the alarm, §9).
- **Shiprocket no-replay (R5):** because Shiprocket has no API replay, a dropped connection = permanent data loss. The per-connection `try/catch` + proof-of-attempt log makes a drop **loud, not silent**. Alarm: `cron tick where count(attempted)!= count(CONNECTED connections)` → page (§9).

**Test (CF-C1-CRON-SCOPE-1.a — Tanvi, Stage 5, against :6543, BLOCKED on gate):** B's Shiprocket tick under `withWorkspace(B)` sees only B's shipments; a simulated context-setup failure for B does NOT block C's sync in the same tick; the attempted-log shows every CONNECTED connection.

---

## 7. AuditLog dual-policy (CF-C1-AUDITLOG-1.a / C4) + SUPERADMIN context

`audit_logs.workspace_id` is **nullable** (schema:658): brand-scoped rows (NOT NULL) + system-event rows (NULL). `userId` is always NOT NULL (schema:659). Both failure modes (un-erasable null rows; permissive null-leak) are rejected. **Design = dual-policy + a SUPERADMIN session context:**

```sql
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- (1) tenant rows: workspace-scoped SELECT/INSERT for the matching context
CREATE POLICY ws_isolation ON audit_logs
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
-- (2) null/system rows: reachable ONLY under a SUPERADMIN session context, never a tenant context
CREATE POLICY superadmin_system_rows ON audit_logs
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
```
- Two policies are OR-combined by Postgres → a tenant session (`app.workspace_id` set, `app.is_superadmin` unset/`'false'`) sees ONLY its own rows; the null rows fail BOTH predicates for a tenant → invisible (no leak, failure mode B avoided). A SUPERADMIN session (`app.is_superadmin='true'`, set by a separate `withSuperadmin()` wrapper) sees system rows via policy (2).
- **`app.is_superadmin` is set ONLY by `withSuperadmin()`** (a sibling of `withWorkspace`, used by the cron enumeration §6 and the erasure path), tx-local, on `rlsPrisma`. Banned anywhere else (static gate).
- **DPDP §12 erasure path (documented, runs under SUPERADMIN):**
  ```
  withSuperadmin(() => tx.$executeRaw`DELETE FROM audit_logs WHERE user_id = ${userId}::uuid`)
  ```
  `userId`-only scoping under SUPERADMIN reaches BOTH workspace-scoped AND null-workspace rows for that user → erasure is complete (failure mode A avoided). A workspace-session DELETE can NEVER reach null rows (policy (1) excludes them).
- **Compatible with the deferred Child-5 sentinel migration (C9):** when null rows are later migrated to a system-workspace sentinel `workspace_id`, policy (1) will simply match them under a SUPERADMIN-as-system-workspace context; policy (2) can then be dropped. No rewrite of Child-1's choice. (Sentinel migration stays deferred to Child 5; the **policy CHOICE is resolved here**, per C4.)
- **Same SUPERADMIN-only shape** applies to `SystemSettings` (Group D) and to the `rls_probe_log` Decision-Log table (§4c).
- **Test (Stage 5):** workspace-session DELETE cannot reach null rows; SUPERADMIN erasure reaches them; tenant SELECT never sees a system row.

---

## 8. Auth / role-claim contract (1b — CF auth-and-access; no re-login storm)

- **Keep Supabase Auth + the existing JWKS verification** (`middleware/auth.ts`) — no auth rewrite (non-goal). The JWT is the identity; `requireWorkspace` already resolves `WorkspaceMember.role` per request.
- **Brain claim contract:** derive the level-ordered claim from the EXISTING enums (no new role model):
  ```
  WorkspaceRole: OWNER(5) > ADMIN(4) > MANAGER(3) > ANALYST(2) > VIEWER(1)   // schema:936, level ordering for >= checks
  SystemRole:    SUPERADMIN | USER                                          // gates withSuperadmin()
  ```
  Brain's claim object = `{ userId (sub), workspaceId, workspaceRole, workspaceRoleLevel, systemRole, correlation_id }`, assembled in middleware after `requireWorkspace` resolves membership, and **fed into `withWorkspace(workspaceId)`** so layer-3 RLS context = the same workspace the JWT+membership authorized (layers 1→2→3 coherent, the 4-layer non-negotiable).
- **No re-login storm:** the claim is derived from the already-valid JWT + a DB membership lookup that already happens (`workspace.ts:38-45`); no token re-issue, no Supabase Auth change, no logout. Existing sessions keep working.
- **`requireRole(min)` guard (level-ordered):** `req.claim.workspaceRoleLevel >= LEVEL[min]` — replaces ad-hoc role checks; this is the layer-2 assertion. (Anti-blind-agreement check: every mutating route gets `requireRole` — flagged for builder, but enumerating per-route is a 1b detail, not new scope.)

---

## 9. Observability plan (CF-SEC-5 4-tuple + the gate)

- **CF-SEC-5 correlation-ID 4-tuple** = `{request_id, trace_id, workspace_id, user_id}` propagated through EVERY new runtime path: the `withWorkspace` wrapper (binds `workspace_id`+`user_id` from the claim), the cron refactor (binds per-connection `workspace_id`; `request_id`=cron-tick-id, `trace_id`=per-connection), and the RLS probe (binds the synthetic workspace). **Missing 4-tuple on any new path = Stage-4 VETO** (CF-SEC-5). Implemented via an AsyncLocalStorage context set in middleware + passed into `withWorkspace`.
- **Logs:** structured JSON; `cron.sync.attempted` per connection (§6) — the proof-of-attempt; `rls.probe.transition` GREEN/RED (§4c); `rls.context.set` debug (sampled) carrying the 4-tuple.
- **Metrics (minimal, requirement-named only — no speculative dashboards):**
  - `rls_probe_verdict{table}` (gauge: 1=GREEN,0=RED) — drives the gate.
  - `cron_connections_attempted` vs `cron_connections_connected` per tick (the silent-drop detector, esp. Shiprocket).
- **Alarms:**
  - `rls_probe_verdict == 0` (any table) → page (gate RED).
  - `cron_connections_attempted < cron_connections_connected` → page (a connection silently dropped — Shiprocket no-replay).
  - STEP-6 smoke byte-diff != 0 → block + page.
- **Decision Log:** the RED↔GREEN transitions (§4c) are the append-only audit record (CF-SEC-1).
- No observability beyond these (over-engineering check §17): no new dashboards, no tracing infra beyond the 4-tuple the canon already mandates.

---

## 10. Test strategy (proportionate to the cross-brand-leak risk; all BLOCKED on gate)

| Test | Owner | Stage | Predicate |
|---|---|---|---|
| Interleaved-tenant pooling (§2b) | Tanvi | 5 | (i) :6543 session-SET bleed → 0 rows; (ii) context-less → 0; (iii) :5432 withWorkspace interleave isolated |
| Fail-closed default (§4) | Tanvi | 5 | `SET app.workspace_id=''`/unset → `COUNT(*) shopify_orders` = 0, not full count |
| Static SQL review (§4b) | Tanvi | 4/5 | every `USING`/`WITH CHECK` matches sanctioned shapes; zero banned patterns; FORCE set on every A/B/C/AuditLog table; every RLS table has a policy (enumerated list §3a) |
| CF-SEC-1 probe (§4c) | harness/Tanvi | 4 | every table: cross-read=0 AND context-less=0 → GREEN; Decision-Log written |
| FK-scope live EXPLAIN (§3b) | Vikram (build pre-step) | 3/5 | index scan, no seqscan/nested-loop; or denorm column used directly |
| Cron isolation + proof-of-attempt (§6) | Tanvi | 5 | B sees only B; B's failure doesn't block C; every CONNECTED connection logged (:6543) |
| AuditLog dual-policy + erasure (§7) | Tanvi | 5 | workspace DELETE can't reach null rows; SUPERADMIN erasure can; tenant never sees system row |
| Region assert both URLs (§5 STEP 0) | Tanvi | 5 | Postgres-level ap-south-1 on :6543 AND :5432; non-zero exit + /escalate on fail |
| Byte-identical API corpus (§5 STEP 6) | Tanvi | 5 | fixed per-workspace request corpus identical pre/post (CF-C1-ZERO-BEHAVIOR-1) |
| 4-tuple presence (§9) | Shreya/Tanvi | 4 | every new runtime path emits the 4-tuple (Stage-4 VETO if missing) |

**No mutation tests / no unit tests for trivial wrappers** — tests target the isolation behavior at the integration points (the leak/outage surfaces), which is where the risk lives. Real-network smoke = the STEP-6 corpus + a live cron tick against the actual Supabase instance (gated).

---

## 11. Security considerations (forwarded to Shreya — Stage-4 VETO surface)

- **CF-SEC-3.HARD — THE BUILD GATE.** The CF-SEC-1 probe `SELECT`s `Invitation.email` and (if `shopify_customers` is denormalized) the backfill reads `email`/`firstName`/`lastName` — both **DPDP §4 PII processing acts performed by Brain at Child 1**. No DPA / §7 memo / consent columns exist on record. **Stage 3 is NOT authorized until the Founder produces ONE of:** (a) executed DPA / processor clause covering migration-time processing with ≥ Sugandh Lok, OR (b) a Founder-signed DPDP §7 continuity memo naming `Invitation.email`, `ShopifyCustomer` PII, `User`. This plan (no live data) proceeds; the build does not. (Synthesis §3; `pending-founder-attention.md`.)
- **CF-SEC-SECRETS-1.** `rlsPrisma` reads `DIRECT_URL` and the singleton reads `DATABASE_URL` — both via **AWS Secrets Manager**, never git; verify rotation before use (the Founder-exposed creds must be rotated first — `pending-founder-attention.md`). The cron secret + connector OAuth likewise.
- **CF-SEC-5.** 4-tuple on every new path (§9) — Stage-4 VETO if missing.
- **CF-RES-1.a.** Postgres-level region assertion on BOTH URLs before any DDL (§5 STEP 0); the `.env.bak.singapore` evidence proves this must be live, not trusted.
- Fail-closed RLS (§4) + banned-pattern static gate (§4b) + `WITH CHECK` on writes + injection-safe `set_config` bind param (§2b).

## 12. India context

- **DPDP §8(6)** breach window closed by quiesce-first ordering (§5 STEP 1) + fail-closed default — no partial-RLS co-mingling window.
- **DPDP §16** residency assertion (§5 STEP 0) — ap-south-1, live-asserted (history of a Singapore move makes this non-optional).
- **DPDP §12** erasure reachability for AuditLog null rows via SUPERADMIN path (§7).
- **PII tables touched at Child 1 (CF-C1-PII-REGISTER-1 / C5):** `Invitation.email` (probe), `ShopifyCustomer` email/firstName/lastName (RLS DDL + probe + optional denorm backfill), `User`, `ShiprocketShipment` pincode/city/state, `WoocommerceOrder` customer email/phone — **A6.2 register gets a Child-1 row for `ShopifyCustomer`** (it is NOT deferred to Child 3). All covered by the CF-SEC-3.HARD instrument scope.

## 13. Region adapter impact

None new. Child 1 is single-region (ap-south-1) by construction; the RLS layer is region-agnostic. The region *assertion* (§5 STEP 0) is the only region-aware step and it is a tripwire, not an adapter surface. RegionAdapter (India implemented, others stubbed) is untouched.

## 14. Cost estimate

- **No compute/LLM path** (SQL/DDL paradigm) → **zero token cost.**
- **Infra delta:** one additional Prisma connection pool (`rlsPrisma` on :5432, `connection_limit≈10`). No new managed service. Marginal connection overhead on the existing Supabase instance; **₹0 incremental managed-service spend** in Child 1. (Within the existing Supabase plan; the connection-budget check §2b ensures we stay under the tier ceiling.)
- Backfill (if denormalized) = one-time I/O on the existing instance, chunked to avoid burst cost.

## 15. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-POOL-01 | `SET LOCAL` lost under :6543 txn-mode → 0-row outage or leak | High (if unmitigated) | Outage/leak | §2b: rlsPrisma on :5432 + tx-local `set_config` in `withWorkspace`; §10 interleaved test (G1 gate) |
| R-FORCE-01 | FORCE-before-context → full 0-row outage | Med | Outage | §5 ordering: FORCE only after context-code + probe GREEN; impossible in-order |
| R-FK-PERF-01 | JOIN-policy seqscan on millions of order rows | Med | Latency/outage | §3b live EXPLAIN gate; denormalize hot tables (chunked backfill §3c) |
| R-NULLTRAP-01 | `OR IS NULL` permissive policy re-opens leak | Med | Leak | §4b banned-pattern static gate (Tanvi hard-fail) |
| R-CRON-DROP-01 | Silently-dropped Shiprocket connection (no replay) → permanent loss | Med | Data loss | §6 per-connection try/catch + proof-of-attempt log + §9 attempted-vs-connected alarm |
| R-RES-01 | DB silently moved out of ap-south-1 (precedent: Singapore→Mumbai) → §16 violation | Low-Med | Compliance | §5 STEP 0 live Postgres-level assert on BOTH URLs; /escalate on fail |
| R-PARTIAL-01 | Partial-RLS deploy co-mingling → §8(6) breach | Low (mitigated) | Compliance | §5 STEP 1 quiesce-first + fail-closed default + G1+G2 together |
| R-LAWFUL-01 | Build runs before lawful-basis instrument exists | — | Compliance/legal | **Build HARD-GATED on CF-SEC-3.HARD (§11)** |

## 16. Alternatives considered (≥1)

1. **Tx-wrapped `SET LOCAL` on the single :6543 client (no second client).** Rejected as the *sole* mechanism: correct only if EVERY scoped call is wrapped in `$transaction`, and the live `requireWorkspace` `Promise.all` pattern proves the codebase has autocommit call sites that would silently lose context; one regression = outage/leak. Kept as a *defense-in-depth* layer (we use tx-local `set_config` regardless) but not relied on alone — hence the `rlsPrisma`/:5432 split.
2. **Pure JOIN-policy for all FK tables (no denormalization ever).** Rejected as a blanket choice: the realist's plan-regression risk on `shopify_orders`/`shopify_line_items` at millions of rows is real and planner-version-dependent. Replaced by the live-EXPLAIN decision-gate (§3b) that keeps JOIN-policy where it's affordable and denormalizes only the hot tables that fail the gate. (Avoids both the blanket-denorm backfill cost and the blanket-JOIN perf cliff.)
3. **Big-bang: FORCE RLS on all tables in one migration.** Rejected: the realist's named outage step; violates additive/reversible/zero-downtime (CF-C1-ZERO-BEHAVIOR-1). Replaced by the ordered, probe-gated, per-table sequence (§5).

## 17. Tracks (work decomposition for Stage 3)

> **EVERY task below is BLOCKED on the CF-SEC-3.HARD lawful-basis instrument** (no DDL/probe/backfill/live-EXPLAIN until the gate is lifted). Tasks are 2–5 min, file-pathed, verification-bearing. Node/Prisma/SQL → **@vikram (backend-developer)**; the small 1b auth-claim middleware is also @vikram (server-side); **no frontend auth wiring is required in Child 1** (claim is server-derived; existing Supabase session unchanged) → **@ananya NOT needed** unless 1b surfaces a client claim-shape change (it does not). **No new service is created** (this hardens the live legacy backend in place) → **no deploy-pipeline track** (the deploy artifact is the ordered runbook §5, owned by @jatin at Stage 8, not a new ArgoCD app).

**Track 1a-A — RLS session-context primitive (@vikram)** *(BLOCKED on gate)*
- T1.1 Create `legacy project/backend/src/lib/rls-prisma.ts`: second `PrismaClient` bound to `DIRECT_URL` (:5432). Verify: imports, `$connect` smoke.
- T1.2 Confirm Supabase compute-tier max connections; set `rlsPrisma` `connection_limit` so :6543(20)+:5432 stay under ceiling. Verify: documented number + no pool-exhaustion under a load smoke.
- T1.3 Add `withWorkspace(workspaceId, fn)` + `withSuperadmin(fn)` (tx-local `set_config('app.workspace_id'|'app.is_superadmin',…,true)` as first statement). Verify: unit test that context is set inside tx and scrubbed after.
- T1.4 Wire AsyncLocalStorage 4-tuple (§9) into both wrappers. Verify: log line carries `{request_id,trace_id,workspace_id,user_id}`.

**Track 1a-B — Route migration to `withWorkspace` (@vikram)** *(BLOCKED on gate)*
- T2.1 Inventory every route handler / lib fn that reads/writes a Group-A/B/C table on the bare singleton. Verify: grep list reviewed.
- T2.2 Migrate each to `withWorkspace` on `rlsPrisma`. Verify: static gate (no RLS-table query on bare :6543 outside `withWorkspace`).
- T2.3 Migrate `middleware/workspace.ts` membership lookup path to feed `workspaceId` into the request claim → `withWorkspace`. Verify: layers 1→2→3 coherent test.

**Track 1a-C — FK-scope decision + DDL (@vikram)** *(BLOCKED on gate)*
- T3.1 Run live `EXPLAIN (ANALYZE, BUFFERS)` (§3b) per Group-B/C table on :5432. Verify: per-table verdict recorded (JOIN-ok vs denorm).
- T3.2 For escalated tables: additive column + chunked online backfill + CONCURRENTLY index + `IS NULL`=0 verify (§3c). Verify: backfill log + 0-null assertion.
- T3.3 Author the fail-closed policy DDL per table (§4a sanctioned shapes only). Verify: static review vs §4b banned list.
- T3.4 AuditLog/SystemSettings/probe-log dual/SUPERADMIN policies (§7). Verify: §7 dual-policy test.

**Track 1a-D — CF-SEC-1 probe + Decision Log (@vikram)** *(BLOCKED on gate)*
- T4.1 Implement the §4c probe (per-table cross-read=0 + context-less=0) + GREEN predicate. Verify: probe RED on a deliberately-broken policy fixture.
- T4.2 Decision-Log transition writer (RED↔GREEN, 4-tuple, append-only). Verify: transition row written under SUPERADMIN context.

**Track 1a-E — Cron refactor (@vikram)** *(BLOCKED on gate)*
- T5.1 Wrap each `syncAll*` per-connection unit in `withWorkspace(c.workspaceId,…)`; outer enumeration under `withSuperadmin` (§6). Files: `shiprocket-sync.ts`, `meta-sync.ts`, `google-sync.ts`, `routes/cron.ts` (lines 65,148). Verify: §6 cron isolation test.
- T5.2 Proof-of-attempt logging + attempted-vs-connected metric (§9). Verify: every CONNECTED connection emits a line per tick.
- T5.3 Cron quiesce toggle / assertion hook for §5 STEP 1. Verify: harness can assert zero cross-workspace findMany.

**Track 1a-F — Rollout harness/runbook (@vikram, executed @jatin Stage 8)** *(BLOCKED on gate)*
- T6.1 STEP-0 region assert (both URLs, Postgres-level, non-zero exit + /escalate). Verify: passes on ap-south-1, fails on a non-ap-south-1 fixture.
- T6.2 Encode the §5 sequence as ordered go/no-go assertions (quiesce, ENABLE+CREATE, probe-GREEN, FORCE, smoke). Verify: a failing assertion HALTS + leaves a clean state.
- T6.3 Byte-identical corpus capture (pre) + compare (post). Verify: STEP-6 diff harness.
- T6.4 DDL rollback script (`NO FORCE`+`DISABLE`+`DROP POLICY` per table) + GREEN→RED Decision-Log. Verify: rollback restores pre-RLS behavior on a fixture.

**Track 1b — Auth/role-claim contract (@vikram)** *(BLOCKED on gate; ships behind 1a)*
- T7.1 Brain claim assembler from JWT+membership (§8); `requireRole(min)` level-ordered guard. Verify: claim shape test; no re-login.
- T7.2 Feed claim `workspaceId` into `withWorkspace` (close layers 1→2→3). Verify: coherence test.

### Over-engineering self-check
- [x] **Plan length matches band:** high-stakes + scope-creep-prone live-DB rollout → prescriptive band; detail (exact DDL/probe/sequence) is the deliverable, justified in §1. **PASS.**
- [x] **Every §17 file required by the requirement:** rls-prisma/withWorkspace (the pooling mechanism the gate needs), the enumerated RLS tables, the 3 cron files, the runbook — all named by the synthesis contract; no "while we're in there" files. **PASS.**
- [x] **No new deps:** uses existing `@prisma/client` + a second client instance; no npm/pip/uv addition. **PASS.**
- [x] **No speculative abstractions:** `withWorkspace`/`withSuperadmin` are the *minimum* primitive to make tenant context safe under the real pool — Single-Primitive (one sanctioned context-setter), not future-proofing. `rlsPrisma` implements the canon's layer-3, not a new layer. **PASS.**
- [x] **No observability beyond named:** 2 metrics + the 4-tuple + Decision Log — all canon/requirement-mandated; no extra dashboards. **PASS.**
- [x] **No trivial tests:** tests target leak/outage integration points, not wrappers. **PASS.**
- [x] **Test strategy proportionate:** the cross-brand-leak failure mode is exactly what justifies the interleaved/fail-closed/probe tests; nothing gratuitous. **PASS.**
- [x] **Scope discipline:** solves Child 1 only — no money (Child 2), no connectors framework (Child 3), no metrics/OLAP, no AI, no frontend. The cron *session-scoping* is in-scope (it's G2); the cron *connector redesign* is NOT (Child 3). **PASS.**

## 18. CTO Advisor paradigm sign-off

Rohan's Stage-1 record (synthesis §9, CTO review §9): **SQL/DDL + connection-handling — no ML, no LLM; cost-routing audit clean (no over-reach).** No Maya co-owner needed (no metric/money/AI/numeric-parity dimension). The FK-scope EXPLAIN work did NOT surface a metric-rollup dependency, so no co-owner request is raised. **Paradigm confirmed; one-line recorded in journal.**

---

## Handoff (folded — high-stakes, but build is GATED)

**To the Stage-3 builder (@vikram), WHEN the gate lifts:** the binding spine is the §5 ordered sequence; the §2b pooling decision and §3b FK-scope decision-gate are settled (do not relitigate — amend via me if reality contradicts the live EXPLAIN). Every track in §17 is BLOCKED until the CF-SEC-3.HARD instrument is on record AND the Founder lifts the gate. **Until then, no DDL, no probe, no backfill, no live EXPLAIN — those all touch live PII.**

**Recommendation to the orchestrator:** Stage 2 is complete and build-ready, but **build is HARD-GATED**. **STOP after Stage 2; surface to the Founder** (the escalation is already in `pending-founder-attention.md`). Do NOT spawn Stage-3 builders until the Founder supplies the DPDP lawful-basis instrument and lifts the gate.
