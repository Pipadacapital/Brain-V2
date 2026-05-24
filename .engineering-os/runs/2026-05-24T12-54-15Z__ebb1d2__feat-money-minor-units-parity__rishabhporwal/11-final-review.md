# 11 — Stage-6 Final Review (CTO Advisor VETO gate) — feat-money-minor-units-parity (Child 2)

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Stage** | 6 — final review (the gate before the Founder gate) |
| **Reviewer** | Rohan (cto-advisor) |
| **Parent epic** | `chore-migrate-legacy-to-brain` (Child 2 of 7 — the **C7 exact-integer money-parity / billing-base gate**) |
| **Lane** | high-stakes (trigger surfaces: `money`, `schema-proto`) |
| **Paradigm** | `sql` — deterministic value object + exact-integer comparator; zero float, zero LLM |
| **Inputs** | Round-1 BOUNCE (Shreya 09, Tanvi 10) → bounce-fix (Maya/Vikram) → Round-2 PASS (Shreya 09b, Tanvi 10b) |
| **Timestamp** | 2026-05-24T19:05:00Z |
| **Verdict** | **PASS** |
| **Recommendation to Founder** | **APPROVE** |
| **Founder gate** | Standing delegation active → Rohan signs Stage 7 on Founder's behalf (`12-founder-decision.json`). **Commit is NOT auto-performed** — requires Founder's explicit free-text "commit it." |

---

## 0. How I reviewed (independent, not rubber-stamp)

I did NOT trust the builder reports or the reviewer artifacts. Every load-bearing claim below is backed by output I captured myself this session. I replicated **6** gates (the Stage-6 mandate is ≥3): the byte-identity parity gate, the Python suite, the TS suite, `tsc --noEmit`, the drift-injection non-triviality test, and the RMM classifier live-fire — plus the FLOOR mutation killing-vector arithmetic. I confirmed the single-source claim on disk + in the git index, the plan-binding (no scope pulled forward from Child 3/4), and ran the over-engineering audit.

---

## 1. Independent re-verification (captured output)

| Gate | Reviewer claim | My captured result | Match |
|------|----------------|--------------------|-------|
| Byte-identity parity gate (`tools/check-metrics-parity.sh`) | 25/25, exit 0 | `25 fixture vectors checked: all byte-identical. PASS.` `GATE_EXIT=0` | ✅ |
| Python suite (`pytest`) | 125 passed | `125 passed in 0.08s` | ✅ |
| TS suite (`vitest run`) | 62 passed | `Tests 62 passed (62)` | ✅ |
| `tsc --noEmit` | 0 errors | `TSC_EXIT=0` | ✅ |
| Gate **non-triviality** (inject +1 drift into `convert.py`, clear pycache, re-run) | exit 1, 25 divergences | `GATE_EXIT_WITH_DRIFT=1`, `25` delta lines; restored → `GATE_EXIT_RESTORED=0`, `git diff` clean (DRIFT_INJECT marker gone, byte-identical to index) | ✅ |
| RMM classifier **live-fire** (`run_harness()` over golden set) | rmm_count=2, blocking=0, is_pass=True | `rounding_mode_mismatches_count: 2`, `blocking_bug_count: 0`, `is_pass: True`, `passed: 25`, `total_mismatches: 2` | ✅ |
| FLOOR mutation killing-vector (`-1n/3n`) | mutant returns -3333, test expects -3334 → kills | Independent arithmetic: real FLOOR = `-3334`, mutant truncation = `-3333`, differ = `true` | ✅ |

Every reviewer PASS is replicated with my own captured output. No discrepancy.

### F1 (HIGH, both reviewers) — single-source-of-truth of the C7 gate — RESOLVED
- `find . -name golden_fixtures.json` (excl. node_modules) → **exactly one**: `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`.
- `git ls-files | grep golden_fixtures` → **one** entry (same canonical package path; nothing under a stray tree).
- Stray top-level `pylibs/brain_metrics/parity/` tree: `find … -type f` → **absent** (exit 1) on disk AND in the git index.
- Repo-wide grep for any `brain_metrics/parity/fixtures` reference NOT under the canonical `brain_metrics/brain_metrics/parity` path → **none**.
- `check-metrics-parity.sh:22` `FIXTURE_PATH` → canonical package path; `harness.py:32` `_DEFAULT_FIXTURE_PATH` resolves to the same file (Tanvi proved `st_ino` equality across gate/harness/test read-paths).
- One file, three consumers (bash gate, Python runner, TS runner), all reading it. The C7 billing-base gate is single-source AND non-trivial (drift-injection proven above).

### F2 (security MED) — `ROUNDING_MODE_MISMATCH` re-derivation tautology — RESOLVED
- The bounced tautology is genuinely gone: `taxonomy.py` adds an **independent** `_decimal_to_minor_units_round_half_up()` (legacy Postgres ROUND_HALF_UP path), DISTINCT from the canonical `decimal_to_minor_units()` (ROUND_HALF_EVEN). `re_derive_legacy_via_brain_path()` calls the ROUND_HALF_UP function — a separate computation, not the same fn on the same input. The docstring documents the prior dead-branch bug and why the fix is now reachable.
- RMM golden fixtures are genuinely divergent: `rmm-1` 35714 (HALF_EVEN) vs 35715 (stored HALF_UP); `rmm-2` 464284 vs 464285.
- Live harness run: `rounding_mode_mismatches_count=2`, `blocking_bug_count=0`. Fail-safe both directions confirmed by 14 passing harness/classifier tests (a non-rounding bug on a division field, and a rounding-like delta on a non-division field, both → BLOCKING_BUG — no over-broad RMM escape). This is the anti-phantom-freeze purpose achieved: a real `.X45` delta classifies RMM (non-blocking), not a permanent phantom that freezes the first live reconciliation.

### F2 (qa MED) — TS `ratioToBasisPoints` FLOOR mutation gap — RESOLVED
- `money.test.ts:344-345` asserts `ratioToBasisPoints(-1n, 3n) === -3334`. I independently reproduced the arithmetic: real (sign-aware FLOOR) = -3334; mutant (truncate-toward-zero) = -3333 — they differ, so removing the sign-aware floor block fails the test. The old `-1/4` vector is exact (no remainder) and correctly cannot kill the mutant; `-1/3` is the unique killing vector.

### LOWs — CLOSED
- **F4** (ratio overflow cross-language divergence): `ratio.py` now raises `OverflowError` to match TS `RangeError`; both fail-loud, divergence closed.
- **F5** (float exponent in `convert.ts`): now `subunitMultiplier.toString().length - 1` (pure integer); money path is float-free by construction; 25/25 still byte-identical.

---

## 2. Plan-binding confirmation (drift check vs the original requirement + 06-plan)

| Bound contract | Status (independently verified) |
|----------------|----------------------------------|
| **CF-C2-STRING-API-1 [CRITICAL]** — `string`-in both langs, exact decimal-string arithmetic, NO `Number()*100`, NO `1e-10` epsilon, one primitive/lang | PASS — TS `decimalToMinorUnits(amount: string, subunitMultiplier: number): bigint` with type-level + runtime `TypeError` guard; exact BigInt arithmetic; the only `Number()*100`/epsilon hits are comments documenting the avoided anti-pattern. Python `decimal_to_minor_units(amount: str, …)`, `Decimal(amount)` native, TypeError on non-str. |
| **CF-C2-FIXTURE-PROOF-1 [HIGH]** — divergence probe FAILS number-path / PASSES string-path | PASS — `divergence-proof-probe-1` present; 7 Python + 6 TS probe tests run both paths and assert divergence. |
| **CF-C2-RECON-TAXONOMY-1 [HIGH]** — 5th category + re-derivation rule + count + enumerated division-derived fields | PASS — see F2 above; `DIVISION_DERIVED_FIELDS` = {miscExpensesProrated, cm3, cogs, totalAdSpend}; designed now, population deferred. |
| **CF-C2-SUBUNIT-1 [MED]** — Money carries `subunit_multiplier`, read not hardcoded | PASS — present in both `money.ts` + `money.py`; conversion reads it; multi-currency vectors (INR=100/KWD=1000/JPY=1) byte-identical. Added now to avoid a future irreversible value-rewriting migration. |
| **CF-C2-FLOAT-COGS-1 [MED]** — documented artifact + high-volume fixture | PASS — `high_volume_cogs` fixture + test present. |
| **CF-C2-NEG-VECTORS-1 [LOW]** — negative tie variants + neg-zero | PASS — 7 negative fixtures + tests. |
| **CF-QA-1.HARD [HIGH]** — real byte-identity gate | PASS — gate is real (drift-injection → exit 1), 25/25. |
| **goalType money\|ratio split (A1 #8)** | PASS — `GoalType` in both registries; TS `GoalValue` discriminated union; Python `StrEnum`. |
| **`expected_definitional_delta` hook present-but-unpopulated (Child 4)** | PASS — `= None`, "Child 4 populates"; count stays 0. |
| **HOLD-AT-LIVE-RECON respected — ZERO live read / MU served / backfill** | PASS — no psycopg/prisma/pg/requests/http/boto3/fetch/axios in money code (the grep hits are comments warning against `Number(prismaDecimal)`); migration DDL is "UN-APPLICABLE. Do NOT run this file" in a no-runner-scanned path; nothing run. |
| **Scope NOT pulled forward from Child 3/4** | PASS — no metric definitions / CM waterfall / Definitional-Delta Register population; grep for `compute_daily`/`cm_waterfall`/`materializ`/`metric_registry` in source → none. |
| **CF-BN-NOLEGACY-1 — legacy reference-only** | PASS — `git status` shows zero `legacy project/` diff. |

### Path-correction is a documented plan-binding, not undocumented drift
The 06-plan named the harness home with the shorthand `pylibs/brain_metrics/parity/`. The shipped (and now canonical) home is the importable, package-co-located `pylibs/brain_metrics/brain_metrics/parity/fixtures/`. This correction is documented in the feature journal (Maya's bounce-fix, "Locked canonical fixture path", with justification: it is the only path both importable AND co-located with the engine via `harness.py` `Path(__file__).parent`). Recorded here as the binding correction to the plan shorthand — not a freelance deviation. No second tree exists.

---

## 3. Over-engineering audit (durable "No over-engineering" rule)

| Check | Result |
|-------|--------|
| Files staged not in the architect's plan? | **None.** Staged surface is exactly `packages/lib-metrics/**`, `pylibs/brain_metrics/**`, `tools/check-metrics-parity.sh`, `tools/parity-runner.py` — all within the §1.2 allow-list. |
| Observability/metrics/tests beyond plan? | No. No runtime → no metrics/tracing added; tests map 1:1 to the bound CF-* acceptance items + positive/negative coverage standard. |
| New npm/pip/uv runtime deps beyond plan? | **None.** `lib-metrics` prod `dependencies: {}`; devDeps tooling-only (tsx/vitest/typescript/@types/node/coverage-v8). Python lib is stdlib-only. `decimal.js`/`bignumber`/`big.js` absent from `pnpm-lock.yaml` (the inline audited pure function was the bound decision, §16). |
| New abstractions "for future use" (Single-Primitive)? | No. One `Money` rep per language as a byte-identity pair; one conversion primitive per language. The `expected_definitional_delta` hook and the runbook skeleton are explicitly bound deliverables (Child-4 plug-point / HOLD-AT-LIVE-RECON), not speculative gold-plating. |
| Plan length proportionate to risk? | Yes — prescriptive depth is justified for a high-stakes foundational money primitive. |
| 30+ line WHAT-not-WHY comments? | No. The longer comment blocks (e.g. `taxonomy.py` re-derivation doc) explain WHY the prior tautology was a bug and why the fix is reachable — load-bearing rationale, not narration. |

**Over-engineering audit: CLEAN.**

---

## 4. Hard-rule deviation check (Stage-6 step 9)

Scanned for: dependency violation · Single-Primitive violation · compliance gap · paradigm escalation beyond plan · gate-skip without codified exception.

- Dependency: pre-flight `blocks=[child-0 spike]` SATISFIED (spike `done`); entry-gate note (Child-1 SATISFIABLE) sufficient for harness DESIGN. No violation.
- Single-Primitive: clean (one Money/lang, one conversion/lang).
- Compliance: N/A — pure deterministic library, synthetic fixtures, no PII/channel/consent/live data. No DPDP/DLT/NCPR/residency surface. No violation, no escalation trigger.
- Paradigm: `sql` throughout; no ML/LLM reach. No escalation.
- Gate-skip: none — high-stakes lane ran the full pipeline (architect + Security + QA + this final review). All four multi-tenancy layers N/A (no tenant-scoped runtime code this child; the harness is synthetic-fixture-only) — correctly so for a pure value-object library.

**No hard-rule deviation. Auto-approve under standing delegation is permitted.**

---

## 5. Carried non-blocking items (for retro + Child-4)

- **F3 (MED, both reviewers, carried):** the parity gate cross-checks TS==Python but does not also assert each engine == `expected_minor_units`. Mitigated: per-language unit tests DO assert against golden values (125 Py + 62 TS). Two-layer defense is adequate this child; the gate-also-asserts-expected enhancement is a defense-in-depth item for **Child 4**. Not a blocker.
- **N1 (LOW, security):** `ratio.py:37` docstring still reads "Clamped to INT32 range" but the code now throws `OverflowError` (F4 fix). Cosmetic; code is correct. Confirmed still present. Fix opportunistically in **Child 4**.

Both are genuinely non-blocking; neither touches the C7 correctness invariant.

---

## 6. Verdict

**PASS.** Both bounced findings are genuinely resolved (verified by my own re-execution, not by trusting the reports): the C7 billing-base gate now has true single-source-of-truth and is provably non-trivial; the RMM classifier genuinely fires on real divergent fixtures while preserving the fail-safe to BLOCKING_BUG; the TS FLOOR mutation gap is closed with a unique killing vector. The CRITICAL string-API contract is intact. The build is bound to plan with zero out-of-plan files, zero new runtime deps, zero legacy edits, zero live read, and no Child 3/4 scope pulled forward. Over-engineering audit clean; no hard-rule deviation.

This matches the Child-1 precedent (`feat-tenancy-rls-brain-native` / `feat-tenancy-auth-rls-hardening`): a single-source/fail-closed bounce, fixed, re-reviewed PASS, then a Stage-6 PASS confirmed by independent re-verification.

**Recommendation to Founder: APPROVE.**

---

## 7. Next step — Founder commit authorization (NOT auto-committed)

Standing delegation lets me sign the Stage-7 gate on the Founder's behalf (`12-founder-decision.json` written). **It does NOT authorize a commit.** Per the feature-branch-only rule + the harness guard, nothing is staged or committed until the Founder gives explicit free-text **"commit it"**. Stage 8 for this child is a **CI-parity-gate readiness artifact** (no live deploy; mirrors Child-1 readiness-only), and even that requires the Founder's commit authorization first.

The exact, mechanical commit command (explicit product-code paths — NO `git add -A`, which would wrongly stage the untracked `packages/lib-metrics/coverage/` + `pylibs/brain_metrics/.coverage` test byproducts) is in `pending-founder-commit.md`.
</content>
</invoke>
