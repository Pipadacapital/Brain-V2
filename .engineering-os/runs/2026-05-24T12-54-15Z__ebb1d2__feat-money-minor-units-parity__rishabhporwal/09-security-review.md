# 09 — Security Review (Stage 4) — feat-money-minor-units-parity (Child 2)

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Stage** | 4 (security) |
| **Reviewer** | Shreya (security-reviewer) |
| **Mode** | **parallel-review (did not advance)** — Tanvi reviews concurrently |
| **Timestamp** | 2026-05-24T (Stage 4) |
| **Verdict** | **BOUNCE** → backend-developer (Vikram) |
| **Gate (G4)** | FAIL — 1 HIGH (must-fix-now) on the C7 billing-base parity gate |

---

## Change-class scope declaration (FIRST)

**Class: money / numeric-type foundation library + parity gate (high-stakes; correctness-as-security).**
This child ships a pure deterministic value-object + conversion + parity-harness foundation in
`packages/lib-metrics` (TS) and `pylibs/brain_metrics` (Python), plus the CI byte-identity gate
and a HOLD-gated live-reconciliation runbook skeleton. It underpins the realized-GMV billing base.

| Surface | In scope? | Result |
|---|---|---|
| ALWAYS-ON: vuln scans / secrets-grep / supply-chain / input-validation | YES | PASS (see §Scans) |
| ALWAYS-ON: minor-units / no-float / no-LLM-numbers on money-derived code | YES | PASS (the heart of this review) |
| Multi-tenancy (4-layer workspace_id) | N/A — no DB/endpoint/data-access surface this child | N/A |
| Mutation endpoints / RBAC / Zod | N/A — no network/API surface | N/A |
| MCP tools / agent-emitted actions | N/A — no agent/LLM surface | N/A |
| Connector OAuth / webhook signature | N/A — no connector | N/A |
| Outbound channel compliance (DLT/NCPR/9-9/WhatsApp/AI-voice/recording) | N/A — no outbound/PII/consent surface | N/A |
| India DPDP / PDPL / residency / PII-in-logs | N/A — no PII, no logs, no live data; synthetic fixtures only | N/A |
| Traceability (request_id+trace_id+workspace_id+user_id) | N/A — pure deterministic library; no endpoint/consumer/gRPC/Kafka/LLM code path | N/A |

Scope-bleed note: the staged set ALSO contains `apps/core-service/**` + the
`feat-tenancy-rls-brain-native` run folder (RLS hardening — a different feature, co-staged on this
branch). Those are OUT OF SCOPE for this money review and were reviewed under their own run. This
review gates ONLY the `packages/lib-metrics/**`, `pylibs/brain_metrics/**`, `tools/check-metrics-parity.sh`,
`tools/parity-runner.py`, and the lockfile delta.

---

## Focus-item verification (verified by me with captured output — not trusting the reports)

### 1. CF-C2-STRING-API-1 (CRITICAL) — string-in, exact arithmetic — **PASS**
- TS `convert.ts:26` `decimalToMinorUnits(amount: string, subunitMultiplier: number): bigint` — typed `string`; runtime guard `convert.ts:28` throws `TypeError` naming CF-C2-STRING-API-1 on non-string.
- Python `convert.py:23` `decimal_to_minor_units(amount: str, subunit_multiplier: int) -> int`; `isinstance` guard `convert.py:60` raises `TypeError`.
- Grep for `Number(...)*` / `parseFloat` / `1e-10` in production conversion: **none in the arithmetic path**. (`ratio.ts:36 Number(floored)` is a final BigInt→int cast on an already-floored value for an INT32 field — not float arithmetic; acceptable.)
- Python uses `Decimal(amount)` natively (no `float()`, no `Decimal(float)`) — exact rational arithmetic.
- TS uses pure-BigInt decimal-string parsing + ROUND_HALF_EVEN remainder comparison; no IEEE-754 in the value path.
- Non-string rejection tested + green in both suites (`null`/`undefined`/number → TypeError).

### 2. Exact-equality integrity + divergence probe + ROUND_HALF_EVEN — **PASS (with a deferred-design gap, see F2)**
- Comparator `harness.py:59` is `legacy_mu == brain_mu` — true integer equality, **zero tolerance band**. No epsilon anywhere in production code (only doc/comment mentions of "no epsilon").
- Divergence probe is GENUINE (not epsilon coincidence): `money.test.ts` proves `"100.005"` → string `10000n` (ROUND_HALF_EVEN, even floor) vs legacy `Math.round(Number()*100)` = `10001` (ROUND_HALF_UP). Structural ROUND_HALF_EVEN-vs-ROUND_HALF_UP bias, not a bit-pattern accident. Second probe `"2764.505"` confirms; odd-tie control `"100.015"` confirms specificity.
- ROUND_HALF_EVEN correct incl. negatives + JPY: verified live — PY `0.5×1=0`, `1.5×1=2`, `2.5×1=2`; negatives mirror (`-1234.565→-123456`).

### 3. subunit_multiplier — no hardcoded 100 — **PASS**
- Conversion reads the passed `subunitMultiplier`/`subunit_multiplier`; no literal `100` in the arithmetic. `Money` carries the field; `subunitMultiplier()` lookup is the single source. Multi-currency (INR/KWD/JPY) byte-identical across langs (`1.255` → 126/1255/—).

### 4. Billing-base trust — 5-category taxonomy suppression check — **PASS for shipping (no real BLOCKING_BUG can be suppressed), but see F2 (taxonomy design defect)**
- The classifier fails SAFE: the ROUNDING_MODE_MISMATCH branch is **unreachable** as wired, so EVERY division-derived mismatch falls through to BLOCKING_BUG. No real drift is ever suppressed/misclassified into a non-blocking bucket. Financial-integrity-wise, the gate over-blocks rather than under-blocks. ✅ (The flip side is F2: the anti-phantom-freeze PURPOSE of CF-C2-RECON-TAXONOMY-1 is not achieved — deferred.)

### 5. No-legacy-edit (CF-BN-NOLEGACY-1) — **PASS**
- `git diff --cached --name-only | grep -i "legacy project"` → **empty**. No legacy float pattern ported (the string path is the Brain-native correction).

### 6. No live data / gated migration — **PASS**
- No `psycopg`/`prisma`/`pg`/`requests`/`http`/`boto3` in money code. All fixtures synthetic.
- `column-migration-skeleton.sql`: **every line is a comment or blank** (verified — zero executable statements). `live-reconciliation-runbook.md` is HOLD-AT-LIVE-RECON, all steps pseudocode, `BLOCKING_BUG → STOP`. Nothing applied.

### 7. Dependencies / supply chain — **PASS**
- No `decimal.js` / `bignumber` / `big.js` in `pnpm-lock.yaml` or anywhere. Only `tsx@4.22.3` (devDependency CLI runner) + vitest/coverage tooling added.
- `pnpm audit --prod`: **No known vulnerabilities found.**
- Python lib is **stdlib-only** (`decimal`, `json`, `pathlib`) — zero third-party runtime deps; supply-chain surface effectively nil. (`pip-audit`/`safety` not installed in env; noted — dependency surface is stdlib, so risk is negligible.)

### 8. Secrets + traceability — **PASS / N/A**
- Secrets grep across money code: clean. Traceability: N/A (pure library, no runtime code path; correlation-ID does not apply to this surface).

---

## Scans (captured)

- `pnpm audit --prod` → **No known vulnerabilities found.**
- Secrets grep (`packages/lib-metrics/src`, `pylibs/brain_metrics/brain_metrics`, tools) → clean.
- `pytest` → **104 passed**. `vitest` → **61 passed**. `tools/check-metrics-parity.sh` → **exit 0, 25/25 byte-identical**.
- `pip-audit` / `safety` → not installed in env; Python lib has zero third-party runtime deps (stdlib only).

---

## Findings

### F1 — HIGH (must-fix-now) — Duplicate, ALREADY-DIVERGENT golden-fixture trees; CI gate and unit tests read DIFFERENT files
**Where:** `pylibs/brain_metrics/parity/**` (stray top-level copy) vs `pylibs/brain_metrics/brain_metrics/parity/**` (the importable package copy).
**Evidence (captured):**
- `tools/check-metrics-parity.sh:22` reads the **top-level** copy: `pylibs/brain_metrics/parity/fixtures/golden_fixtures.json`.
- `harness.py:32` (`pathlib.Path(__file__).parent`) + `parity-runner.py` import resolves to the **package** copy: `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`.
- `diff` of the two fixture files → **they already differ** (`id: "probe-1"` in the gate copy vs `"divergence-proof-probe-1"` in the package copy).
- `brain_metrics.parity.harness.__file__` resolves to the **package** copy (the top-level copy is NOT importable as `brain_metrics.parity`).
**Why HIGH on a billing-base gate:** the C7 money-parity gate exists to be the single source of truth that Brain's integer money equals legacy Decimal money exactly. Two divergent copies of the golden vectors — with the gate reading one and the tests reading the other — means a future edit to the "real" (package) golden set will NOT be seen by the CI gate, and vice versa. The single-source-of-truth invariant of the C7 gate is broken at birth, and the two copies have ALREADY drifted. Conservative tie-break (rubric) → must-fix-now. (Current numeric outputs still agree, so no wrong number ships today; this is a structural integrity defect, not a present miscalculation — hence HIGH not CRITICAL.)
**Remediation:** Delete the stray top-level `pylibs/brain_metrics/parity/` tree entirely. Point `check-metrics-parity.sh:22` at the package copy `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json` (the same file the harness/tests use). One golden file, one tree, read by both the gate and the tests.

### F2 — MED (defer to Child-4, before any live recon) — ROUNDING_MODE_MISMATCH re-derivation rule is a tautology / dead code
**Where:** `taxonomy.py:181-202` (`re_derive_legacy_via_brain_path`) + `taxonomy.py:252-271` (`classify_mismatch` RMM branch).
**Evidence:** `re_derive_legacy_via_brain_path(legacy_decimal, mult)` is literally `decimal_to_minor_units(legacy_decimal, mult)` — the SAME function and input used to compute `legacy_mu` at `taxonomy.py:233`. `classify_mismatch` is only reached when `legacy_mu != brain_mu`. Therefore `brain_path_result (== legacy_mu) == brain_mu` is **always False** → the RMM branch never fires from `run_harness()` or `classify_mismatch()`. The category is exercised in tests ONLY by hand-constructing a `MismatchRecord(category=ROUNDING_MODE_MISMATCH)` directly (`test_harness.py:404-417`), bypassing the classifier. The `test_harness.py:138-360` block itself contains ~200 lines of the author reasoning in circles confirming the branch can't fire. Fixtures `rmm-1`/`rmm-2` PASS as trivial equalities (legacy_mu == brain_mu), not as RMM classifications; `rmm-2.legacy_mu_if_brain_path: 464285` is unused dead data.
**Impact:** Fails SAFE (never suppresses a real BLOCKING_BUG — see Focus #4 PASS). BUT CF-C2-RECON-TAXONOMY-1's stated purpose — preventing a phantom .X45 division-derived BLOCKING_BUG from freezing the first live reconciliation — is NOT achieved. At the live run, those phantom deltas will classify BLOCKING_BUG and freeze recon, the exact failure this CF was created to prevent.
**Why MED not HIGH this child:** no live recon runs here (HOLD-AT-LIVE-RECON, design-only); it fails safe; Child-4 wires the live fixture builder and must revisit this path regardless. Must be fixed before the Stage-8 live recon ceremony.
**Remediation:** Re-derivation must compare against an INDEPENDENT legacy path. The contract intent: `legacy_mu` = the value the LIVE harness reads from the legacy Postgres column (already ROUND_HALF_UP-rounded at write time); `re_derive` = Brain's ROUND_HALF_EVEN re-derivation of the same source. These must be two distinct computations for the rule to discriminate. Add a real RMM fixture where `legacy_mu != brain_mu == re_derive` so the classifier branch is actually executed and asserted.

### F3 — MED — Parity gate cross-checks TS==Python only; never validates against `expected_minor_units`
**Where:** `tools/check-metrics-parity.sh:117-160`, `parity-runner.{ts,py}`.
**Evidence:** Both runners emit `{id, result}`; the gate compares TS result vs Python result. Neither compares against the golden `expected_minor_units`. A bug present IDENTICALLY in both engines (e.g. both rounding the same wrong way) passes the gate silently.
**Impact:** Mitigated — the per-language unit tests DO assert each result against `expected_minor_units` (verified: 104 Py + 61 TS green), and both run in CI. So the golden values ARE validated, just in the unit-test layer, not the cross-lang gate. Defense-in-depth gap on a billing-base gate.
**Remediation:** Have the gate also assert each engine's result == `expected_minor_units`, not only TS==Python. Cheap, closes the "both-wrong-identically" hole.

### F4 — LOW — Ratio overflow behavior diverges cross-language
**Where:** `ratio.ts:37-39` throws `RangeError` on INT32 overflow; `ratio.py:63-66` **clamps** to INT32_MAX/MIN.
**Impact:** Latent TS↔Python parity hole for ratio fields (different behavior on overflow). Not exercised by any shared fixture (ratio isn't in golden_fixtures), so the parity gate doesn't catch it. No present impact; flag before ratio fields enter the byte-identity gate (Child-4).
**Remediation:** Pick ONE behavior (clamp or throw) and make both langs identical; add a ratio-overflow parity fixture.

### F5 — LOW (informational) — `convert.ts:53` derives exponent via `Math.round(Math.log10(subunitMultiplier))` (float op in the money path)
**Impact:** Safe in practice (inputs validated as positive integers; `Math.round` corrects log10 float error for powers of 10). Python uses a different algorithm (`Decimal` quantize, no log10). Cosmetic float-in-money-path smell; outputs proven byte-identical on all 25 vectors.
**Remediation (optional):** Derive exponent from the multiplier by integer means (e.g. count trailing zeros / string length) to keep the money path 100% float-free by construction.

---

## CF-C2-* security map (every constraint → code/test)

| CF-id | Sev | Status | Code / test evidence |
|---|---|---|---|
| CF-C2-STRING-API-1 | CRITICAL | PASS | `convert.ts:26,28`; `convert.py:23,60`; non-string-rejection tests green; no `Number()*100`/`1e-10` (grep) |
| CF-C2-RECON-TAXONOMY-1 | HIGH | PARTIAL (F2 MED) | 5 categories + `rounding_mode_mismatches_count` + `DIVISION_DERIVED_FIELDS` present; **re-derivation rule is dead code** (F2) — non-blocking this child, must fix before live recon |
| CF-C2-FIXTURE-PROOF-1 | HIGH | PASS | `money.test.ts` "100.005"/"2764.505" probes diverge string vs Math.round; control odd-tie agrees |
| CF-C2-SUBUNIT-1 | MED | PASS | `subunits.{ts,py}` lookup; `Money.subunitMultiplier`; conversion reads it, no hardcoded 100; multi-currency byte-identical |
| CF-C2-FLOAT-COGS-1 | MED | PASS | `golden_fixtures.json::high_volume_cogs` + `test_harness.py::TestHighVolumeCogsAccumulation`; Brain per-item integer path exact |
| CF-C2-NEG-VECTORS-1 | LOW | PASS | 7 negative fixtures + negative-tie tests both langs |
| CF-C2-PRIMITIVE-1 | MUST | PASS | one impl per lang; `__init__.py`/`index.ts` single home |
| CF-C2-NO-LIVE-1 | MUST | PASS | no DB/network; migration DDL fully commented; runbook HOLD-gated |
| CF-BN-NOLEGACY-1 | MUST | PASS | zero `legacy project/` staged; no float pattern ported |
| CF-QA-1.HARD | HIGH | PASS (caveat F3) | parity gate 25/25 byte-identical; golden values validated in unit tests (not in the cross-lang gate — F3) |
| goalType split (A1 #8) | — | PASS | `goal-type.ts`, `goal_type.py` (StrEnum) |

---

## Gate (G4) result

- CRITICAL: **0** ✅
- HIGH: **1** ❌ (F1 — duplicate divergent golden source on the billing-base gate; must-fix-now)
- MED: 2 (F2, F3 — logged; F2 must fix before Stage-8 live recon)
- LOW: 2 (F4, F5 — tech debt)
- Compliance: **N/A** (no PII/channel/consent/residency surface) — no violation
- Traceability: **N/A** (no runtime code path)
- Vuln scans: **CLEAN** on CRITICAL/HIGH

**Verdict: BOUNCE** (one HIGH ships → veto). The money primitive itself (CF-C2-STRING-API-1) is excellent and ships-clean; the bounce is the duplicate/divergent golden-fixture tree that breaks the single-source-of-truth of the C7 billing-base gate.

---

## HANDOFF

- `verdict: BOUNCE`
- `bounce_target: backend-developer` (Vikram — owns `tools/check-metrics-parity.sh` + the TS package homes / parity tooling that introduced the duplicate tree)
- `mode: parallel-review (did not advance)` — returned to orchestrator; Tanvi's QA review reconciled separately
- Blocking finding: **F1 (HIGH)**. Recommended same-pass cleanup: F2/F3 (MED).
