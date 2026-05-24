# CTO Advisor — Stage 1 SYNTHESIS (post-persona)

> Filled by Rohan (CTO Advisor), Stage 1 synthesis pass. Child 2 of EPIC `chore-migrate-legacy-to-brain`.
> This is the SECOND pass: the persona `money-finance-parity-realist:sonnet` returned (`03-persona-money-finance-parity-realist.md`); this folds its findings and finalizes the ADVANCE → Architect.
> Reads with: `01-requirement.md`, `02-cto-advisor-review.md` (first pass), `03-persona-money-finance-parity-realist.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-money-minor-units-parity` |
| **Stage** | 1 *(synthesis)* |
| **Timestamp** | 2026-05-24T13:12:00Z |
| **Decision** | **ADVANCE → Stage 2 Architect (Aryan), co-owned by Maya (intelligence-engineer)** |
| **Persona verdict** | **ACCEPTED** — 6 genuine concerns (1 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW); none dropped; the CRITICAL is the load-bearing finding named in the persona brief |
| **Escalation** | **None** — no compliance ambiguity, no cost-model threat, no moat change, no irreversible decision |

---

## Persona acceptance

The `money-finance-parity-realist:sonnet` persona is **accepted**. It is not a "looks good" persona — it surfaced one CRITICAL ship-blocker that lands exactly on the dominant numeric-parity dimension I scoped it for (CF-QA-1, the float-multiply landmine), plus two HIGH structural gaps in the harness comparison model that my first-pass scope did **not** close, plus three lower-severity fixture/type-contract sharpenings. Every legacy claim is cited file:line and was reasoned, not asserted.

**Two of these are genuine SCOPE REFINEMENTS, not re-derivation of the bound Child-0 design** (and therefore legitimately fold into Stage 2, not re-litigation of the spike):

1. **The string-typed API (Concern 1, CRITICAL).** CF-QA-1 in the binding architecture named "TS must operate at Decimal precision" as a *requirement*, but the Child-0 §A5.2 **skeleton itself encodes the wrong exported signature** (`decimalToMinorUnits(legacy_decimal: number)`). A `number` parameter is a source-level invitation for callers to do `Number(prismaDecimal)` — which is exactly the pattern at `compute-daily.ts:119` (`Number(dailyRow.netSales)`). The 6 CI vectors pass via the `1e-10` epsilon guard by **accident of magnitude**, not by proof. Fixing the *signature* (string-in, decimal-string arithmetic internally, TS-level rejection of non-string) is the one change that makes a float caller physically impossible. This sharpens CF-QA-1 from "must be Decimal-precise" to "the type signature must enforce string-in."

2. **The 5th harness category, ROUNDING_MODE_MISMATCH (Concern 2, HIGH).** My first-pass scope assumed the harness formula `ROUND_HALF_EVEN(legacy_decimal × 100) == Brain_MU` is universally valid. The persona showed it is **not** valid for fields derived from division: `workspace_daily_metrics.cm3` / `cogs` are already-rounded Postgres `Decimal(12,2)` intermediates (`miscExpensesProrated = monthlyAmt / daysInMonth`, `compute-daily.ts:243`), rounded by Postgres `ROUND_HALF_UP` *before Brain ever sees them*. Applying Brain's `ROUND_HALF_EVEN` to an already-`ROUND_HALF_UP`-rounded value produces a systematic 1-paise drift on `.X45` midpoints — which the 4-category harness (BLOCKING_BUG / EXPECTED_DEFINITIONAL_DELTA / EXCLUDED_FX_MISMATCH / RATIO_MISMATCH) would mis-classify as a permanent **phantom BLOCKING_BUG**, freezing the first live reconciliation. This is a real gap in the harness contract, surfaced now (cheap) instead of at the cutover (catastrophic). It is in-scope as a harness-*design* deliverable this child (the category + the re-derivation rule), with population deferred to the live run.

The remaining four (fixture-proof, subunit_multiplier, negative vectors, float-COGS accumulation) are fixture/type-contract sharpenings that fold cleanly into the Stage-2 binding contract.

---

## Folded CF-* constraint contract (carried to Stage 2 — none dropped)

All six persona concerns are folded into named carry-forwards. Each is tagged with its owner (Aryan = homes/contract/CI/reversibility; Maya = numeric mechanics/fixtures/byte-identity) and the persona concern it discharges.

| CF-id | Sev | Owner | Constraint (binding acceptance input for Stage 2) | Discharges |
|-------|-----|-------|----------------------------------------------------|------------|
| **CF-C2-STRING-API-1** | **CRITICAL** | **Maya** (impl) + Aryan (interface lock) | `decimalToMinorUnits` MUST take **`string`**, not `number`, in BOTH the TS and Python exported signatures. TS implements exact **decimal-string arithmetic** (parse on `.`, integer part × 100 + ROUND_HALF_EVEN on the exact fractional remainder using integer math only) — NOT `Number(str) * 100`. TS must reject non-string input at the **type level** (and a runtime guard that throws). May use `decimal.js` (already a Prisma transitive dep) OR a small audited inline pure function — Aryan rules which at Stage 2 (Single-Primitive: pick ONE, used everywhere). **Bind a CI fixture that passes `"1.255"` as STRING and proves the string path and the `Number()` path DIVERGE** for ≥1 value in the `Decimal(12,4)` ad-spend range — a PASS on the current 6 vectors does NOT prove this (they survive the `1e-10` epsilon by coincidence). The `1e-10` epsilon guard in the skeleton is REMOVED by the string path (no epsilon needed when arithmetic is exact). | Concern 1 (CRITICAL) |
| **CF-C2-RECON-TAXONOMY-1** | **HIGH** | **Maya** (semantics) + Aryan (report shape) | Add a **5th harness mismatch category `ROUNDING_MODE_MISMATCH`** for `workspace_daily_metrics` fields derived from division (`miscExpensesProrated`, `cm3`, and any per-day-prorated field). The harness MUST NOT classify these as `BLOCKING_BUG`. Re-derivation rule: when a field is division-derived, re-derive the legacy value using Brain's canonical Decimal path and compare THAT against Brain BIGINT — if it matches Brain, classify `ROUNDING_MODE_MISMATCH` (expected; legacy used Postgres ROUND_HALF_UP on the stored intermediate), NOT `BLOCKING_BUG`. Add `rounding_mode_mismatches_count` to the report shape. **Category + rule shipped this child; population is the deferred live run.** The set of division-derived fields MUST be enumerated explicitly in the Stage-2 plan (`cm3`, `miscExpensesProrated` at minimum; audit `cogs`, `totalAdSpend` per Concern 3/5). | Concern 2 (HIGH) |
| **CF-C2-FIXTURE-PROOF-1** | **HIGH** | **Maya** | The golden fixture set MUST include a **TS-specific probe fixture** that PROVES the string-vs-number paths diverge — a value (in the `Decimal(12,4)` ad-spend / coq range) where `Number(str) * 100` produces a float product that the `1e-10` epsilon mis-classifies and `Math.round` rounds the WRONG way, while the string path is correct. If such a value cannot be found analytically, document the search and the bit-pattern argument; the fixture must FAIL with the number path and PASS with the string path. A green CI without this fixture does NOT discharge CF-C2-STRING-API-1, and Tanvi's Stage-5 gate cannot assert CF-QA-1 from the test output alone. | Concern 3 (HIGH) |
| **CF-C2-SUBUNIT-1** | **MEDIUM** | **Maya** (semantics) + Aryan (type contract) | The `Money` value object MUST carry a **`subunit_multiplier`** field (default `100`), making the `×100` rule explicit + parameterized rather than hardcoded. INR/AED/SAR = 100 (current universe — no immediate correctness risk). KWD/BHD = 1000, JPY = 1 (ISO 4217 exponent) for the ae/sa Phase-4 seam. **This is a Child-2 type-CONTRACT decision, NOT deferrable to Phase 4** — adding the field after BIGINT columns are populated would require a value-rewriting column migration. The conversion function + harness comparator MUST read this field, not a hardcoded `100`. (Resolves my first-pass open question on whether this was Child-2 vs Child-4: persona confirms Child-2 type-contract.) | Concern 4 (MEDIUM) |
| **CF-C2-FLOAT-COGS-1** | **MEDIUM** | **Maya** | Pre-classify **COGS float-accumulation drift** as a known harness artifact: `ShopifyProduct.coq Decimal(12,4)` (`schema:431`) accumulated as `Number()` floats in `compute-daily.ts:151-157` can cross the 0.005-paise rounding threshold ONLY at very high line-item volume (>10k/day — above Sugandh Lok's current scale). Brain's per-line-item integer path is provably correct. Document this class in the harness design (likely a `ROUNDING_MODE_MISMATCH` sibling, or its own note) so a future triager does not chase a phantom Brain bug. Add an overflow/high-volume accumulation fixture. **Document this child; no live exposure.** | Concern 5 (MEDIUM) |
| **CF-C2-NEG-VECTORS-1** | **LOW** | **Maya** | Add **negative-amount vectors** to the binding fixture spec from `shopify_refund_line_items.subtotal_amount Decimal(12,2)` (`schema:911`): negative variants of all 6 banker's-rounding ties (e.g. `-1234.565 → -123456`), negative sub-paise, negative zero. The requirement explicitly calls out negatives/refunds (req lines 51, 55) but the 6 binding vectors are all non-negative. Must be in the fixture spec **before Tanvi's Stage-5 gate**. | Concern 6 (LOW) |

### Inherited carry-forwards (re-affirmed, fixed — do not re-derive)

- **CF-BN-NOLEGACY-1 (inherited, re-affirmed by Founder 2026-05-24):** legacy = **reference-only**. Migrate the *logic* (Decimal columns + `compute-daily` formulas as reference); ZERO import / edit / commit under `legacy project/`. Build Brain-native. Any builder touching live data or legacy code = drift bounce. This is now superseded-in-strength by CF-C2-STRING-API-1: do NOT port the legacy `Number()` pattern — the string-path is the Brain-native correction of the legacy anti-pattern.
- **CF-QA-1.HARD** (Maya/Aryan) — SHARPENED by CF-C2-STRING-API-1 (signature, not just precision).
- **CF-MAYA-2** (Maya) — `WorkspaceCost.currency @default("USD")` normalized to workspace primary currency at entry; the Money `currency_code` + `subunit_multiplier` semantics must support it.
- **Conversion rules** (M-A5-Q1/Q2): money → BIGINT paise ROUND_HALF_EVEN (×`subunit_multiplier`, default 100; universal paise even for 4-decimal sources); ratio → INT32 `FLOOR(×10,000)` `_bp`; count → INT64.
- **Harness engine** (M-A5-1): iteration grain (workspace,date,field) primary; fail-fast FIRST_DIVERGENCE; `@paradigm: sql`; zero float in the harness.
- **Scope hooks (present, unpopulated):** `expected_definitional_delta` classification hook for Child-4's Definitional-Delta Register.
- **CF-C2-PRIMITIVE-1 / CF-C2-GOLDEN-1 / CF-C2-NO-LIVE-1 / CF-C2-SCOPE-DEFER-1 / CF-C2-ENTRY-GATE-1** — carried unchanged from the first-pass review (§"Binding contract carried into Stage 2").

---

## Headline Stage-2 obligations (for Aryan + Maya)

1. **[CRITICAL] String-typed conversion API** — lock the exported signature (`string` in) in both `packages/lib-metrics` (TS) + `pylibs/brain_metrics` (Python), with exact decimal-string arithmetic and TS type-level rejection of `number`. One implementation primitive (Single-Primitive Rule). **(CF-C2-STRING-API-1)**
2. **[HIGH] 5th reconciliation category** — `ROUNDING_MODE_MISMATCH` + the re-derivation rule + the enumerated division-derived field list + the `rounding_mode_mismatches_count` report field. Design + rule this child; population deferred. **(CF-C2-RECON-TAXONOMY-1)**
3. **[HIGH] Divergence-proving fixture** — the TS string-vs-number probe fixture that fails on the number path. **(CF-C2-FIXTURE-PROOF-1)**
4. **[MEDIUM] `subunit_multiplier` on the Money type NOW** — default 100, parameterizes the ×100 rule; type-contract decision, not Phase-4-deferrable. **(CF-C2-SUBUNIT-1)**
5. **[MEDIUM/LOW] Fixture completeness** — float-COGS-accumulation artifact documented; negative-refund vectors added before Stage 5. **(CF-C2-FLOAT-COGS-1, CF-C2-NEG-VECTORS-1)**
6. **Unchanged guardrails** — golden fixtures only / zero live read / Child-4 deferrals intact / goalType `money|ratio` split in scope / entry-gate SATISFIABLE sufficient for design.

---

## Reaffirmations

- **Lane:** **high-stakes** (unchanged) — trigger surfaces `money` + `schema-proto`; the persona's CRITICAL confirms the high-stakes call (a `number` signature shipped to express/standard would have been a silent money-drift production incident).
- **Paradigm:** **sql** (unchanged) — deterministic value object + exact-integer comparator; zero float in the harness; no ML/LLM. The string-path correction reinforces this (exact arithmetic, no epsilon, no floating point).
- **Maya co-owns Stage 2:** **YES** (unchanged, reinforced) — five of the six folded CFs are numeric-mechanics/fixture/byte-identity work that is squarely Maya's (she authored Child-0 §A5.2). Aryan owns the package homes, the locked interface contract, the harness-engine location, CI wiring, and reversibility/staging.
- **Legacy = reference-only:** **CF-BN-NOLEGACY-1 re-affirmed** (Founder, 2026-05-24) — and now strengthened: do not port the legacy `Number()` float pattern; the string-path is its Brain-native correction.
- **Escalation:** **none** — no compliance ambiguity (no PII/channel/consent surface this child), no cost-model threat (pure sql, no LLM), no moat/Memory-Layer change, no irreversible decision (additive type + harness; live conversion deferred/gated; `subunit_multiplier` added NOW precisely to AVOID a future irreversible value-rewriting migration).

---

## Decision

**ADVANCE → Stage 2.** Owner: Architect (Aryan); co-owner: Maya (intelligence-engineer) for the numeric mechanics. The persona is accepted, all six concerns are folded into the named CF-* contract with owners, and the two genuine scope refinements (string-typed API, ROUNDING_MODE_MISMATCH category) are bound as Stage-2 deliverables rather than re-litigations of the fixed Child-0 design. No CHALLENGE-BACK (the requirement is precise and the architecture de-risked it), no KILL (binding non-negotiable C7 gate), no escalation.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T13:12:00Z",
  "actor": "cto-advisor",
  "type": "stage1-synthesis-advance",
  "req_id": "feat-money-minor-units-parity",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "stage": 1,
  "decision": "ADVANCE",
  "persona_accepted": "money-finance-parity-realist:sonnet",
  "persona_concerns_folded": 6,
  "persona_concern_severity": {"critical": 1, "high": 2, "medium": 2, "low": 1},
  "folded_constraints": ["CF-C2-STRING-API-1", "CF-C2-RECON-TAXONOMY-1", "CF-C2-FIXTURE-PROOF-1", "CF-C2-SUBUNIT-1", "CF-C2-FLOAT-COGS-1", "CF-C2-NEG-VECTORS-1"],
  "scope_refinements": ["string-typed-decimalToMinorUnits-signature", "5th-recon-category-ROUNDING_MODE_MISMATCH"],
  "next_agent": "architect",
  "maya_co_owns_stage2": true,
  "paradigm": "sql",
  "feature_class": "high-stakes",
  "legacy_reference_only_reaffirmed": "CF-BN-NOLEGACY-1",
  "escalation": "none",
  "rationale": "Persona accepted (6 genuine concerns, CRIT=string-typed API float-multiply landmine). All folded into CF-* contract with owners (Maya numeric mechanics, Aryan homes/contract/CI). Two genuine scope refinements bound as Stage-2 deliverables (string-in signature; ROUNDING_MODE_MISMATCH 5th category for division-derived cm3/cogs). subunit_multiplier added now to avoid future irreversible migration. Lane high-stakes, paradigm sql, Maya co-owns Stage 2, legacy=reference-only reaffirmed. No escalation."
}
```
