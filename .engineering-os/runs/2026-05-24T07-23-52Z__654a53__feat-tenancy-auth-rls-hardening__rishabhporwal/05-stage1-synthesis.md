# Stage 1 — Persona Synthesis & Finalization (Rohan, cto-advisor)

**req_id:** `feat-tenancy-auth-rls-hardening` — Child 1 of EPIC `chore-migrate-legacy-to-brain`
**Stage:** 1 (intake → synthesis, post-persona)
**Actor:** Rohan (cto-advisor) — SUBAGENT, no Agent tool
**Timestamp (UTC):** 2026-05-24T07:34:19Z
**Personas synthesized:** 2/2 — `live-rls-rollout-safety-realist` (03), `india-data-isolation-compliance-officer` (04)
**Concern count folded in:** 10 (2 CRITICAL · 6 HIGH · 2 MEDIUM) — none dropped
**Decision:** **ADVANCE** → Stage 2 (Architect, Aryan). Scope split 1a→1b re-affirmed.
**Escalation:** **ESCALATED NOW** — DPA / DPDP §4–§7 migration-time PII lawful basis (load-bearing; see §3).
**Build gated on:** the DPA / §7 continuity instrument MUST exist before Stage 3 build authorization (§3, §4).

---

## 0. Persona quality gate

Both personas surfaced ≥1 genuine, code-grounded concern (5 each). Neither is a "looks good." Both are accepted. Both stayed in lane: the realist attacked engineering correctness of the live RLS rollout; the compliance officer attacked the DPDP edges of *performing* the rollout. No overlap collisions — the two concern sets are complementary, which validates the 2-persona (two-orthogonal-dimension) call from §6 of the intake review.

---

## 1. Disposition ledger — every concern → a named, testable acceptance criterion

Each row binds to an existing or new CF-C1-* constraint and names the stage that owns the gate. Nothing is left as prose.

### From the RLS rollout-safety realist

| # | Sev | Concern (one line) | Disposition → binding criterion | Binds | Owner stage |
|---|-----|--------------------|--------------------------------|-------|-------------|
| R1 | **CRITICAL** | `SET LOCAL app.workspace_id` does NOT survive pgbouncer transaction-mode when issued as an autocommit query → 0-row outage, or silent cross-brand leak if session-level `SET` is misused. | **CF-C1-POOL-1 SHARPENED → CF-C1-POOL-1.a:** the interleaved-tenant acceptance test MUST run against the **production `DATABASE_URL` (:6543) pool**, with two interleaved tenant transactions, asserting (i) tenant B cannot observe tenant A's `app.workspace_id`, and (ii) a context-less query returns **ZERO rows** (not all rows). Test is a hard predicate for G1→GREEN. Session-level `SET` (no `LOCAL`) under the pooled path is **forbidden**; the only accepted mechanisms are tx-wrapped `SET LOCAL` / `set_config(...,true)` inside the same `$transaction` as the query, OR routing RLS-scoped traffic through `DIRECT_URL`/session-mode (a code-split in the singleton `lib/prisma.ts`). | CF-C1-POOL-1, CF-C1-RLS-DEFAULT-1 | Stage 2 design → Stage 4/5 VETO |
| R2 | **HIGH** | Legacy app connects as table-owner (`postgres`) → needs `FORCE ROW LEVEL SECURITY`; applying FORCE RLS before context-code is live = 0-row outage. Rollback is a DDL (`NO FORCE…`), not a flag flip. | **NEW CF-C1-ROLLOUT-ORDER-1:** the 1a rollout has exactly ONE safe ordering, asserted by the deploy runbook as gated go/no-go steps (not a timer): (1) deploy context-setting code FIRST (no RLS yet); (2) `ENABLE RLS` + `CREATE POLICY` (additive; owner still bypasses); (3) verify via CF-SEC-1 cross-workspace probe; (4) ONLY THEN `FORCE ROW LEVEL SECURITY` per table; (5) smoke every workspace-scoped endpoint before removing the toggle. **A4 rollback text corrected:** rollback for a FORCE'd table = `ALTER TABLE … NO FORCE RLS` + `DISABLE RLS` (a DDL migration), NOT a feature-flag toggle — Aryan must document both the forward and the DDL-rollback step. | CF-C1-ZERO-BEHAVIOR-1 (+ corrects A4) | Stage 2 design → Stage 5 runbook gate |
| R3 | **HIGH** | JOIN-based RLS on ~24 FK-transitive tables = per-row subquery (planner-regression risk) vs denormalizing `workspace_id` + a live backfill on millions of continuously-written rows (Supabase 30s statement-timeout / lock risk). | **CF-C1-FK-SCOPE-1 SHARPENED → CF-C1-FK-SCOPE-1.a:** Aryan MUST run `EXPLAIN (ANALYZE, BUFFERS)` on a representative FK-child query (e.g. `shopify_orders WHERE connection_id=$1 AND processed_at>$2`) **with the policy applied, on the live Supabase Postgres 15 instance at real data volume**, BEFORE committing to JOIN-policy vs denormalization. Acceptance bar: plan shows policy pushed into an index scan (no seqscan/nested-loop on millions of rows) OR a denormalized `workspace_id` index used directly. If denormalization is chosen, the backfill is itself an additive, **chunked/batched**, reversible, verified step that respects the 30s statement timeout and does not deadlock the live crons. | CF-C1-FK-SCOPE-1 | Stage 2 design (live EXPLAIN) → Stage 5 perf gate |
| R4 | **HIGH** | Fail-closed NULL-trap: safe `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)`; dangerous `… OR current_setting(…) IS NULL` re-opens full leak. Most likely on AuditLog/Notification + during the transition window. | **CF-C1-RLS-DEFAULT-1 SHARPENED → CF-C1-RLS-DEFAULT-1.a:** (i) static SQL review of EVERY `USING` clause — forbid `IS NULL OR`, `COALESCE(current_setting(…),'')`, and any permissive catch-all (Tanvi static gate item); (ii) test: `SET app.workspace_id=''`/unset → `SELECT COUNT(*) FROM shopify_orders` returns **0**, not the full count; (iii) **G1 (RLS-live) and G2 (cron-session-scoped) go GREEN in ONE coordinated deployment**, not two deployments with a gap — closing the transition-window where a context-less cron hits the policy. | CF-C1-RLS-DEFAULT-1, CF-C1-CRON-SCOPE-1, CF-SEC-1 | Stage 2 design → Stage 4 static + Stage 5 test |
| R5 | **MEDIUM** | Cron refactor must preserve per-connection error isolation + proof-of-attempt logging; Shiprocket has no replay → a silently-dropped connection = permanent data loss. | **CF-C1-CRON-SCOPE-1 SHARPENED → CF-C1-CRON-SCOPE-1.a:** the per-workspace-session-scoped refactor MUST preserve per-connection `try/catch` error isolation (one connection's context-setup failure must not skip others in the same tick) AND emit proof-of-attempt logging that every CONNECTED connection was attempted with a workspace-scoped context per tick. Test: B sees only B's Shiprocket shipments; a simulated context-setup failure for B does not block C's sync in the same tick — run against `:6543`. | CF-C1-CRON-SCOPE-1, G2 | Stage 2 design → Stage 5 test |

### From the India data-isolation compliance officer

| # | Sev | Concern (one line) | Disposition → binding criterion | Binds | Owner stage |
|---|-----|--------------------|--------------------------------|-------|-------------|
| C1 | **CRITICAL** | Partial-RLS deploy window: crons run cross-workspace while RLS is partially applied → Brand A PII under Brand B = DPDP §8(6) reportable breach. No quiesce-ordering is specified. | **NEW CF-C1-QUIESCE-1:** the 1a deploy harness MUST enforce a **quiesce-crons-FIRST** ordering as a machine-asserted step (not prose): (1) disable/session-scope ALL cross-workspace cron fan-out as the literal FIRST deploy step, before ANY RLS DDL; (2) apply policies only after cron fan-out is quiesced/converted; (3) the harness asserts zero active cross-workspace `findMany` (e.g. `pg_stat_activity` inspection or a verified config flag) before DDL begins. This dovetails with R2's ordering and R4's "G1+G2 together." | CF-C1-CRON-SCOPE-1, CF-C1-ZERO-BEHAVIOR-1 | Stage 2 design → Stage 5 harness-asserted gate |
| C2 | **HIGH — /ESCALATE** | No DPA / no §7 written continuity analysis / no consent or purpose columns exist anywhere. Brain's RLS probe reading `Invitation.email` and any `shopify_customers` backfill are DPDP §4 processing acts AT Child 1. A DPA or Founder-signed §7 memo is a prerequisite for Stage-3 build authorization. | **ESCALATED NOW** (see §3). **CF-SEC-3 elevated → CF-SEC-3.HARD:** a DPDP §4/§7 lawful-basis instrument (executed DPA / brand-contract processor clause with ≥ the anchor customer Sugandh Lok, OR a Founder-signed §7 continuity memo) is a **build-gating prerequisite** — Stage 3 is NOT authorized until it exists on record. Named on the Stage-7 Founder-gate checklist AND surfaced now via `pending-founder-attention.md`. | CF-SEC-3 (elevated) | **Founder (now)** → blocks Stage 3 |
| C3 | **HIGH** | CF-RES-1 must assert region at the **Postgres level** on BOTH `DATABASE_URL` (:6543) and `DIRECT_URL` (:5432); deploy exits non-zero + `/escalate` if either fails. A DNS hostname is not proof; the unverified `DIRECT_URL` is likely the RLS execution path. | **CF-RES-1 SHARPENED → CF-RES-1.a:** step-zero of the 1a deploy script is a **Postgres-level** region assertion (Supabase control-plane metadata / `pg_settings`-equivalent that ties the connection to `ap-south-1`), executed against the SAME connection string(s) used for the subsequent DDL — asserted **independently on BOTH `DATABASE_URL` and `DIRECT_URL`** if both are used. Non-zero exit + `/escalate` on failure. Hostname/DNS is NOT accepted as proof. | CF-RES-1 | Stage 2 design → Stage 5 QA gate |
| C4 | **MEDIUM** | AuditLog null-`workspaceId`: needs a dual-policy (workspace-scoped for tenants + SUPERADMIN-only for null rows) + explicit SUPERADMIN erasure path; a plain policy makes null rows un-erasable, a permissive fallback leaks system rows. | **CF-C1-AUDITLOG-1 SHARPENED → CF-C1-AUDITLOG-1.a:** Child-1 `audit_logs` RLS = **dual-policy** — workspace-scoped SELECT for `workspace_id = current_setting(…)::uuid`, PLUS a SUPERADMIN-only policy for null-`workspaceId` rows (reachable only under a superadmin session context). PLUS a documented DPDP §12 erasure procedure that runs under SUPERADMIN context with `userId`-only scoping to reach null rows. **The policy CHOICE is resolved in Child 1 even though the C9 sentinel-row migration stays deferred to Child 5** — the Child-1 policy must be compatible with the eventual sentinel migration. Stage-5 test: a workspace-session DELETE cannot reach null rows; a SUPERADMIN erasure path can. | CF-C1-AUDITLOG-1, CF-SEC-3 | Stage 2 design → Stage 5 test |
| C5 | **MEDIUM** | `ShopifyCustomer` PII processing begins at Child 1 (RLS DDL + probe + possible denorm backfill), NOT Child 3 as A6.2 said; update the A6.2 PII register + DPA scope. | **CF-C1-PII-REGISTER-1 (new, bookkeeping):** A6.2 PII boundary register gets an added row — `ShopifyCustomer` (`email`/`firstName`/`lastName`) is a **Child-1** processing event (RLS DDL + CF-SEC-1 probe + optional denorm backfill), not deferred to Child 3. The CF-SEC-3.HARD lawful-basis instrument (C2) MUST cover `ShopifyCustomer` at Child-1 scope. | CF-SEC-3, A6.2 | Stage 2 plan note → Founder instrument scope |

**Net:** 6 existing CF-C1-* / CF-RES-1 / CF-SEC-3 constraints SHARPENED with concrete testable predicates; 3 NEW constraints added (CF-C1-ROLLOUT-ORDER-1, CF-C1-QUIESCE-1, CF-C1-PII-REGISTER-1); CF-SEC-3 elevated to a hard build-gate. The two CRITICALs (R1 pooling, C1 quiesce-ordering) and the two ordering-HIGHs (R2, R4) converge on a **single coordinated, harness-asserted rollout sequence** Aryan must author: quiesce crons → context-code → ENABLE+CREATE policy → probe-verify → FORCE per table → smoke, with G1+G2 GREEN together. That convergence is the spine of the Stage-2 plan.

---

## 2. Cross-persona convergence — the one rollout sequence (binding to Aryan)

R2 + R4 + C1 are not three problems; they are one **ordering** problem with an engineering face and a compliance face. The single binding sequence for 1a:

```
STEP 0  Region assert (Postgres-level, BOTH URLs)            [CF-RES-1.a]   — exit non-zero + /escalate on fail
STEP 1  Quiesce / session-scope ALL cross-workspace crons    [CF-C1-QUIESCE-1] — harness asserts zero cross-ws findMany
STEP 2  Deploy SET-LOCAL context-setting code (no RLS yet)   [CF-C1-POOL-1.a / ROLLOUT-ORDER-1]
STEP 3  ENABLE RLS + CREATE POLICY (additive; owner bypass)  [CF-C1-RLS-DEFAULT-1.a — fail-closed predicates only]
STEP 4  CF-SEC-1 cross-workspace probe → GREEN predicate     [CF-SEC-1 — RED-by-default, Decision-Log transition]
STEP 5  FORCE ROW LEVEL SECURITY per table                   [CF-C1-ROLLOUT-ORDER-1]
STEP 6  Smoke every workspace-scoped endpoint                [CF-C1-ZERO-BEHAVIOR-1 — byte-identical responses]
        — G1 (RLS-live) and G2 (cron-session-scoped) flip GREEN TOGETHER, one coordinated deploy [R4(iii)]
ROLLBACK any FORCE'd table = ALTER … NO FORCE RLS + DISABLE RLS (a DDL migration, not a flag) [A4 correction]
```

The FK-scope design choice (R3) is a **pre-step** to STEP 3: Aryan runs the live `EXPLAIN (ANALYZE, BUFFERS)` and picks JOIN-policy vs denormalization+chunked-backfill before any policy DDL is written. The named outage step (FORCE-before-context) and named leak step (session-level `SET` on the pooled path) are both forbidden by this sequence + CF-C1-POOL-1.a.

---

## 3. The escalation call (load-bearing) — `/escalate` NOW on DPA / lawful-basis

**Decision: ESCALATE NOW.** Mirrored to `.engineering-os/pending-founder-attention.md`.

**Why this is genuinely different from the residency tripwire (which I correctly did NOT escalate at the spike):**

- The **residency tripwire** was an *unknown fact* — "what region is the DB in?" — and confirming it was the spike's own audit job. Escalating an unknown-you-can-go-find-out would have fabricated an escalation. (It resolved cleanly to `ap-south-1`.)
- The **DPA / §4–§7 lawful basis** is not an unknown fact I can go discover in the code. It is a **legal instrument that does not exist on record and that only the Founder can produce or decide** — a DPA clause with the anchor brand (Sugandh Lok), or a Founder-signed §7 legitimate-use continuity memo. The schema confirms there is no `consent_given_at`/`purpose_code` anywhere; a search of `docs/`, `requirements/`, `.engineering-os/memory/` finds no DPA and no ToS processor-role reference. So the predicate is a real **compliance ambiguity AND a missing prerequisite**, which is squarely inside my `/escalate` rubric ("compliance ambiguity — DPDP Act 2023").

**Why NOW and not deferred to the Stage-7 Founder gate:**

- It **BLOCKS Stage-3 build authorization.** Child 1 is the first slice that writes real code against the live DB. The CF-SEC-1 RLS probe will run a `SELECT` against `invitations` reading `Invitation.email`, and (if Aryan chooses denormalization) a backfill will read every `ShopifyCustomer.email/firstName/lastName` row — both are DPDP §4 processing acts performed by Brain at Child 1.
- If I defer this to Stage 7, Aryan plans (Stage 2) and Brain potentially builds (Stage 3) against live-PII reads with **no lawful basis on record** — discovering the gap *after* the processing has happened is exactly the failure mode DPDP §8(6) penalizes. A legal instrument takes wall-clock time to draft/sign; escalating now lets the Founder get it in motion **in parallel** with Aryan's Stage-2 design (which itself touches no live data), so the instrument is ready before Stage 3's first DDL/probe.
- This is **not** a paradigm/cost/moat trigger and not an irreversible-decision trigger — it is the compliance-ambiguity trigger, last-resort-appropriate because there is no canon answer I can supply in good conscience: I cannot manufacture a DPA, and §7 continuity is a *legally reasonable but unsettled interpretation* (DPDP Rules 2025 have no explicit "infrastructure migration" carve-out), so it requires the fiduciary-side representative's documented position.

**The exact Founder ask (also written to `pending-founder-attention.md`):** before Stage 3 build authorization, produce or confirm ONE of:
1. an executed **DPA / brand-contract processor clause** covering Brain's processor role + migration-time processing, with at least the anchor customer **Sugandh Lok**; OR
2. a **Founder-signed DPDP §7 legitimate-use continuity memo** attesting that RLS-policy application + CF-SEC-1 probe queries + any `workspace_id` denormalization backfill fall within the original purpose scope the brand's data was provided for (must explicitly name `Invitation.email`, `ShopifyCustomer` PII, `User`).

**Build-gating consequence:** `build_gated_on = ["CF-SEC-3.HARD lawful-basis instrument (DPA or §7 memo)"]`. Stage 2 (Aryan's design — no live data) proceeds in parallel; **Stage 3 cannot start until the instrument exists on record.** CF-RES-1.a remains an armed in-pipeline tripwire (`/escalate` re-fires only if region assertion fails at execution); it is not part of this escalation.

---

## 4. Decision, lane, scope, next owner (re-affirmed)

- **Decision: ADVANCE** → Stage 2 Architect (Aryan). Requirement is sound, planable, dependency satisfied (blocker `spike-legacy-migration-architecture` = `done`). Not CHALLENGE-BACK, not KILL.
- **Lane: high-stakes** (unchanged) — full pipeline 1→2→3→4(VETO)→5→6(VETO)→7→8, no stage dropped.
- **Scope: 1a → 1b** (unchanged, one requirement). 1a = data-layer isolation = the C5-gate-establishing unit (ships first, additive+reversible, carries G1+G2). 1b = Brain auth/role-claim contract behind 1a.
- **Next owner: Architect (Aryan), Stage 2.** **Maya (intelligence-engineer) NOT needed as co-owner** — Child 1 is pure RLS/DDL + connection-handling + JWT-claim mapping with no metric-registry, no money-parity, no AI surface and no TS↔Python numeric-parity dimension (the things Maya owns). First-pass paradigm holds: SQL/DDL + connection-handling, no ML/LLM. If Aryan's FK-scope EXPLAIN work surprisingly surfaces a metric-rollup dependency, he raises a co-owner request — but I do not pre-assign one.
- **Build gated on:** CF-SEC-3.HARD lawful-basis instrument (DPA or §7 memo) before Stage 3.

---

## 5. Open inputs carried to Aryan (Stage 2)

1. FK-transitive scoping (R3): JOIN-policy vs `workspace_id` denormalization+chunked-backfill — decide on a **live `EXPLAIN (ANALYZE, BUFFERS)`**, justify on correctness AND per-query cost AND backfill safety.
2. `SET LOCAL` mechanism under transaction pooling (R1): which CF-C1-POOL-1.a option (tx-wrapped `SET LOCAL`/`set_config(...,true)` vs `DIRECT_URL` session-mode code-split in `lib/prisma.ts`), and is RLS-scoped traffic on `:6543` or `:5432`?
3. The single coordinated rollout sequence (§2) authored as a runbook with machine-asserted go/no-go gates (quiesce, region, probe-GREEN, smoke) — including the DDL-rollback step for FORCE'd tables.
4. CF-SEC-1 RLS-probe predicate (R4/C1): the exact probe (synthetic workspace session → cross-workspace SELECT → assert 0 rows) that drives GREEN, and where the transition is written to the Decision Log.
5. AuditLog dual-policy + SUPERADMIN erasure path (C4); A6.2 PII-register `ShopifyCustomer`-at-Child-1 correction (C5).
6. Confirm 1a is independently committable/reversible with the gate GREEN before 1b lands.

---

*Authored by Rohan (cto-advisor) at Stage-1 synthesis. Decision Log + journals updated. Escalation mirrored to `pending-founder-attention.md`.*
