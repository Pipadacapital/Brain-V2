# Security Review — feat-tenancy-auth-rls-hardening (Child 1)

**Reviewer:** Shreya (security-reviewer)
**Stage:** 4 — PARALLEL REVIEW MODE (concurrent with Tanvi/QA Stage 5)
**Timestamp (UTC):** 2026-05-24T07:00:00Z (see live.log for exact)
**Branch:** feature/feat-tenancy-auth-rls-hardening
**Verdict:** **PASS** (zero CRITICAL, zero HIGH, zero compliance violation, zero missing-traceability, secret hygiene CLEAN)
**Authority note:** I did NOT re-litigate the Founder's DPDP build-gate lift (ownership grounds, governance deferred to `chore-security-governance-hardening-phase`). I reviewed the build's own isolation correctness at full strength. The migration's isolation work is NOT deferred.

---

## Change-class scope

In-scope surfaces this diff touches: **multi-tenancy isolation (the core)**, **auth/RBAC (Brain claim)**, **PII (ShopifyCustomer/Invitation under RLS)**, **data residency (region-assert)**, **DB connection handling**, **traceability (CF-SEC-5 4-tuple)**, **audit-log immutability (Decision-Log writes)**.
Out of scope (N/A — surface not touched): outbound channels (DLT/NCPR/WhatsApp/AI-voice/calling-window), payment-card data (PCI), LLM/agent-emitted actions, new API mutation endpoints, money-derived numeric code. No outbound, no LLM, no money math in this slice — those India-telecom/agentic gates are **N/A — out of scope (SQL-DDL + connection-handling slice)**.
ALWAYS-ON checks run regardless: secret grep, supply-chain (none added), input-validation, PII-in-logs sampling, residency design. All performed below.

---

## Findings (by severity)

### CRITICAL — none
### HIGH — none

### MEDIUM

**M1 — Inner sync writes bypass RLS session context (deferred to Child 3). SAFE-TO-DEFER at Child-1 *commit*, but a HARD must-fix-before-FORCE.**
- Files/lines:
  - `src/routes/cron.ts:108-150` (Shopify), `:243` (recompute)
  - `src/lib/integrations/shiprocket-sync.ts:377-379` → `upsertOrder` `:463`, `upsertShipment` `:518`
  - `src/lib/integrations/meta-sync.ts:311` → inner `prisma.meta_ads_*` writes `:56-262`
  - `src/lib/integrations/google-sync.ts:681` → inner `prisma.google_ads_*` writes `:152,205,581,639`
- Mechanics: every `withWorkspace(ws, async (_tx) => {...})` closure discards the `_tx` handle (underscore-prefixed, unused — confirmed all 5 call sites). The `set_config('app.workspace_id', …, true)` is **tx-local to the `rlsPrisma` :5432 transaction**; the inner writes execute on the **singleton `prisma` (:6543 transaction-mode pool)**, which carries NO `app.workspace_id`. So the RLS context set by `withWorkspace` has **zero effect** on what the inner writes actually do.
- **Why this is NOT a Child-1 leak (the load-bearing call):** the DB role is `postgres` (the table OWNER — confirmed from `.env.bak.singapore` / `.env.example`). The owner **bypasses RLS until FORCE is applied**. This Child-1 *code commit* ships **no DDL to the live DB** (Track 1a-C/F execution is gated to Stage 8 behind the Founder Stage-7 gate + `rollout-runbook.sh`). In the pre-FORCE state (where Child-1 leaves the DB), inner writes behave **exactly as today** — app-layer `workspace_id`/`connectionId` filtering is unchanged, so there is **no new isolation regression and no cross-tenant leak introduced by this commit.**
- **Why it is still a real hole (must-fix-now-for-Child-3, not a silent defer):** the moment STEP 5 FORCE is applied (Stage 8 / future child), the owner becomes subject to the policy. An inner write with no `app.workspace_id` evaluates `workspace_id = current_setting('app.workspace_id', true)::uuid` → `NULL` → WITH CHECK **denies** → **cron write OUTAGE** (Shiprocket has no replay → R5 permanent-data-loss surface). This is fail-**closed** (outage), NOT fail-open (leak) — that is the saving grace and the reason it is MEDIUM, not CRITICAL/HIGH.
- **Containment is verified, not assumed:** `rollout-runbook.sh` STEP 6 runs a cron tick + a post-FORCE probe re-run (`:240`), so an attempt to FORCE with these inner writes unchanged would FAIL the smoke + trigger rollback — the outage cannot silently reach production. G1+G2 cannot go GREEN together (the synthesis R4(iii) requirement) until the inner writes are converted.
- **Remediation (Child 3, MUST precede any FORCE):** convert inner sync writes to the RLS path — either (a) route the inner write modules through `rlsPrisma` inside the same `withWorkspace` transaction (use the `tx` handle, drop the underscore), or (b) thread a per-call workspace context. Until done, the runbook MUST NOT advance past STEP 4 (probe GREEN) to STEP 5 (FORCE) for the Shopify/Shiprocket/Meta/Google write paths. Recommend the orchestrator pin this as a **blocking predecessor on Child 3** and on the Stage-8 runbook FORCE step.
- **Disposition:** Vikram flagged this in the build report; the flag is accurate. It is correctly OUT of Child-1's committed scope and does NOT break or leak at Child-1 deploy. Logged as tech-debt + a hard gate on FORCE. Does NOT block this PASS.

**M2 — RLS probe `contextless` check semantics depend on FORCE ordering (deploy-time, Tanvi gate).**
- File: `src/lib/rls-probe.ts:170-172` — the context-less COUNT runs on bare `rlsPrisma` (no tx, no context). The probe is documented to run at runbook STEP 4 (after ENABLE+CREATE, **before** FORCE). Before FORCE, the `postgres` owner bypasses RLS, so the context-less COUNT returns the **full** count, not 0 → the table verdict is RED → FORCE is (correctly) blocked.
- This is arguably the intended fail-closed behavior (you should not FORCE until isolation is proven), but the *probe's own GREEN predicate cannot be satisfied before FORCE* for the owner role — which means the runbook's STEP 4 "probe GREEN gate before FORCE" needs a non-owner probe role OR the predicate must be evaluated under a role that does not bypass. This is a **deploy-mechanics correctness item for Tanvi's live-DB gate**, not a committed-code security flaw.
- **Remediation:** Tanvi to confirm at Stage 5/8 that the probe runs as a role subject to RLS (or that STEP 4 measures cross-read isolation, which works pre-FORCE for non-owner, and defers the contextless=0 assertion to the post-FORCE re-run at STEP 6 `:240`). Does NOT block this PASS.

### LOW

**L1 — `withWorkspace` does not validate UUID shape before binding.** `src/lib/rls-prisma.ts:144` binds `${workspaceId}::text`; the policy casts `::uuid`. A malformed workspaceId surfaces as a Postgres cast error at query time (fail-closed, but an error rather than a clean 0-row). Caller (`requireWorkspace`) sources it from a verified DB row so exploitation surface is nil. Optional: add a UUID regex guard in `withWorkspace` for defense-in-depth. Non-blocking.

**L2 — `runInWorkspace` is a thin alias of `withWorkspace`** (`rls-prisma.ts:192-197`); the file-doc comment calls it "no mutation" but it can mutate (delegates fully). Cosmetic doc drift. Non-blocking.

### INFO

- **I1 — Table count nomenclature:** step-a ENABLEs 43 tables (40 single-policy + audit_logs/notifications dual + system_settings superadmin-only); the report/runbook say "44 workspace-scoped." The 43-vs-44 is benign: `system_settings` is superadmin-only (not workspace-scoped) and the runbook's `FORCE_COUNT >= 44` includes it. step-a ENABLE coverage == step-b FORCE coverage == down.sql DISABLE coverage (verified by diff — only difference is a comment line). No table is left unprotected; no table is FORCE'd without a policy; no policy without a FORCE.
- **I2 — Decision-Log write hardcodes a synthetic probe user UUID** (`rls-probe.ts:255` `00000000-…-001`) and swallows write failure (`:273-277`) so a Decision-Log outage doesn't suppress the probe verdict. Acceptable for an append-only audit transition record; Tanvi to confirm that synthetic UUID satisfies the `audit_logs.user_id` FK at deploy.

---

## Gate (G4) checklist

| Check | Result |
|---|---|
| Zero CRITICAL | PASS |
| Zero HIGH | PASS |
| Zero compliance violation (DPDP/PDPL/DLT/NCPR/window/recording) | PASS — no outbound/telecom/recording surface; DPDP build-gate lifted by Founder (not re-litigated); residency design correct |
| Zero missing-traceability | PASS — CF-SEC-5 4-tuple present on every new runtime path |
| Every mutation endpoint guarded | N/A — slice adds no new API mutation routes; `requireRole`/`assertRole` authored, per-route wiring deferred to route-migration phase (correctly scoped) |
| Every MCP tool tenant-checked + Decision-Log | N/A — no MCP/agent surface in slice |
| Every connector OAuth-encrypted + webhook-signed | N/A — no new connector OAuth/webhook in slice (sync refactor only) |
| PII not in logs (sampled) | PASS — proof-of-attempt logs carry connectionId/workspaceId/requestId/traceId only; no email/phone/customer PII; probe uses COUNT(*) only (no PII rows read) |
| Vuln scans CLEAN on CRITICAL/HIGH | PASS — no new deps added (supply-chain delta = 0); no new vulnerable code patterns |

---

## Multi-tenancy isolation (top VETO surface) — detailed

- **Fail-closed policy template (CF-C1-RLS-DEFAULT-1.a):** every USING/WITH CHECK across `up.sql`, `step-a-enable-create.sql` uses EXACTLY `workspace_id = current_setting('app.workspace_id', true)::uuid` (Group A) / `connection_id IN (SELECT … WHERE workspace_id = …)` (Group B) / 2-hop subquery (Group C). **Grepped all SQL for the banned NULL-trap** (`OR current_setting(...) IS NULL`, `COALESCE`, `USING (true)`): the ONLY hits are the documentation comment block in `up.sql:18-20` and a descriptive comment `up.sql:410` — **zero in executable policy clauses.** `current_setting('app.is_superadmin', true) = 'true'` is also fail-closed: unset → NULL → `NULL = 'true'` is NULL (not true) → denies.
- **Coverage:** 43 ENABLE == 43 FORCE == 43 DISABLE(down) by table-name diff. All 4 groups + AuditLog dual-policy + Notifications dual-policy + SystemSettings superadmin-only. No unprotected workspace-scoped table.
- **AuditLog dual-policy (CF-C1-AUDITLOG-1.a):** `ws_isolation` (tenant) + `superadmin_system_rows` (null-workspace rows reachable only under superadmin context) — preserves erasure-scopability via `withSuperadmin` and does not leak system rows to tenants. down.sql drops BOTH policies. Correct.
- **SET LOCAL × pooling (CF-C1-POOL-1.a):** `withWorkspace`/`withSuperadmin` use tx-local `set_config(name, value, true)` (injection-safe bind param, NOT string-interpolated SET LOCAL) inside an explicit `$transaction` on `rlsPrisma` (DIRECT_URL :5432 session-mode) — NOT a session-level SET on the pooled :6543. `withWorkspace` explicitly clears `app.is_superadmin='false'`; `withSuperadmin` clears `app.workspace_id=''`. **No context-bleed path** in the committed code: tx-local config is auto-scrubbed at commit/rollback, and the two clients are distinct. (The interleaved-tenant live proof against :6543 remains Tanvi's CF-C1-POOL-1.a gate.)

## Traceability (CF-SEC-5) — VETO surface

- 4-tuple `{requestId, traceId, workspaceId, userId}` defined in `rls-prisma.ts:37-45`, seeded in `requireWorkspace` (`workspace.ts:92-100`) from JWT/`x-request-id`/`x-trace-id`, and on both cron ticks (`cron.ts:56-57,214-215`) with `userId:null` (correct system actor). `withWorkspace` overrides `workspaceId` per connection. Proof-of-attempt logs carry requestId+traceId+workspaceId. AsyncLocalStorage propagation via `correlationStore.run`. **No missing-traceability path in the diff.**

## Data residency

- `rollout-runbook.sh` STEP 0 asserts region at the Postgres level on BOTH `DATABASE_URL` (:6543) and `DIRECT_URL` (:5432), with a same-instance cross-check (`pg_postmaster_start_time`), non-zero exit + `/escalate` on non-`ap-south-1`. The runbook explicitly cites the `.env.bak.singapore` (ap-southeast-1) prior-region evidence as the reason hostname/DNS is not accepted. CF-RES-1.a honored in design; live assertion is Tanvi/Jatin's deploy gate.

## Secret hygiene — CLEAN

- Full staged-diff secret grep (sk-ant / shpss_ / GOCSPX- / SMTP_PASS / `wZIGZ6z9…` DB password / `postgres://…:…@` / JWT `eyJ…` / AKIA / PEM): **the only matches are the build-report's own self-check command STRINGS** (documentation of the grep), not actual secret values. Zero secret values committed.
- `.env.bak.singapore` (contains a REAL plaintext Supabase password + ap-southeast-1 string) exists on local disk in `legacy project/backend/` and `legacy project/frontend/` but is **NOT tracked and NOT staged** — git-ignored. `.gitignore` covers `.env`, `.env.*`, `**/.env`, `**/.env.*` with an `!.env.example` exception; the `legacy project` tree rule also catches them. Verified `.env`, `.env.production`, `.env.local` all return ignored via `git check-ignore`.
- Staged code references credentials by env-var NAME only (`process.env['DIRECT_URL']`, `$DIRECT_URL`). No connection strings, tokens, or keys in any staged code file (content scan, not just diff markers).
- **Local-hygiene NOTE (not a commit finding):** the plaintext `.env.bak.singapore` files on disk should be deleted/rotated by the Founder — a real Supabase password is sitting in two backup files. Recommend rotation of `wZIGZ6z9CWyUD0tw` since it has been exposed in a local backup. This is operational hygiene, not a gate blocker (nothing committed).

## Probe + Decision-Log (CF-SEC-1)

- RED-by-default per table (`rls-probe.ts:174-175`); GREEN only when `crossReadCount===0 && contextlessCount===0`. Errors → RED with message (`:184-193`). Table list is a hardcoded allowlist; `$queryRawUnsafe` interpolates only allowlisted table names (no user input); workspace ids passed as bound `$1::uuid` — no injection. COUNT(*) only → no PII read. Transition written to `audit_logs` under `withSuperadmin` (tamper-evident append). See M2 for the FORCE-ordering nuance handed to Tanvi.

## Tests

- Ran all 3 suites (`node --test`): **26 tests / 26 pass / 0 fail** — matches the build report. Covers banned-pattern static checks, fail-closed NULL semantics, dual-policy logic, FORCE/rollback coverage, 4-tuple structure, cron per-connection isolation + proof-of-attempt.

---

## Verdict

**PASS** → returned to orchestrator (parallel review; I do NOT advance). Zero CRITICAL, zero HIGH, zero compliance violation, zero missing-traceability, secret hygiene CLEAN. MEDIUM/LOW/INFO logged as tech debt; **M1 carries a hard gate: no STEP-5 FORCE (Stage 8 or any future child) until the inner sync writes are converted to the RLS path** — to be pinned as a blocking predecessor on Child 3 + the Stage-8 runbook FORCE step.
