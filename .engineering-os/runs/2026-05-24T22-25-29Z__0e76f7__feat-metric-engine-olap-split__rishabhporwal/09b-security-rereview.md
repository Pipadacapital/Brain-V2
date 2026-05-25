# 09b — Security Re-Review (Stage 4, Round 2) — feat-metric-engine-olap-split (Child 4)

> Reviewer: Shreya (security-reviewer) · Mode: PARALLEL (Shreya ∥ Tanvi; orchestrator reconciles)
> Timestamp: 2026-05-25 · Lane: high-stakes (money, schema-proto, multi-tenancy, india-compliance)
> Round-1 verdict: **BOUNCE** (H-1). This round verifies the delta from `08b` (Maya) + `08c` (Vikram).
> Round-2 verdict: **PASS** — H-1 RESOLVED; the verify-the-verifier crux is independently confirmed.

---

## Scope of this re-review

Round-1 raised one blocking finding (H-1) plus two non-blocking MED items. This round:
1. Re-verifies H-1 RESOLVED by reading the **actual files** (not the bounce-fix reports).
2. Independently confirms the new registry-parity gate is **genuinely non-vacuous** (CF-C4-VERIFY-THE-VERIFIER-1) by mutating the **real** `definitions.ts` on disk — not trusting the inline self-test.
3. Confirms M-1/M-2 disposition.
4. Regression-scans Vikram's edits (secrets, legacy, DDL/flip, single-writer, float).

Everything that PASSED round-1 (CF-C4-RATIO-DIVOP-1, PRORATED-DIVOP, COGS-MV-REFRESH, SINGLE-WRITER, QUERY-SCOPE-ISOLATION, RESIDENCY structure, DDR 9-field structure, PARITY-SCOPE, paradigm-sql, zero-live-DDL) is unchanged by this bounce-fix and is not re-litigated; the bounce-fix touched only the TS registry, its tests, the registry/DDR dump tooling, the parity gate, and the analytics orchestrator test.

---

## H-1 — TS↔Python↔DDR registry formula divergence — **RESOLVED**

**Verified against the actual files** (`packages/lib-metrics/src/registry/definitions.ts`,
`pylibs/brain_metrics/brain_metrics/registry/definitions.py`,
`pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py`):

| Metric | TS `clickhouse_sql` | Python `clickhouse_sql` | DDR `formula_snapshot` | Match |
|---|---|---|---|---|
| `true_cm2_mu` | `if(total_orders_count > 0, toInt64(cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu), total_orders_count)), NULL)` | same (whitespace-normalized) | cost-base-proportional, pinned in full | **YES** |
| `pamer_bp` | `if(total_ad_spend_mu > 0, intDiv(cm2_mu * 10000, total_ad_spend_mu), NULL)` | same | `pamer_bp = intDiv(cm2_mu * 10000, total_ad_spend_mu); NULL if ...` | **YES** |
| `amer_bp` | `if(total_ad_spend_mu > 0 AND total_orders_count > 0, intDiv((cm2_mu - intDiv(rto_orders * (...), total_orders_count)) * 10000, total_ad_spend_mu), NULL)` | same | `amer_bp = intDiv(true_cm2_mu * 10000, total_ad_spend_mu); true_cm2_mu = ...` | **YES** |
| `ltv_cac_bp` | `if(cac_mu > 0, intDiv(ltv_mu * 10000, cac_mu), NULL)` | same | `ltv_cac_bp = intDiv(ltv_mu * 10000, cac_mu); NULL if ...` | **YES** |

- **`ltv_cac_x100` absent everywhere.** `grep` across TS definitions/index/exports, Python registry, and DDR returns
  only the legitimately-named `blended_roas_x100` (display_only) metric id. No `ltv_cac_x100` in any artifact.
  TS now exports `LTV_CAC_BP` (id `ltv_cac_bp`, unit `bp`, ×10000). The id mismatch that proved the round-1 gate
  was vacuous no longer exists.
- **Intra-TS prose corrected:** TS comments now say "paMER = CM2 / Total Ad Spend" (matches Python docstring);
  the reciprocal contradiction is gone.
- **The 4 ids align across all three: brain_formula ids in the DDR (`true_cm2_mu`/`pamer_bp`/`amer_bp`/`ltv_cac_bp`)
  match both registries; both registries mark them `parity_class: correctness_fixture`.**

The four Brain-native decision metrics now have **one canonical formula each, identical across TS registry,
Python registry, and the Rohan-signable DDR `formula_snapshot`.** The money/governance-integrity breach is closed.

---

## CF-C4-VERIFY-THE-VERIFIER-1 — the crux — **SATISFIED (independently confirmed)**

The round-1 bounce was, at root, a *vacuous verifier*: the step-6 "registry seam" check asserted only directory
presence. The fix had to make that gate genuinely catch divergence. **I did not trust the inline self-test (6b);
I mutated the real source on disk and ran the gate.**

**Clean run (baseline):** `tools/check-metrics-parity.sh` → exit 0. Phase-1 structural (16 shared metrics),
Phase-2 SQL equality on all 4 correctness_fixture metrics, Phase-3 DDR formula_snapshot coverage — all PASS.

**Independent mutation A — corrupt the REAL `true_cm2_mu` clickhouse_sql** (replaced with the old flat-per-order
`cm2_mu - (rto_orders * avg_rto_cost_per_order_mu)`):
→ Gate **exit 1**, `CORRECTNESS_FIXTURE SQL DIVERGENCE id='true_cm2_mu'` (Phase 2 fired). **KILLED.**

**Independent mutation B — rename the REAL `ltv_cac_bp` id → `ltv_cac_x100`** (the exact false-GREEN the round-1
vacuous gate missed): → Gate **exit 1**, `MISSING DDR ROW id='ltv_cac_x100'` (Phase 3) + `ltv_cac_bp` falls out of
the shared set (Phase 1). **KILLED.** This is decisive: the precise divergence class that escaped round-1 now turns
the gate RED.

**Restore → exit 0**, working tree pristine (`git diff` empty; staged file confirmed canon `ltv_cac_bp`).

The inline 6b self-test mutants (wrong pamer SQL; ltv id-rename) were also observed to kill on the live dumps.
The gate is non-vacuous. The dump helpers (`registry-dump.ts`, `registry-dump.py`, `ddr-dump.py`) import the actual
registries/DDR and emit the comparison fields — pure stdout, no network/write/exec.

**TS test correction verified:** the round-1 tautological pin (`registry.test.ts:204-216`, which pinned the divergent
TS formulas as "correct") is **removed**. The new `LOCKED CANON` describe block asserts canon worked examples
(true_cm2=6620000p; pamer=16000bp; amer=13240bp; ltv_cac=30000bp) and each metric has a real KILL test confirming
the old wrong formula produces a *different* number, plus `expect(METRIC_REGISTRY).not.toHaveProperty('ltv_cac_x100')`.
These are assertions against the implementation, not self-consistent tautologies.

---

## Test + build evidence (re-run by me, not trusted from reports)

| Suite | Result |
|---|---|
| `packages/lib-metrics` vitest (scoped) | **102 passed** |
| `pylibs/brain_metrics` pytest | **291 passed** |
| `apps/analytics-service` pytest | **41 passed** |
| **Total** | **434 passed, 0 failed** |
| `tsc --noEmit` (lib-metrics) | **exit 0 (clean)** |
| `tools/check-metrics-parity.sh` (clean) | **exit 0** |
| parity gate under mutation A / B | **exit 1 (RED) both times → restore exit 0** |

(Note: a repo-root `vitest run` also sweeps 4 `legacy project/**` test files that error "No test suite found" —
pre-existing legacy noise, out of Child-4 scope, not introduced by this bounce-fix. The Child-4 TS suite is clean
when scoped to `packages/lib-metrics`.)

---

## Regression scan on Vikram's bounce-fix edits

- **Secrets:** none in any bounce-fix file (definitions.ts, registry.test.ts, index exports, dumpers, gate, analytics test). CLEAN.
- **Legacy edits (CF-BN-NOLEGACY-1):** zero `legacy project/**` files staged. CLEAN.
- **Live DDL / flip:** the bounce-fix touched no ClickHouse migration or service config; the SQL migrations in the staged
  set are the round-1 runbook-gated set (no execution). No new destructive DDL. CLEAN.
- **Single-writer:** `_SCAN_PATHS` unchanged (`analytics-service/src` + `lib-metrics/src`); the new `tools/` dumpers are
  pure-compute stdout (no write path), so the M-1 risk profile is unchanged. Single-writer invariant intact.
- **Float in metric path:** none. The new true_cm2 / amer divisions are `bigint / bigint` (integer FLOOR, equivalent to
  ClickHouse `intDiv`); `ratioToBasisPoints` is BigInt FLOOR. No `parseFloat`/`toFixed`/`Math.floor` on money cols.
- **New analytics orchestrator tests:** genuinely exercise the exit-1 paths via `pytest.raises(SystemExit)` for
  wrong-region / missing-host / missing-DSN — real coverage (78%), not vacuous padding.

---

## MED findings — disposition (unchanged; non-blocking tech debt)

- **M-1 (MED) — single-writer grep scope** does not cover `pylibs/brain_metrics/**` or `tools/`. Bounce-fix added new
  pure-stdout dumpers to `tools/` (no write path), so no active risk introduced. The DB read-only-role startup assert
  remains the structural backstop. Still MED, still non-blocking. Recommend adding `pylibs/brain_metrics` + future
  metric-writing services to `_SCAN_PATHS` opportunistically.
- **M-2 (MED) — residency marker substring** (`ap-south-1`/`aps1` substring) unchanged. Realistic misconfiguration is
  still correctly rejected; `CLICKHOUSE_HOST` is operator-controlled deploy config, not attacker input. Still MED,
  still non-blocking. Recommend anchoring the marker to a region-suffix position.

Neither was required to clear the bounce, and neither was regressed.

---

## Compliance

- **DPDP residency:** PASS — ClickHouse ap-south-1 refuse-to-start assert present (M-2 hardening note only).
- **DPDP minimization / PII:** PASS — metric path is aggregate integers (workspace_id + date + money/ratio µ); no PII.
- **Telecom (DLT/NCPR/WhatsApp/9–9 window/recording consent):** N/A — no outbound channel, no customer-contact path.
- **No compliance VETO.**

---

## Traceability

Unchanged from round-1: this is a shadow service with no live serving path (no REST/tRPC/gRPC, no Kafka consumer,
DDL runbook-gated). The query-gateway is the single read entry-point and is structured-logging instrumented on the
UnscopedQueryError path with `workspace_id` + `definition_id` + date range. No request flow in the diff lacks a
correlation ID because there is no live request flow yet. **No missing-traceability VETO.** When Child-5/6 wire
`query_metrics` behind a live endpoint, the `request_id`+`trace_id`+`workspace_id`+`user_id` contract must be
propagated into the gateway call and onto error responses — noted for the downstream child.

---

## Cross-req staging note (non-blocking, re-flagged)

The staged set still co-mingles `feat-connector-framework-cutover` (Child-3, run `c7fed9`: `apps/ingestion-service/**`,
`protos/`) with this Child-4 set. This review is scoped to Child-4 files only. The orchestrator/Founder should split
the commit by req so the Child-4 PR does not carry Child-3 code. Hygiene flag, not a security finding.

---

## Gate (G4) — PASS conditions

- [x] Zero CRITICAL
- [x] Zero HIGH — H-1 RESOLVED (verified across all three artifacts)
- [x] Zero compliance violations (DPDP residency PASS; telecom N/A)
- [x] Zero missing-traceability (shadow service; no live path)
- [x] Registry-parity verifier genuinely non-vacuous — independently killed two on-disk mutants (the crux)
- [x] No money-integrity regression (bigint FLOOR; intDiv on every ratio)
- [x] No secrets / legacy edits / live DDL / single-writer regression
- [x] Scans + suites captured (434 tests pass; tsc clean; gate exit 0; mutants RED)

MED M-1 / M-2 logged as tech debt; non-blocking.

---

## Decision

**SECURITY: PASS.** H-1 is fully resolved — the four Brain-native decision metrics are now defined identically across
the TS registry, the Python registry, and the Rohan-signable DDR `formula_snapshot`, and the registry-parity gate that
must guarantee that is now genuinely non-vacuous, proven by two independent on-disk mutations that turn it RED
(including the exact `ltv_cac_x100` id-rename false-GREEN that escaped round-1). No CRITICAL/HIGH, no compliance
violation, no traceability gap, no regression.

**Parallel mode:** verdict returned to the orchestrator for reconciliation with Tanvi. I do **not** advance the stage.
