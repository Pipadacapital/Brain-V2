# Brain — Technical Context (condensed primer)

> **Read this before writing code, designing a service, or reviewing a PR.** Every agent loads it at the start of every task. It is the agent-loadable condensation of `canon/technical-requirements.md` (Consolidated v2.1) + `canon/TECH/00–18`. **The canon folder is the only source of truth** — when this primer and the canon disagree, the canon wins (re-read `canon/technical-requirements.md` and the relevant `canon/TECH/NN_*.md`).
> **Building a feature? Start at `canon/IMPLEMENTATION-BLUEPRINT.md`** — the consolidated, implementation-oriented build bible (vision → architecture → ingestion → data → analytics → memory → agents → security → workflow → deliverables), indexed to this primer and the full canon. It sits *between* this primer and the deep-dives; the canon still wins on any conflict.
> Updated 2026-05-23.

---

## 0. The four obligations (everything serves these)

1. **Truth** — every number is auditable, reproducible, traceable to source events. **LLMs never invent numbers.**
2. **Memory** — every recommendation, action, response, and outcome compounds into the **Decision Log** + **Brand Fingerprint** (the moat).
3. **Execution** — Brain can recommend → queue → execute → reverse commerce actions, with guardrails.
4. **Profit quality** — surfaces privilege CM2/CM3, recovered revenue, reduced RTO/waste, retained customers over vanity metrics.

The single most important invariant: **most decisions run at SQL/ML cost; LLMs enter only at the human-language boundary.** This is what makes %-of-GMV pricing survive.

## 1. Build the contracts from day one; run the infra at the smallest footprint (TECH/00)

The **mature target stack** (Phase 3–4) is the destination. **Do not build all of it on day one.** Build the *invariants/contracts* now; graduate each *heavy infra layer* only when its trigger fires.

**Non-negotiable from day one (retrofitting these is brutal):**
1. `workspace_id` on every row/event/cache-key/log + Postgres RLS + ClickHouse query-gateway.
2. **Integer minor-units money** (BIGINT in PG, Int64 in CH) + `currency_code`. **Never float/NUMERIC for money.**
3. **Decision Log** append-only schema (`ai.decision_log`).
4. **Region-adapter interface** (even with only India implemented).
5. **Metric registry** with TS↔Python parity (one definition per metric).
6. **Cost-routing `@paradigm`** discipline + per-workspace LLM caps.
7. **OLTP/OLAP split** (Postgres + ClickHouse) — the analytics product needs OLAP from the first dashboard.
8. **Proto-defined gRPC contracts** for every bounded context (makes the later service split mechanical).
9. **Idempotency** on every connector write + mutating endpoint.
10. **Mobile Morning Brief** as the primary surface (Phase 1).

## 2. Stack snapshot (mature target)

| Layer | Locked choice |
|-------|--------------|
| **Monorepo** | Turborepo + pnpm (TS) · uv workspace (Python) · **Buf** (proto→TS+Python codegen) |
| **Web** | Next.js 16 App Router (React 19; Turbopack + React Compiler stable; Server Actions for mutations) · tRPC client · TanStack Query · nuqs · Redux Toolkit · shadcn/Tailwind · Recharts + Visx |
| **Mobile** | React Native + **Expo SDK 56** (New Architecture mandatory; Hermes v1) · Expo Router · Tamagui · victory-native · expo-secure-store · Expo Push · EAS |
| **Runtimes** | **Node.js 24 LTS** (TS services) · **Python 3.13** (data/ML/agents) · Kafka client = **@confluentinc/kafka-javascript** (KafkaJS is abandoned) · Prisma 7 |
| **Edge/API** | Fastify + tRPC (BFF) · **MCP server in api-gateway** · Zod |
| **Internal** | gRPC over Protobuf (buf) · Pydantic (Python) |
| **OLTP** | Postgres (Supabase) + pgvector |
| **OLAP** | ClickHouse Cloud (managed, ap-south-1) — Phase 0–3; graduate to **BYOC** (data plane in Brain's AWS account) at ~$6K/mo sustained compute or an in-account-residency contract; self-host only at Phase 4 |
| **Cache** | Redis (ElastiCache) |
| **Object store** | S3 |
| **Events** | Amazon MSK (Kafka) + Glue Schema Registry (Avro) + Debezium CDC |
| **Intelligence** | **LiteLLM gateway** (OSS, self-host on EKS, ap-south-1) → model-agnostic backends; **Claude is the default** (Sonnet 4.6 synthesis, Haiku 4.5 bounded NL) but each task routes to the cheapest model that passes its eval bar. Backend (Bedrock vs native direct clients) deferred + reversible behind the gateway · Prophet/sklearn/PyMC-Marketing/lifelines/XGBoost/statsmodels |
| **Infra** | EKS + Karpenter (Fargate early) · AWS CDK (TypeScript) · GitHub Actions → ECR → ArgoCD · **ap-south-1** |
| **Observability** | OpenTelemetry → CloudWatch/X-Ray · Sentry · PostHog · OpenSearch (logs) |
| **Secrets** | AWS Secrets Manager + KMS (envelope encryption of vendor tokens) |

> Stack is **LOCKED** (canonical resolutions in TECH/00 §5). Use [`tech-stack-evaluation`](../skills/tech-stack-evaluation/SKILL.md) *only* for a layer not in the stack (e.g., the AI-calling vendor — Bolna/Vapi/native, TECH/11 §5). Not Terraform/Pulumi; not Nx; not Zustand; not a separate vector DB.

## 3. The 7 backend bounded contexts — phased into deployables (TECH/00 §3, R11)

> **Full per-service operational spec** (responsibilities · boundary/ownership · internal modules · communication · data/event flow · scalability/deployment · security/tenancy · real-time · failure/retry — for every service, plus the cross-service comms matrix + end-to-end flows + forward extensions): **`canon/TECH/18_service_architecture.md`**. Read it before designing or changing anything that touches a service boundary.

The system is **always 7 logically-separate backend bounded contexts** (+ web + mobile), each its own DDD context with its own gRPC contract in `protos/` from day one. What changes by phase is **how many deployables they run as** — *logical separation now, physical separation later*.

| # | Service | Lang | Owns |
|---|---------|------|------|
| 1 | `api-gateway` | TS/Fastify | BFF: tRPC (web+mobile) + **MCP server**; auth + multi-tenancy + rate-limit choke point; gRPC fan-out. **No business logic / no AI orchestration here.** |
| 2 | `core-service` | TS/Fastify | Orgs, workspaces, users, roles, settings, costs, goals, integrations registry, consent, audit, **billing/metering**. OLTP. |
| 3 | `ingestion-service` | Python | Connector framework, sync, webhooks, canonicalization, raw archive, integration health. |
| 4 | `analytics-service` | Python | ClickHouse materializations, metric engine, RFM, lifecycle states, LTV, attribution, regional math, **Decision Log writes**. |
| 5 | `intelligence-service` | Python | Memory Layer (pgvector), the 15 AICMO/AICOO/AICFO agents, anomaly, forecasts, LLM orchestration, internal MCP tools. |
| 6 | `lifecycle-service` | Node (orchestration) + Python (RFM/LLM) | **[MOAT]** Audience builder, channel routers, AI calling, compliance engine, inbound inbox, recovered-revenue attribution. Phase-2 build. |
| 7 | `notifications-service` | TS/Fastify | Alerts, **Morning Brief assembly + delivery**, digests, push, exports, outbound webhooks. |

*(Plus `web` (Next.js, Ananya) + `mobile` (RN+Expo, Karan) — presentation only.)*

**Boundary resolution (R4):** `lifecycle-service` (revenue execution) is **distinct** from `notifications-service` (alerts/digests/push/exports).

**Phased deployables:** **Phase 0–1** = **3 backend deployables** — `edge` (Node: api-gateway + core) + `data` (Python: ingestion + analytics + intelligence) + web + mobile — on **ECS Fargate**, **MSK Serverless** (+ transactional outbox), managed ClickHouse, single region. **Phase 2–3** = split into the full 7 services; add `lifecycle-service`; migrate to **EKS + Karpenter**, provisioned **MSK** + Debezium CDC. Because gRPC contracts exist from day one, splitting is mechanical (flip in-process call → network call), not a rewrite. Graduate each heavy layer only when its **trigger** fires (TECH/00 §3.3).

**Communication (contract-first):** frontend → **api-gateway** only · gateway → services via **gRPC** · service ↔ service via **Kafka** events (versioned `.vN` + DLQ + retries). Services **never** call each other via REST and **never** share a database.

## 4. DDD by bounded context (mandatory — code-review blocker if violated)

Every backend service is organized **by domain**, never by technical layers. Layering inside each service:
`bootstrap/` (server wiring, DI, config, health probes) · `domain/` (entities, value-objects, aggregates, domain events, policies — pure) · `application/` (use-cases / commands / queries (CQRS), orchestration) · `infrastructure/` (repositories, gRPC clients, Kafka producers/consumers, DB, external APIs) · `interfaces/` (gRPC handlers / tRPC routers / Kafka consumers / HTTP). **A `controllers/`-style technical-layer folder is a blocker.** See [`domain-driven-design`](../skills/domain-driven-design/SKILL.md).

## 5. Multi-tenancy & RBAC — `workspace_id` is law (enforced at 4 layers)

Hierarchy: **Organisation → Brand/Workspace → Store/Channel/Integration → records.** Workspace = tenant = brand = billing unit.

1. **JWT** (Supabase) carries `user_id`, `active_workspace_id`, `role`, accessible-workspace list.
2. **api-gateway** validates JWT; propagates `workspace_id`/`user_id`/`request_id` via gRPC metadata; `requireRole(ctx, ws, minRole)` on **every mutation**.
3. **Postgres RLS** on every workspace-scoped table (`workspace_id = current_setting('app.workspace_id')`).
4. **ClickHouse query gateway** (`pylibs/brain_clickhouse`) rejects any query lacking a `workspace_id` predicate. Redis keys + S3 paths workspace-scoped. Kafka consumers assert `workspace_id` from the envelope.

**5 canonical roles (R2):** `viewer`(1) → `analyst`(2) → `agency`(3, scoped+tagged) → `operator`(4) → `owner`(5). Approval matrix per action class enforced in `application/` use-cases. Auth: email/password, magic link, Google OAuth, SSO/SAML + SCIM (enterprise). Web: HttpOnly cookies. Mobile: refresh token in expo-secure-store, access token in memory.

## 6. Data model

### Postgres (OLTP) — bounded-context schemas (R3)
`core`, `ai`, `lifecycle`, `support`, `billing`, `audit` (+ Supabase `auth`). Every workspace-scoped table has `workspace_id` + RLS. **Money = BIGINT minor units + `currency_code`.** Historical facts live in ClickHouse; Postgres keeps a **90-day hot mirror** for fast joins + webhook reconciliation. OAuth tokens via **KMS envelope encryption** (only a `credential_secret_arn` in `core.integrations`; plaintext never logged).

**`ai.decision_log` (the moat)** — written before any recommendation is displayed; updated on approve/edit/execute/reverse; nightly 7d/30d outcome backfills. Key fields: `workspace_id, agent_group, agent_name, decision_type, action_type, status` (proposed/approved/rejected/edited/queued/auto_executed/blocked/executed/reversed/failed/observed), `priority_score, confidence, risk_level, reversibility, channel, title, explanation, input_snapshot, evidence_refs, proposed_action, expected_impact, user_response, executed_action, reversal, outcome_7d, outcome_30d, attributed_revenue_minor, attributed_cm2_minor, recovered_revenue_*_minor, learning_note`. **A workflow that cannot write here is not a Brain action.** Memory: `ai.brand_fingerprint` (16-dim daily vector), `ai.condition_outcome` (pgvector), `ai.cross_brand_pattern` (k≥5 anonymity), `ai.auto_execute_policies/log`. Billing: `billing.gmv_meter` (placed/realized/billable GMV), `billing.invoices`, `billing.usage_passthrough`, `billing.plan`.

### ClickHouse (OLAP)
`ReplicatedMergeTree` family; `Distributed` over `cityHash64(workspace_id)`; ordering key **leads with `workspace_id`**; `ReplacingMergeTree(version)` for late-data dedup (read with `FINAL`); `LowCardinality(String)` for repeated values; money = Int64 minor units. Raw facts (`raw_orders`…, append-only mirror, ZSTD + SHA-256), canonical facts (`orders`, `line_items`, `order_costs`…), derived aggregates (`daily_metrics` master, `customer_states`, `cohort_aggregates`, `pincode_reliability`, `festival_lift_factors`…). MVs for simple aggregates; scheduled Python rollups for join-heavy metrics (MER/aMER/CM2). Query gateway rejects any query missing `workspace_id =`. `max_execution_time = 30s` for dashboard reads.

### Redis (ElastiCache)
Hot metric cache (~60s TTL), sessions, rate-limit (sliding window), idempotency keys (24h TTL), feature flags. A cached metric is an LLM/ClickHouse call you didn't pay for (cost lever).

### S3 lifecycle
Raw payloads 90d → Glacier → delete 7y; exports 30d; Kafka tiered storage; call recordings 1y per-brand KMS key; audit mirror.

## 7. Event spine — Kafka (MSK)

Topic `<domain>.<entity>.<event>.v<n>`; **partition key = `workspace_id`** (per-workspace ordering, required for version-based dedup); Avro schemas in `protos/events/` + Glue Schema Registry. Standard envelope: `event_id, event_type, workspace_id, occurred_at, produced_at, producer_service, trace_id, schema_version, idempotency_key, payload`. **Retention:** raw integration + Decision Log topics = **infinite** (MSK tiered storage → S3); transient (sync/digest) = 30–90d. Backward-compatible changes within `.vN`; breaking → `.v(n+1)` + dual-write. Every consumer idempotent (envelope `idempotency_key` + ClickHouse version dedup) + DLQ + replay tool. **Phase 0–1:** MSK Serverless + transactional outbox; Debezium CDC + provisioned MSK graduate per TECH/00 triggers.

## 8. Metric engine & region adapters

**Metric registry is the single source of truth** — one definition computed identically in TS (`packages/lib-metrics`) and Python (`pylibs/brain_metrics`); **CI enforces parity.** No metric defined twice; LLMs never produce metric numbers. **GST/VAT extracted per line item by SKU slab** via `RegionAdapter.extract_net_revenue()` — India GST 2.0 slabs **0/5/18/40** (never a single blended rate). Realized/Delivered Revenue is the honest number **and the billing base**.

**`RegionAdapter` interface** (TECH/04): `extract_net_revenue` (per-SKU tax), `classify_payment_method`, `is_high_risk_payment`, `map_shipment_status`, `compute_logistics_cost`, `normalize_postal_code`, `postal_code_metadata`, `get_seasonal_events`, `tax_reconciliation_report`, currency/timezone. `get_adapter(region)` in `pylibs/brain_regional`. **India implemented first** (GST 2.0 per-SKU, INR lakh/crore, COD/prepaid fees, RTO cost model + state machine, pincode reliability ≥5 shipments, NDR, festival calendar + learned lift, DLT/NCPR/9am–9pm/WhatsApp opt-in). **UAE/GCC = Phase 4** (per-country VAT, AED/SAR, Ramadan/Eid, Arabic/RTL, Tabby/Tamara, cross-border duties, PDPL). Adding a region = new adapter + seasonal seed + tests; the metric engine/frontend/intelligence/notifications need **zero** changes.

## 9. AI / LLM layer & cost-routing (the engineering invariant)

| Paradigm | Relative cost | When |
|----------|--------------|------|
| 1. **SQL** | ~1 ($0) | Any deterministic computation over structured data — metrics are always SQL. |
| 2. **ML** (sklearn/Prophet/lifetimes/pgvector) | ~100 | Patterns exist but rules don't (forecast, LTV, RTO risk, anomaly, response modelling). |
| 3. **Haiku** | ~1,000 | Bounded NL (intent classification, message personalization, single-doc summary). |
| 4. **Sonnet** | ~10,000 | Multi-step reasoning / synthesis across many docs (the Morning Brief synthesis step). |

**Cost ratio ≈ 1 : 100 : 1,000 : 10,000.** Every endpoint/agent declares `@paradigm("sql"|"ml"|"small_llm"|"frontier_llm")`; **CI/PR blocks** if a cheaper paradigm would suffice (paradigm bypass = anti-pattern). **Paradigms 3/4 are model-agnostic** — the decorator names a routed *policy tier*; the **LiteLLM gateway routes to the cheapest model that passes that tier's eval bar** (small → e.g. Nova/Gemini-Flash-Lite/Haiku; frontier → Claude Sonnet default, eval-gated + swappable). Three enforcement layers: default routing (gateway) · per-feature token budget (soft 80% / hard 100% → degrade) · per-workspace monthly cap as **gateway virtual-key budgets** (soft 70% throttle non-critical / hard 100% critical-path only: Morning Brief, NL query, ticket resolution). **Target mix: 85% SQL · 12% ML · 2.5% small-LLM · 0.5% frontier-LLM.** Prompt caching is the biggest LLM cost lever, kept on the frontier backend (Brand Fingerprint queries, Decision Log context). **Model swaps are eval-gated (`llm-evals`) — no model serves a tier until it passes.**

**15 product agents** in `intelligence-service` — AICMO(8): Meta, Google, TikTok(GCC), Snap(GCC), Cross-Channel, Creative, Pricing, Festival · AICOO(4): Logistics, Returns, Inventory, Marketplace · AICFO(3): Conversion, Cashflow, Pricing-Margin · + AI CX. Each: daily-tick + memory query + paradigm-appropriate model + Decision Log write + `@paradigm`/`@mcp_tool` decorators + graduation tracker. **Daily Intelligence Loop (SLO-critical):** 06:55 freshness → 07:00 Brand Fingerprint (SQL+numpy) → 07:05 memory query (pgvector) → 07:10 agents in parallel → 07:15 **Morning Brief synthesized by Sonnet** (the only frontier-LLM step) → push 07:00–09:00 IST · 18:00 Evening Pulse · 23:55 7d/30d outcome attribution. **SLO: Morning Brief delivered by 07:20 IST on >99.5% of days.** **Sale/Event Mode** = a higher-cadence configuration of the same primitives (hourly Path-A rollup + ML anomaly + Sonnet only at digest), with the margin-trap alert (CM2 below threshold even as revenue rises).

**Auto-execute (Phase 3):** OFF by default; Owner enables per action class. Initial actions + confidence: pause ad 0.90 · reduce budget ≤X% 0.85 · abandoned-cart discount 0.80 · lifecycle send 0.85 · courier switch 0.85 · replacement-under-policy 0.90 · refund-under-cap 0.95 (irreversible → Owner) · draft PO 0.90. Guardrails: caps, consent/policy/freshness checks, **global+per-action kill switch (Owner pauses all in 60s)**, **auto-revert to recommend-only** if reversal/error rate crosses threshold, Decision Log + audit per action, per-tool per-brand **graduation**.

## 10. API contracts (TECH/06)

**tRPC** (web+mobile, same router; mobile additive: `registerPushToken`, `app.minVersion`, `featureFlags`); procedure tiers `public → authed → workspace → owner`; **cursor pagination (OFFSET banned in prod)**; money fields `bigint` minor units + `currency_code` (superjson); SSE/WS for AI chat + live dashboards. **gRPC** (internal, buf): `WorkspaceService`, `MetricsService` (incl. `StreamMetricUpdates`), `IntelligenceService` (incl. bidi `Chat`), `NotificationsService`, `IntegrationsService`, `LifecycleService`; metadata `x-workspace-id/x-user-id/x-request-id/x-traceparent`; `TenancyInterceptor` rejects missing workspace. **MCP** in api-gateway (shares auth/tenancy/rate-limit; tool schemas generated from the **same protos** — cannot drift); read tools + action tools; **every write tool auto-writes Decision Log via middleware**; default read-only, write needs Owner/Operator. **Public REST** (Phase 4) = thin tRPC adapter; hashed tokens + HMAC webhooks.

## 11. Integrations (TECH/02)

One `Connector` interface; **backfill == live (only the window changes).** `authenticate / refresh_token / sync(window) / receive_webhook / canonicalize / health_check`. Each fans out to S3 raw + ClickHouse raw + Kafka `integrations.*.v1` + (Phase 0–1) Postgres 90-day mirror. Idempotent (UPSERT on payload hash; ClickHouse `ReplacingMergeTree(version)`). Watermarks + per-connector late-data window (Shopify 60d, Meta 28d, Google 7d, Razorpay 30d). **Quality levels:** Green (clean API), Yellow (gated/per-brand onboarding), Red (no API → Gmail/PDF/CSV + LLM extraction + 1h breakage alert + explicit UI label). **P0 connectors alert at freshness > 60 min.** Agents degrade gracefully and label stale data. **TikTok Ads is region-gated (UAE/GCC only — banned in India).** Onboarding data-quality gate (TECH §7.5): reports labelled "estimated" until order/ad reconciliation + **≥80% SKU-cost coverage** + identity-join + tz/currency/tax + consent pass.

## 12. Frontend & mobile (TECH/07, TECH/10)

**Web:** Next.js 16 App Router (React 19; Turbopack + React Compiler stable — manual `useMemo` largely optional; Server Components default + Server Actions for mutations; Client Components for interactive charts/filters/chat); `createCaller()` server-side tRPC; state = TanStack Query (server) + nuqs (URL filters/date) + Redux Toolkit (UI/chat/drilldown); shadcn + Tailwind tokens; Recharts + Visx (waterfall, cohort heatmap); currency-aware `formatMoney` (₹ lakh/crore vs locale); region-aware routing. **Magic UI** (copy-paste, Tailwind + Motion; same shadcn ecosystem, zero runtime dep) is scoped to **marketing / onboarding / login / empty-state / delight surfaces only — NOT the dense operator workbench** (dashboards stay shadcn + Visx/Recharts within the perf budget), respecting `prefers-reduced-motion` + WCAG AA. Perf budget LCP<2s, INP<200ms, CLS<0.1, route JS<100KB; WCAG AA. Hosting: managed (Amplify) Phase 0–2 → EKS Phase 3.

**Mobile — the Morning Brief IS the product:** RN + Expo, Expo Router tab nav; the **Morning Brief screen is the highest-quality UI in Brain** (three signals, approve/reject/edit, three-minute thumb-first 06:55–09:00 IST flow). Phase 1 read-only + push → Phase 2 chat + approvals + biometric → Phase 3 plan/pincode → Phase 4 widgets/watch. Refresh token in `expo-secure-store`, access token in memory; magic-link deep links; **cert pinning** (current + rotation pin); **MASVS L1 + key L2**; Expo Push (APNS+FCM); offline: online-only Phase 1 → cached reads Phase 2 → optimistic queue Phase 3. EAS Build + OTA (JS-only) vs store review (native bump). Desktop-only views (cohort heatmap, waterfall, COGS bulk editor) link out gracefully.

## 13. Security, privacy & compliance (TECH/09, TECH/16)

**Never store:** card numbers, CVV, full UPI IDs, full bank accounts, plaintext passwords, national IDs (Aadhaar), special-category data, full customer addresses unless explicitly required+approved (default **pincode/city-level**), PII in logs. **PII handling:** hash email/phone by default; plaintext only where outreach enabled + consent/legal basis exists; redaction at logger + Fluent Bit; per-workspace KMS; recordings only with consent; **India data in-region (ap-south-1) by default** (DPDP + KSA/UAE transfer restrictions).

**Applicable regimes (consolidated — TECH/16):** India **DPDP Act 2023 + Rules 2025** (phased to ~May 2027; consent-based, minimization, retention limits, erasure, breach notification; Consent-Manager-compatible ~Nov 2026) · India **TCCCPR 2018 (amended 12 Feb 2025)**: **DLT** registration for A2P SMS/voice, **NCPR/DND** scrubbing, **9am–9pm** promotional window · UAE **PDPL** (45/2021) & KSA **PDPL** (enforced Sep 2024): explicit revocable opt-in, erasure, cross-border restrictions · **Channel-specific outbound:** WhatsApp = Meta opt-in + approved templates + free service window (24h customer-service reply; 72h ad-click entry-point) + per-message pricing by category (India marketing ≈ ₹0.86 as of Jan 2026); SMS/voice = DLT + NCPR/DND + calling hours (note: TRAI is tightening AI-telemarketing rules); AI voice = disclosure + human handoff. Consent primitive: per customer/channel/purpose/source/timestamp/region/withdrawal (append-only; opt-out overrides all marketing). Cross-brand benchmarks aggregate-only, k≥5, opt-in. **Compliance SLO: 0 DND/out-of-window violations, 0 cross-brand leaks.**

> **Shreya VETO** on any CRITICAL/HIGH security finding, any compliance violation (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent), or **missing traceability**.

## 14. Observability & SLOs (TECH/09)

One correlation ID — `request_id` + `trace_id` + `workspace_id` + `user_id` — propagates **HTTP headers → gRPC metadata → Kafka envelope → LLM call**. Stack: OTel → CloudWatch/X-Ray, Sentry, PostHog, OpenSearch (PII-redacted). Track API p50/95/99, error rate, Kafka lag, connector freshness, CH query duration/bytes, Redis hit-rate, **LLM tokens/cost by workspace+feature**, agent run success, Decision Log write success, auto-execute count/failures/reversals, WhatsApp delivery/reply/conversion, ticket FRT/CSAT, **DND/compliance violations**.

| SLO | Target |
|---|---|
| P0 integration freshness | < 1 hour |
| Cached dashboard p95 | < 500ms |
| API p95 | < 2s |
| **Morning Brief delivered** | by **07:20 IST, >99.5% days** |
| Decision Log write availability | > 99.99% |
| Agent daily run success | > 99% |
| Cross-brand leaks / compliance violations | **0** |
| Auto-execute reversal rate | < 8% (alert 15%) |

## 15. Definition of Done (Tanvi + CTO Advisor gate on this)

A task is **done** only when it: uses Brain-only language · carries `workspace_id` isolation (4 layers) · reuses shared primitives (no per-channel forks) · **writes to Decision Log** if it's a recommendation/action/lifecycle-send/support-resolution/outcome · has RBAC checks (`requireRole` on mutations) · declares its **`@paradigm`** · uses **minor-units money** · handles regional behavior via **adapter** · has tests for success + permission-failure + stale-data + provider-failure + idempotency · emits structured logs + metrics with the **correlation ID** (trace-instrumented end-to-end) · degrades gracefully on missing/stale data · has reversal/rollback where possible · is documented for the next builder. Real-network smoke is mandatory for PASS; metric-registry TS↔Python parity preserved; mutation tests on high-stakes paths (metric registry, compliance engine, Decision Log).

## 16. Anti-patterns to reject (code-review blockers — TECH §26)

Per-channel audience/consent/attribution/profile fork · agent recs without Decision Log · lifecycle sends without attribution · **LLM-generated metric numbers** · region-specific forks of metric code · **NUMERIC/float money** · single blended tax rate (must be per-SKU slab) · billing on placed (not realized) GMV · integration "healthy" because auth works but data is stale · auto-execute without kill switch · **frontier-LLM where SQL/ML suffices (paradigm bypass)** · `controllers/`-style folders · **OFFSET pagination in prod** · cross-brand data visible to another brand · sequential DB queries in a layout (use `Promise.all`) · service-to-service REST (gRPC sync / Kafka async).

## 17. How Brain is built — the Engineering OS (TECH/17)

You are the **Engineering OS** — the AI team that builds Brain. **These Brain-docs ARE Brain's approved Phase-0 foundation** (`business-requirements.md` = BRD; `technical-requirements.md` + `TECH/` = the knowledge-base). The recurring **8-stage pipeline**: 1 intake+brainstorm (Rohan +0–2 personas) → 2 binding plan (Aryan, `06-architecture-plan.md`) → 3 build (devs, trace-instrumented) → 4 security review (Shreya **VETO** on CRITICAL/HIGH + compliance + missing traceability) → 5 QA (Tanvi **VETO** on missing real-network verification + metric-registry parity + trace IDs end-to-end) → 6 final review (Rohan **VETO**) → 7 deploy gate (Founder `/approve`) → 8 deploy + 48h monitor + auto-rollback (Jatin). **Plan-binding:** stages 3–8 execute the Stage-2 plan; deviations route through Aryan's amendment loop — never freelancing. **PLAN-phase web research** (WebSearch/WebFetch) is allowed in Stage 1–2 (and Phase 0) only — a build-time fact that would change the design routes back through Aryan, never an ad-hoc drift. **Escalation is Rohan-gated, last-resort** (`/escalate` → Founder `/decide`). The product's 15 agents (AICMO/AICOO/AICFO) are **not** this 11-agent build team — never conflate them.

## 18. When in doubt

1. Re-read this primer. 2. Open `canon/technical-requirements.md` + the relevant `canon/TECH/NN_*.md` (the source of truth). 3. Open the relevant skill (see [skill-mapping-matrix.md](skill-mapping-matrix.md)). 4. PLAN-phase: WebSearch/WebFetch to validate a market/stack/compliance fact. 5. Escalate to **Aryan** (architecture), **Shreya** (security/compliance), **Rohan** (priorities/cross-team), **Founder/Rishabh** (changing the stack or a non-negotiable).
