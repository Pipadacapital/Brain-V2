# Retro — `feat-legacy-decommission` (Child 7, FINAL — closes the 7-child migration epic)

> Filled by Rohan (CTO Advisor) at the close of Stage 6. Append-only. Feeds `.engineering-os/lessons-learned.md`.
> This retro is BOTH the Child-7 retro AND the **epic-wide retro** for `chore-migrate-legacy-to-brain` (Child 7 is the terminal child).

| Field | Value |
|-------|-------|
| **req_id** | `feat-legacy-decommission` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (the epic) |
| **Shipped at** | 2026-05-25T13:10:00Z (runbook PASS; execution Stage-8-gated) |
| **Author** | cto-advisor (Rohan, on the Founder's behalf under delegation) |

---

## What worked (concrete patterns to replicate)

- **The runbook-as-architecture-plan shape (Child-0 analogue) was exactly right for a no-code child.** No Stage-3/4/5 build; my compliance + reversibility review IS the gate; Tanvi degraded to artifact-completeness, Shreya to design-level VETO. The rigor landed on the PoNR ledger (the load-bearing artifact), not on tests of nonexistent code. Same degradation Child-0 used — a proven pattern for the two design children that bookend the epic.
- **The per-hold PoNR ledger forced the irreversibility to be honest.** Every PoNR (L1/L3/L6/L7) names its precondition, a positive-proof verification (a vendor-200 via the prod custody path, a parity exit-0 on Brain-sourced data, an archive restore-test — never a flag-read), and a rollback tree valid until that exact line. The ledger invariant ("no PoNR crossed before dependency parity signed AND gate GREEN AND festival GREEN AND Founder authorizes") is the single best artifact in the whole epic for making a dangerous operation safe.
- **The 1-persona `:sonnet` call was correct and high-yield.** `dpdp-decommission-safety-realist:sonnet` returned 5 grounded concerns (3 HIGH + 2 MED), all accepted, none downgraded. It sharpened 3 of my intake rulings and added 2 net-new enforceable gates (the 24h serve→read dwell + festival-as-machine-gate). Single dominant risk dimension → 1 persona, reasoning-heavy → :sonnet. Textbook.
- **Firing the custody escalation as an ADDENDUM to the open Child-3 thread (not a new /escalate) kept the Founder's view coherent.** One custody ask, sharpened across two children, instead of two competing threads. The "decide A/B is necessary but not sufficient — the seal() must be IMPLEMENTED" delta was the load-bearing insight, grounded in the actual `NotImplementedError` stubs.
- **Referencing (not re-deriving) each child's gate held the line.** The runbook sequences Child-1 down.sql, Child-3 A4 tree, Child-4 read-flip, Child-5 CACHE-PURGE-C4C5, Child-6 route-flip — it never restates them. Zero drift risk, proportionate length.

---

## What didn't work (concrete patterns to avoid)

- **My intake ruling (b) under-specified "Brain custody proven."** I treated "sealed in Brain secrets manager" as a *state to verify* without checking the seal mechanism *exists in code*. It does not — it is a `NotImplementedError` stub in both backings. The persona caught it. Lesson: when a gate's precondition names a mechanism, verify the mechanism exists in code at intake, don't assume the prior child shipped it. (This is the verify-the-verifier lineage applied to a precondition rather than a test.)
- **The legacy bare-write grep being DEFECTIVE (excluded `backfill*`/`discoverChannels`) propagated as a latent risk all the way to the FORCE-release pre-req.** It was caught (C3 FR:67, carried into L0), but a defective verification tool that survives multiple children is a smell — verification tooling needs its own correctness check, same as the gates it feeds.
- **The custody stub was deferred across Child-3 → Child-7 as "a config swap" — a fiction that nearly survived.** You cannot config-swap between two stubs. The deferral language ("config swap") masked that no implementation existed on either path. Lesson: "deferred as a config swap" is only honest if at least one real implementation exists to swap to.

---

## What surprised us

- **The single highest-irreversibility step in a 7-child program turned out to be a credential DELETE, not a data migration.** Shiprocket's no-replay plaintext-delete on an unproven custody path = a dead connector with no recovery — a bigger blast radius than any schema cutover. The persona named it as #1 and was right.
- **"Archive" and "decommission" being TWO dates (potentially months apart) is a non-obvious DPDP subtlety that an engineer would naturally conflate.** Shutting down the app ≠ deleting the archive; the §12 obligation persists while the PII archive exists. Binding this as two separate dated PoNRs (L6/L7) was a real save.
- **The festival window — an India-commerce domain constraint — became a hard machine gate on an infrastructure operation.** A DB shutdown during Diwali (COD 4×, max GMV) is max blast radius for the anchor brand. Converting "should not schedule" prose into a `workspace_festivals` query gate is the kind of domain-economics-meets-ops binding the canon exists to force.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | For a no-code design/runbook child, the PoNR ledger (precondition + positive-proof verification + rollback-until-the-line per irreversible step) is the load-bearing artifact; rigor lands on the design review, not on tests. | `migration`, `process`, `infra` | Child-7 §6 ledger; Child-0 analogue precedent |
| 2 | When a gate's precondition names a mechanism (e.g. "custody proven via seal()"), verify the mechanism exists in CODE at intake — do not assume a prior child shipped it. A stub passes a state-check but fails the operation. | `agent-discipline`, `security`, `migration` | C7-D-001; custody NotImplementedError stubs survived Child-3→Child-7 as a "config swap" fiction |
| 3 | No PoNR may pass on a flag-read — each irreversible step needs a positive proof (a live 200 via the real path, a parity exit-0 on the AUTHORITATIVE source, a restore-test). | `migration`, `numeric-parity`, `security` | Child-7 §6 invariant; L1 prod-custody-path-200 closes the legacy-column-read bypass |
| 4 | DPDP §12: a retired PII archive stays erasure-scopable; a flat pg_dump is NOT §12-compliant (no scoped DELETE without full restore); "archive" and "decommission" are two separate dated obligations. | `india-compliance`, `migration` | Child-7 §9 ALPHA/BETA vs rejected pg_dump; L6/L7 two dates |
| 5 | Couple holds whose rollback trees overlap with a signed dwell gate — advancing two irreversible holds in one console session can silently destroy a rollback tree (serve→read coupling). | `migration`, `process` | C7-D-003; CF-C7-SERVE-READ-COUPLING-1 24h dwell |
| 6 | A "first parity GREEN" on the wrong source (legacy-sourced) must not license a cutover; gate the PoNR on a SECOND parity run against the authoritative (Brain) source after the upstream dependency is live. | `numeric-parity`, `migration` | CF-C7-DDR-GATE-1 P1 vs P2; total_tax_mu not measurable on legacy-sourced data |
| 7 | India domain constraints (festival peak windows) belong as machine gates on infra operations, not advisory prose — a cutover during Diwali is max blast radius for the anchor brand. | `india-compliance`, `infra` | CF-C7-FESTIVAL-WINDOW-1 workspace_festivals query |

**Applies-to tags used:** `migration`, `process`, `security`, `india-compliance`, `numeric-parity`, `agent-discipline`, `infra`.

---

## Epic-wide retro — `chore-migrate-legacy-to-brain` (the 7-child arc)

> Child 7 closes the epic. The arc deliverable is the strangler-fig migration of the legacy `looqus` DTC analytics stack into the Brain-native architecture, end to end, with the production cutover held for the Founder.

### The verify-the-verifier lineage (#1–#7) — the epic's defining discipline
The single most durable pattern across the epic was **verify-the-verifier**: at every Stage-6, I (Rohan) independently re-ran or mutated the gates the builders/QA claimed GREEN, and the failure repeatedly migrated to supporting tests when the named gate was beaten. It recurred **7 times** (tracked as evidence #1–#7 in `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`, NOT self-adopted — awaits `/adopt-rule`). Child-7's analogue: I independently confirmed the runbook's 4 load-bearing references resolve to real code/schema/tooling (the custody stubs, the festival table, the legacy AI path, the parity harness) — a runbook can be "internally consistent" and still be grounded in fiction; the verify-the-verifier reflex caught that it was not. **This is the candidate durable rule the epic earned.**

### The held-cutover discipline — every child shipped behind a NAMED hold
No child executed a live cutover. Each parked its irreversible step behind a named hold (HOLD-AT-FORCE / -CUTOVER / -READ-FLIP / -SERVE / -ROUTE-FLIP), built + LOCAL-verified the cutover code, and stopped. Child-7's job was to write the ONE safe order to release those holds. This is why the epic could run autonomously end-to-end while keeping every irreversible production action Founder-gated — the holds are the seam between "the agents build it" and "the Founder executes it." This discipline is what made an autonomous 7-child migration of a live, PII-bearing, money-bearing system safe.

### The runnable-app delivery — the success metric was met honestly
The Founder's standing acceptance bar was "a runnable app I can see." Child-6 delivered a LOCAL runnable vertical (gateway BFF + auth/tenancy + data-plane read + web Command Center + mobile Morning Brief) against seeded Sugandh-Lok data, behind the route-flip HOLD, exercising the REAL data path (registry/query-gateway), not hand-typed numbers — so the render-only invariant was actually exercised. The app runs; the numbers are honest (bigint MU end-to-end, formatMoney at the edge only); nothing live was cut over. The epic did not confuse "demo-able" with "deployed."

### All 7 children — status roster (see epic close-out statement in my return)
Children 1–6 at Stage-8 readiness behind their holds; Child-7 (this) PASS — the runbook that sequences their release. The epic is fully planned/built end-to-end; what remains is the Founder-gated Stage-8 production cutover, executed against the Child-7 runbook.

---

## Action items for next child

> There is no "next child" — Child 7 is terminal. These are action items for the **Stage-8 execution** and the **next epic** (`chore-security-governance-hardening-phase`).

- [ ] Before any Stage-8 plaintext-delete: Founder ships a REAL custody `seal()` (Option A AWS Secrets Manager ap-south-1, or Option B Supabase encrypt-in-place Sugandh-Lok-only) — the build_gated_on prerequisite. The custody stubs must be replaced, confirmed non-`NotImplementedError`, before AUTH-DELETE.
- [ ] At Stage-8, post-Shopify-cutover: Rohan signs the 2 remaining DDR rows (`total_tax_mu` + `fx_restatement`) on Brain-Child-3-sourced data before the read-decommission PoNR.
- [ ] Run `/adopt-rule` on `2026-05-25__verify-the-verifier-mutation-on-gate.md` — 7 occurrences across the epic is well past the ≥3 codification threshold; it is the epic's earned durable rule (human-gated; do not self-adopt).
- [ ] `chore-security-governance-hardening-phase` picks up: Consent-Manager registration ahead of the DPDP 13-Nov-2026 / 13-May-2027 milestones, the field-level PII catalog as a standing artifact, breach-scope tooling, AWS Secrets Manager activation (WS-1), credential rotation.

---

## Cost + paradigm reality vs plan

| Metric | Planned | Actual | Variance |
|---|---|---|---|
| Monthly $ cost | ₹0 net-new (runbook) | ₹0 net-new | 0% — child REDUCES cost at final state (retires legacy uncapped LLM path) |
| LLM tokens / day | 0 (sql/runbook, zero inference) | 0 | 0% |
| Wall-clock duration | 1 intake + 1 persona + 1 plan + 1 review | as planned | on-plan |
| Paradigm declared | sql/runbook | sql/runbook | MATCH — zero @paradigm, zero LLM client, zero new runtime |
| Persona count | 1 (`dpdp-decommission-safety-realist:sonnet`) | 1 | MATCH |

**Calibration note for next time:** For no-code design/runbook children, the verify-the-verifier reflex still applies — re-target it from "re-run the test gates" to "confirm the runbook's load-bearing references resolve to real code/schema/tooling." A runbook that is internally consistent but grounded in a non-existent mechanism (the custody stub) is the failure mode; check grounding, not just consistency. And: when a precondition names a mechanism a prior child was supposed to ship, grep for it at intake — do not infer its existence from a "deferred as a config swap" note.
