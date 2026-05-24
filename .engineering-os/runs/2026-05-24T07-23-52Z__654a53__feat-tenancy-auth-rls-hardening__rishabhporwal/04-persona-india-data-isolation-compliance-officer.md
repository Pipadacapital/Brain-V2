# Persona Review — india-data-isolation-compliance-officer
## feat-tenancy-auth-rls-hardening (Child 1 of chore-migrate-legacy-to-brain)

**Persona:** India Data Isolation + DPDP Compliance Officer
**Timestamp (UTC):** 2026-05-24T07:31:00Z
**Run folder:** `.engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening__rishabhporwal`
**Authored by:** india-data-isolation-compliance-officer subagent (Stage 1 brainstorm)

---

## Persona statement

I treat a cross-brand data-leak window or an unlawful PII processing step as P0. My lens is DPDP Act 2023 + DPDP Rules 2025: §4 (lawful basis for processing), §7 (legitimate uses / continuity), §8(6) (breach notification — 72 hours to the Data Protection Board, up to ₹200 crore per incident), §12/§13 (erasure/correction obligations), and §16 (cross-border transfer prohibition). I also apply the Brain canon's 4-layer workspace_id isolation non-negotiable. My review is scoped to the compliance edges of *performing* this RLS rollout on live tenant data — not the engineering correctness of the RLS design itself (that is the other persona's job).

I read: `01-requirement.md`, `02-cto-advisor-review.md` (carry-forward ledger CF-RES-1/CF-SEC-1/CF-SEC-3/CF-SEC-5/CF-SEC-SECRETS-1, constraints CF-C1-AUDITLOG-1, CF-C1-POOL-1, CF-C1-RLS-DEFAULT-1), `06-architecture-plan.md` A6 risk register (R-LEAK-01, R-RES-01, R-AUD-01), and the legacy schema (`schema.prisma`) for direct PII evidence.

---

## Concerns (numbered, ordered by severity)

---

### CONCERN 1 — CRITICAL: Partial-RLS deploy window is a DPDP §8(6) reportable breach surface with no zero-window ordering guarantee specified for Child 1

**Risk:** During the RLS rollout (1a), there is a window where SOME workspace-scoped tables have RLS policies applied and others do not. Under the production pgbouncer transaction-mode pool with the singleton PrismaClient, a request that spans both a policy-enabled table and a policy-absent table within the same Prisma query sequence executes with inconsistent isolation: the RLS-protected table enforces context; the non-protected table returns all rows for any connection context. This is not a theoretical scenario — the cron fan-out (`cron.ts:65,148`, `shiprocket-sync.ts`, `meta-sync.ts`, `google-sync.ts`) runs cross-workspace `findMany` continuously. If a cron fires during a partial-policy deployment, it may read from RLS-enabled tables under an adjacent workspace's context (whatever `app.workspace_id` a prior transaction happened to SET) while also reading from non-RLS tables that return all workspaces. The net result is an inconsistent, partially-scoped dataset being processed in a single worker context — Brand A's Shopify orders mixed with Brand B's Shiprocket shipments within one cron pass.

**DPDP §8(6) exposure:** Any such co-mingling, even transient and non-user-visible, constitutes a personal data breach if Brand B's personal data (ShopifyCustomer.email, ShiprocketShipment.deliveryPincode) is processed in Brand A's workspace context without lawful basis. Breach notification to the Data Protection Board is required within 72 hours; non-notification carries a penalty of up to ₹200 crore per incident.

**Legacy evidence:** The cron fan-out is a continuously running process confirmed at schema lines 65,148 (cron.ts) and synthesis-scan at `shiprocket-sync.ts:344`, `meta-sync.ts:282`, `google-sync.ts:652`. These paths are NOT session-scoped today and will not be session-scoped until CF-C1-CRON-SCOPE-1 is fully implemented. During the partial-RLS window — which can span minutes to hours depending on the DDL rollout script — the crons remain active and un-scoped against the partially-protected table set.

**What CF-C1-ZERO-BEHAVIOR-1 and the current plan do NOT specify:** neither the requirement nor the CTO advisor review specifies the ORDERING of RLS policy application relative to cron quiescing. The plan says "additive + toggle-guarded + reversible" but does not say: (a) crons MUST be stopped or quiesced before the FIRST RLS policy DDL statement executes; or (b) if rolling-policy-per-table is used, the order must guarantee that FK-parent tables (ShopifyConnection, ShiprocketConnection, which the crons read as their outer loop) are NOT RLS-protected before the inner table set is fully protected; or (c) the toggle that disables the cron fan-out must be the FIRST operation of the 1a rollout, before any DDL.

**Boundary it bites:** The window between "first RLS CREATE POLICY statement" and "last cron re-scoped to session-scoped invocation" is the breach surface. That window is potentially hours on a live system where DDL is run incrementally.

**Acceptance criterion to retire this concern:**
The 1a rollout plan (Stage 2 Architect) MUST specify a mandatory quiesce ordering: (1) disable or session-scope ALL cross-workspace cron fan-out paths as the literal FIRST deployment step (before any RLS DDL); (2) apply RLS policies only after the cron fan-out is fully quiesced or converted; (3) validate cron quiescence by asserting zero active cross-workspace `findMany` queries before DDL begins (using `pg_stat_activity` query inspection or a config flag verified by the deploy harness). The acceptance test must prove this ordering is enforced and not just documented.

**Escalate:** NO — this is addressable at design (Stage 2) by Aryan specifying the quiesce-first ordering. But it is a Stage-4 VETO surface if the Architect's plan does not explicitly nail the ordering. Naming it now so it cannot be glossed over in the plan.

---

### CONCERN 2 — HIGH: CF-SEC-3 migration-time PII lawful basis is genuinely ambiguous and NOT resolved — the /escalate trigger condition is real

**Risk:** CF-SEC-3 requires establishing DPDP §4 lawful basis for migration-time PII processing BEFORE any workspace-scoped PII is touched. The architecture (A6.2) names "purpose-linked consent record exists" as a pre-condition for PII crossing, and Shreya's security review (MED-3) already flagged this as unresolved. My re-examination confirms the ambiguity is real and is NOT just a spike-deferral — it bites specifically in Child 1.

**The specific Child 1 PII processing step:** Child 1 adds RLS policies on the `invitations` table (`Invitation.email` — schema:231, confirmed PII). Adding a Postgres RLS policy to a table is itself a schema DDL operation that Postgres executes while it has a lock on the table. That lock is held during the policy-creation DDL. More critically, the deploy script that TESTS the RLS policy (the fail-closed probe required by CF-SEC-1) will necessarily run a `SELECT` against the `invitations` table under a synthetic workspace session. That SELECT reads `Invitation.email` rows — it is a DPDP §4 processing act. Similarly, if denormalization of `workspace_id` onto FK-scoped tables is chosen (Aryan's call under CF-C1-FK-SCOPE-1), any backfill script that reads `ShopifyCustomer.email`/`firstName`/`lastName` (schema:473-474) to populate a new column is unambiguously §4 processing.

**What "lawful basis" means here under DPDP:** Brain is positioned as a data processor (the brand is data fiduciary). For Brain to process the brand's customer PII during a migration operation, there must either be: (a) a Data Processing Agreement (DPA) between Brain and each brand that explicitly authorises migration-time processing as a permissible operation; OR (b) reliance on DPDP §7 legitimate-uses continuity (that the original purpose for which the data was provided — Shopify/Shiprocket analytics — encompasses infrastructure migrations that do not change the purpose or exposure). Option (b) is a legally reasonable reading but it is an interpretation, not a settled rule — DPDP Rules 2025 do not contain an explicit "infrastructure migration" carve-out.

**Evidence of the gap:** The A6.2 PII register notes "consent/purpose column added (Brain models DPDP consent the legacy schema lacks)" — confirming the legacy schema has NO `consent_given_at` / `purpose_code` / consent record for any PII held in `ShopifyCustomer`, `Invitation`, or `ShopifyOrder`. There is no DPA documented anywhere in the Brain project (searched `docs/`, `requirements/`, `.engineering-os/memory/`). There is no Terms of Service reference establishing Brain's processor role. This means at the time Child 1 build starts, the legal instrument that would provide the lawful basis for migration-time processing does not exist on record.

**Why this is HIGH and not just MED:** Child 1 is the FIRST slice that writes real code against the live DB (`pavcgecgciamejdcysjx`). If a DPA or a §7 continuity analysis does not exist before Child 1 touches live PII rows (even in read-only RLS probe form), Brain has processed brand-customer PII without a documented lawful basis. This is a DPDP §4 violation at execution time.

**What MUST be true before the Child 1 build is authorised to run:**
Either (a) a DPA (or equivalent terms in the Brain-brand contract) exists that covers migration-time processing and Brain's role as processor, OR (b) a written §7 legitimate-use continuity analysis exists (authored by a legally responsible person, not a code comment) that documents why the migration processing is within the original consent scope. The requirement should NOT be treated as "Aryan/Shreya own this at build-time" without a named legal deliverable with a sign-off.

**Acceptance criterion to retire this concern:**
Before Stage 3 (build authorisation), the Founder must produce or confirm one of: (a) executed DPA or brand contract clause with at least the anchor customer (Sugandh Lok) covering processor-role + migration-time processing; or (b) a written §7 continuity memo signed by Founder (as data fiduciary representative) attesting that RLS policy application + probe queries fall within the original purpose scope. This deliverable is NAMED in the Stage-7 Founder Gate checklist, not just in the constraint list.

**Escalate:** YES — this is a `/escalate` candidate at build-time per CF-SEC-3. I am flagging it NOW (Stage 1) so Rohan can surface it to Founder at the Stage-7 gate rather than discovering it during Stage 3 build. The Founder should be aware that a legal instrument, not just a technical design, is required before the first DDL runs.

---

### CONCERN 3 — HIGH: CF-RES-1 positive-assertion mechanics are under-specified — a hostname check is NOT a region proof

**Risk:** The requirement states CF-RES-1 runs as a "positive-assertion confirmation" that the DB is still `ap-south-1` before RLS DDL. The region was confirmed by inspecting the pooler hostname `aws-1-ap-south-1.pooler.supabase.com` (deploy-report.md:67-68). But a hostname check is NOT an execution-time assertion of actual data residency. The hostname encodes the intended region, but it does not prove: (a) the Supabase project has not been migrated; (b) the `DIRECT_URL` (the `5432` non-pooled path, which is the likely RLS execution path) is also ap-south-1; (c) no read replica or Supabase branching feature is inadvertently routing queries to a different region; or (d) the environment variable resolved at deploy time is actually the ap-south-1 host and not a proxy or VPN endpoint.

**DPDP §16 exposure:** If any RLS DDL or probe query executes against a Postgres endpoint that is NOT physically in ap-south-1 (e.g., Supabase has migrated the project, or a staging DB is used that is in a different region), Brain has processed Indian brand-customer PII outside India without a cross-border transfer safeguard — a §16 violation with no "necessary for specified purpose" exception applicable to infrastructure migrations.

**The gap:** Neither the requirement nor the CTO advisor review specifies HOW the positive assertion is mechanically implemented. "Confirm ap-south-1 before DDL" is stated as a constraint, but the concrete probe is not defined. A hostname DNS lookup is insufficient because DNS is spoofable and does not prove physical data location. The correct control is a Postgres-level assertion: `SELECT current_setting('supabase.region')` or an equivalent Supabase metadata API call that returns the project region from the control plane, compared against the expected value `ap-south-1`, executed as the literal first step of the deploy script, with the deploy script exiting non-zero and firing `/escalate` if the assertion fails.

**Additional gap — DIRECT_URL is un-asserted:** The legacy stack has BOTH a `DATABASE_URL` (pgbouncer, port 6543) and a `DIRECT_URL` (direct, port 5432). Rohan's review correctly identifies that RLS-scoped traffic likely needs to route through `DIRECT_URL` (session mode, not transaction pooling). If the assertion probes only `DATABASE_URL` but the actual DDL and RLS probes execute against `DIRECT_URL`, the assertion is against the wrong connection. Both must be assertable.

**Acceptance criterion to retire this concern:**
The Child 1 deploy script (1a) MUST include as step zero: a Postgres-level region assertion executed against the SAME connection string(s) used for subsequent DDL. The assertion must query a Supabase metadata endpoint or a `pg_settings`/`current_database()` check that unambiguously ties the connection to ap-south-1. The deploy script exits non-zero and fires `/escalate` on assertion failure. BOTH `DATABASE_URL` and `DIRECT_URL` must be asserted independently if both are used in the rollout. This assertion is documented in the Stage-2 architecture plan and is a Stage-5 QA gate item.

**Escalate:** NO at Stage 1 — the region IS confirmed as ap-south-1. But the mechanical spec for HOW the assertion runs is a HIGH-priority Stage-2 input for Aryan (not optional prose).

---

### CONCERN 4 — MEDIUM: AuditLog null-workspaceId rows become un-erasable AND the RLS policy for AuditLog is underdetermined — both directions are wrong

**Risk:** `AuditLog.workspaceId String?` (schema:658) means the table has a mix of: (a) brand-scoped rows (`workspaceId NOT NULL`), and (b) system-event rows (`workspaceId IS NULL`). Under RLS with `app.workspace_id = '<W>'`, a policy of the form `WHERE workspace_id = current_setting('app.workspace_id')` will silently exclude all null-`workspaceId` rows from every workspace session. This has two compliance failure modes depending on whether the system rows contain any PII:

**Failure mode A — erasure un-scoping:** If a brand sends a DPDP §12 erasure request for a user who appears in both workspace-scoped audit rows (membership changes, invitation events) AND system-level audit rows (e.g., admin actions on the account, login events attributed to `workspaceId=NULL`), the null rows will NOT be found by a workspace-scoped erasure query under RLS. An erasure script that runs as `SET LOCAL app.workspace_id = '<W>'` then `DELETE FROM audit_logs WHERE user_id = '<user>'` will skip all null-`workspaceId` rows for that user. Those rows may contain PII (the `userId` field is always NOT NULL at schema:659; `ipAddress` and `userAgent` are also present). The DPDP §12 erasure obligation is not fulfilled for those rows.

**Failure mode B — tamper-evidence break:** If the null-`workspaceId` rows are given a blanket `USING (workspace_id IS NULL)` permissive policy (to keep them visible for ops), then ALL workspace sessions see ALL system rows — the isolation intended by RLS is broken for the AuditLog specifically. A Brand A session can read system audit rows that reference Brand B's userId or entityId.

**Legacy evidence:** Schema line 658 — `workspaceId String?` with no default, no NOT NULL constraint. Schema line 659 — `userId String @map("user_id") @db.Uuid` — NOT NULL, always user-attributed. The `AuditLog` index at line 670: `@@index([workspaceId, createdAt])` and line 671 `@@index([userId, createdAt])` — both exist, meaning user-only queries are already anticipated, but under RLS with workspace-scoped context those user-only queries via `userId` will still be filtered by the `workspace_id` RLS policy if it is written as a simple equality check.

**A1.4 disposition states:** null rows go to a "system-workspace sentinel" — but this migration is BOUND IN CHILD 5, not Child 1. Child 1 adds RLS to the AuditLog table NOW. The sentinel migration is deferred. So there is a gap: Child 1 applies RLS to AuditLog (or must not, which is also wrong), but the null rows are not remediated until Child 5. The policy Aryan writes for AuditLog in Child 1 MUST be compatible with both the current null-row reality AND the eventual sentinel migration.

**Acceptance criterion to retire this concern:**
The Child 1 1a RLS policy for `audit_logs` MUST be explicitly designed to handle null-`workspaceId` rows without either of the two failure modes. The accepted design is: (a) a dual-policy on AuditLog: workspace-scoped SELECT for rows where `workspace_id = current_setting('app.workspace_id')::uuid`, AND a SUPERADMIN-only policy for null-`workspaceId` rows (accessible only under a superadmin session context, not any tenant session); PLUS (b) an erasure procedure documented that EXPLICITLY runs under SUPERADMIN context and uses `userId`-only scoping to catch null-`workspaceId` rows — so DPDP §12 erasure is complete. The Child 1 architecture plan must document this policy choice and the erasure procedure gap explicitly. The Stage-5 QA test must verify that a workspace-session DELETE cannot reach null-`workspaceId` rows AND that a SUPERADMIN erasure path can.

**Escalate:** NO — addressable at design. But the A1.4 deferral to Child 5 must NOT defer the RLS policy CHOICE for the null rows. Aryan must resolve the policy in Child 1's plan, even if the sentinel migration is deferred.

---

### CONCERN 5 — MEDIUM: ShopifyCustomer PII is FK-scoped (connectionId, not workspaceId) and is in scope of Child 1 RLS — but the A6.2 PII register marks its crossing as "Child 3," creating a false safety window

**Risk:** The A6.2 PII boundary register states `ShopifyCustomer` (email, firstName, lastName) crosses the boundary "at Child 3 ingest → Child 4 ClickHouse/S3." This is correct for the NEW Brain ingest path. However, `ShopifyCustomer` already EXISTS in the legacy DB (schema:472) and Child 1 is adding RLS policies to it (A1.1 row #19 explicitly marks it as `RLS` missing, scoped to C1 for the RLS fix). The table is FK-scoped via `connectionId` (schema:474) — it is one of the ~24 transitive tables that Child 1 must protect via a JOIN-based policy or `workspace_id` denormalization (CF-C1-FK-SCOPE-1).

**The gap:** When Child 1's RLS probe test runs a cross-workspace SELECT on `shopify_customers` to verify isolation (required by CF-SEC-1), it reads `email`, `firstName`, `lastName` — confirmed PII — under a synthetic test workspace session. This is DPDP §4 processing of brand-customer PII by Brain. The A6.2 register's "Child 3" framing may lead the team to believe ShopifyCustomer PII processing under DPDP does not apply until Child 3 — this is wrong. Child 1 touches this table with RLS DDL and probe queries.

**Additionally:** If denormalization is chosen (backfill of `workspace_id` onto `shopify_customers`), the backfill script reads every PII row to populate the new column — a full-table PII processing operation in Child 1, not Child 3.

**Boundary it bites:** The A6.2 register needs an additional row: `ShopifyCustomer` at Child 1 (RLS DDL + probe + possible denormalization backfill) — not just at Child 3. The lawful-basis requirement (Concern 2 above) therefore applies to `ShopifyCustomer` PII processing starting at Child 1, not deferred to Child 3.

**Acceptance criterion to retire this concern:**
Update the A6.2 PII register to add `ShopifyCustomer` as a Child 1 processing event (RLS DDL + probe + optional denormalization backfill). The DPA/§7 continuity analysis required for Concern 2 must cover this table's processing at Child 1, not just at Child 3. The Child 1 Stage-2 architecture plan must explicitly note that denormalization of `workspace_id` onto `shopify_customers` (if chosen) is a full PII-processing operation requiring the same lawful basis as any other migration step.

**Escalate:** NO — correction to the register; surfaces as a build-time input to Aryan.

---

## Bottom line

**The single most dangerous compliance gap in this rollout:** There is no quiesce-first ordering guarantee between "first RLS policy applied" and "cron fan-out converted to session-scoped" — meaning the partial-RLS window is a live DPDP §8(6) breach surface (Concern 1, CRITICAL). Fix: Aryan's Stage-2 plan MUST specify cron quiescence as the literal first step, before any DDL, and the deploy harness must assert it. Additionally, there is no existing legal instrument (DPA or §7 memo) authorising Brain's migration-time processing of brand-customer PII, and this instrument must exist before Child 1 build is authorised (Concern 2, HIGH, escalate-yes at Stage-7 Founder gate).

---

*Authored by: india-data-isolation-compliance-officer persona (Stage 1, transient subagent). Rohan records in Decision Log at synthesis.*
