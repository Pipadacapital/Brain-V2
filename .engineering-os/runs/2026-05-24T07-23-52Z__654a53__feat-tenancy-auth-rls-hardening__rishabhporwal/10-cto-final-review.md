# Stage 6 — CTO Final Review (Rohan, cto-advisor) — feat-tenancy-auth-rls-hardening (Child 1)

| Field | Value |
|---|---|
| **req_id** | `feat-tenancy-auth-rls-hardening` (Child 1 of EPIC `chore-migrate-legacy-to-brain`) |
| **Stage** | 6 (final review — VETO authority) |
| **Reviewer** | Rohan (cto-advisor) — SUBAGENT, no Agent tool |
| **Timestamp (UTC)** | 2026-05-24T07:48:00Z |
| **Branch** | `feature/feat-tenancy-auth-rls-hardening` |
| **Prior verdicts** | Stage 4 Security (Shreya) PASS `08b`; Stage 5 QA (Tanvi) PASS `09b`; one bounce (F1) fixed in `07b`+`07c` |
| **VERDICT** | **PASS → Founder gate (Stage 7).** Deploy-safe **conditional on the Stage-8 deploy-gate ledger** below (esp. the residual-bare-writes-before-FORCE gate, whose runbook grep I found defective and corrected). |

---

## 0. Verdict in one paragraph

Child 1 is correctly built, honestly reviewed, and stayed in its lane. My four independent re-verifications all replicated the reviewers' PASS with my own captured output. The code ships **no live DDL** — every dangerous step (the FORCE that makes isolation structural) is deferred to a separate, Founder-approved, runbook-gated Stage-8 deploy. The residual bare-write set the reviewers honestly pinned is **fail-CLOSED post-FORCE (outage, never leak)** and is correctly carried forward. I am **NOT** bouncing for another build pass: the residuals are a deploy-gate precondition, not a commit-time defect, and forcing a build slice now would pull Child-3 route-migration work into Child 1 (the opposite of scope discipline). **But** I found one concrete defect — the runbook's own STEP-5 verification grep `grep -v`'s out `backfill` and `discoverChannels`, i.e. it would give a false "all clear" on exactly the writes that must convert before FORCE. I am binding a corrected, complete deploy-gate to Stage 8 (see §4). With that gate enforced, this is safe to deploy via the runbook. **APPROVE.**

---

## 1. Plan-binding check — delivered 1a/1b vs the plan + binding constraints

| Binding constraint (synthesis §1 / plan) | Status in delivered code | Evidence |
|---|---|---|
| **CF-C1-POOL-1.a** (2nd client :5432 + tx-local `set_config`, session-`SET` forbidden) | **SATISFIED (code)** | `rls-prisma.ts` — `rlsPrisma` on `DIRECT_URL`; `withWorkspace`/`withSuperadmin` tx-local `set_config(...,true)`; live interleaved-tenant test is the Stage-8/5 live predicate (correctly deferred) |
| **CF-C1-FK-SCOPE-1.a** (live EXPLAIN gate → JOIN vs denorm) | **SATISFIED (design) / deferred-live** | JOIN-policy authored as default; live `EXPLAIN` is a runbook STEP-3 pre-step (legitimately a live-DB step) |
| **CF-C1-RLS-DEFAULT-1.a** (fail-closed; banned-pattern static gate) | **SATISFIED (code) — independently re-verified §2.1** | zero `IS NULL`/`COALESCE`/`USING(true)` in executable SQL; all 90 `current_setting` calls use `missing_ok=true` → NULL → 0 rows |
| **CF-C1-ROLLOUT-ORDER-1** (context→ENABLE+CREATE→probe→FORCE→smoke; DDL rollback) | **SATISFIED** | runbook applies `step-a` (STEP 3) then `step-b-force` (STEP 5) separately, probe-gated between; `down.sql` = NO FORCE+DISABLE+DROP per table |
| **CF-C1-QUIESCE-1** (quiesce crons first; harness-asserted) | **SATISFIED (authored)** | runbook STEP 1 `pg_stat_activity` assertion before any DDL — live execution at Stage 8 |
| **CF-C1-CRON-SCOPE-1.a** (per-conn isolation + proof-of-attempt) | **SATISFIED (code) — re-verified §2.3** | cron paths fully tx-threaded; per-connection try/catch + `cron.sync.attempted` log preserved |
| **CF-C1-AUDITLOG-1.a** (dual-policy + SUPERADMIN erasure) | **SATISFIED — re-verified §2.1** | `audit_logs` + `notifications` dual-policy; `system_settings` superadmin-only; SUPERADMIN erasure path documented |
| **CF-RES-1.a** (Postgres-level region assert BOTH URLs) | **SATISFIED (authored)** | runbook STEP 0 on `DATABASE_URL`+`DIRECT_URL`; live run is a Stage-8 predicate |
| **CF-SEC-1** (RED-by-default probe → GREEN) | **SATISFIED (authored)** | `rls-probe.ts` RED-by-default; live run = runbook STEP 4 (legitimately live-DB) |
| **CF-SEC-3.HARD** (lawful-basis instrument before live PII) | **SATISFIED-by-Founder-decision** | gate lifted 2026-05-24 (Founder is legal owner of in-scope brand Sugandh Lok); third-party-brand PII in prod **re-arms** the gate — carried to Child 3 |
| **CF-SEC-5** (4-tuple on every new path) | **SATISFIED w/ one gap (M3)** | ALS 4-tuple in `withWorkspace`/cron; `/api/integrations/*` routes seed only `workspace_id` (req/trace = sentinel `'unset'`) — tracked, non-blocking (§4) |

**Not-yet-satisfied items are all legitimately live-DB and deferred to Stage 8 with concrete predicates** (FK EXPLAIN, CF-SEC-1 probe live, region-assert live, byte-identical smoke, quiesce assertion). None is a planning gap. 1a is independently committable + reversible with the gate carried; 1b (`brain-claim.ts`) ships behind it and adds no DDL. **Plan-binding: OK.**

---

## 2. Independent re-verifications (≥3 required — I ran 4, with captured output)

### 2.1 Fail-open NULL-trap absent in executable RLS + FORCE/policy coverage (re-verified, NOT trusted)
- Banned-pattern scan of `step-a-enable-create.sql`: **zero** `IS NULL`/`COALESCE`/`USING(true)` in executable lines. The only matches are comments documenting the ban (`up.sql:18-20`) + one descriptive comment (`up.sql:410`).
- All **90** `current_setting('app.workspace_id', ...)` calls use the 2-arg `missing_ok=true` form → unset context returns NULL → `NULL = workspace_id` is NULL (not TRUE) → **context-less query returns 0 rows (fail-closed). Provably deny-by-default.**
- Whitespace-tolerant table-set reconciliation: **43 distinct tables**, each with ENABLE + ≥1 CREATE POLICY + FORCE. `comm` diffs ENABLE↔FORCE↔POLICY = empty → **no table FORCEd without a policy (no total-lockout), no table enabled-but-not-forced**. `down.sql` covers all 43 (full rollback symmetry).
- Dual/system policies confirmed: `audit_logs` (ws_isolation + superadmin_system_rows), `notifications` (same), `system_settings` (superadmin_only, **no** tenant policy — correct).
- **Doc-vs-code discrepancy (cosmetic, logged):** reports/commit say "44 tables"; the executable count is **43 distinct tables**. The "44" came from counting the multi-word `workspace_ad_campaign_classifications` ALTER line plus the extra dual-policy statements. The runbook's own assertion is `POLICY_COUNT >= 43` (correct). No security impact; flagged for the retro.

### 2.2 Secrets + `.env` clean in the staged diff (re-verified)
- `.env` / `.env.*` **not staged** (confirmed).
- Secret-value scan on staged **added** product lines (`sk-ant`, `shpss_`, `GOCSPX-`, `AKIA`, `postgres://user:pass@`, JWT `eyJ…eyJ`, PEM, the previously-exposed `wZIGZ6z9`): **zero hits.** Only env-var **name** references (`process.env['DIRECT_URL']`). Matches Shreya + Tanvi.

### 2.3 F1 fix — cron/sync writes use `tx`, not bare `prisma` (re-verified the load-bearing bounce fix)
- Bare-write grep on cron-path files: `cron.ts` = **0**, `meta-sync.ts` = **0**, `google-sync.ts` = **0**.
- `syncShiprocketForConnection` body: **clean** (all writes `tx.*`).
- The **8** residual bare writes in `shiprocket-sync.ts` (lines 358, 763, 776, 785, 842, 940, 972, 1021) are confined to `discoverChannels` / `backfillShiprocketCourierNames` / `backfillShiprocketPincodes` — **none reachable from `cron.ts`** (grep empty). Exactly the set Shreya/Tanvi pinned. Call-site check: `shiprocket.ts:174,201` (backfills) + `:291` (discover) are **outside** the `withWorkspace` block; `cron.ts:249` discards `_tx` (bare `prisma`); `meta.ts:192` catch-block bare write. All write to FORCEd tables → **fail-CLOSED post-FORCE (outage), never leak.**

### 2.4 Replicate Tanvi's gates myself (tests + typecheck)
- `node --test src/__tests__/*.test.mjs` → **37/37 pass, exit 0** (captured: `# pass 37 / # fail 0`).
- `npx tsc --noEmit` → **exit 0, zero errors** (Prisma client present; `PrismaTx = Prisma.TransactionClient` confirmed in all 4 files — not the broken `Parameters<>` form). UUID guard present (`rls-prisma.ts:139,149`).

**All four re-verifications replicate the reviewers' PASS with my own captured output.** Stage 5's PASS is sound.

---

## 3. Over-engineering / scope audit

| Check | Finding |
|---|---|
| Files staged outside the plan? | **No.** 22 product files all map to plan tracks 1a-A…1a-F + 1b. |
| `notifications` dual-policy beyond literal plan? | **Accepted — not gold-plating.** Plan §4b named "AuditLog/Notification/cron" as banned-trap risk but didn't enumerate `notifications` in §3a. `notifications` carries tenant data with a nullable `workspace_id`; FORCE-ing the table without a policy = lockout, leaving it unprotected = isolation gap. Adding the dual-policy is *more correct*. Vikram documented it as a within-authority extension of an explicit structural principle (07 §5). Right call; logged. |
| Observability/metrics beyond plan? | **No.** 2 metrics + 4-tuple + Decision Log — exactly the plan §9 set. |
| New deps (npm/pip/uv)? | **No.** Reuses `@prisma/client` (2nd instance). |
| New "future-use" abstractions? | **No.** `withWorkspace`/`withSuperadmin` are the Single-Primitive context-setters the pool reality requires; `rlsPrisma` is the canon's layer-3, not a new layer. |
| Child 2–6 scope pulled forward? | **No.** No money/ClickHouse/region-adapter/connector-framework/OLAP files staged. Cron *session-scoping* (G2) is in-scope; cron *connector redesign* (Child 3) is not — correctly left out. |
| 30+ line WHAT-comments? | No. Comments explain WHY (the failure modes), proportionate to the cross-brand-leak risk band. |

**Over-engineering audit: CLEAN.** Child 1 stayed in its lane and is not gold-plated.

---

## 4. Consolidated carry-forward / deploy-gate ledger (binding on Stage 8 + later children)

### 4.A — CRITICAL deploy-gate (the load-bearing Stage-6 judgment): residual bare-writes BEFORE FORCE

**Decision: this is a Stage-8 runbook hard-gate (STEP-5 precondition), NOT a build-bounce — BUT the runbook's existing gate is DEFECTIVE and I am binding a corrected one.**

- **Why not a build-bounce now:** the commit ships no DDL; pre-FORCE the `postgres` owner bypasses RLS, so the residual writes behave exactly as today (no leak, no outage at commit time). The danger materializes only at FORCE (Stage 8, Founder-approved, runbook-gated). Forcing a build slice now would pull Child-3 route-migration into Child 1 — a scope violation. The residuals are correctly a deploy precondition.
- **The defect I found:** runbook STEP-5's own prerequisite grep is
  `grep -v '//\|import\|PrismaClient\|backfill\|discoverChannels\|debug'` — it **excludes `backfill` and `discoverChannels`**, i.e. it will return CLEAN even though `backfillShiprocketCourierNames`/`backfillShiprocketPincodes`/`discoverChannels` write to FORCEd tables. As written, the gate gives a **false all-clear** on exactly the writes that must convert before FORCE. This is a deploy trap if not corrected.
- **BINDING for Jatin at Stage 8 STEP-5 (must ALL be true before `step-b-force.sql` runs):**
  1. Convert (in Child 3, before FORCE) the residual no-context writers to `withWorkspace`/`withSuperadmin`: `discoverChannels`, `backfillShiprocketCourierNames`, `backfillShiprocketPincodes`, `shiprocket.ts /connect`(POST/PATCH) + `/select-channels`, `cron.ts:249` recompute (`recomputeProductDailyAggregate` must take `tx`), `meta.ts:192` catch-block, **and the unstaged Shopify inner-sync libs** (`src/lib/shopify/sync.ts`, `analytics-sync.ts`) called from `cron.ts:112-129`.
  2. Run a **complete** bare-write grep (do NOT exclude `backfill`/`discoverChannels`) across `shiprocket-sync.ts`, `meta-sync.ts`, `google-sync.ts`, `cron.ts`, the route handlers, AND the Shopify libs:
     `grep -rnE "(^|[^.a-zA-Z])prisma\.[a-zA-Z_]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)" src/` — every hit on a Group-A/B/C/AuditLog/Notification table MUST be inside a `withWorkspace`/`withSuperadmin` closure, else **HALT, do not FORCE.**
  3. Until (1)+(2) are GREEN for a given table's write path, that table must **not** be FORCEd (FORCE is per-table; partial FORCE is permitted by `step-b` if a table's writers aren't yet converted — but the safest path is convert-all-then-FORCE-all).

### 4.B — M3: trace-ID seeding on `/api/integrations/*` routes (MEDIUM, before FORCE-era production traffic)
Mount global correlation/request-id middleware (or route `/api/integrations/*` through `requireWorkspace`) so `request_id`/`trace_id` stop degrading to sentinel `'unset'` on those paths. `workspace_id` is already bound (tenancy-safe); this is observability completeness for CF-SEC-5 end-to-end. Pin to Child-3 route-migration.

### 4.C — Stage-8 live-DB predicates (Jatin must execute + capture output)
- **CF-C1-FK-SCOPE-1.a:** live `EXPLAIN (ANALYZE, BUFFERS)` on `shopify_orders`/`shopify_line_items` (+ any Group-B table) — index scan, no seqscan/nested-loop; escalate to denorm (additive col + chunked 5000 backfill + `IS NULL`=0 verify) on fail.
- **CF-SEC-1 probe:** live run, RED-by-default → GREEN (cross_read=0 AND contextless=0 per table); Decision-Log transition written. **Run the probe as a NON-owner role** (per M2) so the pre-FORCE cross-read check is meaningful.
- **CF-RES-1.a:** Postgres-level region assert `ap-south-1` on BOTH `DATABASE_URL` and `DIRECT_URL` (the `.env.bak.singapore` evidence proves a real region move happened — live-assert, never trust). Per F5: verify `app.settings.project_region` returns non-empty before trusting STEP 0.
- **CF-C1-QUIESCE-1:** STEP-1 harness asserts zero active cross-workspace `findMany` before any DDL.
- **CF-C1-ZERO-BEHAVIOR-1:** byte-identical per-workspace API corpus pre/post FORCE; one clean cron tick under the refactor.

### 4.D — Carried compliance gate (re-arms for Child 3)
**CF-SEC-3.HARD** is satisfied only for the in-scope own-brand (Sugandh Lok, Founder is legal owner). **Third-party-brand PII in production re-arms the gate** → formal DPA/§7 governance is required before Child 3 processes other brands' live PII (`chore-security-governance-hardening-phase`). Do not let Child 3 read third-party-brand PII without the instrument.

---

## 5. Hard-rule deviation check (step 9)
Scanned all artifacts for: dependency violation, Single-Primitive violation, compliance gap, paradigm escalation beyond plan, gate-skip without codified exception. **None present.** The build-gate (CF-SEC-3.HARD) was lifted by an explicit, logged Founder decision (own-brand legal ownership), with the third-party re-arm recorded. Paradigm held (sql-ddl + connection-handling; zero LLM/token cost). No auto-approve blocker.

---

## 6. Decision

**PASS → Founder gate (Stage 7).** Recommendation to Founder: **APPROVE.** `/approve feat-tenancy-auth-rls-hardening` advances to **Stage 8 = Jatin runs `scripts/rollout-runbook.sh` against the LIVE Supabase DB** — the actual RLS rollout (region-assert → quiesce → context-code → ENABLE+CREATE → probe-GREEN → FORCE → smoke). The deploy is safe **conditional on the §4.A corrected deploy-gate being enforced at STEP-5** (residual no-context writers converted + complete bare-write grep GREEN before any `FORCE`). The Stage-6 VETO is satisfied; there is no "pass with reservations" — this is a clean PASS with a binding deploy-gate ledger handed to Stage 8.

---

*Authored by Rohan (cto-advisor), Stage-6 final review. Journal + decision-log + live.log + state updated. No code committed (Founder Stage-7 gate owns the commit).*
