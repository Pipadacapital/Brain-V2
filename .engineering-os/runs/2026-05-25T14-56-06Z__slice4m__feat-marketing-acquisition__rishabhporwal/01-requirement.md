# Requirement — feat-marketing-acquisition (Phase 2, slice 4)

**req_id:** `feat-marketing-acquisition`
**parent_epic:** `epic-phase2-feature-parity`
**blocks (data dependency):** `feat-store-order-fact-layer` (slice 1, store net revenue + revenue ladder), `feat-pnl-cm-waterfall` (slice 2, CM2/true-CM2), `feat-rto-cod-economics` (slice 3, RTO adjustment) — all shipped/approved.

## Founder directive (slice 4 of the assembly line)

Port legacy marketing-efficiency + acquisition + distributions to Brain-native: MER / aMER / CAC + the acquisition new-customer-CM2 surface, and the per-product distribution surface. Light up `/acquisition` and `/distributions` with real ported data on the Brain shell. Reuse the committed revenue ladder + CM ladder + query gateway + registry/parity harness. ROAS display-only (privilege CM2/CAC).

## Legacy ground truth (READ, not slice-table shorthand)

- `lib/metrics/marketing-efficiency.ts` — **MER** = storeNetRevenue / totalAdSpend; **aMER** = newCustomerRevenue / acquisition-classified ad spend (unclassified/brand/non_acquisition EXCLUDED from denominator — conservative); **ACOS** = totalAdSpend / storeNetRevenue. MER null when no spend; aMER null when acq spend 0.
- `lib/acquisition/compute.ts` — new customer = first order in period; NC CM2 = totalPrice − COGS − per-order(shipping+packaging+website+adSpend) − refundShare, RTO→0; newCustomerRevenue = totalPrice − totalTax − refundShare (RTO excluded); blendedCac = totalAdSpend / newCustomers; cm2PerNc = totalNcCm2 / newCustomers.
- `lib/metrics/ads-spend.ts` — campaign-intent classification: spend bucketed acquisition / non_acquisition / brand / unclassified per `campaign-classification`. aMER denominator uses ONLY the acquisition bucket.
- `routes/workspaces/distributions.ts` + `lib/distributions/compute.ts` — per-product **distribution** (histogram) of per-order sales OR CM1; mode/mean/diff + density buckets. NOT an attribution surface.

## NON-shorthand corrections (the slice-2/3 lesson)

The ratified slice-table named "paMER / payback / placed→realized→incremental attribution ladder". Ground-truth reading shows:
- **paMER does NOT exist in legacy.** No comparand.
- **payback is a COHORT concept** (cumulative CM3 vs CAC over months) — belongs to slice 5 (cohorts/LTV), not slice 4.
- **placed→realized→incremental** is the LTV/cohort ladder (`lib/ltv`, `lib/cohorts`) — slice 5, not acquisition.
- "blended vs platform spend" = meta + google split, which DOES exist (acquisition summary `meta`/`google`/`totalAdSpend`).

So slice 4's real scope = **MER, aMER, ACOS (display-only), blended CAC, CM2-per-NC, new-customer revenue, NC-CM2 daily, meta/google split**, plus the **distributions per-product histogram**.

## Pre-built-debt finding (BLOCKER surfaced at intake)

Child-4 (`feat-metric-engine-olap-split`) speculatively pre-built marketing defs that DIVERGE from legacy and are split unevenly across registries behind a "shadow phase" parity carve:
- `amer_bp` (TS) = true_cm2 / total_ad_spend — legacy aMER is newCustomerRevenue / acquisition-spend. **Different metric, same name.**
- `pamer_bp` = cm2 / total_ad_spend — **no legacy comparand at all.**
- `mer_bp` (PY-only) = net_sales / total_ad_spend — close to legacy but numerator basis differs; needs DDR reconciliation.
- `cac_mu` (PY-only) = total_ad_spend / new_customers — matches legacy blendedCac conceptually.
- `cac_payback_months` (PY-only) = cac / monthly_cm2 — a COHORT/slice-5 concept; out of slice-4 scope.

These are dead (no consumer) and unvalidated against legacy. Slice 4 MUST reconcile them, not wire them blind.

## Acceptance bar (binding inputs for Aryan/Maya/Shreya/Tanvi)

- Registry defs for MER / aMER / CAC reconciled to legacy semantics, TS↔Python BYTE-IDENTICAL (close the uneven split), parity-green AND non-vacuous (anchors that FAIL the wrong formula).
- aMER denominator = acquisition-classified spend ONLY (the conservative legacy rule), explicitly modeled — not total spend.
- ROAS / ACOS `display_only: true` (already so for acos_bp/blended_roas_x100) — never a decision metric.
- Every divergence from legacy registered in the DDR as a correctness-fixture (NOT a silent float match).
- New tRPC `marketing.*` procedures: workspaceProc, requireRole(ANALYST), bigint minor units over superjson; RLS fail-closed on every query (context-less → ZERO rows; un-scoped → gateway reject).
- Per-SKU GST never blended (newCustomerRevenue uses per-order totalTax which already flows from per-SKU slabs upstream; confirm no blended-tax shortcut).
- `@paradigm("sql")` — scheduled Python rollup for the join-heavy MER (slice-table note), zero LLM/ML.
- DDR deltas registered for the reconciled marketing defs.
- Real-network smoke PASS: `/acquisition` + `/distributions` render real anchor-brand (Sugandh Lok) ported data end-to-end; typecheck 0.
- Reversible/additive; legacy untouched (read-only reference).
- Out of scope (explicit): paMER (no legacy basis — DECOMMISSION the dead def), cac_payback_months (slice 5), cohort/LTV attribution ladder (slice 5), WooCommerce path (anchor is Shopify), campaign-classification CRUD UI (settings — slice 7), goals overlay (slice 7).
