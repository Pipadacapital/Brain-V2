# Requirement: Migrate & transform the legacy DTC analytics platform into the Brain architecture

> Filled out by `/requirement <text>` automatically. Founder can edit afterward.
> Validates against [schemas/requirement.schema.json](../schemas/requirement.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `chore-migrate-legacy-to-brain` |
| **Title** | Migrate & transform the legacy DTC analytics platform into the Brain architecture |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T00:51:31Z |
| **Tier impact** | all (launch / growth / scale / enterprise — the migrated platform IS the product) |
| **Region impact** | in (India-first; multi-region structure preserved per region-adapter canon) |

---

## Lane *(set by Rohan at Stage 1 — leave blank at intake)*

| Field | Value |
|-------|-------|
| **feature_class** | *(Rohan to set — almost certainly high-stakes; see surfaces below)* |
| **feature_class_rationale** | *(Rohan)* |
| **trigger_surfaces_touched** | *(likely ALL: auth, multi-tenancy, mcp-tools, connectors, outbound-channels, pii, schema-proto, money, india-compliance)* |

---

## Raw text (from Founder)

> We already have a legacy project that includes a functional dashboard system, integrations, analytics modules, authentication flows, multi-company switching, multi-user support, and a working frontend application. I have reviewed and tested the system, and the current functionality is stable and working well.
>
> Your task is to deeply analyze the entire legacy codebase and progressively migrate it into the new "Brain" architecture and engineering ecosystem while preserving all existing functionality.
>
> The goal is not just migration, but transformation of the platform into a scalable, AI-native, enterprise-grade system aligned with our latest architecture, engineering standards, memory systems, agentic workflows, and business vision.
>
> [Full brief covers: Core Migration Objectives; Legacy System Areas to Analyze; Migration Expectations; Integration System Rework (Shopify, Meta Ads, Google Ads, OAuth, webhooks, sync pipelines, reusable connector framework); Analytics & Dashboard Migration; Authentication & Multi-Tenant System (RBAC/ABAC, org isolation, audit logging); Frontend Expectations (UI/UX, perf, a11y, design system, state mgmt); Engineering Expectations (backward compat, no downtime, phased migration, observability, testing); Final Goal — a fully modernized AI-native business operating system on Brain memory + agentic workflows + real-time analytics + unified integrations.]

---

## Problem statement

A functional legacy DTC analytics product exists today (`legacy project/`): a Node/TypeScript backend (Prisma ORM, single `schema.prisma`, Shopify/Meta/Google ads connectors, cron-based ad sync) and a Next.js frontend (~478 source files; 205 `.tsx` components; dashboards, KPI/ROAS analytics, AI insights, auth, multi-company switching, multi-user). It works and is stable, but it is a monolith that does not match the Brain target architecture: microservices + DDD, event-driven (Kafka), deterministic metric engine (TS↔Python parity), Memory Layer (pgvector), agentic AICMO/AICOO/AICFO workflows, multi-tenant `workspace_id` isolation at four layers, India-commerce economics (COD/RTO/GST), and the Morning Brief as primary surface.

The Founder wants this legacy value **preserved and continuously operational** while it is **progressively migrated and transformed** into the Brain ecosystem — production-safe, phased, no downtime, no broken business-critical workflows.

This is not a single shippable feature. It is a **migration program** spanning every Brain service and every trigger surface. Intake's job is to let Rohan decide how to decompose it into safely shippable increments (likely: an audit/strange-fig spike first, then a strangler-pattern sequence), NOT to attempt the whole thing as one pipeline run.

---

## Target user

The full Brain customer base — DTC brand operators (Founders/operators of launch→enterprise India brands, e.g. anchor customer Sugandh Lok), agencies managing multiple brands, and internal analysts. The migration must keep their existing dashboards/analytics/integrations working throughout.

---

## Success metric

*To be sharpened by Rohan, but candidate program-level metrics:*
- **Zero loss of working functionality:** every legacy dashboard, analytic, and integration remains operational through each migration phase (parity tests green).
- **Zero production downtime / zero broken business-critical workflow** during cutover of each slice.
- **Architectural conformance:** each migrated capability lands on the locked Brain stack (microservice + DDD, Kafka events, metric-registry parity, RLS workspace isolation) and passes Shreya + Tanvi gates.
- **Decommission progress:** % of legacy modules behind the strangler facade fully cut over to Brain services.

---

## Constraints

- **Production-safe & phased** — no big-bang rewrite; strangler-fig migration with the legacy system live and authoritative until each slice is proven at parity.
- **Locked Brain stack** — `canon/technical-requirements.md` governs (Fastify+tRPC+Prisma+gRPC/buf+Kafka on Node; FastAPI+asyncpg+ClickHouse on Python; Supabase Auth; pgvector memory). No new stack layers without an explicit tech-stack-evaluation decision.
- **Brain non-negotiables** — multi-tenant `workspace_id` isolation (4 layers), deterministic metric engine (LLMs never produce a number; TS↔Python parity CI-enforced), India compliance (DLT/NCPR/DND/calling-hours/GST), data residency (ap-south-1), Decision Log immutability.
- **Commit/branch discipline** — feature branches only; Founder reviews/merges every PR; no commits without explicit Founder "commit it".
- **Cost discipline** — token/economics-aware; LLM work routed per cost-routing-paradigms.

---

## Non-goals

- **Not** a big-bang cutover or "throw away the legacy and rebuild from scratch in one shot."
- **Not** attempting to migrate all services in a single pipeline run — this requirement is the umbrella/epic; concrete slices spawn as their own requirements.
- **Not** changing the legacy system's user-facing behavior except where the brief explicitly invites improvement (UI/UX, perf, a11y) — workflows stay consistent.
- **Not** introducing net-new product capabilities (e.g. new AICMO agents, lifecycle calling) under this umbrella unless a child requirement is explicitly scoped for it.

---

## Linked prior runs

- `.engineering-os/runs/2026-05-23T23-11-01Z__c4f3f4__chore-scaffold-monorepo__rishabhporwal` (the Brain monorepo skeleton this migration lands into)

---

## Notes

**Legacy inventory (first-pass, from intake scan — NOT a substitute for the deep audit):**
- `legacy project/backend/` — Node/TS service: `package.json`, `prisma/` (1 `schema.prisma`), `src/`, `scripts/`, `Dockerfile`. Ad-metrics + AI-insights + cron ad-sync logic (see `legacy project/docs/`).
- `legacy project/frontend/` — Next.js (app router): `app/`, `components/` (205 tsx), `stores/` (client state), `hooks/`, `lib/`, `proxy.ts`, `Dockerfile`.
- `legacy project/docs/` — `ads-metrics-implementation.md`, `ai-insights-roas-and-metrics.md`, `cron-sync-ads-setup.md`, `integrations.md`.
- Root: `docker-compose.yml`, `Makefile`, `shopify.app.toml` (Shopify app integration).
- ~478 non-vendored source files total (272 `.ts`, 205 `.tsx`, 1 `.prisma`).

**Recommended intake framing for Rohan:** treat this as an **epic** requiring CHALLENGE-BACK / decomposition, not a single ADVANCE-to-build. The natural first child is a **deep-audit spike** (Aryan + Maya) producing a legacy→Brain capability map, a strangler-fig migration sequence, and a per-slice risk/parity plan. Subsequent children migrate one bounded context at a time behind a stable facade, each going through the full pipeline with Shreya/Tanvi gates.
