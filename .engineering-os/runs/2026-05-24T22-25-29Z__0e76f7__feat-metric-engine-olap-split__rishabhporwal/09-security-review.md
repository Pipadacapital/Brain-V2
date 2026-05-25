# 09 — Security Review (Stage 4) — feat-metric-engine-olap-split (Child 4)

> Reviewer: Shreya (security-reviewer) · Mode: PARALLEL (Shreya ∥ Tanvi; orchestrator reconciles)
> Timestamp: 2026-05-25T (Stage 4) · Lane: high-stakes (money, schema-proto, multi-tenancy, india-compliance)
> Verdict: **BOUNCE** → intelligence-engineer (Maya) + backend-developer (Vikram) — registry contradiction is co-owned

---

## Change-class scope declaration (FIRST)

Child-4 Track V + Track M: OLAP plumbing (ClickHouse MV DDL, runbook-gated, NOT applied), workspace-scoped
query-gateway, single-writer enforcement, residency startup assert, TS + Python metric registries, 9-field
Definitional-Delta Register, parity-gate extensions. Paradigm `sql` exclusive (zero inference path).

ALWAYS-ON checks (run regardless of class): vuln/secret grep, supply-chain, input-validation, money-derived
integrity (minor-units / no-float / no-LLM-numbers). Surface-specific gates IN scope: multi-tenancy (query-gateway
isolation), residency (DPDP), money integrity (intDiv ratio path), audit/governance (DDR sign-off rules), single-writer.

India-compliance: **DPDP residency IN scope** (OLAP derives from order/customer events → ap-south-1 required).
Telecom (DLT/NCPR/WhatsApp/calling-hours/recording-consent): **N/A — out of scope** (no outbound channel, no
PII surfaced, no customer-contact path in this child; metric path is aggregate integers only).

**Cross-req staging note (non-blocking, flagged):** the staged set also contains `apps/ingestion-service/**` +
`feat-connector-framework-cutover` artifacts (run `c7fed9`, a DIFFERENT req — Child 3). This review is scoped to
Child-4 files only. The orchestrator/Founder should split the commit by req so the Child-4 PR does not carry
Child-3 code. Not a security finding; a hygiene flag.

---

## Verdict: BOUNCE (1 HIGH, money-integrity + governance-integrity)

The vuln scans are clean, the residency/single-writer/query-isolation guards are real-path with killed mutants,
and the ClickHouse `intDiv` money path is correct. **But the single most important thing this child exists to
guarantee — that Brain's Brain-native decision metrics are defined consistently and cannot be smuggled past the
parity gate — is broken.** The TS registry, the Python registry, and the Rohan-signable DDR `formula_snapshot`
define **materially different formulas for the same four Brain-native decision metrics**, and **no gate catches it**
because those rows are `parity_gap:true` / `correctness_fixture` and are routed away from the only cross-language
byte-identity comparison. This is the exact false-GREEN class `CF-C4-VERIFY-THE-VERIFIER-1` was bound to prevent —
landing inside the child built to prevent it.

---

## Findings

### H-1 (HIGH) — TS↔Python↔DDR registry formula divergence on 4 Brain-native decision metrics, undetected by any gate
**Class:** money-integrity / governance-integrity (wrong-but-signable metric definition).
**CF:** CF-C4-DDR-TRUE-CM2-1, CF-C4-VERIFY-THE-VERIFIER-1, CF-C4-PARITY-SCOPE-1, CF-QA-1.HARD.

For the same metric id, the three artifacts disagree:

| Metric | Python registry + DDR formula_snapshot (Rohan signs THIS) | TS registry (`definitions.ts`) |
|---|---|---|
| `true_cm2_mu` | `cm2 − intDiv(rto_orders × (ad_spend + variable_costs + cogs), total_orders_count)` — cost-base-proportional RTO provision | `cm2 − (rto_orders × avg_rto_cost_per_order_mu)` — flat per-order configured cost. **Different inputs + different math.** (definitions.ts:218-221) |
| `pamer_bp` | `intDiv(cm2 × 10000, total_ad_spend)` — CM2 ÷ ad spend | `ratioToBasisPoints(total_ad_spend, net_revenue)` — ad spend ÷ net_revenue. **Reciprocal + different operand.** (definitions.ts:232) |
| `amer_bp` | `intDiv(true_cm2 × 10000, total_ad_spend)` — True-CM2 ÷ ad spend | `ratioToBasisPoints(total_ad_spend, gross_sales)` — ad spend ÷ gross_sales. **Different metric entirely.** (definitions.ts:246) |
| LTV:CAC | id `ltv_cac_bp`, unit `bp`, `intDiv(ltv × 10000, cac)` | id `ltv_cac_x100`, unit `x100`, `(ltv × 100)/cac`. **Different id + unit + scale.** (definitions.ts:254-264) |

Intra-repo, even the prose contradicts itself: Python `_pamer_bp` docstring says "paMER = CM2 / Total Ad Spend"
while the TS comment says "paMER = total_ad_spend / net_revenue" (reciprocals, different operands).

**Why no gate caught it (verify-the-verifier blind spot):**
1. `tools/check-metrics-parity.sh` step 3 (byte-identity) only compares the `golden_fixtures.json`
   `decimal_to_minor_units` vectors — it does **not** compare the registry `clickhouse_sql` or `formula` fields.
2. Step 6 ("registry seam") only checks that the two registry **directories exist** + `__init__.py` is present.
   It does **NOT** assert metric-id parity or `clickhouse_sql` equality. The developer reports (Maya report L213;
   Vikram V7) claim it asserts "every Python metric id has a matching TS definition with the same clickhouse_sql,
   kind, unit, display_only, parity_class." **That assertion was never implemented** — `grep` for any cross-language
   `clickhouse_sql` comparison across `tools/` + both parity-runners returns nothing. The registry-parity gate is
   itself vacuous (a verify-the-verifier failure on the verifier).
3. The four divergent metrics are `parity_class: correctness_fixture` (`parity_gap:true`), which routes them away
   from the TS↔Python shadow-compare by design — so the divergence is invisible to the only real comparison.
4. `registry.test.ts:204-216` pins the **divergent TS formulas as "correct"** in a self-consistent unit test
   (`true_cm2 = 420000 - (10 × 5000)` flat-per-order; `pamer = spend/revenue`; `amer = spend/gross_sales`), so the
   TS suite is green while encoding a formula that contradicts the signed register — a tautological pin of the wrong value.

**Concrete proof the seam gate is vacuous:** TS exports `ltv_cac_x100`; Python exports `ltv_cac_bp`. If step 6 actually
asserted id-parity (as the reports claim), this id mismatch alone would fail the gate. The gate passes → the gate
does not check ids → the claim is false.

**Blast radius:** these are decision metrics (True-CM2, paMER, aMER, LTV:CAC are the CM2-first signals Brain sells).
The DDR `formula_snapshot` is the artifact Rohan signs at Stage 6 to certify what Brain computes; today the TS engine
that would actually serve the number computes something different from what gets signed. `CF-C4-DDR-TRUE-CM2-1`
requires the True-CM2 RTO-provision formula "pinned IN FULL" and identical across the contract; it is not.

**Required to clear (must-fix-now per finding-severity-rubric — money + governance integrity, conservative tie-break):**
- (a) Reconcile `true_cm2_mu`, `pamer_bp`, `amer_bp`, and LTV:CAC (id+unit) so TS registry == Python registry ==
  DDR `formula_snapshot` — one canonical formula per metric across all three. (Aryan/Rohan adjudicate WHICH formula
  is canonical; this is a definition decision, not just a code edit — surface to Rohan if the canonical choice is ambiguous.)
- (b) Implement the registry-parity assertion the reports already claim exists: `check-metrics-parity.sh` must assert,
  for every metric id, that TS and Python agree on `id`, `clickhouse_sql`, `kind`, `unit`, `display_only`,
  `parity_class` — and that this set matches the DDR `formula_snapshot` for every `parity_gap:true` row. This closes the
  blind spot so `correctness_fixture` rows can no longer escape cross-artifact verification.
- (c) A killed-mutant for THIS gate (per CF-C4-VERIFY-THE-VERIFIER-1): perturb one TS `clickhouse_sql` and confirm the
  reconciliation gate goes RED. The TS↔Python registry contract must not be the one gate without a verifier.

---

## MED findings (logged as tech debt; do NOT block)

- **M-1 (MED) — single-writer grep scan scope.** `test_single_writer_grep.py` scans only `apps/analytics-service/src`
  and `packages/lib-metrics/src`. It does NOT scan `pylibs/brain_metrics/**` or `tools/`. I verified there is **no
  write path in pylibs/tools today** (pure-compute; only hit is a `.md` runbook), so this is not an active HIGH — but
  the gate would not catch a future Brain write planted in `pylibs`. Add `pylibs/brain_metrics` (and any future
  Brain service writing metrics) to `_SCAN_PATHS`. The DB read-only-role startup assert is the structural backstop and
  IS present, which is why this stays MED not HIGH.
- **M-2 (MED) — residency marker is a substring match.** `assert_clickhouse_residency` accepts any host containing
  `ap-south-1` or `aps1` anywhere. A deceptively-named host (`evil-ap-south-1-decoy.us-east-1.clickhouse.cloud`) is
  accepted. Realistic misconfiguration (operator points at us-east-1/eu-west-1/ap-south-2/ap-northeast-1) IS correctly
  rejected (test-confirmed), and `CLICKHOUSE_HOST` is operator-controlled deploy config, not attacker input — so the
  binding CF-C4-RESIDENCY-1 refuse-to-start guarantee holds for the real threat. Harden by anchoring the marker to a
  region-suffix position (regex on the host segment) rather than a free substring. MED.

---

## Gate-by-gate / CF-by-CF resolution

| CF-C4-* | Required | Result |
|---|---|---|
| CF-C4-RATIO-DIVOP-1 (CRITICAL) | intDiv + null-guard on EVERY MV division; zero `/` on metric cols | **PASS** — all MV ratios use `if(denom>0, intDiv(...), NULL)`; bare-`/` grep on SQL = comments only; TS `/` at definitions.ts:94,162 are **BigInt** operands (integer floor, verified typed `bigint`) = correct; zero-denom kill-test (`ch-rt-zero-1`) → NULL not INT64_MAX |
| CF-C4-PRORATED-DIVOP-1 | `toDaysInMonth(date)`, never 30 | **PASS** — MV uses `toDaysInMonth(date)`; Feb-28 → 11071 worked example; wrong-30 kill-test (delta 2381) present |
| CF-C4-COGS-MV-REFRESH-1 | full-recompute, not incremental MV | **PASS** — cogs_mu read as-is from base; `COGS_SETTINGS_CHANGE_DELTA` taxonomy category + fixture present |
| CF-C4-SINGLE-WRITER-GREP-2 (HIGH) | 3-pattern grep + read-only role assert; zero Brain write to legacy rollup | **PASS (with M-1 tech-debt)** — planted prisma.workspaceDailyMetrics.upsert killed; SQL-INSERT killed; Pattern-3 raw-CH-outside-gateway; Postgres read-only-role startup assert present; ZERO write path confirmed across staged Brain code (incl. pylibs) |
| CF-C4-QUERY-SCOPE-ISOLATION-1 (HIGH) | fail-closed UnscopedQueryError; two-workspace non-vacuous isolation + killed predicate-drop mutant | **PASS** — falsy workspace_id (None/""/whitespace) → UnscopedQueryError BEFORE client call; bound-param `%(workspace_id)s` (no interpolation); two-workspace seed (ws_A+ws_B), zero ws_B leak; predicate-drop mutant client → ws_B appears → killed. NOT vacuous |
| CF-C4-RESIDENCY-1 | ap-south-1 startup assert, refuse-to-start; wrong-region killed | **PASS (with M-2 tech-debt)** — us-east-1/eu-west-1/ap-south-2/ap-northeast-1/eu-south-1/localhost all rejected; ap-northeast-1 wrong-region killed mutant confirmed; substring-breadth is MED hardening only |
| CF-C4-DDR-1 (9 fields) | 9 fields; Rule 1 (parity_gap→no shadow GREEN); Rule 2 (child_dependency→blocked) | **PASS (structure)** — 9 fields on all 11 rows; `assert_signable()` raises SignOffBlockedError on parity_gap:True AND on non-null child_dependency; total_tax_mu + FX correctly child-dependency-blocked. A mis-filed bug cannot be smuggled as expected_definitional_delta (structural rules enforced) |
| CF-C4-DDR-TRUE-CM2-1 (HIGH) | True-CM2 RTO formula pinned IN FULL, consistent across contract | **FAIL → H-1** — DDR/Python pin cost-base-proportional; TS pins flat-per-order. Not identical. |
| CF-C4-DDR-GST-TAX-1 | total_tax_mu row, child-3 dependency, magnitude estimate | **PASS** — row present; child_dependency:child-3-shopify-connector; 0–2%/5–10% magnitude; blocked from sign-off |
| CF-C4-DDR-FX-RESTATEMENT-1 | shadow rate pinned to legacy 83.5; child-3 dependency | **PASS** — 8350 paise/USD; child_dependency:child-3-workspace-cost-currency-migration; MV `fx_rate_inr_x100 DEFAULT 8350` |
| CF-C4-DDR-MISC-PRORATE-1 | Feb-boundary worked example; adjudication discipline | **PASS** — 35714/28-day example; wrong-30 → BLOCKING_BUG (not ROUNDING_MODE_MISMATCH) discipline documented |
| CF-C4-VERIFY-THE-VERIFIER-1 (HIGH) | each high-stakes gate real-path + killed-mutant; NOT tautological/false-GREEN | **PARTIAL → contributes to H-1** — isolation/single-writer/residency killed mutants are real and confirmed. BUT the registry-parity gate is **vacuous** (directory-presence only; the claimed clickhouse_sql/id assertion was never built) and `registry.test.ts` tautologically pins the divergent TS formulas. The verifier-of-the-registry is itself false-GREEN. |
| CF-C4-PARITY-SCOPE-1 | input_source note; legacy-sourced GREEN ≠ cutover license | **PASS** — input_source on HarnessReport; F3 expected_minor_units anchor asserted in gate |
| Paradigm `sql` exclusive | zero haiku/sonnet/ml in metric path | **PASS** — zero `@paradigm: haiku/sonnet/ml`; pure integer arithmetic; no LLM number emission |
| ZERO live DDL / flip / legacy edit / commit | runbook-gated; HOLD-AT-READ-FLIP | **PASS** — README is STAGE-8-only docs (no execution scripts); zero legacy files staged; no flip; staged-not-committed |

---

## Always-on scans (captured)

- **Test suites (real):** analytics-service `36 passed`; brain_metrics `250 passed`; parity-gate `exit 0` (all 6 steps).
  (Green — but see H-1: green is partly because the registry-parity check is vacuous.)
- **Secrets grep on staged Child-4 diff:** NO hardcoded secrets (CLICKHOUSE_PASSWORD via env only; defaults empty).
- **Bare-`/` on metric columns (money integrity):** SQL hits are comments only; TS hits are typed-`bigint` floor division. CLEAN.
- **Single-writer write-path grep across staged Brain code (incl. pylibs + tools):** ZERO write path to legacy rollup.
- **Legacy edits:** ZERO `legacy project/**` files staged (CF-BN-NOLEGACY-1).
- **Live DDL execution scripts:** NONE (README.md is the only doc; runbook-gated).
- **Supply-chain / dep changes:** `pyproject.toml` adds build-backend + pytest config only; `protos/buf.yaml`,
  `integrations.proto` belong to the cross-staged Child-3 set (out of Child-4 scope; flagged above). No new runtime
  deps with CRITICAL/HIGH advisories in the Child-4 surface.

---

## Traceability

This child is a **shadow service with no live serving path** (per plan §11 proportionality): no REST/tRPC/gRPC
surface, no Kafka consumer, no live network call (DDL runbook-gated). The query-gateway is the single read entry-point
and is structured-logging instrumented on the UnscopedQueryError path with `workspace_id` + `definition_id` + date
range. There is no end-to-end request flow in the diff that lacks a correlation ID, because there is no request flow
yet. **No missing-traceability VETO.** When Child-5/6 wire query_metrics behind a live endpoint, the correlation-ID
contract (`request_id`+`trace_id`+`workspace_id`+`user_id`) must be propagated into the gateway call and onto error
responses — noted for the downstream child, not a finding here.

---

## Compliance

- **DPDP residency:** PASS — ClickHouse ap-south-1 refuse-to-start assert present + belt-and-suspenders in the
  Stage-8 runbook (M-2 is a hardening note, not a violation; the realistic misconfiguration is rejected).
- **DPDP minimization / PII:** PASS — metric path is aggregate integers (workspace_id + date + money/ratio µ); no
  email/phone/customer PII in the OLAP rows or logs sampled.
- **Telecom (DLT/NCPR/WhatsApp/9-9 window/recording consent):** N/A — no outbound channel in this child.
- **No compliance VETO.**

---

## Decision

**BOUNCE.** One HIGH (H-1) blocks the gate (G4: zero HIGH). The money/governance integrity of the four Brain-native
decision metrics is not guaranteed and the verifier that should guarantee it is vacuous. This is the
verify-the-verifier failure class, recurring inside the child commissioned to end it — it must not ship.

- **Bounce target:** intelligence-engineer (Maya) — registry/DDR formula reconciliation + the parity-gate
  registry-assertion (her lane: metric definitions + harness). **Co-owned with** backend-developer (Vikram) —
  `check-metrics-parity.sh` registry-parity assertion + the TS `registry.test.ts` correction (his V7 lane). The
  orchestrator routes the primary bounce; both must move.
- **Adjudication note:** WHICH formula is canonical for each of the 4 metrics is a definition decision. If Maya/Vikram
  cannot determine canon from the binding contract, surface to Rohan — do not let the builders pick arbitrarily, since
  the choice is what Rohan signs at Stage 6.
- MED findings (M-1 scan scope, M-2 residency substring) logged as tech debt; non-blocking; fix opportunistically.

---

## DoD (Stage 4)

- [x] All Stage-3 artifacts + staged Child-4 file set read
- [x] Every CF-C4-* resolved with evidence (table above)
- [x] Multi-tenancy: query-gateway fail-closed + two-workspace non-vacuous isolation + killed mutant — verified PASS
- [x] Single-writer: 3-pattern grep + killed mutants + read-only-role assert + zero write path — verified PASS (M-1 debt)
- [x] Money integrity: intDiv on every ratio; BigInt floor on TS; round-trip fixtures — verified PASS
- [x] Residency: ap-south-1 refuse-to-start + killed mutant — verified PASS (M-2 debt)
- [x] DDR governance: 9 fields + Rule 1/Rule 2 sign-off blocks — verified PASS (structure)
- [x] Verify-the-verifier: isolation/single-writer/residency real + killed; **registry-parity verifier vacuous → H-1**
- [x] Scans captured (secrets, bare-/, write-path, legacy, live-DDL)
- [x] Traceability assessed (shadow service; no live path; no VETO)
- [x] Compliance assessed (DPDP residency PASS; telecom N/A)
- [x] Verdict + bounce target + rationale recorded
