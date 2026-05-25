# Requirement: Legacy decommission — strangler-fig final cutover + retirement runbook (Child 7)

> The final child of the legacy→Brain migration. A DESIGN/RUNBOOK child (no new app code): the ordered decommission sequence + final-state verification, gated on every prior child's HELD live cutover being executed + parity-signed. Rohan/Founder edit at Stage 1.

| Field | Value |
|-------|-------|
| **req_id** | `feat-legacy-decommission` |
| **Title** | Legacy decommission — final cutover sequence + retirement runbook (Child 7) |
| **parent_epic** | `chore-migrate-legacy-to-brain` |
| **epic_child_id** | `child-7-decommission` |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-25T07:12:00Z |
| **Tier impact** | all (retires the legacy authoritative stack) |
| **Region impact** | in (ap-south-1; legacy plaintext credential destruction) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | *(set by Rohan)* — expected **high-stakes** (irreversible retirement + credential destruction + data-authoritativeness handoff) but **design/runbook-only** (no code; execution is Stage-8/Founder-gated) |
| **trigger_surfaces_touched (first-pass)** | `india-compliance` (DPDP — legacy PII store retirement + plaintext cred destruction), `auth`/`connectors` (single-owner handoff completion), `multi-tenancy`, `schema-proto` (data-authoritativeness final state) |
| **paradigm (first-pass)** | `sql`/runbook (no compute; ordered decommission + verification) |

---

## Raw text (from Founder)

> Complete the application migration as per Brain's Architecture, end to end. (Standing directive: complete all epic children; Founder checks at the end.)

---

## Problem statement

Child 7 of the strangler-fig migration — the retirement. Children 1-6 built Brain-native RLS/tenancy, money, connectors, metric engine + OLAP, AI engine, and the frontend, each with its live cutover HELD behind a named state (HOLD-AT-FORCE, HOLD-AT-CUTOVER, HOLD-AT-READ-FLIP, HOLD-AT-SERVE, HOLD-AT-ROUTE-FLIP). Child 7 defines the ONE safe ordered sequence to flip those holds, verify Brain authoritative + at parity per context, destroy the legacy plaintext credentials, and shut down + archive the legacy `looqus` stack — reversibly per step until the point of no return, which is named explicitly.

There is NO new application code in this child. The deliverable is the **decommission runbook + final-state verification checklist + the point-of-no-return ledger**. Legacy is already reference-only and untracked from git; this child plans its runtime retirement.

## Scope (from Child-0 architecture — Rohan to confirm at Stage 1)

**In scope (runbook/design only):**
- **The ordered hold-release sequence** across Children 1-6: the dependency-correct order to execute the HELD live cutovers (e.g. RLS FORCE only after Child-3 residual-writer conversion + complete bare-write grep GREEN; read-flip only after metric parity GREEN on Brain-sourced data; serve-flip + cache-purge after read-flip; route-flip per route group), each with its parity/verification gate + rollback tree + the explicit point-of-no-return.
- **Per-connector single-owner handoff completion** + **legacy plaintext credential destruction** (C8) — only after Brain custody proven (the Child-3 write→auth-test→parity→seal→delete sequence); Shiprocket last.
- **Final-state verification:** every bounded context Brain-authoritative + at parity; the Definitional-Delta Register fully signed (the 2 Child-4 pending rows: total_tax_mu + FX, now satisfiable post-connector-cutover); zero Brain read path to legacy rollups; legacy AI/Ollama/SystemSettings.ollamaUrl retired.
- **Legacy stack shutdown + archive:** the looqus app + its DB → archived (DPDP retention-compliant) then decommissioned; the residency-compliant final disposition.
- **The compliance close-out:** DPDP accountability for the retired PII store; the deferred chore-security-governance-hardening-phase handoff.

**Out of scope:**
- Any new Brain application code.
- Executing the cutovers (that is Stage-8, Founder-gated, per the named holds — this child PLANS the execution).

## Dependencies
- ALL of Children 1-6 (committed-on-branch / at readiness). Child 7's EXECUTION is gated on each prior child's HELD cutover being flipped + parity-signed — this child sequences that.

## Constraints carried forward (Rohan to bind)
- `CF-BN-NOLEGACY-1` (no legacy edits — it's being retired, not modified), `CF-RES-1` (residency through archival), `CF-SEC-SECRETS-1` (plaintext destruction only after Brain custody proven), DPDP retention/erasure for the retired store, single-owner C8, single-writer C2 final state, the Definitional-Delta Register full sign-off (Rohan).

## Notes for Stage 1 (Rohan)
- This is a **design/runbook child** (like Child-0 the spike) — right-size it: intake → decommission runbook (Aryan) → your Stage-6 sign-off. No code build / no Shreya+Tanvi code review of nonexistent code; the compliance + reversibility review IS the gate. Consider a compliance/decommission-safety persona if warranted (the irreversible point-of-no-return + plaintext destruction is the risk).
- The point-of-no-return + the rollback tree per hold-release are the load-bearing artifacts.
- This child's EXECUTION belongs to the Founder + Jatin at the eventual production cutover; the runbook is the binding plan.
