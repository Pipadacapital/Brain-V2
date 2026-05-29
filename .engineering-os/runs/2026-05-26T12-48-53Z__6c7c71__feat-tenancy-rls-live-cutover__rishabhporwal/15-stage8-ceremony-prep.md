# Stage 8 — Live FORCE-flip Ceremony Prep — `feat-tenancy-rls-live-cutover`

> Prep only (claude-code, 2026-05-29). **Execution is Founder-at-console.** This is the
> go/no-go runbook that sequences everything required BEFORE and DURING the live FORCE
> flip that closes the OPEN P0 (live Supabase ap-south-1, zero RLS since 2026-05-24).
> Authoritative code: `apps/core-service/migrations/manual/rls/rollout-runbook.sh`
> (merged via PR #15). Plan: run-folder `06-architecture-plan.md` (§4 sequence, §6 gates,
> §9 step shell, §17b acceptance contract).

---

## A. PRE-CEREMONY GATES (must ALL be GREEN before the ceremony window opens)

| # | Gate | Owner | Status today | How to close |
|---|---|---|---|---|
| P1 | **Sign the DPDP §7 addendum** (`06b-dpdp-section7-addendum-draft.md`, Acts A–D, §8(2)+§7 basis) | Founder | UNSIGNED-DRAFT | Review + sign in run folder BEFORE STEP 5 (CF-CUT-DPDP-ADDENDUM-1 / HOLD-AT-STEP-5) |
| P2 | **Set a REAL Path-B completion date** for `granted_until` | Founder | placeholder "TBD" | Pick the legacy-retirement target date; write it into the runbook header + the STEP 3.5 Decision-Log `granted_until` |
| P3 | **Pick a festival-safe window** (no Diwali / Republic-Day-sale / EOSS) | Founder | not set | CF-CUT-CALENDAR-1; confirm the chosen date isn't a peak-GMV window |
| P4 | **Provision an ap-south-1 staging clone** (or a synthetic-only attestation) | Jatin/Founder | not provisioned | Either (a) a real ap-south-1 clone of live, or (b) `synthetic-only-attestation.txt` with the generator command (STEP 0.5 / CF-CUT-RESIDENCY-1) |
| P5 | **Run the 11 DEFERRED staging captures** on the clone | Jatin/Vikram | DEFERRED (commands documented in `staging-rehearsal/*.txt`) | Execute the runbook end-to-end on the clone; capture the real green/kill/inverse outputs (AC5/AC6/AC7/AC16) |
| P6 | **Rohan's re-mutation** (durable-rule sub-rule 7, 10th occurrence) | Rohan + clone | BOUND as HARD precondition, NON-WAIVABLE | Re-run G1/G2/G3 kills live on the clone; capture fresh RED/GREEN transitions to `stage6-remutate/` |
| P7 | **Bind the exact live `rolname`** for the legacy connection identity | Vikram | pending live `pg_roles` query | STEP 2.7 emits `live-role-inventory.txt`; read it, set `LEGACY_ROLNAME`; confirm CF-CUT-IDENTITY-AUDIT-1 (≤1 bypass role) |
| P8 | **Choose + bind `STEP5_ENDPOINT`** (real legacy HTTP path) | Vikram | candidate named in §6a | Pick the legacy route per §6a; capture the pre-cutover snapshot |

**Go/No-Go rule:** if ANY of P1–P8 is not GREEN, the ceremony does NOT open. P6 is explicitly non-waivable (no fabricated re-mutation).

---

## B. REQUIRED ENV VARS (sourced at console, never committed)

```
DIRECT_URL                  # live Supabase direct connection (:5432) — for DDL + probes
STAGING_DIRECT_URL          # the staging clone (rehearsal target)
STAGING_RUN_FOLDER          # where rehearsal captures are written
LEGACY_ROLNAME              # exact postgres.<tenant> rolname from live pg_roles (P7)
RLS_APP_PASSWORD            # from secrets; rls_app NOBYPASSRLS role
LEGACY_BASE_URL             # e.g. https://app.sugandhlok.com (STEP 5 smoke)
LIVE_SUGANDH_LOK_SESSION    # valid session cookie/token for the smoke
STEP5_ENDPOINT              # the chosen legacy route (P8)
SUGANDH_LOK_WORKSPACE_ID    # for the CF-SEC-3.HARD second-brand tripwire
CUTOVER_DRAIN_SECONDS       # default 60
OPERATOR_NAME               # rishabhporwal
```

---

## C. CEREMONY SEQUENCE (the binding order — from runbook + plan §4)

```
0     region-assert (existing)
0.5   STAGING residency assert            (CF-CUT-RESIDENCY-1)
0.7   Shiprocket quiesce + bare-write grep ZERO   (CF-CUT-SHIPROCKET-RECONCILE-1)
1     cron quiesce (existing)
1.5   legacy OFF the load balancer + pg_stat_activity drain >= 30s   (CF-CUT-DRAIN-1)
2     context-code verify (existing)
2.5   FK-scope EXPLAIN gate (existing)
2.7   CREATE rls_app on live (idempotent) + capture live-role-inventory   (P7)
3     ENABLE + CREATE policies (existing; step-a-enable-create.sql)
3.5   ALTER ROLE <LEGACY_ROLNAME> BYPASSRLS + arm audit + Decision-Log GRANT entry
4     CF-SEC-1 probe via rls_app  → expect GREEN (LEAK gate G1)
5     FORCE (step-b-force.sql) → real-path legacy HTTP smoke pre==post   (NO-OUTAGE gate G2)
6     re-enable crons + legacy BACK on LB + Decision-Log COMPLETE + second-brand grep
```

**Two gates must BOTH be GREEN to declare cutover-complete:** G1 (leak, via `rls_app`) AND
G2 (no-outage, real legacy HTTP). Neither alone authorizes the flip.

---

## D. ROLLBACK (binding order — CF-CUT-ROLLBACK-ATOMIC-1; SLO ≤60s from rehearsal)

```
R1  psql "$DIRECT_URL" --file down.sql                      # drop policies + NO FORCE (44 tables)
R2  psql "$DIRECT_URL" --file down-bypass-audit.sql         # drop bypass_query_log + policies
R3  psql "$DIRECT_URL" -c 'ALTER ROLE "<LEGACY_ROLNAME>" NOBYPASSRLS'   # revoke — ONLY after R1+R2
R4  Decision-Log 'rls.rollback' INSERT (BEGIN; SET LOCAL app.is_superadmin; INSERT; COMMIT;)
```
**WRONG order (revoke-first) = 0-row outage window.** Captured as the G3 kill on the clone.

---

## E. POST-CEREMONY

- `bypass_query_log` runs for the bounded interval (until Path-B completion or rollback).
- The second-brand tripwire (`post-flip-second-brand-grep.sh`) confirms only Sugandh-Lok's
  workspace_id appears; any other ⇒ CF-SEC-3.HARD re-arm + immediate rollback.
- **EXIT ceremony (separate Stage-8 slice, when Path B ships):** confirm legacy off LB
  permanently → `ALTER ROLE NOBYPASSRLS` → Decision-Log `bypass.revoke.path-b-completion`
  → re-run CF-SEC-1 via rls_app → still GREEN.

---

## F. WHAT THIS CLOSES

On a GREEN ceremony, the **OPEN P0 closes**: every NEW connection to the live Supabase DB is
tenant-isolated by FORCED RLS; the legacy app coexists via the audited, deadline-bounded
bypass. This is the storage-layer close; full legacy retirement (Path B) is the final close.

---

## G. OPEN DEPENDENCIES NOT OWNED BY THIS SLICE

- The ap-south-1 staging clone (P4) is infra not yet provisioned — the single biggest
  blocker to running P5/P6. Recommend Jatin provisions it as the first concrete Stage-8 act.
- No relation to the credential-custody Option-A build (separate slice) — RLS cutover does
  not depend on custody.
