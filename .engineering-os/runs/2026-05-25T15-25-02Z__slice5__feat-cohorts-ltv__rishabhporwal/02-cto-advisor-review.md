# CTO Advisor Review — Stage 1 intake — feat-cohorts-ltv (Phase 2, slice 5)

| Field | Value |
|-------|-------|
| **req_id** | `feat-cohorts-ltv` |
| **parent_epic** | `epic-phase2-feature-parity` |
| **Stage** | 1 (intake) |
| **Timestamp** | 2026-05-25T15:25:02Z |
| **Decision** | **ADVANCE → Stage 2 (Aryan)**, with a binding reconciliation mandate + slice-table correction |
| **Lane** | high-stakes (inherited; trigger surfaces below) |
| **Paradigm** | `sql` (deterministic cohort/LTV SQL — ML ruled OUT, justification below) |

---

## Lane decision

`feature_class = high-stakes`. Trigger surfaces touched: **money/financial impact** (CM2/CM3/CAC/LTV/payback in bigint paise), **multi-tenancy** (`workspace_id`-scoped CH reads), **schema/registry change** (new metric defs in both registries + DDR), **PII-adjacent** (customer-id dimension in LTV — customer-level grouping). Conservative tie-break N/A — multiple hard triggers. Full high-stakes pipeline runs: S1 (me) → S2 Aryan → S3 Maya/Vikram/Ananya → S4 Shreya → S5 Tanvi → S6 me, gates under standing delegation.

`trigger_surfaces_touched`: `["money", "multi-tenancy", "schema-registry", "pii-customer-dimension"]`

---

## Persona-count decision

**Count chosen: 0.** Rationale (complexity classifier): this slice is NOT a new risk dimension — it is the SAME numeric/definitional-parity dimension that personas already stress-tested in slices 2/3/4 (numeric-parity-realist). The dominant work is reading the legacy formulas EXACTLY and binding non-vacuous anchors — which IS my Stage-1 job and which I have done below (I read all four legacy files, not the slice-table shorthand). There is no cost/paradigm question (SQL is forced; see paradigm ruling), no compliance dimension (read-only analytics, no outbound channel), no new-stack question. A persona here would re-derive what I already bound. The clear-repeat-of-prior-pattern rule (slices 2/3/4 are the registry+use-case+tRPC+page pattern) applies. I synthesize Stage 1 directly.

> If I wanted a persona, the single candidate would be a payback-interpolation numeric realist — but the legacy payback formula is fully transcribed below with a worked anchor, so the bind is already done. 0 is correct.

---

## STANDING LESSON APPLIED — read the ACTUAL legacy formulas (it bit a 4th time)

Per the lesson `verify-legacy-formula-at-stage1-not-slice-table` (now 4 occurrences), I read `lib/cohorts/compute.ts`, `lib/ltv/compute.ts`, both `types.ts`, and both route files in full. The ratified slice table said:

> Slice 5 registry entries: `cohort_retention, cohort_cumulative_cm2_mu, ltv_mu, ltv_cac_ratio`; "LTV (and LTV:CAC using slice-4's CAC), payback period, the placed→realized→incremental attribution concepts."

**Five divergences between that shorthand and the real legacy code — all load-bearing:**

### Finding 1 — Cohorts use **CM3**, not CM2 (slice table said `cohort_cumulative_cm2_mu`)
`cohorts/compute.ts:513-515`: `cm1 = totalPrice − cogs − shipping − packaging − website`; `cm2 = cm1 − adSpend`; **`cm3 = cm2 − misc`**. The cohort heatmap, payback, and the `repeatByCohortBucketCm3` payback ledger all use **cm3** (cm2 MINUS per-order prorated misc). The slice table's `cohort_cumulative_cm2_mu` is the WRONG rung for cohorts. **Bind: the cohort money metric is CM3-based, not CM2-based.**

### Finding 2 — LTV uses **CM2**, not CM3, and has **NO CAC, NO payback, NO LTV:CAC** in the module
`ltv/compute.ts:512`: `cm2 = totalPrice − cogs − shipping − packaging − website − adSpend`. **No misc subtracted** (so it is genuinely cm2, not cm3). The LTV module computes `firstOrderR` + M1..M12 cumulative/post/incremental per dimension, `repeat_rate`, and summary cards (month1/3/6/12). It contains **zero CAC, zero payback, zero LTV:CAC ratio**. Payback + LTV:CAC live in **COHORTS** (`cohorts/compute.ts:712` mode=`ltvcac`, `:610-652` payback). This is the SAME error class as slice-4's payback-misattribution: the slice-table put LTV:CAC/payback under "LTV" when legacy puts them under cohorts. **Bind: LTV (cm2, dimensioned, no CAC) and cohorts (cm3, monthly, with CAC/payback/ltvcac) are DIFFERENT computations. Do not conflate.**

### Finding 3 — The pre-built `cac_payback_months` Python def is a PHANTOM (does NOT match legacy)
`registry/definitions.py:867-887` has a Python-only `cac_payback_months = CAC / Monthly CM2` (integer-months FLOOR), reserved "slice-5 (cohorts), not wired in slice-4". **This is NOT the legacy payback.** Legacy payback (`cohorts/compute.ts:610-652`) is a **cumulative bucket-walk with interpolation**:
```
cum = firstOrderR − cac
if cum >= 0 → payback = 0 (immediate)
else for k in 1..12:  cum += incr[k-1]; if cum >= 0:
        (cm3 + post mode, incrVal>eps, prevCum<0) → payback = (k-1) + (0 − prevCum)/incrVal   # linear interpolation
        else → payback = k
     → if never reached: null
```
`CAC / MonthlyCM2` is a flat ratio with no cumulative curve and no interpolation — it diverges from legacy on any non-flat retention curve. This is the **3rd speculative pre-build that diverges from legacy** (after slice-4's `pamer_bp` phantom and the divergent `amer_bp`). **Bind: `cac_payback_months` must be REDEFINED to the legacy cumulative bucket-walk (the cohort summary `averagePayback` = customer-weighted mean of per-cohort cm3 payback), OR decommissioned and replaced with a use-case-level payback computation registered with the real formula. Aryan decides the cleanest registry shape; the FORMULA is non-negotiable (legacy bucket-walk + interpolation).** Carries a DDR row (parity_gap:true; no legacy byte comparand — legacy is float, Brain is integer paise).

### Finding 4 — `ltv_cac_bp`'s comment claims "cohort cumulative CM2" — also wrong rung
`registry/definitions.py:496-512` (TS) + `560-592` (PY) define `ltv_cac_bp = intDiv(ltv_mu × 10000, cac_mu)`. The TS comment says "LTV:CAC = cohort cumulative CM2 ÷ cohort CAC". Per Finding 1, the cohort cumulative rung is **CM3** (cm2 − misc), not CM2. The RATIO formula `ltv/cac` is correct and reusable as-is; only the **input** `ltv_mu` must be sourced from the cohort cumulative **CM3** curve (the `ltvcac` mode at a chosen horizon), not a CM2 curve. **Bind: reuse `ltv_cac_bp` unchanged (the ratio is right); the use-case feeds it the cohort cumulative-CM3 LTV at the horizon. Fix the misleading comment.**

### Finding 5 — FX poison present in BOTH legacy modules (must die)
`cohorts/compute.ts:15-29` and `ltv/compute.ts:15-29`: static `EXCHANGE_RATES = {USD:1, INR:83.5, ...}` + `convertCurrency`. Same poison class killed in Child-2 / slice-1. **Bind: NO static FX. Brain stays single-currency (store currency = anchor brand currency, INR); misc-expense currency conversion is the only legacy use of it and is out of slice-5 scope (misc proration is already a slice-2 def). FX absence is a Tanvi gate.**

---

## The exact legacy computation contract (non-vacuous spec for Aryan/Maya/Vikram)

### Shared primitives (both modules)
- **first order** = customer's first order in range (`fetchCustomerFirstOrdersInRange`); `firstByCustomer[cust] = {firstAt, orderId}`.
- **bucket** = `Math.min(12, floor((daysDiff − 1)/30) + 1)` for repeat orders with `1 ≤ daysDiff ≤ 360`; first order is excluded from buckets. **30-day windows, 12 buckets, NOT calendar months.**
- **per-order cost proration**: daily shipping/packaging/website/(misc for cohorts)/adSpend ÷ ordersThatDay; COGS via shared `resolveLineItemCogs`.
- **refund share**: `orderShareRefunds = grossSales>0 ? (totalPrice/grossSales)*totalReturns : 0`.
- **realized**: RTO order → `0`; else `cm(3 or 2) − orderShareRefunds`. (cohorts: `realized = cm3 − refundShare`; LTV `cm2Realized = cm2 − refundShare`, `revenueRealized = totalPrice − refundShare`.)
- **toDateExtended** = to + 360 days (repeat orders are observed up to 360 days past the cohort window).

### COHORTS (`cohorts.matrix`)
- group customers by **first-order MONTH** (YYYY-MM).
- metric families: `cm3 | revenue | repeat | repurchase`. modes: `post | cumulative | incr | pct | ltvcac` (cm3/revenue support all; repeat/repurchase support post/incr).
- per-cohort: `newCustomers`, `cac = monthSpend/newCustomers`, `rr90` (90-day repeat rate), `firstOrder` (avg cm3 of first orders), `firstOrderR` (avg realized cm3), `payback` (Finding 3 formula; cm3+post interpolates).
- M1..M12 = per-bucket incremental ÷ newCustomers; then mode transform (cumulative seeds with `firstOrderR` for cm3 / `firstOrder` for revenue; pct divides by |fo|; ltvcac divides by `max(cac,eps)`).
- summary: `averageCac = totalAdSpend/totalNewCustomers`, `avg90DayRepeat`, `averagePayback` (customer-weighted mean of per-cohort cm3 payback), `newCustomers`.
- **WORKED ANCHOR (CF-S5-COHORT-PAYBACK-1)**: firstOrderR=300 (paise: 30000µ), cac=500 (50000µ), incr cm3 = [200,200,...] (20000µ each). cum0 = 30000−50000 = −20000 (<0). M1: cum=−20000+20000=0 ≥0 → cm3+post interpolate: prevCum=−20000, incrVal=20000 → payback = 0 + (0−(−20000))/20000 = **1.0 month**. A "flat CAC/MonthlyCM2" mutant (50000/20000 = 2 months) is KILLED by this anchor.

### LTV (`ltv.summary`)
- group by **DIMENSION** (product/variant/vendor/product_type/product_tags/order_tags/discount_pct/customer_id; collection/discount_codes → "—" passthrough). **Weighted line-item attribution**: weight = `(li.price·qty)/orderTotal` (tags further ÷ tag count).
- metric families: `cm2 | revenue | repeat_rate`. modes: `cumulative | post_acq | incremental`.
- per-dim: `newCustomers` (= distinct first-order customers in that dim), `firstOrder`/`firstOrderR` (weighted avg), M1..M12 (incremental ÷ n) then `applyMode`. repeat_rate uses distinct-customer-set size ÷ n; fo=0 for repeat_rate.
- summary cards: month1/3/6/12 = applied M1/M3/M6/M12 over customer-weighted averages. paginated (page/pageSize 10–100), search, sort by dimensionLabel.
- **WORKED ANCHOR (CF-S5-LTV-CUM-1)**: dim with n=2, firstOrderR avg = 1000µ, incr cm2 = [500µ, 300µ, 0,...]. cumulative: m1 = 1000+500 = 1500µ; m2 = 1500+300 = 1800µ; m3 = 1800µ. An "incremental-not-cumulative" mutant gives m1=500 — KILLED.

### Registry shape (Aryan finalizes; FORMULAS bound here)
Reuse unchanged: `cm1_mu`, `cm2_mu`, `cm3_mu`, `cac_mu`, `aov_mu`, `realized_revenue_mu`, `ltv_cac_bp` (ratio; fix comment per Finding 4).
**New / redefined defs (parity-green TS↔Python + non-vacuous anchor each):**
1. `cac_payback_months` — **REDEFINE** to the legacy cumulative bucket-walk (Finding 3) OR decommission + compute in use-case with a registered `cohort_payback_*` def. Either way the FORMULA is the bucket-walk + cm3+post interpolation. parity_gap:true → correctness_fixture + DDR.
2. `repeat_rate_bp` — 90-day (rr90) and bucketed repeat rate: distinct-repeat-customers ÷ new-customers, in bp. shadow_compare (legacy comparand exists). non-vacuous anchor.
3. `cohort_ltv_mu` (or reuse a generic cumulative-cm3 rung) — the cohort cumulative CM3 at horizon that feeds `ltv_cac_bp`. parity_gap:true → correctness_fixture + DDR.
> If a concept already has a def, REUSE it (Single-Primitive Rule). Aryan must NOT add a 2nd id for a concept. Net-new count is the minimum that expresses Findings 1-4.

---

## Paradigm ruling — SQL, ML ruled OUT (explicit)

Per the slice brief's CRITICAL paradigm check: I read both legacy compute modules end-to-end. **Neither uses any model.** Cohorts and LTV are pure deterministic aggregation: group-by-cohort/dimension, bucket by 30-day windows, cumulative sums, integer ratios. The "LTV projection" that the epic flagged as a possible ML candidate **does not exist in legacy** — legacy LTV is observed cumulative value to 360 days, not a fitted/extrapolated curve. There is therefore **no legacy model to match and no SQL-inexpressible sub-computation**. Forcing ML here would (a) diverge from legacy behavior and (b) threaten the %-of-GMV cost invariant for zero correctness gain. **@paradigm("sql"), zero LLM/ML.** This is NOT an `/escalate` trigger (no compliance ambiguity, no cost-model threat — SQL is the cheap path).

---

## India context check
| Lens | Impact |
|------|--------|
| **GST** | LTV/cohort revenue rungs inherit per-SKU GST handling from the slice-1 ladder; net-of-tax is NEVER blended. cm2/cm3 are post-COGS contribution, GST already handled upstream. |
| **RTO** | Both modules zero-out realized value for RTO orders (`realized=0` if RTO) — honest CM3/CM2. Reuse the slice-3 RTO order-identifier logic Brain-native. |
| **COD/prepaid** | Not directly surfaced; realized already accounts for RTO (COD's main leak). |
| **Telecom (DLT/NCPR/calling-hours)** | NOT triggered — read-only analytics, no outbound channel. customer_id dimension is in-app display only, no send. |
| **PII** | customer_id LTV dimension groups by customer — Shreya must confirm it stays workspace-scoped and is not a cross-tenant leak vector (RLS fail-closed). |

---

## Made requirements less dumb first
- **Delete**: the slice-table's `cohort_cumulative_cm2_mu` (wrong rung — it's CM3) and the LTV:CAC/payback-under-LTV framing (they're cohort concepts). Corrected, not built wrong.
- **Simplify**: reuse `ltv_cac_bp` ratio + `cac_mu` + cm-ladder unchanged; net-new is only the cohort/LTV use-cases + the payback bucket-walk + repeat-rate + the cumulative-CM3 LTV rung.
- **Defer**: WooCommerce cohort/LTV path (legacy has `compute-woocommerce.ts` — not the anchor brand; Shopify-only this slice, same as slices 1-4). customer-lifecycle.ts is slice 8 (RFM states), NOT slice 5 — explicit non-goal. The `dimension` set can ship with the core dims (product/variant/vendor/type/customer_id/discount_pct); exotic dims (collection/discount_codes are already "—" passthrough in legacy) need no compute.

## Non-goals (binding)
- WooCommerce path; customer-lifecycle/RFM (slice 8); AI narration (slice 9); collection/discount_codes real compute (legacy returns "—"); any outbound channel; any new dependency; any ML/LLM; editing/importing legacy code.

---

## Decision: ADVANCE → Stage 2 (Aryan)

Not a CHALLENGE-BACK (requirement is sound, planable, foundation shipped) and not a KILL. ADVANCE with the binding reconciliation mandate above. Aryan's Stage-2 plan MUST: (a) adopt the CM3-for-cohorts / CM2-for-LTV split (Findings 1-2); (b) redefine or replace `cac_payback_months` with the legacy bucket-walk + interpolation (Finding 3) + DDR; (c) reuse `ltv_cac_bp` ratio, feed it cumulative-CM3, fix the comment (Finding 4); (d) exclude all FX (Finding 5); (e) name every new def's non-vacuous kill-mutant.

### Decision log entry (mirrored)
```json
{
  "ts": "2026-05-25T15:25:02Z",
  "actor": "cto-advisor",
  "type": "stage-1-intake",
  "req_id": "feat-cohorts-ltv",
  "parent_epic": "epic-phase2-feature-parity",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["money", "multi-tenancy", "schema-registry", "pii-customer-dimension"],
  "needs_personas": [],
  "paradigm": "sql",
  "rationale": "Slice 5 cohorts+LTV ported to LEGACY semantics. Read actual legacy formulas (4th time the lesson bit): cohorts use CM3 not CM2; LTV uses CM2 with NO CAC/payback/ltvcac (those are cohort concepts); pre-built cac_payback_months (CAC/MonthlyCM2) is a PHANTOM that diverges from the legacy cumulative bucket-walk+interpolation; ltv_cac_bp comment names wrong rung; FX poison in both modules. Bound a reconciliation mandate + 2 non-vacuous worked anchors. SQL forced (legacy has no model); ML ruled out. 0 personas (same parity dimension already stress-tested slices 2/3/4)."
}
```

**Next:** Aryan Stage 2 binding plan.
