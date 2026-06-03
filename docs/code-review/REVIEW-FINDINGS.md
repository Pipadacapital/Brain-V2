# Brain Monorepo — Consolidated Code Review & Cleanup Plan

**Owner:** Engineering Director (review consolidation)
**Date:** 2026-06-03
**Source:** 10-person lens review (api-gateway, core-service, python-services, web, mobile, shared-libs), verified findings
**Hard constraint:** every fix MUST preserve existing functionality. "Bug fix" here means correcting a defect to match the *documented/intended* contract, with a test that pins the corrected behavior.

---

## 1. Executive Summary

The review surfaced **50 verified findings**. The dominant signal is not crashes — it is **silent correctness drift in the money/metric ladder** plus a large layer of **"advertised-but-dead" code** (helpers, modules, comments that assert guarantees the runtime does not provide).

Three structural themes account for most of the high-severity findings:

1. **Canon parity is asserted but not enforced on the production plane.** CM2/CM3, net-revenue (tax in vs out), order counts, ROAS, and subunit tables disagree across surfaces (KPI strip vs P&L, marketing vs acquisition, TS vs Python vs ClickHouse). The parity *tests* exist but run against stubs/loopback or assert only `typeof === 'number'`, so the divergences ship green. **Fixing the parity gate is the highest-leverage action** — it both catches the current bugs and prevents regressions.

2. **A whole class of money/cost math is wrong but currently latent or low-frequency**, e.g. True-CM2 never computes (reads a non-existent field), LLM cost estimate is 100x high (mis-trips the spend cap), ad-spend/COGS on zero-order days dropped from the rollup, COGS filter mis-classifies explicit ₹0.

3. **Display formatters are duplicated ~9 ways and have already drifted** (floor vs round; negative-value off-by-one), so the same basis-point value renders differently across pages. This is a single-primitive consolidation, but it is risky because it changes rounding for many call sites at once.

4. **Mobile end-to-end delivery is broken** by a dead auth-write API and a wrong push `projectId`, so the Morning Brief (the product's delivery surface) cannot register tokens or authenticate on real builds.

### Counts

| Classification | Count |
|---|---|
| **BUG_FIX** (real defect + test) | 24 |
| **SAFE_AUTOFIX** (no behavior change, test-backed) | 16 |
| **NEEDS_REVIEW** (rename/delete/refactor that can ripple) | 10 |
| **Total findings** | **50** |

By severity: **P1 = 13**, **P2 = 20**, **P3 = 17**.

---

## 2. Per-Area Health

| Area | Verdict |
|---|---|
| **shared-libs (metrics/formatters)** | UNHEALTHY — the canon byte-identity invariant is violated (ROAS, subunit tables) and the parity gate never runs registry formulas. Root-cause area; fix first. |
| **python-services (analytics/intelligence)** | UNHEALTHY — multiple money-correctness defects (True-CM2 dead, 100x LLM cost, rollup drops ad-spend, order-count proxies). Several share one root cause: `total_orders` missing from `MetricRow`. |
| **core-service** | AT RISK — revenue-ladder inconsistency (tax in/out), a real SQL-injection-shaped PG path, COGS NULL-vs-0 contract violation, ownership-transfer invariant gap. Logic correct in the happy path but contract-fragile. |
| **api-gateway** | AT RISK — production data-plane diverges from P&L canon (CM2/CM3), in-memory write that fakes success, dead Jharkhand branch; plus large dead-import/eslint-disable bloat across 21 router factories. |
| **web** | MOSTLY HEALTHY (latent) — the worst item (placeholder-UUID switcher) lives in dead `CommandCenter`; remaining issues are formatter duplication/drift and cosmetic/dead-code. |
| **mobile** | UNHEALTHY (delivery-blocking) — auth-write API entirely dead + wrong push projectId means push/auth do not work end-to-end on real builds; plus SLO mismeasurement and a Date-rehydration type lie. |

---

## 3. Theme Groups (dedup)

Findings were grouped where they share a root cause; fixing the group once resolves several IDs.

- **G1 — Canon revenue/CM parity across surfaces:** `api-gateway-1`, `core-service-1`, `core-service-5`, `core-service-12`, `python-services-5`, `shared-libs-1`, `shared-libs-2`, `shared-libs-3`, `shared-libs-4`. *Single decision needed: net = gross − discount (tax separate). Apply once, test once.*
- **G2 — `total_orders` missing from `MetricRow` (one root cause, four symptoms):** `python-services-1` (True-CM2 dead), `python-services-11` (KPI counts days), `python-services-13` (order count reverse-derived). Fix the column once; all three resolve. (RUNBOOK/Stage-8 MV note applies.)
- **G3 — Display formatter duplication + drift:** `web-3`(*dead*), `web-4`, `web-5`, `web-6`, `web-12`, `shared-libs-5`. *Consolidate to one module; decide floor-vs-round once; fix negative-sign math.*
- **G4 — Mobile end-to-end auth/push delivery:** `mobile-1`, `mobile-2`, `mobile-9`, `mobile-11`, `mobile-12`.
- **G5 — Dead code / "advertised but unwired":** `api-gateway-2`, `api-gateway-3`, `api-gateway-5`, `api-gateway-6`, `api-gateway-7`, `api-gateway-8`, `core-service-9`, `core-service-10`, `python-services-6`, `web-1`, `web-2`, `web-7`, `web-8`, `mobile-6`, `shared-libs-8`.
- **G6 — Stale/overstated comments asserting runtime facts:** `python-services-9`, `python-services-14`, `web-11`, `core-service-5`, `mobile-9` (comment portion).
- **G7 — Security hardening (defense-in-depth, latent):** `core-service-3` (PG interpolation), `core-service-7` (OAuth replay), `api-gateway-4` (body cap), `shared-libs-6` (chInsert allowlist), `shared-libs-7` (bare PII keys), `mobile-9` (cert pins).
- **G8 — Operational robustness:** `api-gateway-10` (global rate bucket), `api-gateway-11` (overlapping scheduler ticks), `api-gateway-13` (in-memory lead-time write), `python-services-7` (swallowed audit), `python-services-8` (TZ day boundary), `python-services-12` (counter pre-seed), `mobile-3` (SLO mismeasure), `mobile-5` (Date rehydrate), `mobile-7` (empty EDIT), `mobile-8` (a11y roles), `mobile-13` (clamp), `mobile-10` (RN types), `core-service-8` (join workspace_id), `core-service-11` (silent catch), `web-9` (Other Costs alias), `web-10` (bigint delta).

---

## 4. Prioritized Findings Table

Classification key: **BUG** = BUG_FIX, **SAFE** = SAFE_AUTOFIX, **REVIEW** = NEEDS_REVIEW.

| ID | Area | Cat | Sev | File : loc | Fix (short) | Risk | Class |
|---|---|---|---|---|---|---|---|
| shared-libs-1 | shared-libs | bug | P1 | lib-metrics/src/registry/definitions.ts:406 | blended_roas_x100 TS → integer form matching Python/CH | moderate | BUG |
| shared-libs-2 | shared-libs | test | P1 | lib-metrics/src/registry/registry.test.ts:559 | Assert exact value (1000/200), not `typeof number` | safe | BUG |
| shared-libs-3 | shared-libs | test | P1 | lib-metrics/src/parity-runner.ts:50 | Parity gate must run every `formula_ts` vs `formula_py` | moderate | BUG |
| shared-libs-4 | shared-libs | bug | P2 | subunits.py:17 vs subunits.ts:6 | Single canonical currency→multiplier table + parity test | moderate | BUG |
| shared-libs-5 | shared-libs | bug | P2 | lib-formatters/src/index.ts:12-41 | Negative-value sign handling (abs then reattach) | moderate | BUG |
| shared-libs-6 | shared-libs | security | P2 | lib-clickhouse-ts/src/index.ts:184 | chInsert: FACT_TABLES allowlist + require workspace_id | moderate | BUG |
| shared-libs-7 | shared-libs | security | P2 | lib-logger/src/redact-paths.ts:47 | Add bare `email`/`phone`/`firstName`/`lastName` paths | safe | SAFE |
| shared-libs-8 | shared-libs | dead_code | P3 | lib-metrics/src/index.ts:25 | Reconcile barrel exports with registry/index.ts | safe | REVIEW |
| core-service-1 | core-service | bug | P1 | fact-analytics.ts:250 vs 1541 | One canonical NC net-revenue SQL (tax decision), reuse 4× | moderate | BUG |
| core-service-2 | core-service | bug | P1 | product-cogs-use-cases.ts:97 | Filter on `cost_mu IS [NOT] NULL`, not `> 0` | moderate | BUG |
| core-service-3 | core-service | security | P1 | fact-analytics.ts:949-984,965 | PG shipment path → positional binds ($n) | moderate | BUG |
| core-service-4 | core-service | bug | P2 | fact-analytics.ts:1807 | Drop spurious +1 / use real week number | moderate | BUG |
| core-service-5 | core-service | comments | P2 | fact-analytics.ts:1060,1073 | Fix cohort/LTV docstring (net excludes tax) | safe | SAFE |
| core-service-6 | core-service | bug | P2 | fact-analytics.ts:666 | Assert actor is OWNER + demote rowCount=1 | moderate | BUG |
| core-service-7 | core-service | bug | P2 | oauth-state.ts:108 | DELETE state before vendor/expiry early returns | moderate | BUG |
| core-service-8 | core-service | bug | P2 | fact-analytics.ts:1437,1359 | Add `pf.workspace_id`(+`vendor`) to two joins | moderate | BUG |
| core-service-9 | core-service | dead_code | P3 | session-scoped-fanout.ts | Wire to cron OR quarantine as scaffolding | risky | REVIEW |
| core-service-10 | core-service | dead_code | P3 | local-aesgcm-custody.ts | Wire to credential path OR label scaffolding | risky | REVIEW |
| core-service-11 | core-service | standards | P3 | fact-analytics.ts:114,1053 | log.warn fallback; narrow catch to 42P01 | safe | SAFE |
| core-service-12 | core-service | comments | P3 | fact-analytics.ts:1681 | Apply CANCELLED filter consistently OR fix comment | moderate | BUG |
| api-gateway-1 | api-gateway | bug | P1 | local-db-data-plane.ts:313-339 | Derive KPI CM2/CM3 from P&L primitive + parity test | risky | BUG |
| api-gateway-2 | api-gateway | dead_code | P2 | make-settings-router.ts:16-105 (×21) | Drop blanket eslint-disable / enable noUnusedLocals | safe | SAFE |
| api-gateway-3 | api-gateway | dead_code | P2 | local-db-data-plane.ts:101-119 | Delete 15 unused empty* imports | safe | SAFE |
| api-gateway-4 | api-gateway | security | P2 | route.webhook.ts:231 | Set Fastify `bodyLimit` to MAX_BODY_BYTES | moderate | BUG |
| api-gateway-5 | api-gateway | bug | P3 | insight-gates.ts:84 | Replace `v<0n?v:v` no-op with `negative?-v:v` | safe | SAFE |
| api-gateway-6 | api-gateway | dead_code | P3 | membership-resolver.ts:48 | Delete LocalSeedMembershipResolver or move to test-support | moderate | REVIEW |
| api-gateway-7 | api-gateway | dead_code | P3 | role-map.ts:25 | Remove dead mapper OR wire into resolver | moderate | REVIEW |
| api-gateway-8 | api-gateway | dead_code | P3 | tenancy.ts | Consume from middleware OR quarantine phase2 | moderate | REVIEW |
| api-gateway-9 | api-gateway | bug | P2 | realtime-facts-consumer.ts:158,305 | Strip tax/shipping on total_price fallback (cross-path) | moderate | BUG |
| api-gateway-10 | api-gateway | standards | P3 | route.webhook.ts:165 | Key TokenBucket per vendor/source | moderate | BUG |
| api-gateway-11 | api-gateway | bug | P3 | sync-scheduler.ts:276 | In-flight guard / self-rescheduling setTimeout | safe | BUG |
| api-gateway-12 | api-gateway | duplication | P3 | router.ts:254 vs server.ts:142 | Export BrainRouter from one module | moderate | REVIEW |
| api-gateway-13 | api-gateway | bug | P3 | local-db-data-plane.ts:203 | Persist lead-time to DB OR return not-implemented | moderate | BUG |
| api-gateway-14 | api-gateway | bug | P3 | local-db-data-plane.ts:197 | Make Jharkhand 82/83 reachable per India Post zones | moderate | BUG |
| python-services-1 | python | bug | P1 | pnl_statement_query.py:205 | Add total_orders to MetricRow/_METRIC_COLUMNS (MV-gated) | risky | BUG |
| python-services-2 | python | bug | P1 | gateway/client.py:645 | Fix 100x unit scale on LLM cost estimate | moderate | BUG |
| python-services-3 | python | bug | P1 | recompute_daily.py:321 | Date-spine UNION so zero-order days keep ad/COGS | risky | BUG |
| python-services-5 | python | duplication | P2 | recompute_daily.py:291 | Source CM ladder from registry OR add parity test | moderate | BUG |
| python-services-6 | python | dead_code | P2 | metrics_grpc_client.py:271 | Delete dead+buggy `_nullable_int32` | safe | SAFE |
| python-services-7 | python | bug | P2 | graduation_middleware.py:254 | Propagate audit-write failure (match gateway client) | moderate | BUG |
| python-services-8 | python | bug | P2 | executor.py:154 | Use `datetime.now(timezone.utc).date()` for cap day | moderate | BUG |
| python-services-9 | python | comments | P3 | gateway/client.py:14 | Trim stale model-id provenance narrative | safe | SAFE |
| python-services-10 | python | bug | P3 | pnl_insight_agent.py:437 | Round (not truncate) pct; keep _display_round_bp in lockstep | moderate | BUG |
| python-services-11 | python | bug | P2 | metrics_servicer.py:256 | Read real per-day total_orders from MV (see G2) | risky | BUG |
| python-services-12 | python | standards | P3 | webhook_servicer.py:631 | Pre-seed webhook_* keys in _COUNTERS | safe | SAFE |
| python-services-13 | python | bug | P3 | pnl_context_builder.py:289 | Use real total_orders; guard AOV==None (see G2) | moderate | BUG |
| python-services-14 | python | comments | P3 | faithfulness/validator.py:17 | Condense defect-history narrative to current contract | safe | SAFE |
| web-1 | web | bug | P1 | workspace/workspace-switcher.tsx:28 | Delete dead switcher; standardize on shell variant | moderate | BUG |
| web-2 | web | dead_code | P2 | dashboard/command-center.tsx | Delete unimported CommandCenter (frees web-1 file) | moderate | REVIEW |
| web-3 | web | dead_code | P3 | dashboard-metrics-grid.tsx:299 | Delete tautological `prepaidRateBp` | safe | SAFE |
| web-4 | web | duplication | P2 | marketing/format-ratio.ts vs logistics/format-bp.ts | Single shared formatter module | risky | REVIEW |
| web-5 | web | duplication | P2 | dashboard-metrics-grid.tsx:108 (+7 files) | Consolidate formatters; one rounding rule | risky | REVIEW |
| web-6 | web | comments | P3 | acquisition-content.tsx:11 | Remove misleading "shared formatter untouched" comment | moderate | SAFE |
| web-7 | web | dead_code | P3 | shell/scaffold-page.tsx | Delete retired placeholder + guard test | safe | SAFE |
| web-8 | web | naming | P3 | dashboard-metrics-grid.tsx:61 | Correct/mark definitionId registry traces | safe | SAFE |
| web-9 | web | bug | P3 | dashboard-metrics-grid.tsx:350 | Source Other Costs honestly OR render `—` | moderate | BUG |
| web-10 | web | perf | P3 | dashboard-metrics-grid.tsx:133 | bigint delta math (avoid >2^53 precision loss) | moderate | BUG |
| web-11 | web | comments | P3 | application/providers.tsx:38 | Fix staleTime comment (5min, not 6h) | safe | SAFE |
| web-12 | web | bug | P3 | marketing/format-ratio.ts:23 | Negative-value sign handling (same as shared-libs-5) | moderate | BUG |
| mobile-1 | mobile | bug | P1 | push-notifications.ts:82 | Use Constants.expoConfig.extra.eas.projectId | moderate | BUG |
| mobile-2 | mobile | dead_code | P1 | auth-store.ts (writers) | Wire login flow OR delete unused setters | risky | REVIEW |
| mobile-3 | mobile | bug | P2 | slo-metric.ts:36 + MorningBriefScreen.tsx:456 | Emit metric post-commit OR rename to fetch_latency_ms | moderate | BUG |
| mobile-5 | mobile | bug | P2 | store.ts:25 + types.ts:78 | ISO-string type OR rehydrate transform for data_epoch | moderate | BUG |
| mobile-6 | mobile | dead_code | P3 | MorningBriefScreen.tsx:139 | Remove unused cardIndex OR use for a11y position | safe | SAFE |
| mobile-7 | mobile | bug | P3 | MorningBriefScreen.tsx:543 | Disable Edit CTA until edit UI; don't log empty EDIT | moderate | BUG |
| mobile-8 | mobile | standards | P3 | MorningBriefScreen.tsx:623,662 | Drop misused scrollbar/progressbar a11y roles | safe | SAFE |
| mobile-9 | mobile | security | P2 | app.json:28,31 | Real SPKI pins OR remove pinning + overstated comments | moderate | BUG |
| mobile-10 | mobile | standards | P3 | package.json:42 | Remove @types/react-native (RN 0.76 bundles types) | moderate | REVIEW |
| mobile-11 | mobile | standards | P3 | push-notifications.ts:93 | Stable install id (IDFV/AndroidId/SecureStore UUID) | moderate | BUG |
| mobile-12 | mobile | bug | P3 | package.json:6 | `main: "expo-router/entry"`; remove dead bootstrap | safe | SAFE |
| mobile-13 | mobile | standards | P3 | MorningBriefScreen.tsx:218 | Clamp width 0-100, type DimensionValue (drop `as any`) | safe | SAFE |

---

## 5. Recommended Execution Order

Principle: **fix the gate first** (so bugs cannot re-hide), then **bugs by blast radius**, then **safe cleanup**, then **reviewed structural changes**. Group fixes share a primitive — do the primitive once.

### Phase 0 — Build the guardrails that would have caught these (do first)
These are themselves bug/test fixes, and they convert the rest into verifiable work.
1. `shared-libs-3` — make the parity gate run every `formula_ts` vs `formula_py` (integer equality).
2. `shared-libs-2` — replace vacuous `typeof` assertion with exact-value assertions.
3. `python-services-5` — add CI parity test (rollup CM expressions == registry clickhouse_sql).

### Phase 1 — P1 money/correctness bugs (highest blast radius)
Decide the **canonical net-revenue definition (net = gross − discount, tax separate)** ONCE, then apply across:
4. `core-service-1` (marketing vs acquisition tax), `core-service-5` (docstrings), then reconcile `api-gateway-1` (KPI CM2/CM3 vs P&L) using the same primitive + a LocalDbDataPlane parity test.
5. `shared-libs-1` — blended_roas_x100 TS integer form (now caught by Phase 0 gate).
6. `python-services-2` — 100x LLM cost scale (mis-trips spend cap).
7. `python-services-3` — date-spine so zero-order days keep ad/COGS (overstates CM today).
8. **G2 root cause:** add `total_orders` to `MetricRow`/`_METRIC_COLUMNS` (MV change is RUNBOOK/Stage-8 gated — schedule it), which resolves `python-services-1`, `-11`, `-13`.
9. `core-service-2` — COGS NULL-vs-0 filter.
10. `core-service-3` — PG shipment path positional binds (security P1).
11. `mobile-1` + `mobile-2` — push projectId + wire/decide auth-write API (delivery-blocking; `mobile-2` is REVIEW because it needs a login-flow decision).
12. `web-1` — fix/remove placeholder-UUID switcher.

### Phase 2 — P2 bugs + security hardening
`shared-libs-4`, `shared-libs-5`, `shared-libs-6`, `core-service-4`, `core-service-6`, `core-service-7`, `core-service-8`, `api-gateway-4`, `api-gateway-9`, `python-services-7`, `python-services-8`, `mobile-3`, `mobile-5`, `mobile-9`.

### Phase 3 — SAFE_AUTOFIX cleanup (no behavior change, test-backed; batch these)
`api-gateway-5`, `api-gateway-2`, `api-gateway-3`, `core-service-5`, `core-service-11`, `python-services-6`, `python-services-9`, `python-services-12`, `python-services-14`, `web-3`, `web-6`, `web-7`, `web-8`, `web-11`, `shared-libs-7`, `mobile-6`, `mobile-8`, `mobile-12`, `mobile-13`. (Plus the P3 BUGs that are low-risk + test-backed: `api-gateway-11`.)

### Phase 4 — P3 bugs
`api-gateway-10`, `api-gateway-13`, `api-gateway-14`, `python-services-10`, `web-9`, `web-10`, `web-12`, `mobile-7`, `mobile-11`.

### Phase 5 — NEEDS_REVIEW structural changes (rename/delete/refactor — last, behind individual review)
- **Formatter consolidation (G3):** `web-4`, `web-5` (decide floor-vs-round once; touches ~9 files — do after Phase 1 so display math is settled). `web-12`/`shared-libs-5` sign-fix folds into this.
- **Dead-code deletions/quarantine (G5):** `web-2`, `api-gateway-6`, `api-gateway-7`, `api-gateway-8`, `api-gateway-12`, `core-service-9`, `core-service-10`, `shared-libs-8`, `mobile-10`.

---

## 6. Notes on the "preserve functionality" constraint

- Several **P1/P2 fixes change a user-visible number** by definition (CM2/CM3, ROAS, net revenue, week labels, Other Costs). These are classified **BUG_FIX, not SAFE_AUTOFIX**, precisely because the output changes — each requires a value-pinning test and human sign-off, and the correct value must be reconciled against the canon decision (Phase 1) before applying.
- **MV-touching fixes** (`python-services-1/11/13`, `python-services-5`) depend on the RUNBOOK-gated `workspace_daily_metrics_computed` migration; do not add `total_orders` to `_METRIC_COLUMNS` without the matching MV alter or the SELECT will break.
- **`api-gateway-9` and `core-service-1`** are cross-path (realtime mirrors batch); changing one without the other re-introduces divergence — fix as a coordinated pair.

---

## 7. Execution Status (2026-06-03)

**Done (45/50):** all P1/P2/P3 bugs + SAFE_AUTOFIX + the product-decision items
(formatters→round, mobile auth-write wired, dead CommandCenter/switcher/scaffold
deleted). ~200 new tests; full suite green (api-gateway 439, core-service 385,
web 852, analytics 331, intelligence 301, ingestion 338, mobile 60, packages 250).

**Deferred (5) — need a deliberate wire-or-remove decision, NOT a blind delete
(each is referenced by tests or live code; deleting breaks functionality):**
- `core-service-9` `session-scoped-fanout.ts` — used by 7 passing tests.
- `core-service-10` `local-aesgcm-custody.ts` — active credential-custody default.
- `api-gateway-6/7/8` `LocalSeedMembershipResolver` / `role-map` / `tenancy` — test
  infra + Phase-2 scaffolding (carry explicit "hold" comments).
- `shared-libs-8` barrel-export reconcile — cosmetic.
