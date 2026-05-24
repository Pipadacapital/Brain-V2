# Security Reviewer (Shreya) — Journal

## 2026-05-24T01:29:51Z — Shreya (security-reviewer) — spike-legacy-migration-architecture
**Stage:** 4 (PARALLEL REVIEW MODE; design-level VETO — no-code spike, Rohan ruled full strength)
**Action:** Security review PASS
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 3 — tech debt logged as binding child-stage VETO surfaces (facade-gate-enforcement design-deferred; shadow-read-path must be separate RLS-scoped replica; migration-time PII lawful-basis not yet established)
**Findings (LOW):** 2 — oauth_states hygiene (Child-3); correlation-ID 4-tuple as per-child VETO
**Compliance gates (DPDP/PDPL/residency/PII):** ALL PASS — no violation; no DLT/NCPR/outbound surface exercised (correctly deferred). Residency tripwire (R-RES-01) is a sound armed control.
**Traceability:** PASS (no code path exists to be untraceable; 4-tuple requirement carried forward as binding on every child)
**Bounced to:** NONE
**Rationale:** Plan closes the legacy security/compliance gaps (re-verified real vs ground truth: no-RLS, cron cross-workspace findMany, plaintext creds, AuditLog null-workspaceId, 0 residency markers). RLS+session gate is a facade-enforced HARD entry column for EVERY child's dual-run — no breach window; sequencing never opens one. 9/9 persona concerns genuinely bound (0 hand-waved). Concur with Rohan: residency = tripwire-not-escalate-now (unconfirmed fact, not a canon ambiguity).

## 2026-05-24T08:39:08Z — Shreya (security-reviewer) — feat-tenancy-auth-rls-hardening
**Stage:** 4 (PARALLEL REVIEW MODE — concurrent with Tanvi; returned verdict, did NOT advance)
**Action:** Security review PASS
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 2 — tech debt logged: M1 inner-sync-writes bypass RLS context (singleton :6543, not tx handle) — SAFE-TO-DEFER at Child-1 commit (no DDL shipped; pre-FORCE owner bypass = no leak; post-FORCE = fail-closed OUTAGE caught by runbook STEP6), HARD must-fix-before-FORCE → blocking predecessor on Child-3 + Stage-8 FORCE; M2 probe contextless-check depends on FORCE ordering (Tanvi live-DB gate).
**Findings (LOW):** 2 — withWorkspace no UUID-shape guard (defense-in-depth); runInWorkspace doc drift.
**Compliance gates (DPDP/PDPL/DLT/NCPR/window/recording):** ALL PASS — DPDP build-gate lift NOT re-litigated (Founder ownership call); no outbound/telecom/recording surface; residency region-assert (both URLs, Postgres-level, same-instance cross-check) sound.
**Traceability:** PASS — CF-SEC-5 4-tuple on every new runtime path (requireWorkspace, both cron ticks, sync enumerations, probe); proof-of-attempt logs carry requestId+traceId+workspaceId.
**Secret hygiene:** CLEAN — zero secret values committed; only grep hits are the build-report's own self-check command strings; .env.bak.singapore (real plaintext Supabase pwd + ap-southeast-1) is untracked+ignored. NOTE to Founder: rotate that exposed password + delete the backups (local hygiene, not a commit finding).
**Bounced to:** NONE
**Rationale:** RLS DDL is fail-closed — grepped all SQL, zero banned NULL-trap (OR IS NULL/COALESCE/USING true) in executable clauses; 43 ENABLE==43 FORCE==43 DISABLE by table-diff; AuditLog/Notifications dual-policy correct + erasure-scopable; withWorkspace uses injection-safe tx-local set_config(...,true) on rlsPrisma :5432 (no :6543 session-SET bleed path in committed code). Ran the 26 tests myself — 26/26 pass. The one real hole (inner sync writes) is correctly out of Child-1's committed scope and fails CLOSED (outage, not leak) — does not gate this PASS, but I pinned a hard FORCE-time gate so it cannot silently become an outage at Stage 8.

## 2026-05-24T09:08:58Z — Shreya (security-reviewer) — feat-tenancy-auth-rls-hardening
**Stage:** 4 (RE-REVIEW round 2, parallel w/ Tanvi)
**Action:** Security re-review PASS (delta of bounce-fix 07b + typefix 07c)
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 3 — M1 RESOLVED at code level (cron + 5 routes) but residual bare writes (shiprocket backfill/discoverChannels + cron recompute cron.ts:249 + unstaged Shopify inner sync libs) carry the SAME hard-gate-before-FORCE — they run with NO workspace context so fail-CLOSED (outage) post-FORCE, not fail-open; M2 disposition holds (probe contextless ordering, Tanvi gate); **M3 NEW** (tracked, non-blocking, NOT a regression): /api/integrations/* routes use requireAuth only and skip the correlation-seeding middleware (workspace.ts) — requestId/traceId degrade to sentinel 'unset' while workspaceId stays bound; pre-existing in the ported routes (entered my surface in 07c), the tx-wrap delta did not introduce it; pin to route-migration phase before any FORCE-era prod traffic.
**Findings (LOW):** 0 new — L1 (UUID guard) + L2 (doc) RESOLVED by Vikram.
**Compliance gates (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** ALL PASS — no new outbound/telecom/recording/PII surface in the delta.
**Traceability:** PASS on the delta (cron 4-tuple intact; tx wraps bind workspaceId). M3 logged for the integrations routes (workspaceId present; req/trace degrade to sentinel — not a dropped-ID regression).
**Bounced to:** NONE (PASS — returned to orchestrator; parallel mode, did NOT advance)
**Rationale:** F1/M1 confirmed via grep proof — cron.ts/meta-sync.ts/google-sync.ts ZERO bare-prisma writes; shiprocket cron path (syncShiprocketForConnection→upsertOrder/upsertShipment/syncTracking/mapShiprocketToShopify) fully tx-threaded; 37/37 tests pass incl. negative WITH-CHECK simulations. The 5 route-handler wraps are SAFE: each is withWorkspace(<the exact workspaceId requireWorkspaceAdmin authorized>, (tx)=>sync(...,tx)) — no withSuperadmin-where-workspace-meant, no wrong-id source, no unwrapped sibling write on the happy path; UUID guard (L1) active. PrismaTx=Prisma.TransactionClient is the canonical fix (no longer 'never'). No DDL auto-applies (FORCE is runbook/Stage-8 gated) so pre-FORCE owner-bypass means residual bare writes behave as today — no new leak. Fail-closed RLS intact (no NULL-trap in executable policy). Secret hygiene CLEAN; .env not staged. Net: zero CRITICAL/HIGH/compliance/missing-traceability → PASS.
