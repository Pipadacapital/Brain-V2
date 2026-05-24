# QA Re-Review (Stage 5, Round 2) — feat-money-minor-units-parity (Child 2)

> Tanvi (qa-agent). Parallel review mode.
> Timestamp: 2026-05-24T18:50:00Z

| Field | Value |
|-------|-------|
| req_id | feat-money-minor-units-parity |
| Stage | 5 |
| Round | 2 (bounce-fix verification) |
| Mode | PARALLEL REVIEW (did not advance) |
| Verdict | **PASS** |
| Bounce target | NONE |

---

## Stage 4 Skip Acknowledgment

Stage 4 (Shreya) runs in parallel. This is round 2; only the two blocked findings are
re-verified. Mandatory secrets grep re-run on current staged diff:

  git diff HEAD~1 | grep -iE password|secret|api[_-]?key|bearer|aws_|ghp_
  git diff --cached | grep -iE password|secret|api[_-]?key|bearer|aws_|ghp_

Result: All matches are documentation or comment references in EOS pipeline artifacts.
No secret values committed. CLEAN.

---

## F1 Resolution: Single Canonical Fixture Source

Claim (bounce-fix): Stray outer tree deleted; gate script points to canonical package path;
find returns exactly one path.

### Independent verification

Step 1 — Only ONE golden_fixtures.json on disk:

  find /Users/rishabhporwal/Desktop/Brain -name "golden_fixtures.json"
  -> /Users/rishabhporwal/Desktop/Brain/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json

One result only. Outer pylibs/brain_metrics/parity/ directory tree completely absent
(find pylibs/brain_metrics/parity -type f returns nothing).

Step 2 — CI gate script reads canonical path (tools/check-metrics-parity.sh:22):

  FIXTURE_PATH="${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json"

Step 3 — harness.py default path (harness.py:32):

  _DEFAULT_FIXTURE_PATH = pathlib.Path(__file__).parent / "fixtures" / "golden_fixtures.json"
  Resolves to: pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json

Step 4 — test_harness.py explicit path (test_harness.py:618-619):

  fixture_path = pathlib.Path(__file__).parent.parent / "brain_metrics" / "parity" / "fixtures" / "golden_fixtures.json"
  Resolves to: pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json

Step 5 — inode equality:

  os.stat(default_path).st_ino == os.stat(explicit_path).st_ino  -> True
  default_path.resolve() == explicit_path.resolve()               -> True

Same inode. All three read paths converge on the identical file.

Step 6 — Canonical fixture structure:

  Groups: bankers_rounding_ties(6), negative_variants(7), sub_paise(3), zero(3),
          multi_currency_subunit(4), bigint_overflow_boundary(1), divergence_probe(1),
          high_volume_cogs(1), rounding_mode_mismatch_fixtures(2)
  Total fixtures: 28
  _meta.shared_by: ["pylibs/brain_metrics/brain_metrics/parity/fixtures/"]

_meta.shared_by corrected. rounding_mode_mismatch_fixtures present: rmm-1 (miscExpensesProrated,
brain_expected_mu=35715) and rmm-2 (cm3, brain_expected_mu=464285). divergence_probe present
(id: divergence-proof-probe-1).

F1 RESOLVED. C7 single-source-of-truth restored.

---

## F2 Resolution: TS FLOOR Mutation Proof

Claim (bounce-fix): Applied floor-to-truncate mutant; ran vitest filtered to new test;
test FAILED on mutant (-3333 != -3334); restored; 62 pass.

### Independent verification

Step 1 — New test present in money.test.ts (lines 339-346):

  it("negative ratio with remainder: -1/3 -> -3334 bp (FLOOR toward -inf, NOT truncate -3333)", () => {
    expect(ratioToBasisPoints(-1n, 3n)).toBe(-3334);
  });

Step 2 — Test passes on real code:

  vitest run -t "negative ratio with remainder" --reporter=verbose
  -> checkmark  ratioToBasisPoints > negative ratio with remainder: -1/3 -> -3334 bp (FLOOR toward -inf, NOT truncate -3333) 1ms
  Tests  1 passed | 61 skipped (62)

Step 3 — Mutation arithmetic verified independently:

  Real code, ratioToBasisPoints(-1n, 3n):
    scaled = -10000n
    quot   = -3333n  (JS BigInt truncation toward zero)
    rem    = -1n     (non-zero)
    remNeg=true, denNeg=false -> remNeg !== denNeg -> floored = -3333n - 1n = -3334n
    result = -3334    <- test expects -3334 -> PASS

  Mutant (sign-aware floor block at ratio.ts:28-33 removed):
    floored = quot = -3333n
    result = -3333    <- test expects -3334 -> FAIL

  Why round-1 gap existed: -1n/4n=-2500 is exact (rem=0n), floor block never entered;
  both real code and mutant return -2500. That test cannot kill the mutant.
  The new -1n/3n test has non-zero remainder with sign-flip; it KILLS the mutant.

  Mutation KILLED.

F2 RESOLVED. Mutation gap closed.

---

## REAL Suite Re-Run Results

### TypeScript (62 tests):

  Test Files  1 passed (1)
       Tests  62 passed (62)
    Duration  105ms

Verified: 62 passed, 0 failed. MATCHES.
tsc --noEmit: (no output) exit 0. Zero errors. MATCHES.

### Python (125 tests):

  ============================= 125 passed in 0.05s ==============================

Verified: 125 passed, 0 failed. MATCHES.
(Round 1 was 104; Maya bounce-fix added 21 tests: RMM taxonomy, ratio overflow, harness.)

### Parity gate (25/25):

  [parity-gate] Pre-flight checks...
    divergence probe fixture present: OK
  [parity-gate] Running Python side...
  [parity-gate] Running TypeScript side...
  [parity-gate] Comparing TS<>Python outputs...
    25 fixture vectors checked: all byte-identical. PASS.
  [parity-gate] PASS: TS<>Python byte-identity confirmed over all golden fixture vectors.
  [parity-gate] CF-QA-1.HARD satisfied.
  gate exit: 0

25/25 byte-identical. PASS.

---

## Flakiness — 3x Re-Run

TS:
  Run 1: 62 passed — 98ms
  Run 2: 62 passed — 95ms
  Run 3: 62 passed — 97ms

Python:
  Run 1: 125 passed in 0.04s
  Run 2: 125 passed in 0.04s
  Run 3: 125 passed in 0.04s

STABLE. Zero flakiness.

---

## Coverage (Post-Fix)

TS (--coverage):

  File          | % Stmts | % Branch | % Funcs | % Lines
  All files     |    87.5 |    79.62 |     100 |   88.46
   convert.ts   |   84.21 |     75.6 |     100 |   85.29
   ratio.ts     |   93.33 |     90.9 |     100 |   93.33

All above 70%. ratio.ts branch 81.81% -> 90.9% (F2 path now covered).

Python:
  TOTAL   185   5   97%

All above 70%.

---

## Regression Check

Secrets: CLEAN.
decimal.js: ABSENT (comment-only reference in convert.ts documenting rejection).
Legacy files: NONE staged or referenced.
Live read: NONE (pure value-object library).

---

## Metric Registry TS<>Python Parity

Byte-identity gate IS the metric registry parity check for this feature.
25/25 vectors, single canonical source confirmed. PASS.

---

## Findings Summary (Round 2)

| ID | Sev | Status | Evidence |
|----|-----|--------|---------|
| F1 | HIGH | RESOLVED | Single file (find+inode); gate+harness+test same inode |
| F2 | MEDIUM | RESOLVED | -1/3=-3334 test; mutation arithmetic proven; mutant KILLED |
| F3 | LOW | Deferred (unchanged) | Two-layer defence; no regression |

New findings: NONE.

---

## Gate Checklist (Round 2)

- PASS: Unit tests (125 py / 62 ts) — captured output above
- PASS: Integration (harness golden fixtures; single canonical source)
- PASS: Contract (TS<>Python byte-identity 25/25)
- N/A: E2E (no web/mobile surface)
- N/A: Load (Phase 0-1)
- PASS: Real-network smoke substitute (parity gate 25/25 exit 0)
- PASS: Metric registry TS<>Python parity (25 vectors)
- N/A: Trace IDs (no distributed call path)
- PASS: Operational readiness (no runtime; DDL gated)
- PASS: Mutation tests on high-stakes path (FLOOR mutant killed by -1/3 test)
- PASS: Coverage >=70% both langs (TS 87.5%/79.62%/100%; Py 97%)
- PASS: No flaky tests (3x stable)
- PASS: No legacy files staged
- PASS: Secrets clean
- PASS: F1 duplicate fixture trees RESOLVED
- PASS: F2 TS ratio FLOOR mutation gap RESOLVED

VERDICT: PASS

Mode: PARALLEL REVIEW — returning verdict to orchestrator; did NOT advance.
