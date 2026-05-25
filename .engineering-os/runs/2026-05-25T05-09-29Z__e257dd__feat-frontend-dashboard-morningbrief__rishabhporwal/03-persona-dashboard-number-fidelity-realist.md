# Persona Review — `dashboard-number-fidelity-realist`

> Stage 1 — Child 6 (frontend): `feat-frontend-dashboard-morningbrief`
> Persona spawned by CTO Advisor (Rohan). One adversarial round; transient.
> Skill loaded: `kpi-dashboard-design` + `cost-routing-paradigms` (money-display discipline).
> Ground-truth read from: `pylibs/brain_metrics/brain_metrics/registry/definitions.py`,
> `packages/lib-metrics/src/registry/definitions.ts` + `money.ts` + `subunits.ts` + `convert.ts` + `ratio.ts`,
> `apps/analytics-service/src/infrastructure/clickhouse/query_gateway.py`,
> `apps/intelligence-service/src/domain/faithfulness/validator.py` + `extraction.py`,
> `apps/intelligence-service/src/domain/tools/recommendation.py`,
> `apps/intelligence-service/src/application/gateway/client.py`,
> `docs/conventions/money.md`,
> `apps/api-gateway`, `apps/web`, `apps/mobile` (all bare `.gitkeep` scaffolds — zero implementation).

---

## Framing

My obsession is the iron rule at the presentation boundary: the UI **renders** numbers, never computes, rounds, aggregates, or contradicts a metric. Every concern below is grounded in the actual files I read — not in speculation. The registry exists and is solid. The faithfulness validator exists and is solid. The BFF (api-gateway), web, and mobile apps are bare `.gitkeep` scaffolds — they do not exist yet. That is precisely where every number-fidelity risk lives: **in the code that has yet to be written.**

The concerns below are ordered by the path a wrong number would travel to reach the operator's screen.

---

## Concern 1 — BIGINT serialisation trap at the JSON seam (the 2^53 precision loss)

**Severity: CRITICAL**

**Evidence:**

`query_gateway.py` returns `MetricRow` with all money fields typed `int` in Python. The registry defines money as `Int64 minor units` and the TS side uses `bigint` (confirmed: `money.ts` `minorUnits: bigint`, `convert.ts` uses `BigInt()` throughout, never `Number()`). The ClickHouse schema is `Int64`.

The api-gateway BFF does not yet exist. When Vikram builds it, the data-plane call returns Python `int` values (can be up to `Int64` max = 9.2 × 10^18). If those integers are serialised as **JSON numbers** and the tRPC client deserialises them into JS `number`, any value above `2^53 - 1 = 9_007_199_254_740_991` (approximately ₹90,071,992,547 = roughly ₹90 crore) will silently lose precision. For a high-GMV day at Sugandh Lok this is not today's risk, but for the architecture to be correct for the lifetime of the product it must be addressed now, because fixing this after contracts are wired is a breaking change.

A more immediate concern: `total_ad_spend_mu` for a meta + google day at, say, ₹5 lakh = 50,000,000 paise — well within `Number` safe-integer range — but `gross_sales_mu` for a brand with ₹50 lakh/day GMV = 5,000,000,000 paise, which is also within safe-integer range. The danger is specifically for high-GMV SaaS tenants later, or if any intermediate sum (`total_ad_spend_mu × 10000` in a ratio formula) is accidentally surfaced in transit rather than the final pre-computed integer.

More concretely: `blended_roas_x100` TS formula has a subtle issue I found in `definitions.ts` line 197:

```
formula_ts: (net_sales_mu: bigint, total_ad_spend_mu: bigint): number =>
  ratioToBasisPoints(net_sales_mu * 100n, total_ad_spend_mu * 10000n) / 10000,
```

The final `/ 10000` is a JavaScript **float division** on a `number` result. `ratioToBasisPoints` returns `Number(floored)`. For a very large GMV ratio, this `/10000` produces a float that is then rounded somewhere client-side or displayed as a float. This is the formula for a display-only metric (`display_only: true`) but it is still rendered by the UI, and if a developer copies the pattern into a non-display metric it produces float drift. This is the one place in the TS registry where a float operation is used in a formula result.

**Proposed constraint: CF-C6-BIGINT-JSON-1 (CRITICAL)**

The api-gateway tRPC BFF MUST serialise all `_mu` (money) and `_bp` (basis-points) fields as **JSON strings** or use a BigInt-safe serialiser (e.g. tRPC superjson transformer with BigInt support) — never as bare JSON numbers. The tRPC client MUST deserialise them as `bigint`. The gateway data contract must be audited for this before any `formatMoney` call in the UI — if the value arrives as `number`, the display layer is working on potentially-truncated paise. Acceptance gate: Stage-5 (Tanvi QA) must include a test that transmits a money value `> Number.MAX_SAFE_INTEGER` through the full tRPC stack and asserts the received value in the client is byte-identical to the sent value.

Additionally: the `blended_roas_x100` TS formula's trailing `/ 10000` (float) should be replaced with `Number(ratioToBasisPoints(net_sales_mu * 100n, total_ad_spend_mu * 10000n)) / 10000` — which is what it already does — but the TS registry comment acknowledges the `x100` scale is a "TS-only deviation." The Stage-6 audit (Rohan final VETO) must confirm no UI component passes this float to any formatting path that re-rounds it differently from the canonical integer.

---

## Concern 2 — `formatMoney` does not exist at the edge (there is no edge)

**Severity: HIGH**

**Evidence:**

The requirement mandates `formatMoney(MU, currency_code)` at the edge. CF-C6-RENDER-ONLY-1 states "money is `formatMoney(MU, currency_code)` at the edge only." The canon `docs/conventions/money.md` says "Display layer converts to display units (paise ÷ 100 = rupees) at render time only."

I searched every package and app in the repo for `formatMoney`, `displayMoney`, `formatCurrency`, `lakh`, `crore`, `toLocaleString`. There is no `formatMoney` function anywhere in Brain. The TS money primitives (`makeMoney`, `decimalToMinorUnits`, `subunitMultiplier`) handle construction and conversion-to-MU. There is no display formatter — no `paise → ₹X.XL / ₹X.XCr` rendering function in `packages/lib-metrics` or anywhere else.

This means Ananya will be writing the display formatter from scratch inside `apps/web` (and Karan independently in `apps/mobile`). Two independently written formatters is the highest-probability path to a lakh/crore rendering discrepancy: one divides by 100 to get rupees then formats, the other divides by 100000 to get lakhs. If either:
- uses `Number(minorUnits)` instead of `Number(minorUnits) / 100` (off by 100x)
- hardcodes `/ 100` instead of reading `subunitMultiplier` (wrong for AED/SAR Phase-4)
- rounds the display value (e.g. `toFixed(2)`) before formatting lakh/crore — a **re-rounding** of the pre-computed integer
- independently computes `₹X.XL` by computing `minorUnits / 100 / 100000` (two floating-point divisions) rather than `minorUnits / 10_000_000` (one integer division to crore-paise)

...a wrong number reaches the operator's screen silently.

The `InsightItem.confidence: float` field (0.0–1.0, display only) is a small additional concern: if this is formatted as a percentage in the UI via multiplication (`confidence * 100`), that is arithmetic in the presentation layer — acceptable only if the value arrives as a pre-computed display float, not if it triggers a generalised "let's do math client-side" pattern.

**Proposed constraint: CF-C6-FORMATMONEY-CANONICAL-1 (HIGH)**

A canonical `formatMoney(minorUnits: bigint, currencyCode: string, locale?: string): string` function must be created in `packages/lib-metrics` (the single home for money primitives) before Ananya or Karan write a single card. It must:
1. Read `subunitMultiplier(currencyCode)` — never hardcode 100.
2. Use BigInt integer division (not `Number()` before dividing) to compute the major-unit integer.
3. Apply lakh/crore grouping as an integer decision (`>= 10_000_000` → crore, `>= 100_000` → lakh), not a float threshold.
4. Not round the value — it formats the integer the registry computed; it does not mutate it.

Both `apps/web` and `apps/mobile` import this one function. No local reimplementations. Stage-5 (Tanvi) must include a negative test: a monkey-patched `formatMoney` that divides by 100 (the canonical anti-pattern) must produce a failing parity assertion against the registry value.

---

## Concern 3 — Faithfulness drift: the cache-as-of gap between the AI narration and the rendered deterministic numbers

**Severity: HIGH**

**Evidence:**

Child-5's faithfulness validator (`validator.py`) runs server-side at gateway dispatch time and validates the narration against the `Signal` values that were fed to the LLM. This is correct and solid. However the validator operates on **the values that were in the signals at the time the LLM was called.** The `_FiltersHashCache` in `gateway/client.py` has a 6-hour TTL keyed on `workspace_id + filters_hash`.

The UI renders the Morning-Brief narration alongside the KPI cards. The KPI cards are fetched independently from the analytics gateway (tRPC `queryMetrics`). If:

1. The Morning-Brief insight was generated at T=0 against `cm2_mu = 8,000,000` (₹80,000).
2. New order data arrives and the ClickHouse MV refreshes at T+1h.
3. At T+5h (within the 6h cache window) the user opens the dashboard.
4. The KPI card fetches fresh from ClickHouse: `cm2_mu = 9,500,000` (₹95,000).
5. The Morning-Brief narration is served from cache: "Your CM2 of ₹80,000 is below target."

The faithfulness validator correctly validated "₹80,000" against the signal value `8,000,000` — it passed. But the operator now sees ₹80,000 in the narration next to ₹95,000 on the KPI card. These are both "correct" from their respective timestamps but **they contradict each other on screen.** The iron rule says "AI narration never contradicts the rendered deterministic numbers" — this path violates it, without any faithfulness-ok=False firing.

This is specifically CF-C6-FAITHFULNESS-RENDER-1 as named by Rohan: "the UI renders the SAME registry value the Child-5 narration was validated against; no independent re-fetch/cache that could drift."

**Proposed constraint: CF-C6-AS-OF-STAMP-1 (HIGH)**

The gateway response for an insight MUST include an `as_of` timestamp (or `data_epoch` — the ClickHouse snapshot timestamp the signals were computed from). The tRPC BFF must propagate this to the UI. The UI component rendering a Morning-Brief insight alongside KPI cards must either:
(a) fetch the KPI card values for the SAME `as_of` epoch as the insight (preferred — the card and narration are from the same snapshot); or
(b) display a staleness indicator when the KPI card's data epoch differs from the insight's `as_of` by more than a threshold (acceptable fallback).

This is an architectural decision for Aryan to bind in Stage 2 (the as-of epoch must flow through the tRPC contract), but the constraint must be named now so it is not discovered at Stage-5 QA when both surfaces are built.

---

## Concern 4 — `blended_roas_x100` unit tag divergence: Python `unit='bp'` vs TS `unit='bp'` with a ×100 scale

**Severity: MEDIUM**

**Evidence:**

In `packages/lib-metrics/src/registry/definitions.ts` lines 191–201:

```
export const BLENDED_ROAS_X100: MetricDefinition = {
  id: 'blended_roas_x100',
  kind: 'ratio',
  // Python registry uses unit:'bp' for this metric even though the scale is ×100 (not ×10000).
  // The 'x100' type tag was a TS-only deviation. Python canon stores it as 'bp' (integer ratio).
  // This is display_only; the unit tag does not affect the formula or the stored integer.
  unit: 'bp',
```

And in `pylibs/brain_metrics/brain_metrics/registry/definitions.py` lines 572–583:

```
blended_roas_x100 = MetricDefinition(
    id="blended_roas_x100",
    kind="ratio",
    unit="mu",   ← NOTE: actually unit="bp" in the Python file (line 576)
```

Wait — checking the Python file carefully: Python has `unit: MetricUnit = Literal["mu", "bp", "count"]` and the blended_roas definition at line 575 shows `unit="bp"`. The TS comment says "The 'x100' type tag was a TS-only deviation. Python canon stores it as 'bp'." The TS `MetricUnit` type definition in `types.ts` line 38 includes `'x100'` as a valid unit — but `BLENDED_ROAS_X100` uses `'bp'`, not `'x100'`. So the metric ID says `_x100` but the unit tag says `bp` — and a developer building a UI display component who reads the `unit` field to decide how to render a ratio ('bp' → divide by 100 to get a percentage) will format this incorrectly: `ROAS = blended_roas_x100 / 100` = the ROAS as a percentage (e.g. 250 bp → 2.5%) when the actual meaning is `blended_roas_x100 = 250` means ROAS of 2.50× (divided by 100, not by 10000). A UI component that switches on `unit === 'bp'` and applies the standard basis-points rendering path will display this wrong.

This is a `display_only: true` metric, so it never gates a decision. But ROAS appears prominently in acquisition dashboards and if it renders "2.50%" instead of "2.50×" the operator is misled.

**Proposed constraint: CF-C6-ROAS-DISPLAY-CONTRACT-1 (MEDIUM)**

The `formatMoney`/`formatRatio` display function contract must explicitly document that `blended_roas_x100` uses a ×100 scale (not ×10000) and the rendering path is `value / 100` (not `value / 10000`). The cleanest fix is to add a `scale` field to `MetricDefinition` (e.g. `scale: 10000 | 100 | 1`) so the display layer reads it without branching on metric ID strings. Alternatively, change the metric `unit` from `'bp'` to `'x100'` (the dedicated tag that already exists in `MetricUnit`) and update the Python side to add `'x100'` to `MetricUnit` as well. The current state — where the metric ID signals `_x100` but the unit field says `bp` — is an invitation for a copy-paste display bug.

---

## Concern 5 — No "orphan number" enforcement contract at the BFF boundary

**Severity: MEDIUM**

**Evidence:**

The requirement states "KPIs ONLY from the metric registry; every metric drills to source rows." The Python registry (`METRIC_REGISTRY` dict) and the TS registry (`METRIC_REGISTRY` const) are the canon. The `query_metrics` gateway returns a flat `MetricRow` with pre-computed columns. So far so good.

The api-gateway tRPC BFF does not yet exist. When Vikram builds the tRPC procedures (e.g. `getKpiSummary`, `getPnlWaterfall`), the response shape will be defined as a tRPC output schema (Zod). The risk is that a developer adds a field to the tRPC output type that is not in the metric registry — e.g. an ad-hoc `totalGrossRevenueLast7Days: number` computed by the BFF by summing `gross_sales_mu` across 7 `MetricRow` objects. This would be:
1. A metric computed at the BFF layer (not from the registry).
2. Potentially a floating-point summation (if the BFF sums JS numbers instead of BigInts).
3. An orphan number with no `definition_id` traceability.
4. Not drill-to-source (no source rows linked to it).

There is currently no enforcement that every field in a tRPC KPI response corresponds to a `METRIC_REGISTRY` definition. The registry has `get_metric(definition_id)` / `get_metric(id)` fail-closed helpers in both Python and TS, but there is nothing preventing a BFF developer from adding a derived field outside the registry.

**Proposed constraint: CF-C6-REGISTRY-ONLY-BFF-1 (MEDIUM)**

Every KPI field surfaced in a tRPC response MUST carry its `definition_id` from the registry as a tagged field, or be generated by a typed `MetricRow → response` mapper that accepts only columns present in `_METRIC_COLUMNS` (the `query_gateway.py` canonical column list). The BFF must not introduce any field that is not traceable to a `MetricDefinition.id`. Stage-6 audit: grep `apps/api-gateway/src` for any arithmetic operator (`+`, `-`, `*`, `/`) outside of the `formatMoney` call path — every such operation is a candidate orphan-number violation. Drill-to-source (CF-C6-DRILL-TO-SOURCE-1) is the natural companion: any KPI card that cannot link to its source `definition_id` and from there to source rows fails the provenance contract.

---

## Concern 6 — `InsightItem.confidence: float` is a float in the render contract

**Severity: LOW**

**Evidence:**

`recommendation.py` defines `InsightItem.confidence: float` with the comment `(display only, not used for routing)`. The Morning-Brief card will render confidence as a percentage or a bar. If the mobile component does `Math.round(confidence * 100)` to display "87%" — that is arithmetic in the presentation layer. It is display-only arithmetic on a display-only field, so it cannot corrupt a decision metric. But it establishes a pattern: "it's fine to compute in the UI if the field is display-only." A developer who later adds a display-only `expected_impact_pct: float` to `InsightItem` and applies the same pattern will be computing a percentage that contradicts the `expected_impact` numbers validated by the faithfulness gate.

**Proposed constraint: CF-C6-NO-UI-FLOAT-ARITHMETIC-1 (LOW)**

`InsightItem.confidence` should be pre-formatted server-side (e.g. `confidence_display: str = "87%"`) before it leaves the intelligence-service — OR the tRPC contract should include `confidence_display_pct: int` (e.g. 87, not 0.87) so the UI can render it without arithmetic. The goal is to establish the pattern that even display-only numbers arrive pre-formatted, not raw floats awaiting UI multiplication. This prevents a future developer from extending the pattern to a non-display-only field.

---

## The Single Highest-Risk Wrong-Number Path

**The most likely path for a wrong number to reach the operator's screen:**

Vikram writes the BFF `getPnlWaterfall` tRPC procedure. It fetches 30 days of `MetricRow` from `query_metrics` and needs to surface "total CM2 for the date range." He writes `rows.reduce((sum, r) => sum + r.cm2_mu, 0)` — a JS `number` accumulator starting at `0` (not `0n`). `r.cm2_mu` was deserialised from a JSON number (because the BigInt JSON issue in Concern 1 was not addressed). The sum fits in IEEE-754 for a typical month, but at ₹50L GMV / month = 5,000,000,000 paise, the 30-day cm2 sum approaches the safe-integer boundary. More importantly, the sum is a NEW metric computed at the BFF layer (Concern 5) — it is not `cm3_mu` or any registry definition. The Morning-Brief narration from Child-5 was faithfulness-validated against the single-day `cm2_mu` signal. The dashboard card shows the BFF-computed 30-day sum. These two numbers are incommensurable: different time ranges, different computation surfaces, and the faithfulness validator has no visibility into the BFF-computed sum. The operator sees "₹80K CM2 today (Morning Brief)" next to "₹24L CM2 this month (P&L card)" — the month-sum is not wrong per se, but it was never registry-defined, never faithfulness-validated, and was computed with float arithmetic in the BFF. If the developer made the common mistake of computing the sum as an average by accident (`/ rows.length`), the wrong number appears on screen with no test to catch it and no registry definition to audit against.

This is the confluence of Concern 1 (BigInt JSON), Concern 5 (orphan number), and Concern 3 (as-of gap) in a single build moment.

---

## Summary for the CTO Advisor

| # | Concern | Severity | Proposed CF |
|---|---------|----------|-------------|
| 1 | BIGINT JSON coercion: money BIGINT serialised as JSON number loses precision above 2^53; `blended_roas_x100` TS formula uses a trailing float `/10000` | CRITICAL | CF-C6-BIGINT-JSON-1 |
| 2 | No `formatMoney` function exists anywhere in Brain; Ananya + Karan will write independent formatters with lakh/crore drift risk | HIGH | CF-C6-FORMATMONEY-CANONICAL-1 |
| 3 | 6-hour insight cache can serve a narration validated against stale signals while the KPI card renders a fresh ClickHouse value — both are "correct" but they contradict on screen | HIGH | CF-C6-AS-OF-STAMP-1 |
| 4 | `blended_roas_x100` has unit=`bp` but ×100 scale; standard `bp` render path (÷10000) produces wrong display ("2.5%" instead of "2.5×") | MEDIUM | CF-C6-ROAS-DISPLAY-CONTRACT-1 |
| 5 | No enforcement that every BFF tRPC response field traces to a registry `definition_id`; the BFF-computed-aggregate anti-pattern has no guard | MEDIUM | CF-C6-REGISTRY-ONLY-BFF-1 |
| 6 | `InsightItem.confidence: float` is a raw float in the render contract, establishing a compute-in-UI pattern that will spread | LOW | CF-C6-NO-UI-FLOAT-ARITHMETIC-1 |

**One-liner for synthesis:** The two dominant risks are (a) BigInt CRITICAL — money BIGINT will silently truncate to float the moment the BFF serialises it as a bare JSON number, before `formatMoney` even exists to call; and (b) a missing canonical `formatMoney` primitive means two independent developers will write lakh/crore formatters that will disagree on edge cases — the "UI never computes" rule is meaningless if the display formatter is itself an ad-hoc client-side computation.
