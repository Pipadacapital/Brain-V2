# Persona Review: metric-parity-olap-correctness-realist

**run_id:** `2026-05-24T22-25-29Z__0e76f7__feat-metric-engine-olap-split__rishabhporwal`
**req_id:** `feat-metric-engine-olap-split` (Child 4)
**Persona:** `metric-parity-olap-correctness-realist`
**Depth tag:** `:sonnet`
**Reviewer timestamp:** 2026-05-25T04:10:00Z
**Reviewer mandate:** Prove the exact-integer-equality shadow-compare can be FALSE-GREEN. Surface every mechanism by which CI passes while production is wrong.

---

## Persona framing

I am the engineer who has shipped a parity harness before, watched it go GREEN in CI, and then stood in a production incident call at 2am trying to explain to a founder why CM2 on the dashboard is wrong by ~3,000 paise per day. My job is to find the one mechanism this team will not naturally think about until it fires. I read the committed code, not the prose. I trust nothing that is "documented" unless it is also structurally enforced.

I read, in full: `packages/lib-metrics/src/ratio.ts`, `src/convert.ts`, `src/parity-runner.ts`; `pylibs/brain_metrics/brain_metrics/ratio.py`, `parity/taxonomy.py`, `parity/harness.py`; `tools/check-metrics-parity.sh`; the binding architecture M-A1-1 rollup mapping, M-A5-Q1 ratio rule, and the shadow_workspace_daily_metrics DDL sketch (06-architecture-plan.md lines 761–848). I looked up ClickHouse's documented `/` operator type semantics (source: ClickHouse Arithmetic Functions docs).

---

## Concern 1 — CRITICAL: ClickHouse `/` on Int64 operands silently returns Float64, breaking the zero-tolerance ratio rule before any comparison runs

**Severity:** CRITICAL

**The mechanism:**

The architecture (M-A1-1, lines 246, 259–265) specifies every ratio MV column as the result of an expression written with the `/` division operator, e.g.:

```sql
-- From M-A1-1 architecture verbatim:
aov_mu         = net_sales_mu / orders_count
acos_bp        = total_ad_spend_mu * 10000 / net_sales_mu
blended_roas_x100 = net_sales_mu * 100 / total_ad_spend_mu
conversion_rate_bp = orders_count * 10000 / sessions
rto_rate_bp    = rto_orders * 10000 / total_shipments
prepaid_rate_bp = prepaid_orders_count * 10000 / orders_count
```

ClickHouse's `/` operator on integer operands does **not** perform integer division. Per the ClickHouse Arithmetic Functions documentation: "The divide operator calculates the quotient of the numbers. The result type is always a floating-point type." Concretely, `Int64 / Int64` in ClickHouse produces `Float64`, not `Int64`. This is unlike Postgres (which truncates toward zero and returns the same integer type) and unlike Python (`//` is FLOOR) or BigInt division in TypeScript.

The consequence is multi-layered:

1. `total_ad_spend_mu * 10000 / net_sales_mu` in a ClickHouse MV body produces a `Float64` column — not an `INT32` scaled integer. If the MV DDL declares the column as `Nullable(Int32)`, ClickHouse silently coerces `Float64` → `Int32` using its own rounding convention (round-half-away-from-zero, NOT FLOOR). For values with a fractional part of exactly 0.5, this is a different result than `FLOOR`.

2. The parity harness's shadow-compare rule (M-A5-Q1) specifies `ROUND_HALF_EVEN(legacy_decimal * 100) == brain_scaled_bp`. The legacy value is e.g. `rto_percent Decimal(5,2): 23.33` → `ROUND_HALF_EVEN(2333.0) = 2333`. The Brain ClickHouse value is `rto_orders * 10000 / total_shipments` → `Float64(2333.333...)` → coerced to `Int32` by ClickHouse as `2333`. For this common case they match, so CI is GREEN.

3. But on a workspace-day where `rto_orders=7, total_shipments=20`: exact = 3500 bp. ClickHouse `/` gives `Float64(3500.0)`, coerces to `Int32(3500)`. Harness check: `ROUND_HALF_EVEN(35.00 * 100) = 3500`. GREEN. Still no divergence visible. The false-GREEN is structural.

4. On a workspace-day where `rto_orders=3, total_shipments=8`: exact = `FLOOR(30000/8)` = `FLOOR(3750.0)` = 3750. But ClickHouse `/` gives `Float64(3750.0)` coerced to `Int32(3750)`. Still GREEN. The danger is on pathological inputs: e.g. `rto_orders=1, total_shipments=3` → `FLOOR(10000/3)` = `FLOOR(3333.33...)` = 3333, but ClickHouse `/` gives `Float64(3333.33...)` coerced by ClickHouse's `Int32` cast as 3333 (truncate toward zero for positive = same as floor). Still GREEN. The FLOOR and truncate-toward-zero are equivalent for positive integers — so all the test fixtures (positive counts) are GREEN, even though the types are wrong.

5. **The production-fire scenario:** a workspace with `total_ad_spend_mu=0` (no ads day). `acos_bp = total_ad_spend_mu * 10000 / net_sales_mu = 0`. Both ClickHouse and harness give 0 — GREEN. But `blended_roas_x100 = net_sales_mu * 100 / total_ad_spend_mu` — ClickHouse `/` on integer-zero denominator returns `inf` (Float64 infinity), which coerces to the ClickHouse `Int32` NULL or to a platform-specific sentinel. The null-guard documented in M-A1-1 (`aov_mu` has a "guard for orders_count=0" note) is mentioned only for `aov_mu`, not for the display-only ratio metrics. A NULL or sentinel value written to `acos_bp`/`blended_roas_x100`/`rto_rate_bp` in the MV is NOT a parity harness failure because the harness compares MU fields by converting legacy Decimal to MU via Python — the harness fixture set has no workspace-day where `total_shipments=0` (a valid scenario on launch days for a new brand like Sugandh Lok).

6. **Why CI stays GREEN despite all of this:** the existing parity harness in `check-metrics-parity.sh` and `harness.py` runs against *golden_fixtures.json*. The fixture file covers money conversion (`amount`, `expected_minor_units`). The parity-runner in TS (`parity-runner.ts`) calls `decimalToMinorUnits` exclusively — it does NOT call `ratioToBasisPoints` and does NOT exercise any ClickHouse query path. The shell script compares TS vs Python on decimal-to-MU conversion only. There is zero fixture coverage of the ClickHouse ratio computation path in the current harness. The "ratio metrics same zero-tolerance rule" constraint (`CF-C4-RATIO-PARITY-1` in Rohan's review) is stated as a constraint to bind at Stage 2 — it is not yet implemented in the harness or the fixture set.

**Concrete failure mode:**

A workspace-day where `orders_count=0` (no orders, but a session spike). ClickHouse MV computes `aov_mu = net_sales_mu / orders_count = Float64(+inf)` which coerces to `Int64` as `9223372036854775807` (INT64_MAX, ClickHouse's behavior on Float64-to-Int64 overflow). The shadow-compare harness does not compare `aov_mu` for this row (legacy `workspace_daily_metrics` has `aov=NULL` for zero-order days, so the Python bridge skips the field; the harness reports `rows_checked=0` for that day — trivially GREEN). Production dashboard reads ClickHouse: `aov_mu = 9223372036854775807`. The brand sees a garbage number. No parity alarm fired.

**The fix (proposed as CF-C4-RATIO-DIVOP-1):**

Every ratio expression in ClickHouse MV DDL must use `intDiv` (not `/`) and explicit null-guards:
```sql
-- WRONG (silent Float64 coercion):
total_ad_spend_mu * 10000 / net_sales_mu

-- RIGHT (integer FLOOR, fail-closed on zero):
if(net_sales_mu > 0, intDiv(total_ad_spend_mu * 10000, net_sales_mu), NULL)
```
The `aov_mu` zero-guard noted in M-A1-1 must be promoted from a prose note to a structural DDL requirement on EVERY division expression in the MV body. The parity harness fixture set must include at least three ClickHouse-round-trip fixtures covering: (a) a ratio with a non-zero remainder, (b) a zero-denominator day, (c) a value whose Float64 representation has a fractional part that diverges from FLOOR.

---

## Concern 2 — HIGH: `misc_expenses_prorated_mu` integer division in ClickHouse MV produces a systematic FLOOR-vs-DIV divergence that passes the harness because it is pre-classified as ROUNDING_MODE_MISMATCH

**Severity:** HIGH

**The mechanism:**

The architecture specifies `misc_expenses_prorated_mu = SUM(monthly_amount_mu / days_in_month)` as a ClickHouse MV expression (M-A1-1, line 257). `monthly_amount_mu` is `Int64`, `days_in_month` is an integer (28–31). ClickHouse `/` returns `Float64`. This is now a Float64 accumulation inside a SUM — identically the pattern the taxonomy calls out as a "float-accumulation artifact" in `DIVISION_DERIVED_FIELDS` (taxonomy.py lines 82–87).

But there is an additional layer: the taxonomy already has `miscExpensesProrated` in `DIVISION_DERIVED_FIELDS` and its divergence is pre-classified as `ROUNDING_MODE_MISMATCH` (expected, non-blocking). The harness will accept a 1-paise delta for this field on `.X45` midpoints. This pre-classification was designed for the Postgres ROUND_HALF_UP vs ROUND_HALF_EVEN divergence in the legacy path. But if ClickHouse silently uses Float64 division and then coerces back to Int64, the delta could be larger than 1 paise on certain inputs — and it would still be classified as `ROUNDING_MODE_MISMATCH` because `field in DIVISION_DERIVED_FIELDS` is the only precondition checked before calling `re_derive_legacy_via_brain_path`. The fail-safe (if `re_derive != brain_mu` → `BLOCKING_BUG`) would catch it only if the delta is NOT explainable by ROUND_HALF_UP — but a Float64 coercion delta of ±1 at a `.X50` boundary IS explainable by ROUND_HALF_UP and would slip through.

Concretely: `monthly_amount_mu = 150000` paise (INR 1500), February (28 days). `150000 / 28 = 5357.142857...`. ClickHouse `/` gives `Float64(5357.142857)`. SUM over a month accumulates this as Float64. The Python harness path computes `re_derive_legacy_via_brain_path("53.57", 100)` using ROUND_HALF_UP → 5357. Brain ClickHouse produces 5357 (truncation of Float64). They match → ROUNDING_MODE_MISMATCH classification is never triggered; harness says PASS. But this is not because the semantics are correct — it is because Float64 truncation and integer FLOOR are accidentally equal for this input. The harness cannot distinguish "correct ClickHouse integer arithmetic" from "accidentally-correct Float64 coercion."

**The fix (proposed as CF-C4-PRORATED-DIVOP-1):**

`misc_expenses_prorated_mu` must use `intDiv(monthly_amount_mu, days_in_month)` in the MV, not `/`. The parity harness must be extended with a fixture that specifically injects a `monthly_amount_mu` value where Float64 division and `intDiv` diverge (e.g. a value whose Float64 representation rounds the intermediate differently from integer FLOOR). The `ROUNDING_MODE_MISMATCH` pre-classification for `miscExpensesProrated` should be audited: the classification was designed for the Postgres ROUND_HALF_UP story, NOT for ClickHouse Float64 coercion, and the two behaviors are being conflated under one label.

---

## Concern 3 — HIGH: COGS join stale/partial MV refresh produces a transient wrong value that passes the harness because the harness never compares during an in-flight MV refresh

**Severity:** HIGH

**The mechanism:**

`cogs_mu` is described as `SUM per line item: resolve_line_item_cogs(price_mu, qty, coq_map, cogs_settings)` — joining `shopify_products.coq` (M-A1-1, line 248). In ClickHouse, Materialized Views (MV) are updated incrementally as new blocks are inserted into the source table. The MV body joins against `shopify_products` for the `coq` (cost of quantity) value. ClickHouse MVs are NOT transactional: if `shopify_products.coq` is updated (a brand updates their COGS settings mid-day), the MV is NOT retroactively updated for prior order events that already incremented the MV. The MV row for that workspace-day has `cogs_mu` computed with the OLD `coq` value for all events before the update, and the NEW `coq` value for all events after the update. The legacy `compute-daily.ts` cron re-runs the full daily rollup each night, so it always uses the current `coq` value — the delta between legacy and Brain ClickHouse is nonzero, but it does not manifest until the brand changes their COGS settings, which is not covered by any CI fixture.

**Why the harness stays GREEN:**

The golden fixtures in `golden_fixtures.json` are synthetic and static. They have no fixture modeling a COGS settings update followed by an MV that was built incrementally. The shadow-compare harness (M-A5-2 compare query) is described as a point-in-time query: `SELECT b.cogs_mu FROM shadow_workspace_daily_metrics`. On the day of the comparison, if no COGS settings changed since the MV was last fully refreshed, legacy and Brain agree — PASS. The COGS drift only manifests on the day the brand updates their settings, and only for the partial-day MV slice before the update. CI has no fixture representing this state.

**The concrete scenario for Sugandh Lok:** Sugandh Lok updates their packaging cost percent mid-day on a sale event day (Black Friday / Diwali campaign). The ClickHouse MV row for that day computes `cogs_mu` using two different `coq` values for different order batches. Legacy `compute-daily.ts` re-runs at midnight with the new `coq` for the full day. The next morning's shadow-compare shows a delta on `cogs_mu` → classified as `BLOCKING_BUG`. But since the team knows COGS was updated, there is social pressure to reclassify it as `EXPECTED_DEFINITIONAL_DELTA` — and the harness provides a mechanism to do exactly that (the `expected_definitional_delta` hook in taxonomy.py is currently unpopulated, but Child 4 is supposed to wire it). The delta gets labeled a "known definitional difference" and the cutover proceeds with a wrong `cogs_mu` in ClickHouse for historical days.

**The fix (proposed as CF-C4-COGS-MV-REFRESH-1):**

The architecture must specify whether `cogs_mu` uses a true incremental MV (which is permanently wrong on COGS-settings-change days) or a full daily recompute job (which is correct but not a true MV). If incremental MV: document and measure the COGS-settings-change delta class as a named `COGS_SETTINGS_CHANGE_DELTA` mismatch category (not `EXPECTED_DEFINITIONAL_DELTA` — that label is for formula changes, not for data-staleness). If full recompute: explicitly specify this in the MV DDL and set up a test fixture that models a COGS settings change event.

---

## Concern 4 — HIGH: The single-writer grep gate is defective by construction — a Brain module can reference a legacy rollup table name inside a string literal or an ORM method without matching the grep pattern

**Severity:** HIGH

**The mechanism:**

Rohan's `CF-C4-SINGLE-WRITER-1` constraint specifies a "grep/static gate at Stage 5 proves zero Brain code references the legacy rollup tables as a write target." The Child-1 and Child-3 post-mortems already established that `grep -v`-style checks have a defect class: they check for what is present, not for the shape of what is absent. The specific defect here is that a grep for the table name `workspace_daily_metrics` (or the other rollup table names) in the Brain codebase will not catch:

1. An ORM call using a variable: `const tableName = getMetricTable(source); db.execute(INSERT INTO ${tableName}...)` — the table name is never literal in the code.
2. A Prisma model reference: `prisma.workspaceDailyMetrics.upsert(...)` — Prisma camelCases the model name; grep for `workspace_daily_metrics` would miss `workspaceDailyMetrics`.
3. A raw SQL string assembled from parts: `const q = \`INSERT INTO workspace_\` + \`daily_metrics ...\`` — split across two string literals.
4. A shared utility imported from a legacy-adjacent module that itself writes the table.

The Child-1 retro established this defect class precisely (the "contextless-arm" pattern: the grep checked for something syntactically but the enforcement was structurally inert because the actual write path took a different code shape). The architecture calls for "a *real* grep, not a `grep -v`-defective one" but does not specify what "real" means structurally. A grep for the bare table name in quoted string form catches case (1) and (3) but misses the Prisma camelCase case (2) and any ORM abstraction.

**Evidence base:** Child-1's security review specifically flagged the "inert grep" pattern; Child-3's architecture bound `CF-C3-BARE-WRITE-GREP-1` as a real grep. But `CF-C4-SINGLE-WRITER-1` as stated in Rohan's review repeats "a *real* grep" without specifying the exact pattern set. The Prisma schema for Brain will contain a model for `workspace_daily_metrics` (because Brain reads from it during shadow compare). That model exists. A developer who accidentally calls `.upsert()` instead of `.findMany()` on that Prisma model writes to the Postgres rollup — and grep for the SQL table name misses it entirely.

**The fix (proposed as CF-C4-SINGLE-WRITER-GREP-2):**

The static gate must cover at minimum three patterns:
- Grep for the SQL table names in quoted strings: `workspace_daily_metrics`, `product_daily_aggregates`, `shopify_analytics_daily`, `meta_ads_daily_metrics`, `google_ads_daily_metrics` as write targets (INSERT/UPDATE/UPSERT/DELETE/COPY keywords preceding the table name within N characters).
- Grep for the Prisma camelCase model names: `workspaceDailyMetrics`, `productDailyAggregates`, etc. in Brain code, filtered to write-method calls: `.create`, `.upsert`, `.update`, `.createMany`, `.delete`.
- The Prisma model for legacy rollup tables in Brain's `schema.prisma`, if present, should be marked `@@ignore` or restricted to a read-only DB role. The DB-layer read-only role enforcement (already mentioned in M-A5-2 for the analytics-service Postgres user) is the structural backstop that the grep cannot provide — and that DB-level constraint should be present at service startup, not only documented.

---

## Concern 5 — MEDIUM: The query-gateway workspace-scope rejection is structurally inert if the gateway wraps ClickHouse reads via a Python function that accepts optional `workspace_id` — the zero-rows test passes vacuously when the test fixture has no rows

**Severity:** MEDIUM

**The mechanism:**

`CF-C4-QUERY-SCOPE-1` requires the query gateway to "reject un-scoped queries." Rohan's Stage-1 review specifies that Stage-5 must include a negative control: "an un-scoped query is rejected, and a cross-workspace query returns zero rows." This is the exact verify-the-verifier pattern that Child-1 and Child-3 both failed on (the contextless-arm RLS policy that was structurally wired but fired against a path that never received a tenant context, the inert PII-check gate that returned True on empty input).

The specific false-GREEN scenario for Child 4: the analytics-service query gateway is implemented as a Python function `query_metrics(workspace_id: Optional[str], ...)`. The Stage-5 negative control test calls `query_metrics(workspace_id=None, ...)` and asserts it returns zero rows. If the test database has no rows at all for the test workspace, the assertion `len(results) == 0` passes regardless of whether the gateway rejected the query or simply found nothing. The test proves nothing.

The ClickHouse analogue: ClickHouse has no native RLS. If the gateway injects `WHERE workspace_id = ?` when a `workspace_id` is provided, and returns an error or empty result when `workspace_id is None`, the test verifies only the empty-input path. It does not verify that a query for `workspace_id='ws_A'` cannot retrieve rows belonging to `workspace_id='ws_B'`. For a cross-workspace leak to be tested, the test fixture must have data for at least TWO workspaces, and the test must query one workspace and assert zero rows from the other.

**Evidence in the codebase:** the `harness.py` runs over golden_fixtures.json. All fixtures use `workspace_id: "ws_test_golden_001"` (a single workspace). The analytics-service is currently stubs-only (`apps/analytics-service/src/` is all `.gitkeep` files). There is no query gateway code yet to test. The risk is that when it is built, the test suite follows the same single-workspace fixture pattern established by Child 2, and the cross-workspace isolation test never gets written.

**The fix (proposed as CF-C4-QUERY-SCOPE-ISOLATION-1):**

The Stage-5 negative control for `CF-C4-QUERY-SCOPE-1` must be specified with two-workspace fixture data. The test must: (a) seed rows for workspace `ws_A` and workspace `ws_B` in the ClickHouse test container; (b) query through the gateway with `workspace_id='ws_A'`; (c) assert zero rows have `workspace_id='ws_B'`. A test that only checks `query(None) == []` on an empty fixture proves nothing about cross-tenant isolation.

---

## Named highest-risk false-GREEN

**`rto_rate_bp` (or any ratio metric using ClickHouse `/` on Int64 operands) is the single metric most likely to pass CI but be wrong in production.**

The mechanism is Concern 1: ClickHouse `/` on `Int64` returns `Float64`, which is then coerced to `Int32` by the declared column type. For positive integer inputs (all valid RTO counts and shipment counts), Float64 coercion and integer FLOOR give the same result for almost all values — so the existing parity harness, which exercises only the TS↔Python `decimal_to_minor_units` path and has no ClickHouse round-trip fixtures, reports GREEN for every test run. The divergence only appears on zero-denominator days (`total_shipments=0` on a no-delivery day) where ClickHouse produces a `Float64` inf coerced to `Int32` max or null, while the harness skips the field because the legacy `rto_percent` is also `NULL`. Both sides return NULL → GREEN. Then production serves the platform-specific sentinel or coercion artifact from ClickHouse to the dashboard, and Child 5's anomaly detection receives the sentinel as a legitimate ratio value and fires a spurious RTO spike alert for a brand that had zero shipments.

The fix is `intDiv` + explicit null-guard in every MV division expression, bound as `CF-C4-RATIO-DIVOP-1`, and ClickHouse round-trip fixtures in the parity harness that prove the MV computes the same `_bp` value as `ratio_to_basis_points` in `ratio.py`.

---

## Proposed new constraints for Stage 2

| Constraint ID | Summary | Gates |
|---|---|---|
| `CF-C4-RATIO-DIVOP-1` | Every division expression in a ClickHouse MV body must use `intDiv(numerator, denominator)` (never `/`); every denominator must have an explicit null-guard (`if(denom > 0, intDiv(...), NULL)`); the parity harness must include ClickHouse round-trip fixtures covering non-zero-remainder ratios and zero-denominator cases. | Stage 2 DDL review; Stage 5 QA; Stage 6 Rohan VETO |
| `CF-C4-PRORATED-DIVOP-1` | `misc_expenses_prorated_mu` MV expression must use `intDiv(monthly_amount_mu, days_in_month)`, not `/`; the `ROUNDING_MODE_MISMATCH` pre-classification for this field must be audited to confirm it covers only the Postgres ROUND_HALF_UP story and not a Float64 coercion artifact. | Stage 2 DDL review |
| `CF-C4-COGS-MV-REFRESH-1` | Architecture must specify whether `cogs_mu` uses incremental MV (permanently wrong on COGS-settings-change days) or full daily recompute; if incremental, a named `COGS_SETTINGS_CHANGE_DELTA` mismatch category must be added to the taxonomy (not `EXPECTED_DEFINITIONAL_DELTA`); a CI fixture must model a COGS settings change event. | Stage 2 architecture; Stage 5 QA |
| `CF-C4-SINGLE-WRITER-GREP-2` | The single-writer static gate must cover three patterns: SQL table names as write targets, Prisma camelCase model write-method calls, and the DB-level read-only role enforcement at service startup (not only documented). | Stage 5 QA; Stage 6 Rohan VETO |
| `CF-C4-QUERY-SCOPE-ISOLATION-1` | Stage-5 negative control for query-gateway isolation must use two-workspace fixture data and assert zero cross-workspace rows, not merely assert empty result on un-scoped query against an empty fixture. | Stage 5 QA |

---

## One-liner for CTO Advisor synthesis

ClickHouse's `/` operator returns Float64 on integer operands (not integer FLOOR) — every ratio MV expression in the architecture draft is wrong-by-default and the current parity harness has zero ClickHouse round-trip coverage, making the entire ratio-parity guarantee structurally inert; `CF-C4-RATIO-DIVOP-1` (`intDiv` everywhere + ClickHouse fixtures) must be bound at Stage 2 before any MV DDL is written.
