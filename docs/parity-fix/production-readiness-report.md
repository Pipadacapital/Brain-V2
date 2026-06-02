# Brain — Production-Readiness Report

**Date:** 2026-06-02 · **Author:** Lead Architect · **Audience:** Founder + Rohan (CTO Advisor)
**Scope:** 11 adversarially-verified dimensions against the live local production-shape stack (`brain_dev` PG + `brain` CH, gateway `READ_FROM_CH=true`, `BRAIN_GATEWAY_LOCAL_HARNESS=false`).

---

## 1. Headline Verdict

**Brain is NOT production-ready.** Verified totals after adversarial review: **15 P0**, **27 P1**, **19 P2** (61 findings).

The auth core, tenant-isolation RLS posture on the active connector path, and the structured-logging spine are genuinely solid. But the **analytics read path that every customer-facing dashboard depends on is broken in the live stack right now** — multiple pages return HTTP 500 to a real logged-in user (Sugandhlok / workspace `f165da80`), and the pages that *don't* 500 silently compute **wrong money** (₹0 COGS → CM1 = full revenue; doubled new-customer revenue; refunds ignored; COD/Prepaid all zeros).

**Single biggest blocker — the migration dropped the line-item→product join key (`vendor_product_id`).** `connector_line_item_facts(_hot)` in PG has no `vendor_product_id` column at all, and 100% of CH line items have `vendor_product_id=''`. This one data defect cascades into the majority of the P0s: it zeroes COGS / CM1 / CM2 / product performance / product cohorts / distributions across **every** workspace, AND its corresponding PG-fallback query references a column that does not exist, producing the live 500s on Products, Distributions, and the P&L period grid. Fixing the read-path SQL without first restoring this column just trades a 500 for a silently-wrong ₹0.

A close second is the **`decorateWithFinal` ClickHouse bug + silent `catch {}`** pair, which makes the entire CH read-flip silently dead on several surfaces (defeating the scale lever) and, via a JOIN that never gets `FINAL`, returns **2× new-customer revenue** on the acquisition page.

**Note on the standing OPEN-P0:** the live Supabase production DB has zero RLS (tenant isolation). That remains the gating security risk for any real cutover and is unaffected by this local prod-shape work.

---

## 2. P0 — Must Fix Before Production (15)

> Deduped. Several dimensions reported the same underlying defect; the canonical id is listed with cross-references.

| # | ID (dimension) | Issue | Fix | Verification |
|---|----------------|-------|-----|--------------|
| 1 | **`lineitem-vendor-product-id-dropped`** (migration-completeness) — *also surfaces as `pg-line-item-vendor-product-id-missing`, `empty-vendor-product-id-sku-degenerate-join`, `cogs-join-key-empty-zero-cogs-fabricated`* | Migration never carried `shopify_line_items.product_shopify_id` → `connector_line_item_facts(_hot)` has no `vendor_product_id` column (PG) and CH has it but 100% empty. Zeroes COGS/CM1/CM2, empties product performance + product cohorts. | Add `vendor_product_id` to PG hot DDL `apps/core-service/migrations/local-dev/05-schema-connector-facts.sql` + loader; carry `product_shopify_id`/woo `product_id` in the legacy→PG ETL; re-run `tools/migrate-legacy/phase8-ch-backfill.sql`. Until restored, make `readCogs`/`readCogsCH` return `cogsMu=null` + coverage flag (NOT `0n`). | `SELECT countIf(vendor_product_id!='') FROM brain.connector_line_item_facts FINAL` > 0; readCogsCH for `f165da80` returns `cogs>0, covered>0`; Products page non-empty; CM1 < net revenue. |
| 2 | **`pg-line-item-vendor-product-id-missing`** (readpath) — live 500 | PG fallback queries `li.vendor_product_id` (absent) in `fact-analytics.ts:274,333,367,375,1285,1373-1375,1549,1678` → 42703 INTERNAL_SERVER_ERROR on **catalog.products, marketing.distributions, pnl.periodGrid**. NOTE: `connector_product_facts` has NO `sku` column — the "join on sku" suggestion is invalid; join must be on `vendor_product_id` (after #1) or build a sku→vendor_product_id bridge. | In `apps/core-service/src/application/contexts/connectors/sync/fact-analytics.ts` make PG fallbacks valid against the real PG schema (no `li.vendor_product_id`); do not crash into PG when CH yields nothing — return honest-empty. | Click Products/Distributions/P&L-grid for `f165da80`; gateway logs show `ok:true`, no `vendor_product_id does not exist`. |
| 3 | **`ch-final-decorator-breaks-aliased-tables`** (readpath / perf) — *= `ch-final-decoration-breaks-aliased-reads`, `ch-final-decorator-syntax-error-aliased-fact-tables`* | `decorateWithFinal` inserts `FINAL` BEFORE the alias (`FROM brain.connector_order_facts FINAL AS o`) → CH Code 62 SYNTAX_ERROR. Breaks the CH path for cohorts(:477), distributions(:756), distributionsGraphPoints(:903), calendar(:963). 50 SYNTAX_ERRORs in live logs. | In `packages/lib-clickhouse-ts/src/index.ts:88-97` capture an optional alias and place `FINAL` after it: regex `($1)(\s+(?:AS\s+)?[A-Za-z_]\w*)?(?!\s+FINAL)\b` → `$1$2 FINAL`. Add unit tests for bare-alias, `AS`-alias, no-alias, and JOIN forms. | Run decorated cohorts/distributions/calendar SQL against CH → rows, not Code 62; `docker logs brain-api-gateway \| grep SYNTAX_ERROR` empty after clicks. |
| 4 | **`ch-final-not-applied-on-joins-doubles-acquisition-revenue`** (perf) | The regex matches only `FROM`, never `JOIN`. `readDailyAcquisitionCH` JOINs `connector_order_facts o` with NO `FINAL`; order_facts is 2× un-merged in CH → **doubled** new-customer revenue/CM2/CAC. Reproduced: nc_rev 3,975,174,272 vs correct 1,987,587,136 for `f165da80`. | Extend `decorateWithFinal` to also match `JOIN` and insert `FINAL` after the table name / before alias: `JOIN brain.connector_order_facts FINAL o`. Defense-in-depth: `OPTIMIZE TABLE brain.connector_order_facts FINAL`; fix double-ingest to UPSERT by `(workspace_id,vendor,vendor_order_id)`. | After fix nc_rev for `f165da80` = 1,987,587,136; decorate output contains `JOIN brain.connector_order_facts FINAL`. |
| 5 | **`distributions-500-vendor-product-id-pg-column`** (stub-elim) — *dedup of #2 for the Distributions surface* | marketing.distributions HTTP 500 on every load: CH path throws (FINAL bug), PG fallback (`fact-analytics.ts:1373-1375`) hits absent `li.vendor_product_id`. | Covered by #1 (restore column) + #2 (valid PG fallback) + #3 (FINAL). Also return `emptyDistributions` if both planes fail rather than throwing. | Reload Distributions for `f165da80` → 200 with rows; no `vendor_product_id` / Code 62 in logs. |
| 6 | **`pg-shipment-facts-table-missing`** (readpath) — *= `shipment-facts-missing-primary-workspace`* | `connector_shipment_facts` does not exist in PG (`to_regclass`→NULL). `readShipmentRows` has NO CH branch → **logistics.shipments 500 for every workspace**. `readPincodesCH` selects non-existent `delivery_city` → CH UNKNOWN_IDENTIFIER → PG fallback 500. CH shipment table has 0 rows for the anchor workspace. | Add `readShipmentRowsCH` mapping to REAL CH columns (derive status_bucket from `status`, use `is_rto`; COD/charge fields null/0); fix `readPincodesCH` to drop `delivery_city`; route `readShipmentRows` via `READ_FROM_CH` with honest-empty on failure; remove dead PG branches in `fact-analytics(-ch).ts`. Backfill CH `connector_shipment_facts` for ALL workspaces incl. Sugandhlok from legacy `shiprocket_shipments`. | `GET /trpc/logistics.shipments` & `logistics.pincode` for `f165da80` → `ok:true`; no 42P01 / UNKNOWN_IDENTIFIER; CH shipment count for `f165da80` > 0. |
| 7 | **`empty-payment-method-cod-prepaid-zero`** (readpath) | Migrated `payment_method` holds raw gateway strings (`''`,`cod`,`fkwcs_stripe`…) not `COD`/`Prepaid`; `is_cod` 0 for all. COD-vs-Prepaid, break-even, RTO-by-payment all zero/empty. RTO `by_payment_method` also hardcodes cod=0 in `readShipmentAnalyticsCH`. | Run migrated gateway names through the EXISTING `classifyPaymentMethod()` (`acl.ts:140`) and backfill `payment_method`='COD'/'Prepaid' + `is_cod` in PG `connector_order_facts(_hot)` + CH. Replace hardcoded 0s in `readShipmentAnalyticsCH` with real COD counts. In `getCodPrepaid`, set `connected=false` when cod+prepaid orders == 0. | `SELECT payment_method,count() ... GROUP BY` shows only COD/Prepaid; COD page shows non-zero orders/gross/RTO split for `f7f275b0` & `f165da80`. |
| 8 | **`order-total-refund-mu-zero`** (migration-completeness) | `connector_order_facts.total_refund_mu`=0 for all 85,447 orders though `connector_refund_facts` holds 17,547,353 MU for the anchor. Read path never joins refunds; the financial_status proxy is ALSO case-broken (stored UPPERCASE, filter lowercase) so 423 VOIDED/REFUNDED orders count as revenue. Overstates realized revenue/CM. | ETL: aggregate `connector_refund_facts(subtotal_mu+tax_mu)` by `(workspace_id,vendor,vendor_order_id)` → `connector_order_facts(_hot).total_refund_mu` + CH. Add a returns-by-date read and subtract in `readStoreSummaryCH`/`readPnlCH`. Fix case bug at `fact-analytics-ch.ts:44` (use `lower(financial_status)`). | `count(*) FILTER (total_refund_mu<>0)` ≈ 287 for anchor; CH `sum(total_refund_mu)` = 17,547,353; 423 VOIDED/REFUNDED excluded from realized. |
| 9 | **`cogs-settings-empty-and-product-cost-sparse`** (migration-completeness) | `workspace_cogs_settings` empty (0 rows) and only 213/981 products have `cost_mu`. NOTE: dominant cause of COGS=0 is the join key (#1), not the empty settings (legacy defaults are 0/0/0). | Primary: fix #1 join key. Secondary (parity, P2-ish): seed `workspace_cogs_settings`, backfill `cost_mu`, and apply override/fallback/markup bp in `readCogsCH` per legacy `cogs/resolve.ts`. | After #1, readCogsCH `cogs>0`; with fallback set, unmapped products use configured %. |
| 10 | **`no-production-credential-custody-backing`** (config-infra / secrets) — *= `local-aesgcm-custody-no-prod-guard`* | `selectCustody()` returns a throwing stub for `aws-secrets-manager`; only `local-aesgcm` (env-var AES key) works. No NODE_ENV guard → prod would seal live OAuth tokens with a static env key or break all connectors. *(Connector cutover is a documented HOLD → real severity P1, but listed here as a hard pre-cutover gate.)* | Implement `AwsKmsCustody` (Secrets-Manager + KMS envelope) in `apps/core-service/src/infrastructure/secrets/`, wire the `aws-secrets-manager` case; add a fail-closed boot guard (gate on a real-prod discriminator, NOT bare NODE_ENV — local stack runs NODE_ENV=production). Mirror in `apps/ingestion-service/.../app_secret_factory.py`. | `CONNECTOR_CUSTODY_BACKING=aws-secrets-manager` round-trips via KMS; boot refuses local-aesgcm in real-prod; local docker stack still boots. |
| 11 | **`shopify-oauth-secret-compromised-not-rotated`** (secrets) — *real severity P1; pre-cutover MUST* | Live `SHOPIFY_CLIENT_SECRET=shpss_e81b27f0…` (`.env.docker:28`, `apps/api-gateway/.env:27`) is declared compromised-by-exposure and not rotated; it is load-bearing in `provider-config.ts:156,210`. Not in git. | Rotate in Shopify Partner dashboard; put only the new value in Secrets Manager `brain/_app/shopify/hmac_secret`; rotate Meta + Google Ads secrets too (same exposure). | Old `shpss_` rejected (401/invalid_client) on token exchange; core-service boot reads new value from SM. |
| 12 | **`rls-staging-tables-no-isolation-cross-tenant-leak`** (tenant-isolation) — *real severity P1* | 9 `stg_*`/`tmp_*` tables hold multi-tenant data with NO RLS, readable by `rls_app` (`stg_ad`=16,937 rows / 4 workspaces). No live code path references them, but they violate the tenant-data invariant and are an exfil surface. | DROP after migration validation (teardown in `tools/migrate-legacy`), OR new migration `apps/core-service/migrations/local-dev/29-drop-or-protect-staging.sql` ENABLE+FORCE RLS + `REVOKE ... FROM rls_app`. Harden C3 gate to enumerate live `pg_class` tenant tables. | `SET ROLE rls_app; RESET app.workspace_id; SELECT count(*) FROM stg_ad;` errors/0; census of unprotected workspace_id tables = 0. |
| 13 | **`ci-blocking-gate-red-c4-settings-kwarg`** (tests-ci) | The single blocking CI job (`invariant-gates --with-behavioral`) is RED: commit 44b156c added `settings={"max_execution_time":30}` to `query_gateway.py:273` but test mocks reject the kwarg → 198/286 analytics tests fail, including the C4 cross-workspace tenancy net. CI cannot gate a merge; the #1 security suite is dark. | In `apps/analytics-service/tests/` change every mock `def _query(sql, parameters=None):` → `def _query(sql, parameters=None, **_kwargs):` (and `_query_unscoped`). | `cd apps/analytics-service && uv run pytest -q` → 0 failed; `run_conformance.py --with-behavioral` → PASS 14 FAIL 0, exit 0. |
| 14 | **`ci-no-unit-test-job`** (tests-ci) — *real severity P1* | CI never runs `turbo run test`/vitest/pytest — only conformance + tsc. api-gateway vitest suite is RED (3 stale tests) and would merge clean. Entire unit/integration surface ungated. | Add a blocking `unit-tests` job in `.github/workflows/ci.yml` running `turbo run test` (filter out web/mobile) + `uv run pytest`. First fix the 3 stale tests (`router.pnl.test.ts` 15-step waterfall + cumulative; `router.onboarding-sliceC.test.ts` redirect `/w/brand-a/dashboard`). | New CI job green/blocking; `pnpm --filter api-gateway test` → 0 failed. |
| 15 | **`pg-fallback-references-nonexistent-column-and-tables`** (resilience) — *umbrella dedup of #2/#5/#6* | Consolidated: the PG fallback / no-CH-branch paths reference `li.vendor_product_id` (28×), `connector_shipment_facts` (8×), `connector_email_send_facts` (4×) — none exist in PG → live 500s on 6 surfaces. | Resolved by #1, #2, #6, and `pg-email-send-facts-table-missing` (below). Universal rule: a missing-table read must degrade to honest-empty, never 500. | `docker logs brain-api-gateway \| grep -E "vendor_product_id does not exist\|connector_(shipment\|email_send)_facts.*does not exist"` returns zero new lines after clicking all 6 pages. |

---

## 3. P1 — Serious Risk / Missing Safety Net (27)

| # | ID (dimension) | Issue | Fix | Verification |
|---|----------------|-------|-----|--------------|
| 1 | `silent-catch-masks-ch-errors` / `ch-fallback-catch-swallows-all-errors-silently` / `silent-pg-fallback-hides-ch-failures` (readpath/resilience/perf) | ~18 bare `catch {}` in `fact-analytics.ts` swallow ALL CH errors — no log/metric/retry. Hid the FINAL bug for the whole rollout. | Replace each with `catch (e) { log.warn({err:e, fn, workspaceId}, 'CH read failed, PG fallback') }` (@brain/lib-logger) + a `ch_read_fallback_total` metric. Add a conformance test running each `readXxxCH` asserting no throw. | Stop CH, hit a CH page → structured warn with fn+workspace; metric increments. |
| 2 | `pg-email-send-facts-table-missing` (readpath) | `readEmailPerformance` reads PG `connector_email_send_facts` (absent) → lifecycle.emailSms 500. No CH branch. | Wrap `tx.query` and on 42P01 return `[]` → `emptyEmailSmsPerformance`; or add `readEmailPerformanceCH` + apply migration 12. | `GET /trpc/lifecycle.emailSms` → `ok:true` empty. |
| 3 | `saved-cost-stack-not-read-by-analytics` (stub-elim) | `workspace_costs`/`workspace_misc_expenses`/`workspace_cogs_settings` persisted but `getCostStack` returns static empty and P&L hardcodes `variable_costs=0n`/`misc=0n` → CM2/CM3 overstated once a user enters costs. | Add `readCostStack`; implement `LocalDbDataPlane.getCostStack`; feed `variable_costs_mu`/`misc_expenses_prorated_mu` into `getPnlStatement` (`local-db-data-plane.ts:335,350`) + `getCmWaterfall`; apply COGS settings in `readCogs`. | Insert cost+misc rows → Cost Stack & /pnl reflect them; CM2/CM3 drop. |
| 4 | `saved-festivals-not-read-by-calendar` (stub-elim) | `getFestivalCalendar` returns static empty; saved `workspace_festivals` never render on calendar/management page. | Implement `LocalDbDataPlane.getFestivalCalendar` to read `workspace_festivals` (active + year), map to `FestivalCalendarResult`, `peak_multiplier_bp = max(expected_multiplier_bp)`. | Create festival → rows render on Festivals + Calendar pages. |
| 5 | `team-changerole-manager-can-demote-owner` (authn-authz) | `team.changeRole` has no target-role guard → a MANAGER can demote an OWNER/ADMIN to VIEWER (workspace takeover). Bare `UPDATE`, no DB constraint. | Mirror `removeMember` guard in `make-team-router.ts`: fetch target, FORBIDDEN if target OWNER/ADMIN & actor ≠ OWNER. Defense-in-depth in core `changeTeamMemberRole`. | Negative test: MANAGER changeRole on OWNER → FORBIDDEN; role unchanged in PG. |
| 6 | `rls-raw-event-transform-state-not-forced` (tenant-isolation) — *real P2; consistency* | `raw_event_transform_state` is ENABLEd not FORCEd (only deviation). Not a leak for `rls_app` (non-owner), but breaks the FORCE-everywhere invariant. | Append `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` to migration `28-raw-event-transform-cursor.sql`. | `relforcerowsecurity`=t; census of enabled-not-forced = 0. |
| 7 | `no-metrics-emission-no-scrape-endpoint` (observability) | No prom-client/OTel; `/metrics` 404s → no SLO/alerting possible. | Add prom-client + `/metrics` in `server.ts`; emit `trpc_procedure_duration_ms`/`trpc_errors_total` from existing `tracingMiddleware`, `pg_pool_in_use`, `ch_query_duration_ms`. | `/metrics` 200 with histograms; `trpc_errors_total` increments on UNAUTHORIZED. |
| 8 | `pg-correlation-als-never-seeded-by-gateway` (observability) | Gateway never seeds `correlationStore`; DB reads run `requestId='unset'`; no `app.request_id`/`application_name` → pg_stat_activity uncorrelatable. | Wrap procedures in `correlationStore.run({requestId,traceId,...})` in `trpc.ts`; add `set_config('app.request_id',...,true)` + `application_name` in `withWorkspace`. | pg_stat_activity shows request_id during a read; `getCorrelation().requestId !== 'unset'`. |
| 9 | `no-uncaught-exception-or-error-reporting` / `no-process-level-crash-handlers` (observability/resilience) — *crash handlers P2; reporting+restart P1* | No `unhandledRejection`/`uncaughtException` handler; no Sentry; gateway `restart: no` → a crash stays down. | Register fatal-log + `process.exit(1)` handlers + SIGTERM drain in `server.ts main()`; add `restart: unless-stopped` to docker-compose; optional Sentry gated by DSN. | Throw off-request → fatal log + clean exit + container restart; health ok after. |
| 10 | `health-static-no-readiness-no-dep-check` (observability) | `/health` is static `{ok}` (never probes PG/CH); no `/ready`. Healthcheck stays green during a DB outage. | Add `/ready` probing PG `SELECT 1` + CH `SELECT 1` (via chQuery / a core pool-probe export), 503 on failure; point docker/K8s readinessProbe at it. | `/ready` 200 up; stop CH → 503 while `/health` stays 200. |
| 11 | `no-retry-circuit-breaker-on-ch` (resilience) — *P2* | No client request_timeout/retry/breaker on CH; a slow CH plane makes every read wait 30s before fallback. | Add client `request_timeout` (5-10s) in `lib-clickhouse-ts`; per-process circuit-breaker; reuse the fallback counter. | Delay CH → fails over within client timeout; breaker opens after threshold. |
| 12 | `ci-missing-pg-ch-drift-gate-adr-p0-4` / `no-fact-schema-ci-drift-gate` (tests-ci/config-infra) | No PG↔CH canonical-fact drift gate despite ADR P0-4. Live drift already exists (PG `total_discount_mu` vs CH `discount_mu`; PG missing `net_sales_mu`/`vendor_product_id`). | Author `docs/schema/canonical-facts.yaml` + `tests/conformance/check_fact_schema_drift.py` wired as a new Cn; assert PG cols == CH cols == registry + refund-name + subunit parity + non-empty `vendor_product_id` rate. | New check FAILS today on the divergence, PASSES after reconcile. |
| 13 | `ci-readpath-tested-only-via-stub` (tests-ci) | All router tests use StubDataPlane; the real `LocalDbDataPlane` (READ_FROM_CH) is untested — the live 500s have no test. | Add `*.integration.test.ts` under `apps/api-gateway/src/infrastructure` gated by `INTEGRATION_TEST=true` driving real PG+CH for `f165da80`; CI job with db services up. | Integration test for distributions/store/rto/pnl/ltv green; RED on the buggy alias. |
| 14 | `ci-empty-contract-e2e-load-suites` (tests-ci) | `tests/{contract,e2e,load}` are `.gitkeep` only; Playwright e2e (StubDataPlane) not in CI; no tRPC contract test. *(k6/load correctly deferred per scale plan.)* | Wire Playwright into CI against the real stack; add `tests/contract/router-shape.spec.ts` snapshotting tRPC I/O schemas; record load as a named HOLD. | New `e2e`+`contract` CI jobs green; router shape drift fails contract test. |
| 15 | `vendor-enum-still-live-blocks-100-integrations` (config-infra) — **Rohan contract sign-off** | `connector_vendor` is still a PG ENUM (7 values, 12 columns); integration #8 needs `ALTER TYPE`. | Author additive migration: ALTER each `vendor` column to TEXT, FK → `connector_definitions(vendor)`, DROP TYPE; replace static grants with ALTER DEFAULT PRIVILEGES. | `udt_name='connector_vendor'` count = 0; inserting a new vendor needs no `ALTER TYPE`. |
| 16 | `partial-boot-env-validation-silent-fallbacks` (config-infra) | Only SUPABASE_URL + Shopify validated at boot; `lib-clickhouse-ts` silently defaults to `localhost:8123`/`brain_app_pw`; Meta/Google fail at first callback. | Add a zod env-validator in `server.ts main()` (require DATABASE_URL, CLICKHOUSE_*, CONNECTOR_CUSTODY_*, Meta/Google when prod); throw instead of `??` defaults under real-prod. | Unset CLICKHOUSE_PASSWORD + prod → boot `exit(1)` with named var. |
| 17 | `iac-skeleton-no-compute-stacks` (config-infra) — **Founder/Rohan deploy gate** | CDK = 2 stacks (no VPC/EKS/DB/ALB); k8s empty; notifications/lifecycle have no Dockerfile. No executable path to prod. | Author remaining CDK stacks + k8s base/charts/argocd; add Dockerfiles; resolve core-service (in-process → drop CoreServiceTaskDefStack). | `cdk synth` covers all services; `docker build` per service; helm renders probes. |
| 18 | `cors-hardcoded-localhost-origins` (config-infra) | CORS allow-list hardcoded to localhost + `credentials:true`; prod web origin blocked. | Drive from `CORS_ALLOWED_ORIGINS` env (comma-split), fail-fast when prod + unset; never wildcard with credentials. | Set prod origin → preflight returns ACAO; localhost rejected; boot fails if unset in prod. |
| 19 | `python-ch-read-path-empty-mv-no-final` (config-infra) | `query_gateway.py` reads empty `workspace_daily_metrics_computed` with NO FINAL; `pylibs/brain_clickhouse` is a 4-line stub (no Layer-4/FINAL). Latent (services off). | Implement the pylibs gateway (FINAL + workspace_id) and route through it, OR add FINAL + apply+backfill the MV before enabling. | MV count > 0; query_metrics asserts no dup `(workspace_id,date)`. |
| 20 | `ci-c12-isolation-and-pool-tests-not-gated` (tests-ci) — *P2* | C12 deny-matrix `run.sh` + pgbouncer pool-isolation tests never run in CI. | CI job (postgres service) running `db-isolation/run.sh` + `INTEGRATION_TEST=true` pool tests; reference from conformance.yaml. | CI prints 11/11 deny-matrix exit 0; flip a grant → fails. |

> P1s #1–#20 dedup the 27 raw P1 findings across readpath/resilience/perf/observability/config/tests; the silent-catch and FINAL-related P1s recur in 3 dimensions and are counted once each.

---

## 4. P2 — Should-Fix Hardening (19, one-liners)

- `register-push-token-not-persisted` — `registerPushToken` returns success but writes to in-memory store; persist to a real `device_tokens` table.
- `submit-insight-response-decision-log-in-memory` — Decision Log votes go to `InMemoryDecisionLog`; persist to PG `ai.decision_log`.
- `saved-goals-not-read-by-goal-attainment` — `getGoalAttainment` static-empty; implement against `workspace_metric_goals`; remove orphan `settings.upsertGoal`.
- `rls-app-user-id-guc-never-set` — `audit_log`/`notifications` policies depend on never-set `app.user_id`; set it in `withWorkspace` (tables empty today).
- `lineitem-sku-sparse-no-fallback-join` — sku only 11% populated; do not use as join key, fix `vendor_product_id` instead.
- `supabase-key-naming-publishable-ok` — keys are publishable/anon (correct); add CI gitleaks rule to block service_role keys.
- `deleteworkspace-no-server-reauth` — destructive delete relies on client-only password confirm; add server step-up re-auth.
- `oauth-completecallback-no-membership-recheck` — `completeCallback` doesn't re-verify caller membership of the state-bound workspace.
- `fastify-res-log-statuscode-null` — every response logs `statusCode:null`; add onResponse hook logging `reply.statusCode`.
- `reqid-vs-request-id-divergence-on-clientless-calls` — Fastify `reqId` ≠ correlation `request_id` when header absent; share one source.
- `pg-fallback-fulltable-seqscan-store-tables` — store-table reads seq-scan; add `(workspace_id, processed_at DESC NULLS LAST)` index + keyset.
- `ch-order-facts-duplicate-versions-unmerged` — order_facts 2× un-merged; `OPTIMIZE ... FINAL` + data-quality `count()==count() FINAL` assertion.
- `read-from-ch-defaults-off-in-code` — `READ_FROM_CH` defaults OFF; make CH default in prod or require the var at boot.
- `mutable-base-image-tags-nonreproducible` — Dockerfiles use moving tags; pin to `@sha256` digests + Renovate.
- `next-public-api-url-defaults-localhost-build-arg` — web build-arg defaults to localhost; remove default + fail prod build if unset/localhost.
- *(plus the 4 already promoted into the P1 table where a P1 dimension downgraded them: crash-handlers, CH retry/breaker, C12 gating, raw-event FORCE — fix alongside their P1 siblings.)*

---

## 5. Recommended Fix Sequence

The dependencies are strict: **data first, then queries, then observability/CI, then infra.** Fixing read-path SQL before the migration backfill just converts 500s into silent ₹0s.

**Phase 0 — Unblock the merge pipeline (hours).**
1. P0 #13 `ci-blocking-gate-red-c4` (`**_kwargs` mock fix) — turns CI green so subsequent fixes can be gated.
2. P1 #14 — fix the 3 stale vitest tests; add the `unit-tests` CI job.

**Phase 1 — Migration completeness (data correctness foundation; unblocks ~9 P0s).**
3. P0 #1 — backfill `vendor_product_id` (PG hot DDL + ETL + `phase8-ch-backfill.sql`). *Unblocks COGS/CM1/products/cohorts/distributions.*
4. P0 #8 — aggregate refunds → `total_refund_mu` + fix the financial_status case bug.
5. P0 #7 — normalize `payment_method`/`is_cod` via `classifyPaymentMethod()`.
6. P0 #6 (data half) — backfill CH `connector_shipment_facts` for all workspaces incl. Sugandhlok.
7. P0 #9 (secondary) — seed `workspace_cogs_settings` + `cost_mu` coverage.

**Phase 2 — Read-path query fixes (now that data exists).**
8. P0 #3 + #4 — fix `decorateWithFinal` (alias + JOIN). *Unblocks CH cutover + fixes doubled acquisition.*
9. P0 #2 / #5 / #6 (code half) / #15 — make every PG fallback valid or honest-empty; add `readShipmentRowsCH`/`readEmailPerformanceCH`; fix `readPincodesCH`.
10. P1 #1 — replace bare `catch {}` with logged fallback + metric (do this WITH #8/#9 so regressions stay visible).
11. P1 #3, #4, #2 — wire saved cost-stack / festivals / email reads.

**Phase 3 — Security & isolation (pre-cutover gates).**
12. P0 #11 — rotate Shopify (+ Meta + Google) secrets.
13. P0 #12 + P1 #6 — drop/protect `stg_*` tables; FORCE raw_event_transform_state.
14. P1 #5 — team.changeRole guard.
15. P0 #10 — implement AwsKmsCustody + boot guard (before any live OAuth token).

**Phase 4 — Observability & resilience (before real traffic).**
16. P1 #7–#11 — /metrics, correlation ALS, crash handlers + restart policy, /ready, CH timeout/breaker.

**Phase 5 — Infra & CI hardening (before deploy).**
17. P1 #16, #18, #12 — boot env-validator, CORS env, fact-schema drift gate.
18. P1 #13, #14, #20 — integration/e2e/contract/deny-matrix CI jobs.
19. P1 #17, #15 — CDK/k8s buildout; vendor enum→TEXT.

---

## 6. Founder / Rohan-Gated Items

These cannot be unilaterally executed by an agent and require explicit Founder direction or Rohan (CTO Advisor) contract sign-off:

- **Live deploy / IaC stand-up** (P1 #17) — authoring + deploying CDK/k8s for production. Held at Stage-8.
- **Live Supabase RLS cutover** — the standing OPEN-P0 (production DB has zero tenant isolation). Brain-native RLS rebuild is Founder-gated; gates any real cutover.
- **`vendor` ENUM → TEXT** (P1 #15) — a typed-contract change; ADR-CONVERGENCE-001 ruling #1 explicitly flags **Rohan contract sign-off**.
- **Shopify/Meta/Google secret rotation** (P0 #11) — requires Founder access to the Shopify Partner / vendor dashboards and the prod Secrets Manager.
- **Connector cutover enablement** (P0 #10) — turning on live OAuth (and thus needing real custody) is a documented HOLD; do not enable until AwsKmsCustody ships.
- **Branch/merge to development/release/master** — per the feature-branch-only rule, all fixes land on `feature/<req-id>`; Founder reviews + merges every PR. Agent commits require explicit free-text "commit it".

---
*Severity legend: P0 = breaks a user-facing feature / data wrong / security hole · P1 = serious risk or missing safety net · P2 = should-fix hardening. Counts after adversarial review: 15 / 27 / 19 (some raw findings downgraded; cross-dimension duplicates merged).*
