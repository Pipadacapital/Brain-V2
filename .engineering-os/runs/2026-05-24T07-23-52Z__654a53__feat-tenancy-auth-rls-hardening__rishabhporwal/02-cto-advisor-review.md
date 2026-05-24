# Stage 1 — CTO Advisor Review (Rohan)

**req_id:** `feat-tenancy-auth-rls-hardening` — Child 1 of EPIC `chore-migrate-legacy-to-brain`
**Stage:** 1 (intake / brainstorm)
**Actor:** Rohan (cto-advisor) — SUBAGENT, no Agent tool
**Timestamp (UTC):** 2026-05-24T07:25Z
**Decision:** **ADVANCE** — with a **SCOPE SPLIT into 1a / 1b** (see §3) and **2 personas requested** (see §6).
**Depends on:** `spike-legacy-migration-architecture` (status `done`, architecture binding) — pre-flight dependency check **PASS** (§7).

---

## 0. Semantic recall (v0.8.0)

`memory_search -k 6` on the requirement gist returned only this child's own intake + the spike/scaffold pipeline records (top similarity 0.699 = its own decision-log intake row). **No near-duplicate, no prior shipped RLS-rollout pattern to template.** This is the first code-moving slice; I reuse the binding A1–A6 architecture rather than re-derive, and ground every claim below in the actual legacy code.

---

## 1. Ground-truth read (the code I'll be hardening — not the prose)

Verified against `legacy project/backend/`:

| Fact | Evidence | Why it matters to Child 1 |
|---|---|---|
| 45 Prisma models; **66 `workspaceId` refs**; **zero RLS** | `schema.prisma` (`grep -c '^model '` = 45; `grep -c workspaceId` = 66) | Confirms the premise. RLS is a pure ADDITION on a no-RLS DB. |
| **Only ~21 models carry `workspaceId` DIRECTLY**; ~24 are scoped **transitively** via `connectionId`/`orderId` FK chains | Direct: User, Workspace, WorkspaceMember, Invitation, WorkspaceCost, AiInsight, the 5 connector tables, WorkspaceDailyMetrics, etc. Transitive: `ShopifyOrder.connectionId`→`ShopifyConnection.workspaceId`; `ShopifyLineItem.connectionId`+`orderId`; ShiprocketOrder/Shipment, the `google_ads_*`/`meta_ads_*` tables, Woo tables, ProductDailyAggregate, ShopifyAnalyticsDaily/Product/Variant/Customer | **This is the load-bearing design problem.** RLS policies on the ~24 FK-scoped tables cannot read `app.workspace_id` off a local column — each policy must JOIN to the connection (perf + correctness risk) OR a `workspace_id` must be denormalized onto those tables. Aryan must decide; it changes the DDL surface and the per-query cost. |
| **Cron fan-out does cross-workspace `findMany`** | `routes/cron.ts:65` + `:148` `prisma.shopifyConnection.findMany({…})` then `for (const c of connections)`; `shiprocket-sync.ts:344 syncAllShiprocket` → `prisma.shiprocketConnection.findMany({ where:{status:'CONNECTED'} })` over ALL workspaces; same shape `meta-sync.ts:282 syncAllMetaAds`, `google-sync.ts:652 syncAllGoogleAds` | These are the G2 paths. They run with NO session scope — a single process iterating every tenant. Converting them to per-workspace-session-scoped invocations is half of Child 1's mandate. |
| **Singleton `PrismaClient` over a pgbouncer transaction-mode pool** | `lib/prisma.ts` (one process-lifetime client, globalThis-guarded); `.env` carries both a `pgbouncer`/`6543` pooled `DATABASE_URL` **and** a `5432` `DIRECT_URL` | **THE FOOTGUN (see §4).** `SET LOCAL app.workspace_id` is transaction-scoped; pgbouncer transaction-mode hands a different backend connection per transaction and may multiplex. A `SET LOCAL` outside a transaction, or a session-level `SET`, will **leak or lose** the workspace context — the exact failure mode that produces a cross-brand leak. Must be designed around, not assumed. |
| **Role model already exists, 5-level** | `enum WorkspaceRole { OWNER, ADMIN, MANAGER, ANALYST, VIEWER }` (schema:936) + `enum SystemRole { SUPERADMIN, USER }`; `WorkspaceMember.role @default(VIEWER)` | The success-metric's "5 level-ordered roles" already match. Auth/role work is **mapping the existing Supabase JWT + WorkspaceMember.role into a Brain claim contract**, NOT inventing a role model. Much smaller than it reads. |
| Auth = Supabase JWT verified via JWKS (`jose`), no DB round-trip per call | `middleware/auth.ts` (`createRemoteJWKSet`/`jwtVerify`); `middleware/workspace.ts` resolves workspace + membership from `:slug` per request | The 4-layer non-negotiable's layer 1 (JWT claim) + layer 2 (gateway assertion) already half-exist as app middleware. Layer 3 (Postgres RLS via `SET LOCAL`) is the genuinely NEW, genuinely risky piece. ClickHouse layer 4 is out of scope (no ClickHouse until Child 4). |

**Net:** the requirement's framing is accurate, but the real engineering risk is concentrated in (a) the FK-transitive RLS design and (b) the `SET LOCAL` × transaction-pooling interaction — both on a **live DB the legacy app is actively querying with no-RLS assumptions.**

---

## 2. Domain / business-canon check

- **India-D2C / multi-tenancy non-negotiable:** this slice EXISTS to close the cross-brand isolation gap — it is the canon's 4-layer `workspace_id` isolation being made structural. Fully canon-aligned; no challenge on direction.
- **DPDP §8(6):** a cross-brand leak during the no-RLS dual-run window is a reportable breach (R-LEAK-01). This is why C5 makes RLS-live a HARD gate before ANY later slice shadows. Child 1 must not itself open that window — hence the additive/reversible/toggle-guarded rollout.
- **Residency (DPDP §16):** confirmed `ap-south-1` at spike approval → CF-RES-1 runs here as a **positive-assertion gate-zero**, not an escalate fork (re-fires `/escalate` only if region ever differs at execution).
- **No money / connector / metric / AI scope** — correctly carved out to Children 2–6. I confirm the non-goals.

No canon violation. No `/escalate` trigger at intake: residency is confirmed; PII lawful-basis (CF-SEC-3) is a build-time check Aryan/Shreya own, with `/escalate` armed if ambiguous *then*.

---

## 3. Scope discipline — CHALLENGE: this is TWO safely-shippable units, not one

The requirement bundles three workstreams: (i) Postgres RLS on workspace-scoped tables, (ii) session-scoped tenant context wired through the app + crons, (iii) Brain's auth/role-claim model. Applying the challenge framework:

- **What's being assumed:** that RLS + session-context + auth-claim model is one atomic slice because they're all "tenancy."
- **Why I'm skeptical:** they have *different blast radii and different reversibility*. RLS + session-context is a **live-DB DDL + connection-handling change** with a real cross-brand-leak failure mode under transaction pooling — it is the genuinely dangerous unit. The auth/role-claim mapping is a **read-side JWT-claim enrichment** with near-zero DB-write risk (the role enum already exists). Bundling them means the risky DDL rollout can't ship until the (independent, safe) claim work is also done, and a rollback of one drags the other.
- **The honest decomposition (both still inside this one requirement/run, sequenced):**
  - **1a — Data-layer isolation (the dangerous, gate-establishing unit):** RLS policies on all workspace-scoped tables (resolving the FK-transitive-scoping question), `SET LOCAL app.workspace_id` session context that is **correct under pgbouncer transaction-mode**, cron fan-out converted to per-workspace-session-scoped invocations, **CF-SEC-1 fail-closed RLS-probe GREEN predicate**. **This is what turns the C5 gate (G1+G2) GREEN.** Ships FIRST. Additive + toggle-guarded + reversible (A4: disable policies, app-layer scoping still present).
  - **1b — Brain auth/role-claim contract:** map existing Supabase JWT + `WorkspaceMember.role`/`SystemRole` into Brain's level-ordered claim contract consumed by the facade/gateway assertion (layers 1–2), no re-login storm. Lower risk; can ship right behind 1a.
- **Why NOT bounce to Founder as separate requirements:** the spike's A2 row treats Child 1 as the single gate-establishing slice, and 1b is small + naturally co-planned with 1a (same auth/session plumbing). Splitting into two *requirements* would fragment the gate ownership. So: **ONE requirement, TWO sequenced shippable sub-slices 1a→1b, with 1a as the hard-gate deliverable.** Aryan plans both; 1a's exit criterion (RLS live + verified + crons session-scoped + zero API behavior change) is the C5 gate going GREEN and is independently committable/reversible before 1b lands.
- **Path forward:** Architect (Stage 2) produces one plan with an explicit 1a→1b boundary; 1a carries the gate.

This is a **scope refinement within ADVANCE**, not a CHALLENGE-BACK or KILL — the requirement is sound and planable; I'm tightening the safe shippable unit as Stage-1 is supposed to.

---

## 4. The `SET LOCAL` × pgbouncer transaction-pooling footgun (explicit, binding to Aryan)

Stated plainly so it cannot be glossed: the legacy `DATABASE_URL` routes through **pgbouncer in transaction mode** (`6543`), with a singleton long-lived `PrismaClient`. `SET LOCAL app.workspace_id = '<W>'` only holds **for the duration of the current transaction** and only if the same backend connection serves the RLS-protected query. Failure modes Aryan MUST design against, and Tanvi MUST verify:
1. A query issued **outside an explicit transaction** (Prisma's default per-call autocommit) gets `SET LOCAL` on one pooled connection and the SELECT possibly on another → **context lost → RLS denies (best case, app breaks) or, if a fallback default exists, leaks (worst case).**
2. Session-level `SET` (not `LOCAL`) under transaction pooling **bleeds the workspace context to the next tenant** sharing that backend connection → **direct cross-brand leak.** This is forbidden.
3. **Acceptable designs to evaluate (Aryan's call, not mine to fix):** wrap each scoped unit-of-work in an explicit `prisma.$transaction` and `SET LOCAL` inside it; OR route RLS-scoped traffic through the `5432` `DIRECT_URL`/session-mode pool; OR use `set_config('app.workspace_id', $1, true)` (tx-local) bound into the same transaction as the query. Whatever is chosen, the **default with NO context set must be fail-closed (deny all rows), never fail-open.**
4. **Verification owed (Tanvi):** a test proving that under the production pooling config, two interleaved tenant transactions cannot observe each other's `app.workspace_id`, and that a context-less query returns **zero rows**, not all rows.

This single interaction is the highest-likelihood path to the exact breach this slice exists to prevent. It is the reason 1a is lane high-stakes with a dedicated persona.

---

## 5. Lane decision

| Field | Value |
|---|---|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires on ≥1 (in fact 4+): **auth** (Brain claim contract), **multi-tenancy** (`workspace_id` RLS — the core), **pii** (workspace-scoped PII tables: `Invitation.email`, `ShopifyCustomer`, `User`), **india-compliance** (DPDP §8(6) breach window + §16 residency assertion). Also touches **schema-proto** (RLS DDL / possible `workspace_id` denormalization on FK-scoped tables) and **connectors** (cron sync paths are connector-fan-out). Foundational-scaffolding carve-out is **explicitly inapplicable** (live data, money/PII/connector/india-compliance surfaces, runtime change, migration on existing data). Conservative tie-break forbids any downgrade. |
| **trigger_surfaces_touched** | `auth`, `multi-tenancy`, `pii`, `india-compliance`, `schema-proto`, `connectors` |
| **Stages that run** | Full high-stakes pipeline: 1 (this) → 2 architect → 3 build → 4 security (VETO) → 5 QA → 6 final review (VETO) → 7 founder gate → 8 deploy. No stage dropped. |

---

## 6. Persona-count decision

**Count: 2** (the high-stakes cap; two genuinely distinct risk dimensions intersect).

| # | Persona | One-line brief (what to adversarially break) |
|---|---|---|
| 1 | **live-rls-rollout-safety-realist** | Prove the RLS rollout breaks the LIVE legacy app or leaks. Attack: the `SET LOCAL` × pgbouncer-transaction-mode interaction (§4) under the real singleton-client autocommit pattern; the FK-transitive-scoping (~24 tables) — does a JOIN-based policy stay correct + affordable, or is `workspace_id` denormalization forced, and is that backfill itself safe on live data?; is the rollout truly additive/reversible/toggle-guarded or is there an ordering where a half-applied policy denies the legacy app mid-deploy (downtime)?; does the fail-closed default actually deny (not leak) when context is unset?; name the one step most likely to cause a live outage OR a silent leak. |
| 2 | **india-data-isolation-compliance-officer** (reuse of the spike's lens, re-scoped to Child 1 execution) | Pressure-test the compliance edges of *doing the rollout*: the dual-run window where RLS is partially live (DPDP §8(6) leak exposure during deploy); **CF-SEC-3 migration-time PII lawful-basis** — is processing the workspace-scoped PII (`Invitation.email`, `ShopifyCustomer`, `User`) under DPDP §4/§7 legitimate-use established BEFORE Child 1 touches it, or is it `/escalate`-ambiguous at build time?; CF-RES-1 positive-assertion mechanics (how is `ap-south-1` asserted at execution, not just trusted from the spike?); does AuditLog null-`workspaceId` (C9) become un-erasable/un-scopable under RLS? Flag any genuine DPDP ambiguity that should `/escalate`. |

**Why not 0 or 1:** two independent dominant dimensions — *engineering* (will the live-DB RLS rollout under transaction pooling break or leak?) and *compliance* (is the rollout's PII processing + breach-window + residency lawful and provable?). Neither subsumes the other. **Why not 3+:** no third orthogonal dimension — auth/role-claim (1b) is low-risk (role enum already exists, no DDL on data) and is Aryan's plan-level concern, not a persona; AI/cost has no surface here. Declined: `ai-cost-realist` (no compute path in Child 1) and a generic architecture persona (slice-boundary + DDL correctness is Aryan's binding Stage-2 job — the realist already supplies the adversarial method read).

**I do NOT spawn.** Both personas are NAMED in the HANDOFF `needs_personas`; the orchestrator spawns them in parallel (`03-…`, `04-…`) then re-invokes me to synthesize.

---

## 7. Pre-flight dependency check (mandatory for child requirements)

- Parent meta-tracker `chore-migrate-legacy-to-brain` → `proposed_children` → `child-1-tenancy-auth-rls-hardening` → `blocks: ["child-0-audit-migration-architecture-spike"]`.
- `child-0` = `spike-legacy-migration-architecture`, `state.status = "done"`, founder-approved, architecture binding.
- **Result: NO VIOLATION.** The single blocker is shipped. Proceed.

---

## 8. Binding constraints — this child's acceptance contract (carry-forward ledger + Child-1-specific)

Restated as non-negotiable inputs Aryan plans against, Shreya/Tanvi gate on:

**Inherited (from Child 0 carry-forward ledger):**
- **CF-RES-1 (gate-zero):** assert live Postgres region == `ap-south-1` BEFORE any RLS DDL touches the DB. Confirmed at spike approval → runs as positive-assertion confirmation; re-fires `/escalate` only if region differs at execution. Non-slippable ordering: gate-zero, before DDL.
- **CF-SEC-1:** the facade "RLS-GREEN" gate (G1+G2) is a **fail-closed, auditable predicate derived from a live RLS probe** (RED-by-default; transitions written to the Decision Log) — NOT a manually-flipped boolean. **Established in Child 1; Stage-4 VETO surface here.**
- **CF-SEC-3:** establish DPDP §4/§7 lawful basis for migration-time PII processing BEFORE any workspace-scoped PII is touched; `/escalate` if ambiguous at build-time. Stage-4 VETO + `/escalate` candidate.
- **CF-SEC-5:** correlation-ID **4-tuple** (`request_id` + `trace_id` + `workspace_id` + `user_id`) propagated end-to-end through every runtime path introduced here (facade + session-scoped crons). Missing traceability = Stage-4 VETO.
- **CF-SEC-SECRETS-1:** all legacy credentials (DB, Supabase, connector OAuth, SMTP, Anthropic) provisioned via **AWS Secrets Manager**, never in git; verify rotation before use (Founder advised to rotate exposed creds).

**Child-1-specific (new — I add these from the ground-truth read):**
- **CF-C1-POOL-1:** the `SET LOCAL app.workspace_id` mechanism MUST be correct under the production **pgbouncer transaction-mode** pool (§4). Forbidden: session-level `SET` under transaction pooling. Required: tx-local scoping (`SET LOCAL`/`set_config(...,true)` inside the same transaction as the query) OR routing RLS-scoped traffic through a session-mode/`DIRECT_URL` pool. **Tanvi must prove interleaved tenants cannot observe each other's context, and a context-less query returns ZERO rows.** Stage-4/5 VETO surface.
- **CF-C1-RLS-DEFAULT-1:** the RLS default with NO `app.workspace_id` set MUST be **fail-closed (deny all rows)**, never fail-open. No table-wide permissive fallback policy.
- **CF-C1-FK-SCOPE-1:** the ~24 FK-transitively-scoped tables (order/line-item/product/ads/refund tables scoped via `connectionId`/`orderId`) MUST get a correct + affordable RLS policy. Aryan decides JOIN-based-policy vs `workspace_id` denormalization+backfill; if denormalization, the backfill on live data is itself an additive, reversible, verified step. **Zero FK-scoped table left un-protected** is the acceptance bar.
- **CF-C1-ZERO-BEHAVIOR-1 (A2 exit criterion):** live API responses **byte-identical** pre/post-RLS for a fixed per-workspace request corpus; **zero downtime**, zero broken workflow (login/signup/org-switch/user-switch/dashboards). The rollout is additive + toggle-guarded; rollback = disable policies (app-layer scoping still present) per A4.
- **CF-C1-CRON-SCOPE-1 (G2):** all cross-workspace `findMany` fan-out (`cron.ts:65,148`; `syncAllShiprocket/MetaAds/GoogleAds`) converted to per-workspace-session-scoped invocations; **no cross-workspace `findMany` remains** in any cron path. Shiprocket flagged (no event replay) per A6/C1.
- **CF-C1-AUDITLOG-1 (C9):** dispose AuditLog null-`workspaceId` rows so they remain erasure-scopable + don't break under RLS (attribute to a system workspace OR an explicit system-event policy). DPDP accountability.

These bind A2 (sequence/gate), A3 (facade RLS-GREEN enforcement), A4 (parity/rollback), A6 (risk register R-RLS-01 / R-LEAK-01 / R-RES-01).

---

## 9. First-pass paradigm

**SQL / DDL + connection-handling — no ML, no LLM.** RLS is Postgres policy DDL + session-context plumbing + cron refactor; the auth/claim work is JWT-claim mapping. The cheapest correct tool is plain SQL/TS. Architect may refine, but there is **no compute path that would justify Haiku/Sonnet/ML** here. (Cost-routing-paradigm audit: clean — no over-reach.)

---

## 10. Decision

**ADVANCE** → Stage 2 (Architect, Aryan), AFTER the 2 named personas are spawned + synthesized.
- Not CHALLENGE-BACK: requirement is sound, planable, dependency satisfied.
- Not KILL: it is the universal hard gate every later slice needs.
- Scope refined to 1a (RLS + session + cron + fail-closed gate = the C5-gate-establishing unit) → 1b (auth/role-claim contract), both in this one requirement/run.

---

## 11. Open questions (for Aryan — inputs, not blockers)

1. FK-transitive scoping: JOIN-based RLS policy vs `workspace_id` denormalization + live backfill on the ~24 tables — decide + justify on correctness AND per-query cost.
2. `SET LOCAL` mechanism under transaction pooling: which of the §4 options, and is RLS-scoped traffic routed through the pooled `6543` or the direct `5432`?
3. CF-SEC-1 RLS-probe predicate: what exact probe (e.g. assume a synthetic workspace session, attempt a cross-workspace SELECT, assert 0 rows) drives the GREEN state, and where is the transition written to the Decision Log?
4. 1a→1b boundary: confirm 1a is independently committable/reversible with the gate GREEN before 1b lands.
