# Durable Rule — verify-legacy-formula-at-stage1-not-slice-table

> Promoted to durable rule on 2026-05-29 by Founder. Source proposal:
> `.engineering-os/rule-proposals/2026-05-25__verify-legacy-formula-at-stage1-not-slice-table.md`.
> Evidence at adoption: **≥6 distinct runs** (Phase-2 slices 2-7). The pattern has bitten EVERY
> analytics slice that carried a slice-table shorthand, catching real margin-metric correctness
> landmines. Far past the ≥3 auto-candidate threshold.

| Field | Value |
|---|---|
| **rule_id** | `verify-legacy-formula-at-stage1-not-slice-table` |
| **adopted_at** | 2026-05-29T18:00:00Z |
| **adopted_by** | rishabhporwal (Founder) — agents cannot decide their own rules |
| **target_scope** | `stage-1-cto-advisor` + `stage-2-architect` (all `epic-phase2-feature-parity` slices; any feature ported from legacy) |
| **status** | adopted |
| **adoption_decision_artifact** | `.engineering-os/decision-log/2026/05/2026-05-29.jsonl` (entry type: `rule-adoption`) |

---

## Rule statement (BINDING)

> For any requirement that PORTS a legacy computation, the ratified slice-table / capability-map
> entry is a POINTER, never the spec. At Stage 1 (CTOA) and Stage 2 (Architect), the actual legacy
> source formula MUST be read and the math verified before a binding plan is written. Two specific
> failure modes must be checked and resolved IN the Stage-1/2 plan:
> 1. **Slice-table shorthand divergence** — the shorthand names a metric/formula that does not
>    match (or does not exist in) the legacy source. Bind the real legacy formula with a
>    non-vacuous numeric anchor; record the correction.
> 2. **Speculative pre-build divergence** — an earlier child/slice already created a registry def /
>    use-case for this concept with a formula that diverges from legacy (often hidden behind a
>    parity "shadow-phase" carve, so no cross-language gate bites it). Reconcile (redefine to
>    legacy + DDR row) or decommission the dead def; never wire an unvalidated pre-built def into
>    a page.

---

## Why this is a rule (not a per-run lesson)

Across Phase-2 slices 2-7, the ratified slice-table shorthand was WRONG or incomplete as a spec
every time, caught only because the real legacy formula was read at Stage 1. Trusting the shorthand
would have shipped numbers never validated against the legacy behavior the Founder asked to
preserve — silent landmines on the exact decision metrics (break-even, aMER, cohort CM, RAG bands)
that drive India-D2C margin decisions. A speculative pre-build behind a shadow-carve is especially
dangerous: the parity gate is GREEN yet enforces nothing cross-language on the divergent def.

## Evidence highlights

- **slice 3 (`feat-rto-cod-economics`):** slice-table break-even `r*=M/(M+C)`; real legacy is the
  full `(V·P + (COD_fee − PG_fee) + P·(S+RS))/(V+S+RS)` — **500bp vs a naïve ~9493bp**.
- **slice 4 (`feat-marketing-acquisition`):** `paMER` has NO legacy comparand (decommissioned);
  pre-built `amer_bp` diverged from legacy aMER behind a shadow-carve. Reconciled.
- **slice 5 (`feat-cohorts-ltv`):** cohorts use **CM3** not CM2; phantom `cac_payback_months`
  decommissioned; two artifacts AGREED on the wrong rung (internal consistency ≠ correctness).
- **slice 6 (`feat-catalog-inventory`):** wrong on all three (Products=CM1; sellThrough+daysLeft
  not turnover; per-first-product windowed cascade not rr90).
- **slice 7 (`feat-finance-settings-goals`):** Goal RAG is **DIRECTIONAL** (lower-better CAC/ACOS
  invert) — the flat ≥95/80-95/<80 rule would paint an over-budget CAC GREEN; "festival learned
  lift" a phantom (4th decommission).

## Enforcement

- **Stage 1 (cto-advisor):** read the real legacy formula; flag slice-table divergence + any
  speculative pre-build; bind the real formula with a numeric anchor.
- **Stage 2 (architect):** the binding plan reconciles (redefine + DDR row) or decommissions any
  divergent pre-built def; never wires an unvalidated def into a page. The slice-table is demoted
  to "hint, verify at source."
