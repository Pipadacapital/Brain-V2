# Security Review — feat-store-order-fact-layer (Stage 4, Shreya)

| Field | Value |
|-------|-------|
| **req_id** | `feat-store-order-fact-layer` |
| **Stage** | 4 (security / compliance VETO) |
| **Reviewer** | Shreya (security-reviewer) |
| **Verdict** | **PASS** — 0 CRITICAL, 0 HIGH |

## 4-layer multi-tenancy isolation (the P0 surface)

| Layer | Finding |
|---|---|
| **Read entry-point** | The store use-case reads ONLY through `query_gateway.query_metrics(workspace_id, ...)` — grep confirms NO `prisma`, NO `client.query`, NO `SELECT *`, NO `findMany`, NO raw SQL in `application/store/`. workspace_id is the first positional, non-optional param; falsy = `UnscopedQueryError` (fail-closed). The slice inherits Child-4's persona-tested `CF-C4-QUERY-SCOPE-ISOLATION-1`. |
| **Use-case re-assert** | `StoreSummaryQuery.execute` re-asserts falsy-workspace fail-closed before any read (defense in depth). |
| **BFF procedure** | `store.summary` + `store.revenueLadder` are `workspaceProc` (workspaceMiddleware asserts `ctx.workspaceId === claim.workspaceId`) + `requireRole('ANALYST')`. They pass `ctx.workspaceId` (JWT-derived) to the data plane — NEVER a client-supplied value. |
| **Data plane** | `getStoreSummary` on StubDataPlane fails closed on an unauthorized workspace_id (mirrors `UnscopedQueryError`). |

**Test evidence:** `test_store_summary_query.py::TestTenancyFailClosed` — empty/whitespace workspace
raises; cross-workspace query (ws_A + ws_B both seeded, query as ws_A) returns ZERO ws_B contribution;
context-less unknown ws returns an all-zero ladder (not another tenant's data).
`router.store.test.ts` — cross-workspace request rejected; VIEWER rejected (ANALYST required).

## PII (DPDP)

- The store fact layer is **revenue aggregates only** — gross/net/tax/realized/order_count. Grep
  confirms NO email/phone/customer_name/address/pincode fields in any store path (router, data plane,
  use-case, frontend). No PII enters client logs; only `request_id` is surfaced on error (CF-SEC-5,
  CF-C6-PII-CLIENT-1).
- Decision Log: N/A — read-only analytics, no recommendation/action this slice. Correct.

## India compliance (GST 2.0 + residency)

- **GST per-SKU, never blended** (the headline compliance constraint): `india_gst.total_tax_mu_per_sku`
  SUMs `gst_line_tax_mu` per line at its OWN SKU slab. A dedicated test
  (`test_blended_rate_cannot_reproduce_per_sku`) PROVES no single blended slab reproduces the per-SKU
  total on a mixed basket. Invalid slab fails closed (never silent 0% — would understate tax). GST 2.0
  slabs `{0, 5, 18, 40}` correct (12% GST-1.0 slab correctly rejected).
- The legacy day-level blended `taxes` aggregate is NOT silently matched — `total_tax_mu` carries its
  existing DDR row (`child-3-shopify-connector` dependency) and the per-SKU formula is the canonical
  Brain def.
- **Residency:** ap-south-1 carried (CF-C4-RESIDENCY-1 startup assertion unchanged; analytics-service
  refuses to start out-of-region). No out-of-region read added.

## Money integrity

- BIGINT minor units end-to-end: registry defs `_mu` bigint (TS) / int (Py); proto-types `_mu` bigint;
  superjson carries bigint on the wire; `formatMoney` is the ONLY display conversion. Zero float in the
  GST formula (`// 10_000` integer FLOOR) or the use-case (integer SUM). FX poison absent (no
  EXCHANGE_RATES, no static-rate float in the slice).

## Paradigm / supply chain

- `@paradigm: sql` on all new files; zero LLM/ML import (grep clean); zero new dependency; zero new
  runtime. The slice DEFENDS the %-of-GMV cost model (no inference path added).

## Findings

- **0 CRITICAL, 0 HIGH.**
- **L1 (LOW, non-blocking):** the reversal facts (cancelled/RTO/refunded) feeding `realized_revenue_mu`
  are an explicit use-case input seeded in Phase-0; the live per-reversal connector facts arrive at the
  held Child-3 cutover. Tracked as the same held-cutover dependency as `total_tax_mu` per-SKU data —
  not a security gap (the mechanism is proven; the live wire is held). No action this slice.

**VETO not exercised. PASS.**
