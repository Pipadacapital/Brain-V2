# req-keyset-pagination-admin-tables

**Opened:** 2026-06-01 · **Owner:** TBD (Vikram, backend) · **Gate:** before Scale-tier onboarding
**Origin:** conformance C10 disposition (Rohan, signed on Founder's behalf) — see
`docs/architecture-conformance-audit-2026-06-01.md` and `tests/conformance/`.

## Why

The Brain canon bans `OFFSET` pagination in prod read paths: `OFFSET 5_000_000`
makes Postgres scan and discard 5M rows (an O(n) deep-page cliff that gets worse
with GMV/table growth). The C10 conformance check caught four admin browse-table
queries still using `LIMIT … OFFSET` for page-number UIs:

| File | Query | Table |
|------|-------|-------|
| `apps/core-service/.../store-browser/store-browser-use-cases.ts` | `listOrders` | `connector_order_facts` |
| `apps/core-service/.../store-browser/store-browser-use-cases.ts` | products list | `connector_product_facts` |
| `apps/core-service/.../store-browser/store-browser-use-cases.ts` | customers list | `customer_pii` |
| `apps/core-service/.../product-cogs/product-cogs-use-cases.ts` | `listProductsForCogs` | `connector_product_facts` |

## Interim state (already shipped — the C10 disposition)

The unbounded cliff is **removed today**: `apps/core-service/src/application/shared/`
`pagination.ts` exports `MAX_OFFSET = 10_000` + `boundedOffset(page, pageSize)`.
Each of the four queries refuses any page whose offset would exceed `MAX_OFFSET`
and returns an empty `capped: true` ("refine your filters") result instead of
running a deep-OFFSET scan. So Postgres never sees an offset > 10,000. These two
files are a **time-boxed allowlist** in the C10 conformance check (still
non-vacuous: OFFSET anywhere else fails the gate).

## Scope of this req (the real fix)

Decide and implement the durable pagination model for these admin tables:

1. **Option A — keyset/seek pagination.** Replace `OFFSET` with a `WHERE (sort_key)
   > :cursor ORDER BY sort_key LIMIT n` cursor. Pro: O(1) deep pages, matches the
   canon + the tRPC cursor contract used elsewhere. Con: loses arbitrary
   "jump to page N" (cursor is next/prev, not random-access).
2. **Option B — keep page-numbers, keep the bounded cap permanently.** Accept the
   `MAX_OFFSET` ceiling as the product behavior for these admin tables (filtering,
   not deep paging, reaches old rows). Pro: zero UI change. Con: a permanent
   canon exception (needs explicit sign-off to stop being "time-boxed").

Recommendation: Option A for orders/customers (large, growth tables); Option B may
be acceptable for the COGS editor (bounded SKU count). Architect to rule per-table.

## Definition of done

- Each of the four queries either uses keyset pagination or a sign-off-ratified
  bounded cap.
- The `_ALLOWLIST` entries for these two files are **removed** from
  `tests/conformance/check_pagination.py` + `conformance.yaml`, and C10 stays GREEN
  enforcing clean (no allowlist).
- tRPC contract + web tables updated for whichever model is chosen; tests cover
  deep-page behavior (positive + the "refine filters" / cursor-exhausted path).
