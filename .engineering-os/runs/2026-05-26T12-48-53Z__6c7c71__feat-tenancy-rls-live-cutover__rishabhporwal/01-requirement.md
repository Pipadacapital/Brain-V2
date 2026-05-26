# Requirement: Tenancy RLS — live FORCE cutover with legacy-app coexistence

> Filled out by `/requirement <text>` (Founder submitted from the
> `.engineering-os/requirements-draft/feat-tenancy-rls-live-cutover.md` draft).
> Canonical body for this run; the draft remains in `requirements-draft/` as
> Founder's pre-intake authoring artifact.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Title** | Tenancy RLS — live FORCE cutover with legacy-app coexistence |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-26T12:48:53Z |
| **Tier impact** | all (foundational — multi-tenancy underpins every tier) |
| **Region impact** | in (ap-south-1; same live shared Postgres as predecessor) |
| **Parent epic** | `chore-migrate-legacy-to-brain` (Child-1 follow-on; this is the slice that finally closes the OPEN P0) |
| **Predecessor** | `feat-tenancy-rls-brain-native` (Stage 8 done; code MERGED to `origin/development` via PRs #1+#2; HOLD-AT-FORCE) |

---

## Lane *(set by Rohan at Stage 1 — leave blank at intake)*

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Multi-tenancy + LIVE PROD DB blast-radius + DPDP §4 PII processing + irreversible-if-mishandled (0-row outage = customer outage). No carve-out — the foundational-scaffolding carve-out is explicitly barred by live-data/PII/india-compliance presence. Conservative tie-break forbids downgrade. Set by Rohan, Stage 1. |
| **trigger_surfaces_touched** | `multi-tenancy`, `pii`, `india-compliance`, `schema-proto` (RLS DDL on live), `connectors` (legacy app is a connector-class consumer; its connection identity is the load-bearing decision) |

---

## Raw text (from Founder)

> Close the OPEN P0: design + execute the live FORCE-flip ceremony for the Brain-native RLS that's already shipped to `origin/development` (PRs #1+#2). The legacy Express/Prisma app still hits the same live shared Supabase Postgres (`ap-south-1`) — without explicit legacy-coexistence handling, FORCE = 0-row outage for every live brand using the legacy frontend.
>
> Pick the smallest, safest path that (1) closes the OPEN P0, (2) does NOT silently break the legacy app, and (3) keeps the FORCE flip reversible. Four candidate paths in the draft (A1 / A2 / B / C) with claude-code recommending **Path C** (quiesce + force + service-role bypass for legacy → schedule legacy retirement separately).

---

## Why now — the OPEN P0 it closes

The live shared Supabase Postgres (`ap-south-1`) has **45 models / 66 `workspaceId` refs / 0 RLS**: zero row-level cross-tenant isolation in production today. The Child-1 fix (`feat-tenancy-rls-brain-native`) shipped to `origin/development` — the Brain-native migrations (`apps/core-service/migrations/manual/rls/{step-a-enable-create,step-b-force,down}.sql`), the `withWorkspace()` session-context primitive, the rollout-runbook, the CF-SEC-1 probe — all exist and are LOCAL-verified.

What's blocking the live FORCE flip is **not** the Brain code. It's the **legacy Express/Prisma app still hitting the same prod DB**: that app does NOT call `set_config('app.workspace_id', …)` on its connections, so the moment we `ALTER TABLE … FORCE ROW LEVEL SECURITY`, every legacy query against a non-bypass connection returns ZERO rows — that's an outage for every live brand still using the legacy frontend, not a leak fix.

This requirement designs and executes the live-cutover ceremony with explicit legacy-coexistence handling, so the FORCE flip is safe end-to-end.

---

## Problem statement

Three coupled constraints:

1. **Tenancy leak risk is OPEN today** — DPDP §4 obligation against the data principal is breached on every cross-workspace query the legacy app accidentally runs (and there's no policy preventing it).
2. **Legacy app cannot be silently broken** — Sugandh Lok and any other live workspace using the legacy frontend must keep working through the cutover. A 0-row outage is not acceptable.
3. **The FORCE flip must remain reversible** — `down.sql` is the rollback, but only useful if the FORCE doesn't itself wedge sessions before rollback can be issued.

Pick the smallest, safest path that closes (1) without violating (2) or (3).

---

## Target user

Foundational/internal — protects every Brain workspace (= tenant = brand = billing unit). Direct beneficiary: the anchor brand Sugandh Lok and every future multi-brand tenant. The end-user value: no brand can ever read another brand's data in the prod DB; no live brand silently 0-rows during the cutover.

---

## Success metric

- **0 cross-tenant leaks** on LIVE prod DB — `CF-SEC-1` cross-workspace probe = ZERO rows for any non-bypass role; same-workspace returns expected rows.
- **0 customer outage** during the cutover — at least Sugandh Lok's legacy frontend renders the same row counts pre/post FORCE.
- **Reversibility proven** — `down.sql` + the chosen-path shim removal exercised end-to-end on a staging clone within a stated time budget (target ≤ 60 s).
- **Audit trail complete** — Decision Log entry; runbook output captured in the run folder; CF-SEC-1 output captured; chosen-path rationale + service-role-bypass connection-identity (under Path C) explicitly named.

---

## Two paths (Founder decides ONE at intake or at Stage 2 with Aryan)

### Path A — Legacy-app DB-side shim (RLS goes live FIRST, legacy keeps running)

Add a connection-level shim so the legacy Prisma client sets `app.workspace_id` from the session before any query runs. Two shapes:

- **A1 — Prisma middleware shim** in the legacy backend that calls `SELECT set_config('app.workspace_id', $1, true)` on each transaction, sourced from the JWT/session.
  - Pros: minimal blast radius — only `legacy project/backend/` changes, no DB change.
  - Cons: requires touching the legacy codebase, which Founder ruled "reference-only" (`feedback_legacy_is_reference_only.md`).
- **A2 — `SECURITY DEFINER` role-switch function** invoked by a `BEFORE TX` Postgres extension or by a per-session pgbouncer hook that derives `workspace_id` from the verified JWT in a header.
  - Pros: no legacy code change.
  - Cons: more infra (pgbouncer custom auth), more moving parts, harder to test.

### Path B — Retire the legacy app FIRST, then flip FORCE (no shim)

Sequence: complete the Brain web app's parity to "fully replaces legacy frontend" → cut all live brands over to Brain web → shut down the legacy Express app → then run the FORCE ceremony with no live legacy traffic to worry about.

- Pros: no shim, no legacy code change, cleanest end state. Lines up with "legacy is reference-only."
- Cons: blocks closing the P0 on parity completion + customer cutover, both of which are weeks of work. The leak window stays open for that whole period.

### Path C (hybrid) — Quiesce-then-force-then-flip with scoped legacy bypass

Sequence: schedule a brief maintenance window → quiesce legacy app + cron → run `step-a-enable-create.sql` then `step-b-force.sql` → keep RLS on but issue a temporary, **narrowly-scoped service-role-style bypass** for the legacy app's connection identity (legacy keeps reading via that bypass; Brain reads via `rls_app` with workspace context) → schedule the legacy retirement separately.

- Pros: closes the cross-tenant-leak risk for every NEW connection (Brain `rls_app`, future services) within one cutover window — the OPEN P0 is closed at the storage layer.
- Cons: the legacy connection still has effective ALL-WORKSPACES access via the bypass — the leak surface shrinks but doesn't vanish for that single code path. Acceptable only if the legacy app is single-tenant-per-process or audited to never run cross-workspace queries.

**Recommended (Founder's claude-code draft):** Path C as the immediate close, sequenced to Path B as the final close.

---

## Deliverable bar

1. **Coexistence design (Aryan, Stage 2)** — pick A/B/C with binding rationale; document the legacy-connection identity that gets the service-role-style bypass (if C); name the rollback contract.
2. **Cutover runbook augmentation (Vikram, Stage 3)** — extend `apps/core-service/migrations/manual/rls/rollout-runbook.sh` with:
   - Pre-flight: assert region (`ap-south-1`) on BOTH `:6543` pooler AND `:5432` direct.
   - STEP 1: quiesce crons (already in runbook).
   - STEP 2: enable + force RLS (steps A + B sequenced per `rollout-runbook.sh`).
   - STEP 3 (NEW): apply legacy-coexistence shim per chosen path.
   - STEP 4: CF-SEC-1 cross-workspace probe (existing).
   - STEP 5: smoke-test the live legacy app against a known workspace; confirm reads return the same row counts as pre-FORCE.
   - Hardened rollback: `down.sql` MUST drop the policies AND remove the shim atomically, with measured maximum time-to-rollback.
3. **CF-SEC-1 GREEN against LIVE prod DB** (Tanvi, Stage 5) — the probe that's only run LOCAL today runs against the live pooled connection and proves cross-workspace = ZERO rows; same-workspace = expected non-zero.
4. **Decision-log entry (Maya, Stage 5)** — write the cutover decision + the coexistence-shim audit trail into `ai.decision_log`.
5. **Founder Stage-8 ceremony** — Founder-at-console executes the runbook on the live prod DB, with rollback armed.

---

## Acceptance bar (binding inputs for the reviewers)

- **CF-SEC-1 GREEN on LIVE** — un-scoped query against `rls_app` returns ZERO rows; same-workspace returns expected rows; cross-workspace returns ZERO. Captured output in the run folder.
- **Legacy app smoke-test PASS** — at least one known live workspace's legacy frontend renders the same row counts as pre-cutover. No 0-row outage.
- **Reversibility proven** — `down.sql` exercised in a staging clone; the FORCE → DROP POLICY → bypass-remove path completes within a stated time budget (e.g. ≤ 60 s).
- **No legacy code change** (if Path C) — `git diff -- "legacy project/"` = 0 lines.
- **Audit trail** — Decision Log entry; runbook output captured in the run folder; CF-SEC-1 output captured.
- **Reversal-rate budget** — Founder pre-commits the rollback trigger (e.g. "if any live brand reports a 0-row outage within 30 min post-flip, immediately run down.sql").

---

## Verify-before-report (Founder directive)

- **Local:** re-run the existing `rollout-runbook.sh` against `brain-postgres-dev` (already proven LOCAL-verified Child-1); add the new STEP 3 + 5 and confirm idempotent + clean rollback.
- **Staging:** provision a staging clone of the live DB (or use a CDC snapshot in `brain_test`); run the FULL augmented runbook against it; confirm CF-SEC-1 GREEN + legacy-app smoke PASS.
- **Live:** Founder-at-console ceremony. No agent executes against live prod DB.

---

## Constraints

- Legacy is **reference-only** — `feedback_legacy_is_reference_only.md`. Paths that require legacy code edits (A1) are heavily disfavored by Founder canon.
- Live shared Postgres is in `ap-south-1`; region MUST be asserted on BOTH pooled (`:6543`) and direct (`:5432`) URLs before any RLS DDL (CF-RES-1.a, inherited).
- DPDP §4 lawful basis: Founder is legal owner/controller of Sugandh Lok (the only in-scope brand); CF-SEC-3.HARD re-arms before any third-party-brand PII is processed (inherited from Child-1, not re-triggered by this slice).
- No commit without explicit Founder "commit it"; feature-branch only (`feedback_commit_authorization_harness_guard.md` + `feedback_no_commits_without_founder_approval.md`).
- The Brain-native RLS code, `rls_app` role, `withWorkspace()`, migration files, and runbook ship as-is — this slice EXTENDS the runbook + adds a coexistence shim; it does NOT modify the existing Brain-native primitive.

---

## Non-goals

- Does NOT retire the legacy app (separate slice; Path B can be filed as a follow-on once parity is complete).
- Does NOT change any Brain-native code that already shipped — `withWorkspace()`, `rls_app` role, migration files, runbook are all reused as-is.
- Does NOT touch the connectors framework / Child-3 cutover ceremony (those have their own HOLD-AT-CUTOVER gate and an unrelated custody decision A/B).
- Does NOT touch ClickHouse (CH has no RLS by canon — the query gateway is the enforcement; orthogonal).
- Does NOT execute the FORCE flip in this run (Stage 8 / Founder-at-console only).

---

## Open questions for Founder *(carried into Stage-1 synthesis)*

1. **Pick a path.** A1 vs A2 vs B vs C? Draft default = C.
2. **Confirm the legacy-app's DB connection identity** so we know exactly which role gets the service-role-style bypass under Path C (and so we can grep-prove the legacy is the only consumer).
3. **Maintenance window.** A short live-DB FORCE flip needs a chosen low-traffic window (and a Founder-pre-committed rollback trigger).
4. **Coexistence with `chore-security-governance-hardening-phase` WS-1** — is this slice ordered BEFORE WS-1 (Secrets Manager activation) or after? The two are technically independent but share the live-prod-DB blast radius.

---

## Linked prior runs

- `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal` (Child 0 — binding architecture)
- `.engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening__rishabhporwal` (Child 1 legacy implementation — withdrawn; reference)
- `.engineering-os/runs/2026-05-24T09-57-25Z__245326__feat-tenancy-rls-brain-native__rishabhporwal` (Child 1 Brain-native rebuild — MERGED to `origin/development`; HOLD-AT-FORCE)

---

## Notes

The Brain-native RLS code, runbook, probe, and `withWorkspace()` primitive are already on `origin/development`. The cutover-execution side of the C5 gate ("RLS LIVE/FORCED") is what this slice closes. The legacy app is the load-bearing coexistence dimension; without explicit handling, FORCE = outage. This requirement formalizes the explicit handling.
