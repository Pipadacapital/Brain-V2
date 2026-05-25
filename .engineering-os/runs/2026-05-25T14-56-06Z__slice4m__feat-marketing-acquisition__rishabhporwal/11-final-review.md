# Final Review — feat-marketing-acquisition (Stage 6, Rohan) — VETO gate

@paradigm: sql · slice 4 of `epic-phase2-feature-parity`

| Field | Value |
|-------|-------|
| **Decision** | **PASS** → Founder gate (Stage 7), signed under standing delegation (no hard-rule deviation) |
| **Recommendation** | **APPROVE** |

## Drift check (requirement → plan → build)

The requirement (port MER/aMER/CAC + acquisition + distributions to LEGACY semantics) is honored exactly. The slice-table shorthand corrections I made at Stage 1 held through the build: **no paMER, no payback, no attribution ladder** were built (all correctly deferred to slice 5 / decommissioned). No scope creep. No files staged beyond the Stage-2 plan's 24-path list (+ the DDR `.md` mirror which the plan named as item 18).

## The slice's headline value (the Stage-1 finding, resolved)

I caught at intake that Child-4 had speculatively pre-built marketing defs diverging from legacy behind the parity gate's "shadow phase" carve. This build **reconciled** them rather than wiring dead/wrong defs:
- `amer_bp` redefined to legacy (nc_revenue / acquisition-classified spend) — verified 15000bp on the wire with the acquisition split, "use total spend" mutant (6000bp) killed by the gate AND a unit test AND a router test.
- `pamer_bp` (phantom, no legacy comparand) decommissioned cleanly — removed from registries, barrels, DDR, and all locked-canon tests; the parity gate's non-vacuity mutant retargeted so it still bites.
- `mer_bp`/`cac_mu` brought into BOTH registries (closed the uneven TS/PY split); MER numerator reconciled to `net_revenue_mu` so /acquisition MER == /store net revenue.

This is exactly the slice-2/3 lesson applied: I read the real legacy formulas, not the slice-table shorthand.

## @paradigm audit

`@paradigm("sql")` throughout — every use-case header, the registry, the gateway. Zero LLM/ML decorators introduced. ROAS/ACOS `display_only:true` (CM2-first). Holds the ~85% SQL target. No paradigm escalation.

## Multi-tenancy (4 layers) — verified

All four present (use-case fail-closed re-assert → query gateway → tRPC workspaceProc+requireRole → wire). Independently re-verified the wire fail-closed: foreign workspace → `UnscopedQueryError`.

## Observability

request_id 4-tuple returned on every procedure (verified on the wire); data_epoch freshness on every result; sr-only request_id in the page components.

## Independent gate re-run (MANDATORY — I re-ran ≥3 of Tanvi's gates myself, captured output)

1. **Parity gate** — re-ran `tools/check-metrics-parity.sh` → PASS; confirmed both kill-mutants fire (non-vacuous); confirmed the `amer_bp` DDR snapshot now matches the new formula.
2. **Python suites** — re-ran brain_metrics (299) + analytics-service (136) + DDR (40) → all PASS.
3. **TS suites** — re-ran lib-metrics (142) + api-gateway (73) → all PASS.
4. **Typecheck** — re-ran tsc --noEmit on all 3 packages → 0 errors.
5. **Live wire smoke** — re-ran the 3 procedures + negative tenancy myself → values match Tanvi's report (mer 29384, amer 30000 on acquisition spend, cac 16250, distributions mode 48000; foreign-ws → UnscopedQueryError).

I can replicate every PASS Tanvi reported. No Stage-5 quality issue.

## Over-engineering audit (7/7) — PASS

- No files beyond the plan (verified `git status`).
- No metrics/observability/tests beyond the plan; tests are the standard positive+negative coverage.
- No new npm/pip/uv dependencies.
- No new abstraction for "future use" — `pamer_bp` was REMOVED (net-negative on dead code); ONE `format-ratio` helper; ONE marketing use-case package; the DataPlanePort seam reused (no second path).
- Plan length proportionate to a high-stakes registry-reconciliation slice.
- No 30+ line WHAT-comments; comments explain WHY (legacy basis, the aMER landmine).
- Single-Primitive Rule: aMER denominator is its own def (`acquisition_ad_spend_mu`), not a fork.

## Hard-rule deviation scan (step 9) — NONE

No dependency violation (slices 1-3 shipped), no Single-Primitive violation, no compliance gap (read-only, no channel), no paradigm escalation, no gate-skip. The locked-canon test edits are the necessary, correct consequence of decommissioning an invented metric and redefining one to legacy — not a deviation; they are now MORE legacy-faithful and remain non-vacuous. Therefore I may sign under standing delegation.

## India context — PASS

Per-SKU GST honesty preserved (no blended-tax shortcut in NC-revenue); RTO new-customer orders → 0; CM2/CAC privileged over vanity ROAS; no outbound channel (no DLT/NCPR trigger); ap-south-1.

## Child-3 dependency note (carried, not blocking)

`new_customer_revenue_mu`/`nc_cm2_mu`/`cm2_per_nc_mu`/`acquisition_ad_spend_mu` carry `child_dependency: child-3-shopify-connector` in the DDR (UNSIGNED-PENDING until the connector gate is GREEN) — identical to slice-1/3's connector-sourced facts. The stub seed proves the math end-to-end; live data flips at the held Child-3 cutover. This is the established pattern, not a defect.

## Verdict

**PASS / APPROVE.** Slice 4 ships MER/aMER/CAC + acquisition + distributions on 2 real data-backed pages, legacy-faithful, parity-green + non-vacuous, RLS fail-closed, per-SKU GST honest, SQL-only, typecheck 0, nothing committed. Signed under standing Founder delegation. Mechanical commit command in `pending-founder-commit.md`.
