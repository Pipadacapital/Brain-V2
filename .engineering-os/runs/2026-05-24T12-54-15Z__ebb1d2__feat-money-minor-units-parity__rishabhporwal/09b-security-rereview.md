# 09b — Security RE-REVIEW (Stage 4, round 2) — feat-money-minor-units-parity (Child 2)

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Stage** | 4 (security) — round 2 re-review |
| **Reviewer** | Shreya (security-reviewer) |
| **Mode** | **parallel-review (did not advance)** — returned verdict to orchestrator; Tanvi round-2 QA reconciled separately |
| **Round-1 verdict** | BOUNCE (F1 HIGH; F2 MED partial; F4/F5 LOW) — see `09-security-review.md` |
| **Round-2 verdict** | **PASS** |
| **Gate (G4)** | PASS — 0 CRITICAL, 0 HIGH, 0 compliance violations, 0 missing-traceability |

## Scope of this re-review
Delta-only, per parallel re-review protocol. I re-verified the two bounced findings (F1 HIGH, F2 MED)
and the two LOWs (F4, F5), then regression-scanned the fixers' edit surface
(`convert.ts`, `convert.py`, `ratio.py`, `ratio.ts`, `taxonomy.py`, `golden_fixtures.json`,
`check-metrics-parity.sh`, `parity-runner.{py,ts}`, `money.test.ts`, `test_harness.py`).
Accepted-PASS surfaces from round 1 (CF-C2-STRING-API-1, SUBUNIT, FLOAT-COGS, NEG-VECTORS,
PRIMITIVE, NO-LIVE, NOLEGACY) were NOT re-reviewed in full — only regression-scanned for new defects.
I did not trust the builder reports; every claim below is backed by output I captured myself.

## Compliance + traceability (restated)
- **Compliance: N/A** — no PII, no outbound channel, no consent/DLT/NCPR/calling-window/WhatsApp/AI-voice/recording surface; no live data (synthetic fixtures only). No violation possible on this surface.
- **Traceability: N/A** — pure deterministic library; no endpoint / Kafka consumer / gRPC / LLM / frontend request code path. Correlation-ID contract does not apply.
- **Residency: N/A** — no data store, no cross-border movement; fixtures are synthetic in-repo.

---

## Per-finding resolution

### F1 — HIGH (round 1) — Duplicate / divergent golden-fixture trees → **RESOLVED**
Evidence I captured:
- `find pylibs -name golden_fixtures.json` → **exactly one** result: `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`. The stray top-level `pylibs/brain_metrics/parity/` tree is absent on disk **and** absent from the git index (`git ls-files` shows no parity files outside the package path; nothing staged under the stray path).
- `tools/check-metrics-parity.sh:22` `FIXTURE_PATH` now points at the canonical package path; lines 72 & 105 pass it as **argv** to both runners.
- `tools/parity-runner.py` reads `sys.argv[1]` (mandatory; exits 1 if absent). `_REPO_ROOT` is used ONLY to add the package to `sys.path` for the `brain_metrics` import — it is NOT a fixture fallback. No stray-path fallback anywhere.
- `packages/lib-metrics/src/parity-runner.ts` reads `process.argv[2]`.
- `harness.py` default `_DEFAULT_FIXTURE_PATH = Path(__file__).parent/"fixtures"/"golden_fixtures.json"` resolves (proven concretely) to the **same** canonical file the gate uses.
- Repo-wide grep for any `brain_metrics/parity/fixtures` reference NOT under the canonical `brain_metrics/brain_metrics/parity` path → **none**.
- `_meta.shared_by` corrected to the canonical package path (round-1 stale top-level reference gone); dead `legacy_mu_if_brain_path` field removed.
- I independently **re-ran** the gate: `tools/check-metrics-parity.sh` → 25/25 byte-identical, exit 0.
- **Gate non-triviality proven**: I injected a +1 drift into `convert.py` (return value), cleared pycache, re-ran the gate → exit 1, 25 divergences detected. Restored → exit 0, git diff clean. The C7 billing-base gate is now a true single-source-of-truth gate AND a real (non-stub) gate.

### F2 — MED (round 1) — ROUNDING_MODE_MISMATCH re-derivation was a tautology / dead code → **RESOLVED (now genuinely fires)**
Evidence I captured:
- The tautology is gone. `taxonomy.py` adds an INDEPENDENT `_decimal_to_minor_units_round_half_up()` (legacy Postgres ROUND_HALF_UP path), DISTINCT from the canonical `decimal_to_minor_units()` (ROUND_HALF_EVEN). `re_derive_legacy_via_brain_path()` now calls the ROUND_HALF_UP function — a genuinely separate computation, not the same function on the same input.
- RMM golden fixtures are genuinely divergent (NOT trivial equalities): `rmm-1` legacy_mu(HALF_EVEN)=35714 vs brain_mu(stored HALF_UP)=35715 (delta=1); `rmm-2` 464284 vs 464285 (delta=1).
- I ran the golden RMM fixtures through the **real** `classify_mismatch()`: both classify `ROUNDING_MODE_MISMATCH` with non-zero delta; 0 BLOCKING_BUG.
- I ran `run_harness()` over the entire golden set: rows=27, passed=25, total_mismatches=2, **rounding_mode_mismatches_count=2**, **blocking_bug_count=0**, is_pass=True.
- **Fail-safe preserved** (I tested both directions): a genuine non-rounding bug on a division field (delta=+6) → BLOCKING_BUG; a rounding-like delta on a NON-division field (`grossRevenue`) → BLOCKING_BUG (no over-broad RMM escape). No real bug is suppressed.
- The asserting test `test_golden_fixtures_rmm_classifier_fires` exercises the REAL classifier via `run_harness()` (asserts count==2 AND blocking==0 AND is_pass) — it does NOT hand-construct a `MismatchRecord`. The round-1 "~200 lines reasoning in circles confirming the branch can't fire" block is replaced by a live assertion. CF-C2-RECON-TAXONOMY-1 is now COMPLETE — the anti-phantom-freeze purpose is achieved: real .X45 deltas classify RMM (non-blocking) instead of freezing the first live recon.

### F4 — LOW (round 1) — Ratio overflow diverged cross-language → **RESOLVED**
- `ratio.py:66-70` now raises `OverflowError` on INT32 overflow (was clamp). `ratio.ts:38` throws `RangeError`. Both langs fail-loud; divergence closed. (Minor doc nit: `ratio.py:37` docstring still says "Clamped"; code throws. Non-blocking cosmetic — see new N1.)

### F5 — LOW (round 1) — float exponent derivation in convert.ts → **RESOLVED**
- `convert.ts:55` now derives the exponent via `subunitMultiplier.toString().length - 1` (pure integer). No `Math.log10`/`Math.round` in the conversion path. The money path is float-free by construction. 25/25 vectors still byte-identical.

---

## NEW findings (regression scan of fixers' edits)

### N1 — LOW (informational, non-blocking) — stale docstring in `ratio.py`
`ratio.py:37` Returns docstring still reads "Clamped to INT32 range" but the implementation now throws `OverflowError` (the F4 fix). Code is correct; comment is stale. Cosmetic only — fix opportunistically in Child-4. Not a gate-blocker.

No other new defects. Specifically confirmed CLEAN on the fixers' edit surface:
- No secrets (grep across money code + tools).
- `decimal.js`/`bignumber`/`big.js` ABSENT (lockfile + tree). `lib-metrics` prod `dependencies: {}` — zero runtime supply-chain surface; devDeps tooling-only (tsx/vitest/typescript/types). No new dep reintroduced.
- Zero `legacy project/` staged.
- No live-read sneak (no psycopg/prisma/pg/requests/http/boto3/fetch/axios in money code; the one `convert.ts:31` hit is an error MESSAGE warning callers AGAINST `Number(prismaDecimal)`).
- No float-in-money: every "float"/"Number()*100"/"Math.round" hit is a comment / docstring / fixture-explanation describing the avoided anti-pattern, never live arithmetic.

---

## Carried-forward MED (still tracked, still non-blocking this child)
- **F3 (round 1, MED)** — parity gate cross-checks TS==Python but does not also assert each engine == `expected_minor_units`. Mitigated: per-language unit tests DO assert against the golden values (125 Py + 62 TS green). Defense-in-depth improvement for Child-4; not a gate-blocker. Unchanged this pass.

---

## Scans (captured this round)
- `corepack pnpm audit --prod` → **No known vulnerabilities found.**
- Secrets grep (money code + tools) → clean.
- `python -m pytest` → **125 passed** (was 104; +21 incl. live RMM-classifier assertions).
- `vitest run` → **62 passed** (was 61; +1 negative-FLOOR ratio mutation test).
- `tsc --noEmit` → 0 errors.
- `tools/check-metrics-parity.sh` → 25/25 byte-identical, exit 0. Drift-injection → exit 1 (gate is non-trivial). Restored → exit 0.
- `find pylibs -name golden_fixtures.json` → 1 result (single canonical source).
- `pip-audit`/`safety` not installed; Python lib is stdlib-only (zero third-party runtime deps) → supply-chain surface nil.

## Gate (G4) result — round 2
- CRITICAL: **0**
- HIGH: **0** (F1 RESOLVED)
- MED: 1 carried (F3 — non-blocking, defense-in-depth for Child-4)
- LOW: 1 new (N1 stale docstring) + tech-debt-closed (F4, F5 resolved)
- Compliance: **N/A** — no violation
- Traceability: **N/A** — no runtime code path
- Vuln scans: **CLEAN** on CRITICAL/HIGH

**Verdict: PASS.** Both bounced findings genuinely resolved (verified by independent re-execution, not by trusting the reports): the C7 billing-base gate now has true single-source-of-truth and is provably non-trivial; the RMM classifier genuinely fires on real divergent fixtures while preserving the fail-safe to BLOCKING_BUG. Both LOWs closed. No new blocking defects.

## HANDOFF
- `verdict: PASS`
- `mode: parallel-review (did not advance)` — returned to orchestrator for reconciliation with Tanvi round-2 QA
- No bounce. Carried tech debt: F3 (MED, Child-4), N1 (LOW, cosmetic).
