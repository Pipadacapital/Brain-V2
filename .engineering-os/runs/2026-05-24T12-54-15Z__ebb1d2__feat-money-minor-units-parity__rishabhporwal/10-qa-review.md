# QA Review (Stage 5) — feat-money-minor-units-parity (Child 2)

> Tanvi (qa-agent). Parallel review mode.
> Timestamp: 2026-05-24T17:55:00Z

| Field | Value |
|-------|-------|
| req_id | feat-money-minor-units-parity |
| Stage | 5 |
| Mode | PARALLEL REVIEW (did not advance) |
| Verdict | BOUNCE |
| Bounce target | intelligence-engineer (Maya) + backend-developer (Vikram) |
| Blocking findings | F1 HIGH (duplicate fixture trees), F2 MEDIUM (TS ratio FLOOR mutation gap) |

---

## Stage 4 Skip Acknowledgment

Stage 4 (Shreya) ran in parallel. live.log already records Shreya BOUNCE (F1: duplicate divergent golden-fixture trees). This QA review is independent.

Secrets grep on commit diff (git diff HEAD~1):
Command: git diff HEAD~1 | grep -iE password|secret|api_key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_
Result: All matches are documentation/comment references, not committed secret values. CLEAN.

---

## REAL Test Results

### Python suite (104 tests)

============================= 104 passed in 0.04s ==============================

Claimed 104/104. Verified: 104 passed, 0 failed. MATCHES.

### TypeScript suite (61 tests)

 Test Files  1 passed (1)
      Tests  61 passed (61)
   Duration  94ms

Claimed 61/61. Verified: 61 passed, 0 failed. MATCHES.

### tsc --noEmit

$ tsc --noEmit
(no output)

Claimed: zero errors. Verified: zero errors. MATCHES.

### Flakiness (3x each)
TS: 61/61, 61/61, 61/61. Python: 104/104, 104/104, 104/104. STABLE.

---

## Coverage (REAL)

### TS
All files     |   85.71 |    77.77 |     100 |   86.53
 convert.ts   |   84.21 |     75.6 |     100 |   85.29
 ratio.ts     |   86.66 |    81.81 |     100 |   86.66

Stmts 85.71% / Branch 77.77% / Funcs 100% — all above 70%.

### Python
TOTAL    180   8   96%

96% total — above 70%.

---

## CF-QA-1.HARD Byte-Identity Gate

### Clean run output
[parity-gate] Pre-flight checks...
  divergence probe fixture present: OK
[parity-gate] Running Python side...
[parity-gate] Running TypeScript side...
[parity-gate] Comparing TS<>Python outputs...
  25 fixture vectors checked: all byte-identical. PASS.
[parity-gate] PASS: TS<>Python byte-identity confirmed over all golden fixture vectors.
[parity-gate] CF-QA-1.HARD satisfied.

### Drift injection (patched Python ROUND_HALF_EVEN -> ROUND_HALF_UP)
FAIL: 9 BYTE-IDENTITY DIVERGENCES found:
  id=mc-4: ts=500 py=501 delta=-1
  id=neg-1: ts=-123456 py=-123457 delta=1
  id=neg-3: ts=0 py=-1 delta=1
  id=neg-6: ts=-2 py=-3 delta=1
  id=neg-7: ts=0 py=-1 delta=1
  id=probe-1: ts=123456 py=123457 delta=-1
  id=tie-1: ts=123456 py=123457 delta=-1
  id=tie-3: ts=0 py=1 delta=-1
  id=tie-6: ts=2 py=3 delta=-1
Exit code: 1

Gate FAILS on implementation divergence. PROVEN NOT A NO-OP.

Architectural note: gate compares TS<>Python impl outputs; does NOT compare against expected_minor_units in fixture JSON. Correctness-against-expected is handled by unit test suites. Two-layer defense is correct.

---

## Mutation Sense-Check Results

| Mutation | Caught? | Evidence |
|----------|---------|---------|
| ROUND_HALF_EVEN to ROUND_HALF_UP in Python | YES | 9 parity gate divergences, exit 1 |
| Non-string TypeError guard disabled in TS | YES | Test "TypeError message names the anti-pattern" fails |
| ROUNDING_MODE_MISMATCH removed from taxonomy | YES | 2 harness tests fail (AttributeError) |
| FLOOR adjustment disabled in TS ratio negative-path | NO (GAP=F2) | All 61 TS tests pass. Parity gate would catch it but no unit test does. |

---

## CF-C2-* Contract Status

| CF-ID | Sev | Result |
|-------|-----|--------|
| CF-C2-STRING-API-1 | CRITICAL | VERIFIED |
| CF-C2-FIXTURE-PROOF-1 | HIGH | VERIFIED |
| CF-C2-RECON-TAXONOMY-1 | HIGH | VERIFIED |
| CF-C2-SUBUNIT-1 | MED | VERIFIED |
| CF-C2-FLOAT-COGS-1 | MED | VERIFIED |
| CF-C2-NEG-VECTORS-1 | LOW | VERIFIED |
| CF-QA-1.HARD | HIGH gate | VERIFIED (drift-injection proven) |
| CF-C2-PRIMITIVE-1 | must | VERIFIED |
| CF-C2-GOLDEN-1 | must | VERIFIED |
| CF-C2-NO-LIVE-1 | must | VERIFIED |
| CF-BN-NOLEGACY-1 | must | VERIFIED |

---

## Findings

### F1 — HIGH — MUST FIX NOW

Two divergent golden-fixture trees exist at different paths:

Path A (outer): pylibs/brain_metrics/parity/fixtures/golden_fixtures.json
  Used by: CI gate (check-metrics-parity.sh) + tools/parity-runner.py
  Probe ID: probe-1

Path B (inner/package): pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json
  Used by: harness.py _DEFAULT_FIXTURE_PATH + test_harness.py:503
  Probe ID: divergence-proof-probe-1

These are different fixture sets. The CI gate and Python harness/unit-tests run against different data. A fixture bug in one set would not be detected by tests using the other. C7 single-source-of-truth is violated.

Required fix: consolidate to one canonical file. Either the outer is a symlink to the inner, or the CI gate is updated to use the package path.

This matches Shreya F1.

### F2 — MEDIUM — MUST FIX NOW

TS ratioToBasisPoints negative-FLOOR mutation survives.

Implementation at ratio.ts:29-33 correctly adjusts floor for negative-remainder ratios. But TS tests only test -1n/4n=-2500 (exact, no remainder). Removing the floor adjustment: all 61 TS tests pass.

Python has: ratio_to_basis_points(-1, 3) == -3334 (floor, not truncate -3333). This test catches the mutation.

Required fix: add TS test for ratioToBasisPoints(-1n, 3n) to be -3334 (not -3333).

Conservative tie-break: ratioToBasisPoints is a high-stakes money primitive; any uncaught mutation here is must-fix-now.

### F3 — LOW — DEFER

Parity gate validates mutual consistency, not correctness against expected values. Acceptable given unit tests provide the correctness layer. Two-layer defense is adequate. Defer.

---

## Gate Checklist

- PASS: Unit tests (104 py / 61 ts)
- PASS: Integration (harness golden, injected drift FIRST_DIVERGENCE)
- PASS: Contract (goalType TS<>Python shape, byte-identity)
- N/A: E2E (no web/mobile surface)
- N/A: Load (Phase 0-1; COGS fixture covers pattern)
- PASS: Real-network smoke substitute (25/25 byte-identical gate, non-trivial)
- PASS: Metric registry TS<>Python parity (25 vectors)
- N/A: Trace IDs (no distributed call path)
- PASS: Operational readiness (no runtime; DDL gated in no-runner-scanned path)
- PARTIAL: Mutation (2/3 caught at unit; 3rd at gate but not unit)
- PASS: Coverage >=70% both langs
- PASS: No flaky tests (3x)
- PASS: No legacy files staged
- FAIL: F1 duplicate fixture trees (BLOCKING)
- FAIL: F2 TS ratio FLOOR test missing (BLOCKING — must-fix-now conservative tie-break)

VERDICT: BOUNCE

Mode: PARALLEL REVIEW — did not advance.
