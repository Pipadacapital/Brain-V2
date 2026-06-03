# Brain — Independent Advisor Review

**Date:** 2026-06-02
**Reviewer:** Lead Advisor (synthesis of 10 adversarially-verified lens reviews)
**Scope:** Live local stack (read-only), new app (`apps/*`, `packages/*`), with the legacy app and `docs/parity-fix/production-readiness-report.md` as references — verified independently.
**Live config at review time:** `READ_FROM_CH=true`, stub plane OFF, gateway healthy (`/health` ok, `/ready` postgres+clickhouse true).

---

## 1. Headline Verdict

**Brain is architecturally sound and locally runnable, but it is NOT production-ready, and — more importantly — several of its headline numbers are silently wrong today.** The foundation is genuinely good: the seams are real (vendor-discriminator facts, OLTP/OLAP split, DataPlanePort), the auth/tenant-isolation core is fail-closed and empirically verified, money is integer-minor-units end to end, and the 8-wave readiness pass really did close the worst live-500 / fabricated-COGS defects. This is not a house of cards.

But the product's primary job — period analysis of profit — is broken in a way that looks authoritative. **The single most important thing to fix:** *the date-range picker is a no-op on every headline summary surface.* KPI strip, P&L, CM waterfall, marketing, goals, and costs all silently return **lifetime** (2022–2026) numbers regardless of the selected window, and period-over-period deltas are therefore a guaranteed 0%. Reproduced live on the anchor customer Sugandhlok: 7-day net = ₹6.96 Cr vs lifetime = ₹368.8 Cr — the UI shows the lifetime figure for both. This is worse than a missing feature; it actively misleads an operator's first action every morning.

Right behind it sit two **P0 security/correctness regressions that landed today** (migration 29): a cross-tenant RLS leak on the line-item view (reproduced: 350,352 other-tenants' rows readable by the app role), and a 2x revenue/units double-count on Product Performance. And the standing **OPEN-P0** remains: the live production DB has zero RLS.

The deepest concern is not any single bug — it is that **the test suite gives false confidence**: CI runs almost none of it, the real read path is verified only by tests that skip by default, and the function that broke production (`decorateWithFinal`) still has zero tests. The bugs found here are the *silent-wrong-number* class precisely because nothing asserts behaviour against real data.

### Per-lens verdict

| Lens | Verdict | One-line |
|---|---|---|
| Application flow | **adequate** | Auth/onboarding flows excellent; core analytics date-range is a no-op feeding flat 0% deltas. |
| Architecture | **solid** | Honest modular monolith with real seams; dual hand-maintained PG/CH SQL and a tsconfig-alias "boundary" are the structural risks. |
| Database | **adequate** | Strong money/FK/RLS design, but a today-landed migration re-introduced a cross-tenant view leak + a 2x un-merged read. |
| Security | **adequate** | Authn/authz/tenant core genuinely strong + fail-closed; broken CH escaper (DoS), live-DB zero-RLS, unrotated OAuth secrets. |
| Test-suite quality | **weak** | Large good corpus, but CI runs ~none of it; real read path + `decorateWithFinal` untested; suite RED in two ungated services. |
| QA / functional correctness | **weak** | Worst data defects fixed, but three conflicting "net" definitions, date-blind P&L, degenerate COD, case-broken filters. |
| App-integration testing | **adequate** | No more 500s; honest-empty discipline holds — but headline surfaces are date-blind and Morning Brief is hardcoded empty. |
| Performance / scalability | **solid** | Well-engineered read path at current scale; `skipFinal` time-bomb, empty pre-agg MV, seq-scan on orders list. |
| Code quality | **adequate** | Strict types, zero `as any`/TODO; but hand-mirrored PG/CH layer, fragile seed-inheritance, NO backend linting. |
| Operability / DevOps | **weak** | Good process hygiene, but no executable prod path: CDK/k8s scaffolds, no migration tracking, custody stub, thin CI. |

---

## 2. What Is Genuinely Strong

These are verified, not flattery:

- **Tenant isolation is real and empirically fail-closed.** `workspace_id` is derived server-side from the verified JWT `sub` (never headers), asserted before every data-plane call, and enforced at the DB: `rls_app` with no `app.workspace_id` returns 0 rows on `connector_order_facts`. 21/22 workspace tables are ENABLE+FORCE RLS. (security, database)
- **JWT verification is correctly hardened** — algorithms pinned to RS256/ES256 (defeats the HS256/none + published-anon-key forgery class), issuer+audience pinned, all failure modes collapse to a generic error with no token/PII leak. (security)
- **The architecture is honest, not theatrical.** The in-process modular monolith is documented as such; no false "microservices running" claim. The generic vendor-discriminator fact model was independently re-validated (ADR-CONVERGENCE-001) as sound for 100+ integrations. (architecture)
- **Money discipline is total** — zero float/numeric/money columns anywhere; all money `bigint _mu`, all rates `integer _bp`. Strict `tsc` passes clean; zero `as any`, zero TODO/FIXME in backend src. (database, code-quality)
- **The 8-wave pass genuinely fixed the worst defects.** `vendor_product_id` restored (COGS computes ₹1.98B for Sugandhlok, not ₹0); refunds reconcile to the rupee; the `decorateWithFinal` alias+JOIN bug fixed (order facts no longer 2x); no surface 500s on the real workspace. (qa, app-integration)
- **Blast-radius caps are wired, not aspirational** — CH `max_execution_time=30` + 10s client timeout for PG failover, PG `statement_timeout=30s`, OFFSET hard-capped at 10,000. Workspace-id-leading indexes/ORDER BY throughout. (performance)
- **Process hygiene is correct** — crash handlers (`unhandledRejection`/`uncaughtException` → fatal+exit), SIGTERM drain, a *true* `/ready` probe that pings PG+CH and 503s, and boot-time fail-fast config validation for prod. (operability)

---

## 3. The Hard Truths — P0 / P1 Findings (prioritised)

Cross-lens duplicates are merged. The date-range no-op was reported by three lenses (AF-1, AIT-1, pnl-cm-waterfall-ignores-date-range) and is consolidated as **#1**.

### P0 — must fix before any cutover

| # | Lens | Issue | Why it matters | Fix |
|---|---|---|---|---|
| **P0-1** | database / security | **Cross-tenant RLS leak: `connector_line_item_facts` view lost `security_invoker`.** Migration 29 (today) recreated the view via `CREATE OR REPLACE VIEW` with no `WITH` clause, reverting to definer (postgres, BYPASSRLS) semantics. Comment line 18 falsely claims "RLS: inherited from the _hot table." **Reproduced:** `rls_app` reads **350,352** rows across all tenants — even *with* a correct workspace context set. | This view is the PG-fallback read surface for COGS/CM1/CM2/product joins. Any tenant reading through it sees every other brand's line items. Fails OPEN on any CH error. | `ALTER VIEW public.connector_line_item_facts SET (security_invoker = true)`. Add conformance test: every public view over a `_hot`/fact table has `security_invoker=true` and returns 0/own-tenant only. Audit all other `CREATE OR REPLACE VIEW` migrations. Make the CH-fallback fail **closed** on tenant-scoped reads. (`migrations/local-dev/29-line-item-vendor-product-id.sql:27`) |
| **P0-2** | security / operability | **Live production DB has zero RLS** (standing OPEN-P0). Live Supabase (full legacy prod, ~85k orders, 4 tenants) has no row-level isolation; the connection identity is the Supabase **superuser** role, which bypasses RLS even if policies existed. The Brain-native RLS apparatus exists but is held at Stage-8 behind HOLDs, never applied to live. | Any cutover pointing the gateway at live inherits a DB with no DB-enforced isolation; the app-layer assert becomes the *only* barrier and a single missed `requireRole`/raw query/escaper bug leaks across every tenant. Note: the live *legacy* app already runs on this DB today. | Hard gate: no prod cutover until live DB has ENABLE+FORCE RLS on every `workspace_id` table, a **non-owner** `rls_app` role, and per-request `app.workspace_id` GUC via `withWorkspace`. Run the C3 deny-matrix + `check_rls.py` against live before any traffic. Founder/Rohan-gated — **the #1 cutover blocker.** |
| **P0-3** | database / performance / qa | **Product Performance shows 2x revenue & units** (consolidates DB-3 + PERF-1 + product-perf COGS). `connector_line_item_facts` is a ReplacingMergeTree with **98 active parts / 700,704 rows for 350,352 unique keys** (never OPTIMIZE'd after migration-29 backfill), and `readProductPerformanceCH` is the **only** read with `skipFinal:true`. Live: revenue ₹780.99 Cr vs correct ₹390.50 Cr; units 765,970 vs 382,985. Compounding: its COGS ignores override/fallback/markup, so it also contradicts the COGS surface (₹191.36 Cr vs ₹197.91 Cr). | Every absolute product number on the Pareto/merchandising surface is double today; the readiness pass caught the *sibling* order-facts double-count but missed this one. | Remove `skipFinal:true` (`fact-analytics-ch.ts:308`). Run `OPTIMIZE TABLE brain.connector_line_item_facts FINAL` and add it to `phase8-ch-backfill.sql`. Thread `CogsSettings` into `readProductPerformanceCH` and apply the same `multiIf` precedence as `readCogsCH`. Data-quality assertion: `count() == count() FINAL` per RMT fact (NOT `uniqExact(orderkey)` — that column doesn't exist). |

### P1 — fix before treating the stack as releasable

| # | Lens(es) | Issue | Why it matters | Fix |
|---|---|---|---|---|
| **P1-1** | app-flow / app-integration / qa | **Date-range picker is a no-op on every headline summary surface.** `getKpiSummary/getPnlStatement/getCmWaterfall/getMarketingEfficiency/getAcquisitionSummary/getGoalAttainment/getCostStack` accept `date_range` but call readers with workspace-only; the CH/PG summary readers have no date predicate. **Reproduced:** Sugandhlok 7D net ₹6.96 Cr vs lifetime ₹368.8 Cr — UI shows lifetime for both; goal RAG compares a monthly target to 3 years of revenue; every delta chip is flat 0%. The daily charts *do* window, so the page is internally inconsistent. | Period analysis IS the product; the main control is dead and the numbers look authoritative. Regression vs legacy (which filters by `processedAt`). Also doubles CH load (current+prev queries return identical data). | Thread `date_range` into `readStoreSummary/readPnl/readMarketing/readCogs` (+CH siblings); add `AND placed_at >= {from} AND placed_at < addDays({to},1)` mirroring `readDailyNetSalesCH:911`. NOTE: column is `placed_at`, not `order_date`; ad spend uses `date`. `readPnlPeriodGrid` already proves the plumbing. Add a test: 30-day total < lifetime. Until fixed, hide the date controls + delta chips. |
| **P1-2** | qa / app-integration | **Three conflicting "net revenue" definitions.** Store-summary honours the contract (`gross − discount`); but P&L, CM waterfall, KPI `net_revenue_mu`, and cohort/LTV/acquisition all subtract tax (`gross − discount − tax`). Legacy uses `totalPrice` (tax- **and shipping-inclusive**). Sugandhlok: tax wrongly subtracted = **₹22.9 Cr (6.3%)**. The same dashboard renders "Net Sales" and "Net Revenue" as differing KPIs with no explanation. | The headline money number is inconsistent across the two surfaces customers stare at most, and contradicts both the stated contract and legacy. Every downstream margin/ratio inherits the wrong base. | Pick ONE net definition and apply everywhere. If contract stands, drop `− tax_mu` from `COHORT_NET` (`fact-analytics-ch.ts:544`) and realizedRevenue (`:102`, PG `:143-145`). Add a parity test: store-net == P&L-net == cohort-aggregated-net. |
| **P1-3** | qa / app-integration | **Case-broken `financial_status` filter leaks VOIDED/REFUNDED into revenue.** The canonical constant uses `lower(...)`, but three JOIN legs use bare `financial_status NOT IN ('voided','refunded')` against UPPERCASE data: `fact-analytics-ch.ts:592` (cohort revenue), `:953` (daily acquisition), `:1077` (calendar). Reviewer's figures were for the wrong workspace; corrected: **Boddactive ~781 orders / ~₹27 lakh / ~4% inflation**; Sugandhlok 6 orders. Also `readPnlPeriodGrid:1709` uses lowercase `'refunded'` equality → refund column is **0 for all Shopify (uppercase) workspaces** including both anchors. | Silent revenue inflation in cohorts/LTV/acquisition/calendar; cohort *size* and *revenue* use different populations. CH path silently diverges from PG. | Replace all bare filters with the shared `CANCELLED_OK` constant. Use `lower(financial_status)='refunded'` (or join `connector_refund_facts`) in the period grid. Add a test on a workspace with UPPERCASE VOIDED/REFUNDED. |
| **P1-4** | qa / app-integration | **COD vs Prepaid is degenerate for every order.** `payment_method=''` and `is_cod=false` for 100% of orders (both planes, both anchors); migrated data never ran through `classifyPaymentMethod`. The order-side signal was **never migrated** — so the readiness report's "reclassify in place" fix is a no-op. | COD/RTO economics is Brain's India moat; the comparison is all-zero. Boddactive renders `connected=true` with ₹0/₹0 splits next to real RTO-by-payment numbers (internally inconsistent). | Re-extract order-level `payment_method`/`is_cod` from legacy prod into facts+CH. Tighten the `connected` gate so a zero COD+Prepaid count shows "not available" even if shipments exist. |
| **P1-5** | architecture / code-quality | **Dual PG+CH read path is two hand-maintained SQL bodies per metric with NO parity test.** `fact-analytics.ts` (1993 ln, PG) and `fact-analytics-ch.ts` (1099 ln, CH) hand-mirror every metric; predicates are duplicated literals. Both planes agree today (verified byte-identical for 3 workspaces) **only because someone keeps them in sync** — nothing enforces it. A broken/un-wired parity harness exists (`tools/migrate-legacy/phase6-parity-batch4.ts`, dead import path, 7/19 fns). | Single largest ongoing drift hazard; money math drifts the moment one side is edited, with no compiler help and a silent fallback masking it. | Repair + promote the parity harness to a CI-gated Vitest suite over all 19 paired fns vs `brain_dev`. Extract shared predicates/ladder into one module. Long-term: single-source SQL from `canonical-facts.yaml`. |
| **P1-6** | architecture | **Service "boundary" is a tsconfig source-path alias into another service's internals.** `api-gateway/tsconfig.json:6-18` defines 11 aliases resolving into `core-service/src/...`; `core-service/package.json` has no `exports`. The gateway is hard-wired to core's folder layout; the documented Phase-2 split has nothing to extract against. | Boundary-by-convention, not contract; any refactor of `contexts/<bc>/index.ts` silently breaks the gateway with no contract test. | Give core-service an `exports` map + typed per-BC facade; gateway depends on that surface only. Conformance check failing any alias into another app's `src/`. |
| **P1-7** | security | **Broken ClickHouse escaper — live DoS primitive on shipments console.** `esc = s => s.replace(/'/g,"''")` doubles quotes but never escapes backslash; interpolated raw into CH SQL (`fact-analytics-ch.ts:427,431,434,440`) with no Zod cap. **Reproduced:** any authenticated ANALYST 500s the console with a trailing backslash. Full SQL injection / exfil **could not** be demonstrated (workspace_id is a bound param), so this is a DoS + latent-injection sink, not RCE. | Breaks a live customer feature on trivial input; one bad copy of this idiom into a tenant-scoped interpolation becomes a real isolation breach. | Bind `search`/`statuses`/`cursor` as named CH params (`{search:String}`, `{statuses:Array(String)}`) exactly as `workspace_id` already is. Add Zod length/charset caps. Unit test feeding a trailing backslash. |
| **P1-8** | security | **Live OAuth secrets plaintext in the working tree; reportedly compromised + unrotated.** Real `shpss_…`, `GOCSPX-…`, Meta secret in `.env.docker` / `apps/api-gateway/.env`. NOT git-tracked (no repo leak). Custody for prod backings throws (`HeldProductionCustody`); only static-key `local-aesgcm` works; no boot guard refusing it in prod. **Mitigant:** 0 sealed tokens today (`connector_credentials`=0). | Escalates to P0 at cutover — tokens would seal under a static env key with no KMS rotation. | Founder rotates the three vendor secrets. Implement `AwsKmsCustody` + boot guard refusing `local-aesgcm` when prod. Add gitleaks CI rule for `shpss_`/`GOCSPX-`/`service_role`. |
| **P1-9** | app-integration / architecture | **Morning Brief — the flagship surface — is hardcoded empty.** `getMorningBrief` unconditionally returns `items:[]`; the only generator (`buildSugandhlokBrief`) is dead code. No real generator wired. **Not tracked as a HOLD** anywhere in `docs/parity-fix/`. Mobile screen renders it. | Canonically "THE product surface" produces nothing for any workspace, and is silently absent from the parity tracker — easily mistaken for done. | Wire a deterministic SQL-paradigm ranked-insight builder, OR add an explicit named HOLD to the tracker (at minimum, immediately). |
| **P1-10** | test-suite | **CI executes almost none of the test suite.** Of ~775 Python test fns across analytics/intelligence/ingestion, CI runs **2 files (~21 fns)**; web (210 vitest files) and mobile excluded; the inline comment claiming the Python suites "already run" is false. The 3 Python services aren't turbo packages, so `turbo run test` runs zero Python. | A regression in PII/injection/faithfulness/GST/parity or 210 web contracts merges green. The two most-critical invariants (C4 isolation, C8 cost) *are* gated, so P1 not P0. | Add blocking jobs: `uv run pytest` per Python service; web vitest as required. Delete the false comment. |
| **P1-11** | test-suite | **Suite is RED in two ungated services.** intelligence: 1 failed (stale `InsightItem` test missing 3 required fields). ingestion: cannot run at all (missing `[tool.hatch.build.targets.wheel] packages=["src"]`). Both invisible because CI never runs them. | A failing test and a non-runnable suite both passed unnoticed; ingestion (connector ingest, PII manifest, idempotency) is entirely dark. | Fix the `InsightItem` test; add the wheel stanza to `apps/ingestion-service/pyproject.toml`; gate both under P1-10's jobs. |
| **P1-12** | test-suite | **The real read path (LocalDbDataPlane + CH SQL) is untested.** `LocalDbDataPlane` is instantiated in zero tests; every router read test runs against `StubDataPlane`; three `local-db-data-plane.*.test.ts` files actually test the stub or pure helpers. No `*.integration.test.ts`. `READ_FROM_CH=true` is the live config — the live path has zero behavioural coverage. | The live 500s and silent-wrong-numbers all live in this untested layer; the next migration reintroduces them. | Author `INTEGRATION_TEST`-gated `*.integration.test.ts` driving real `LocalDbDataPlane` vs `brain_dev` PG+CH for workspace `f165da80`. Rename the mislabeled stub tests. |
| **P1-13** | test-suite | **`decorateWithFinal` — the function that broke prod — still has zero tests** after being made *more* complex. `packages/lib-clickhouse-ts` has no test file, no test script, no vitest dep; the function isn't even exported for test. | A fragile regex on the hot read path that broke once (50 live SYNTAX_ERRORs) with no regression guard; the silent fallback would hide a re-break. ~30-min fix. | Export it; add vitest + `index.test.ts` covering bare/AS/no-alias, JOIN, idempotency, non-fact, `brain.`-prefix, and the four broken queries. |
| **P1-14** | test-suite | **RLS/tenant-isolation integration tests skip by default and never run in CI.** 5 integration files gated by `describe.skipIf(!IS_INTEGRATION)`; `INTEGRATION_TEST` set nowhere in `ci.yml`; the C12 deny-matrix (`db-isolation/run.sh`) is referenced as "proof" but never executed (C12's impl is purely static). | The behavioural proof that RLS fail-closes — the #1 security invariant — runs in zero automated path, compounding P0-2. | CI job with a postgres service: apply migrations, `INTEGRATION_TEST=true`, run the 5 files + `run.sh` asserting 11/11 deny. Wire `run.sh` into `run_conformance.py`. |
| **P1-15** | test-suite | **No e2e/contract/load coverage, and analytics SQL is never executed against ClickHouse.** `tests/{contract,e2e,load}` are `.gitkeep`; the one Playwright spec runs against the stub and isn't in CI; analytics pytest mocks the CH client (286 passed in 0.16s) so dialect/FINAL/column drift is structurally uncatchable. | The exact bug class the readiness pass found (FINAL syntax, empty join keys) cannot be caught by mock-everything. | Add a tRPC contract-snapshot suite; wire Playwright into CI against the local stack; thin analytics integration layer running each query's SQL vs live CH asserting non-throwing/non-empty. |
| **P1-16** | code-quality | **Backend has NO linting.** `@brain/eslint-config` is an empty stub; no eslint config exists in the repo; core/lifecycle/notifications ship `echo 'lint stub'`; api-gateway + all `lib-*` have no lint script; CI has no lint job. | `no-floating-promises` alone (Kafka/gRPC/Fastify) prevents silent unhandled-rejection/data-loss bugs; CQ-03/04 drift exists *because* nothing flags it. | Populate a real flat config (typescript-eslint recommended-type-checked + no-floating-promises + no-unused-vars); add scripts to api-gateway + lib-*; add a blocking `lint` CI job. |
| **P1-17** | operability | **CI gate omits Docker build, security scanning, lint, cdk synth, e2e.** `ci.yml` = conformance + typecheck + vitest only; zero matches for docker build / trivy / gitleaks / semgrep / lint / cdk synth / playwright. The container images that ship to prod are never built in CI. | Green CI doesn't mean the prod artifact is buildable, scanned, or lint-clean; a committed secret or CVE base image merges clean. | Add blocking jobs: docker build per deployable; security stage (gitleaks → trivy/grype); lint; `cdk synth`; fold web/mobile build into typecheck. |
| **P1-18** | operability | **No production migration path or migration safety.** Schema lives as hand-applied numbered SQL under `migrations/local-dev/` (01..29) + `docker cp`+psql; no tracking table (confirmed: 0 migration tables in `brain_dev`), no runner, non-transactional statement-by-statement apply, unwired down files, no CI validity gate. | In prod, migrations become unaudited, non-idempotent, non-versioned manual ops with impossible rollback — outage- and drift-prone during cutover. | Adopt a real migrator (node-pg-migrate / Atlas) with tracking table + transactional idempotent apply; promote local-dev SQL to a versioned env-agnostic set; gate up+down vs ephemeral PG in CI. |
| **P1-19** | operability | **No metrics emission / no `/metrics` endpoint.** `curl /metrics` → 404; no prom-client/OTel installed; the tracing middleware computes `duration_ms` but only logs it; no traceparent/exporter. | Cannot define/alert on an SLO, page on error-rate/latency, or see pool saturation; on-call is blind beyond log tailing. | Add prom-client + `/metrics` emitting `trpc_procedure_duration_ms`/`_errors_total` (from existing middleware), `pg_pool_in_use`, `ch_query_duration_ms`; emit W3C traceparent + OTel exporter. |
| **P1-20** | operability | **No executable production deploy path.** `infra/cdk/lib` = 2 stacks (custody + one task-def); no VPC/cluster/DB/ALB/DNS; `infra/k8s/*` = `.gitkeep`; both labeled "AUTHORED, NOT DEPLOYED." | There is no way to stand up prod from this repo; the deploy-lens production-readiness claim is aspirational. Documented Founder/Rohan-gated Stage-8 item, hence P1 not P0. | Author the remaining CDK stacks + k8s base (probes/HPA/PDB/NetworkPolicy) so `cdk synth` covers all deployables and Stage-8 is a reviewed deploy, not greenfield IaC under pressure. |

---

## 4. P2 / P3 — Grouped One-Liners

**Application flow / integration**
- (P2) Correlation 4-tuple drops at the gateway→data-plane boundary; `buildGrpcMetadata` is dead code; comments overclaim end-to-end tracing — correct the comments and/or thread `requestId` into `chQuery` as `query_id`.
- (P2) Two date-keyed reads per metric return byte-identical lifetime data (doubles CH load) — resolved once P1-1 lands.
- (P2) Error-response `data.requestId` is always null on auth-tier errors; UNAUTHORIZED logs at level 50 instead of warn.
- (P2) No live integration/contract test guards the read path (overlaps P1-12/P1-15).
- (P3) Dashboard `isLoading` guard ignores store + prev queries → brief flash of `—` on revenue tiles.
- (P3) Onboarding success comment promises `/w/{slug}/dashboard` but no `/w/[slug]` route exists.

**Architecture**
- (P2) C11 "DDD layering" gate only checks folder *names*, not dependency direction — upgrade to a real import-graph rule (would catch P1-6).
- (P2) Live PG↔CH physical column-name drift persists (`total_discount_mu`↔`discount_mu`); drift gate is a DDL presence check, not codegen or live-DB.
- (P2) Two bare silent `catch {}` remain on the CH→PG fallback (incl. the most-trafficked `readStoreSummary:104`); no `ch_read_fallback_total` metric.
- (P2) `RegionAdapter` interface still absent — region seam is informal, India functions called directly.

**Database**
- (P2) PG↔CH drift: `is_new_customer`/`billing_pincode` dropped on CH; new-vs-returning can disagree between planes.
- (P2) `raw_event_transform_state` is the lone table with RLS enabled-not-FORCED; `connector_refund_facts` lacks a `workspace_id` FK.
- (P2) Auto-FINAL is regex-over-SQL with a `skipFinal` escape hatch — a fragile correctness boundary (overlaps P0-3).

**Security**
- (P2) Swallowed CH errors hide injection/abuse signal — emit `ch_read_error_total` + alert.
- (P2) `customer_ref` hash is unsalted and not workspace-scoped → cross-tenant re-identification/linkage (DPDP); use per-workspace HMAC.
- (P3) `raw_event_transform_state` enabled-not-FORCED (same as DB-5).

**QA / functional correctness**
- (P2) RTO orders aren't zeroed in cohort/LTV revenue (legacy realizes RTO as 0); join key mismatch means the fix needs order name/number carried into facts first.
- (P2) Shipping excluded from net and 0 in source for both anchors; legacy `totalPrice` is shipping-inclusive — confirm intent, document delta.
- (P2) First-product-cascade CH query hardcodes `vendor='SHOPIFY'` — latent under-count for the first multi-channel brand.

**Performance**
- (P2) Every dashboard read recomputes from raw facts — the pre-agg MV (`workspace_daily_metrics_*`) is empty (scalability runway item, fine at 83k).
- (P2) Orders/store-browser list does a full Parallel Seq Scan + top-N sort per page; add `(workspace_id, processed_at DESC)` index + keyset pagination.
- (P2) Primary dashboard issues independent reads serially — wrap in `Promise.all` (already done elsewhere).
- (P2) Session-mode connection ceiling (max 10 × instances) is a horizontal-scaling cliff; `:6543` tx-pooler escape hatch is incompatible with the per-tx RLS GUC.
- (P3) 98 unmerged active parts on the largest table inflate every FINAL scan; run one-time OPTIMIZE + batch inserts.

**Code quality**
- (P2) CH→PG fallback handling inconsistent — 2 sites still silent (overlaps architecture); extract a `chOrPg<T>` helper.
- (P2) ~22 router factories carry a blanket `eslint-disable` hiding dead imports (8 in `make-pnl-router.ts`).
- (P2) `LocalDbDataPlane extends StubDataPlane` (the Sugandh-Lok seed plane) — fragile; a forgotten override would serve fabricated seed numbers stamped with a real workspace id.
- (P3) Three 1,500–2,700-line files (`fact-analytics.ts`, `loopback-data-plane.ts`, `local-db-data-plane.ts`) concentrate merge-conflict risk.

**Operability**
- (P2) `AwsKmsCustody` throwing stub in TS core-service (the service that actually seals OAuth tokens) — but the full boto3 impl already exists in the Python ingestion service, so it's a port job, not greenfield.
- (P2) No Sentry/error-reporting — off-request crashes produce one log line + restart, no aggregated alert.
- (P2) Response logs show `statusCode:null`; trace context is header-passthrough only (no traceparent propagation).

---

## 5. Improvement Roadmap (30 / 60 / 90)

### First 30 days — stop misleading users and close the leaks (engineer, in-repo)
1. **P0-1 RLS view leak** — `ALTER VIEW ... SET (security_invoker=true)` + conformance test. *Minutes of work; a live cross-tenant leak.*
2. **P0-3 product-perf 2x** — remove `skipFinal:true`, `OPTIMIZE ... FINAL`, fix COGS precedence, add `count()==count() FINAL` assertion.
3. **P1-1 date-range no-op** — thread `date_range` into the summary readers (pattern already exists at `readDailyNetSalesCH:911`). Highest user-trust impact.
4. **P1-2 / P1-3 net definition + case filters** — pick one net definition; replace bare `financial_status` filters with the shared constant; fix the period-grid refund column.
5. **P1-13 `decorateWithFinal` tests** + **P1-16 enable backend lint** + **P1-11 fix the two RED suites** — cheapest high-leverage safety wins.
6. **P1-9 Morning Brief** — at minimum add an explicit HOLD to the parity tracker so it isn't mistaken for done.

### 31–60 days — make the safety net real (engineer, in-repo)
7. **P1-10 / P1-12 / P1-14 / P1-15** — a real CI test pyramid: run all Python suites, web vitest, the integration read-path tests against `brain_dev`, the RLS deny-matrix, and Playwright. This is the structural fix that prevents the silent-wrong-number class from recurring.
8. **P1-5 PG↔CH parity gate** — repair + CI-gate the parity harness.
9. **P1-7 CH escaper** — bind params + Zod caps.
10. **P1-17 / P1-18 / P1-19** — docker-build + gitleaks/trivy in CI; a real migrator with a tracking table; `/metrics` + Prometheus.
11. **P1-6** — give core-service a package surface + boundary conformance check.

### 61–90 days — prep the cutover (Founder/Rohan-gated)
12. **P0-2 live-DB RLS** — apply ENABLE+FORCE on every `workspace_id` table on live, provision a **non-owner** role, set the per-request GUC, run the deny-matrix against live. **The hard gate; nothing ships to prod before this.**
13. **P1-8 secret rotation + `AwsKmsCustody`** — Founder rotates the three vendor secrets; port the existing Python KMS custody to TS; boot guard refusing `local-aesgcm` in prod.
14. **P1-20 deploy path** — author the remaining CDK/k8s stacks so Stage-8 is a reviewed deploy, not greenfield.

**Clean separation:** Items 1–11 are pure in-repo engineering an engineer can start today. Items 12–14 are Founder/Rohan-gated (live-DB DDL, vendor-dashboard secret rotation, the deploy ceremony) and must not be done unilaterally.

---

## 6. To the Founder — Candid Opinion

Rishabh — the foundation you've built is genuinely good, and I want to be clear that the architecture, the tenant-isolation core, the money discipline, and Rohan's 8-wave readiness pass are real, verified strengths. This is not a rewrite situation; it's a finishing situation.

But Brain is **not** production-ready, and the gap is not where a dashboard demo would suggest. The product *looks* like it works — it loads, it doesn't crash, the numbers look authoritative. The problem is that several of those numbers are **silently wrong on the surfaces operators care about most**: the date-range picker is dead (every headline tile shows lifetime data for any window selected), there are three different "net revenue" figures, COD/Prepaid is all-zero, and Product Performance is showing exactly 2x revenue today. None of these throw an error — which is precisely why they're dangerous. An operator who trusts a wrong "this month CM2" makes a real spend decision on it.

**The biggest risk is not any one bug — it's that your test suite is telling you you're safe when you're not.** CI runs almost none of the suite, the live read path has zero behavioural coverage, and a today's-date migration re-opened a cross-tenant data leak *and* a 2x double-count that the readiness pass missed. That combination — silent correctness bugs plus a green CI that can't see them — is how a wrong number reaches a customer. Fix the test pyramid (30–60 day items) and these stop recurring.

My recommendation: hold the cutover. Spend the next month making the headline numbers correct and the safety net real (items 1–11, all in-repo). Treat the live-DB RLS rebuild as the absolute, non-negotiable gate it is. The product is closer than the bug list looks — but ship it with confidence in the numbers, not confidence in the demo.
