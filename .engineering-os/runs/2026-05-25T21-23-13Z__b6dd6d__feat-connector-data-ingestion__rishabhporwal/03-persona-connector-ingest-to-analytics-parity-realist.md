# Persona stress-test — connector-ingest-to-analytics-parity-realist (:sonnet)

**Stance:** I assume the slice will pass its own raw-row tests and STILL render wrong/leaky/double-counted
numbers on the dashboard. I attack the seam between ingested raw data and the analytics read. Each concern
is a way the slice ships green but lies to the operator.

## P-001 (HIGH) — "reads real data" is meaningless if the read path is still the seed
The analytics are served by `StubDataPlane`, hardcoded to ONE workspace reading `SUGANDH_LOK_CANONICAL`.
If slice E writes facts to Postgres but the gateway still calls the seed builders, the page shows the seed
forever and the demo "works" while ingesting nothing. **Acceptance:** for a *connected+synced* non-Sugandh
workspace, `store.summary`/`pnl`/`marketing.efficiency` must return numbers DERIVED from the synced facts,
provably different from the Sugandh seed. A test must sync a fixture order of a KNOWN amount and assert the
analytics return THAT amount, not ₹18.5L. Sugandh-Lok must still return its seed (regression guard).

## P-002 (HIGH) — re-sync double-counts at the AGGREGATE layer even when raw rows dedupe
`ingest_batch` dedupes raw rows by `(workspace_id, vendor_event_id)` — good. But the analytics aggregate
(SUM of order revenue, SUM of ad spend). If the ACL→fact write is NOT also keyed on the same idempotency
anchor (e.g. it INSERTs a fact row per sync run instead of UPSERTing per order), the SUM doubles on the
2nd sync even though raw rows didn't. **Acceptance:** sync the SAME fixture batch twice; the analytics
revenue/spend/CM2 numbers are BYTE-IDENTICAL after run 2 (not 2×). Prove it at the tRPC layer, not just
the raw table.

## P-003 (HIGH) — cross-tenant leak once ≥2 workspaces have synced facts
Today only Sugandh has data, so a tenant bug is invisible. Slice E creates the first situation where two
workspaces (Sugandh seed + a real connected one) BOTH have analytics data. If the fact read isn't RLS-
scoped (or the DataPlane dispatch keys on the wrong id), workspace B sees A's revenue. **Acceptance:**
two synced workspaces; A's `store.summary` returns ONLY A's facts; a context-less / cross-workspace read
of the fact table returns 0 rows at the DB (FORCE RLS), and the tRPC throws UnscopedQueryError for a
foreign workspace_id. Slice-D's connector tables are already FORCE-RLS; the NEW fact tables must be too.

## P-004 (MED) — money/GST correctness lost in the ACL
Shopify GraphQL gives `totalPriceSet.shopMoney.amount` as a decimal STRING ("4999.00"). If the ACL does
`Number(x) * 100` you get float drift (4999.00*100 = 499899.99…). And if the revenue ladder is fed an
order TOTAL instead of per-line-item with `sku`, the per-SKU GST extraction (0/5/18/40) can't run → tax
is wrong → net revenue is wrong → CM2 is wrong. **Acceptance:** ACL converts decimal-string → minor units
WITHOUT float (parse rupees+paise as integers, or a Decimal lib, or string-split on '.'); line-items
carry `sku` so the India adapter's per-SKU extraction runs; a fixture with two SKUs at different GST slabs
produces the correct blended net-of-tax. NO `parseFloat(x)*100`.

## P-005 (MED) — the live fetch can't be tested without a real token → it gets faked or skipped
The Founder has NO account tokens (only app creds). If the live API call is hardcoded into the sync use-
case, it can't be exercised in CI and the "verification" becomes a no-op. **Acceptance:** the provider
fetch is behind an INJECTABLE seam (same pattern slice-D used for `ProviderHttp` token-exchange). Tests
inject a fixture that returns the real GraphQL/insights JSON shape (taken from legacy); the live path
passes real fetch. The fixture shapes MUST match legacy (`ORDERS_QUERY` edges/node, Meta
`campaign_id/impressions/clicks/spend/date_start`, Google GAQL `segments.date/metrics.cost_micros`). The
sync use-case must be provably exercised end-to-end (fixture token → fetch seam → ACL → fact → analytics).

## P-006 (MED) — "Sync now" leaks the token or runs for a workspace that didn't connect
The sync reads the custody token to call the provider. If an error path logs the provider response (which
can echo the token on a 401) or if "Sync now" can be invoked for a vendor the workspace never connected
(no custody row), it either leaks a secret or crashes. **Acceptance:** sync for a NOT_CONNECTED vendor
returns a clean "not connected" error (no crash, no token read); every error message is generic (no
provider body, no token substring); a grep gate over slice-E files finds NO token field in any
`console.*`/return/throw; "Sync now" requires MANAGER role (config change, mirrors slice-D initiate).

## P-007 (LOW) — sync status race / honest empty-state regression
While a sync runs, status should read `syncing`; after, `last_sync_at` set + `syncPending=false`. If the
status flips to "synced" but the facts didn't land (partial failure), the page shows "synced" with seed/
empty numbers — dishonest. **Acceptance:** `last_sync_at` advances ONLY inside the same transaction that
commits the facts (slice-D `last_sync_error` set on failure, last_sync_at unchanged); a connected vendor
with a failed sync shows the error, not a fake "synced". The slice-D `syncPending` honest-state must not
regress for connected-but-never-synced.

## Verdict
**6 concerns surfaced (≥1 required) — NOT a "looks good" persona.** The dominant risk is the
ingest→ACL→fact→analytics seam (P-001/P-002/P-003/P-004): the slice can pass raw-row tests and still show
the seed, double-count, leak across tenants, or get the money/GST wrong. All six must be acceptance-tested
at the **analytics tRPC layer**, not just the raw table.
