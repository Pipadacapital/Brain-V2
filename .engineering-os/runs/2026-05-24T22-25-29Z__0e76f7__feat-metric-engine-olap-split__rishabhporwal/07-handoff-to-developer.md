# Handoff to Builders — feat-metric-engine-olap-split (Child 4)

> Stage 3 build handoff (high-stakes → prescriptive). Pairs with `06-architecture-plan.md` (binding). Two builders IN PARALLEL: **@vikram** (Track V — OLAP plumbing) + **@maya** (Track M — registry/DDR/fixtures, co-owner). Integrate at the metric-registry definition contract + the extended parity gate.
> **Guardrails (binding):** NO `git commit` (Founder commits at end-review). NO live ClickHouse DDL applied (runbook-gated). NO live read-source flip. NO Brain write to any legacy Postgres rollup table. ZERO edit to `legacy project/**` (reference-only). Paradigm `sql` exclusively — any `@paradigm: haiku/sonnet/ml` in the metric path = BOUNCE.

## 0. Build base
Branch `feature/feat-tenancy-auth-rls-hardening` (carries committed Child-1/2/3). Import `@brain/lib-metrics` (`packages/lib-metrics/src/index.ts`) + `brain_metrics` (`pylibs/brain_metrics/brain_metrics/__init__.py`); extend `tools/check-metrics-parity.sh`. Do NOT re-implement `decimalToMinorUnits`/`ratioToBasisPoints` — import them.

## 1. CRITICAL gate — bind BEFORE any MV DDL (`CF-C4-RATIO-DIVOP-1`)
ClickHouse `/` on `Int64` returns **Float64**, not integer FLOOR — it produces coercion garbage / `inf` / Int-max on zero-denominator days, and all positive-integer fixtures stay GREEN so the bug is invisible. **No MV division may use `/`.** Every division:
```sql
if(<denom> > 0, intDiv(<num>, <denom>), NULL)   -- integer FLOOR + fail-closed on zero/absent denom
```
Track V0 authors the template FIRST; no MV DDL file exists before it. Bound for every `_bp`/`_mu`-derived ratio AND `misc_expenses_prorated_mu` (`intDiv(monthly_amount_mu, toDaysInMonth(date))` — **never a `30` constant**).

## 2. Track V — @vikram (backend-developer)
- **V0** `apps/analytics-service/migrations/clickhouse/_divop_template.sql` + banned-`/` lint. GATE — do first.
- **V1** ClickHouse base/MV DDL (runbook-gated, NOT applied) under `apps/analytics-service/migrations/clickhouse/` + Stage-8 `README.md`. `cogs_mu` = scheduled full daily recompute (NOT incremental MV — §5 of plan). Every division via V0 template.
- **V2** `apps/analytics-service/src/infrastructure/clickhouse/query_gateway.py` — `query_metrics(workspace_id: str, definition_id, date_range, *, _client=...)`; `workspace_id` falsy → raise `UnscopedQueryError`; bound-param `WHERE workspace_id = %(workspace_id)s`; single entry-point.
- **V3** Two-workspace isolation test (seed ws_A+ws_B, query ws_A, assert ZERO ws_B + killed mutant: drop predicate → RED) + un-scoped-rejection test (`""`/`None` → raises).
- **V4** Single-writer 3-pattern static grep gate (SQL targets + Prisma camelCase model writes + raw-client-outside-gateway) + planted `prisma.workspaceDailyMetrics.upsert(...)` kill-test (→ RED) + analytics Postgres **read-only role startup assertion**.
- **V5** ClickHouse residency ap-south-1 startup assertion (refuse-to-start on mismatch).
- **V6** `packages/lib-metrics/src/registry/` — `MetricDefinition` records (TS); `display_only:true` on `blended_roas_x100`/`acos_bp`; `parity_class` tag; export from `index.ts`.
- **V7** Extend `tools/check-metrics-parity.sh` + `parity-runner.ts` for registry parity + Child-2 F3 (also assert `expected_minor_units`).
- **V8** Deploy artifact = the `migrations/clickhouse/README.md` runbook + read-only-role note for @jatin. NO new CI/ArgoCD change (analytics-service is existing Phase-0 deployable, no new live surface). Documented decision.

## 3. Track M — @maya (intelligence-engineer, co-owner)
- **M1** `pylibs/brain_metrics/brain_metrics/registry/` — byte-identity counterpart of V6; revenue ladder + CM1 + CM2/CM3 formulas; export from `__init__.py`.
- **M2** True-CM2 RTO-provision formula pinned IN FULL + `pamer`/`amer`/`ltv_cac` — `parity_gap:true`, `parity_class:"correctness_fixture"`, hand-calc worked examples (`CF-C4-DDR-TRUE-CM2-1`).
- **M3** 9-field DDR — `definitional_delta_register.py` (machine, drives the hook) + `.md` (Rohan signable) with ALL day-one rows (plan §10); two structural sign-off rules in code.
- **M4** ClickHouse round-trip fixtures (non-zero-remainder / zero-denominator / Float64-vs-FLOOR divergent) wired as the `intDiv` kill-test.
- **M5** `COGS_SETTINGS_CHANGE_DELTA` taxonomy category + coq-change-mid-day fixture (proves full-recompute = zero delta); audit `ROUNDING_MODE_MISMATCH` for `miscExpensesProrated` (Postgres ROUND_HALF_UP only, not a Float64 artifact).
- **M6** Wire `expected_definitional_delta` hook (taxonomy.py:166) to the DDR; route `parity_gap:true` to correctness-fixture gate; Child-2 N1 (clean stale `ratio.py` docstring).
- **M7** DDR row content: `CF-C4-DDR-MISC-PRORATE-1` Feb-boundary example + `CF-C4-DDR-GST-TAX-1` magnitude + `CF-C4-DDR-FX-RESTATEMENT-1` rate-pin (83.5).

## 4. Acceptance contract (REQUIRED — pass-1, shift-left; Security/QA must not have to bounce on these)
- [ ] `CF-C4-RATIO-DIVOP-1` — ZERO `/` in any MV body; `intDiv` + null-guard everywhere; CH round-trip fixtures present + the `/`-revert mutant goes RED.
- [ ] `CF-C4-PRORATED-DIVOP-1` — `misc_expenses_prorated_mu` uses `intDiv(.., toDaysInMonth(date))`; ROUNDING_MODE_MISMATCH audited.
- [ ] `CF-C4-COGS-MV-REFRESH-1` — `cogs_mu` full-recompute model; `COGS_SETTINGS_CHANGE_DELTA` category + fixture; zero delta proven.
- [ ] `CF-C4-SINGLE-WRITER-GREP-2` — 3-pattern grep (incl. Prisma camelCase) + planted-upsert mutant RED + read-only role startup assert. ZERO Brain write path to any legacy rollup table.
- [ ] `CF-C4-QUERY-SCOPE-ISOLATION-1` — two-workspace test (NOT single-workspace vacuous); un-scoped → raises; predicate-drop mutant RED.
- [ ] `CF-C4-RESIDENCY-1` — ap-south-1 startup assert, refuse-to-start on mismatch.
- [ ] `CF-C4-DDR-1` — 9 fields; the two structural sign-off rules enforced in code (parity_gap:true never "shadow GREEN"; non-null child_dependency never signed pre-dependency).
- [ ] `CF-C4-DDR-TRUE-CM2-1` / `-GST-TAX-1` / `-FX-RESTATEMENT-1` / `-MISC-PRORATE-1` — all day-one rows present with worked examples / magnitude / rate-pin / dependency markers.
- [ ] `CF-C4-VERIFY-THE-VERIFIER-1` — every high-stakes gate has a real-path integration test + a captured killed-mutant (the 3 gates in plan §9).
- [ ] `CF-C4-PARITY-SCOPE-1` — harness declares input source per run; legacy-sourced GREEN is not a cutover license.
- [ ] TS↔Python registry byte-identity GREEN via extended `check-metrics-parity.sh`; Child-2 F3 (`expected_minor_units` asserted) + N1 (docstring) landed.
- [ ] Paradigm `sql` — zero `@paradigm: haiku/sonnet/ml` anywhere in the metric path. Zero live DDL / live flip / legacy edit / git commit.

## 5. What stays HELD for Stage-8 (do NOT do this child)
Live ClickHouse DDL execution; the live read-source flip (legacy→Brain authoritative); `CACHE-PURGE-C4C5` firing; the analytics Postgres read-only role *provisioning* on the live DB (@jatin, Stage-8); Rohan's DDR signature (Stage-6 governance gate). This child builds + shadow-verifies only.
