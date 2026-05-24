# Security RE-REVIEW (Round 2) — feat-tenancy-auth-rls-hardening (Child 1)

**Reviewer:** Shreya (security-reviewer)
**Stage:** 4 — PARALLEL REVIEW MODE (concurrent with Tanvi/QA)
**Timestamp (UTC):** 2026-05-24T09:08:00Z (see live.log for exact)
**Branch:** feature/feat-tenancy-auth-rls-hardening (review `git diff --cached`)
**Prior round:** PASS with MEDIUM M1 (inner-sync-writes) pinned — see 08-security-review.md.
**This round verdict:** **PASS** (delta re-review). Zero CRITICAL, zero HIGH, zero compliance violation, zero missing-traceability on the delta, secret hygiene CLEAN.

This is a DELTA re-review — I re-confirmed the load-bearing items and audited the new surface (07b tx-threading + 07c type fix + 5 route-handler wraps). I did not re-litigate the full prior review.

---

## What I re-reviewed

1. **07b (F1/M1 fix):** inner sync functions thread the workspace-scoped tx (`PrismaTx`); Group A/B writes go through the RLS-scoped tx, not the bare `:6543` singleton. `rls-write-scope.test.mjs` added.
2. **07c (type fix):** `PrismaTx` changed from a broken `Parameters<>` derivation (resolved to `never`) to `Prisma.TransactionClient` (canonical Prisma 5 export).
3. **07c (5 route-handler wraps):** `ads.ts` (×2), `google.ts`, `meta.ts`, `shiprocket.ts` were calling RLS-scoped sync functions WITHOUT `withWorkspace()`; now wrapped.

---

## Grep proof — F1/M1 resolution (zero bare-prisma writes in workspace-scoped paths)

Command (staged sync/cron files):
```
grep -nE "(^|[^.a-zA-Z])prisma\.[a-zA-Z_]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)" <file>
```

| File | Bare-prisma write hits | Verdict |
|---|---|---|
| `src/routes/cron.ts` | 0 | CLEAN |
| `src/lib/integrations/meta-sync.ts` | 0 | CLEAN |
| `src/lib/integrations/google-sync.ts` | 0 | CLEAN |
| `src/lib/integrations/shiprocket-sync.ts` | 8 — lines 358, 763, 776, 785, 842, 940, 972, 1021 | see disposition below |

**The 8 shiprocket-sync hits are NOT in any workspace-scoped (`withWorkspace`) path.** They live in:
- `discoverChannels` (`:358`) — called from `shiprocket.ts /refresh-channels` with **no** `withWorkspace`.
- `backfillShiprocketCourierNames` (`:763,776,785,842`) — called from `shiprocket.ts /sync` at `:174`, **outside** the `withWorkspace` block (which closes at `:154`).
- `backfillShiprocketPincodes` (`:940,972,1021`) — called from `shiprocket.ts /sync` at `:201`, **outside** the `withWorkspace` block.

None of these is reached from inside `syncShiprocketForConnection` or any `withWorkspace` closure (grep of shiprocket-sync.ts internal calls: zero). They take no `tx` param. They write to `shiprocket_shipments`/`shiprocket_connections` (Group A/B RLS tables) with **NO workspace context at all** ⇒ post-FORCE they fail **CLOSED** (enrichment/channel-refresh outage), NOT fail-open (no cross-tenant leak). This is the SAME risk class and the SAME `hard-gate-before-FORCE` as M1 — carried as a blocking predecessor on Child-3 + Stage-8 runbook STEP-5. It does NOT gate this PASS because (a) no DDL is shipped by this commit, so pre-FORCE the `postgres` owner bypasses RLS and these behave exactly as today, and (b) the failure mode is an outage caught by the runbook STEP-6 smoke, never a leak.

The cron happy-path writes that M1 originally flagged (`upsertOrder`, `upsertShipment`, `syncTrackingForConnection`, `mapShiprocketToShopify`, connection updates, `cron.ts shopifyConnection.update`, all meta/google daily-metric writes) are now **fully tx-threaded** — confirmed by the 0-hit grep on cron.ts/meta-sync/google-sync and by reading the shiprocket cron path (all inner writes use `tx.*`).

**Residual same-class items also carrying the M1 FORCE-gate** (run with no workspace context; fail-closed post-FORCE; not in this PASS's blocker set):
- `cron.ts:249` recompute — `withWorkspace(..., async (_tx) => recomputeProductDailyAggregate(prisma, ...))` — tx discarded, bare prisma, explicitly documented "tracked for Child 3."
- Shopify inner sync libs (`src/lib/shopify/sync.ts`, `analytics-sync.ts` — **unstaged**, not in this diff) called from cron.ts `:112-129` without tx.

---

## The 5 route-handler wraps — assessment (SAFE)

| Route | Wrap | workspaceId source | Authorized by | Verdict |
|---|---|---|---|---|
| `ads.ts:87` `/backfill` (Meta) | `withWorkspace(workspaceId, (tx)=>syncMetaAdsForConnection(metaConn.id,{backfill:true},tx))` | query param `workspaceId` | `requireWorkspaceAdmin(userId, workspaceId)` @ `:44` | SAFE |
| `ads.ts:105` `/backfill` (Google) | `withWorkspace(workspaceId, (tx)=>syncGoogleAdsForConnection(googleConn.id,{backfill:true},tx))` | same `workspaceId` | same `:44` | SAFE |
| `google.ts:237` `/sync` | `withWorkspace(body.workspaceId, (tx)=>syncGoogleAdsForConnection(connection.id,undefined,tx))` | `body.workspaceId` | `requireWorkspaceAdmin` @ `:211` | SAFE |
| `meta.ts:188` `/sync` | `void withWorkspace(body.workspaceId, (tx)=>syncMetaAdsForConnection(connection.id,undefined,tx))` | `body.workspaceId` | `requireWorkspaceAdmin` @ `:171` | SAFE (fire-and-forget `void` is intentional + documented; 202+reload UX) |
| `shiprocket.ts:152` `/sync` | `withWorkspace(body.workspaceId, (tx)=>syncShiprocketForConnection(connection.id,undefined,tx))` | `body.workspaceId` | `requireWorkspaceAdmin` @ `:123` | SAFE |

Checks performed on each wrap:
- **Right workspaceId source:** every wrap uses the EXACT id that `requireWorkspaceAdmin(userId, workspaceId)` already authorized the caller against. The connection looked up (`metaConn.id`/`googleConn.id`/`connection.id`) was fetched by that same `workspace_id`. A caller therefore cannot scope `withWorkspace` to a workspace they are not an admin of.
- **Right scope (no superadmin-where-workspace-meant):** `grep withSuperadmin src/routes/integrations/` → NONE. No privilege over-grant.
- **No unwrapped sibling RLS write on the happy path inside the wrap:** the inner sync functions write exclusively via `tx`.
- **UUID guard (L1):** `withWorkspace` rejects non-UUID `workspaceId` before binding (`rls-prisma.ts:139,149`).
- **meta.ts `/sync` catch-block (`:192`)** does a bare `prisma.meta_ads_connections.update` (error-status persistence) OUTSIDE the wrap — same fail-CLOSED-post-FORCE class as the residual writes above; not a leak; folded into the M1 FORCE-gate set.

**Conclusion:** the 5 wraps are correct and introduce no new tenancy issue. Post-FORCE, the happy path now succeeds (was previously a silent 0-rows-read + rejected-write bug the `never` type hid). Net improvement.

---

## Re-verified load-bearing items

- **Fail-closed RLS intact:** grep of `up.sql` / `step-a-enable-create.sql` for `IS NULL` / `COALESCE` / `USING (true)` → only comment lines (`up.sql:18-20,410`); **zero in executable policy**. The `current_setting('app.workspace_id', true)::uuid` template denies on unset context.
- **No live DDL from this commit:** the 4 `.sql` files are migration artifacts executed only by `rollout-runbook.sh` at Stage 8 (the only `migrate`/`FORCE` matches in `src/` are test assertions). Pre-FORCE the owner role bypasses RLS ⇒ residual bare writes behave as today ⇒ no new leak.
- **Runbook STEP-5 FORCE gate:** F1 prerequisite + grep-verification comment + HALT instruction present (`rollout-runbook.sh:205-227`); `FORCE_COUNT >= 44` assertion + STEP-6 post-FORCE probe re-run intact.
- **`PrismaTx = Prisma.TransactionClient`:** canonical Prisma 5 export (`Omit<PrismaClient, ITXClientDenyList>`); no longer `never`; no `any`/`@ts-ignore`/`as never`; `tsc --noEmit` exit 0 (per 07c). RLS logic unaltered.
- **Tests:** ran all 4 staged suites myself — **37/37 pass / 0 fail** (brain-claim 7, rls-policy-shapes 13, cron-scope 6, rls-write-scope 11), incl. 8 negative WITH-CHECK simulations proving writes are rejected without context.

---

## New finding

### M3 — `/api/integrations/*` routes skip the correlation-seeding middleware (MEDIUM, tracked, non-blocking, NOT a regression)

- **What:** `app.ts` mounts no global correlation/request-id middleware (only helmet/cors/cookieParser/json). The correlation ALS 4-tuple is seeded ONLY inside `requireWorkspace` (`workspace.ts:100`). The 5 `/api/integrations/*` route handlers use `requireAuth` + inline `requireWorkspaceAdmin` and do NOT pass through `requireWorkspace`. So when `withWorkspace` runs on these paths, `getCorrelation()` returns the default `{requestId:'unset', traceId:'unset', ...}` and only `workspaceId` gets bound.
- **Why it is NOT a VETO / not a regression:** (1) the tenancy-critical element, `workspaceId`, IS bound through the wrap; (2) `requestId`/`traceId` degrade to a sentinel `'unset'` — no ID that was set is dropped; the upstream gateway's `x-request-id` is simply not read into ALS on these routes; (3) the structured cron-attempt logs that carry the full 4-tuple are emitted from the cron `syncAll*` path (which DOES seed correlation), not from these route `/sync` handlers (whose only logs are dev-only `console.log`); (4) this is a property of the **pre-existing port** of these routes — the 07c tx-wrap delta did not introduce it; these route files entered my review surface only in 07c.
- **Pin:** the route-migration phase MUST mount correlation seeding (a global request-id middleware, or routing `/api/integrations/*` through `requireWorkspace`) before any FORCE-era production traffic, so CF-SEC-5 holds end-to-end on these paths. Tracked; does NOT block this PASS.

---

## Carried findings

- **M1 — RESOLVED at code level** for the cron happy path + 5 route handlers. Residual same-class bare writes (shiprocket backfill/discoverChannels, cron recompute `:249`, unstaged Shopify libs, meta.ts catch-block) run with NO workspace context ⇒ fail-CLOSED post-FORCE (outage, not leak). Hard-gate-before-FORCE carries to Child-3 + Stage-8 runbook STEP-5. Non-blocking now.
- **M2 — disposition holds** (probe contextless-check FORCE ordering — Tanvi's live-DB deploy gate).
- **L1 — RESOLVED** (UUID shape guard added to `withWorkspace`).
- **L2 — RESOLVED** (`runInWorkspace` doc drift corrected).

---

## Gate (G4) checklist — this round

| Check | Result |
|---|---|
| Zero CRITICAL | PASS |
| Zero HIGH | PASS |
| Zero compliance violation | PASS — no new outbound/telecom/recording/PII surface in the delta |
| Zero missing-traceability (on the delta) | PASS — cron 4-tuple intact; wraps bind workspaceId. M3 (integrations routes req/trace sentinel) logged + pinned; not a dropped-ID regression |
| Every mutation endpoint guarded | The 5 wrapped sync calls are correctly behind `requireAuth`+`requireWorkspaceAdmin`; tenant-scoped via `withWorkspace` |
| PII not in logs (delta) | PASS — route/sync logs carry connectionId/workspaceId only; no email/phone |
| Vuln scans CLEAN on CRITICAL/HIGH | PASS — no new deps (supply-chain delta = 0) |
| Secret hygiene | CLEAN — zero secret values in full staged diff; `.env` not staged |

---

## Secret hygiene — CLEAN

Full staged-diff grep (added lines) for `sk-ant-…` / `shpss_…` / `GOCSPX-…` / JWT `eyJ….eyJ…` / `AKIA…` / PEM / `wZIGZ6z9` / `postgres://user:pass@`: **NO SECRET VALUES.** `.env` / `.env.*` NOT staged (confirmed). Route code references credentials by env-var name only.

---

## Verdict

**PASS** → returned to orchestrator (parallel review; I do NOT advance — Tanvi concurrent). F1/M1 confirmed resolved at code level; the 5 route-handler wraps are SAFE; zero CRITICAL/HIGH/compliance/missing-traceability on the delta; secret hygiene CLEAN. One new MEDIUM (M3, integrations-route correlation seeding) logged + pinned to the route-migration phase; M1's residual same-class bare writes carry the existing hard-gate-before-FORCE to Child-3 + Stage-8 runbook STEP-5.
