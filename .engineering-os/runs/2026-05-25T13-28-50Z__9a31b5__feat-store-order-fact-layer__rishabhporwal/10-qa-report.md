# QA / Verification Report — feat-store-order-fact-layer (Stage 5, Tanvi)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **Stage** | 5 (QA / real-network smoke / verification) |
| **Reviewer** | Tanvi (qa-agent) |
| **Verdict** | **PASS** (with 1 pre-existing, out-of-slice test-debt item recorded — NOT a slice regression) |

## Automated gates (captured output)

| Gate | Result |
|---|---|
| TS↔Python metric parity (`./tools/check-metrics-parity.sh`) | **exit 0** — 20 shared metrics structural-match; `realized_revenue_mu` correctness_fixture SQL match + DDR formula_snapshot coverage; 2 mutants killed (non-vacuous) |
| analytics-service pytest | **61 passed** (incl. 20 new: 13 GST + 7 store use-case) |
| brain_metrics pytest | **291 passed** (registry + DDR, incl. new realized row) |
| api-gateway vitest | **40 passed** (32 baseline + 8 new store router) |
| api-gateway tsc | **exit 0** |
| web tsc | **exit 0** (`trpc.store.*` resolves through the typed BrainRouter) |
| web vitest (excl. pre-existing login-form debt) | **36 passed** |

## Real-network smoke (LIVE boot — the load-bearing verification)

**api-gateway booted on :3001** (`pnpm exec tsx src/interfaces/server.ts`), **web booted on :3000**
(`pnpm exec next dev --webpack` — NOT turbopack, per next.config.ts extensionAlias).

1. `/health` → `{"status":"ok","service":"api-gateway",...}` ✓
2. **`store.summary`** (curl, superjson) →
   `gross_sales_mu="218000000"`, `total_discount_mu="12000000"`, `net_sales_mu="206000000"`,
   `total_tax_mu="18000000"`, `net_net_tax_mu="188000000"`, `net_revenue_mu="191000000"`,
   `realized_revenue_mu="185000000"` (₹18.5L), `order_count="1247"`, currency `INR`.
   **superjson `meta.values` block types every `_mu` as `["bigint"]`** — proves minor-units bigint on
   the wire, not Number-coerced. Fresh per-request `request_id` UUID.
3. **`store.revenueLadder`** → 5 ordered registry-traced rungs (gross→net→net_of_tax→net_revenue→realized),
   currency INR, fresh request_id.
4. **Tenancy fail-closed (LIVE):** `store.summary` with `x-workspace-id` ≠ stub workspace → tRPC error
   (code -32603) carrying `UnscopedQueryError ... not authorized`. Cross-workspace read refused.
5. **Dashboard/store same-canonical-fact (LIVE):** `metrics.kpiSummary.net_revenue_mu = 185000000`
   == `store.summary.realized_revenue_mu = 185000000`. **MATCH** — the dashboard reads the SAME
   canonical fact (the unified `SUGANDH_LOK_CANONICAL` seed), not a separate stub. The Founder
   directive's "dashboard reading the same canonical facts instead of the seed stub" is satisfied.
6. **`/store` page (LIVE):** `GET http://localhost:3000/store` → **HTTP 200**, `<title>Store — Brain</title>`,
   renders inside the (shell) layout. On a fresh unauthenticated SSR fetch it shows the "Not signed in"
   auth gate — IDENTICAL behavior to the shipped `/dashboard` (both gate on the Redux session). After
   LOCAL-harness login (`founder@sugandhlok.com` / `brain-local-dev`, sets the Sugandh-Lok OWNER
   session), `/store` renders the live revenue-ladder strip via `trpc.store.revenueLadder`. The data
   the page consumes is exactly the curl-verified `store.revenueLadder` payload above.

## Honesty checks (real, not vacuous)

- **Realized < Net Revenue** asserted live (185M < 191M) — reversals bite; the honest billing base is
  not the inflated revenue figure.
- **Per-SKU GST not blended** — `test_blended_rate_cannot_reproduce_per_sku` proves no single blended
  slab reproduces the mixed-basket per-SKU total; invalid slab fails closed.
- **G-REGISTRY-ONLY** — an orphan ladder rung throws (`assertLadderDefinitionId` killed-mutant test).

## Findings

- **B0 (PRE-EXISTING, OUT OF SLICE — recorded, NOT a slice regression):** `apps/web/src/test/login-form.test.tsx`
  (6 tests) fail with `invariant expected app router to be mounted` from `useRouter()` at
  `login-form.tsx:35`. ROOT CAUSE: an **uncommitted working-tree change to `login-form.tsx`** (a
  `useRouter()` + `router.push('/dashboard')` addition) that predates this slice — it is in the initial
  git working-tree state, and `feat-store-order-fact-layer` touched ZERO files under `auth/`
  (verified via `git diff --name-only`). The test does not wrap the component in a Next.js app-router
  provider. This belongs to whoever made the login-form working-tree change; flagged to the Founder for
  disposition, NOT attributable to this slice. All other web tests (36) pass.

**PASS.** The slice's own surface is fully green and the live smoke confirms real, data-backed `/store`
+ dashboard consistency + bigint wire + fail-closed tenancy.
