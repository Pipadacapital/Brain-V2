# Feature journal — feat-money-minor-units-parity

> Child 2 of EPIC `chore-migrate-legacy-to-brain`. The **money / minor-units / numeric-type foundation** — the binding Child-0 architecture's **C7 exact-integer-equality money-parity gate** (`SUM(legacy Decimal ×100 ROUND_HALF_EVEN) == SUM(Brain BIGINT)` per workspace-date, zero tolerance). Legacy stores money as Postgres `Decimal` + computes metrics in TS float (`compute-daily.ts`); Brain's locked paradigm is money = integer minor-units (BIGINT paise + `currency_code`), every KPI deterministic SQL with TS↔Python parity, LLMs never produce a number. This child ships the canonical `Money` value object (TS `packages/lib-metrics` + Python `pylibs/brain_metrics`), the canonical conversion rules (money→BIGINT paise via ROUND_HALF_EVEN; ratio→INT32 ×10,000; count→INT64), and a deterministic GOLDEN-FIXTURE parity harness that PROVES the rules + the type — with the live per-workspace-date reconciliation deferred/gated (mirrors Child-1 HOLD-AT-FORCE). The numeric mechanics were authored by Maya in Child-0 §A5.2; this child extends that binding design into shipped, CI-locked code.

## Stage 1 — 2026-05-24T13:02:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE (1 persona requested → synthesis pending orchestrator re-invoke). Sound, precise, planable, dependency satisfied; binding non-negotiable (C7 gate every downstream metric depends on). Not CHALLENGE-BACK, not KILL.

**Lane:** high-stakes — trigger surfaces `money` (canonical minor-units Money type + conversion + exact-equality billing-base parity) + `schema-proto` (shared cross-language Money value-object contract + `goalType` enum split). Foundational-scaffolding carve-out inapplicable (explicit money surface); conservative tie-break moot (trigger scan unambiguous).

**Pre-flight dep check:** Child-2 `blocks=[child-0 spike]`; spike status=`done` → SATISFIED, no violation. Second-order entry gate noted (NOT a `blocks` edge): Child-0 §A2.2 line 506 sets the Child-2 *entry* state to RLS SATISFIABLE Brain-native — `feat-tenancy-rls-brain-native` = readiness-complete (stage 8) = SATISFIABLE; sufficient for harness DESIGN (no live read this child). LIVE/FORCED required only at the later live-reconciliation cutover.

**Three Founder-flagged tensions RULED (the meat for Aryan + Maya):**
1. **What the parity harness delivers THIS child without touching live data** → a deterministic **GOLDEN-FIXTURE** harness: the Money type + conversion rules as shipped code, a CI-enforced TS↔Python parity gate (extends `tools/check-metrics-parity.sh`), and the `@paradigm: sql` comparator engine (Child-0 M-A5-1) exercised against synthetic legacy-Decimal × known-Brain-MU fixtures. ZERO live-DB read, ZERO MU served to users, ZERO backfill. The live per-workspace-date reconciliation is a gated Stage-8-class cutover later — this child makes that re-point mechanical, not a re-derivation.
2. **Is numeric parity Maya's domain → Maya co-owns Stage 2** → **YES, decisive.** Maya AUTHORED the binding numeric design (Child-0 §A5.2 / M-A5-1..5 / M-A5-Q1/Q2/Q3); `pylibs/brain_metrics` is hers; CF-MAYA-2 + CF-QA-1 land on Child 2. Division: Aryan owns package/DDD homes, the type's interface contract, harness-engine location, CI wiring, reversibility/staging; Maya owns the numeric mechanics (rounding byte-identity, conversion correctness, golden-fixture design, FX-exclusion, exact-equality semantics). Same pattern as the spike's A5.
3. **CM2 definitional-delta (M-A1-Q2) in scope here?** → **NO, deferred to Child 4** per Child-0 line 410 (the Definitional-Delta Register is a Child-4 deliverable, signed by Rohan before cutover; CF-MAYA-1 is a Child-4 pre-condition). Child 2 = types + numeric equality; Child 4 = metric definitions + the definitional sign-off. Child 2 ships only the `expected_definitional_delta` classification HOOK (so Child 4 plugs in), unpopulated. The `goalType money|ratio` split IS in scope (resolves A1 #8).

**Personas (1, NOT reflexive 2):** `money-finance-parity-realist:sonnet` — one dominant dimension = numeric/financial parity correctness. **Load-bearing attack:** Child-0's TS skeleton `roundHalfEven(legacy_decimal * 100)` does the ×100 in JS IEEE-754 float (`1234.565 * 100` = `123456.49999...`) while the Python side is explicitly STRING-protected — TS is NOT (it takes a `number`). CF-QA-1. The persona must name the precise TS Decimal-string mechanism (legacy Prisma returns Decimal as a string — does TS parse it as string or lossily as Number first?) to make TS↔Python byte-identical, else the exact-equality gate silently breaks. Plus: golden-fixture sufficiency (ties/sub-paise/negatives-refunds/zero/overflow/multi-currency/FX-contamination), scope-boundary integrity (no live data, no Child-4 metrics/register), Single-Primitive (Money built once), CF-MAYA-2 currency-at-entry. DECLINED: ai-cost-realist (no compute/LLM/ML — harness is `@paradigm:sql`, Child-0 line 685), india-compliance-officer (no PII/channel/consent; DPDP CF-SEC-3.HARD resolved+inactive, residency ap-south-1 — would re-litigate resolved questions = "looks good" persona, rejected by policy), generic-architecture (Aryan's job). `:sonnet` depth — float-vs-Decimal IEEE-754 + cross-runtime parity reasoning, not a bounded checklist.

**First-pass paradigm:** `sql` — deterministic value object + integer comparator; no float in the harness; no ML/LLM. The canon's purest minor-units invariant; any ML/LLM reach would be a paradigm-bypass anti-pattern.

**Binding contract carried to Stage 2 (inputs for Aryan/Maya/Shreya/Tanvi):**
- *Inherited (fixed, do not re-derive):* conversion rules (money→BIGINT paise ROUND_HALF_EVEN ×100, universal paise even for 4-decimal sources M-A5-Q2; ratio→INT32 FLOOR(×10,000) `_bp` M-A5-Q1; count→INT64); ROUND_HALF_EVEN shared rule byte-identical TS↔Python CI-checked (6 banker's-rounding vectors + 4-decimal cases); harness engine contract (iteration grain, fail-fast FIRST_DIVERGENCE report, `@paradigm: sql`, zero float in harness); **CF-QA-1.HARD** (TS roundHalfEven at Decimal precision via string, not lossy float); **CF-MAYA-2** (WorkspaceCost currency normalized to primary at entry); the `expected_definitional_delta` hook (unpopulated this child).
- *New Child-2 (sharpen at synthesis):* **CF-C2-PRIMITIVE-1** (Money built ONCE, shared, package path + exported interface signature bound in both lib-metrics + brain_metrics; no TS-only/Python-only divergent rep); **CF-C2-GOLDEN-1** (PASS proven on golden fixtures, no live read); **CF-C2-NO-LIVE-1** (zero live legacy-DB read / MU served / backfill; legacy reference-only, no import/edit/commit); **CF-C2-SCOPE-DEFER-1** (metrics + CM waterfall + Definitional-Delta Register → Child 4; goalType split IN scope); **CF-C2-ENTRY-GATE-1** (SATISFIABLE sufficient for design; LIVE/FORCED only at later cutover).

**Escalation:** none at intake — no compliance ambiguity (no PII/channel/consent), no cost-model threat (pure sql), no moat/Memory change, no irreversible decision (additive type + harness, live conversion deferred/gated). Prior-child escalations (DPDP lawful-basis, residency) resolved-on-record, not re-triggered.

**Open questions (inputs, not blockers):** (1) precise TS Decimal-string mechanism for byte-identity (CF-QA-1); (2) Money type package paths + exported interface signature in lib-metrics + brain_metrics; (3) the binding golden-fixture class set; (4) CF-MAYA-2 currency-at-entry — Child-2 type-contract decision vs Child-4 deferral; (5) confirm goalType money|ratio split committable independent of live data.

**Next:** orchestrator spawns `money-finance-parity-realist:sonnet` (`03-persona-money-finance-parity-realist.md`) → re-invokes Rohan for synthesis → Stage 2 Architect (Aryan), co-owned with Maya (intelligence-engineer) on the numeric mechanics (§A5.2 lineage).

## Stage 1 — 2026-05-24T13:12:00Z — Rohan (cto-advisor) — SYNTHESIS (post-persona)

**Decision:** ADVANCE → Stage 2 Architect (Aryan), co-owned by Maya (intelligence-engineer). Persona `money-finance-parity-realist:sonnet` **ACCEPTED** — 6 genuine concerns (1 CRIT / 2 HIGH / 2 MED / 1 LOW), none dropped. The CRITICAL is the load-bearing finding the persona was scoped for.

**6 concerns folded → named CF-* contract (owner-tagged; Maya = numeric mechanics/fixtures/byte-identity, Aryan = homes/contract/CI/reversibility):**
- **CF-C2-STRING-API-1 [CRITICAL]** (Maya impl + Aryan interface lock) — `decimalToMinorUnits` MUST take `string`, not `number`, in BOTH TS + Python. TS = exact decimal-string arithmetic (split on `.`, int×100 + ROUND_HALF_EVEN on exact fractional remainder, integer math only), NOT `Number(str)*100`; TS rejects non-string at the TYPE level + runtime throw. Removes the `1e-10` epsilon (no epsilon when exact). decimal.js (Prisma transitive dep) OR audited inline — Aryan picks ONE (Single-Primitive). Bind a CI fixture passing `"1.255"` as STRING that PROVES string-path vs number-path DIVERGE. Discharges Concern 1. *Rationale:* `number` param invites the `compute-daily.ts:119` `Number(prismaDecimal)` pattern → silent float drift; 6 vectors pass by epsilon coincidence, not proof.
- **CF-C2-RECON-TAXONOMY-1 [HIGH]** (Maya semantics + Aryan report shape) — add 5th harness category `ROUNDING_MODE_MISMATCH` for division-derived fields (`miscExpensesProrated`, `cm3`, audit `cogs`/`totalAdSpend`). Legacy stores these as Postgres `Decimal(12,2)` rounded ROUND_HALF_UP BEFORE Brain sees them (`monthlyAmt/daysInMonth`, `compute-daily.ts:243`); applying Brain ROUND_HALF_EVEN to an already-HALF_UP value drifts 1 paise on `.X45` midpoints → would mis-fire as permanent phantom BLOCKING_BUG, freezing the first live reconciliation. Re-derivation rule: re-derive via Brain Decimal path, compare against Brain MU; match → `ROUNDING_MODE_MISMATCH` (expected, not bug). Add `rounding_mode_mismatches_count` to report. Category+rule THIS child; population deferred. Discharges Concern 2. *This is a genuine scope refinement of my first-pass harness formula, not re-litigation of the spike.*
- **CF-C2-FIXTURE-PROOF-1 [HIGH]** (Maya) — golden set MUST include a TS string-vs-number probe fixture that FAILS on the number path and PASSES on the string path; without it CI green does NOT discharge CF-C2-STRING-API-1 and Tanvi's Stage-5 gate can't assert CF-QA-1 from output alone. Discharges Concern 3.
- **CF-C2-SUBUNIT-1 [MED]** (Maya semantics + Aryan type contract) — add `subunit_multiplier` to the Money value object NOW (default 100; INR/AED/SAR=100, KWD/BHD=1000, JPY=1 per ISO 4217). Conversion + comparator read this field, not a hardcoded 100. **Child-2 type-contract decision, NOT Phase-4-deferrable** — adding after BIGINT columns populate = irreversible value-rewriting migration. Resolves my first-pass open Q (Child-2 vs Child-4 → Child-2). Discharges Concern 4.
- **CF-C2-FLOAT-COGS-1 [MED]** (Maya) — document COGS float-accumulation drift (`coq Decimal(12,4)` schema:431 summed as `Number()` floats, `compute-daily.ts:151-157`) as a known harness artifact (only crosses the threshold >10k line-items/day — above Sugandh Lok scale; Brain per-line-item integer path provably correct). Add a high-volume fixture. Discharges Concern 5.
- **CF-C2-NEG-VECTORS-1 [LOW]** (Maya) — add negative-amount vectors from `shopify_refund_line_items.subtotal_amount` (schema:911): negative variants of all 6 ties (e.g. `-1234.565 → -123456`), neg sub-paise, neg zero — before Tanvi's Stage-5 gate. Discharges Concern 6.

**Reaffirmed:** lane **high-stakes** (the CRIT confirms the call — a `number` sig in express/standard = silent money-drift incident); paradigm **sql** (reinforced — string-path = exact arithmetic, no epsilon, no float); **Maya co-owns Stage 2** (5/6 folded CFs are her numeric mechanics; she authored Child-0 §A5.2); **CF-BN-NOLEGACY-1** legacy=reference-only (Founder, 2026-05-24) reaffirmed + strengthened (do NOT port the legacy `Number()` pattern; string-path is its Brain-native correction).

**Escalation:** none — no compliance ambiguity / cost-model threat / moat change / irreversible decision (subunit_multiplier added now precisely to AVOID a future irreversible migration).

**Artifacts:** `05-stage1-synthesis.md` (full CF-* table + owners). State → stage 2 / architect, `personas_synthesized=true`.

**Next:** Architect (Aryan), Stage 2 — co-owned by Maya (intelligence-engineer / numeric mechanics, §A5.2 lineage).

## Stage 3 bounce-fix — 2026-05-24T18:30:00Z — Maya (intelligence-engineer) — TRACK-M BOUNCE FIX

**Stage:** 3 (bounce-fix — re-entering after Stage-4 Security + Stage-5 QA parallel-review BOUNCE)
**Track:** M (numeric mechanics + fixtures + harness)
**Paradigm:** sql (deterministic integer comparator; no float in harness; no LLM/ML)
**Prompt caching:** N/A — no LLM call
**Daily-tick simulation:** N/A — pure library, no runtime

**What the reviewers found:**
- F1 HIGH (both Shreya + Tanvi): duplicate divergent golden-fixture trees — CI gate reading a stale top-level copy (`pylibs/brain_metrics/parity/`) while harness/tests read the package copy (`brain_metrics/parity/fixtures/`). The stale copy had `id: "probe-1"` while the package copy had `id: "divergence-proof-probe-1"` — already drifted at submission time. Single-source-of-truth of C7 billing-base gate violated.
- F2 MED (Shreya): CF-C2-RECON-TAXONOMY-1 PARTIAL — the `re_derive_legacy_via_brain_path()` function was a tautology (called `decimal_to_minor_units()` — identical to how `legacy_mu` was computed — so `re_derive == legacy_mu` always, and since `classify_mismatch` is only reached when `legacy_mu != brain_mu`, the RMM branch could never fire). RMM fixtures in golden set had `brain_expected_mu = ROUND_HALF_EVEN` result (exact match, no mismatch triggered).
- F2 MED (Tanvi): TS ratio FLOOR mutation gap — `ratioToBasisPoints(-1n, 3n)` test was missing; a mutation removing the sign-aware FLOOR adjustment would survive all 61 TS tests.
- F4 LOW (Shreya): ratio overflow cross-language divergence — TS throws `RangeError`, Python clamped to INT32_MAX/MIN.

**Reconstruction finding (F1):** The stale top-level `pylibs/brain_metrics/parity/` tree does NOT exist on disk or in the git index at this point in time. The CI gate (`check-metrics-parity.sh:22`) already references the correct package path. The "divergence" the reviewers captured was from the submission snapshot. What remains is: (a) the `_meta.shared_by` field referenced the stale path, and (b) the RMM fixtures in golden_fixtures.json were semantically wrong (brain_expected_mu set to ROUND_HALF_EVEN value, never triggering the classifier).

**Actions taken (all in `pylibs/brain_metrics/**`):**
1. **F1 (single-source lock):** Updated `golden_fixtures.json._meta.shared_by` to reflect the single canonical path: `pylibs/brain_metrics/brain_metrics/parity/fixtures/`. Confirmed zero stray fixture files anywhere else (find + git ls-files confirms ONE copy only). CI gate and harness/tests all read the same file.
2. **F2 (recon taxonomy completion):** Fixed `golden_fixtures.json` RMM fixtures so they exercise the classifier:
   - `rmm-1`: changed `legacy_stored_decimal` from `"357.14"` (exact, ROUND_HALF_UP == ROUND_HALF_EVEN) to `"357.145"` (.X45 midpoint); `brain_expected_mu` from `35714` (ROUND_HALF_EVEN) to `35715` (ROUND_HALF_UP — simulates Brain having stored the legacy-path value). Re-derive (ROUND_HALF_UP) = 35715 == brain_mu → RMM fires.
   - `rmm-2`: changed `brain_expected_mu` from `464284` (ROUND_HALF_EVEN, no mismatch) to `464285` (ROUND_HALF_UP — triggers the classifier). Legacy_mu (ROUND_HALF_EVEN) = 464284 ≠ 464285 = brain_mu; re_derive (ROUND_HALF_UP) = 464285 == brain_mu → ROUNDING_MODE_MISMATCH.
   - Added `test_golden_fixtures_rmm_classifier_fires` to `test_harness.py` asserting `rounding_mode_mismatches_count == 2` and `blocking_bug_count == 0` on the golden run — proves the RMM branch is live, not dead code.
3. **F4 LOW (ratio overflow parity):** Changed `ratio.py` from clamp → throw (`OverflowError`) to match TS `RangeError` behavior. Updated `test_ratio.py` to expect `OverflowError` on overflow inputs.
4. **Tanvi F2 (TS FLOOR mutation gap):** The `-1n/3n = -3334` test already present in `money.test.ts` at lines 344-346 — no change needed. Confirmed 62 TS tests pass including that test.

**Verification:**
- Python: `125 passed in 0.05s`
- TS: `62 passed`
- Parity gate: `25 fixture vectors checked: all byte-identical. PASS.`
- RMM classifier live-fire: `rounding_mode_mismatches_count=2, blocking_bug_count=0, is_pass=True`
- Stray fixture tree: confirmed absent (find + git ls-files = zero hits on top-level parity path)
- `git diff --cached --name-only | grep "brain_metrics" | grep -v "brain_metrics/brain_metrics/"` = empty (no stray paths staged)

**Files touched (Track M only):**
- `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`
- `pylibs/brain_metrics/brain_metrics/ratio.py`
- `pylibs/brain_metrics/tests/test_harness.py`
- `pylibs/brain_metrics/tests/test_ratio.py`

**Zero Vikram-owned files touched. Zero legacy files touched.**

**Locked canonical fixture path:** `/Users/rishabhporwal/Desktop/Brain/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`
Justification vs 06-plan: the 06-plan named the harness home as `pylibs/brain_metrics/parity/` (shorthand — a repo-relative path). The ACTUAL implementation co-located the harness inside the Python package at `pylibs/brain_metrics/brain_metrics/parity/` (the importable path, consistent with `harness.py:32: pathlib.Path(__file__).parent`). This bounce-fix binds the inner package path as the canonical home and records it as the correction to the plan's shorthand. The fixture is importable as `brain_metrics.parity.fixtures.golden_fixtures.json` — the only path that is both importable AND co-located with the engine.

**Handoff signal:** READY-FOR-SECURITY (Vikram reports his locked path to complete; then Shreya + Tanvi re-triggered)

## Stage 3 bounce-fix — 2026-05-24T18:45:00Z — Vikram (backend-developer) — TRACK-V BOUNCE FIX

**Stage:** 3 (bounce-fix — second half; gate + TS side)
**Track:** V (CI byte-identity gate, TS parity runners, TS ratio tests)
**Paradigm:** sql
**Prompt caching:** N/A
**Daily-tick simulation:** N/A — pure library

**F1 (HIGH — single-source verification from the gate side):**
- Confirmed `tools/check-metrics-parity.sh:22` reads `${REPO_ROOT}/pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json` — the canonical package path. No edit needed; this was already correct from the first Stage-3 pass (my previous bounce-fix updated it from the stale top-level path).
- `tools/parity-runner.py` accepts the fixture path as `sys.argv[1]` (passed from the shell gate) — reads the same path, no embedded default.
- `packages/lib-metrics/src/parity-runner.ts` accepts the fixture path as `process.argv[2]` (passed from the shell gate) — reads the same path, no embedded default.
- `find pylibs -name golden_fixtures.json` → exactly one result: `pylibs/brain_metrics/brain_metrics/parity/fixtures/golden_fixtures.json`. Stray top-level `pylibs/brain_metrics/parity/` tree confirmed absent (on disk AND in git index).
- `git ls-files pylibs | grep golden_fixtures` → one entry only (the canonical package path).
- `_meta.shared_by` in the fixture: `["pylibs/brain_metrics/brain_metrics/parity/fixtures/"]` (Maya fixed this in her track).
- No TS-embedded JSON copy, no vitest fixture copy, no divergent read path anywhere.
- **REAL gate output (25/25, exit 0, captured):**
  ```
  [parity-gate] Pre-flight checks...
    divergence probe fixture present: OK
  [parity-gate] Running Python side...
  [parity-gate] Running TypeScript side...
  [parity-gate] Comparing TS↔Python outputs...
    25 fixture vectors checked: all byte-identical. PASS.
  [parity-gate] PASS: TS↔Python byte-identity confirmed over all golden fixture vectors.
  [parity-gate] CF-QA-1.HARD satisfied.
  GATE EXIT: 0
  ```
- C7 single-source-of-truth proof: one file, three consumers (bash gate, Python runner, TS runner), all reading the same path. Shreya's F1 CLEARED.

**F2 (QA MEDIUM — TS ratioToBasisPoints FLOOR mutation gap):**
- The test `ratioToBasisPoints(-1n, 3n) → -3334` was already present at `money.test.ts:344-346` from my first Stage-3 pass. Tanvi's review (which saw 61 tests) predates that addition; this second bounce-fix confirms the 62nd test is in place.
- **Mutation proof (LIVE run, not claimed):**
  - Applied mutation: removed the sign-aware floor adjustment block at `ratio.ts:29-33` (replaced with `let floored = quot` — pure BigInt truncation toward zero).
  - Ran `vitest run -t "negative ratio with remainder"`: **TEST FAILED** — `expected -3333 to be -3334`. The mutant returns -3333 (truncation toward zero), the test expects -3334 (floor toward -infinity). Exact vitest output: `AssertionError: expected -3333 to be -3334 // Object.is equality`.
  - Restored real implementation. Ran full suite: **62 passed**.
- Why `-1/4=-2500` does NOT kill the mutant: `-1/4` is exact (no remainder). Both floor and truncation give -2500. The gap Tanvi identified was real; the `-1/3` test is the unique killing vector.
- **TS test count reconciliation:** Tanvi's review saw 61 tests. My previous bounce-fix (Stage-3 first pass) added the `-1n/3n=-3334` test as test #62. Tanvi's review pre-dates that addition — she correctly identified the gap against the 61-test submission. Current count is 62; the gap is closed.

**LOW items:**
- F5 LOW (Shreya — float exponent in convert.ts): Fixed in my first Stage-3 pass (changed `Math.round(Math.log10(subunitMultiplier))` to `toString().length - 1` integer derivation). Not re-touched here.
- F4 LOW (Shreya — ratio overflow cross-language divergence): Fixed by Maya in her Track-M pass (ratio.py now throws OverflowError; test_ratio.py updated). Not in my lane; not re-touched.
- F3 MED (Shreya) / F3 LOW (Tanvi) — parity gate validates TS==Python only, not against expected_minor_units: Both reviewers noted this is deferred acceptable (unit tests provide the correctness layer; two-layer defense is adequate). No action required this pass.

**Verification (all REAL, captured):**
- `tsc --noEmit`: exit 0, zero errors.
- `vitest run`: 62 passed (including the killing test at line 345).
- `pytest tests/`: 125 passed.
- `bash tools/check-metrics-parity.sh`: 25/25 byte-identical, exit 0.
- Secrets grep on staged files: clean.
- Legacy files touched: 0. Maya-owned files touched: 0.
- Staged diff on `pylibs/brain_metrics/brain_metrics/parity/`: zero (no Vikram-authored change to Maya's files).

**Files where Vikram made changes this pass:** NONE. All Vikram-owned staged files were correct from the first bounce-fix pass. This pass was purely verification + mutation proof.

**Handoff signal:** READY-FOR-SECURITY (re-review Shreya + Tanvi)

## Stage 2 — 2026-05-24T14:05:00Z — Aryan (architect, co-owner Maya/intelligence) — BINDING PLAN

**Decision:** ADVANCE → Stage 3 builders, IN PARALLEL (@maya numeric mechanics + @vikram homes/contract/CI/runbook). **Paradigm:** sql (CTOA sign-off carried from Stage-1 intake+synthesis; Aryan affirms; no re-invoke). **Deliverable boundary:** Shape A — canonical Money value object + exact decimal-string conversion primitive + comparator + golden-fixture parity harness. ZERO live read / MU served / backfill; the live reconciliation + column migration is a named **HOLD-AT-LIVE-RECON** gated rollout (mirrors Child-1 HOLD-AT-FORCE; runbook skeleton authored, nothing run).

**Homes (Single-Primitive byte-identity pair):** `packages/lib-metrics` (TS, `@brain/lib-metrics`) + `pylibs/brain_metrics` (Python). Harness engine: `pylibs/brain_metrics/parity/`. Gated runbook: `pylibs/brain_metrics/parity/runbook/` (no-runner-scanned path, Stage-8-only README).

**Locked v1 internal contracts (CTOA-gated to change):**
- TS `decimalToMinorUnits(amount: string, subunitMultiplier: number): bigint` — string-in (type-level reject + runtime TypeError), exact decimal-string BigInt arithmetic, NO `Number()*100`, NO `1e-10` epsilon.
- Python `decimal_to_minor_units(amount: str, subunit_multiplier: int) -> int` — Decimal native, TypeError on non-str.
- `Money { minorUnits: bigint, currencyCode: string, subunitMultiplier: number }` (TS) / frozen dataclass (Python).
- `ratioToBasisPoints(num, den)` → INT32 FLOOR(num*10000/den), throws on den 0 (M-A5-Q1).
- `GoalType = "money" | "ratio"` (resolves Child-0 A1 #8).

**Architect ruling — decimal.js REJECTED → audited inline pure function.** Verified `decimal.js` is NOT in `pnpm-lock.yaml` and Brain has no Prisma (Child-1 confirmed) → the persona's "already a Prisma transitive dep" claim is false in the Brain monorepo. A new general-purpose lib for a single-scalar exact-decimal parse fails the Single-Primitive + no-new-deps checks. decimal.js@10.6.0 (verified real, zero runtime deps) documented as considered-and-rejected (§16).

**CF-C2-* satisfaction map (all 6 folded into the builder acceptance contract as must-fix pass-1 items, 07-handoff §3):**
- CF-C2-STRING-API-1 [CRIT] → string-in both langs, exact decimal-string, no epsilon, one primitive/lang (Track M t1-2, V1).
- CF-C2-RECON-TAXONOMY-1 [HIGH] → 5th category ROUNDING_MODE_MISMATCH + re-derivation rule + rounding_mode_mismatches_count + enumerated division-derived fields (miscExpensesProrated, cm3; audit cogs, totalAdSpend); designed now, populated at live run (Track M t8).
- CF-C2-FIXTURE-PROOF-1 [HIGH] → divergence-probe fixture FAILS number path / PASSES string path (Track M t6); without it CI-green does NOT discharge the CRIT.
- CF-C2-SUBUNIT-1 [MED] → Money carries subunit_multiplier (default 100; KWD/BHD=1000, JPY=1); read not hardcoded; added now to avoid future irreversible value-rewriting migration (Track M t4, V1).
- CF-C2-FLOAT-COGS-1 [MED] → documented artifact + high-volume fixture (Track M t5).
- CF-C2-NEG-VECTORS-1 [LOW] → negative tie variants before Stage-5 (Track M t5/t9).
- CF-QA-1.HARD → tools/check-metrics-parity.sh real byte-identity gate over fixtures (Track V3).
- goalType money|ratio → both registries + typed goalValue rule (Track V2).

**Tracks (PARALLEL):** Track M (@maya) — conversion bodies both langs, ratio/subunit, ALL fixtures incl. divergence-probe/negatives/high-volume-COGS, harness engine + 5-category taxonomy + expected_definitional_delta hook (unpopulated), numeric+harness tests. Track V (@vikram) — TS file homes + Money object, goalType split, CI byte-identity gate (rewrite stub), HOLD-AT-LIVE-RECON runbook skeleton, TS tests. Integrate at the CI byte-identity gate.

**Test plan (positive + negative):** 6 banker's ties + 6 negatives + 4-decimal sub-paise + zero + BIGINT/INT32 overflow + multi-currency subunit + non-string rejection (type+runtime) + ratio FLOOR/zero-den; harness PASS + injected-drift FIRST_DIVERGENCE + ROUNDING_MODE_MISMATCH classification + hook-unpopulated; divergence-probe both-paths; high-volume COGS; TS↔Python byte-identity. Real-network smoke N/A by design → the byte-identity CI gate is the mandatory PASS substitute (same calibration as Child-1's LOCAL test).

**Over-engineering audit:** PASS 7/7. **Single-Primitive sweep:** clean. **Escalation:** none. **No new deploy-pipeline track** (no new/changed service; the CI parity gate IS the pipeline artifact for this child, mirroring Child-1 runbook-as-deploy-artifact).

**Artifacts:** `06-architecture-plan.md` (binding), `07-handoff-to-developer.md` (prescriptive acceptance contract). State → stage 3 / dev-parallel.

**Next:** @maya (intelligence-engineer) + @vikram (backend-developer) — Stage 3, IN PARALLEL.

## Stage 6 — 2026-05-24T19:05:00Z — Rohan (cto-advisor) — FINAL REVIEW (VETO gate)

**Decision:** PASS → APPROVE. Founder gate signed on Founder's behalf (standing delegation); commit NOT auto-performed (awaits Founder "commit it").

**Independent re-verification (captured, ≥3 mandate exceeded — 6 gates + mutation arithmetic):**
- byte-identity parity gate: 25/25, exit 0
- pytest: 125 passed · vitest: 62 passed · tsc --noEmit: exit 0 (all match reviewers)
- gate non-triviality: inject +1 into convert.py → exit 1 (25 divergences); restored → exit 0, git diff clean
- RMM live-fire: run_harness → rounding_mode_mismatches_count=2, blocking_bug_count=0, is_pass=True; fail-safe both directions (14 tests)
- FLOOR mutant -1n/3n: real=-3334 vs mutant(truncate-toward-zero)=-3333 — differ; unique killing vector
- single-source: exactly ONE golden_fixtures.json on disk AND in git index at the canonical package path; stray top-level parity tree absent; no stray-path reference anywhere

**Round-1 bounced findings — independently confirmed resolved:**
- F1 (HIGH both): single-source-of-truth of the C7 gate — RESOLVED (one file, three consumers, gate non-trivial).
- F2 (security MED): RMM re-derivation tautology — RESOLVED (independent ROUND_HALF_UP re-derivation path; genuinely divergent fixtures; classifier fires).
- F2 (qa MED): TS FLOOR mutation gap — RESOLVED (-1n/3n killing vector).
- F4/F5 (LOW): ratio overflow OverflowError==RangeError; convert.ts integer exponent — CLOSED.

**Plan-binding:** OK — CRITICAL CF-C2-STRING-API-1 intact; subunit_multiplier present; goalType money|ratio split; expected_definitional_delta hook present-but-unpopulated; HOLD-AT-LIVE-RECON respected (zero live read); no Child-3/4 scope pulled forward. Path correction (06-plan shorthand → importable package path) is documented + binding, not drift.

**Over-engineering audit:** CLEAN (no out-of-plan files; zero new runtime deps; decimal.js absent; Single-Primitive held). Hard-rule deviation: NONE.

**Carried non-blocking (Child-4):** F3 (gate-also-assert-expected_minor_units); N1 (stale ratio.py docstring).

**Auto-candidate rule:** single-source/divergent-gate-copy cause now in 2 distinct runs (Child-1, Child-2) — below ≥3 threshold; lesson logged in 14-retro, watch for 3rd.

**Artifacts:** 11-final-review.md, 14-retro.md, 12-founder-decision.json, pending-founder-commit.md.

**Next:** Founder commit authorization → Stage 8 = platform-devops (Jatin), CI-parity-gate readiness artifact (no live deploy; mirrors Child-1 readiness-only).
