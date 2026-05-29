# Rule Proposal — verify-legacy-formula-at-stage1-not-slice-table

| Field | Value |
|---|---|
| **proposal_id** | `verify-legacy-formula-at-stage1-not-slice-table` |
| **proposed_by** | `cto-advisor (Rohan)` |
| **proposed_at** | 2026-05-25T15:20:00Z |
| **target_scope** | `stage-1-cto-advisor` + `stage-2-architect` (all `epic-phase2-feature-parity` slices; any feature ported from legacy) |
| **status** | ADOPTED 2026-05-29 → `.engineering-os/durable-rules/2026-05-29__verify-legacy-formula-at-stage1-not-slice-table.md` |

---

## Proposed text

> For any requirement that PORTS a legacy computation, the ratified slice-table / capability-map entry is a POINTER, never the spec. At Stage 1 (CTOA) and Stage 2 (Architect), the actual legacy source formula MUST be read and the math verified before a binding plan is written. Two specific failure modes must be checked and resolved IN the Stage-1/2 plan:
> 1. **Slice-table shorthand divergence** — the shorthand names a metric/formula that does not match (or does not exist in) the legacy source. Bind the real legacy formula with a non-vacuous numeric anchor; record the correction.
> 2. **Speculative pre-build divergence** — an earlier child/slice already created a registry def / use-case for this concept with a formula that diverges from legacy (often hidden behind a parity "shadow-phase" carve, so no cross-language gate bites it). Reconcile (redefine to legacy + DDR row) or decommission the dead def; never wire an unvalidated pre-built def into a page.

---

## Rationale

Three consecutive Phase-2 slices found the ratified slice-table shorthand to be WRONG or incomplete as a spec, each time caught only because the actual legacy formula was read at Stage 1. Trusting the shorthand would have shipped numbers that were never validated against the legacy behavior the Founder asked to preserve — silent correctness landmines on the exact decision metrics (break-even, aMER) that drive India-D2C margin decisions. A speculative pre-build hidden behind a shadow-carve is especially dangerous: the parity gate is GREEN yet enforces nothing cross-language on the divergent def. Codifying this makes the "read the real formula + reconcile pre-builds" step a mandatory gate, not a discretionary good habit.

---

## Evidence

- **slice 3 (`feat-rto-cod-economics`, run `…14-32-17Z__c3a9f1`)** — retro: slice-table said break-even `r*=M/(M+C)`; real legacy (`cod-prepaid-analytics.ts:218-231`) is the full `(V·P + (COD_fee − PG_fee) + P·(S+RS))/(V+S+RS)` — 500bp vs the naive ~9493bp. Caught at Stage 1.
- **slice 4 (`feat-marketing-acquisition`, this run `…14-56-06Z__slice4m`)** — Stage-1 review + persona: slice-table named paMER/payback/attribution-ladder; ground truth: paMER has NO legacy comparand (decommissioned), payback + placed→realized→incremental are slice-5 cohort concepts, AND Child-4 had pre-built `amer_bp` (= true_cm2/total_spend) diverging from legacy aMER (= nc_revenue/acquisition-classified-spend) behind a parity shadow-carve. Reconciled at Stage 1→3.
- **metric-engine + pnl runs (`…22-25-29Z__0e76f7`, `…14-06-44Z__b2f1c7`)** — retros reference TS↔Python↔DDR formula divergence + a vacuous registry-parity gate (the same shadow-carve failure mode that hid slice-4's divergent defs).

- **slice 5 (`feat-cohorts-ltv`, run `…15-25-02Z__slice5`)** — Stage-1 review: slice-table said cohort rung = `cohort_cumulative_cm2_mu` and "LTV:CAC + payback under LTV"; real legacy: cohorts use **CM3** (cm2 − misc), LTV uses **CM2** with **NO** CAC/payback/LTV:CAC (those are cohort concepts). A 3rd speculative pre-build — Python-only `cac_payback_months = CAC/MonthlyCM2` — does NOT match the legacy cumulative bucket-walk + interpolation; DECOMMISSIONED (mirrors slice-4 `pamer_bp`). Notably TWO artifacts (the slice-table AND the pre-built `ltv_cac_bp` comment) AGREED on the wrong CM2 rung — internal consistency was not correctness. Caught at Stage 1; payback verified at the wire (1.0mo bucket-walk, not the phantom 2mo flat).

- **slice 6 (`feat-catalog-inventory`, run `…15-46-22Z__slice6`)** — Stage-1 review: the slice-table was wrong on ALL THREE features. Products is **CM1** (reused `cm1_mu`, NOT a phantom per-SKU CM2 — there is no per-SKU ad allocation in legacy); inventory has **sellThrough + daysLeft, NO turnover** (the slice-table's "inventory turnover"/"cover_days" don't exist); the cascade rate is **per-first-product, observation-windowed — NOT slice-5 rr90**. Caught at Stage 1.
- **slice 7 (`feat-finance-settings-goals`, run `…16-20-00Z__slice7`)** — Stage-1 review: Goal RAG is **DIRECTIONAL**, not the slice-table's (and the pre-existing `rag-badge.tsx`'s) flat "≥95% green / 80-95% amber / <80% red" — that is ONLY the higher-better case; lower-better metrics (CAC/ACOS) invert (1.05/1.20). Shipping the flat rule would paint an over-budget CAC GREEN. Also "festival learned lift" is a **PHANTOM** (no legacy comparand — only a stored `expected_multiplier` template default) → NOT built (4th decommission). And the "calendar report" is a period grid with marketing-action overlays, NOT a festival surface. Caught at Stage 1; directional band re-derived at the wire.

(≥6 distinct runs now (slices 2-7), this one included — well past the auto-candidate threshold. Evidence #7. The pattern is now BROAD: it has bitten EVERY analytics slice that had a slice-table shorthand. The slice-table itself should be demoted to a "hint, verify at source" status. Strongly recommend Founder `/adopt-rule`.)

---

## Disposition

**ADOPTED 2026-05-29 by Founder (rishabhporwal).** ≥6 occurrences (Phase-2 slices 2-7) — bit every analytics slice with a slice-table shorthand; caught real margin-metric landmines. Promoted to `.engineering-os/durable-rules/2026-05-29__verify-legacy-formula-at-stage1-not-slice-table.md`. Decision-log: `.engineering-os/decision-log/2026/05/2026-05-29.jsonl` (type `rule-adoption`).
