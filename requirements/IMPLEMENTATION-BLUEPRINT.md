# Brain — Implementation Blueprint (the build bible)

> **Purpose.** This is the **single, implementation-oriented source of truth** the engineering team — and the Engineering-OS agents/plugins — reference continuously while building **Brain**, so no build deviates from the product vision, architecture, or business goals. It consolidates and operationalizes the canon: the **BRD** (`business-requirements.md`), the **TRD** (`technical-requirements.md`), and the **18 deep-dives** (`TECH/00–18`).
>
> **Authority & deference.** This blueprint is a *derived consolidation*. **The canon is the only source of truth.** When this document and the canon disagree, **the canon wins** — re-read `technical-requirements.md` and the relevant `TECH/NN_*.md`. Every section below cites its canonical home (`[TECH/NN §x]`) so you can drill to the authoritative detail. Nothing here introduces new architecture; it indexes, sequences, and makes buildable what the canon already decided.
>
> **How to read it.** §0 is the canon map + the four obligations. §1–§13 mirror the build domains end-to-end. The appendices are the phase roadmap, the day-one non-negotiables, the anti-patterns, and the Definition of Done — the things every PR is checked against.
>
> Version 1.0 · Aligned to canon as of 2026-05-23 · Plugin v0.23.0.

---

## 0. How to use this document

> **⚠️ Token discipline — do NOT load this file whole.** It is ~23K tokens; loading all of it on every agent turn is the single largest avoidable cost in the build pipeline. Treat it as a **targeted index**: read this §0 map, then open **only** the one section you need (by line range / `grep`). Each `§` is self-contained and cites its canon home. The condensed primers (`business-context.md`, `technical-context.md`) remain your default context — come here only for a specific build domain, and take only that domain.
>
> **Section map** (open exactly one): §1 Vision & business · §2 System architecture · §3 Ingestion · §4 Data platform/storage · §5 Analytics & intelligence · §6 Memory · §7 Agentic AI · §8 Users/orgs/permissions · §9 Engineering standards · §10 Observability · §11 Security · §12 Workflow validation · §13 Deliverables (stack/infra quick-ref) · App A roadmap · App B graduation triggers · App C day-one non-negotiables · App D anti-patterns · App E Definition of Done.

### 0.1 The canon map (where authoritative detail lives)

| Doc | Owns |
|---|---|
| `business-requirements.md` (BRD) | What Brain is, ICP, pillars, metrics-that-matter, surfaces, pricing, roadmap, risks |
| `technical-requirements.md` (TRD) | Consolidated technical spec + global Definition of Done (§25) + anti-patterns (§26) |
| `TECH/00` | Tech-stack decisions, R1–R11 resolutions, graduation triggers, day-one non-negotiables, monorepo layout |
| `TECH/01` | Data architecture — Postgres/ClickHouse/Redis/S3 schemas, money, RLS, retention, DR |
| `TECH/02` | Integrations — connector framework, OAuth, webhooks, quality tiers, rate-limit, DLQ |
| `TECH/03` | Metric engine — registry, Path A/B, CM waterfall, MER/aMER, LTV, RTO formulas |
| `TECH/04` | Region adapters — `RegionAdapter` interface, India impl, GST/VAT, festivals |
| `TECH/05` | Intelligence layer — Memory Layer, ML models, forecasting, anomaly, daily tick |
| `TECH/06` | API contracts — tRPC tiers, gRPC services, MCP, public REST, error codes |
| `TECH/07` | Web frontend — Next.js, state, charts, Magic UI scope, perf budget |
| `TECH/08` | Alerts & reporting — Morning Brief, Evening Pulse, digests, exports |
| `TECH/09` | Security & observability — auth, encryption, OTel, SLOs, incident, health probes |
| `TECH/10` | Mobile — RN/Expo, Morning Brief surface, push, offline, cert pinning, MASVS |
| `TECH/11` | Lifecycle revenue layer (the moat arm) — audience builder, channels, compliance engine, AI calling, tickets |
| `TECH/12` | Cost-routing compute — the 4 paradigms, enforcement layers, LiteLLM gateway |
| `TECH/13` | MCP protocol — tool namespaces, scoping, Decision-Log middleware, versioning |
| `TECH/14` | Agent roster — the 15 product agents, base class, graduation, orchestration |
| `TECH/15` | Billing & metering — GMV meter, tiers, CM2 guardrail, pass-through |
| `TECH/16` | Compliance engine — DPDP/PDPL/DLT/NCPR, consent primitive, calling hours |
| `TECH/17` | Engineering OS — the 8-stage build pipeline, plan-binding, Phase-0 foundation |
| `TECH/18` | **Service architecture** — per-service spec across 9 dimensions, comms matrix, E2E flows, forward extensions, service-readiness DoD |

> Day-to-day, agents load the two **condensed primers** (`docs/business-context.md`, `docs/technical-context.md`) at session start. This blueprint sits *between* those primers and the full canon: deeper than a primer, navigable as one document, always pointing back to canon for the last mile.

### 0.2 The four obligations (everything serves these) — [TRD; technical-context §0]

1. **Truth** — every number is auditable, reproducible, traceable to source events. **LLMs never invent numbers.**
2. **Memory** — every recommendation, action, response, and outcome compounds into the **Decision Log + Brand Fingerprint** (the moat).
3. **Execution** — Brain can recommend → queue → execute → reverse commerce actions, with guardrails.
4. **Profit quality** — surfaces privilege CM2/CM3, recovered/protected revenue, reduced RTO/waste, retained customers over vanity metrics.

**The master invariant:** *most decisions run at SQL/ML cost; LLMs enter only at the human-language boundary.* This is what keeps **%-of-GMV pricing** viable, so it governs every design choice in this blueprint.

---

## 1. Product Vision & Business Context — [BRD; business-context]

### 1.1 What Brain is

Brain is the **AI-native commerce operating system for DTC brands** in **India (launch market), UAE, and GCC**. It is the surface a founder/operator opens repeatedly because it shows **live revenue movement, margin quality, leaks, recovery opportunities, customer risk, and executable next actions** — and then *acts* on them under guardrails.

Brain is **not** a passive dashboard, a chatbot-with-data, a helpdesk wrapper, a WhatsApp blaster, a generic CRM, a per-seat SaaS, or an ERP. The promise is not "better reporting." It is:

> Brain helps DTC brands **grow realized revenue, recover lost revenue, protect contribution margin, and compound decision quality** across marketing, lifecycle, support, logistics, inventory, and finance.

**Ship gate:** a feature ships only if it ties to one of — revenue made/recovered/protected · profit (CM2/CM3/cash) · risk reduction · operator time saved · compliance · decision memory. If it can't, it doesn't ship.

### 1.2 Long-term product vision & platform evolution

Brain climbs a deliberate ladder from **sense-making → recommendation → safe autonomous execution**, market by market, while the *contracts* (multi-tenancy, money, Decision Log, metric registry, paradigm routing, region adapter, proto gRPC) stay fixed from day one so the heavy infrastructure can graduate underneath without rewrites. The evolution is encoded as the **phase roadmap** (Appendix A) and the **graduation-trigger model** (Appendix B): build the seam now, adopt the heavy layer only when its trigger fires (knowledge graph, feature store/MLflow, durable workflow engine, EKS, provisioned MSK, multi-region — all deferred-until-trigger, never gaps).

The end-state is a multi-region, multi-tenant operating system where the **Memory Layer** (Brand Fingerprint + condition→outcome history + cross-brand patterns) makes each brand's recommendations sharper over time, and **agentic execution** handles the low-risk, reversible, capped, outcome-tracked long tail — always with a human gate and an Owner kill switch.

### 1.3 Core business objectives — the five non-negotiable outcomes

Every builder optimizes for: (1) **revenue booked**, (2) **profit protected**, (3) **decision quality improved** (logged condition→action→outcome), (4) **operator time compressed**, (5) **safe execution** (recommend → queue → execute → reverse → audit, with guardrails).

**The Brain loop** (the product's heartbeat): Sense → Normalize → Detect → Decide (rank by expected CM2 impact, urgency, confidence, reversibility) → Act (recommend/queue/execute w/ guardrails) → Log (Decision Log) → Learn (Brand Fingerprint).

### 1.4 Target users and organizations (ICP) — [BRD §3]

DTC brands in India/UAE/GCC with real volume + margin pressure + multi-tool complexity. **Hard floor: ₹50L/month GMV** (or local equivalent); ₹25L–₹50L case-by-case.

| Tier | GMV band | Team shape | Buying trigger |
|---|---|---|---|
| **T1 Operator-led** | ₹50L–₹3Cr/mo | Founder + 1–5 | Tool sprawl; can't trust ROAS/manual sheets |
| **T2 Scaling** | ₹3Cr–₹50Cr/mo | Growth/retention/support/ops/finance leads | Team works harder but decisions don't compound |
| **T3 Enterprise/multi-brand** | ₹50Cr+/mo | CMO/CFO/COO, portfolio, agencies | BI shows numbers, not cross-functional accountability |

**Personas:** Founder/Owner, Operator/COO, Growth/Media-Buyer, Retention/CRM, Support Head, Finance/CFO, Ops/Logistics, Agency, Investor.

**Account structures:** A single-brand · B multi-brand group (isolated per brand) · C agency-managed (scoped, all actions tagged) · D enterprise overlay (residency, SLA, approval matrices).

### 1.5 Real-world use cases (the wedge)

- **"Are we making high-quality money today?"** — honest CM2 over vanity ROAS; revenue-quality panel that flags scaling-bad-revenue (good platform ROAS, poor COD/RTO quality).
- **COD/RTO margin defense** — RTO by pincode/courier/product/payment/offer; break-even RTO rate r\* = M/(M+C); NDR as a leading indicator (Indian DTC's single largest controllable margin leak).
- **Lifecycle as a revenue engine** — abandoned cart, COD-confirm, winback, replenishment, VIP — always CM2-gated; recovered revenue ÷ Brain fee as the proof metric.
- **AI ticket management as revenue protection** — support as a commerce event: faster FRT, autonomous resolution, exchange-over-refund, delivery recovery before RTO.
- **Morning Brief** — ≤3 ranked actions on the phone before 09:00 IST, each with problem/evidence/action/impact/risk/confidence and approve/reject/edit buttons that write to the Decision Log.

### 1.6 Multi-tenant SaaS expectations

Brain is **multi-tenant from day one**. Hierarchy: **Organisation → Brand/Workspace → Store/Channel/Integration → records.** *Workspace = tenant = brand = billing unit.* `workspace_id` is law (enforced at 4 layers — §8). Pricing is **% of realized/delivered GMV** (no per-seat), so inviting teammates never raises cost; tenancy and metering are foundational, not bolt-ons.

### 1.7 AI-first operating-system philosophy

Brain is **AI-native**, not AI-bolted-on — but "AI-native" means *cost-routed intelligence*, not "LLM everywhere." Deterministic SQL/ML does the work; LLMs only classify, personalize, summarize, and synthesize at the human-language boundary (the master invariant, §0.2). The Decision Log makes the system *accountable* (every action logged) and the Memory Layer makes it *compounding* (every outcome teaches). These two — accountability + compounding memory — are the moat, and they are wired in from the first dashboard, not retrofitted.

---

## 2. System Architecture — [TECH/00, TECH/18; technical-context §3]

### 2.1 The shape: modular-monolith → microservices, logical-now / physical-later

The product is a **10-layer flow** (ingest → raw → canonical → analytics → prediction → memory → agentic → multi-tenant → RBAC → cloud-native) realized by **7 backend bounded contexts + 2 clients + the LiteLLM gateway** — never by per-layer microservices. The system is **always 7 logically-separate bounded contexts**, each its own DDD context with its own gRPC contract in `protos/` from day one. What changes by phase is **how many deployables they run as**:

- **Phase 0–1 → 3 backend deployables:** `edge` (Node: api-gateway + core) + `data` (Python: ingestion + analytics + intelligence) + web + mobile, on **ECS Fargate**, **MSK Serverless** (+ transactional outbox), managed ClickHouse, single region (ap-south-1).
- **Phase 2–3 → the full 7 services:** add `lifecycle-service`; migrate to **EKS + Karpenter**, provisioned **MSK** + Debezium CDC.

Because gRPC contracts exist from day one, the split is **mechanical** (flip in-process call → network call), not a rewrite. [TECH/00 §3; TECH/18 §1]

### 2.2 The 7 services + 2 clients (boundaries & ownership) — [TECH/18 §2–3]

| # | Service | Lang | Owns (one writer per store) |
|---|---|---|---|
| 1 | `api-gateway` | TS/Fastify | BFF: tRPC (web+mobile) + **MCP server**; auth + tenancy + rate-limit choke point; gRPC fan-out. **No business logic, no AI orchestration.** Stateless (Redis only). |
| 2 | `core-service` | TS/Fastify | System of record: orgs, workspaces, users, roles, settings, costs, goals, integrations registry (credential ARNs), consent, audit, **billing/metering**. Postgres `core/billing/audit/consent`. |
| 3 | `ingestion-service` | Python | Connector framework, sync, webhooks, canonicalization, raw archive, integration health. ClickHouse `raw_*` + S3 raw + watermarks. |
| 4 | `analytics-service` | Python | ClickHouse materializations, the deterministic **metric engine**, RFM, lifecycle states, LTV, attribution, regional math, **`ai.decision_log` writer**. ClickHouse canonical+derived. |
| 5 | `intelligence-service` | Python | **Memory Layer** (pgvector), the **15 agents**, anomaly, forecasts, the daily tick, LLM orchestration via gateway, internal MCP tools. Postgres `ai.*` + pgvector(HNSW). |
| 6 | `lifecycle-service` | Node + Python | **[MOAT]** Audience builder, channel routers, AI calling, compliance engine, inbound inbox, recovered-revenue attribution. Postgres `lifecycle.*`/`support.*`. **Phase-2 build.** |
| 7 | `notifications-service` | TS/Fastify | Alerts, **Morning Brief assembly + delivery**, digests, push, exports, outbound webhooks. Postgres delivery-state + S3. |
| 8 | `web` | Next.js 16 | Operator workbench — presentation only (Ananya). |
| 9 | `mobile` | Expo SDK 56 | Morning Brief primary surface — presentation only (Karan). |
| — | LiteLLM gateway | infra (EKS) | Model-agnostic LLM routing (runtime of paradigm 3/4); 2+ stateless replicas. |

**Boundary resolution (R4):** `lifecycle-service` (revenue *execution*, customer-facing) is **distinct** from `notifications-service` (alerts/digests/push/exports, operator-facing). One acts on the customer; the other informs the operator.

### 2.3 Domain-Driven Design strategy (mandatory — code-review blocker) — [technical-context §4; TECH/18 §7]

Every backend service is organized **by domain, never by technical layers**:

`bootstrap/` (server wiring, DI, config, health probes) · `domain/` (entities, value-objects, aggregates, domain events, policies — pure) · `application/` (use-cases / commands / queries (CQRS), orchestration) · `infrastructure/` (repositories, gRPC clients, Kafka producers/consumers, DB, external APIs) · `interfaces/` (gRPC handlers / tRPC routers / Kafka consumers / HTTP).

A `controllers/`-style technical-layer folder is a **blocker**. See skill `domain-driven-design`.

### 2.4 Communication patterns (contract-first) — [TECH/18 §1, §4]

- **Clients → `api-gateway` only** (tRPC over HTTPS + SSE/WS). The gateway is the *only* client-reachable service and the policy enforcement point.
- **Gateway → services via gRPC** (request/response). Metadata `x-workspace-id`/`x-user-id`/`x-request-id`/`x-traceparent`; `TenancyInterceptor` rejects any call missing `workspace_id`.
- **Service ↔ service via Kafka events** (versioned `.vN` + DLQ + retries). Services **never** call each other via REST and **never** share a database.
- **Sync vs async rule:** **gRPC (sync)** *only* where the caller blocks on the answer (dashboard read, metric lookup, AI-chat tool calls). **Kafka (async)** for state propagation, fan-out, eventual consistency (ingestion→analytics→intelligence). **Default async.**

The full cross-service comms matrix (who talks to whom, by mechanism, with topic) is **[TECH/18 §4]**; the Kafka topic catalog with payload contracts is **[TECH/18 Appendix B]**.

### 2.5 Event-driven architecture & the event spine — [technical-context §7; TECH/18 §1, App B]

- **Broker:** Amazon MSK (Kafka) + Glue Schema Registry (Avro). Phase 0–1 = MSK Serverless + **transactional outbox**; Phase 2 = provisioned MSK + **Debezium CDC**.
- **Topic naming:** `<domain>.<entity>.<event>.v<n>`; **partition key = `workspace_id`** (per-workspace ordering, required for version-based dedup).
- **Standard envelope (every event):** `event_id, event_type, workspace_id, occurred_at, produced_at, producer_service, trace_id, schema_version, idempotency_key, payload`.
- **Retention:** raw integration topics + the Decision-Log topics = **∞** (MSK tiered storage → S3, replayable); transient (sync/digest) = 30–90d.
- **Schema evolution:** backward-compatible additions stay in-version (new fields defaulted); breaking changes → `.v(n+1)` + dual-write window.
- **Every consumer:** idempotent (envelope `idempotency_key` + ClickHouse version dedup) + DLQ + replay tool.

### 2.6 Sync vs async, CQRS & (pragmatic) event sourcing — [TECH/18 §1]

- **CQRS — yes.** Writes → Postgres OLTP + emit events; reads → ClickHouse MVs + Redis (a separate read model). `analytics-service` is the read-model builder.
- **Event sourcing — pragmatic/partial.** The Kafka log + S3 raw archive *is* the event store for the analytical side: every ClickHouse materialization is rebuildable by replay. The Decision Log is an append-then-update ledger. **OLTP product state is NOT event-sourced** — Postgres is the system of record.

### 2.7 Workflow orchestration — [TECH/18 §1, §6]

In-service orchestration only: **Kafka consumers + EventBridge Scheduler (daily tick, rollups) + state machines + transactional outbox.** No separate orchestrator yet. A **durable workflow engine (Temporal / Step Functions)** is a deferred-until-trigger forward extension (Phase 3 — when long-running sagas like multi-step auto-execute, complex onboarding, and reversals get hard to reason about as raw event chains). Build the seam (events + outbox + state machines) now; graduate then.

### 2.8 Real-time streaming architecture

- **Ingestion:** webhooks near-real-time (Shopify orders 5–15 min), polling per type, streaming where supported.
- **Analytics:** ClickHouse MVs update on INSERT (near-real-time) + scheduled rollups for join-heavy metrics; hourly Path-A rollup in **Sale/Event Mode**.
- **Client real-time:** SSE/WS through api-gateway for AI chat streaming + live dashboards (`MetricsService.StreamMetricUpdates`, `IntelligenceService.Chat` bidi).
- **The daily heartbeat:** the 06:55→07:20 IST intelligence loop is the SLO-critical real-time path (§5, §7).

### 2.9 Scalability, fault tolerance & failure/retry — [TECH/18 §3, §7; TECH/09]

- **Scalability patterns:** stateless gateway → horizontal autoscale behind ALB; `ingestion` is the most independently-scalable + bursty (backfills/webhook storms) → per-connector concurrency caps; `analytics` scales with data volume (billion-row scans) → ClickHouse sharding at Phase 3 trigger; `intelligence` bursty agent fan-out → Karpenter bin-packing; ClickHouse `Distributed` over `cityHash64(workspace_id)`.
- **Fault tolerance:** gRPC circuit breakers + timeouts; degrade to cached reads on a downstream outage; idempotency on every mutation; transactional outbox (no dual-write loss); credential reads fail-closed.
- **Failure/retry:** backoff + per-vendor rate-limit respect; **DLQ + replay** for poison payloads; watermark resume (no loss on restart); the **07:20 IST Morning Brief SLO is sacred** — gateway fallback chain, then degrade to a SQL+ML brief if the frontier model stalls.
- **Graceful degradation everywhere:** stale data is labeled, never silently trusted; agents degrade to lower paradigms; missing data → "estimated" labels (the data-quality gate, §3.9).

### 2.10 Multi-region readiness — [TECH/18 §1; TECH/04]

`ap-south-1` only Phase 0–3 (DPDP in-region by default). **Phase 4** multi-region for UAE/GCC/EU residency, keyed off `workspace.home_region`; the `RegionAdapter` abstracts behavior so a new region is an **infra change, not a fork** — the metric engine, frontend, intelligence, and notifications need *zero* changes (§4 region-adapter detail).

### 2.11 Cloud-native deployment strategy — [TECH/18 §1; devops]

Turborepo monorepo; **GitHub Actions → ECR → ArgoCD** (services) + **EAS** (mobile); AWS CDK (TypeScript) IaC; **ECS Fargate → EKS + Karpenter** at the Phase-2 trigger; progressive delivery (flags + canary + per-brand graduation). **Selective per-service deployment from day one** — `turbo --affected` builds/pushes only changed images, each service has its own ECR image + own ArgoCD Application, only the changed service (+ transitive dependents) syncs (§9.7, Appendix C).

### 2.12 Why each major decision exists (rationale digest)

| Decision | Why |
|---|---|
| 7 logical contexts, 3 deployables early | Avoid premature microservice ops cost; keep the split mechanical via proto contracts |
| OLTP/OLAP split (Postgres + ClickHouse) | The analytics product needs columnar OLAP from the first dashboard; OLTP stays transactional |
| Kafka with ∞-retained raw + Decision-Log topics | Replayable materializations = the migration/DR story *and* an audit spine |
| pgvector inside Postgres (no separate vector DB) | Memory co-located with relational data; one fewer system to operate at Brain's scale |
| LiteLLM gateway in front of all LLM calls | Model-agnostic cost routing + per-workspace budgets + fallback; keeps %-GMV pricing alive |
| Lakehouse-lite (S3 lake + ClickHouse warehouse) | Avoid per-query-billed warehouses (Snowflake/BigQuery) that fight %-GMV economics |
| DB-per-service, no shared DB | Bounded-context integrity; independent scaling; no hidden coupling |

---

## 3. Data Ingestion Architecture — [TECH/02; technical-context §11]

### 3.1 The connector framework (one interface, backfill == live)

All connectors inherit a single `Connector`/`BaseConnector` ABC (Strategy pattern). **Backfill == live — only the window changes.** Interface surface:

`authenticate()` · `refresh_token()` · `sync(window)` · `receive_webhook()` · `canonicalize()` · `health_check()`

- Sync window = `max(last_watermark − LATE_DATA_WINDOW, now − LATE_DATA_WINDOW)` → `now − NEW_DATA_LAG`. Per-connector class constants (e.g. `ShopifyOrdersConnector.LATE_DATA_WINDOW = 60d`, `NEW_DATA_LAG = 5min`).
- Every canonical event carries a monotonic `version: UInt64` (from source `updated_at` ms epoch) → highest version wins in ClickHouse `ReplacingMergeTree`.
- **Independently extensible:** adding a connector never touches another. New connector = new impl + tests; the rest of the platform is untouched.

### 3.2 OAuth / token lifecycle — [TECH/02 §4–7; TECH/09 §5]

- Tokens are **KMS envelope-encrypted**; Postgres stores only a `credential_secret_arn` in `core.integrations` (plaintext never logged). `core-service` owns the credential wrapper + `core.oauth_states` (CSRF state + redirect_uri match).
- Provider specifics: **Shopify** OAuth 2.0 (`read_orders,read_products,read_customers,read_inventory,read_fulfillments`); **Meta** long-lived 60-day tokens refreshed every 30d (`ads_read,business_management,read_insights`); **Shiprocket** email/password → JWT (10-day) with a daily refresh job.
- Refresh is a scheduled job per connector; auth-revoked (4xx) → mark integration `disconnected` + alert; auth-expired → refresh then retry.

### 3.3 Webhook ingestion — [TECH/02 §1]

- Webhook receiver is **signature-validated** (e.g. Shopify HMAC) before processing; endpoint pattern `https://api.{BRAIN_DOMAIN}/integrations/{provider}/callback`.
- Webhook receipt triggers an immediate targeted sync (near-real-time) vs cron polling. Orders land in 5–15 min. Phase-2 commitment for the full webhook set; Phase 0–1 leans on polling + the order webhook.

### 3.4 Polling / scheduler & watermarks — [TECH/02 §1–2]

- **EventBridge Scheduler** (cron) → SQS job descriptors → ingestion workers. Backfill rides a throttled lane (`integrations.sync.backfill.v1`, 1 consumer/workspace) so it never starves live sync.
- **Per-provider late-data windows** (re-pull window so late updates are captured): **Shopify 60d** (refunds), **Meta 28d** (attribution), **Google 7d**, **Razorpay 30d** (settlements).

### 3.5 Fan-out sinks & idempotency — [TECH/02 §3–4; TECH/18 App A]

Each canonical record fans to **3–4 sinks**, best-effort + circuit-broken (a failure in one sink never blocks the others):

1. **S3 raw archive** (`raw/{workspace_id}/{provider}/{date}/…`, ZSTD + SHA-256) — the immutable lake.
2. **ClickHouse `raw_*`** (append-only mirror).
3. **Kafka** `integrations.<entity>.v1` (the canonical event spine).
4. **Postgres 90-day hot mirror** (`*_recent`) — Phase 0–1 only (for fast joins + webhook reconciliation).

**Idempotency:** UPSERT on payload hash; ClickHouse `ReplacingMergeTree(version)` dedups by highest version. Re-fetching the same record is a no-op.

### 3.6 Retry, backoff, rate-limit, DLQ + replay — [TECH/02 §10–11]

- **Rate limiting:** per-source + per-workspace **Redis sliding-window** limiter (e.g. Shopify ~40 req/s, GraphQL leaky-bucket monitored via `throttleStatus`). On 429 → `RateLimitError` → re-queue with backoff.
- **Retry policy:** transient (network/5xx) → retry max 3 then DLQ; rate-limit → per-source backoff + re-queue; auth-expired → refresh; auth-revoked → mark disconnected; canonicalization bug → DLQ + Sentry → reprocess after fix.
- **DLQ + replay:** poison payloads → `integrations.dlq.v1` (carries `raw_payload_ref` to S3); manual replay tool (`tools/replay_dlq.py --topic … --since …`). Watermark resume means no loss on restart.

### 3.7 Connector quality tiers (graceful degradation by design) — [TECH/02 §7a]

| Tier | Source quality | Behavior |
|---|---|---|
| **Green** | Clean seller API | Build with confidence (Amazon SP-API, Flipkart, Noon, Salla, Zid, BigBasket). |
| **Yellow** | Gated API; per-brand onboarding | Build the connector; onboard per-brand as access is granted (Myntra, Ajio, Meesho, Namshi, Talabat). |
| **Red** | No seller API | **Workaround:** Gmail OAuth → parse seller-portal daily-report PDFs → LLM extract (Haiku/paradigm 3 for unstructured; SQL/paradigm 1 for structured tables) → canonical event. **Brittle by definition → continuous monitoring + breakage alert within 1h + explicit "estimated" UI label.** Schema-drift detection alerts on extraction confidence <95% (Nykaa, Blinkit, Zepto, Instamart, Ounass). |

P0 connectors alert at **freshness > 60 min**. Agents degrade gracefully and label stale data.

### 3.8 Integration catalog (toward 50+) & region-gating — [TECH/02 §4–7a; TECH/04]

- **Live Phase 0–1 (4 core):** Shopify (storefront), Meta Ads, Google Ads, Shiprocket (logistics).
- **Phase 2 Green/required:** Amazon India/AE (SP-API), Flipkart, BigBasket, **Razorpay** (payments), **Klaviyo** (email/CRM).
- **Phase 2–3 Yellow/Red marketplaces:** Myntra, Ajio, Meesho, Namshi, Talabat, Nykaa, Blinkit, Zepto, Instamart, Ounass, Noon.
- **Categories:** storefront · ads · payments · logistics · support · marketplace · finance/CRM. Roadmap expands toward **50+** via marketplace + API gatings.
- **Region-gating:** **TikTok Ads = UAE/GCC only** (banned in India); GCC connectors (Salla, Zid, Noon, Namshi) and BNPL (Tabby/Tamara) activate at Phase 4.

### 3.9 Onboarding data-quality gate — [technical-context §11; TECH/02 §9]

Reports are labeled **"estimated"** until: order/ad reconciliation passes **+ ≥80% SKU-cost coverage + identity-join + tz/currency/tax normalization + consent pass**. Backfill UX shows live progress; marketing/recommendation actions unlock only when the gate clears (so no recommendation is ever built on un-reconciled data).

### 3.10 Queueing strategy

EventBridge → **SQS** job descriptors → ingestion workers; **Kafka** consumer groups per resource (orders/customers/…) + a dedicated throttled `backfill` group. Capacity envelope: Kafka ingest target ~200K events/s; the Postgres recent-mirror UPSERT is the early bottleneck (~5K rows/s) — another reason the 90-day mirror is Phase-0–1-only and ClickHouse is the durable home.

---

## 4. Data Platform & Storage Strategy — [TECH/01; technical-context §6]

### 4.1 Storage roles (lakehouse-lite) — [TECH/18 §1]

- **S3 = the lake** — immutable, replayable raw archive (source of truth for replay/DR).
- **ClickHouse = the warehouse/OLAP** — raw mirror + canonical facts + derived aggregates.
- **Postgres (Supabase) = OLTP + a 90-day hot mirror** — system of record for product state + fast joins/reconciliation.
- **Redis = hot cache + ephemeral state.** No Snowflake/BigQuery (per-query billing fights %-GMV economics).

### 4.2 Postgres (OLTP) — bounded-context schemas — [TECH/01 §2; R3]

Schemas = bounded contexts: `core`, `ai`, `lifecycle`, `support`, `billing`, `audit` (+ Supabase `auth`). Every workspace-scoped table has `workspace_id` + RLS. **Money = BIGINT minor units + `currency_code`.** The **90-day hot mirror** rule: `*_recent` tables (orders/customers/shipments) hold the last 90 days for fast joins + webhook reconciliation; older facts live in ClickHouse. OAuth tokens via KMS envelope (ARN only).

**`ai.decision_log` (the moat)** — written before any recommendation is displayed; updated on approve/edit/execute/reverse; nightly 7d/30d outcome backfills. Status enum: `proposed/approved/rejected/edited/queued/auto_executed/blocked/executed/reversed/failed/observed`. Key fields: `workspace_id, agent_group, agent_name, decision_type, action_type, status, priority_score, confidence, risk_level, reversibility, channel, title, explanation, input_snapshot, evidence_refs, proposed_action, expected_impact, user_response, executed_action, reversal, outcome_7d, outcome_30d, attributed_revenue_minor, attributed_cm2_minor, recovered_revenue_*_minor, learning_note`. **A workflow that cannot write here is not a Brain action.** Memory tables (`ai.brand_fingerprint`, `ai.condition_outcome`, `ai.cross_brand_pattern`, `ai.auto_execute_policies/log`) and billing tables (`billing.gmv_meter`, `billing.invoices`, `billing.usage_passthrough`, `billing.plan`) live alongside.

### 4.3 ClickHouse (OLAP) — engines & table families — [TECH/01 §3]

- **Engines:** `ReplicatedMergeTree` (raw, append-only); `ReplicatedReplacingMergeTree(version)` (canonical/derived, late-data dedup, read with `FINAL`); `Distributed(..., cityHash64(workspace_id))` for sharding.
- **Discipline:** ordering key **leads with `workspace_id`** (`ORDER BY (workspace_id, …)`); `LowCardinality(String)` for repeated values (metric_name, channel, payment_method, ship_state…); money = `Int64` minor units.
- **Families:** `raw_*` (raw_orders/customers/products/shipments/shipment_events/refunds/ads_insights/campaigns) → **canonical** (orders, line_items, customers, products, refunds, shipments, shipment_events, campaigns, campaign_insights_daily, order_costs) → **derived** (`daily_metrics` master, customer_states, cohort_aggregates, first_product_attribution, customer_lifetime_value, pincode_reliability, festival_lift_factors, support_daily, lifecycle_outreach_daily).
- **Aggregation:** MVs for simple aggregates (update on INSERT); scheduled Python rollups for join-heavy metrics (MER/aMER/CM2). `max_execution_time = 30s` on dashboard reads.

### 4.4 Redis — [technical-context §6]

Hot metric cache (~60s TTL), sessions, rate-limit (sliding window), idempotency keys (24h TTL), feature flags. Cache-aside, **workspace-scoped keys**, mandatory TTL, invalidate-on-write (api-gateway consumes `analytics.metrics.daily_materialized.v1` to bust hot keys), stampede protection. *A cached metric is a ClickHouse/LLM call you didn't pay for* — a first-class cost lever.

### 4.5 S3 lifecycle — [technical-context §6; TECH/01 §11]

Raw payloads 90d → Glacier → delete 7y; exports 30d; Kafka tiered storage (∞ topics); call recordings 1y per-brand KMS key; audit mirror. Versioning enabled on critical buckets.

### 4.6 Multi-tenant data isolation — [TECH/01 §5]

- **Postgres (3 layers):** app middleware (`workspaceProcedure`) → Prisma extension auto-injects `workspace_id` → **RLS** (`workspace_id = current_setting('app.workspace_id')`, set via `SET LOCAL` per txn). Phase 3+ enterprise: per-workspace databases.
- **ClickHouse (2 layers):** ordering key leads with `workspace_id` (queries are O(log n)) + the **query gateway** (`pylibs/brain_clickhouse`) rejects any query lacking a `workspace_id` predicate.
- Redis keys + S3 paths are workspace-scoped; Kafka consumers assert `workspace_id` from the envelope. (The 4-layer enforcement story end-to-end is §8.2.)

### 4.7 Per-service DB ownership & consistency model — [TECH/18 §1, App A]

**One writer per store** (no service reads another's schema): ingestion → ClickHouse `raw_*`/S3/PG mirror; analytics → ClickHouse canonical+derived + `ai.decision_log`; intelligence → `ai.*`+pgvector; core → `core/billing/audit/consent`; lifecycle → `lifecycle.*`/`support.*`; notifications → delivery-state/S3; gateway → Redis only.

- **Consistency:** eventually consistent across services (async Kafka fan-out); strongly consistent within a service's OLTP transaction.
- **Distributed transactions:** avoided — use the **transactional outbox** (write OLTP + outbox row in one txn → relay to Kafka) and idempotent consumers. No 2-phase commit, no cross-service distributed txn. CQRS separates the write model (Postgres) from the read model (ClickHouse + Redis).
- **Cross-store sync (Phase 2):** Debezium CDC mirrors dual-store tables Postgres→ClickHouse.

### 4.8 Schema evolution & data versioning — [TECH/01 §10]

- **Postgres:** Prisma Migrate, **expand → migrate → contract**; staging runs on every PR, production gated by approval.
- **ClickHouse:** SQL migrations, idempotent (`IF NOT EXISTS`), `ON CLUSTER`; `daily_metrics` rows carry a `source_version` so a metric-definition change bumps version + regenerates the affected date range.
- **Events:** monotonic `version` (ReplacingMergeTree) + topic `.vN` for breaking changes.

### 4.9 Backup, recovery & replay — [TECH/01 §9]

- **Postgres (Supabase):** daily snapshots (30-day retention) + 7-day PITR.
- **ClickHouse Cloud:** daily backups + PITR.
- **Kafka (MSK):** tiered storage to S3 — ∞ retention; any consumer rewinds to any offset; RF=3 across 3 AZs.
- **S3:** versioning + lifecycle tiering.
- **Recovery:** restore Postgres → restore ClickHouse → **replay Kafka from S3** for any gap. **Any ClickHouse materialization is rebuildable from the ∞-retained raw topics + S3 archive** — this is simultaneously the DR story and the migration story. Phase-1 targets: RTO ~4h, RPO ~1h (tightening with sync replication at Phase 4).

### 4.10 Which database, and why

| Need | Choice | Why |
|---|---|---|
| Transactional product state, RLS, relational integrity | **Postgres (Supabase)** | ACID OLTP + native RLS + Supabase Auth integration |
| Vector memory (Brand Fingerprint, condition→outcome) | **pgvector (HNSW) in Postgres** | Co-locate memory with relational data; no separate vector DB to operate |
| Billion-row analytical scans, dashboards, materializations | **ClickHouse** | Columnar OLAP, sharded by workspace, sub-second aggregates |
| Hot cache, sessions, rate-limit, idempotency | **Redis (ElastiCache)** | µs reads; the cost lever |
| Immutable raw archive / lake / replay | **S3** | Cheap, durable, the replay source of truth |
| Event spine | **Kafka (MSK)** | Per-workspace-ordered, ∞-retained, replayable |

---

## 5. Analytics & Intelligence Layer — [TECH/03, TECH/05, TECH/12]

### 5.1 The metric engine & registry (truth) — [TECH/03 §2]

The **metric registry is the single source of truth**: one `MetricDefinition` (name, displayName, unit, direction, cadence, breakdowns, category, formula, derivedFrom, isCurrency) computed **identically in TS (`packages/lib-metrics`) and Python (`pylibs/brain_metrics`)**. `tools/generate-metrics-registry.sh` exports TS→Python; **CI diffs and fails on any mismatch.** No metric is defined twice; **LLMs never produce a metric number.**

- **Path A (materialized):** ClickHouse MVs → `daily_metrics` (ReplacingMergeTree) → Redis (60s TTL). Sub-100ms reads for the default dashboard view + standard breakdowns.
- **Path B (live):** on-demand ClickHouse query for arbitrary filters/drill-downs/waterfalls (target p95 <500ms).
- **Rule:** pre-aggregatable → Path A; needs joins or arbitrary filters → Path B.

### 5.2 The metric catalog (formulas live in code, never in an LLM) — [BRD §6; TECH/03 §0]

- **Revenue ladder:** Gross Sales → Net Sales → Net Sales Net Tax (**tax extracted per line item by SKU GST/VAT slab** via RegionAdapter) → Net Revenue → **Realized/Delivered Revenue** (survives cancellation/RTO/refund/payment-failure — the honest number **and the billing base**).
- **CM waterfall:** Net Revenue − COGS − non-marketing variable costs = **CM1**; CM1 − marketing = **CM2** (the most important metric — if CM2<0, scale makes it worse); CM2 − allocated fixed = **CM3**; CM3 − founder salary/financing/one-offs = Operating Profit. **True CM2** subtracts RTO + refund/payment-failure provisions.
- **Marketing:** MER = Net Rev ÷ total marketing spend; aMER = new-customer rev ÷ acquisition spend; CAC (on *delivered* new customers); CAC payback; LTV:CAC (cohort cumulative CM2 ÷ cohort CAC); creative fatigue (EWMA on CTR/CPM). **ROAS is display-only, never the P&L decision metric.**
- **COD/RTO:** RTO rate, RTO cost (forward+reverse+restock+write-down), COD realization, **break-even COD RTO rate r\* = M/(M+C)** (M = delivered-order CM, C = RTO cost per failed order). COD RTO 20–35% vs prepaid ~2–8% — the single largest controllable margin leak in Indian DTC.
- **Tax:** per-SKU GST 2.0 slabs **0/5/18/40** (never a single blended rate); discount applied **before** GST; every downstream metric is GST-exclusive.
- **Goal RAG:** higher-better Green ≥95% / Amber 80–95% / Red <80%; lower-better Green ≤105% / Amber 105–125% / Red >125%; output always includes explanation + recommended action.

### 5.3 Aggregation & real-time — [TECH/03 §4, §6]

MVs (real-time, on Kafka event) for simple aggregates; **scheduled Python rollups** (`daily_metrics_rollup.py`) for join-heavy metrics — hourly for "today" (MER/aMER/CAC), nightly 03:00 IST for the full prior-day `daily_metrics`, nightly 04:00 IST for customer_states/first_product. Each rollup publishes `analytics.metrics.daily_materialized.v1` → cache-bust + the intelligence tick. **Sale/Event Mode** = the same primitives at higher cadence (hourly Path-A rollup + ML anomaly + frontier synthesis only at digest), with the **margin-trap alert** (CM2 falling even as revenue rises).

### 5.4 ML architecture — models & what each does — [TECH/05; TECH/03 §0.8]

| Model | Library | Use |
|---|---|---|
| **Prophet** | prophet | Demand/revenue forecasting (festival regressors) |
| **PyMC-Marketing** (BG/NBD + Gamma-Gamma) | pymc-marketing | LTV (purchase frequency + monetary), replaces archived `lifetimes` |
| **Kaplan-Meier** | lifelines | Cohort retention / survival curves |
| **Isotonic regression** | scikit-learn | Spend → aMER response curve (monotone, clipped) |
| **XGBoost** | xgboost | RTO risk per order (pincode × courier × AOV × COD × time) |
| **DBSCAN** | scikit-learn | RTO pincode clustering; return-reason clustering |
| **Isolation Forest** | scikit-learn | Multivariate anomaly (e.g. revenue normal but CAC spiking) |
| **EWMA** | numpy | Creative fatigue on CTR/CPM |
| **pgvector cosine** | pgvector | Brand-state similarity; condition→outcome retrieval |

All ML inference is <$0.001/call (paradigm 2). The frontier LLM enters only at Morning Brief synthesis.

### 5.5 Model lifecycle — [TECH/05 §2–3; TECH/18 §1]

- **Training:** monthly batch (nightly window ~04:30 IST); models loaded in-memory for synchronous inference. **MAPE > 40% flags** investigation; sustained MAPE > 25% over 7d → P2 alert.
- **Registry / experiment tracking:** model versions in Postgres (`ai.forecasts` with `model_id`; accuracy in `ai.forecast_accuracy` — `error_pct, horizon_days, mape_7d, mape_30d`); old versions retained for audit. Formal **feature store + MLflow are deferred-until-trigger** (Phase 3 — don't pay MLOps cost for ~6 models); today, features = ClickHouse aggregates + a lightweight feature table.
- **Feedback loop:** condition→outcome pairs record 7d/30d actuals (the compounding-learning engine, §6).

### 5.6 Anomaly detection — [TECH/05 §3]

- **Z-score:** baseline = last 30 days, festival-adjusted via RegionAdapter lift; |z|>2.0 warning, |z|>3.0 critical.
- **Isolation Forest (multivariate):** features = {revenue_net, MER, aMER, CAC, AOV, orders_count}; contamination 5%; `decision_function < −0.2` flags.
- Triggered on `analytics.metrics.daily_materialized.v1`; persisted to `ai.anomalies`; emits `intelligence.anomaly.detected.v1` → notifications.

### 5.7 Recommendation generation — [TECH/05; TECH/14]

Every recommendation carries: **why-now** (the matching historical condition + similarity), **metrics used**, **expected revenue + CM2**, **confidence** (memory similarity + sample count), **risk** (RTO/inventory/COD impact), **reversibility**, **approval level**, **execution path** (the concrete MCP write tool), **fallback** (a SQL threshold rule), **outcome plan** (the 7d/30d metrics to watch). It is written to `ai.decision_log` (status `proposed`) *before* it is displayed.

### 5.8 Cost-routing — the engineering invariant — [TECH/12]

| Paradigm | Cost | When |
|---|---|---|
| 1 **SQL** | ~1 ($0) | Any deterministic computation over structured data — metrics are always SQL |
| 2 **ML** | ~100 | Patterns exist but rules don't (forecast, LTV, RTO risk, anomaly, similarity) |
| 3 **small_llm** | ~1,000 | Bounded NL (classification, message personalization, single-doc summary) |
| 4 **frontier_llm** | ~10,000 | Multi-step reasoning/synthesis across many docs (the Morning Brief) |

Ratio ≈ **1 : 100 : 1,000 : 10,000**; **target mix 85% SQL / 12% ML / 2.5% small-LLM / 0.5% frontier-LLM**. Every endpoint/agent declares `@paradigm(...)`; **CI/PR blocks** if a cheaper paradigm would suffice (paradigm bypass = anti-pattern).

**Paradigms 3/4 are model-agnostic routed policy tiers** — the decorator names a *tier*, and the **LiteLLM gateway** routes to the cheapest model passing that tier's eval bar (small → Nova Micro/Gemini Flash-Lite/Haiku; frontier → Claude Sonnet 4.6 default, eval-gated + swappable). **Three enforcement layers:** (1) default routing at the gateway; (2) per-feature token budget (soft 80% warn → hard 100% degrade to template/SQL); (3) per-workspace monthly cap as **gateway virtual-key budgets** (soft 70% throttle non-critical → hard 100% critical-path only: Morning Brief, NL query, ticket resolution). **Prompt caching** (stable per-workspace system prompt — brand metadata, glossary, Brand Fingerprint, Decision-Log context) is the biggest LLM cost lever (~40% on daily insights alone), kept on the frontier backend. **Model swaps are `llm-evals`-gated — no model serves a tier until it passes.**

### 5.9 Reporting architecture — [TECH/08]

`notifications-service` assembles operator-facing reporting from analytics + intelligence events: **Morning Brief** (07:00–09:00 IST push), **Evening Pulse** (18:00), **Weekly Review**, **Month-End Compound Report** ("what did Brain learn this month?"), plus alerts, exports, and outbound webhooks. Numbers come from the metric engine; the LLM only writes the prose.

---

## 6. Memory Architecture (the core of Brain) — [TECH/05 §0; TECH/13]

Memory is the moat. It is what turns Brain from "a dashboard that recommends" into "a system that gets measurably better at *this brand's* decisions every day." It is **co-located in Postgres + pgvector (HNSW) — there is no separate vector DB.**

### 6.1 The five memory subsystems

| # | Subsystem | Storage | Content | Consumed by |
|---|---|---|---|---|
| 1 | **Brand Fingerprint** | pgvector `ai.brand_fingerprint` `vector(16)` | A 16-dim daily vector of the brand's current state + `components` JSONB (human-readable) | Every agent's daily tick; cross-brand similarity |
| 2 | **Condition→Outcome log** | Postgres + pgvector `ai.condition_outcome` | (fingerprint-at-decision, agent, recommendation, was_approved, was_auto_executed, outcome_7d/30d, recovered_revenue_7d/30d_minor) | Every agent ("find similar past conditions"); the compounding-learning engine |
| 3 | **Cross-brand patterns** | Postgres `ai.cross_brand_pattern` | k-anonymized (k≥5) pattern signatures by category/region + aggregated outcome | Cold-start + sparse-data brands |
| 4 | **Seasonal codebook** | Postgres | Per-brand per-event uplift multipliers | AICMO-Festival, forecasting, the Brief's seasonal narrative |
| 5 | **Customer segment memory** | Postgres `lifecycle.rfm_score` | Daily RFM per customer + segment classification | Lifecycle audience builder; customer-state lifecycle |

### 6.2 Memory taxonomy (how the canon's subsystems map to memory types)

- **Long-term memory** — the ∞-retained **Decision Log** + **condition→outcome** history (every decision and its matured outcome, forever).
- **Short-term / working memory** — the day's freshness check, the freshly-built Brand Fingerprint, and the in-tick agent context window.
- **Semantic memory** — the **pgvector** embeddings (Brand Fingerprint, condition→outcome) queried by cosine k-NN.
- **Business memory** — cost settings, goals, COGS, consent, region config (in `core`), which condition every recommendation is evaluated against.
- **Agent memory** — per-agent graduation state + the recommendation/outcome stream attributed to each agent.
- **Conversation memory** — `ai.chat_conversations`/`chat_messages` for the NL-query/AI-chat surface.
- **Decision memory** — the Decision Log itself (the canonical "what did Brain do, why, and what happened").
- **Historical intelligence** — the seasonal codebook + cross-brand patterns (learned priors across time and across the brand cohort).

### 6.3 The Brand Fingerprint — 16 dimensions (built daily at 07:00 IST)

CM2 % of revenue · revenue trajectory (7d rolling) · MER (blended) · aMER (acquisition) · CAC (delivered) · AOV · new-customer share · repeat-customer share · COD share · RTO rate (rolling) · active inventory days · discount depth · channel concentration (Herfindahl) · creative fatigue (mean EWMA across campaigns) · seasonality position (days from nearest festival) · cashflow runway.

```sql
CREATE TABLE ai.brand_fingerprint (
  workspace_id UUID, date DATE, vector vector(16),
  components JSONB,                       -- per-component human-readable values
  PRIMARY KEY (workspace_id, date));
CREATE INDEX ON ai.brand_fingerprint USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 6.4 Storage & retrieval mechanics — [TECH/05 §0.3]

- **Vector search:** pgvector **HNSW** (`m=16, ef_construction=64`), cosine distance (`<=>`). Retrieval = **k-NN (LIMIT 5)** over `ai.condition_outcome` filtered to the workspace, ordered by distance to the current fingerprint:

```sql
SELECT recommendation_type, was_approved, outcome_7d, outcome_30d,
       1 - (brand_fingerprint_at_decision <=> :current_fingerprint) AS similarity
FROM ai.condition_outcome
WHERE workspace_id = :ws AND outcome_30d IS NOT NULL
ORDER BY brand_fingerprint_at_decision <=> :current_fingerprint
LIMIT 5;
```

- **Tenant-aware isolation:** every memory row carries `workspace_id`; queries are workspace-filtered (RLS + the predicate above). **No cross-brand row is ever visible to another brand** — cross-brand learning happens *only* through the k≥5-anonymized `ai.cross_brand_pattern` aggregate.

### 6.5 Context building & retrieval orchestration

On each agent tick the orchestrator assembles context in a fixed order: (1) freshness check → (2) today's `daily_metrics` (gRPC from analytics) → (3) the freshly-built Brand Fingerprint → (4) **HNSW k-NN** of the 5 closest historical condition→outcome pairs (+ cross-brand fallback if the brand is sparse) → (5) seasonal codebook lookup → (6) goals/cost/consent from `core`. This bundle is the agent's working memory for the tick; the frontier synthesis step receives only the distilled Top-3 (token-budgeted), with the stable parts (brand metadata, glossary, fingerprint) served from the **prompt cache**.

### 6.6 Memory lifecycle, compression & summarization

- **Write:** a `condition_outcome` row is written when a recommendation is logged (fingerprint-at-decision captured); the seasonal codebook + cross-brand patterns are recomputed on a schedule (cross-brand patterns carry `computed_at`/`expires_at`).
- **Mature:** the **23:55 nightly outcome job** backfills `outcome_7d`/`outcome_30d` + `recovered_revenue_*_minor` as windows close (the feedback loop).
- **Compress:** the Brand Fingerprint *is* the compression — a 16-float daily summary of the whole brand state; the seasonal codebook compresses years of seasonality into per-event multipliers; the Month-End Compound Report is the human-readable summarization ("what did Brain learn this month?").
- **Cross-brand graduation:** patterns only surface at **k≥5** anonymity; brands receive patterns regardless, contribute only on opt-in.

### 6.7 Knowledge graph (deferred-until-trigger) — [TECH/18 §6]

Today, entity relationships live as pgvector + relational FKs + identity-resolution in analytics. A dedicated **knowledge graph (Neptune/Neo4j)** is a Phase-3+ forward extension, adopted only when multi-hop relationship queries prove out (e.g. creative→cohort→RTO chains). Keep entity IDs + relationships in Postgres now (the seam); graduate the graph engine then.

### 6.8 How memory powers everything

- **AI copilots / NL query:** chat tool-use reads deterministic metrics + memory context; numbers come from analytics, never invented.
- **Autonomous agents:** every agent's recommendation is shaped by its k-NN of past similar conditions and their outcomes for *this* brand.
- **Strategic recommendations:** confidence = memory similarity + sample count; cold-start brands borrow cross-brand priors.
- **Business-intelligence reasoning:** the Decision Log + fingerprint history is the substrate the Month-End Compound Report and the Evening Pulse reason over.

---

## 7. Agentic AI Architecture — [TECH/14, TECH/13, TECH/05]

> **Critical distinction:** the **15 *product* agents** described here run *inside* Brain (`intelligence-service`) and act for the brand. They are **not** the 11-agent Engineering-OS *build team* (Rohan/Aryan/Vikram/…). Never conflate them. [TECH/17 §2]

### 7.1 Agent roles — the roster (15) — [TECH/14 §2–4]

- **AICMO — marketing (8):** Meta · Google · TikTok (GCC-only) · Snap (GCC) · Cross-Channel (media-mix allocation by CM2/channel) · Creative (benchmarking + brief generation) · Pricing (SKU elasticity) · Festival (Prophet + per-brand uplift).
- **AICOO — operations (4):** Logistics (courier scoring, RTO mitigation) · Returns (reason clustering, refund-vs-replace) · Inventory (per-SKU demand, reorder) · Marketplace (BSR, listing health).
- **AICFO — finance (3):** Conversion (COD vs prepaid) · Cashflow (30-day projection, settlement-lag) · Pricing-Margin (CM2 protection, discount-stacking alerts).
- **AI CX** — the ticket-management capability (the customer-facing support brain; executes in `lifecycle-service`, §7.8).

Most agents are paradigm-2 (ML) at the core; paradigm 3 for bounded NL (brief headline, classification); paradigm 4 only at the Morning Brief synthesis boundary.

### 7.2 The agent base class (common pattern) — [TECH/14 §1]

Every agent shares one shape: a **`daily_tick`** method (runs in the 06:55–07:15 window) → **memory query** (HNSW k-NN of similar past conditions) → **paradigm-appropriate model(s)** → a **structured recommendation with a priority score** → a **Decision-Log write** (status `proposed`/`pending` if not graduated) → exposes its recommendations + operations as **`@mcp_tool`s** → carries a **graduation tracker**. Declares its `@paradigm`. The internal flow is **sense → decide → recommend**.

### 7.3 Orchestration & the daily tick — [TECH/14 §5, §8; TECH/05 §0.7]

The `orchestration/daily_tick.py` fans out **all 15 agents in parallel** at 07:10; each returns ranked recommendations and writes a Decision-Log row. `orchestration/morning_brief.py` selects the **Top-3** and the **frontier synthesizer** (Claude Sonnet default, via the gateway, prompt-cached) writes one consolidated narrative at 07:15 → `intelligence.insight.generated.v1` → notifications assembles + pushes by **07:20 IST (>99.5%)**. Fallback: if the gateway/frontier stalls, degrade to a SQL+ML brief so the SLO still holds.

### 7.4 Tool calling & skills (MCP) — [TECH/13]

- **MCP server lives in `api-gateway`**, sharing its auth/tenancy/rate-limit; **tool schemas are generated from the same protos as gRPC → they cannot drift.**
- **Namespaces** (`<domain>.<resource>.<action>`): `memory.*` (e.g. `memory.brand_fingerprint.query`, `memory.condition_outcome.search`), `analytics.*` (`analytics.metric.get`, `analytics.waterfall.compute`), `integrations.*` (`integrations.meta.adjust_campaign_budget`, `integrations.google.add_negative_keyword`), `lifecycle.*` (`lifecycle.audience.build`, `lifecycle.outreach.trigger`, `lifecycle.call.place`), `ai.*` (`ai.agent.invoke`, `ai.chat.message`), `decision_log.*` (`record`, `attribute_outcome`), `core.*` (`core.goal.get/set`, `core.consent.update`).
- **Read vs write:** read tools are default-allowed; **every write/action tool auto-writes the Decision Log via MCP middleware** (any `integrations.*.write`, `lifecycle.outreach.*`, `lifecycle.call.place`, `core.consent.update`, `core.goal.set`).
- **Streaming:** SSE events `tool_start` / `tool_result` / `agent_reasoning` / `agent_recommendation` / `done` for long-running agent invocations + chat.
- **Versioning:** breaking change → `tool.name/v2` (old supported ≥6 months; pin via name or `?version=`).

### 7.5 Planning / execution flow & multi-agent collaboration — [TECH/14 §5]

Agents are not siloed. A choreographed example: AICMO-Meta detects creative fatigue (ML) → MCP-calls AICMO-Cross-Channel for reallocation → which MCP-calls AICFO-Cashflow to verify the move is cashflow-neutral → the Morning Brief synthesizer writes one item ("Pause creative X; move ₹50K/day Meta→Google; recover ₹2.8L/30d; cashflow neutral") → Owner approves on phone → MCP writebacks fire (`integrations.meta.pause_ad_set` + `integrations.google.adjust_keyword_bid`) → the Decision Log records the whole chain → 7d/30d attribution backfills. **Context is shared through the Decision Log + the Memory Layer + `ai.agent.invoke`**, not through hidden in-process state.

### 7.6 Guardrails & the graduation tracker — [TECH/14 §6]

Agents are **recommendation-only until graduated**, per-tool per-brand, over a 90-day rolling window. All four must hold to graduate: **outcome accuracy ≥ T_acc · owner approval rate ≥ T_app · sample size ≥ N_min · reverse-outcome rate ≤ R_max.**

| Tool class | T_acc | T_app | N_min | R_max | Magnitude cap |
|---|---|---|---|---|---|
| Low-risk writeback (e.g. add negative keyword) | 75% | 65% | 30 | 5% | n/a |
| Medium-risk (budget change ≤10%) | 80% | 70% | 50 | 3% | ±10%/cycle |
| High-risk (price, large budget shift) | 85% | 75% | 100 | 2% | ≤5%; <20% of revenue |
| Very-high-risk (courier reallocation) | 90% | 80% | 200 | 1% | off by default; brand opt-in |

Accuracy drop → **auto-degraduate**. Owners can revoke graduation, disable an agent, tighten caps, or require approval for specific SKUs/campaigns — all logged in the audit log. Telemetry: a per-agent admin dashboard shows graduation status, rolling accuracy, time-to-graduation, and reverse-outcome alerts.

### 7.7 Human-in-the-loop & autonomous workflows — [TECH/13 §9; technical-context §9]

- **HITL is the default.** Un-graduated agents produce a `pending` Decision-Log row; the Owner approves/rejects/edits (mobile → tRPC → gateway). Approve fires the write tool with the `decision_log_id`; reject fires nothing; edit creates an amended entry. The **Decision Log is the coordination spine** ("what did Brain do?").
- **Auto-execute (Phase 3):** OFF by default; Owner enables per action class. Initial action classes + confidence floors: pause ad 0.90 · reduce budget ≤X% 0.85 · abandoned-cart discount 0.80 · lifecycle send 0.85 · courier switch 0.85 · replacement-under-policy 0.90 · refund-under-cap 0.95 (irreversible → Owner) · draft PO 0.90. Guardrails: caps · consent/policy/freshness checks · **global + per-action kill switch (Owner pauses all in 60s)** · **auto-revert to recommend-only** if reversal/error rate crosses threshold · a Decision-Log + audit row per action · per-tool per-brand graduation.

### 7.8 AI CX — ticket management — [TECH/11 §3, §7]

15 ticket types (order status, delivery delay, NDR, address change, cancel, return, refund status, replacement, missing/damaged, recommendation, education, COD→prepaid, payment-failed-but-debited, coupon, complaint). Flow: **classify** (NLP) → **pull commerce truth** (order/RFM/LTV/shipment/payment/consent/policy) → **policy/permission check** → **estimate impact** → **resolve autonomously** (high-confidence + low-risk) / **draft** (medium) / **escalate** (low or high-impact) → **log** (to ticket + Decision Log; feeds RFM/segment memory). Hard "never"s: never invent delivery status, promise outside policy, reveal margin/scores, continue after a human is requested, send without consent, or take an irreversible financial action above cap. Confidence start 0.85, tuned per type; autonomous-resolution target >60% by month 6, >75% by month 12.

### 7.9 Failure recovery (agent runtime)

- The **07:20 Morning Brief SLO is sacred** → gateway fallback chain → degrade to SQL+ML brief.
- PII redaction before any gateway call; **prompt-injection defense** on all agent inputs (skill `prompt-injection-defense`).
- Per-workspace LLM budgets via gateway virtual keys (soft-throttle non-critical, never break the critical path).
- Every agent action is idempotent + Decision-Log'd; partial reversibility (stop future sends); auto-revert on reversal/error breach.
- Memory is workspace-scoped (no cross-brand leak; benchmarks k≥5).

---

## 8. User, Organization & Permission System — [TECH/09 §1; TECH/00 R2; technical-context §5]

### 8.1 Tenancy hierarchy

**Organisation → Brand/Workspace → Store/Channel/Integration → records.** Workspace = tenant = brand = billing unit. Account structures: single-brand · multi-brand group (isolated per brand) · agency-managed (scoped, tagged) · enterprise overlay (residency, SLA, approval matrices).

### 8.2 `workspace_id` enforced at 4 layers (the isolation spine)

1. **JWT (Supabase)** carries `user_id`, `active_workspace_id`, `role`, and the accessible-workspace list.
2. **api-gateway** validates the JWT and propagates `workspace_id`/`user_id`/`request_id` via gRPC metadata; `requireRole(ctx, ws, minRole)` on **every mutation**.
3. **Postgres RLS** on every workspace-scoped table (`workspace_id = current_setting('app.workspace_id')`).
4. **ClickHouse query gateway** rejects any query without a `workspace_id` predicate. Redis keys + S3 paths are workspace-scoped; Kafka consumers assert `workspace_id` from the envelope.

This is the single most important invariant to never miss; missing it is a Shreya (security) VETO surface.

### 8.3 RBAC — the 5 canonical roles (R2)

`viewer`(1) → `analyst`(2) → `agency`(3, scoped+tagged) → `operator`(4) → `owner`(5). Level-ordered; `requireRole` enforces a **minimum level** on every mutation. **There is no `admin` role** (the 4-role owner/admin/analyst/viewer model was explicitly rejected).

| Role | Lvl | Scope |
|---|---|---|
| Viewer | 1 | Limited reports only; **no PII**, no exports, no actions |
| Analyst | 2 | Read dashboards + comment; no approvals/settings/outbound |
| Agency | 3 | **Scoped** per-brand read/write as granted by Owner; **every action tagged + audited** |
| Operator | 4 | Operational write, approve/reject, lifecycle campaigns, inbox; cannot change billing or delete the brand |
| Owner | 5 | Full control — billing, integrations, users, costs, **auto-execute enablement**, consent transitions, agency invites, deletion |

### 8.4 ABAC — the per-action approval matrix

On top of RBAC, **ABAC** governs *what* a role can do *to what* under *which conditions*: the per-action approval matrix (e.g. increase ad budget = Owner by default; issue refund = Owner or Operator within cap; enable auto-execute = Owner only), feature flags, agency per-brand scoping, action caps, and auto-execute policies (`ai.auto_execute_policies`). Enforced in `application/` use-cases — never in an in-process map. Agency context: an agency user has `core.workspace_members` rows per brand with potentially-different roles; the JWT carries the *current* workspace+role; switching workspaces re-issues the session; every agency action is tagged + audited.

### 8.5 Authentication architecture — [TECH/09 §1, §8a]

- **Provider:** Supabase Auth. **Methods:** email/password, magic link, Google OAuth, **SSO/SAML + SCIM** (enterprise). MFA (TOTP) optional for owners Phase 3, mandatory for enterprise Phase 4.
- **JWT claims:** `sub`, `email`, `app_metadata` (`active_workspace_id`, workspaces+roles, `is_admin`), `iat`, `exp`. **Access token ~1h; refresh token ~30d (rotated on use).**
- **Web:** HttpOnly + Secure + SameSite=Lax cookies. **Mobile:** refresh token in `expo-secure-store` (Keychain/Keystore, `WhenUnlockedThisDeviceOnly`), access token in memory only (cold start forces a refresh round-trip).
- **Workspace switching** re-issues a JWT with the new `active_workspace_id`; the gateway validates the match on every call. Account lockout: 5 fails/15min → 15-min lock; 10/hr → 1-hr lock.

### 8.6 Session management, audit & compliance

- **Sessions** are JWT + refresh-token; revocation/invalidate-all supported (`supabase.auth.admin.signOut(userId, 'global')`).
- **Audit:** `audit.audit_log` is **WORM** (append-only, 7-year retention); every mutation writes an audit row; admin/agency actions land in the workspace Owner's audit log.
- **Compliance** (the permission system's legal backstop): consent primitive per customer/channel/purpose/source/timestamp/region/withdrawal; right-to-deletion (30-day soft → 90-day hard purge, audit retained 7y); India in-region by default (§11.4).

### 8.7 Feature permissions & tenant isolation strategy

Feature access = role level × ABAC flags × plan tier (billing). Tenant isolation is structural (the 4 layers, §8.2), not advisory; Phase 3+ enterprise can graduate to per-workspace ClickHouse databases / dedicated shards for hard isolation contracts.

---

## 9. Engineering Architecture & Development Standards — [TECH/00, TECH/17; technical-context §15–16]

### 9.1 Repository / monorepo structure — [TECH/00 §2.1, §3.4]

**Turborepo + pnpm (TS) · uv workspace (Python) · Buf (proto→TS+Python codegen).** Top-level layout:

```
apps/        web · mobile · api-gateway · core-service · ingestion-service ·
             analytics-service · intelligence-service · lifecycle-service ·
             notifications-service           # all product code under apps/
packages/    TS shared libs (lib-metrics, ui, config, eslint-config, …)
pylibs/      Python shared (brain_metrics, brain_clickhouse, brain_regional,
             brain_cost_router, …)
protos/      buf-managed gRPC + Avro event schemas (the contract source of truth)
```

> **Convention:** Brain product directories are `apps/<service>` (canon convention). `controllers/services/models` refers only to the DDD *anti-pattern* phrase, never a directory.

### 9.2 Folder organization inside a service (DDD)

`bootstrap/ · domain/ · application/ · infrastructure/ · interfaces/` (§2.3). A `controllers/`-style technical-layer folder is a code-review blocker.

### 9.3 Coding standards & service templates

- **TS:** Node 24 LTS, Fastify + tRPC, Zod at every boundary, Prisma 7, `strict` TS. **Python:** 3.13, FastAPI/gRPC, Pydantic, `uv`, `mypy`. (OS-tooling Python is pinned 3.12 for sqlite-vec — that is the *plugin*, not Brain product code.)
- **Money is always integer minor units + `currency_code`** — never float/NUMERIC.
- **Every compute path declares `@paradigm(...)`.**
- A new service is scaffolded DDD-structured, owning its own schema, with its own proto contract, health probes, and **its own CI/CD pipeline from day one** (§9.7, Appendix C item).

### 9.4 API standards — [TECH/06]

- **tRPC** (web+mobile, same router): procedure tiers `public → authed → workspace → owner`; **cursor pagination (OFFSET banned in prod)**; money = `bigint` minor units + `currency_code` (superjson); SSE/WS for chat + live dashboards; mobile-additive procedures only (`registerPushToken`, `minVersion`, `featureFlags`).
- **gRPC** (internal, buf): `WorkspaceService`, `MetricsService` (incl. `StreamMetricUpdates`), `IntelligenceService` (incl. bidi `Chat`), `NotificationsService`, `IntegrationsService`, `LifecycleService`; metadata `x-workspace-id/x-user-id/x-request-id/x-traceparent`; `TenancyInterceptor` rejects missing workspace.
- **MCP** in api-gateway (shares auth/tenancy/rate-limit; proto-derived schemas; default read-only; writes auto-log to Decision Log).
- **Public REST** (Phase 4) = a thin tRPC adapter; hashed bearer tokens + HMAC-signed outbound webhooks.
- **Error codes** are a stable contract for the frontend (`UNAUTHORIZED`, `TOKEN_EXPIRED`, `INTEGRATION_AUTH_EXPIRED`, `INSUFFICIENT_DATA`, `BUDGET_EXCEEDED`, `RATE_LIMIT_*`, …).
- **Versioning:** tRPC = lockstep web/app deploy; gRPC = field-number discipline (no breaking change); REST = `/api/vN`; Kafka = topic `.vN`.

### 9.5 Event naming & schema standards

Topic `<domain>.<entity>.<event>.vN`; partition key `workspace_id`; the standard 10-field envelope; Avro in `protos/events/` + Glue Schema Registry; backward-compatible additions in-version, breaking → `.v(n+1)` + dual-write. Schema/contract changes auto-load the Architect (Aryan) in the build pipeline.

### 9.6 Testing strategy — [technical-context §15; TECH/17]

- **Unit:** Vitest (TS) + RTL (components); pytest + mypy (Python).
- **Contract:** `buf breaking` (gRPC), Pact (REST partners), Zod (tRPC), MCP-schema parity.
- **Web E2E:** **Playwright** (`e2e/*.spec.ts`, `getByTestId`, cross-browser + trace viewer + sharding) — the same engine drives the `/qa-browser` exploratory walk and the durable regression spec.
- **Mobile:** Detox. **Load:** k6.
- **Mandatory for PASS:** real-network smoke; metric-registry **TS↔Python parity**; tests for success + permission-failure + stale-data + provider-failure + idempotency; **mutation tests on high-stakes paths** (metric registry, compliance engine, Decision Log).

### 9.7 CI/CD, IaC, environments, secrets — [TECH/00 §3.4; devops]

- **CI/CD:** GitHub Actions → ECR → **ArgoCD** (services) + **EAS** (mobile). **Selective per-service deploy from day one:** `turbo --affected` (graph-aware, catches transitive dependents) → build/push only affected images → each service has its **own ECR image + own ArgoCD Application** (base + staging/prod overlays) → only the changed service (+ dependents) syncs. A shared-package/proto change = `deploy_class=library` fan-out to consumers.
- **IaC:** AWS CDK (TypeScript). Not Terraform/Pulumi.
- **Environments:** staging mirrors prod; migrations run on staging on every PR, prod gated by approval; canary + 48h monitor + auto-rollback on deploy.
- **Secrets:** AWS Secrets Manager + KMS (envelope encryption of vendor tokens); IAM/IRSA for service identity; DB connections via IAM auth tokens (no static passwords); secret rotation per `security-baseline`.

### 9.8 Engineering workflow, branching, releases, rollback — [TECH/17]

- **The 8-stage pipeline builds Brain:** 1 intake (Rohan +0–2 personas) → 2 binding plan (Aryan) → 3 parallel build (Vikram/Ananya/Karan/Maya) → 4 security VETO (Shreya) ∥ 5 QA VETO (Tanvi) → 6 final review VETO (Rohan) → 7 Founder `/approve` → 8 deploy + 48h monitor + auto-rollback (Jatin). Lanes: express / standard / high-stakes by risk.
- **Plan-binding:** stages 3–8 execute the Stage-2 plan; deviations route through Aryan's amendment loop — never freelancing. PLAN-phase web research (WebSearch/WebFetch) is allowed in Stage 1–2 only.
- **Commit discipline:** agents stage product code (explicit paths, never `git add -A`); the **Founder commits product code**; agents commit only `.engineering-os/` as `chore(eos):`; never rewrite history.
- **Branching/release:** feature branches → PR → the pipeline gates → merge; per-feature journals; PM emits release notes at Stage 8.
- **Rollback:** every deploy has a canary + auto-rollback; every action has a reversibility/rollback path; the 48h monitor watches the SLOs.

---

## 10. Observability & Reliability — [TECH/09 §10–13, §16]

### 10.1 The one correlation ID

`request_id` + `trace_id` + `workspace_id` + `user_id` propagates **HTTP headers → gRPC metadata → Kafka envelope → LLM call**. TS = pino + AsyncLocalStorage; Python = structlog + contextvars; ClickHouse queries carry `SETTINGS log_comment='<request_id>'` so `system.query_log` is searchable by request. **Missing traceability is a security VETO.**

### 10.2 The observability stack (five pillars)

- **Logs:** pod stdout → Fluent Bit → OpenSearch (hot 14d) + CloudWatch (warm 30d) + S3 (cold 1y); PII-redacted at the logger + Fluent Bit.
- **Metrics:** CloudWatch namespaces per service (`Brain/Gateway`, `Brain/Analytics`, …, `Brain/Business`).
- **Traces:** OpenTelemetry SDK → X-Ray via the **ADOT** exporter (X-Ray's native exporter is EOL); 5% sampling healthy / 100% on error; W3C `traceparent`.
- **Errors:** Sentry (front + back), source maps, p95-regression alerts.
- **Product analytics:** PostHog (DAU, funnels, session replay).

### 10.3 What's tracked (KPIs)

API p50/95/99 + error rate, Kafka consumer lag, connector freshness, ClickHouse query duration/bytes, Redis hit-rate, **LLM tokens/cost by workspace+feature**, agent run success, Decision-Log write success, auto-execute count/failures/reversals, WhatsApp delivery/reply/conversion, ticket FRT/CSAT, and **DND/compliance violations**. Alert thresholds: error rate >50/min, auth failures >100/min (attack), Kafka lag >30s, and the named patterns `CrossTenantAccessAttempt` / `RLSPolicyDenied`.

### 10.4 SLOs (the consolidated targets) — [technical-context §14]

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

(Per-phase latency targets tighten over time — Phase 1 looser, Phase 4 at 100k req/min stricter — [TECH/09 §12].)

### 10.5 Reliability mechanics

- **Health probes (4 per service):** liveness · readiness · startup · deep (downstream connectivity).
- **DLQ:** failed Kafka messages → `<topic>-dlq` + replay tool.
- **Circuit breakers + timeouts** at the gateway for downstream calls; degrade to cached reads.
- **Auto-scaling:** EKS + Karpenter bin-packing (Fargate early); per-connector concurrency caps.
- **Error budgets / burn-rate:** SLO-violation policy → Sev3 review → Sev2 incident on sustained burn.
- **Incident management:** severities SEV1 <15min ack / SEV2 <1h / SEV3 <4h / SEV4 <1bd; on-call rotation (Phase-scaled); blameless postmortems (`blueprints/postmortem.md`); every service ships a runbook (`blueprints/runbook.md`).

---

## 11. Security Architecture — [TECH/09 §5, §8, §16; TECH/16]

### 11.1 API & edge security

api-gateway is the **single front door + policy enforcement point**: JWT validation, tenancy, RBAC/ABAC, rate-limit, WAF. Rate limits (Redis): per-user 1,000 RPM reads / 100 RPM mutations / 50 RPM AI-chat / 5 concurrent exports; per-workspace 5,000 / 500 / 200 / 20; CloudFront + AWS Shield apply 10,000 RPM/IP + geo + bot rules. OWASP Top 10:**2025** baseline.

### 11.2 Service-to-service authentication

Network: VPC security groups + Kubernetes NetworkPolicies. App (Phase 2+): **service mesh (Istio/App Mesh) with mTLS**, SPIFFE-style auto-rotated pod identities. gRPC metadata + `TenancyInterceptor` on every internal call. DB: IAM auth tokens (15-min, auto-refreshed) — no static passwords.

### 11.3 Encryption standards

- **At rest:** AES-256 everywhere (RDS/Supabase, ClickHouse, S3 SSE-S3/SSE-KMS, MSK, EBS) via KMS.
- **In transit:** TLS 1.2+ everywhere, HSTS; internal gRPC TLS via mesh (Phase 2+); Kafka TLS + SASL/AWS_MSK_IAM.
- **KMS envelope encryption** for workspace credentials (OAuth tokens): GenerateDataKey → encrypt token with the DEK (AES-256-GCM) → store ciphertext + KMS-wrapped DEK + ARN; decrypt path unwraps the DEK. **Plaintext tokens are never logged.**
- **Mobile:** TLS **cert pinning** (current + rotation backup pin + kill-switch fallback); **MASVS L1 + key L2** controls.

### 11.4 PII handling & the "never store" list

**Never store:** card numbers, CVV, full UPI IDs, full bank accounts, plaintext passwords, national IDs (Aadhaar), special-category data, full customer addresses unless explicitly required+approved (default **pincode/city-level**), PII in logs. **Handling:** hash email/phone by default; plaintext only where outreach is enabled + consent/legal basis exists; redaction at the logger + Fluent Bit; per-workspace KMS; call recordings only with consent; **India data in-region (ap-south-1) by default** (DPDP + KSA/UAE transfer restrictions). Right-to-deletion: 30-day soft → 90-day hard purge (raw/canonical/derived/AI), audit retained 7y.

### 11.5 Tenant isolation, threat protection & audit

4-layer `workspace_id` enforcement (§8.2) is the anti-cross-tenant control; SQL-injection blocked by parameterized queries + CI lint; XSS by React escaping + CSP (no `dangerouslySetInnerHTML`); CSRF by SameSite + Origin checks; replay by JWT iat/exp + single-use refresh + nonces; Shopify webhooks by HMAC; insider exfiltration by audited RLS-bypass + quarterly reviews. Audit trail = WORM `audit.audit_log` (7y). Threat-model template: `blueprints/threat-model.md` (STRIDE).

### 11.6 Compliance readiness — [TECH/16]

- **India DPDP Act 2023 + Rules 2025** (phased to ~May 2027): consent-based, minimization, retention limits, erasure, breach notification; Consent-Manager-compatible ~Nov 2026.
- **India telecom TCCCPR (amended 12 Feb 2025):** **DLT** registration for A2P SMS/voice (per-brand entity, never commingled), **NCPR/DND** scrubbing, **9am–9pm** promotional window.
- **UAE PDPL & KSA PDPL** (KSA enforced Sep 2024): explicit revocable opt-in, erasure, cross-border restrictions.
- **Channel-specific:** WhatsApp = Meta opt-in + approved templates + free service window (24h customer-service reply; 72h ad-click entry-point) + per-message pricing by category; SMS/voice = DLT + NCPR/DND + calling hours; AI voice = disclosure + human handoff + recording consent.
- **Consent primitive:** per customer/channel/purpose/source/timestamp/region/withdrawal (append-only; opt-out overrides all marketing). Cross-brand benchmarks aggregate-only, k≥5, opt-in.
- **Compliance SLO: 0 DND/out-of-window violations, 0 cross-brand leaks.** Shreya (security reviewer) holds **VETO** on any compliance violation.

### 11.7 AI safety guardrails

PII redaction before any gateway call; **prompt-injection defense** on agent inputs; `agentic-actions-auditor` on action tools; LLMs never produce metric numbers (deterministic registry); recommendation-only-until-graduated; auto-execute caps + kill switch + auto-revert; the Decision Log records every AI action for accountability.

---

## 12. Workflow & Execution Validation

Before any slice is "done," validate the whole system holds together. This is the checklist the build pipeline (and reviewers) reason against.

### 12.1 End-to-end engineering flow (no break at any stage)

A requirement flows: **Founder `/requirement` → Rohan intake (lane + 0–2 personas) → Aryan binding plan → parallel build (Vikram/Ananya/Karan/Maya) → Shreya security ∥ Tanvi QA → Rohan final review → Founder `/approve` → Jatin deploy + 48h monitor.** Gates are real (each re-verifies, not rubber-stamps); bounces are automatic on gate failure; the Decision-Log/journal trail is produced at every hop. Subagents do not spawn subagents — orchestration is top-level (the `/requirement` loop), agents return a `HANDOFF` block + update `state/active.json`. **No workflow deadlock:** every lane has a terminal path to the Founder gate; pause/resume is explicit state.

### 12.2 Service-interaction flow (the five canonical E2E flows) — [TECH/18 §5]

- **A — Onboarding & ingestion:** core registers + KMS-encrypts creds → ingestion backfills + webhooks → canonicalize → fan to S3+CH+Kafka(+mirror) → analytics materializes + `order_costs` → "estimated until ≥80% SKU-cost coverage" → health/alerts.
- **B — Daily heartbeat → Morning Brief (SLO):** 06:55 freshness → 07:00 fingerprint → 07:05 memory k-NN → 07:10 15 agents ∥ (Decision-Log row each) → 07:15 frontier synthesis → push by 07:20 IST.
- **C — Approve → execute → attribute (the moat loop):** approve → Decision-Log `approved` → lifecycle build audience (once) → compliance gate (consent+DLT+9–9+caps) → route → personalize → execute → 7d/30d attribute back into the same row + condition→outcome memory.
- **D — NL query / AI chat:** question → `IntelligenceService.Chat` tool-use over deterministic metric tools (≤5 calls) → streamed answer with formulas (numbers from analytics, never invented).
- **E — Auto-execute (Phase 3):** enabled class + confidence ≥ threshold + caps/consent/freshness pass → execute → Decision Log + `ai.auto_execute_log` → Reverse button → auto-revert on breach; Owner kill switch in 60s.

The **Decision Log is the spine of every flow**; `workspace_id` rides every hop; Kafka ∞-retention makes every materialization rebuildable.

### 12.3 Validation gates (what we explicitly confirm) — the no-X checklist

- **No architectural bottleneck:** stateless gateway autoscales; ingestion/analytics/intelligence scale independently; ClickHouse shards by workspace; the early Postgres-mirror bottleneck is bounded to Phase 0–1 + capped writers.
- **No ownership confusion:** one writer per store (§4.7); cross-service data only via gRPC/Kafka; DDD boundaries enforced.
- **No workflow deadlock:** every pipeline lane terminates at the Founder gate; the state machine has no dangling status; parallel Security∥QA rejoins deterministically.
- **No tight coupling:** services share *infra* (Redis/MSK/S3), never schemas; proto contracts decouple producers/consumers; the LiteLLM gateway decouples the model backend.
- **No agent-memory inconsistency:** memory is workspace-scoped + RLS'd; the fingerprint-at-decision is captured at write time; outcome backfill is idempotent; cross-brand only via k≥5 aggregates.
- **No prompt/tool drift:** MCP tool schemas are generated from the same protos as gRPC (cannot drift); model swaps are eval-gated.
- **No improper boundary:** the day-one DoD (§Appendix E) + the service-readiness DoD (§Appendix, TECH/18 §7) gate every service.

### 12.4 Real-world scalability & team feasibility

The 3-deployable Phase 0–1 footprint runs lean (Fargate + MSK Serverless + managed ClickHouse) so a small team ships fast; the proto contracts make the Phase-2 split to 7 services mechanical (a context graduates when its deploy cadence/scaling diverges or the team grows past ~4 engineers). Selective per-service deploy means a change to one service redeploys only that service + transitive dependents — parallel development across teams without a deploy-all bottleneck.

### 12.5 AI-orchestration, memory & production-readiness consistency

Agent orchestration is deterministic (parallel fan-out → Top-3 → one synthesis), bounded (token budgets + ≤5 tool calls in chat), and recoverable (gateway fallback → SQL+ML degrade). Memory consistency is enforced by the write-time fingerprint capture + idempotent nightly attribution. Production-readiness is the service-readiness DoD (DDD, own schema, 4-layer tenancy, `@paradigm`, minor-units money, idempotent events + DLQ, 4 health probes, end-to-end tracing, runbook + SLO, graceful degradation, reversibility, contract tests, **own CI/CD from day one**).

---

## 13. Deliverables — consolidated reference

*(Full detail lives in §1–§12 above + the cited canon. This section is the quick-reference index.)*

### 13.1 Architecture diagrams (logical descriptions)

- **Logical layering:** 10 product layers → 7 bounded contexts + 2 clients + LiteLLM gateway (§2.1).
- **Topology:** Phase 0–1 = 3 deployables (`edge`+`data`+web+mobile) → Phase 2 = 7 services (§2.1–2.2).
- **Comms matrix + sequence diagrams:** the full who-talks-to-whom + Flow B (daily tick) + Flow C (approve→execute→attribute) ASCII sequence diagrams are in **[TECH/18 §4, App C]**.

### 13.2 Service-by-service breakdown

See §2.2 (ownership table) + **[TECH/18 §3]** (nine dimensions per service) + **[TECH/18 App A]** (per-service data ownership + key tables).

### 13.3 Data-flow & event-flow explanations

Data flow: ingestion 3–4-sink fan-out (§3.5) → analytics canonical+derived (§4.3) → intelligence memory + agents (§6–7). Event flow: the Kafka topic catalog with payload contracts is **[TECH/18 App B]**; the five E2E flows are §12.2.

### 13.4 Suggested tech stack (locked)

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm (TS) · uv (Python) · Buf |
| Web | Next.js 16 (React 19, Turbopack, React Compiler, Server Actions) · tRPC · TanStack Query · nuqs · Redux Toolkit · shadcn/Tailwind · Recharts + Visx · Magic UI (scoped) |
| Mobile | React Native + Expo SDK 56 (New Arch, Hermes v1) · Expo Router · Tamagui · victory-native · expo-secure-store · Expo Push · EAS |
| Runtimes | Node 24 LTS · Python 3.13 · Kafka client @confluentinc/kafka-javascript · Prisma 7 |
| Edge/API | Fastify + tRPC + MCP server · Zod |
| Internal | gRPC over Protobuf (buf) · Pydantic |
| OLTP | Postgres (Supabase) + pgvector (HNSW) |
| OLAP | ClickHouse Cloud (managed, ap-south-1) → BYOC → self-host (cost ladder) |
| Cache | Redis (ElastiCache) |
| Object store | S3 |
| Events | Amazon MSK (Kafka) + Glue Schema Registry (Avro) + Debezium CDC |
| Intelligence | LiteLLM gateway → Claude default (Sonnet 4.6 / Haiku 4.5), model-agnostic + eval-gated · Prophet/sklearn/PyMC-Marketing/lifelines/XGBoost/statsmodels |
| Infra | EKS + Karpenter (Fargate early) · AWS CDK · GitHub Actions → ECR → ArgoCD · EAS · ap-south-1 |
| Observability | OpenTelemetry → CloudWatch/X-Ray (ADOT) · Sentry · PostHog · OpenSearch |
| Secrets | AWS Secrets Manager + KMS |
| Testing | Vitest + RTL (unit) · Playwright (web E2E) · Detox (mobile) · k6 (load) · buf/Pact/Zod (contract) |

> Stack is **LOCKED** ([TECH/00 §5]). Use `tech-stack-evaluation` only for a layer not in the stack (e.g. the AI-calling vendor). Not Terraform/Pulumi; not Nx; not Zustand; not a separate vector DB.

### 13.5 Infrastructure, database & deployment recommendations

- **Infra:** AWS, ap-south-1, CDK-defined; Fargate → EKS+Karpenter at the Phase-2 trigger; MSK Serverless → provisioned MSK; managed ClickHouse → BYOC → self-host on the cost ladder.
- **Databases:** the §4.10 decision table (Postgres OLTP + pgvector memory; ClickHouse OLAP; Redis cache; S3 lake; Kafka spine).
- **Deployment:** selective per-service (`turbo --affected` → own ECR → own ArgoCD Application) + canary + 48h monitor + auto-rollback; mobile via EAS (OTA for JS-only, store review for native bumps). Full mechanism in `devops-aws` + Appendix C.

### 13.6 AI architecture / memory architecture / engineering workflow

AI = §5 (analytics/ML/cost-routing) + §7 (agentic). Memory = §6. Engineering workflow = §9.8 (the 8-stage pipeline + commit discipline + branching/release/rollback).

### 13.7 Production scaling considerations

- Scale the **stateless gateway** horizontally; scale **ingestion** by connector concurrency; scale **analytics** by ClickHouse sharding (Phase-3 trigger); scale **intelligence** by Karpenter bin-packing the bursty agent fan-out.
- Cost scaling: cache-aside (every cached metric is a saved ClickHouse/LLM call); per-workspace LLM budgets; the 85/12/2.5/0.5 paradigm mix; prompt caching; the ClickHouse managed→BYOC→self-host cost ladder.
- Tenancy scaling: per-workspace ClickHouse DB / dedicated shard at the Phase-4 enterprise trigger.
- Region scaling: `workspace.home_region` + RegionAdapter → multi-region at Phase 4 (infra change, not a fork).

---

## Appendix A — Phase roadmap — [BRD §11]

| Phase | Theme | Headline deliverables |
|---|---|---|
| **0 Foundation** | Multi-tenant + truth | Tenancy model, core integrations, cost setup, metric engine + CM waterfall, Store Analytics, Decision Log, integration health, basic Morning Brief, India adapter, audit log |
| **1 Operator Wedge** | The daily habit | High-freq Home, MER/aMER, RTO/COD/pincode, RFMC, WhatsApp abandoned-cart + COD-confirm, Weekly Review, first-product cascade, support classification, UAE/GCC adapter foundations |
| **2 Lifecycle & AI CX** | The moat arm | Shared audience builder, WhatsApp campaigns, replenishment/winback/VIP, AI ticket mgmt, support→commerce loops, inventory/logistics queues, creative/budget recs, Plan/scenario; split to 7 services |
| **3 Agentic Execution** | Safe autonomy | Auto-execute + kill switch + reversal + outcome-accuracy dashboard + advanced guardrails |
| **4 Scale & Enterprise + UAE/GCC live** | Multi-region | Portfolio rollups, enterprise controls, advanced benchmarking, custom integrations, residency, approval matrices, retail-aware extensions, mature UAE/GCC |

## Appendix B — Graduation triggers (build the seam now, the heavy layer later) — [TECH/00 §3.3; TECH/18 §6]

| Deferred capability | Default until | Trigger to adopt |
|---|---|---|
| Split `edge`/`data` → 7 services | Phase 2 | Independent deploy cadence / diverging scaling / team >~4 |
| EKS + Karpenter (from Fargate) | Phase 2–3 | Fargate cost >~$1.5–2K/mo, or need bin-packing |
| Provisioned MSK (from Serverless) | Phase 2 | Sustained throughput, or need Debezium + tiered storage |
| Debezium CDC | Phase 2 | >1 consumer needs the 90-day mirror in ClickHouse |
| Postgres read replica | Phase 2 | Analytics/backfill reads contend with OLTP |
| ClickHouse sharding | Phase 3 | Single-shard p95 misses target |
| Service mesh (mTLS) | Phase 2–3 | >~5 services need automatic mTLS |
| Knowledge graph (Neptune/Neo4j) | Phase 3+ | Multi-hop relationship queries prove out |
| Feature store + MLflow | Phase 3 | Model count / cadence justify the ops |
| Durable workflow engine (Temporal/Step Functions) | Phase 3 | Long-running sagas get hard to reason about |
| Multi-region | Phase 4 | First UAE/GCC/EU residency customers |
| Per-workspace ClickHouse DB / dedicated shard | Phase 4 | Enterprise hard-isolation contract |
| Public REST API + outbound webhooks | Phase 4 | Partner/enterprise programmatic access |

## Appendix C — Day-one non-negotiables (cheap now, brutal to retrofit) — [TECH/00 §3.4; technical-context §1]

1. `workspace_id` on every row/event/cache-key/log + Postgres RLS + ClickHouse query-gateway.
2. Integer **minor-units money** (BIGINT/Int64) + `currency_code`. Never float/NUMERIC.
3. **Decision Log** append-only schema (`ai.decision_log`).
4. **Region-adapter** interface (even with only India).
5. **Metric registry** with TS↔Python parity (one definition per metric; CI-enforced).
6. **Cost-routing `@paradigm`** discipline + per-workspace LLM caps.
7. **OLTP/OLAP split** (Postgres + ClickHouse) from the first dashboard.
8. **Proto-defined gRPC contracts** for every bounded context.
9. **Idempotency** on every connector write + mutating endpoint.
10. **Mobile Morning Brief** as the primary surface (Phase 1).
11. **Per-service CI/CD from day one** (`turbo --affected` → own ECR → own ArgoCD Application → canary + auto-rollback; deploy only the changed service + transitive dependents).

## Appendix D — Anti-patterns (code-review blockers) — [TRD §26; technical-context §16]

Per-channel audience/consent/attribution/profile fork · agent recs without a Decision Log write · lifecycle sends without attribution · **LLM-generated metric numbers** · region-specific forks of metric code · **NUMERIC/float money** · single blended tax rate (must be per-SKU slab) · billing on placed (not realized) GMV · integration "healthy" because auth works but data is stale · auto-execute without kill switch · **frontier-LLM where SQL/ML suffices (paradigm bypass)** · `controllers/`-style folders · **OFFSET pagination in prod** · cross-brand data visible to another brand · sequential DB queries in a layout (use `Promise.all`) · service-to-service REST (use gRPC sync / Kafka async).

## Appendix E — Definition of Done (Tanvi + Rohan gate on this) — [technical-context §15; TECH/18 §7]

A task is **done** only when it: uses Brain-only language · carries `workspace_id` isolation (4 layers) · reuses shared primitives (no per-channel forks) · **writes to the Decision Log** if it's a recommendation/action/lifecycle-send/support-resolution/outcome · has RBAC checks (`requireRole` on mutations) · declares its **`@paradigm`** · uses **minor-units money** · handles regional behavior via the **adapter** · has tests for success + permission-failure + stale-data + provider-failure + idempotency · emits structured logs + metrics with the **correlation ID** (trace-instrumented end-to-end) · degrades gracefully on missing/stale data · has a reversal/rollback path where possible · is documented for the next builder. **Real-network smoke is mandatory for PASS; metric-registry TS↔Python parity preserved; mutation tests on high-stakes paths.** A *service* is production-ready only when it additionally: is DDD-structured, owns its schema, exposes the 4 health probes, has a runbook + an SLO with an error budget, passes contract tests, and **ships with its own CI/CD pipeline from day one** ([TECH/18 §7]).

---

*End of blueprint. The canon is the source of truth; this document is the buildable index into it. When they disagree, the canon wins — re-read `technical-requirements.md` + the relevant `TECH/NN_*.md`.*
