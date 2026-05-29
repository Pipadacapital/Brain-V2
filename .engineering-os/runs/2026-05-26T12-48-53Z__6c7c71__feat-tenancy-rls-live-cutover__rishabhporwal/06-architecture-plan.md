# Architecture Plan — `feat-tenancy-rls-live-cutover`

> Stage 2 binding plan. Author: Aryan (architect). Bound to Path C ratified by Founder
> 2026-05-26T16:00:00Z (artifact `06-founder-decision-cf-cut-path-1.json`).
> Folded handoff: §17 Tracks + §17b Acceptance Contract are the developer-facing
> handoff (no separate `07-` — lane = `high-stakes` but the change is a *runbook
> extension* on an already-shipped storage-layer primitive, not a new build surface;
> a separate 07 would be longer than the plan itself. See §16b for the lane-vs-depth
> justification — Aryan's calibrated call per role-empowerment-model band).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-live-cutover` |
| **Stage** | 2 |
| **Author** | architect (Aryan) |
| **Timestamp** | 2026-05-26T16:10:00Z |
| **Paradigm** | `sql` (Rohan-confirmed; carried unchanged — pure DDL + connection-handling + shell + psql probe; zero LLM, zero ML, zero numeric-parity) |
| **Parent epic** | `chore-migrate-legacy-to-brain` |
| **Predecessor** | `feat-tenancy-rls-brain-native` (PRs #1+#2 merged on `origin/development`; HOLD-AT-FORCE) |
| **Path** | **C** — quiesce + FORCE + per-role BYPASSRLS on legacy connection identity; exit deadline = Path B (legacy retirement) completion date |
| **Branch** | `chore/stage2-feat-tenancy-rls-live-cutover` (off `origin/development`; NO commit per `feedback_no_commits_without_founder_approval`) |
| **Builders (Stage 3)** | @vikram (backend-developer) — single builder, sequential tracks |

---

## 1. Context (what we're doing and why)

This slice executes the LIVE FORCE-flip ceremony for the Brain-native RLS that already
shipped on `origin/development` via PRs #1+#2 (`feat-tenancy-rls-brain-native`,
HOLD-AT-FORCE). The Brain-native code, primitive, runbook, probe, policies, and
`down.sql` are **unchanged this slice**. What this slice changes:

- **Extends** `apps/core-service/migrations/manual/rls/rollout-runbook.sh` with NEW
  STEPS 0.5 / 0.7 / 1.5 / 3 (bypass) / 5 (real legacy HTTP smoke) / 6 (bypass-revoke
  on completion + post-flip Brain-decision-log entry).
- **Adds** a new audit primitive: `bypass_query_log` table + Postgres
  `log_statement = 'mod'` on the bypass session (CF-CUT-BYPASS-AUDIT-1).
- **Adds** three pre-ceremony staging-clone kill-tests and one inverse-mutant
  (CF-CUT-VERIFY-THE-VERIFIER-1).
- **Drafts** a §7 continuity addendum to the Child-1 DPDP memo
  (CF-CUT-DPDP-ADDENDUM-1) shipped as the sibling `06b-dpdp-section7-addendum-draft.md`.

**Scope discipline.** This slice is the OPEN-P0 closer at the storage layer. It does NOT:
modify Brain-native code (the `withWorkspace` primitive, `step-a-enable-create.sql`,
`step-b-force.sql`, `down.sql` ship as-is); retire the legacy app (separate Stage-8
Path B slice); touch ClickHouse (no RLS there by canon); execute the FORCE flip in this
run (Stage 8 / Founder-at-console only).

**Why this size.** A 1-line `ALTER ROLE … BYPASSRLS` would be the wrong-shape
"smaller" plan: the load-bearing risk is in the *ceremony around it* (drain ordering,
rollback ordering, real-path verification, audit shape, residency, calendar). Each is
exactly one runbook step. The plan is dense with kill-tests because Path C's residual
surface is structural and the durable-rule's 9-evidence count gives no quarter to a
plan that would let the cutover ship vacuous.

---

## 2. Cited code grounding (file paths + lines)

| Concern | File + line | Notes |
|---|---|---|
| Existing runbook to extend | `apps/core-service/migrations/manual/rls/rollout-runbook.sh:1-229` | STEPS 0-6 are reused verbatim; NEW steps inserted at 0.5 / 0.7 / 1.5 / 3.5 / re-shape 5 / re-shape 6 |
| `step-a-enable-create.sql` (44 tables) | `apps/core-service/migrations/manual/rls/step-a-enable-create.sql:30-283` | Unchanged this slice |
| `step-b-force.sql` (FORCE per table) | `apps/core-service/migrations/manual/rls/step-b-force.sql` | Unchanged this slice |
| `down.sql` (symmetric rollback) | `apps/core-service/migrations/manual/rls/down.sql:1-204` | Unchanged this slice; rollback ordering binds `down.sql` FIRST, bypass-revoke SECOND |
| `withWorkspace` / `withSuperadmin` primitive | `apps/core-service/src/infrastructure/db/workspace-context.ts:1-80` | Unchanged this slice; used by the future Brain runtime, not by the cutover ceremony itself |
| Legacy DB connection identity (live PROD) | `legacy project/backend/.env` lines `DATABASE_URL` + `DIRECT_URL` (redacted in this doc) | **Role = `postgres.pavcgecgciamejdcysjx`** — the Supabase tenant-user, used by BOTH legacy Express AND any future Brain admin against live. See §3 finding + Open Question §16. |
| Legacy Prisma schema (proves identity is the only consumer) | `legacy project/backend/prisma/schema.prisma:1-30` | `datasource db { url = env("DATABASE_URL"); directUrl = env("DIRECT_URL") }` — both env vars resolve to `postgres.pavcgecgciamejdcysjx` |
| Local-dev role (NOT live) | `apps/core-service/migrations/local-dev/03-schema-connectors.sql` (and 16 sibling SQL files; GRANT … TO `rls_app`) | `rls_app` exists ONLY in local-dev; **does not exist on live Supabase**. See §3 finding. |
| Child-1 HOLD-AT-FORCE conditions | `apps/core-service/migrations/manual/rls/README.md:15-37` + `rollout-runbook.sh:148-195` | The 4 hold conditions are the canon we narrow per CF-CUT-SHIPROCKET-RECONCILE-1 |
| Child-1 §7 memo (basis the addendum extends) | `.engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening/dpdp-lawful-basis-memo-DRAFT.md` | Founder-accepted 2026-05-24 per ownership of Sugandh Lok |
| Durable rule | `.engineering-os/durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate.md` (sub-rules 3, 4, 7 apply here) | Drives §6 "High-stakes Gate Inventory" |

---

## 3. CRITICAL grounding finding — the live connection-identity is shared

**Finding.** The synthesis-§5 obligation #1 says `STEP-3 shim shape = ALTER ROLE
<legacy_connection_identity> BYPASSRLS`. Grounding against the actual live config
(`legacy project/backend/.env`, `legacy project/backend/prisma/schema.prisma`)
reveals the live legacy-app connection identity is **`postgres.pavcgecgciamejdcysjx`**
— the Supabase project's tenant-pooler role. Three observations bind the plan shape:

1. **Supabase's `postgres` tenant role bypasses RLS by default.** The role is created
   by Supabase with `rolbypassrls = true` (Supabase docs + observed posture; the
   Child-1 plan §62 implicitly relies on this when it says "live consumer is proven
   100% service-role"). **So today, before any cutover, the legacy app already
   bypasses RLS by virtue of its role.** A naïve `ALTER ROLE … BYPASSRLS` would be a
   no-op (idempotent — good — but informationally vacuous).

2. **The Brain `rls_app` role does NOT exist on live.** It is a local-dev artifact
   (`apps/core-service/migrations/local-dev/03-schema-connectors.sql` + 16 siblings).
   The CF-SEC-1 probe specification says "Probe runs as `rls_app` (rolbypassrls=false)
   — NOT as a superuser or as the bypass role." For the probe to be meaningful on
   LIVE, **we MUST create the `rls_app` role on live before the probe runs** (one-time
   DDL in STEP 2.7-NEW; idempotent `CREATE ROLE … IF NOT EXISTS` shape).

3. **The "bypass" we want to AUDIT** is actually the *continued* bypass of
   `postgres.pavcgecgciamejdcysjx` — the Supabase tenant role — which is the legacy
   consumer's identity. The shape of STEP 3 therefore becomes:
   - **(a)** `ALTER ROLE postgres BYPASSRLS;` — Postgres-idiomatic, idempotent
     (re-running on an already-bypass role is a no-op), but on Supabase the tenant
     identity is `postgres.<tenantId>` not bare `postgres`. **Verify the live
     `rolname` before binding.** This is a Stage-3 first-step (Vikram: query
     `pg_roles` on live and bind the exact string).
   - **(b)** Track the audit via `application_name` (set by the legacy Prisma client
     via the connection string) so the `bypass_query_log` can attribute bypass
     queries to "legacy" vs "any Brain admin path that ever uses the bypass role".

**Plan-binding consequence.**
- **STEP 3 shape (BOUND):** `ALTER ROLE <live_rolname_of_postgres.tenant> BYPASSRLS;`
  — idempotent and Founder-ratified per CF-CUT-PATH-1. Pre-step asserts current
  `rolbypassrls` state (already-bypass = "binding the existing posture for audit
  purposes" — the cutover's incremental act is the AUDIT, not the bypass itself).
- **STEP 2.7-NEW (BOUND):** create `rls_app` role on live (`CREATE ROLE rls_app …
  NOBYPASSRLS LOGIN PASSWORD …; GRANT SELECT … TO rls_app`) so the CF-SEC-1 probe
  at STEP 4 runs as a non-bypass role. This is the only Brain DDL act on live that
  is NOT in the existing `step-a-enable-create.sql`.
- **STEP 5 (BOUND):** the legacy smoke calls the legacy HTTP path which connects
  as `postgres.<tenant>` (bypass) — it CANNOT call as `rls_app` (would 0-row and
  defeat the no-outage gate's purpose). The smoke's GREEN proves the bypass works
  for the no-outage verdict; the leak verdict is bound to STEP 4 (CF-SEC-1, as
  `rls_app`).
- **Audit shape (BOUND):** `bypass_query_log` is keyed by `(ts, workspace_id,
  connection_id, application_name, statement_class)`. `application_name` is the
  attribution column that distinguishes "legacy Express" from any other consumer
  ever using the bypass role; the legacy Prisma client sets `application_name=
  legacy-express` via the connection string (we'll bind this in STEP 1.5).

**Escalation status.** This finding does NOT change the path choice (still Path C).
It DOES name a Stage-3 pre-step (Vikram runs `SELECT rolname, rolbypassrls FROM
pg_roles WHERE rolname LIKE 'postgres%'` on live via `DIRECT_URL` BEFORE
authoring STEP 3 — captured to `staging-rehearsal/live-role-inventory.txt`). If the
inventory surfaces a SECOND non-bypass role that the legacy app *also* uses (e.g. a
Supabase `authenticated`/`anon` role accessed via PostgREST), the plan amends —
arm tripwire **CF-CUT-IDENTITY-AUDIT-1** (NEW, MEDIUM): "If `staging-rehearsal/
live-role-inventory.txt` shows >1 non-`rls_app` role connecting from the legacy
process tree (`application_name LIKE '%legacy%'` in `pg_stat_activity`), the
single-bypass shape is wrong; rework STEP 3 to grant BYPASSRLS to ALL of them OR
escalate to Founder for path-shape revision." Default: single-role bypass binds.

---

## 4. Architecture (the shape we're shipping)

```
                                          LIVE Supabase Postgres (ap-south-1)
                                         ┌───────────────────────────────────────┐
                                         │                                       │
   legacy Express app                    │  ROLES                                │
   (postgres.pavcgecgciamejdcysjx,       │  ┌─ postgres.pavcgecgciamejdcysjx ─┐  │
    application_name=legacy-express,     │  │  rolbypassrls = true (already!) │  │
    via :6543 pgbouncer pooler)          │  │  ← legacy consumer ← THIS slice │  │
   ──────────────────────────────────┐   │  │     "ratifies + audits" this    │  │
                                     │   │  └─────────────────────────────────┘  │
                                     ├──▶│  ┌─ rls_app (NEW on live, STEP 2.7) ┐ │
   Brain runtime (future, post-PRs)  │   │  │  rolbypassrls = false           │  │
   (NOT live this slice — Child-3+)  │   │  │  ← future Brain consumer        │  │
   ──────────────────────────────────┘   │  │  ← CF-SEC-1 probe runs as THIS  │  │
                                         │  └─────────────────────────────────┘  │
                                         │                                       │
                                         │  TABLES (44 workspace-scoped)         │
                                         │  - ENABLE  ← STEP 3 (already shipped) │
                                         │  - FORCE   ← STEP 5 (executed live)   │
                                         │  - policies: ws_isolation (44×)       │
                                         │              + superadmin (3 dual)    │
                                         │                                       │
                                         │  bypass_query_log (NEW, ws-scoped)    │
                                         │  ← log_statement='mod' on bypass role │
                                         └───────────────────────────────────────┘
                                                  │
                                                  ▼
                                         Brain Decision-Log
                                         (ai.decision_log; per-create/remove of bypass)
```

**Cutover sequence (the binding ordering):**

```
0     region-assert (existing)
0.5   STAGING-CLONE residency assert (NEW; CF-CUT-RESIDENCY-1)
0.7   Shiprocket quiesce + corrected bare-write grep ZERO (NEW; CF-CUT-SHIPROCKET-RECONCILE-1)
1     cron quiesce (existing)
1.5   legacy off LB + pg_stat_activity drain ≥ 30s (NEW; CF-CUT-DRAIN-1)
2     context-code verify (existing)
2.5   FK-scope EXPLAIN gate (existing)
2.7   create rls_app on live (NEW; one-time DDL; idempotent CREATE ROLE IF NOT EXISTS)  ← BOUND per §3
3     ENABLE + CREATE policies (existing; step-a-enable-create.sql)
3.5   bind bypass + audit (NEW; ALTER ROLE postgres.<tenant> BYPASSRLS + log_statement + bypass_query_log + Brain Decision-Log create entry) ← BOUND per §3
4     CF-SEC-1 probe via rls_app (existing; now meaningful since rls_app exists)
5     FORCE (existing; step-b-force.sql) → real-path legacy HTTP smoke (NEW shape per CF-CUT-VERIFY-THE-VERIFIER-1)
6     post-flip Brain Decision-Log entry + re-enable crons + legacy BACK on LB (existing + addition)

ROLLBACK (binding ordering per CF-CUT-ROLLBACK-ATOMIC-1):
  R1   psql "$DIRECT_URL" --file down.sql    (drops policies + NO FORCE on 44 tables)
  R2   ALTER ROLE postgres.<tenant> NOBYPASSRLS  (revoke bypass — IFF Path-B-completion sets the deadline)
  R3   Brain Decision-Log "rls.rollback" entry

EXIT (Path-B completion bypass-revoke ceremony — separate Stage-8 slice):
  E1   confirm legacy Express app off LB permanently (decommissioned)
  E2   ALTER ROLE postgres.<tenant> NOBYPASSRLS
  E3   Brain Decision-Log "bypass.revoke.path-b-completion" entry
  E4   re-run CF-SEC-1 probe via rls_app → still GREEN
```

---

## 5. The chosen path: Path C — exit deadline = Path B completion

**Path C bound (per Founder ratification 2026-05-26T16:00:00Z):**

- **Shim shape:** `ALTER ROLE postgres.<tenant_id> BYPASSRLS` — Postgres-native,
  trivially idempotent (the grant is state, not delta). No connection-string
  rotation (that form was rejected at synthesis per O5 — less idempotent, more
  blast radius).
- **Scope:** ONE explicitly-named role (the Supabase tenant pooler role). Grep-
  proven as the sole legacy consumer at Stage-3 pre-step (§3, `staging-rehearsal/
  live-role-inventory.txt`). Tripwire CF-CUT-IDENTITY-AUDIT-1 fires if >1 role
  found.
- **Exit deadline:** the Path B (legacy retirement) completion date. Written into
  the runbook header in writing. Bypass-revoke ceremony is a separate Stage-8
  slice (template above as the "EXIT" sequence).
- **Audit:** per-create/remove Brain Decision-Log (`ai.decision_log`, schema in
  §7) + structured `bypass_query_log` (Postgres `log_statement='mod'` shipped via
  Vector → Postgres table, schema in §8). §12-erasure-scopable by
  `DELETE WHERE workspace_id = $X`.
- **Second-brand tripwire (CF-SEC-3.HARD re-arm mechanism):** post-cutover the
  operator runs `SELECT DISTINCT workspace_id FROM bypass_query_log WHERE ts > $CUTOVER_TS`
  and confirms result = `{$SUGANDH_LOK_UUID}` only. Any other workspace_id triggers
  CF-SEC-3.HARD re-arm + immediate rollback. The grep is **manual at the live
  ceremony** (Brain runtime not live yet to mechanize); the runbook STEP 6 names
  it explicitly.
- **DPDP §7 basis:** Founder-as-controller-of-Sugandh-Lok; addendum at
  `06b-dpdp-section7-addendum-draft.md` enumerates the 4 covered transitional
  acts; Founder signs before Stage-8 STEP 5.

**Rejected at this gate (recorded for the decision log):**

- Path A1 (Prisma middleware in legacy backend) — INADMISSIBLE,
  `feedback_legacy_is_reference_only`.
- Path A2 (pgbouncer custom auth) — REJECTED, weeks of new infra; the §8(6)
  notice timeline on the OPEN P0 (open since 2026-05-24) is canon-incompatible
  with that delay.
- Path B as immediate close (wait for legacy retirement) — INADMISSIBLE for the
  same §8(6) reason.

---

## 6. High-stakes Gate Inventory (per durable-rule `2026-05-26__verify-the-verifier-mutation-on-gate`)

> Every high-stakes gate carries: real-path test (production code path, not a
> double) + kill-test (captured mutant proving the gate goes RED when broken) +
> inverse-mutant (for security controls per sub-rule 3) + captured-mutant output
> location. Stage-5 reviews verbatim; Stage-6 re-mutates on disk per sub-rule 7.

| # | Gate | What its GREEN authorizes | Real-path test (Stage 3 owns) | Kill-test (captured mutant) | Inverse-mutant (security only) | Captured-output location |
|---|---|---|---|---|---|---|
| G1 | **CF-SEC-1 cross-workspace probe (LEAK gate)** — invoked via `rls_app` (rolbypassrls=false), 44-table sweep: cross-workspace=0 AND context-less=0 AND same-workspace=expected | "Storage layer enforces tenant isolation post-FORCE" → authorizes Stage-7 readiness on the *leak* dimension | `apps/core-service/src/infrastructure/db/rls-probe.ts` invoked with `DIRECT_URL` pointed at `rls_app@<live>` (Stage 3 wires the role into the probe CLI per §3). NOT psql-doubled. | **K1.kill:** drop FORCE on ONE table (`marketing_actions`) on staging clone → probe returns RED (cross=1, ctxless≥0 for that table). Captured to `staging-rehearsal/cf-sec-1-kill.txt`. | **K1.inverse:** with FORCE + bypass applied, run probe via `postgres.<tenant>` (bypass role) → probe SILENTLY GREEN (bypass sees all rows). Captured to `staging-rehearsal/cf-sec-1-inverse.txt`. Proves: the probe is **load-bearing only when run as `rls_app`**; running it as bypass role is the vacuous-GREEN class — STEP 4 in the runbook explicitly names the role. | `staging-rehearsal/{cf-sec-1-kill.txt, cf-sec-1-inverse.txt, cf-sec-1-green.txt}` |
| G2 | **STEP-5 legacy HTTP smoke (NO-OUTAGE gate)** — real-path: `curl -i "https://<legacy-base>/api/orders?range=last-7d" -H "Cookie: $LIVE_SUGANDH_LOK_SESSION"` (or equivalent legacy endpoint chosen at Stage 3 — see §6a below for the binding choice procedure); asserts response body's order count == pre-cutover snapshot | "Legacy app still renders correct row counts post-FORCE" → authorizes Stage-7 readiness on the *no-outage* dimension | The actual legacy HTTP endpoint behind a real HTTPS request with a real Sugandh-Lok session cookie. NOT a psql double of the bypass role. Output captured via `curl -i … > staging-rehearsal/step5-green.txt`. | **K2.kill:** apply FORCE without granting bypass → STEP 5 RED (HTTP 500 or 200 with empty rows depending on legacy handler; either way != pre-cutover snapshot). Captured to `staging-rehearsal/step5-kill.txt`. Proves STEP 5 is sensitive to the bypass. | **K2.inverse:** with FORCE + bypass applied, drop FORCE on ONE table (`marketing_actions`) → STEP 5 STILL GREEN (legacy endpoint exercised in the smoke doesn't touch `marketing_actions`, so its row count is unaffected) while G1 (CF-SEC-1) is RED. Captured to `staging-rehearsal/step5-inverse.txt`. Proves: **G2 is the no-outage gate; G1 is the leak gate; they are two distinct gates** — STEP 5 alone cannot authorize cutover-complete; both gates must be GREEN. | `staging-rehearsal/{step5-green.txt, step5-kill.txt, step5-inverse.txt}` |
| G3 | **Rollback-ordering gate (atomic-rollback contract)** — measured time-to-rollback ≤ 60s on staging; ordering: `down.sql` BEFORE bypass-revoke | "Rollback path is exercised and within SLO" → authorizes Founder's pre-committed rollback trigger at Stage 7/8 | Pre-ceremony staging-clone exercise: run R1 (`psql … --file down.sql`) → R2 (`ALTER ROLE … NOBYPASSRLS`) → confirm legacy HTTP smoke STILL GREEN throughout (no 0-row window). Wall-clock measured via `date -u` markers in runbook. Captured to `staging-rehearsal/rollback-right-order.txt`. | **K3.kill:** run rollback in WRONG order (R2 first: revoke bypass; THEN R1: `down.sql`) → during the window between R2 and R1, legacy HTTP smoke returns ZERO rows (the bypass is gone, FORCE is still on, legacy `postgres.<tenant>` role 0-rows on FORCEd tables). Captured to `staging-rehearsal/rollback-wrong-order-kill.txt`. Proves the ordering matters; the right-order test passing without K3.kill captured would be vacuous. | (rollback ordering is not a security control per se — sub-rule 3 inverse-mutant N/A; the kill alone suffices) | `staging-rehearsal/{rollback-right-order.txt, rollback-wrong-order-kill.txt, rollback-timing.txt}` |

**Stage-5 obligation (Tanvi):** review all 9 captured outputs verbatim; bounce on any
missing or mismatched.

**Stage-6 obligation (Rohan):** re-mutate each kill on disk per sub-rule 7 — restage
each kill scenario on the staging clone in the live ceremony window and capture
fresh RED/GREEN transitions. A bound-at-Stage-1 + non-vacuous-at-Stage-3 +
re-mutated-at-Stage-6 gate is the durable rule's full discipline.

### 6a. STEP-5 endpoint binding procedure (Stage 3, Vikram)

The exact legacy HTTP endpoint exercised by STEP 5 is not picked here because it
depends on the legacy app's actual route table (which Aryan respects as
reference-only and does NOT modify or even read deeply). **The Stage-3 binding
procedure:**

1. Vikram inspects (read-only) `legacy project/backend/src/routes/` to identify
   a route that:
   - Returns a stable, countable row set (preferred: a list of orders with a
     date range filter so the count is deterministic).
   - Touches at least one Group-B (connId-FK) table — proves the FK-scope policy
     shape passes through bypass.
   - Requires a real session cookie (proves the auth path also works through
     bypass).
2. Vikram captures the chosen endpoint + curl invocation in the runbook STEP 5
   block (NEW, with the curl command line and the expected-count grep).
3. The "pre-cutover snapshot" is captured against the staging clone immediately
   before the rehearsal (one `curl` call, captured to `staging-rehearsal/step5-pre.txt`).
4. Recommended candidate (Aryan's read of the legacy structure, non-binding):
   `GET /api/dashboard/orders?range=last-30-days` or `GET /api/orders?limit=50`
   — but Vikram has final say after the read-only inspection.

---

## 7. Brain Decision-Log entries (per-create/remove of bypass — CF-CUT-BYPASS-AUDIT-1 half-1)

Two entries per cutover (one at STEP 3.5 grant, one at STEP 6 if revoked early; the
Path-B-completion EXIT ceremony writes its own E3 entry).

**At STEP 3.5 (bypass grant):**

```jsonc
{
  "type": "rls.bypass.grant",
  "ts": "<ISO_TS>",
  "actor": "rishabhporwal (Founder-at-console)",
  "connection_identity": "postgres.pavcgecgciamejdcysjx",
  "rolname_on_live": "<exact rolname from pg_roles>",
  "granted_until": "Path-B-completion-date (TBD; deadline-bounded per CF-CUT-PATH-1)",
  "decision_basis": "CF-CUT-PATH-1 Founder ratification 2026-05-26T16:00:00Z; DPDP §7 transitional continuity per Child-1 memo + §7 addendum 06b-dpdp-section7-addendum-draft.md",
  "workspace_id": null,          // system-level act
  "is_system_row": true,         // covered by superadmin_system_rows policy
  "scope_attestation": "single-role bypass; grep-proven sole legacy consumer via staging-rehearsal/live-role-inventory.txt; second-brand tripwire armed (post-flip grep of bypass_query_log.workspace_id ⊆ {$SUGANDH_LOK_UUID})",
  "exit_ceremony_slice": "<Path-B-completion req_id, TBD>"
}
```

**At STEP 6 / EXIT-E3 (bypass revoke):**

```jsonc
{
  "type": "rls.bypass.revoke",
  "ts": "<ISO_TS>",
  "actor": "<operator>",
  "connection_identity": "postgres.pavcgecgciamejdcysjx",
  "rolname_on_live": "<exact rolname from pg_roles>",
  "revoke_reason": "path-b-completion | rollback | tripwire-fire (CF-CUT-IDENTITY-AUDIT-1 | second-brand)",
  "originating_grant_decision_id": "<id of the prior grant entry>",
  "workspace_id": null,
  "is_system_row": true,
  "post_revoke_cf_sec_1_verdict": "GREEN | RED | NOT-RUN"
}
```

The `ai.decision_log` table is dual-policy (Child-1 CF-C1-AUDITLOG-1.a):
`workspace_id=null` rows are visible only under `withSuperadmin`; the entries above
are system-level acts under `withSuperadmin` (operator binds `app.is_superadmin=true`
via `psql -v` before running the `INSERT`).

---

## 8. `bypass_query_log` table (CF-CUT-BYPASS-AUDIT-1 half-2 — §12 erasure-scopable)

```sql
-- Runbook-gated DDL — NOT auto-applied by any migration runner (CF-BN-DDL-GATING-1).
-- Lives at: apps/core-service/migrations/manual/rls/step-c-bypass-audit.sql (NEW, Stage 3)

CREATE TABLE IF NOT EXISTS bypass_query_log (
  id               BIGSERIAL PRIMARY KEY,
  ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
  workspace_id     UUID,                    -- nullable; system queries → null (covered by superadmin policy)
  connection_id    TEXT,                    -- pg_stat_activity.application_name + pid
  application_name TEXT,                    -- e.g. 'legacy-express' vs other; attribution column
  statement_class  TEXT NOT NULL CHECK (statement_class IN ('SELECT','INSERT','UPDATE','DELETE','DDL','OTHER')),
  -- NOT raw text — preserves erasure-scopability per Child-1 audit-log discipline
  rows_affected    INTEGER,                 -- nullable; SELECTs may not log this
  duration_ms      INTEGER,
  table_touched    TEXT                     -- single primary table (best-effort parse); for cross-workspace tripwire
);

CREATE INDEX IF NOT EXISTS idx_bypass_query_log_ts             ON bypass_query_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_bypass_query_log_workspace_id   ON bypass_query_log (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bypass_query_log_application    ON bypass_query_log (application_name, ts DESC);

ALTER TABLE bypass_query_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON bypass_query_log
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY superadmin_system_rows ON bypass_query_log
  USING      (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
-- Note: this table is added to step-a-enable-create.sql sibling 'step-c-bypass-audit.sql'
-- and to down.sql's symmetric rollback (Stage 3 owns).

-- §12 erasure-scopable:
--   DELETE FROM bypass_query_log WHERE workspace_id = $1;   -- per-data-principal
```

**Statement-capture mechanism (no legacy code change — `feedback_legacy_is_reference_only` honored):**

Postgres-native `log_statement = 'mod'` at the role level via:

```sql
ALTER ROLE "postgres.pavcgecgciamejdcysjx" SET log_statement = 'mod';
ALTER ROLE "postgres.pavcgecgciamejdcysjx" SET log_min_duration_statement = 0;
```

The `postgresql.log` lines are shipped by a Vector/Fluent-bit sidecar (already in
Supabase's logging plane) to a parser that emits structured rows into
`bypass_query_log` keyed by `workspace_id` (derived from the legacy query's
`WHERE workspace_id = $1` clause via best-effort regex; rows that cannot be
attributed get `workspace_id = NULL` and are covered by the `superadmin_system_rows`
policy). **The parser ships in this slice as a runbook-side shell script
(Stage 3 owns), not a Brain runtime service** — keeps the slice small and avoids a
new long-running process.

**Retention:** bounded by CF-CUT-PATH-1's exit deadline (the Path-B completion
date). At exit, the table is dropped via a sibling `down-bypass-audit.sql` (Stage 3
owns); §12 erasure on individual workspace rows is supported in the interim via the
DELETE shape above.

---

## 9. The augmented runbook (concrete shell — extends `rollout-runbook.sh`)

The full diff lives in §17 Track V1 (handoff). Here is the operator-facing shape so
Founder can preview the ceremony.

### STEP 0.5 — Staging-clone residency assert (NEW, CF-CUT-RESIDENCY-1)

```bash
# =============================================================================
# STEP 0.5 — Staging-clone residency assert (CF-CUT-RESIDENCY-1)
# Inadmissible: non-ap-south-1 clone with PROD PII (DPDP §16 cross-border xfer).
# Two acceptable shapes:
#   (a) staging clone in ap-south-1 (Postgres-level assert)
#   (b) staging DB explicitly tagged synthetic-only with generator artifact in run folder
# =============================================================================
log "STEP 0.5: Staging-clone residency assert"

: "${STAGING_DIRECT_URL:?STAGING_DIRECT_URL must be set (the staging clone we rehearse against)}"
: "${STAGING_RUN_FOLDER:?STAGING_RUN_FOLDER must be set (the run-folder path for capturing rehearsal outputs)}"

# Postgres-level region check on staging clone
STAGING_TZ=$(psql "$STAGING_DIRECT_URL" -tAc "SELECT current_setting('TimeZone')" 2>/dev/null || echo "FAIL")
log "  Staging clone TimeZone: $STAGING_TZ"

# ap-south-1 Supabase instances run Asia/Kolkata OR UTC; either is acceptable
# IF the operator can also confirm the AWS region via the Supabase project console.
if [[ "$STAGING_TZ" == "Asia/Kolkata" || "$STAGING_TZ" == "UTC" ]]; then
  confirm "STEP 0.5: Confirm the staging Supabase project is in ap-south-1 (AWS region) via console"
  log "STEP 0.5: PASS (a) — staging clone in ap-south-1"
elif [[ -f "$STAGING_RUN_FOLDER/staging-rehearsal/synthetic-only-attestation.txt" ]]; then
  # Acceptable form (b): synthetic-only with generator artifact
  log "  Found synthetic-only attestation: $STAGING_RUN_FOLDER/staging-rehearsal/synthetic-only-attestation.txt"
  confirm "STEP 0.5: Confirm the staging DB contains ZERO PROD PII (synthetic generator output only)"
  log "STEP 0.5: PASS (b) — synthetic-only staging"
else
  halt "STEP 0.5 FAIL: staging clone is NOT confirmed ap-south-1 AND no synthetic-only attestation exists. \
        Provision the clone in ap-south-1 OR place a synthetic-only-attestation.txt with the generator command line."
fi
```

### STEP 0.7 — Shiprocket quiesce + Brain-native bare-write grep (NEW, CF-CUT-SHIPROCKET-RECONCILE-1)

```bash
# =============================================================================
# STEP 0.7 — Shiprocket connector quiesce + Brain-native bare-write grep
# (CF-CUT-SHIPROCKET-RECONCILE-1; narrows CF-C3-FORCE-UNLOCK-SCOPE-1)
#
# Founder-ratified narrowing: full Shiprocket DECOMMISSION ships as a separate
# Stage-8 ceremony. THIS cutover satisfies CF-C3-FORCE-UNLOCK-SCOPE-1 via:
#   (i)  Shiprocket connector HTTP listener disabled OR process killed
#   (ii) Last Shiprocket request timestamp > $CUTOVER_DRAIN_SECONDS ago
#   (iii) Brain-native bare-write grep returns ZERO hits (MUST NOT exclude
#         backfill/discoverChannels — that was the legacy Child-1 defect, R-O7)
# =============================================================================
log "STEP 0.7: Shiprocket quiesce + Brain-native bare-write grep"

: "${CUTOVER_DRAIN_SECONDS:=60}"

# (i) + (ii) operator-confirms
confirm "STEP 0.7: Shiprocket connector HTTP listener disabled OR process killed"
LAST_SHIPROCKET_TS=$(psql "$DIRECT_URL" -tAc "
  SELECT EXTRACT(EPOCH FROM (now() - MAX(state_change)))::int
  FROM pg_stat_activity
  WHERE application_name LIKE '%shiprocket%'
" 2>/dev/null || echo "0")
log "  Seconds since last Shiprocket activity: $LAST_SHIPROCKET_TS"
[[ "$LAST_SHIPROCKET_TS" -ge "$CUTOVER_DRAIN_SECONDS" ]] \
  || halt "STEP 0.7 FAIL: Shiprocket activity within last ${CUTOVER_DRAIN_SECONDS}s. Wait for drain."

# (iii) corrected bare-write grep — MUST NOT exclude backfill or discoverChannels
GREP_OUT="$STAGING_RUN_FOLDER/staging-rehearsal/brain-native-bare-write-grep.txt"
log "  Running corrected bare-write grep (output: $GREP_OUT)"
grep -rn 'prisma\.\|\bdb\.query\|pool\.query' apps/ \
  | grep -v 'withWorkspace\|withSuperadmin' \
  | grep -v '//__' \
  | grep -vE '\.test\.|\.spec\.' \
  | grep '\.ts:' \
  > "$GREP_OUT" || true
GREP_COUNT=$(wc -l < "$GREP_OUT" | tr -d ' ')
log "  Bare-write grep hits: $GREP_COUNT (expected: 0)"
[[ "$GREP_COUNT" -eq 0 ]] \
  || halt "STEP 0.7 FAIL: $GREP_COUNT bare writes found in apps/. See $GREP_OUT. Convert before FORCE."

log "STEP 0.7: PASS — Shiprocket quiesced + Brain-native bare-write grep ZERO"
```

### STEP 1.5 — Legacy app off LB + drain (NEW, CF-CUT-DRAIN-1)

```bash
# =============================================================================
# STEP 1.5 — Legacy app off LB + pg_stat_activity drain (CF-CUT-DRAIN-1)
# Recommended shape (a) from persona O1: legacy off LB → wait drain.
# =============================================================================
log "STEP 1.5: Legacy app off LB + drain"

confirm "STEP 1.5: Remove the legacy Express app from the load balancer (operator-confirmed; e.g. AWS Target Group deregister, Nginx upstream disable, or Render/Fly suspend)"

# Confirm in-flight HTTP transactions on legacy connections have drained.
DRAIN_THRESHOLD=30  # seconds the active count must stay at zero
ZERO_STREAK=0
while [[ $ZERO_STREAK -lt $DRAIN_THRESHOLD ]]; do
  ACTIVE=$(psql "$DIRECT_URL" -tAc "
    SELECT count(*) FROM pg_stat_activity
    WHERE application_name LIKE '%legacy%'
      AND state IN ('active','idle in transaction')
  " 2>/dev/null || echo "999")
  if [[ "$ACTIVE" -eq 0 ]]; then
    ZERO_STREAK=$((ZERO_STREAK + 1))
    log "  Legacy active sessions: 0 (streak: ${ZERO_STREAK}s/${DRAIN_THRESHOLD}s)"
  else
    log "  Legacy active sessions: $ACTIVE (resetting streak)"
    ZERO_STREAK=0
  fi
  sleep 1
done

log "STEP 1.5: PASS — legacy drained ≥${DRAIN_THRESHOLD}s, no active/idle-in-tx sessions"
```

### STEP 2.7 — Create `rls_app` role on live (NEW, per §3 binding)

```bash
# =============================================================================
# STEP 2.7 — Create rls_app role on live (one-time DDL)
# Per §3 of plan: rls_app exists only in local-dev; create on live so the
# CF-SEC-1 probe at STEP 4 runs as a meaningful non-bypass role.
# Idempotent: CREATE ROLE IF NOT EXISTS (Postgres 16+) OR DO block guard.
# =============================================================================
log "STEP 2.7: Create rls_app on live"

# Capture role inventory FIRST (binds STEP 3 to the exact live rolname)
ROLES_OUT="$STAGING_RUN_FOLDER/staging-rehearsal/live-role-inventory.txt"
psql "$DIRECT_URL" -c "
  SELECT rolname, rolbypassrls, rolsuper
  FROM pg_roles
  WHERE rolname LIKE 'postgres%' OR rolname = 'rls_app'
  ORDER BY rolname;
" > "$ROLES_OUT" 2>&1
log "  Role inventory captured: $ROLES_OUT"

# CF-CUT-IDENTITY-AUDIT-1 tripwire: confirm only ONE non-rls_app role with bypass
NON_RLS_BYPASS_COUNT=$(psql "$DIRECT_URL" -tAc "
  SELECT count(*) FROM pg_roles
  WHERE rolname != 'rls_app' AND rolbypassrls = true
    AND rolname IN (
      SELECT DISTINCT usename FROM pg_stat_activity WHERE usename IS NOT NULL
    )
" 2>/dev/null || echo "0")
log "  Non-rls_app bypass roles currently connected: $NON_RLS_BYPASS_COUNT"
[[ "$NON_RLS_BYPASS_COUNT" -le 1 ]] \
  || halt "STEP 2.7 FAIL (CF-CUT-IDENTITY-AUDIT-1 tripwire): $NON_RLS_BYPASS_COUNT distinct bypass roles connected. Single-bypass shape inadmissible. ESCALATE to Founder for path-shape revision."

# Idempotent rls_app create (Postgres 16+ supports IF NOT EXISTS on CREATE ROLE)
: "${RLS_APP_PASSWORD:?RLS_APP_PASSWORD must be set (sourced from secrets manager)}"
psql "$DIRECT_URL" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_app') THEN
    EXECUTE format('CREATE ROLE rls_app LOGIN NOBYPASSRLS PASSWORD %L', '${RLS_APP_PASSWORD}');
  ELSE
    EXECUTE 'ALTER ROLE rls_app NOBYPASSRLS';  -- ensure non-bypass even if pre-existing
  END IF;
END
\$\$;

-- Grant SELECT on all workspace-scoped tables (probe-only; no DML required for probe)
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO rls_app', r.tablename);
  END LOOP;
END
\$\$;
SQL

log "STEP 2.7: PASS — rls_app created (or confirmed NOBYPASSRLS), SELECT granted on public.*"
```

### STEP 3.5 — Bind bypass + audit (NEW, per CF-CUT-BYPASS-AUDIT-1 + CF-CUT-IDEMPOTENT-1)

```bash
# =============================================================================
# STEP 3.5 — Apply bypass + arm audit (CF-CUT-PATH-1, CF-CUT-BYPASS-AUDIT-1)
# STEP 3 (ENABLE + CREATE policies) ran above; the policies are dormant for the
# bypass role (already-bypass) and for the owner. STEP 3.5 binds the LIVE
# rolname + arms the audit pipeline.
#
# Idempotent: ALTER ROLE … BYPASSRLS is state, not delta.
# =============================================================================
log "STEP 3.5: Bind bypass + arm audit"

# Read the exact legacy rolname from staging-rehearsal/live-role-inventory.txt
: "${LEGACY_ROLNAME:?LEGACY_ROLNAME must be set (read from staging-rehearsal/live-role-inventory.txt; expected form: postgres.<tenant-id>)}"

# Pre-state capture
PRE_BYPASS=$(psql "$DIRECT_URL" -tAc "SELECT rolbypassrls FROM pg_roles WHERE rolname = '$LEGACY_ROLNAME'" 2>/dev/null)
log "  Pre-state rolbypassrls for $LEGACY_ROLNAME: $PRE_BYPASS"

# Apply / re-affirm bypass (idempotent — already-bypass = no-op)
psql "$DIRECT_URL" <<SQL
ALTER ROLE "$LEGACY_ROLNAME" BYPASSRLS;
ALTER ROLE "$LEGACY_ROLNAME" SET log_statement = 'mod';
ALTER ROLE "$LEGACY_ROLNAME" SET log_min_duration_statement = 0;
SQL

# Create bypass_query_log + policies (idempotent via IF NOT EXISTS)
psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-c-bypass-audit.sql" \
  || halt "STEP 3.5 FAIL: bypass_query_log create failed."

# Brain Decision-Log entry for the grant (per §7 of the plan)
psql "$DIRECT_URL" <<SQL
SET LOCAL app.is_superadmin = 'true';
INSERT INTO ai.decision_log (type, ts, actor, payload, workspace_id, is_system_row)
VALUES (
  'rls.bypass.grant',
  now(),
  '${OPERATOR_NAME:-rishabhporwal}',
  jsonb_build_object(
    'connection_identity', 'postgres.pavcgecgciamejdcysjx',
    'rolname_on_live',     '$LEGACY_ROLNAME',
    'granted_until',       'Path-B-completion-date (TBD)',
    'decision_basis',      'CF-CUT-PATH-1 Founder ratification 2026-05-26T16:00:00Z',
    'scope_attestation',   'single-role; grep-proven sole legacy consumer',
    'pre_state_rolbypassrls', '$PRE_BYPASS'
  ),
  NULL,
  true
);
SQL

log "STEP 3.5: PASS — bypass bound + audit armed + Decision-Log entry written"
```

### STEP 5 — RESHAPED — FORCE + real-path legacy HTTP smoke (CF-CUT-VERIFY-THE-VERIFIER-1)

```bash
# =============================================================================
# STEP 5 — FORCE + real-path legacy HTTP smoke (HARDENED per CF-CUT-VERIFY-1)
# Existing STEP 5 from Child-1 runbook is RESHAPED. The HOLD-AT-FORCE conditions
# stay in force: items (i)-(v) from README.md §15-37 still bind. The new shape
# replaces the vague "byte-identical API smoke" with a real-path HTTP gate.
# =============================================================================
log "STEP 5: FORCE + real-path legacy HTTP smoke"

# Pre-cutover snapshot (the count we'll re-assert post-FORCE)
: "${LEGACY_BASE_URL:?LEGACY_BASE_URL must be set (e.g. https://app.sugandhlok.com)}"
: "${LIVE_SUGANDH_LOK_SESSION:?LIVE_SUGANDH_LOK_SESSION must be set (a valid session cookie or auth token for the smoke)}"
: "${STEP5_ENDPOINT:?STEP5_ENDPOINT must be set (the Vikram-chosen endpoint per §6a; e.g. /api/dashboard/orders?range=last-30-days)}"

PRE_SNAPSHOT="$STAGING_RUN_FOLDER/staging-rehearsal/step5-pre.txt"
log "  Capturing pre-cutover snapshot via real legacy HTTP path → $PRE_SNAPSHOT"
curl -is "$LEGACY_BASE_URL$STEP5_ENDPOINT" \
  -H "Cookie: $LIVE_SUGANDH_LOK_SESSION" \
  > "$PRE_SNAPSHOT"
PRE_COUNT=$(grep -oE '"orders":\s*\[' "$PRE_SNAPSHOT" | wc -l | tr -d ' ')
# (Vikram refines the count-extract regex at Stage 3 per the actual endpoint shape)

# Now execute FORCE (existing step-b-force.sql)
log "  Executing FORCE (step-b-force.sql)..."
psql "$DIRECT_URL" --file "$SCRIPT_DIR/step-b-force.sql" \
  || halt "STEP 5 FAIL: step-b-force.sql failed. Run down.sql (then revoke bypass) to roll back."

# Post-FORCE real-path smoke
POST_SNAPSHOT="$STAGING_RUN_FOLDER/staging-rehearsal/step5-green.txt"
log "  Capturing post-FORCE snapshot via real legacy HTTP path → $POST_SNAPSHOT"
curl -is "$LEGACY_BASE_URL$STEP5_ENDPOINT" \
  -H "Cookie: $LIVE_SUGANDH_LOK_SESSION" \
  > "$POST_SNAPSHOT"
POST_COUNT=$(grep -oE '"orders":\s*\[' "$POST_SNAPSHOT" | wc -l | tr -d ' ')

log "  Pre-count: $PRE_COUNT  /  Post-count: $POST_COUNT"
if [[ "$PRE_COUNT" -ne "$POST_COUNT" ]]; then
  halt "STEP 5 FAIL (G2 RED): legacy endpoint count diverged ($PRE_COUNT → $POST_COUNT). \
        IMMEDIATE rollback in ORDER: (1) psql --file down.sql  (2) ALTER ROLE NOBYPASSRLS."
fi

log "STEP 5: PASS — G2 GREEN (real-path legacy HTTP smoke equal pre/post)"
```

### STEP 6 — Re-shape — re-enable + Decision-Log + post-flip second-brand grep

```bash
# =============================================================================
# STEP 6 — Re-enable crons + legacy back on LB + post-flip Decision-Log + grep
# CF-SEC-3.HARD second-brand tripwire is mechanized at the bottom of this step.
# =============================================================================
log "STEP 6: Re-enable + post-flip"

# Re-run CF-SEC-1 probe via rls_app (post-FORCE state should be GREEN with ctxless=0)
confirm "STEP 6: Re-run the CF-SEC-1 probe as rls_app and confirm GREEN (contextless count now 0)."

# Brain Decision-Log entry — rollout-complete
psql "$DIRECT_URL" <<SQL
SET LOCAL app.is_superadmin = 'true';
INSERT INTO ai.decision_log (type, ts, actor, payload, workspace_id, is_system_row)
VALUES (
  'rls.force.complete',
  now(),
  '${OPERATOR_NAME:-rishabhporwal}',
  jsonb_build_object(
    'req_id',        'feat-tenancy-rls-live-cutover',
    'cf_sec_1_post', 'GREEN',
    'step5_g2_post', 'GREEN',
    'path',          'C-with-exit-deadline-=-Path-B-completion'
  ),
  NULL,
  true
);
SQL

# Re-enable crons + legacy back on LB
confirm "STEP 6: Re-enable cron jobs (Brain crons run under withSuperadmin outer + withWorkspace per-connection)."
confirm "STEP 6: Re-add the legacy Express app to the load balancer."

# CF-SEC-3.HARD second-brand tripwire (post-flip operator grep)
sleep 60  # give the audit pipeline a minute to populate bypass_query_log
DISTINCT_WS=$(psql "$DIRECT_URL" -tAc "
  SELECT string_agg(DISTINCT workspace_id::text, ',') FROM bypass_query_log WHERE ts > now() - interval '5 minutes'
" 2>/dev/null || echo "")
log "  bypass_query_log distinct workspace_ids in last 5min: $DISTINCT_WS"
: "${SUGANDH_LOK_WORKSPACE_ID:?SUGANDH_LOK_WORKSPACE_ID must be set for the tripwire check}"
# Expected: $DISTINCT_WS ⊆ {SUGANDH_LOK_WORKSPACE_ID, ''} (the empty string for null/unattributed)
case ",${DISTINCT_WS}," in
  *,${SUGANDH_LOK_WORKSPACE_ID},*|"${SUGANDH_LOK_WORKSPACE_ID}"|",,"|"") ;;  # acceptable forms
  *) halt "STEP 6 TRIPWIRE FIRE (CF-SEC-3.HARD): bypass log shows non-Sugandh-Lok workspace_id. ROLLBACK." ;;
esac

log "STEP 6: PASS — rollout complete; tripwire CLEAR"
log "ROLLOUT COMPLETE. C5 gate state: LIVE/FORCED (Path-C with bypass deadline = Path-B completion)."
```

### ROLLBACK section (binding ordering per CF-CUT-ROLLBACK-ATOMIC-1)

```bash
# =============================================================================
# ROLLBACK (reference — invoke manually; binding ordering)
# Target wall-clock: ≤ 60s on staging clone (measured number from rehearsal
# becomes the live ceremony's pre-committed SLO; see staging-rehearsal/rollback-timing.txt).
#
# CORRECT ORDER (no 0-row window):
#   1. psql "$DIRECT_URL" --file "$SCRIPT_DIR/down.sql"
#      → drops policies + NO FORCE on 44 tables (also drops bypass_query_log policies)
#   2. psql "$DIRECT_URL" -c "ALTER ROLE \"$LEGACY_ROLNAME\" NOBYPASSRLS"
#      → revokes bypass (only when policies are already gone — no 0-row window)
#   3. Brain Decision-Log "rls.rollback" entry (psql INSERT under app.is_superadmin=true)
#
# WRONG ORDER (produces 0-row outage — captured as K3.kill on staging):
#   X1. ALTER ROLE NOBYPASSRLS         ← bypass gone but FORCE still on → legacy 0-rows
#   X2. psql --file down.sql           ← only NOW does the outage close
# =============================================================================
```

---

## 10. The DPDP §7 addendum (CF-CUT-DPDP-ADDENDUM-1)

Sibling artifact at `06b-dpdp-section7-addendum-draft.md` (this run folder).
Founder signs at Stage 7/8 BEFORE Stage-8 STEP 5 executes.

Content summary (full text in the sibling file):

1. Extends the Child-1 §7 memo (which covered RLS-policy application + CF-SEC-1
   probe + denorm backfill) with FOUR new transitional acts:
   - (a) **Live execution of FORCE ROW LEVEL SECURITY** on the prod DB (the irreversible-if-mishandled DDL).
   - (b) **Live CF-SEC-1 probe execution** as `rls_app` against PII rows.
   - (c) **Creation + use of the legacy-connection bypass** (`postgres.<tenant>` retains BYPASSRLS for the bounded interval).
   - (d) **STEP-5 real-path legacy HTTP smoke** (calls the legacy app's actual API endpoint with a Sugandh-Lok session cookie).
2. Same Founder-as-controller-of-Sugandh-Lok basis as the Child-1 memo.
3. Same residency posture (ap-south-1; no §16 transfer).
4. **Exit deadline = Path B (legacy retirement) completion date** — the
   addendum supersedes/closes when Path B ships. Written into the addendum's
   `Review-by date` row.
5. Same "not legal advice" / "review by Indian data-protection counsel"
   recommendation carries forward from the Child-1 draft.

---

## 11. The full augmented binding contract (CF-* list — see synthesis §6 for derivation)

**Inherited (carry unchanged):** CF-RES-1.a, CF-SEC-1, CF-SEC-3.HARD, CF-SEC-5,
CF-C1-POOL-1.a, CF-C1-RLS-DEFAULT-1.a, CF-C1-CRON-SCOPE-1.a, CF-C1-AUDITLOG-1.a,
CF-C1-ROLLOUT-ORDER-1 (sharpened by CF-CUT-DRAIN-1), CF-C1-ZERO-BEHAVIOR-1,
CF-BN-NOLEGACY-1, CF-BN-DDL-GATING-1.

**New / sharpened this slice:**

| CF | Sev | Owner | What it binds | How verified |
|---|---|---|---|---|
| **CF-CUT-PATH-1** | CRITICAL | Founder (RATIFIED 2026-05-26T16:00:00Z) | Path C with exit deadline = Path B completion | Decision-Log artifact `06-founder-decision-cf-cut-path-1.json` |
| **CF-CUT-RUNBOOK-AUG-1** | CRITICAL | @vikram | Extend `rollout-runbook.sh` with STEPS 0.5 / 0.7 / 1.5 / 2.7 / 3.5 / re-shaped 5 / re-shaped 6 + new ROLLBACK ordering doc | Stage-6 reads the diff against the predecessor's runbook |
| **CF-CUT-VERIFY-THE-VERIFIER-1** | CRITICAL | @vikram + Tanvi + Rohan | 3 captured kill-tests + 1 captured inverse-mutant per §6 Gate Inventory | Files in `staging-rehearsal/` per §6 last column; Tanvi reviews verbatim; Rohan re-mutates on disk |
| **CF-CUT-ROLLBACK-ATOMIC-1** | HIGH | @vikram | `down.sql` BEFORE bypass-revoke; measured time-to-rollback on staging = live ceremony SLO | `staging-rehearsal/rollback-{right-order,wrong-order-kill,timing}.txt` |
| **CF-CUT-DRAIN-1** | HIGH | @vikram | STEP 1.5: legacy off LB + `pg_stat_activity` drain ≥ 30s | Inline `pg_stat_activity` count assertion in runbook |
| **CF-CUT-SHIPROCKET-RECONCILE-1** | HIGH | @vikram (+ Founder ratifies narrowing) | STEP 0.7: Shiprocket quiesced + corrected bare-write grep ZERO + narrowing of CF-C3-FORCE-UNLOCK-SCOPE-1 in writing | `staging-rehearsal/brain-native-bare-write-grep.txt`; narrowing text in this plan §5 + runbook header |
| **CF-CUT-RESIDENCY-1** | HIGH | @vikram | STEP 0.5: staging clone ap-south-1 OR synthetic-only attestation | `staging-rehearsal/synthetic-only-attestation.txt` if (b); Postgres TZ + operator confirm if (a) |
| **CF-CUT-BYPASS-AUDIT-1** | HIGH | @vikram + Aryan (schema authored §7+§8) | Brain Decision-Log per-create/remove + `bypass_query_log` keyed by `workspace_id` (§12-scopable); attribution via `application_name` | `step-c-bypass-audit.sql`; sibling `down-bypass-audit.sql`; Decision-Log entry templates in §7 |
| **CF-CUT-DPDP-ADDENDUM-1** | HIGH | Aryan (drafts §10 + sibling `06b-`) + Founder (signs at Stage 7/8) | §7 continuity addendum enumerating 4 transitional acts | `06b-dpdp-section7-addendum-draft.md` |
| **CF-CUT-IDEMPOTENT-1** | MEDIUM | @vikram | STEP 3.5 `ALTER ROLE … BYPASSRLS` idempotent (state, not delta); STEP 2.7 `CREATE ROLE` idempotent via `DO` block | Re-run runbook on staging clone; second run = no-op |
| **CF-CUT-CALENDAR-1** | MEDIUM | Founder (owns calendar) | Runbook header documents "no festival-peak GMV window (Diwali / Republic-Day-sale / EOSS)" | Header text in `rollout-runbook.sh` |
| **CF-CUT-IDENTITY-AUDIT-1** *(NEW tripwire, this plan)* | MEDIUM | @vikram | STEP 2.7 asserts ≤1 non-`rls_app` bypass role currently connected; >1 = path-shape revision required | Inline assertion in STEP 2.7 |

---

## 12. Single-Primitive sweep

| Existing primitive | Action | Justification |
|---|---|---|
| `withWorkspace` / `withSuperadmin` (`workspace-context.ts`) | **Reuse unchanged** | Already the Single Primitive for workspace-scoped DB access; cutover doesn't touch the runtime |
| `step-a-enable-create.sql` (44 tables, 4 FK-scope shapes) | **Reuse unchanged** | Policies already exist on `origin/development`; cutover only flips FORCE + binds bypass |
| `step-b-force.sql` | **Reuse unchanged** | The FORCE per-table file is what we execute at STEP 5 |
| `down.sql` | **Reuse unchanged** | Symmetric rollback; the BINDING this slice adds is the ORDERING (rollback before bypass-revoke), not new SQL |
| `ai.decision_log` (Child-1 dual-policy) | **Extend** (NOT new primitive) | Add two new `type` values: `rls.bypass.grant`, `rls.bypass.revoke`, `rls.force.complete` (3 types). The TABLE is reused; only the `type` enum-values grow. Per Single-Primitive: extending an existing log table beats creating `bypass_decision_log`. |
| `bypass_query_log` (NEW) | **NEW primitive — justified** | The statement-attribution log is a NEW shape (per-query, parsed from Postgres `log_statement`); cannot be folded into `ai.decision_log` without ballooning row volume to 10⁶/day. Per Child-7 CF-C7-DPDP-ERASURE-1: a separate table with workspace_id-keyed deletion is the right shape. ONE new primitive; bounded retention (Path-B completion). |
| `rls_app` role | **NEW on live (already exists local-dev)** | Per §3: required for the CF-SEC-1 probe to be meaningful on live. One `CREATE ROLE` + `GRANT SELECT`. Not a new primitive design; bringing the local-dev role to parity on live. |
| Runbook (`rollout-runbook.sh`) | **Extend** (NOT rewrite) | Per requirement §Deliverable bar §2 + Founder hand-off instruction. Existing STEPS 0-6 preserved verbatim; NEW steps inserted. |

**Sweep verdict: CLEAN.** One justified new primitive (`bypass_query_log`); two
extended existing primitives (`ai.decision_log` type-enum, `rollout-runbook.sh`);
zero new abstractions for hypothetical use; zero per-channel forks.

---

## 13. Test strategy outline

**Tests proportionate to risk** — the slice is a runbook extension, not new
runtime code. The risk is in the CEREMONY, so the tests are exercised AS the
ceremony on the staging clone (the rehearsal IS the test suite).

| Layer | Tests | Owner |
|---|---|---|
| **Unit** | NONE this slice. `step-c-bypass-audit.sql` is pure DDL; the runbook is shell. Unit tests on shell would be ceremony noise. | — |
| **Static** | (i) banned-shape grep on `step-c-bypass-audit.sql` (`OR … IS NULL`, `COALESCE`, `USING (true)`, session-level `SET`) per CF-C1-RLS-DEFAULT-1.a; (ii) `feedback_legacy_is_reference_only` enforcement: `git diff -- "legacy project/"` = 0 lines (binds Stage-3 and Stage-6) | @vikram + Shreya |
| **Integration (staging-clone rehearsal)** | (a) Full runbook end-to-end on staging clone, capture `staging-rehearsal/{cf-sec-1-green.txt,step5-green.txt,rollback-right-order.txt,rollback-timing.txt}`; (b) 3 captured kill-tests per §6 Gate Inventory (G1.kill, G2.kill, G3.kill); (c) 2 captured inverse-mutants (G1.inverse, G2.inverse) | @vikram, captures-reviewed-by Tanvi |
| **Real-network smoke** | STEP 5 itself is the real-network smoke (real legacy HTTP path with real cookie). Captured pre+post pair. | @vikram |
| **Stage-6 re-mutation** | Rohan re-runs each of the 3 kills on disk during Stage-6 review per durable-rule sub-rule 7; fresh captures filed under `stage6-remutate/`. | Rohan |

**Negative controls** (per durable rule): for each gate's "GREEN" capture, also
capture a "would-be-RED" form to prove the gate is not vacuous (the K1/K2/K3
mutants ARE the negative controls).

---

## 14. Observability plan (minimal — no new dashboards)

**Per the over-engineering check:** the requirement does not name dashboards or
alerts. The slice ships ZERO new observability surfaces. What gets emitted:

- 2-3 Brain Decision-Log entries per cutover (grant, optionally revoke, complete).
- `bypass_query_log` rows for the duration of the bypass (Path-B completion or
  rollback).
- The runbook's stdout (already captured via tee in the existing harness; the
  augmentation logs to the same stream).

No new Prometheus/StatsD metrics. No new alerting. No new dashboards.

Existing Brain `audit_logs` correlation 4-tuple (CF-SEC-5) is unchanged.

---

## 15. Alternative considered + rejection rationale

| Alternative | Rejection rationale |
|---|---|
| **Statement-text logging into `bypass_query_log` (raw text column)** | Same trap as Child-7's `pg_dump` archive — not §12 erasure-scopable per row. Persona C5 specifically warned against this; chose statement_class instead. |
| **Per-query Brain Decision-Log entries (no separate `bypass_query_log`)** | Operationally infeasible at 10⁶ queries/day for a busy workspace; the Decision-Log is for *decisions* not for query-level audit. Persona C5 recommendation matched. |
| **Connection-string rotation for the bypass shape (instead of `ALTER ROLE BYPASSRLS`)** | Less idempotent (rotation can produce a third connection string on re-run); requires connection-string-distribution infra; persona O5 flagged the check-then-set guard requirement. `ALTER ROLE` is trivially idempotent. |
| **Postgres `lock_timeout = 30s` (instead of legacy-off-LB drain)** | Persona O1's option (c) — accepts in-flight tx racing the FORCE. No clean signal to the user; mid-transaction queries could succeed under OLD policy or fail; opaque outcome. Off-LB drain (option a) is the deterministic shape. |
| **Reading `pg_stat_activity` once for drain confirmation (instead of 30s zero-streak)** | A single-shot read can race a transient idle gap. The streak loop guarantees observed quiet. Conservative; ≤30s extra ceremony time. |
| **Tightening STEP 0 to a Postgres-level region check (per persona O7)** | Persona O7 marked this MEDIUM-info, non-blocking. Aryan's call: NOT in this slice. The Founder IS the operator; existing operator-confirmation is adequate. Defer to a hardening slice. (Recorded.) |

---

## 16. Open questions / dependencies / escalations

1. **Exact live `rolname`** for the legacy connection. Source-of-truth at intake
   was `legacy project/backend/.env` (`postgres.pavcgecgciamejdcysjx`) but the
   `pg_roles.rolname` form may differ slightly (Supabase sometimes uses
   `postgres.<tenant_id>` exactly; sometimes `postgres` with a per-tenant
   pooler-side translation). **Stage-3 first action: Vikram runs the role-
   inventory psql at STEP 2.7 BEFORE authoring the final STEP 3.5 string.**
   No escalation — Stage 3 resolves; tripwire CF-CUT-IDENTITY-AUDIT-1 is the
   safety net.
2. **`STEP5_ENDPOINT` choice** — Vikram picks per §6a procedure; non-blocking.
3. **Path B (legacy retirement) target completion date** — needed as the
   `granted_until` value in the Brain Decision-Log entry at STEP 3.5. **Founder
   sets at Stage 7/8 ratification**; until then, `granted_until = "Path-B-
   completion-date (TBD)"` is written. The audit basis still holds: the bypass
   IS deadline-bounded; the deadline is "Path B ships," it just isn't a calendar
   date yet.
4. **`chore-security-governance-hardening-phase` WS-1 ordering** — open question
   #4 in the original requirement. Persona O2 noted no binding conflict; just
   "don't run them the same day." Founder picks the operational order. NOT a
   plan dependency.
5. **DPDP §7 addendum signature** — Founder signs `06b-…` at Stage 7/8 BEFORE
   Stage-8 STEP 5 executes. Recorded as a Stage-7 deliverable.
6. **Path B (legacy retirement) slice** — separate Stage-8 slice on its own
   timeline. NOT in this plan's scope. The EXIT sequence in §4 is a template the
   Path B plan picks up.

---

## 16b. Handoff-depth calibration (why no separate `07-`)

Per `docs/role-empowerment-model.md §Handoff-depth calibration`:

- **High-stakes** lane → default to a separate `07-handoff-to-developer.md`.
- **BUT** the override band applies: "bounded refactor / one-file-extension /
  recipe-style work where the plan IS the handoff and a separate 07 would
  duplicate the plan." This slice is a **runbook extension** on a single shell
  file plus 2 sibling SQL files + one new audit table. Track decomposition + the
  acceptance contract fit naturally into §17 and §17b.
- A separate 07 would re-paste §6 / §9 / §11 / §17 verbatim — worse, not better.

**Aryan's calibration:** fold the handoff into this plan. §17 Tracks is the
work-decomposition; §17b is the acceptance contract Vikram targets; §16 lists
the open questions Vikram resolves at Stage 3.

---

## 17. Tracks (work decomposition — Stage 3 hand-off; @vikram backend-developer)

> Single builder. Tracks are sequential (T1 → T2 → T3 → T4 → T5). Each task is
> 2-5 min of actual editing; the heavy time is the staging-clone rehearsal.

### Track T1 — Sibling DDL files (pre-runbook prerequisites)

| # | File | Action |
|---|---|---|
| T1.1 | `apps/core-service/migrations/manual/rls/step-c-bypass-audit.sql` (NEW) | Create with the `bypass_query_log` DDL from §8. Header comments cite CF-CUT-BYPASS-AUDIT-1 + CF-BN-DDL-GATING-1. |
| T1.2 | `apps/core-service/migrations/manual/rls/down-bypass-audit.sql` (NEW) | Symmetric rollback: drop policies + DROP TABLE IF EXISTS. Idempotent. |
| T1.3 | `apps/core-service/migrations/manual/rls/README.md` (EXTEND) | Add a section "Path-C bypass + audit (this slice)" listing the new files + the binding ordering for rollback. |

### Track T2 — Runbook extension (the headline deliverable)

| # | File | Action |
|---|---|---|
| T2.1 | `apps/core-service/migrations/manual/rls/rollout-runbook.sh` (EXTEND) | Insert STEPS 0.5 / 0.7 / 1.5 / 2.7 / 3.5 / re-shape STEP 5 / re-shape STEP 6 per §9. Preserve existing STEPS 0/1/2/2.5/3/4 verbatim. Add the new `: "${VAR:?…}"` env-var requireds at the top. Add the calendar-constraint header text (CF-CUT-CALENDAR-1). Add the ROLLBACK ordering section per §9. |

### Track T3 — Audit pipeline scripts (no Brain runtime)

| # | File | Action |
|---|---|---|
| T3.1 | `apps/core-service/migrations/manual/rls/scripts/parse-pg-log-to-bypass-audit.sh` (NEW) | Shell parser: reads `postgresql.log` lines emitted by `log_statement='mod'` on the bypass role; best-effort regex-extracts `workspace_id` from `WHERE workspace_id = '<uuid>'` clauses; INSERTs into `bypass_query_log` with `statement_class` derived from the verb. Designed to be cron'd OR run one-shot post-cutover. Owns `application_name` attribution. |
| T3.2 | `apps/core-service/migrations/manual/rls/scripts/post-flip-second-brand-grep.sh` (NEW) | The CF-SEC-3.HARD second-brand tripwire (extracted from STEP 6 for re-runnability). Exit non-zero if any non-Sugandh-Lok workspace_id in last N minutes. |

### Track T4 — Staging-clone rehearsal (the verification leg)

| # | Captured artifact | Procedure |
|---|---|---|
| T4.1 | `staging-rehearsal/live-role-inventory.txt` | STEP 2.7 emits this; review verifies `postgres.<tenant>` exists with `rolbypassrls=true` |
| T4.2 | `staging-rehearsal/brain-native-bare-write-grep.txt` | STEP 0.7 emits this; assert ZERO hits |
| T4.3 | `staging-rehearsal/cf-sec-1-green.txt` | Run probe via `rls_app` post-FORCE → expect GREEN |
| T4.4 | `staging-rehearsal/cf-sec-1-kill.txt` (G1.kill) | Drop FORCE on `marketing_actions` → run probe → expect RED |
| T4.5 | `staging-rehearsal/cf-sec-1-inverse.txt` (G1.inverse) | Run probe as `postgres.<tenant>` (bypass) → expect silently-GREEN (proves probe must run as `rls_app`) |
| T4.6 | `staging-rehearsal/step5-pre.txt` + `step5-green.txt` | Pre/post real-path legacy HTTP smoke → expect equal counts |
| T4.7 | `staging-rehearsal/step5-kill.txt` (G2.kill) | Apply FORCE WITHOUT bypass → smoke → expect HTTP 500 or empty rows |
| T4.8 | `staging-rehearsal/step5-inverse.txt` (G2.inverse) | With FORCE+bypass, drop FORCE on `marketing_actions` → smoke STILL GREEN; G1 RED — proves two distinct gates |
| T4.9 | `staging-rehearsal/rollback-right-order.txt` + `rollback-timing.txt` | Run R1→R2→R3 in order; capture wall-clock; bind measured number as live SLO |
| T4.10 | `staging-rehearsal/rollback-wrong-order-kill.txt` (G3.kill) | Run R2 first (revoke bypass with FORCE on) → legacy smoke 0-rows → capture |
| T4.11 | `staging-rehearsal/synthetic-only-attestation.txt` (IF using form (b)) | If staging is not ap-south-1, the generator-command attestation lives here |

### Track T5 — Branch + handoff (NO commit)

| # | Action | Note |
|---|---|---|
| T5.1 | Branch from `chore/stage2-feat-tenancy-rls-live-cutover` (already current) for any code changes; do NOT commit per `feedback_no_commits_without_founder_approval`. | Stage-3 may produce `pending-founder-commit.md` summarizing the changes for Founder review |
| T5.2 | Hand off to Stage 4 (Shreya, VETO) — security review against the binding contract §11 + the 9 captured outputs. | |

### Over-engineering self-check (mandatory per architect.md)

| # | Check | Verdict |
|---|---|---|
| 1 | Plan length matches handoff-depth band for this work type (bounded refactor/runbook-extension) | **PASS** — folded handoff, no duplicate 07; §16b justifies |
| 2 | Every file in §17 Tracks required by the requirement | **PASS** — T1-T2 are runbook + sibling DDL (req'd); T3 is the audit pipeline (req'd by CF-CUT-BYPASS-AUDIT-1); T4 is rehearsal (req'd by CF-CUT-VERIFY-THE-VERIFIER-1) |
| 3 | No new npm/pip/uv deps unless explicitly justified | **PASS** — ZERO new package deps; only one new psql role + one new table + extended shell scripts |
| 4 | No new abstractions for hypothetical use | **PASS** — `bypass_query_log` is the ONE new primitive, requirement-driven (CF-CUT-BYPASS-AUDIT-1); `rls_app` on live is parity-with-local-dev not new design |
| 5 | No observability beyond what requirement names | **PASS** — §14 confirms zero new dashboards/metrics/alerts |
| 6 | No tests for trivial getters/setters | **PASS** — §13 explicitly skips unit tests; integration = rehearsal |
| 7 | Test strategy proportionate to risk | **PASS** — 9 captured outputs (3 kills, 2 inverses, 4 green-paths) targeting the 3 high-stakes gates; nothing more |

---

## 17b. Acceptance contract (every must-fix from synthesis §5 folded — shift-left per system-prompt §11)

Vikram's Stage-3 build is COMPLETE when ALL of:

| # | must-fix | Verifiable artifact | Source |
|---|---|---|---|
| AC1 | Path C bound; `ALTER ROLE … BYPASSRLS` idempotent shape; exit deadline written into runbook header | Runbook header text + STEP 3.5 SQL | Synthesis §5 item 1 + §10 CF-CUT-PATH-1 + CF-CUT-IDEMPOTENT-1 |
| AC2 | Exact legacy `rolname` captured from live `pg_roles`; tripwire CF-CUT-IDENTITY-AUDIT-1 asserts ≤1 bypass role | `staging-rehearsal/live-role-inventory.txt` + STEP 2.7 assertion | §3 grounding finding + §11 |
| AC3 | `rls_app` role created on live (idempotent); SELECT grants on public.* | STEP 2.7 SQL in runbook | §3 grounding finding |
| AC4 | STEP 5 = real legacy HTTP path (curl + Cookie); endpoint chosen per §6a; pre/post snapshot capture | STEP 5 in runbook + §6a binding | Synthesis §5 item 2 + §6 Gate G2 |
| AC5 | 3 kill-tests captured: G1.kill, G2.kill, G3.kill | `staging-rehearsal/{cf-sec-1-kill,step5-kill,rollback-wrong-order-kill}.txt` | Synthesis §5 item 2 + durable-rule |
| AC6 | 2 inverse-mutants captured: G1.inverse, G2.inverse | `staging-rehearsal/{cf-sec-1-inverse,step5-inverse}.txt` | Synthesis §5 item 2 + durable-rule sub-rule 3 |
| AC7 | Rollback ordering: `down.sql` BEFORE `NOBYPASSRLS`; measured wall-clock binds live SLO | `staging-rehearsal/rollback-{right-order,timing}.txt` + ROLLBACK section of runbook | Synthesis §5 item 3 |
| AC8 | STEP 1.5 drain step: legacy off LB + `pg_stat_activity` 30s zero-streak | STEP 1.5 in runbook | Synthesis §5 item 4 |
| AC9 | STEP 0.7 Shiprocket quiesce + corrected bare-write grep ZERO; gate narrowing in plan §5 + runbook header | STEP 0.7 in runbook + `staging-rehearsal/brain-native-bare-write-grep.txt` | Synthesis §5 item 5 |
| AC10 | STEP 0.5 staging-clone residency assert; ap-south-1 OR synthetic-only attestation | STEP 0.5 in runbook + `staging-rehearsal/synthetic-only-attestation.txt` if (b) | Synthesis §5 item 6 |
| AC11 | `bypass_query_log` table + policies + parser; Brain Decision-Log grant/revoke entries; `application_name` attribution | `step-c-bypass-audit.sql` + `parse-pg-log-to-bypass-audit.sh` + STEP 3.5 INSERT | Synthesis §5 item 7 + §7 + §8 |
| AC12 | DPDP §7 addendum draft signed-by-Founder at Stage 7/8 BEFORE Stage-8 STEP 5 | `06b-dpdp-section7-addendum-draft.md` | Synthesis §5 item 8 |
| AC13 | STEP 3.5 idempotent (`ALTER ROLE … BYPASSRLS` state-not-delta); STEP 2.7 idempotent (`DO` block guard); STEP 1/1.5 idempotent (operator confirms re-runnable as confirmations) | Re-run runbook on staging clone: second run = no-op (no errors) | Synthesis §5 item 9 |
| AC14 | Calendar-constraint text in runbook header ("DO NOT execute during a festival-peak GMV window"); Founder ratifies date at Stage 7/8 | Header text in `rollout-runbook.sh` | Synthesis §5 item 10 |
| AC15 | `git diff -- "legacy project/"` = 0 lines after Stage 3 build complete | git diff command run by Vikram pre-handoff | CF-BN-NOLEGACY-1; `feedback_legacy_is_reference_only` |
| AC16 | All 11 captured outputs from §17 Track T4 present in the run folder before Stage-4 handoff | `ls staging-rehearsal/` | §6 Gate Inventory + durable-rule |
| AC17 | Brain Decision-Log entries written under `app.is_superadmin=true` (system-row policy); `workspace_id=null` permitted via dual-policy CF-C1-AUDITLOG-1.a | `INSERT INTO ai.decision_log …` blocks in runbook | §7 |

**Stage-4 (Shreya) bounce conditions:**
- Any AC missing or partially-met.
- Any captured kill/inverse showing the expected-RED form actually GREEN (vacuous gate).
- `git diff -- "legacy project/"` ≠ 0.
- Any banned shape (`OR … IS NULL`, `COALESCE`, `USING (true)`, session-level `SET`) in `step-c-bypass-audit.sql`.

**Stage-5 (Tanvi) bounce conditions:**
- Any of the 9 captured outputs missing the negative-control proof (e.g. G1.kill capture exists but G1.kill.txt actually shows GREEN — gate is vacuous).

**Stage-6 (Rohan) re-mutation per durable-rule sub-rule 7:**
- Re-run G1.kill, G2.kill, G3.kill on the staging clone live during Stage-6 review; capture fresh transitions under `stage6-remutate/`.

---

## Sign-off (Stage 2)

**Plan:** READY for Stage 3.
**Builder:** @vikram (backend-developer) — single, sequential.
**Build-gated-on:** none remaining (CF-CUT-PATH-1 already Founder-ratified).
**HOLDs persisted:**
- **HOLD-AT-FORCE** (predecessor) — STAYS HELD until the augmented runbook is rehearsed on staging clone + Stage-7 sign-off.
- **HOLD-AT-STEP-5** (NEW this slice) — STAYS HELD until the §7 DPDP addendum is signed by Founder at Stage 7/8.
- **HOLD-AT-BYPASS-REVOKE** (NEW this slice) — STAYS HELD until Path B (legacy retirement) ships; revoke ceremony is a separate Stage-8 slice.

**Cost estimate:**
- Tokens/day from this slice: ZERO (no LLM).
- ₹/month from this slice: ~ZERO (one new tiny `bypass_query_log` table, bounded lifetime; one new psql role; no new long-running services).
- Operator ceremony time: ~45-60 min for the augmented live ceremony (vs ~20 min for the predecessor; +25-40 min from STEPS 0.5/0.7/1.5/2.7/3.5 + STEP 5 real-path smoke).
- Staging-clone rehearsal time: ~60-90 min (the 11 captured outputs).

**Region adapter impact:** None. This is `ap-south-1`-only DDL/audit work; no
region-varying behavior introduced.

**Reversibility:** ROLLBACK section in §9 + the captured G3 evidence proves
≤60s on staging. Live SLO bound to the measured number.

`@paradigm sql` on every artifact this slice ships.
