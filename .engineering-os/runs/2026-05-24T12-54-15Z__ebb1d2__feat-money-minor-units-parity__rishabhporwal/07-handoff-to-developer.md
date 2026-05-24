# Handoff to Builders — feat-money-minor-units-parity (Child 2)

> Authored by Aryan (Architect), Stage 2. **Prescriptive** depth (high-stakes + foundational money primitive + scope-creep-prone). Binding companion to `06-architecture-plan.md`.
> Builders: **@vikram (backend-developer)** + **@maya (intelligence-engineer)** — run **in PARALLEL**. Both code to the locked §4 signatures.
> Timestamp: 2026-05-24T14:05:00Z

---

## 0. The one-paragraph mission

Ship the canonical **Money value object** + the **exact decimal-string conversion primitive** + the **comparator** + a **golden-fixture parity harness** that PROVES `SUM(legacy Decimal ×subunit_multiplier ROUND_HALF_EVEN) == SUM(Brain BIGINT)` at zero tolerance — built ONCE per language (`packages/lib-metrics` TS, `pylibs/brain_metrics` Python) as a byte-identity pair, CI-locked. **NO live data. NO legacy edit. NO backfill. NO metric definitions.** The single most important rule: **conversion takes a `string`, never a number; exact decimal-string arithmetic, never `Number(str)*100`, no `1e-10` epsilon.**

---

## 1. Hard boundaries (a violation = drift bounce by Shreya/Tanvi)

1. **ZERO live legacy-DB read, ZERO MU served to a user, ZERO backfill** (CF-C2-NO-LIVE-1). Fixtures are synthetic.
2. **`legacy project/` is reference-only** — read for logic, import/edit/commit NOTHING (CF-BN-NOLEGACY-1). `git status` at handoff must show only `.engineering-os/**`, `packages/lib-metrics/**`, `pylibs/brain_metrics/**`, `tools/check-metrics-parity.sh`, and `packages/lib-metrics`/`pyproject` dep manifests. ANY `legacy project/` diff fails Stage 4.
3. **Do NOT port the legacy `Number(decimalString)*100` float pattern** — the string-typed primitive is its Brain-native correction.
4. **No metric definitions, no CM waterfall, no OLAP materialization, no Definitional-Delta Register population** (Child 4). Only the `expected_definitional_delta` *hook* (present, unpopulated).
5. **No new npm/pip/uv dependency.** `decimal.js` is REJECTED (§16 of the plan) — conversion is an audited inline pure function. If you believe a dep is unavoidable, STOP and route back to Aryan (plan-amendment), do not add it.
6. **No commit without explicit Founder "commit it."** Feature-branch only.

---

## 2. Locked interface signatures (the contract — DO NOT change without a plan-amendment)

These are bound v1 internal contracts. Both builders code to these; they are the parallel-work contract. Verbatim in §4 of `06-architecture-plan.md`. Key load-bearing points:

- `decimalToMinorUnits(amount: string, subunitMultiplier: number): bigint` — **`amount` is `string`** (type-level rejection of number) + a runtime `TypeError` guard on `typeof !== "string"`. `subunitMultiplier` is **passed, never hardcoded 100**.
- Python `decimal_to_minor_units(amount: str, subunit_multiplier: int) -> int` — raise `TypeError` on non-str.
- `Money { minorUnits: bigint, currencyCode: string, subunitMultiplier: number }` (TS) / frozen dataclass (Python) — identical field set.
- `ratioToBasisPoints(numerator, denominator)` → INT32 `FLOOR(num*10000/den)`, throws on denominator 0.
- `GoalType = "money" | "ratio"`.

---

## 3. Acceptance contract — REQUIRED build-time items (shift-left; address in PASS 1, not via a review bounce)

Every `must-fix` below is a known risk a reviewer WILL bounce on. Fold it in now (system-prompt §11 self-review).

| ID | Sev | Owner | Acceptance criterion (binary) |
|----|-----|-------|-------------------------------|
| **CF-C2-STRING-API-1** | **must-fix (CRITICAL)** | Maya + Vikram (interface) | `decimalToMinorUnits` param is `string` in BOTH languages; TS rejects non-string at type level AND throws at runtime; implementation is exact decimal-string arithmetic (NO `Number()*100`); the `1e-10` epsilon is GONE; ONE conversion primitive per language (no `decimal.js`). |
| **CF-C2-FIXTURE-PROOF-1** | **must-fix (HIGH)** | Maya | A golden fixture exists that PASSES on the string path and FAILS (different BIGINT) on the `Number(str)*100` path; a test runs BOTH paths and asserts the divergence. **Without this, CI-green does not discharge the CRITICAL** — Tanvi will check for it explicitly. |
| **CF-C2-RECON-TAXONOMY-1** | **must-fix (HIGH)** | Maya + Vikram (report shape) | Harness has a 5th category `ROUNDING_MODE_MISMATCH` + the re-derivation rule + `rounding_mode_mismatches_count`; division-derived fields enumerated (`miscExpensesProrated`, `cm3`; audit `cogs`, `totalAdSpend`); a test asserts a `.X45` division-derived fixture classifies ROUNDING_MODE_MISMATCH (NOT BLOCKING_BUG). Designed now, populated at the live run. |
| **CF-C2-SUBUNIT-1** | **must-fix (MED)** | Vikram (contract) + Maya (semantics) | `Money` carries `subunit_multiplier` (default 100; KWD/BHD=1000, JPY=1); conversion + comparator read the field, never hardcode 100; a multi-currency test proves same input string → different MU per multiplier. |
| **CF-QA-1.HARD** | **must-fix (HIGH)** | Vikram | `tools/check-metrics-parity.sh` is a REAL gate: runs fixtures through both TS + Python, byte-compares BIGINT outputs, exits non-zero on a single divergence; turbo `//#check:metrics-parity` picks it up. |
| **CF-C2-FLOAT-COGS-1** | should-fix (MED) | Maya | High-volume COGS float-accumulation documented as a known harness artifact + a >10k-line-item fixture proving Brain's per-line-item integer path is exact. |
| **CF-C2-NEG-VECTORS-1** | should-fix (LOW) | Maya | Negative variants of all 6 banker's ties + negative sub-paise + negative zero in the fixture spec (before Tanvi's Stage-5 gate). |
| **CF-C2-PRIMITIVE-1** | must-fix (Single-Primitive) | both | One Money rep per language as a byte-identity pair; no TS-only/Python-only divergent rep. |
| goalType split (A1 #8) | required | Vikram | `GoalType = money\|ratio` in both registries + the typed `goalValue` rule; future column design-only in the runbook. |
| HOLD-AT-LIVE-RECON runbook | required | Vikram | Runbook skeleton + un-applicable migration DDL in a no-runner-scanned path + Stage-8-only README (mirror Child-1). NOTHING run. |

---

## 4. Parallelization

- **@maya** and **@vikram** start simultaneously. They share only the §4 locked signatures (a contract, not code).
- **Integration point:** Track V3 (CI byte-identity gate) consumes both bodies. The gate goes green once both `decimalToMinorUnits` (TS, Vikram-scaffolded/Maya-bodied) and `decimal_to_minor_units` (Python, Maya) land. Coordinate at that seam only.
- Maya owns: conversion bodies, Python side end-to-end, ratio/subunit logic, ALL fixtures, harness engine + taxonomy, numeric tests.
- Vikram owns: TS file homes/exports + Money object, goalType split, CI gate rewrite, runbook skeleton, TS tests.

---

## 5. Definition of Done (both builders, before handoff to Stage 4)

- [ ] All §3 `must-fix` criteria binary-PASS.
- [ ] `pnpm test` (TS) + Python tests green; `tools/check-metrics-parity.sh` exits 0 on matching fixtures, non-zero when a divergence is injected.
- [ ] The divergence-probe fixture FAILS on the number path (proof the CRITICAL is caught).
- [ ] `git status` shows ONLY the allowed paths (§1.2); zero `legacy project/` diff.
- [ ] Self-review against §3 done (shift-left); no known must-fix left for Security/QA to catch.
- [ ] No commit (await Founder "commit it").
