# Final Review — feat-metric-engine-olap-split (Child 4)

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Round-2 final review: Security (`09b`) PASS + QA (`10b`) PASS after a round-1 BOUNCE on H-1 (the formula-divergence / vacuous-gate verify-the-verifier recurrence).
> Pairs with the DDR sign-off recorded in `definitional_delta_register.md` + `12-founder-decision.json` + `14-retro.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-metric-engine-olap-split` (Child 4 of EPIC `chore-migrate-legacy-to-brain`) |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-25T (Stage 6) |
| **Verdict** | **PASS** |
| **DDR** | **PARTIALLY SIGNED** — 9 rows SIGNED (7 shadow_compare/display + 2 correctness-fixture acknowledged… see §DDR), 2 rows **UNSIGNED-PENDING-child-dependency** (`total_tax_mu`, `fx_restatement`) |
| **Founder gate** | **SIGNED under standing delegation** — no hard-rule deviation; see §9 + `12-founder-decision.json` |
| **Commit** | **NOT performed** — Founder commits at end-review (per standing rule). Mechanical commit command emitted in `pending-founder-commit.md`. |

---

## 0. TL;DR

Child 4 is the data engine behind the runnable UI — the metric registry + canonical definitions + ClickHouse materializations (runbook-gated, not applied) + workspace-scoped query-gateway + shadow-compare harness + the 9-field Definitional-Delta Register. It came in **high-stakes**, took **2 personas** at Stage 1 (both `:sonnet`, both surfaced ≥1 grounded concern), and produced a tight Shape-A build with a HELD `HOLD-AT-READ-FLIP`. Round-1 Security caught a genuine HIGH (H-1: the TS↔Python↔DDR formula divergence on the 4 Brain-native decision metrics, hidden by a vacuous registry-parity gate) and bounced; round-1 QA gave PASS but flagged the same issue as DEFER (a QA verify-the-verifier miss — captured in the retro). The bounce-fix (`08b` Maya locked-canon + `08c` Vikram TS alignment + real gate) reconciled all 4 metrics to ONE canonical formula across TS == Python == DDR and rebuilt the registry-parity gate as a genuine per-metric content-equality check with two killed mutants. Round-2 Security + QA both PASS.

**I independently re-verified the load-bearing gates** (did not trust the reports): the parity gate runs GREEN (exit 0); 434 tests pass (41 + 291 + 102); tsc clean; the True-CM2/paMER/aMER/LTV:CAC worked examples are arithmetically correct; and — the crux — I **mutated the real `definitions.ts` on disk twice** (id-rename `ltv_cac_bp`→`ltv_cac_x100`; and re-introduced the exact original H-1 flat-per-order `true_cm2_mu` SQL) and the gate turned **RED (exit 1) both times** with precise divergence messages, then GREEN on revert. The gate that was vacuous in round-1 is now decisively non-vacuous against the precise false-GREEN class that escaped it. **Verdict: PASS.** The DDR is partially signed (the 2 child_dependency rows correctly stay UNSIGNED-PENDING until Child-3 lands); the True-CM2 RTO-provision formula is recorded as canon below. Next is Stage-8 readiness — **no commit, no live DDL, no read-flip.**

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | Shipped change = the registry + canonical definitions + runbook-gated ClickHouse DDL + query-gateway + 9-field DDR the requirement asked for. No drift: zero live read-flip, zero live DDL, legacy untouched. Scope 4a/4b collapsed at Stage 2 with the gate-type distinction preserved (`parity_class`), exactly as `CF-C4-SCOPE-SPLIT-1` required. No Child-5/6 scope pulled forward (no AI read, no frontend). |
| **Paradigm audit** | PASS | `sql` exclusively. My grep: **zero** `@paradigm: haiku/sonnet/ml` anywhere in `packages/lib-metrics/src`, `apps/analytics-service/src`, `pylibs/brain_metrics/brain_metrics`. Every formula is pure integer arithmetic; LLMs never produce a number. No inference path → cost-routing audit clean (₹0/0-tokens this child). No paradigm escalation beyond plan. |
| **Architecture quality** | PASS | Single-Primitive held: ONE registry per language (byte-identity pair extending Child-2), ONE query-gateway entry-point, ONE DDR (machine + human view). `intDiv` template applied to every division. Taxonomy extended by exactly ONE justified 6th category (`COGS_SETTINGS_CHANGE_DELTA` — data-staleness genuinely distinct from formula-change). No per-channel/per-currency fork. |
| **Code quality** | PASS | Sampled 5 files (§ spot-checks). Comments explain WHY (canon source + why old formula was wrong), not WHAT. No 30+ line WHAT comments. Readable BigInt arithmetic. |
| **Security review pass-through** | PASS | Shreya round-2 PASS (`09b`); H-1 RESOLVED verified against actual files; she independently killed two on-disk mutants. M-1/M-2 logged as non-blocking tech debt. |
| **QA review pass-through** | PASS | Tanvi round-2 PASS (`10b`); 434 tests, 0 failures, stable 3×; F1 (coverage 67%→78%) + F2 (vacuous gate) both RESOLVED; she re-killed both registry-parity mutants herself. |
| **Observability complete** | PASS (proportionate) | Shadow build, no live serving path. Harness report fields (`clickhouse_roundtrip_checked`, `cogs_settings_change_delta_count`, `correctness_fixture_pass/fail`, `input_source`) + structured log on `UnscopedQueryError` + residency startup line. No runtime dashboards — correctly deferred to Child-5/6 (over-engineering check item: NOT gold-plated). |
| **Cost estimate held** | PASS | Planned ₹0/0-tokens (sql-only, zero inference); actual = zero inference path confirmed. Variance 0%. |

---

## DDR sign-off (the headline governance gate — CF-C4-DDR-1 / M-A1-Q2 — my authority)

I reviewed the 9-field Register (`definitional_delta_register.py` + `.md`), all 11 rows, and adjudicated each: is the legacy≠brain delta a **genuine** `expected_definitional_delta` (or a Brain-native `parity_gap`), or a **mis-filed bug**? I confirmed the two structural sign-off rules are enforced in code (`DDRRow.assert_signable()`): Rule 1 (parity_gap rows never signed as shadow-GREEN) and Rule 2 (child_dependency rows never signed before the dependency is GREEN). I ran the parity-gap / child-dependency helper queries to confirm the structural rules block the right rows.

| # | Row | parity_gap | child_dependency | My adjudication | Sign-off |
|---|---|:---:|---|---|:---:|
| 1 | `cm2_mu` | false | null | Genuine: Brain canonicalizes on `compute-daily.ts:234` daily; the `pnl.ts:195` lagged-range path is the documented divergence. `cm2 = cm1 − total_ad_spend`. Magnitude 0–5% on high-shipping days, bounded, correct direction. | **SIGNED** |
| 2 | `misc_expenses_prorated_mu` | false | null | Genuine: `intDiv(monthly, toDaysInMonth(date))`, NEVER a `30` constant. I independently verified Feb-28 → 35714 and the wrong-30 → 33333 (−2381 paise) bug class is BLOCKING_BUG, not rounding. The adjudication-discipline note ("ask: is Brain's toDaysInMonth correct?") is present. | **SIGNED** |
| 3 | `cogs_mu` | false | null | Genuine: scheduled full-recompute (NOT incremental MV) → zero delta vs legacy's nightly full recompute, by construction. `COGS_SETTINGS_CHANGE_DELTA` is correctly a distinct category, not smuggled as `EXPECTED_DEFINITIONAL_DELTA`. | **SIGNED** |
| 4 | `true_cm2_mu` | **true** | null | Brain-native, no legacy comparand (legacy stops at `cm2` line 234). RTO-provision formula pinned in full; worked example arithmetically correct (I re-derived: 6620000 paise). Routed to correctness-fixture gate. I acknowledge there is NO legacy shadow — I sign the **correctness of the formula**, not a shadow-compare GREEN. | **SIGNED (correctness-fixture acknowledgment)** |
| 5 | `pamer_bp` | **true** | null | Brain-native. `intDiv(cm2 × 10000, ad_spend)` = CM2/spend (CM2-first; replaces ROAS). Worked example 16000 bp re-derived correct. Correctness-fixture acknowledgment. | **SIGNED (correctness-fixture)** |
| 6 | `amer_bp` | **true** | null | Brain-native. `intDiv(true_cm2 × 10000, ad_spend)`. Worked example 13240 bp re-derived correct; aMER<paMER invariant holds (13240<16000). Correctness-fixture acknowledgment. | **SIGNED (correctness-fixture)** |
| 7 | `ltv_cac_bp` | **true** | null | Brain-native. `intDiv(ltv × 10000, cac)` = bp ×10000 (the canonical decision-metric scale; the old `ltv_cac_x100` is gone). Worked example 30000 bp (3.0×) re-derived correct. Correctness-fixture acknowledgment. | **SIGNED (correctness-fixture)** |
| 8 | `total_tax_mu` | false | **child-3-shopify-connector** | Genuine definitional delta (ShopifyQL day-level aggregate vs per-SKU GST-2.0 event-level), correctly NOT a bug. But it is **not measurable** while shadowing on legacy-sourced data — and it feeds Net-Net-Tax→CM1→the whole ladder. Magnitude estimate present (~0–2% homogeneous, ~5–10% mixed-slab). | **UNSIGNED-PENDING** (Rule 2; unlocks when Child-3 Shopify per-SKU tax lands GREEN) |
| 9 | `fx_restatement` | false | **child-3-workspace-cost-currency-migration** | Genuine: shadow-phase pins the SAME static 83.5 as legacy so the compare is not contaminated by two FX changes. Live-rate restatement is the post-Child-3 delta. Correctly held. | **UNSIGNED-PENDING** (Rule 2; unlocks when live FX / cost-currency migration lands GREEN) |
| 10 | `blended_roas_x100` | false | null | Genuine: display-only (`display_only:true`), ROAS never a decision metric (canon line 57). FLOOR vs ROUND, ≤0.01x. | **SIGNED** |
| 11 | `acos_bp` | false | null | Genuine: display-only, bp vs percent representation, ≤1 bp. | **SIGNED** |

**DDR sign-off summary: 9 SIGNED (rows 1–7, 10, 11) · 2 UNSIGNED-PENDING-child-dependency (rows 8 `total_tax_mu`, 9 `fx_restatement`).** I confirmed the structural rules genuinely block: the `parity_gap:true` rows route to the correctness-fixture gate (never shadow-GREEN), and both child_dependency rows are blocked from `assert_signable()` until their named dependency's gate is GREEN. No mis-filed bug is wearing the `expected_definitional_delta` label — the round-1 H-1 (the one real mis-classification risk: a divergent formula hiding behind `correctness_fixture` routing) is now closed by the non-vacuous registry-parity gate.

### True-CM2 RTO-provision formula — RECORDED AS CANON

Per my Stage-1 ruling and the business canon (`requirements/business-context.md:56` "True CM2 subtracts RTO provision + refund/payment-failure provisions"; line 58 RTO cost = forward+reverse+restock+write-down), I record the following as the **canonical Brain True-CM2 formula** for the migration epic:

```
true_cm2_mu = cm2_mu − rto_provision_mu
rto_provision_mu = intDiv( rto_orders × (total_ad_spend_mu + variable_costs_mu + cogs_mu),
                           total_orders_count )
NULL when total_orders_count <= 0.
ClickHouse: if(total_orders_count > 0,
              toInt64(cm2_mu - intDiv(rto_orders * (total_ad_spend_mu + variable_costs_mu + cogs_mu),
                      total_orders_count)),
              NULL)
```

**Canon adjudication note (recorded so the next child does not re-litigate):** the implemented provision uses the **average total cost base per order** (ad spend + variable + COGS, ÷ order volume) as the per-returned-order reversal cost. The business canon defines RTO cost more granularly as forward+reverse+restock+write-down per failed order. These are **not identical** — the implemented form is a defensible Phase-0 proxy (it captures the full economic cost a returned order destroys, which is the conservative direction True-CM2 wants), and it is `parity_gap:true` with no legacy comparand to contradict it. **This is a signed Phase-0 canon, NOT a final pricing-grade definition.** When refund/payment-failure provisions and the granular forward/reverse/restock/write-down cost components become available (a later child / the real cost model), the True-CM2 provision SHOULD be refined toward the canon's component form, and that refinement is itself a DDR row (the `formula_snapshot` immutability guarantees my signature here pins exactly the proxy form, so a silent swap is impossible). Recorded as a forward caveat for Child-5/6.

---

## Independent re-verification (I re-ran the load-bearing gates myself — captured output)

| Gate | What I did | Result |
|---|---|---|
| **Parity gate** | `bash tools/check-metrics-parity.sh` | **exit 0** — 25 byte-identical vectors + F3 + 16 shared metrics structural + 4 correctness_fixture SQL match + DDR coverage + killed-mutant sub-step PASS + CH round-trip fixtures present |
| **434 test suites** | `pytest` (analytics 41, brain_metrics 291) + `vitest` (lib-metrics 102) + `tsc --noEmit` | **41 + 291 + 102 = 434 passed, 0 failures; tsc exit 0** — matches Tanvi `10b` exactly |
| **Verify-the-verifier — mutation A** | Edited the REAL `definitions.ts`: renamed `id: 'ltv_cac_bp'` → `'ltv_cac_x100'` (the exact false-GREEN that escaped round-1), ran the gate | **exit 1 (RED)** — `MISSING DDR ROW id='ltv_cac_x100'`; `ltv_cac_bp` fell out of the shared set. Reverted → exit 0. |
| **Verify-the-verifier — mutation B** | Edited the REAL `definitions.ts`: replaced `true_cm2_mu` clickhouse_sql with the original H-1 flat-per-order `cm2_mu - (rto_orders * avg_rto_cost_per_order_mu)`, ran the gate | **exit 1 (RED)** — `CORRECTNESS_FIXTURE SQL DIVERGENCE id='true_cm2_mu'` with both TS and PY strings printed. Reverted → exit 0, working tree pristine. |
| **TS==Python==DDR for the 4 corrected metrics** | Read all three artifacts + ran the gate's Phase-2 SQL-equality | **CONFIRMED identical** for `true_cm2_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp`; `ltv_cac_x100` absent everywhere |
| **Worked-example arithmetic** | Re-derived in Python independently | True-CM2=6620000, paMER=16000, aMER=13240, LTV:CAC=30000, aMER<paMER ✓, Feb-28=35714 / wrong-30=33333 (−2381) ✓ |
| **Paradigm scan** | grep `@paradigm:(haiku\|sonnet\|ml)` across the 3 metric trees | **zero hits** — sql-exclusive confirmed |
| **Single-writer** | grep INSERT/UPDATE/UPSERT/DELETE/create/upsert against any legacy rollup table/model in Brain code | **zero write path** to legacy rollup |
| **intDiv / bare-`/`** | grep MV DDL | 17 `intDiv` uses; bare-`/` hits are SQL comments only |
| **Legacy untouched** | `git diff --cached --name-only \| grep 'legacy project/'` | **none staged** — `CF-BN-NOLEGACY-1` held |

**This satisfies the Stage-6 mandate (spot-re-run ≥3 of QA's gates with captured output).** I replicated 5: the parity gate, the 3 test suites, the registry-parity mutation (twice, on-disk), the worked-example arithmetic, and the paradigm/single-writer scans. Every PASS I claim is one I reproduced myself.

---

## Plan-binding confirmation

| Binding | Status |
|---|---|
| **Shape-A / HOLD-AT-READ-FLIP** (no live DDL, no live flip) | CONFIRMED — ClickHouse DDL is a runbook artifact (`apps/analytics-service/migrations/clickhouse/README.md` Stage-8-only); no execution path; no read-source flip. |
| **Single-writer C2 intact** | CONFIRMED — zero Brain write path to the legacy Postgres rollup (my grep); 3-pattern static gate + DB read-only-role startup assert. |
| **intDiv everywhere** | CONFIRMED — every MV division uses `intDiv` + null-guard; bare-`/` only in comments; BigInt FLOOR on the TS side. |
| **paradigm sql-exclusive** | CONFIRMED — zero inference path; zero `@paradigm:haiku/sonnet/ml`. |
| **No Child-5/6 scope pulled forward** | CONFIRMED — no AI read, no frontend, no live serving endpoint; the 2 child_dependency DDR rows correctly defer to Child-3. |
| **Legacy untouched** | CONFIRMED — `CF-BN-NOLEGACY-1`; no `legacy project/**` staged. |

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py` | Clean. 9-field frozen dataclass; `assert_signable()` enforces both structural rules with explicit error messages citing the CF rule. Day-one rows carry canon-grounded reasons. WHY-comments only. |
| `packages/lib-metrics/src/registry/definitions.ts` | Clean. Each corrected metric docstring cites the canon source, states the worked example numerically, and explains why the old TS formula was wrong. BigInt division commented as `// BigInt / = intDiv (FLOOR)`. |
| `tools/check-metrics-parity.sh` (step 6) | Clean. Real 3-phase per-metric content-equality check + inline killed-mutant sub-step. I verified it is non-vacuous by on-disk mutation, not by reading. |
| `apps/analytics-service/src/infrastructure/clickhouse/query_gateway.py` | Clean. `workspace_id` is the first non-optional positional param (the O5 false-GREEN class avoided); fail-closed `UnscopedQueryError`; bound-param predicate injection (no string interp). |
| `pylibs/brain_metrics/brain_metrics/parity/taxonomy.py` (extended) | Clean. `COGS_SETTINGS_CHANGE_DELTA` added as a distinct 6th category; `ROUNDING_MODE_MISMATCH` docstring audited to cover ONLY the Postgres ROUND_HALF_UP story (not a Float64 coercion artifact). |

---

## Over-engineering + clarity audit (mandatory)

- **Files staged not in the plan?** The 3 dump helpers (`registry-dump.ts`, `tools/registry-dump.py`, `tools/ddr-dump.py`) were added in the bounce-fix — they are **directly required** to make the registry-parity gate non-vacuous (the H-1 fix), small, single-purpose, pure-stdout. Justified, not gold-plating.
- **Observability/metrics/tests beyond plan?** No. Observability is proportionate (harness report + un-scoped alarm + residency line; no runtime dashboards). Tests target the parity/isolation/single-writer/correctness-fixture integration points + the kill-tests — not trivial getters.
- **Deps beyond plan?** No. `analytics-service` `dependencies = []` (the gateway uses an injected client; `clickhouse_connect` is not a live dep this shadow child). No new TS dep (registry extends `@brain/lib-metrics`).
- **New abstractions for "future use" (Single-Primitive)?** No. ONE registry per language, ONE gateway, ONE DDR, ONE taxonomy enum (extended by one justified category).
- **Plan length proportionate?** Yes — high-stakes, multi-builder, 1 CRITICAL + 10 CF binds; prescriptive depth warranted (verify-the-verifier is a recurring root cause).
- **30+ line WHAT comments?** None found.

**No over-engineering finding. No clarity finding.**

---

## Hard-rule deviation check (Stage-6 step 9)

Scanned all artifacts for: dependency violation · Single-Primitive violation · compliance gap · paradigm escalation beyond plan · gate-skip without codified exception. **NONE present.**
- Dependency: pre-flight clean (Child-0 done, Child-2 committed; Child-1 SATISFIABLE; Child-3 non-blocking per architecture line 515). The 2 DDR rows that DEPEND on Child-3 are correctly UNSIGNED-PENDING — that is the dependency rule working, not a violation.
- Compliance: DPDP residency ap-south-1 startup-assert present; metric path is aggregate integers (no PII); telecom N/A (no outbound channel). No ambiguity → no `/escalate`.
- Paradigm: sql-exclusive, no escalation.
- No gate skipped (high-stakes lane ran every stage).

Because there is no hard-rule deviation, the standing Founder delegation applies and I may sign the Founder gate on the Founder's behalf (§9).

---

## Cost audit

| Field | Value |
|-------|-------|
| **Planned tokens/day** | 0 (sql-only, zero inference path) |
| **Simulated daily-tick tokens** | 0 (no LLM/ML in the metric path — verified by paradigm grep) |
| **Variance** | 0% |
| **Within ±20% tolerance?** | YES |

---

## Risks remaining (carried to Stage-8 / downstream)

- **HELD for Stage-8 (named ownership gate, `HOLD-AT-READ-FLIP`):** apply the ClickHouse DDL (runbook); provision the analytics-service Postgres **read-only role**; provision ClickHouse Cloud **ap-south-1** (residency startup-assert will refuse-to-start otherwise); arm the `CACHE-PURGE-C4C5` gate before any Child-5 read. The live read-source flip additionally requires (i) exact-integer-equality parity GREEN on **Brain-Child-3-sourced** data (not just legacy-sourced — `CF-C4-PARITY-SCOPE-1`), (ii) the 2 UNSIGNED-PENDING DDR rows signed once Child-3 lands, (iii) my re-sign at that point.
- **2 DDR rows UNSIGNED-PENDING:** `total_tax_mu` (per-SKU GST tax) + `fx_restatement` (live FX) — unlock when Child-3 Shopify connector + workspace-cost-currency-migration land GREEN. Until then, `total_tax_mu` shadow-compare is **not measurable** and a GREEN on legacy-sourced data is **not a cutover license**.
- **MED tech debt (non-blocking, from Security):** M-1 single-writer grep `_SCAN_PATHS` doesn't cover `pylibs/`/`tools/` (DB read-only role is the structural backstop); M-2 residency marker is a substring match (operator-controlled config, realistic misconfig rejected). Fix opportunistically.
- **Cross-req staging hygiene (flagged by both reviewers):** the staged tree co-mingles Child-3 (`apps/ingestion-service/**`, `protos/`, run `c7fed9`) with Child-4. The mechanical commit command (§ `pending-founder-commit.md`) lists **Child-4 product-code paths only** — the Founder must NOT `git add -A`.
- **Verify-the-verifier:** the root cause recurred INSIDE this child (in-child, materialized — evidence #5; see retro + §below). Reinforced on the human-gated rule proposal; NOT self-adopted.

---

## Production-readiness assessment

Would Jatin's pre-deploy gates pass right now? **For this shadow child's scope, yes — and there is nothing live to deploy.** This child ships contracts + shadow code + runbook-gated DDL; no service surface changes, no CI/ArgoCD change, no live network path. Stage-8 readiness (the next step) is where Jatin provisions ClickHouse ap-south-1 + the read-only role and stages the DDL runbook — all HELD by design. The residency startup-assert and the fail-closed query-gateway are the production guardrails already in place for when the store goes live.

---

## Recommendation to Founder

**APPROVE-WITH-CAVEATS** (signed under standing delegation — see `12-founder-decision.json`).

### Caveats
- The DDR is **partially signed**: 9 rows signed; `total_tax_mu` + `fx_restatement` stay **UNSIGNED-PENDING-child-dependency** until Child-3 lands. The live read-source flip remains HELD (`HOLD-AT-READ-FLIP`) and requires my re-sign once those rows unlock and parity is GREEN on Brain-sourced data.
- The True-CM2 RTO-provision formula is signed as a **Phase-0 proxy canon** (cost-base-per-order), to be refined toward the canon's granular forward/reverse/restock/write-down + refund/payment-failure form in a later child (tracked via the DDR `formula_snapshot` immutability).
- **No commit performed** — commit the Child-4 product-code paths ONLY (see `pending-founder-commit.md`), not the co-staged Child-3 files.

### Founder briefing (60 seconds)

Child 4 builds Brain's honest-metrics engine — every KPI as one deterministic SQL formula computed identically in TS and Python, money in integer paise, with a governance register (the DDR) capturing every place Brain's number legitimately differs from the legacy number. Round 1 caught a real bug: four Brain-native decision metrics (True CM2, paMER, aMER, LTV:CAC) had different formulas in TS vs Python/DDR, and the gate meant to catch that was checking nothing. The team fixed it — one canonical formula each across all three artifacts — and rebuilt the gate so it genuinely fails on divergence. I re-verified this myself by deliberately re-breaking the code on disk and confirming the gate goes red. 434 tests pass, paradigm is pure SQL, single-writer and residency guards hold, legacy is untouched, and nothing goes live (the read-source flip is held to Stage 8). I've signed 9 of 11 register rows; the 2 tax/FX rows correctly stay unsigned until the Child-3 connector lands. Approved for Stage-8 readiness; no code committed (you commit at end-review, Child-4 paths only).

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "feat-metric-engine-olap-split",
  "verdict": "PASS",
  "recommendation": "APPROVE-WITH-CAVEATS",
  "ddr_signoff": {"signed": 9, "unsigned_pending_child_dependency": ["total_tax_mu", "fx_restatement"]},
  "founder_gate": "signed-under-delegation",
  "committed": false,
  "next": "stage-8-readiness"
}
```
