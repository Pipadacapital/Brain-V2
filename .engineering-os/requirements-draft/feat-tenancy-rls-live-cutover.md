# DRAFT Requirement — feat-tenancy-rls-live-cutover

> Status: **DRAFT for Founder review.** Not yet submitted via `/requirement`.
> Author: claude-code (drafted 2026-05-26). Founder edits + submits.

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **parent_epic** | `chore-migrate-legacy-to-brain` (Child-1 follow-on; this is the slice that finally closes the OPEN P0) |
| **predecessor** | `feat-tenancy-rls-brain-native` (Stage 8 done; code merged; HOLD-AT-FORCE) |
| **submitted_by** | rishabhporwal (Founder) |
| **submitted_at** | _TBD on /requirement_ |
| **lane** | high-stakes (multi-tenancy + live prod DB + legacy-app coexistence) |
| **paradigm** | sql (DDL + connection-handling; ZERO LLM/ML) |
| **guardrails** | NO git commit until Founder "commit it". No live DDL outside the runbook ceremony. Reversibility: `down.sql` armed before each step. |

## Why now — the OPEN P0 it closes

The live shared Supabase Postgres (`ap-south-1`) has **45 models / 66 `workspaceId` refs / 0 RLS**: zero row-level cross-tenant isolation in production today. The Child-1 fix (`feat-tenancy-rls-brain-native`) shipped to `origin/development` via PRs #1+#2 — the Brain-native migrations (`apps/core-service/migrations/manual/rls/{step-a-enable-create,step-b-force,down}.sql`), the `withWorkspace()` session-context primitive, the rollout-runbook, and the CF-SEC-1 probe all exist and are LOCAL-verified.

What's blocking the live FORCE flip is **not** the Brain code. It's the **legacy Express/Prisma app still hitting the same prod DB**: that app does NOT call `set_config('app.workspace_id', …)` on its connections, so the moment we `ALTER TABLE … FORCE ROW LEVEL SECURITY`, every legacy query against an `authenticated` connection returns ZERO rows — that's an outage for every live brand still using the legacy frontend, not a leak fix.

This requirement designs and executes the live-cutover ceremony with explicit legacy-coexistence handling, so that the FORCE flip is safe end-to-end.

## Problem statement

Three coupled constraints:

1. **Tenancy leak risk is OPEN today** — DPDP §4 obligation against the data principal is breached on every cross-workspace query the legacy app accidentally runs (and there's no policy preventing it).
2. **Legacy app cannot be silently broken** — Sugandh Lok and any other live workspace using the legacy frontend must keep working through the cutover. A 0-row outage is not acceptable.
3. **The FORCE flip must remain reversible** — `down.sql` is the rollback, but only useful if the FORCE doesn't itself wedge sessions before rollback can be issued.

Pick the smallest, safest path that closes (1) without violating (2) or (3).

## Two paths (Founder decides ONE at intake or at Stage 2 with Aryan)

### Path A — Legacy-app DB-side shim (RLS goes live FIRST, legacy keeps running)

Add a connection-level shim so the legacy Prisma client sets `app.workspace_id` from the session before any query runs. Two equivalent shapes:

- **A1 — Prisma middleware shim** in the legacy backend that calls `SELECT set_config('app.workspace_id', $1, true)` on each transaction, sourced from the JWT/session. Pros: minimal blast radius — only `legacy project/backend/` changes, no DB change. Cons: requires touching the legacy codebase, which Founder ruled "reference-only" (memory: `feedback_legacy_is_reference_only.md`).
- **A2 — `SECURITY DEFINER` role-switch function** invoked by a `BEFORE TX` Postgres extension or by a per-session pgbouncer hook that derives `workspace_id` from the verified JWT in a header. Pros: no legacy code change. Cons: more infra (pgbouncer custom auth), more moving parts, harder to test.

### Path B — Retire the legacy app FIRST, then flip FORCE (no shim)

Sequence: complete the Brain web app's parity to "fully replaces legacy frontend" → cut all live brands over to Brain web → shut down the legacy Express app → then run the FORCE ceremony with no live legacy traffic to worry about.

- Pros: no shim, no legacy code change, cleanest end state. Lines up with Founder's "legacy is reference-only" rule.
- Cons: blocks closing the P0 on parity completion + customer cutover, both of which are weeks of work. The leak window stays open for that whole period.

### Path C (hybrid) — Quiesce-then-force-then-flip

Sequence: schedule a brief maintenance window → quiesce legacy app + cron → run `step-a-enable-create.sql` then `step-b-force.sql` → keep RLS on but issue a temporary, narrowly-scoped `service_role`-bypass for the legacy app's connection (legacy keeps reading via service-role bypass, Brain reads via `rls_app` with workspace context) → schedule the legacy retirement separately.

- Pros: closes the cross-tenant-leak risk against `rls_app` and any other non-service-role connection immediately. Defers the harder legacy-retirement work.
- Cons: legacy connection still has effective ALL-WORKSPACES access via service-role bypass — the leak surface shrinks but doesn't vanish for the legacy code path. Acceptable only if the legacy app is single-tenant-per-process or audited to never run cross-workspace queries.

## Recommended (claude-code's read)

**Path C as the immediate close**, sequenced to **Path B as the final close**. Rationale:

- Path C structurally fixes the leak for every NEW connection (Brain `rls_app`, future services) within one cutover window — the open P0 is closed at the storage layer.
- The legacy app keeps running with a documented + audited `service_role`-bypass exception, narrowed to its single known connection identity.
- Path B then happens as a separate, lower-pressure slice — retire the legacy app on its own schedule.

This avoids touching legacy code (honors `feedback_legacy_is_reference_only.md`) AND closes the P0 without waiting for full parity cutover.

## Deliverable bar

1. **Coexistence design (Aryan, Stage 2)** — pick A/B/C with binding rationale; document the legacy-connection identity that gets the service-role-bypass (if C); name the rollback contract.
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

## Acceptance bar (binding inputs for the reviewers)

- **CF-SEC-1 GREEN on LIVE** — un-scoped query against `rls_app` returns ZERO rows; same-workspace returns expected rows; cross-workspace returns ZERO. Captured output in the run folder.
- **Legacy app smoke-test PASS** — at least one known live workspace's legacy frontend renders the same row counts as pre-cutover. No 0-row outage.
- **Reversibility proven** — `down.sql` exercised in a staging clone; the FORCE → DROP POLICY → bypass-remove path completes within a stated time budget (e.g. ≤ 60s).
- **No legacy code change** (if Path C) — `git diff -- "legacy project/"` = 0 lines.
- **Audit trail** — Decision Log entry; runbook output captured in the run folder; CF-SEC-1 output captured.
- **Reversal-rate budget** — Founder pre-commits the rollback trigger (e.g. "if any live brand reports a 0-row outage within 30 min post-flip, immediately run down.sql").

## Verify-before-report (Founder directive)

- Local: re-run the existing `rollout-runbook.sh` against `brain-postgres-dev` (already proven LOCAL-verified Child-1); add the new STEP 3 + 5 and confirm idempotent + clean rollback.
- Staging: provision a staging clone of the live DB (or use a CDC snapshot in `brain_test`); run the FULL augmented runbook against it; confirm CF-SEC-1 GREEN + legacy-app smoke PASS.
- Live: Founder-at-console ceremony. No agent executes against live prod DB.

## What this requirement does NOT do

- Does NOT retire the legacy app (separate slice; Path B can be filed as a follow-on once parity is complete).
- Does NOT change any Brain-native code that already shipped — `withWorkspace()`, `rls_app` role, migration files, runbook are all reused as-is.
- Does NOT touch the connectors framework / Child-3 cutover ceremony (those have their own HOLD-AT-CUTOVER gate and an unrelated custody decision A/B).
- Does NOT touch ClickHouse (CH has no RLS by canon — the query gateway is the enforcement; orthogonal).

## Anti-blind-agreement (per `prompts/challenge-framework.md`)

Two challenges Rohan / Shreya are likely to surface; pre-empt them in the requirement:

1. **"Why not Path B alone — it's the cleanest?"** Because the leak window is OPEN today and waiting weeks (or months) for full parity + customer cutover means weeks of continued DPDP §4 exposure. Path C closes the storage-layer leak in one window; Path B then completes on a longer cycle.
2. **"What if a brand's legacy session DOES legitimately need cross-workspace reads (e.g. team-admin viewing multiple workspaces)?"** Out-of-scope today (memory: `project_sugandh_lok.md` is single-brand). If/when it surfaces, the shim derives `workspace_id` from session per-request; a separate "admin-tier" exception is a SEPARATE requirement under explicit Founder ratification, never a default grant.

## Open questions for Founder

1. **Pick a path.** A1 vs A2 vs B vs C? Default = C.
2. **Confirm the legacy-app's DB connection identity** so we know exactly which role gets the service-role-bypass under Path C (and so we can grep-prove the legacy is the only consumer).
3. **Maintenance window.** A short live-DB FORCE flip needs a chosen low-traffic window (and a Founder-pre-committed rollback trigger).
4. **Coexistence with `chore-security-governance-hardening-phase` WS-1** — is this slice ordered BEFORE WS-1 (Secrets Manager activation) or after? The two are technically independent but share the live-prod-DB blast radius.

## Suggested EOS pipeline

- Stage 1 (Rohan, CTO Advisor): intake + 1 persona (compliance-officer for DPDP §4 + tenancy). 1-day.
- Stage 2 (Aryan, Architect): binding plan picking A/B/C, the coexistence shim shape, the augmented runbook outline. 1-day.
- Stage 3 (Vikram, Backend): runbook augmentation, staging-clone smoke, CF-SEC-1 against staging. 2-day.
- Stage 4 (Shreya, Security): VETO authority on any leak surface that isn't closed. 0.5-day.
- Stage 5 (Tanvi, QA): real-network smoke on staging; rollback rehearsal. 0.5-day.
- Stage 6 (Rohan): final review + sign Stage-8 readiness.
- Stage 8 (Jatin + Founder): readiness artifact; Founder-at-console live ceremony.

Expected total: 5 working days from `/requirement` to live FORCE flip, gated on Founder approval at each transition.

---

## How Founder should submit

Two options:

1. **Submit via `/requirement`** — paste the body of this doc into a `/requirement` call. EOS will spawn a new run folder under `.engineering-os/runs/2026-05-26T…__<hash>__feat-tenancy-rls-live-cutover__rishabhporwal/` and Rohan picks it up at Stage 1.
2. **Edit this draft first** — if you want to change the recommended path or scope before submitting, edit `.engineering-os/requirements-draft/feat-tenancy-rls-live-cutover.md` and THEN run `/requirement` with the edited body.

Either way, the live DB is not touched until your Stage-8 ceremony.
