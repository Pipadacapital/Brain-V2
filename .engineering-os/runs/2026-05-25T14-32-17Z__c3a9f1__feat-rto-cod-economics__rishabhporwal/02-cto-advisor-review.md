# CTO Advisor Review — Stage 1 intake (feat-rto-cod-economics, Phase-2 slice 3)

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **Stage** | 1 (intake / brainstorm) |
| **Timestamp** | 2026-05-25T14:32:17Z |
| **Decision** | **ADVANCE** (to Aryan Stage 2 — high-stakes pipeline) |

## Lane decision

- **feature_class:** `high-stakes`
- **feature_class_rationale:** Trigger-surface scan fires on ≥4 surfaces: multi-tenancy
  (every new query carries `workspace_id` + must fail-closed), money/financial impact (RTO cost,
  COD realization, break-even — all minor-unit money), schema/registry change (5 new metric defs +
  DDR rows), and compliance-sensitive India-commerce data (RTO/COD economics — the moat). Lane is
  also inherited high-stakes from the parent epic. No carve-out applies (live contracts, real
  business logic). Conservative tie-break N/A — unambiguously high-stakes.
- **trigger_surfaces_touched:** `["multi-tenancy", "money-financial", "schema-proto", "india-compliance-data"]`
- **Stages that run:** 1 (Rohan) → 2 (Aryan) → 3 (Maya/Vikram/Ananya) → 4 (Shreya) → 5 (Tanvi) → 6 (Rohan) → 7 (Founder, signed on delegation).

## Pre-flight dependency check

- Parent meta-tracker: `epic-phase2-feature-parity`. Slice-3 child block `blocks: [feat-store-order-fact-layer]`.
- `state[feat-store-order-fact-layer].status = approved` (stage 8) ✓ — dependency SATISFIED.
- Slice 2 (`feat-pnl-cm-waterfall`, status approved) is not a hard blocker but is a REUSE base
  (CM ladder, true_cm2, DDR `_ROW_TRUE_CM2`) — its shipped registry/DDR are reused, not rebuilt.
- No dependency violation. Proceed.

## Semantic recall

Recall + prior-slice artifact read surfaced the slice-2 lesson (vacuous parity gate / verify-the-verifier,
proposal evidence #8) and the established **honest-input pattern**: shipment-level operational facts
(RTO orders, COD/prepaid/delivered counts, courier, pincode, RTO charges, fees) are NOT columns on the
gateway `MetricRow` — they arrive live at the held Child-3 connector cutover. Slice 1 (`ReversalFacts`)
and slice 2 (`VariableCostFacts`, `RtoProvisionFacts`) accepted such facts as EXPLICIT workspace-scoped
use-case inputs rather than hidden defaults. Slice 3 follows the SAME pattern — no new gateway column,
no hidden default. This is the anti-rework decision.

## Framing & challenge

### Is the slice-table's break-even formula correct? — NO. CHALLENGE (caught at Stage 1, not at a bounce).

The ratified slice table lists `breakeven_cod_rto_rate (r*=M/(M+C))`. I **read the actual legacy formula**
(`lib/workspace-metrics/cod-prepaid-analytics.ts:210-238`) rather than assume it. The real legacy break-even is:

```
r*_cod = ( V·P + (COD_fee − PG_fee) + P·(S + RS) ) / ( V + S + RS )
```

where V = AOV, P = prepaid RTO rate, S = return-shipping per RTO, RS = restocking (=0 in legacy),
COD_fee = flat COD handling fee, PG_fee = V × gateway-fee-%. The naive `M/(M+C)` is a degenerate
special case and is NOT what the legacy moat computes. **This is a definitional fact that MUST be
registered in the DDR and pinned with a cross-language formula anchor** — exactly the slice-2 lesson
applied. Carrying the slice-table's simplified `r*` into the registry would be a silent correctness
regression. Binding instruction to Aryan/Maya: port the FULL legacy formula; register `_ROW_BREAKEVEN_COD_RTO`;
anchor it with a worked example that fails the naive form and passes the full form.

### Other read-not-assumed findings (carried to the plan)

- **RTO rate already exists.** `rto_rate_bp` (rto_orders/total_shipments) + `prepaid_rate_bp` shipped in
  Child-4. Do NOT re-add. New defs are the *cost/economics* layer on top: `rto_cost_mu`,
  `rto_revenue_lost_mu`, `cod_realization_rate_bp`, `breakeven_cod_rto_rate_bp`, `pincode_reliability_score`.
- **COD realization = delivered/COD-orders** (`cod_realization_rate_bp`), legacy `codDelivered/codOrders`.
  RTO and DELIVERED are status-substring predicates (`'RTO'` / `'DELIVER'`) — port the predicate exactly.
- **Pincode reliability** legacy `calcProfitabilityScore` = `100 − rtoRate·2 − codRate·0.5 + repeatRate·0.5
  + (aov/1000)·10`, clamped [0,100]. Brain-native (no clean legacy "score" comparand beyond this fn) →
  correctness_fixture. Must use INTEGER arithmetic (the legacy uses float rates as percent points;
  Brain must define the score on integer bp inputs deterministically and pin the anchor). This is the
  one formula with float-shape risk → the persona's job to stress-test.
- **Money is float in legacy** (`Number`, `Math.round(x*100)/100`). Every ported money field → BIGINT
  paise. FX poison (`pnl.ts:42-56`) absent from these modules — confirm none re-introduced.
- **Pincode "high RTO ≥ 20%" / "high COD ≥ 50%" filters** are display filters, not metrics — keep in the
  query/page, not the registry.

### NDR as leading indicator

The brief mentions NDR (non-delivery report) as a leading RTO indicator. The legacy slice-3 modules do
NOT compute an NDR metric (they classify by final status RTO/DELIVERED). NDR is a Shiprocket
intermediate-status concept that needs connector-level event data (held at Child-3). **Scoping
decision:** NDR is OUT of slice-3's registry (no honest data source pre-Child-3); flagged as a future
add once the connector emits intermediate statuses. Building an NDR metric now on absent data would be
dishonest. Recorded so it isn't silently dropped.

### Not a CHALLENGE-BACK

The requirement is sound, planable, dependency-satisfied, and the Founder's epic cadence explicitly
ordered this slice. The break-even finding is a *binding plan instruction*, not a bounce. **ADVANCE.**

## Persona-count decision

- **Count chosen: 1.**
- **Rationale:** Per the complexity classifier, a single net-new risk dimension dominates —
  **numeric-parity correctness of the ported economics formulas** (the break-even formula diverges from
  the slice-table assumption; the pincode reliability score has float-shape risk). The other big
  dimensions (RLS, money minor-units, registry parity harness, DDR machinery) are NOT net-decided here —
  they were settled by the layer-children + slices 1–2 and are reused; re-spawning personas for them
  would duplicate settled work. Not 0, because there is a genuine adversarial formula-correctness angle
  worth one stress-test (and the slice-2 lesson is that an un-stressed formula port can ship a silent
  bug). Not 2, because there is no second intersecting net-new dimension (no cost/paradigm risk — it's
  pure SQL; no compliance ambiguity — read-only analytics, no outbound channel).
- **Persona spawned:** `india-rto-cod-numeric-realist:haiku` — a BOUNDED stress-test: (a) does the ported
  break-even formula match the FULL legacy formula (not the naive `M/(M+C)`), with a worked example that
  distinguishes them? (b) is the pincode reliability score deterministic on integer inputs (no float
  drift, correct clamp)? (c) is `cod_realization_rate_bp` the delivered/COD-orders ratio with the exact
  status predicate? (d) any zero-denominator NULL-guard gaps? Tagged `:haiku` — this is a checklist/
  single-rule numeric angle, not multi-step reasoning; Haiku handles it at ~6× lower cost.

> Within the high-stakes cap (2). One persona, one dominant net-new dimension.

## Paradigm recommendation

`@paradigm("sql")` — epic-dominant, confirmed. Every slice-3 metric is deterministic integer
aggregation over structured shipment/order facts. Zero ML, zero LLM, zero inference path. Pincode
reliability is a deterministic scoring formula (SQL), NOT a model. Risk-scoring ML is a later slice only
if persona-proven — explicitly NOT built here.

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | CORE of this slice — rate (reused), cost, revenue-lost, break-even. The single largest controllable Indian-D2C margin leak. RTO provision already flows to True-CM2 (slice-2 reuse). |
| **COD** | COD vs prepaid realization + break-even; COD RTO 20–35% vs prepaid 2–8% (canon). `cod_realization_rate_bp` = delivered/COD-orders. |
| **GST** | Net-of-tax stays per-SKU (slice-1/2 `total_tax_mu`, DDR `_ROW_TOTAL_TAX` child_dependency Child-3). NOT touched/blended here. |
| **Pincode reliability** | Slice-3 — deterministic reliability score; tier classification (T1/T2/T3) ported from legacy city sets. SQL. |
| **Telecom (DLT/NCPR/DND/calling hours)** | NOT triggered — read-only analytics, no outbound channel. No WhatsApp/SMS/call send. Confirmed no slice-3 surface sends. |
| **Money** | Float→BIGINT minor units across all RTO/COD/logistics money columns; FX poison absent (confirm not re-introduced). |

## Persona-count decision RECORDED + handoff

- count=1; persona = `india-rto-cod-numeric-realist:haiku`; rationale above (numeric-parity-only dimension).
- This is the FIRST pass: I request the persona and STOP. The orchestrator spawns it (writes
  `0N-persona-*.md`), then re-invokes me to synthesize before Aryan.

## Synthesis pass (post-persona)

The persona (`india-rto-cod-numeric-realist:haiku`) surfaced 4 concerns — all accepted as BINDING plan
inputs for Aryan/Maya:
1. **Break-even = FULL legacy formula, not `M/(M+C)`** — `_ROW_BREAKEVEN_COD_RTO` DDR + non-vacuous
   anchor (worked example V=150000p, P=0.05, COD_fee=3000p, gateway 2%, S=8000p → 500bp; fails naive).
   Single final FLOOR-to-bp, integer paise throughout.
2. **Pincode reliability integerized** — define on bp/paise inputs, fixed integer scale (centi-points),
   clamp [0,10000], correctness_fixture + DDR snapshot + anchor. No float formula shipped.
3. **`cod_realization_rate_bp`** — `intDiv(cod_delivered·10000, cod_orders)` reusing the `_ratio_bp`
   null-guard; status predicate (`'DELIVER'`/`'RTO'` substring) lives in the use-case, ratio in registry.
4. **`rto_cost_mu` / `rto_revenue_lost_mu`** — aggregate money defs; connector-sourced → DDR with
   child_dependency `child-3-shopify-connector` (mirrors `_ROW_TOTAL_TAX`); never silently float-matched.

Net: ADVANCE to Aryan with these 4 corrections bound into the requirement. SQL-only, read-only, no
paradigm risk. NDR remains out-of-scope (no honest pre-Child-3 data source).

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T14:32:17Z",
  "actor": "cto-advisor",
  "type": "slice-intake",
  "req_id": "feat-rto-cod-economics",
  "parent_epic": "epic-phase2-feature-parity",
  "slice": 3,
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["multi-tenancy", "money-financial", "schema-proto", "india-compliance-data"],
  "needs_personas": ["india-rto-cod-numeric-realist:haiku"],
  "dependency_check": "blocks=[feat-store-order-fact-layer]; status=approved; SATISFIED",
  "rationale": "Port RTO/COD/logistics/pincode legacy economics into Brain-native analytics; reuse slice-1/2 foundation + Child-4 rto_rate_bp; FULL legacy break-even formula (not naive M/(M+C)) registered in DDR with non-vacuous anchor; honest-input pattern for shipment facts; SQL-only; read-only; 4 real pages."
}
```
