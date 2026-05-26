# Durable Rule — verify-the-verifier-mutation-on-gate

> Promoted to durable rule on 2026-05-26 by Founder. Source proposal:
> `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`.
> Evidence at adoption: **9 occurrences across 8 consecutive high-stakes children/slices** of the
> legacy→Brain migration epic (Children 1-7 + Phase-2 slices 2-3). The Stage-6 auto-candidate
> threshold (≥3 distinct runs) was crossed at occurrence #3; the pattern remained active through #9.

| Field | Value |
|---|---|
| **rule_id** | `verify-the-verifier-mutation-on-gate` |
| **adopted_at** | 2026-05-26T11:55:00Z |
| **adopted_by** | rishabhporwal (Founder) — agents cannot decide their own rules |
| **target_scope** | `stage-3-developer` + `stage-5-qa` (enforced) · `stage-2-architect` (informational — must name the gate's kill-test in the plan) · `stage-6-cto-final-review` (re-mutates on disk per Child-5+ precedent) |
| **status** | adopted |
| **adoption_decision_artifact** | `.engineering-os/decision-log/2026/05/2026-05-26.jsonl` (entry type: `rule-adoption`) |

---

## Rule statement (BINDING)

> **For every high-stakes GATE (a check whose GREEN authorizes an irreversible or security-/compliance-load-bearing act — RLS isolation, PII fail-closed, numeric-parity, HMAC/auth verification, fail-closed predicates), two conditions are MANDATORY at Stage 3 and re-verified at Stage 5:**
>
> 1. **The gate is exercised by its real integrated entrypoint with the real collaborator** — never a hand-built test double that manufactures the gate's trigger condition. The test calls the actual function the production path calls (e.g. `ingest_batch`, not a stub), bound to the actual registry/manifest/policy (e.g. the real `SHOPIFY_MANIFEST`), AND includes a negative control proving the gate does NOT false-positive.
>
> 2. **A mutation-style test proves the gate can FAIL** — i.e. there exists a captured mutant (gate removed / predicate inverted / encoding swapped) that the test suite KILLS. A gate with no killing test is treated as structurally inert and BOUNCES.
>
> The Stage-2 plan must name, per high-stakes gate, the kill-test and the real-path integration test that satisfy (1) and (2). The Stage-5 QA review must capture the killed-mutant output. Absence of either is a blocking finding, not a nit.

### Sharpened sub-rules (from Children 5-7 + slices 2-3 evidence)

3. **Inverse-mutant on every security control in the change**, not only the named VETO gates. Child-5 showed the failure migrates from named gates to *un-bound supporting* controls (Memory k-anonymity, spotlight `flagged`, Decision-Log correlation quad) when only the named gates are bound. Child-6 reproduced this on framework-internal closures (errorFormatter replica + `createCaller` skipping the serializer).

4. **The killed-mutant must invoke the production code path** — not a replica, not a `createCaller` that skips middleware, not a unit double of a framework-internal closure (errorFormatter, serializer, middleware). For framework-internal closures use a real-HTTP/integration fixture.

5. **For cross-language metric gates** (TS↔Python): the parity gate must compare **formula/behavior** (a worked numeric anchor that distinguishes the right formula from a plausible-wrong one), not just structural fields (`id/kind/unit/scale/parity_class`). Pin the anchor identically in both languages. Phase-2 slice-2 (#8) shipped a vacuous gate that hid a real CM1 overstatement (entire `variable_costs` line missing on the TS side); the anchor was the only thing that would have caught it without depending on a reviewer reading the code.

6. **Read the source-of-truth at intake, not the slice table**, when the slice prescribes a formula. Phase-2 slice-3 (#9) had a *correct* gate but a *wrong spec* (naive `r*=M/(M+C)` vs the real legacy `(V·P + (COD_fee − PG_fee) + P·(S+RS)) / (V + S + RS)`); without reading `cod-prepaid-analytics.ts:218-231` at Stage 1, a self-consistent wrong formula would have shipped GREEN. The non-vacuous anchor (`500bp` distinguished from `9493bp`) closed it.

7. **Stage-6 final review re-mutates on disk** for the high-stakes gates (precedent from Children 5-7 + slices 2-3). A bound-at-Stage-1 + non-vacuous-at-Stage-3 + re-mutated-at-Stage-6 gate has held in every child since #5; without the Stage-6 re-mutation the bound CF alone was *insufficient* (Child-4 #5 shipped vacuous despite `CF-C4-VERIFY-THE-VERIFIER-1` being bound).

---

## When this rule fires

- A code change introduces or modifies any check whose GREEN authorizes:
  - **Tenant isolation** (RLS, workspace-id enforcement, multi-tenant query gateway)
  - **PII fail-closed** (PII gate, allow-listed column inclusion/exclusion)
  - **Numeric parity** (TS↔Python metric registry, money-minor-units, FX, GST)
  - **Auth/integrity verification** (JWT verify, HMAC verify, webhook signature)
  - **Fail-closed predicates** (workspace allowlist, region assertion, compliance gates)
- A bug-fix touches an existing gate's predicate, encoding, or wiring.
- A test is added/modified that purports to verify any of the above.

If any of the above is true and a Stage-3 build does NOT carry (1)+(2) per the rule statement above (with the sharpened sub-rules where applicable), Shreya (Security) and Tanvi (QA) BOUNCE the build with a blocking finding.

---

## How to satisfy the rule (checklist)

For each high-stakes gate in the change, the Stage-3 builder produces:

- [ ] **Real-path test** — calls the production function with the real collaborator (real registry/manifest/policy). NOT a hand-built double that manufactures the gate's trigger condition.
- [ ] **Negative control** — proves the gate does NOT false-positive on a known-good input.
- [ ] **Killed mutant** — a captured-output proof that the test suite turns RED when the gate is mutated (removed / predicate inverted / encoding swapped). Mutant reverts to byte-identical.
- [ ] **Inverse mutant** (per sub-rule 3) on every security control in the change, not only the named VETO gates.
- [ ] **Production-path coverage** (per sub-rule 4) — the mutant invokes the actual code path. Framework-internal closures → real-HTTP/integration fixture.
- [ ] **Cross-language formula anchor** (per sub-rule 5) — for cross-language metric gates: a worked numeric anchor pinned identically in both languages, distinguishing the right formula from the plausible-wrong one.
- [ ] **Source-of-truth read** (per sub-rule 6) — if the slice prescribes a formula, the architect/builder reads the legacy source-of-truth and confirms (or contradicts and escalates) the slice's formula at Stage 1.

Stage-2 plan template lists each high-stakes gate with its kill-test + real-path test name.
Stage-5 QA review captures the killed-mutant output verbatim.
Stage-6 final-review re-mutates on disk per sub-rule 7 and reports the test-suite RED/GREEN transitions.

---

## Cost shape (informs Stage-2 plans)

- ~1 additional test per high-stakes gate (the real-path integration + negative control)
- ~1 captured-mutant output per gate (one-line shell capture, copy-paste into QA review)
- ~4-8 lines per high-stakes gate in the architecture plan (naming the kill-test + real-path test)

Net throughput: **faster** across an epic vs the pre-rule baseline (avoids the bounce round that hit 3/3 early high-stakes children).

---

## Out-of-scope (intentional)

- **Trivial checks** — getters, config reads, structural field assertions on configuration code. The recurring damage is concentrated in irreversible / security-load-bearing gates; scope the rule there.
- **Pure unit tests on internal helpers** that do not themselves authorize an irreversible/security-load-bearing act. Those continue under normal coverage discipline.
- **Performance / latency gates** — separate rule (if needed) on the SLO side.

---

## Follow-on actions (out-of-repo — Founder applies)

The plugin agent prompts + templates at `~/.claude/plugins/marketplaces/brain-engineering-os-marketplace/` need updates to land this rule mechanically:

- `agents/backend-developer.md` — DoD section: add 4-line bullet enforcing the Stage-3 checklist above for every high-stakes gate.
- `agents/qa-agent.md` — DoD section: add 4-line bullet requiring captured killed-mutant output for every high-stakes gate; VETO on missing.
- `agents/architect.md` — plan-template guidance: add 2-line instruction that every high-stakes gate must be listed with its kill-test + real-path test.
- `templates/architecture-plan.md` — add a "High-stakes Gate Inventory" table: gate → real-path test → kill-test → captured-mutant output location.
- `templates/qa-review.md` — add a "Captured Killed-Mutant Output" field.
- `skills/verification-before-completion/SKILL.md` (if present) — codify the "real-path entrypoint + negative control + killed mutant" triad.
- `docs/feature-tiering.md` (high-stakes lane section) — cross-ref this rule.

A diff proposal for each is at `.engineering-os/durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate__plugin-diff-proposal.md` (sibling file). Founder applies on the plugin side when ready; this rule binds Brain agents the moment the plugin diffs land.

---

## Rollback

If the rule causes throughput collapse (no observed scenarios pre-adoption but possible), file `/reject-rule` with the rationale; this file moves to `.engineering-os/durable-rules/_rejected/` with a rejection note. The proposal file under `rule-proposals/` retains the full evidence trail.
