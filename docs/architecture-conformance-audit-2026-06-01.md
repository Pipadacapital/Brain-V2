# Brain — Architecture Conformance Audit & Roadmap

**Date:** 2026-06-01 · **Auditor:** Engineering OS (evidence-based, 6 parallel code audits)
**Baseline spec:** `requirements/technical-context.md` (condensed canon) + the Founder-supplied "Technical / Solution Architecture" brief.
**Method:** every claim below is backed by on-disk file evidence, not the team's prior self-assessment (`docs/architecture-compliance.md`, which this supersedes for runtime/topology questions).

---

## 0. Verdict in one paragraph

Brain's **architectural invariants and contracts are real, wired, and tested** — money in integer minor units, 4-layer `workspace_id` isolation, metric-registry TS↔Python parity (CI-enforced with killed-mutant gates), proto-first gRPC+codegen, the `@paradigm` cost-routing gate, the append-only `ai.decision_log` with live writers, pgvector memory with k≥5 anonymity, LiteLLM-only LLM access, cursor pagination, bigint-over-superjson, correlation-ID observability, and a production-grade Morning Brief mobile surface. **What is NOT yet true is the microservices *runtime topology*** the Founder asked about: services are **not independently buildable / deployable / runnable**, and there is **one shared Postgres**, not a database per service. Critically, **this is consistent with the team's own documented Phase-0/1 plan** ("logical separation now, physical separation later") — but (a) even Phase-0/1 is only ~60% executed, and (b) the Phase-2 physical split that delivers true independence has not started. The gaps are **mechanical, not architectural**: the seams (protos, DataPlanePort, schema ownership, Kafka envelope) are in place to make the split a config-and-packaging exercise rather than a rewrite.

---

## 1. Conformance scorecard (by spec area)

| # | Spec area | Verdict | Note |
|---|-----------|---------|------|
| Invariant 1 | `workspace_id` 4-layer isolation (JWT→gateway→RLS→CH gateway) | ✅ | All 4 real + fail-closed; CH gateway raises `UnscopedQueryError`; killed-mutant test. |
| Invariant 2 | Money = integer minor units + currency_code | ✅ | Zero NUMERIC/float on money; `formatMoney` single source; bigint over superjson. |
| Invariant 3 | `ai.decision_log` append-only schema + writer | ✅* | Real table + append-only trigger + 2 live writers in intelligence-service. *Post-exec fields (outcome_7d/30d, attributed/recovered revenue) + MCP-write auto-log middleware NOT yet present. |
| Invariant 4 | RegionAdapter interface (India impl) | 🟡 | India GST 2.0 per-SKU tax is real & fail-closed; but the `get_adapter(region)` **interface/factory is not coded** — only India functions exist. Seam is informal. |
| Invariant 5 | Metric registry TS↔Python parity | ✅ | 47 TS / 49 Py metrics; byte-identity + F3 carry-forward + killed-mutant CI gate (`tools/check-metrics-parity.sh`). |
| Invariant 6 | `@paradigm` cost-routing + per-workspace caps | ✅* | Decorator real + runtime-enforced (contextvar gate); per-workspace ₹-cap meter real. *CI/PR audit that blocks "cheaper tier would suffice" is **absent** (no `.github/workflows/`). |
| Invariant 7 | OLTP/OLAP split (Postgres + ClickHouse) | ✅ | Both present; analytics owns CH; clean. |
| Invariant 8 | Proto-defined gRPC contracts | ✅ | `protos/` is canonical; buf → TS (`lib-grpc-clients`) + Python (`brain_grpc`); reproducible. |
| Invariant 9 | Idempotency everywhere | ✅ | Decision-log unique key; webhook idempotency anchor; client idempotency keys. |
| Invariant 10 | Mobile Morning Brief primary surface | ✅* | Screen real, render-only, WCAG-AA, secure-store, 3-signal rule. *Server-side synthesis orchestration + push send NOT wired. |
| §Comms | frontend→gateway only (tRPC) | ✅ | Web + mobile use tRPC only; zero axios to services. |
| §Comms | gateway→service via gRPC | 🟡 | Contracts + clients exist; **Phase-0/1 runs in-process loopback** (localhost), gRPC servers are HOLD-AT-CUTOVER (not started). |
| §Comms | service↔service via Kafka (never REST, never shared DB) | 🟡 | No service-to-service REST (good); Kafka **envelope + producer wired but no broker**, no DLQ; **shared DB present** (see §2). |
| §Comms | all LLM via LiteLLM gateway | ✅ | No direct Anthropic SDK; small_llm/frontier_llm policy tiers. |
| §AI | 15 product agents | 🟡 | **1 of 15** built (PnL insight agent, read-only). Base class + 5 gates real. 14 deferred. |
| §AI | Daily Intelligence Loop (06:55→07:20 IST) | ❌ | No scheduler / `daily_tick` / `morning_brief` orchestration. Seams exist; loop unbuilt. |
| §AI | Auto-execute (Phase 3) | ❌→OK | Absent by design (Phase 3). Execution gates 3–5 already built. |
| §API | tRPC tiers + cursor pagination (OFFSET banned) | ✅ | 5 tiers; cursor-only; OFFSET ban enforced. |
| §API | MCP server in gateway (write→decision-log middleware) | 🟡 | `brain_mcp` is a Phase-2 placeholder; not wired. |
| §Tenancy | 5 roles + requireRole on mutations | ✅ | Real role hierarchy + `requireRole` on workspace mutations. |
| §Obs | correlation 4-tuple HTTP→gRPC→Kafka→LLM; PII redaction | ✅ | `lib-logger` correlation + 50+ redaction paths; tRPC tracing middleware. |
| §FE | Next.js App Router, state split, Visx/Recharts | ✅ | Real; Server Components default. |
| §Services | lifecycle-service, notifications-service | ❌→OK | Empty DDD scaffolds (Phase-2 by design). |

Legend: ✅ compliant · ✅* compliant with a named sub-gap · 🟡 partial · ❌ missing · ❌→OK missing-but-deliberately-deferred.

---

## 2. The Founder's question: independent build/deploy/run + database-per-service

**Finding: NOT met today. It is the Phase-2 target, and Phase-2 has not started.** Evidence:

### 2.1 Independent build — ❌ (2 of 9 apps buildable)
Only `api-gateway` and `web` have a **Dockerfile**. `core`, `lifecycle`, `notifications`, `analytics`, `ingestion`, `intelligence`, `mobile` have **no container image definition**. The 6 backend services therefore cannot be built/tagged/pushed.

### 2.2 Independent run — ❌ (2 of 9 apps have an entrypoint)
`api-gateway` (`src/interfaces/server.ts`) and `web` (`next start`) run. The Python services have **no `main`/bootstrap that starts a server**; ingestion has a gRPC server coroutine but it is explicitly `HOLD-AT-CUTOVER` (never invoked). `core-service` has **no standalone process at all** — it is imported **in-process** by `api-gateway` (`Dockerfile` copies `apps/core-service` into the gateway image and calls its use-cases as a library).

> Consequence: the spec line *"api-gateway… no business logic"* is violated **in deployment** — core's business logic runs inside the gateway process. The `DataPlanePort` seam exists to swap this to gRPC later, but today it is a 1-process modular monolith for the "edge" tier, and the "data" tier (Python) is not a running deployable at all.

### 2.3 Database-per-service — ❌ strict / 🟡 logical
There is **one Postgres instance** (`brain_dev`) and **every service connects with the same `DATABASE_URL`** (`rls_app@…/brain_dev`). The spec's mature-target rule is *"services never share a database."* Current reality is a **shared instance with clean bounded-context schema ownership**:
- core-service owns onboarding/connectors/connector-facts/customer-pii/config/audit/legacy-aggregates,
- ingestion-service owns `raw_*` + `connector_identity_map`,
- intelligence-service owns `ai.*` + `memory.*` (pgvector),
- analytics-service owns ClickHouse.

One-writer-per-store and RLS are honoured. **The concrete risk is not "one instance" — it is that isolation is by *convention + RLS*, not by *database GRANTs*: any service holding `DATABASE_URL` can read any schema.** That is the thing to harden first, independent of when we physically split.

### 2.4 CI/CD, IaC, orchestration — ❌ / 🟡
- **No `.github/workflows/`** — zero automated build/test/deploy, no ECR push, no ArgoCD sync.
- **CDK** = 2 stacks only (credential-custody + 1 representative Fargate task def), synth-only, "do not deploy". No cluster/RDS/MSK/ElastiCache/ALB/EKS stacks.
- **K8s** = `.gitkeep` placeholders only.
- **Migrations** = co-located per service (good) but applied by hand; no automated runner.

---

## 3. What is *genuinely* missing vs. *deliberately deferred*

Separating these is the whole point — most "gaps" are the spec's own phasing, not defects.

### 3.A Genuine gaps to close to make Phase-0/1 actually real (the honest "we said we'd do this and haven't")
1. **Dockerfiles + entrypoints for the 3 Python "data" services** (ingestion, analytics, intelligence) so the documented Phase-0/1 "data" deployable can actually run.
2. **Start the gRPC servers** (lift the `HOLD-AT-CUTOVER`) and flip `api-gateway` from in-process core import to the loopback gRPC `DataPlanePort` — proving the seam works *before* Phase 2.
3. **CI pipeline** (`.github/workflows`): per-service lint/test/build + the metrics-parity gate + the **`@paradigm` CI audit** the spec requires.
4. **DB GRANT isolation**: per-service Postgres roles with grants limited to their owned schemas — convert "isolation by convention" into "isolation by permission" *without* yet splitting instances.
5. **Decision-log completeness**: add post-execution columns (outcome_7d/30d, attributed/recovered revenue, learning_note) + the nightly attribution job; wire the **MCP write→decision-log middleware** so "a workflow that can't write here is not a Brain action" is structurally true.
6. **RegionAdapter interface/factory** (`get_adapter(region)` in `brain_regional`) wrapping the existing India functions — code the seam, even India-only.

### 3.B Deliberate deferrals (consistent with the documented plan — do NOT treat as defects)
- Physical split into 7 services + EKS/Karpenter/ArgoCD + provisioned MSK + Debezium → **Phase 2**.
- True database-per-service instances → **Phase 2/3** (triggered, not now).
- 14 of 15 agents, daily-loop scheduler, auto-execute, kill-switch → **Phase 2/3**.
- lifecycle-service + notifications-service build-out → **Phase 2**.
- UAE/GCC region adapters, knowledge graph, feature store, Temporal → **Phase 4**.

---

## 4. Roadmap

Sequenced so each step de-risks the next; nothing here is a rewrite.

### Phase A — "Make Phase-0/1 true" (close §3.A) — *foundational, do first*
- A1. Dockerfile + `main` entrypoint for ingestion, analytics, intelligence (Python, uv).
- A2. Start gRPC servers; switch gateway to loopback `DataPlanePort`; keep in-process import behind a flag for rollback.
- A3. `.github/workflows/ci.yml`: turbo `--affected` build/test/lint + metrics-parity + `@paradigm` audit; `docker:build:*` for Python.
- A4. Per-service Postgres roles + schema GRANTs (isolation by permission).
- A5. Decision-log post-exec columns + nightly attribution job + MCP write→log middleware.
- A6. `RegionAdapter` interface + `get_adapter("IN")` wrapping existing India funcs.

### Phase B — Physical split readiness (the mechanical Phase-2 prep)
- B1. CDK stacks: ECS Fargate cluster, RDS Postgres, ElastiCache, MSK Serverless, ALB, log groups, per-service task defs + least-priv roles.
- B2. Stand up Kafka for real (broker + DLQ topics + replay tool); move at least one service↔service flow off in-process onto Kafka.
- B3. Extract `core-service` into its own deployable (own Dockerfile + entrypoint + gRPC server); gateway calls it over the network. This is the proof that "gateway has no business logic" holds.
- B4. Migration runner wired into each service bootstrap (no hand-applied SQL).

### Phase C — Full 7-service topology + EKS
- C1. Split "data" into ingestion / analytics / intelligence as separate deployables.
- C2. EKS + Karpenter + ArgoCD; Helm chart per service; per-service DB instance (database-per-service strict).
- C3. lifecycle-service + notifications-service build-out (incl. Morning Brief push send).

### Phase D — Intelligence + Phase-3/4 features (triggered)
- D1. Remaining 14 agents + daily-loop scheduler + Morning Brief synthesis orchestration.
- D2. Auto-execute (off-by-default) + 60s kill switch + auto-revert + graduation.
- D3. UAE/GCC RegionAdapter; knowledge graph / feature store / Temporal when triggers fire.

---

## 5. Recommendation

Run **Phase A** now — it is small, high-leverage, and turns the architecture from "contracts are right, runtime is a monolith" into "Phase-0/1 as documented, with the split seams proven." Treat Phase B+ as a Founder-gated decision: true database-per-service and the 7-way physical split carry real AWS cost/ops overhead and should graduate on the spec's own triggers, not be pulled forward for purity. This sequencing matches the canon's *"build the contracts day one; run the infra at the smallest footprint; graduate each heavy layer when its trigger fires."*
