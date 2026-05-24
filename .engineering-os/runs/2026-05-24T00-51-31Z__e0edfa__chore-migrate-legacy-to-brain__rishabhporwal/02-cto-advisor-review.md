# Stage 1 — CTO Advisor Review (Rohan)

| Field | Value |
|-------|-------|
| **req_id** | `chore-migrate-legacy-to-brain` |
| **Stage** | 1 (intake + brainstorm) |
| **Reviewer** | Rohan (cto-advisor) |
| **Timestamp** | 2026-05-24T00:53:37Z |
| **Decision** | **CHALLENGE-BACK (decompose)** — this is an EPIC, not a single shippable requirement |

---

## TL;DR

The Founder is right that the legacy product is real, stable, and worth preserving — I verified that on disk, not on faith. But "deeply analyze the entire codebase and progressively migrate it into Brain" is a **migration program spanning ~48 data models, 7 connectors, ~204 frontend components, and an entire AI engine**, touching **every Brain trigger surface**. No single pipeline run can do this with the "zero downtime, no broken workflow, phased, production-safe" guarantee the Founder himself set as the constraint. Attempting it as one ADVANCE would be the exact anti-pattern the canon warns against (big-bang rewrite) wearing a "phased" label.

**I am bouncing this back as an EPIC and decomposing it.** The correct FIRST requirement is a **deep-audit + migration-architecture spike** (Aryan + Maya) that produces the binding legacy→Brain capability map, the strangler-fig sequence, and a per-slice parity/risk plan. Every subsequent bounded-context migration then runs as its own full-pipeline child behind a stable facade. I recommend the Founder file the first child as its own `/requirement` (I give the exact text below).

---

## What I actually verified on disk (ground truth, not the intake summary)

I did **not** audit exhaustively (that's the spike's job). I looked at enough to ground the decision:

**Legacy identity & stack (real gap vs Brain locked stack):**
- Backend is `looqus-backend` — **Express 5 + Prisma 5 + ioredis**, `@anthropic-ai/sdk` called **directly**, an **Ollama** provider, Supabase Auth. *No* Fastify, *no* tRPC, *no* gRPC/buf, *no* Kafka, *no* ClickHouse, *no* LiteLLM gateway.
- Frontend is `shopify-analitcs` — **Next.js 16 + React 19 + TanStack Query + shadcn/Recharts** (these align with Brain) but **Zustand** for state (Brain locked stack = Redux Toolkit; Zustand is explicitly *not* in the stack) and **axios** to a REST backend (Brain = tRPC).
- `204` `.tsx` components confirmed.

**Domain depth (good news — closer to Brain than a generic app):**
- Prisma schema is **1,110 lines, ~48 models + ~17 enums**. It already models `Workspace`, `WorkspaceMember`, `Invitation`, `WorkspaceCost`, `WorkspaceCogsSettings`, `WorkspaceMetricGoal`, `WorkspaceFestival`, `WorkspaceDailyMetrics`, `AiInsight`, COGS, lead times, refunds, and per-platform order/lineitem tables.
- Connectors present: **Shopify, WooCommerce, Meta Ads, Google Ads, Klaviyo, Shiprocket, Unicommerce** — with `oauth_states`. Real OAuth + cron ad-sync. `ShiprocketOrder` even carries `cod_amount` and `charges` → COD/RTO economics already partially present.
- `66` `workspaceId` references across models → multi-tenancy is **pervasively assumed at the application layer**.

**Hard non-negotiable GAPS I can already name (these define the migration risk):**
1. **No Postgres RLS.** `grep` for RLS/policy = `0`. Isolation is **app-layer only**. Brain requires `workspace_id` RLS as 1 of 4 enforced layers. This is simultaneously a *cross-brand-leak risk surface* and a heavy migration item (every workspace-scoped table).
2. **Money is `Decimal`/`Float`, everywhere.** `founder_salary_monthly`, `gross_sales`, `net_sales`, ad `spend`/`conversion_value`, `cod_amount` — all `@db.Decimal(...)` or `Float`. Brain non-negotiable = **BIGINT integer minor-units + `currency_code`**; `NUMERIC`/float money is a code-review *blocker*. Converting the money representation across ~48 models with live data and zero rounding drift is one of the single hardest slices and needs its own parity proof.
3. **No OLTP/OLAP split.** Everything is Postgres (Prisma). Brain needs ClickHouse for analytics from the first dashboard. The legacy `*DailyMetrics`/`*DailyAggregate` tables are app-computed rollups in Postgres — they map to ClickHouse materializations + the metric registry, not a lift-and-shift.
4. **No deterministic metric registry / TS↔Python parity.** Metrics live in `src/lib/metrics`, `pnl`, `ltv`, `cohorts`, `acquisition` as TS. Brain requires one definition per metric with CI-enforced TS↔Python parity, and **LLMs never produce a number**.
5. **AI engine bypasses every Brain AI invariant.** `src/module/ai-engine` + `src/module/ai` have providers/prompts/pipeline/tools calling `@anthropic-ai/sdk` (and Ollama) **directly** — no LiteLLM gateway, no `@paradigm` routing, no per-workspace cost caps, and **no Decision Log**. The legacy doc literally describes insights as **"Triple Whale–style"** and treats **ROAS as a primary metric** — both violate Brain canon (Brain-only naming; ROAS is display-only; CM2 is the decision metric; every recommendation/action must write the Decision Log).
6. **No Kafka event spine** — sync is cron + direct DB writes; Brain is event-driven with `workspace_id`-partitioned topics + idempotency + DLQ.

**Net:** the *domain* is ~70% aligned (workspaces, COGS, festivals, COD, connectors) which is why this is worth migrating rather than rebuilding; the *architecture and the non-negotiables* are largely absent, which is why it cannot be one requirement.

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan returns the maximal set — this umbrella touches every gated surface. Not even close to the scaffolding carve-out (that is "empty homes, no live contract/consumers/data"; this is live data, live consumers, live business logic, real PII). Conservative tie-break is irrelevant here — there is no doubt. |
| **trigger_surfaces_touched** | `auth`, `multi-tenancy`, `mcp-tools`, `connectors`, `outbound-channels`, `pii`, `schema-proto`, `money`, `india-compliance` |

Note on surfaces: `auth` (Supabase auth flows + RBAC), `multi-tenancy` (66 `workspaceId` refs, **no RLS yet** — a leak surface), `connectors` (7 live integrations), `outbound-channels` (Klaviyo email + notifications), `pii` (`ShopifyCustomer`, emails, addresses), `schema-proto` (live-data migration of ~48 models), `money` (Decimal→minor-units re-representation), `india-compliance` (COD/RTO/GST data + customer PII + DPDP/DLT). `mcp-tools` applies once the AI engine is migrated to Brain's MCP/agent contracts.

> **The lane applies to the EPIC and to every child.** Each migration slice is high-stakes by construction; none will qualify for express/standard. That is correct — migration of live tenant data and money is the highest-risk class of work Brain does.

---

## Persona-count decision

| Field | Value |
|-------|-------|
| **Count** | **2** (the cap) |
| **Rule fired** | Two *distinct* dominant risk dimensions intersect (subagent-orchestration table, row "2 personas"). Lane = high-stakes ⇒ cap is 2. |
| **Personas chosen** | (1) `migration-strangler-fig-realist`; (2) `india-data-isolation-compliance-officer` |

**Why these two, and why not others:**
- **`migration-strangler-fig-realist`** — the dominant *engineering* risk of this EPIC is the migration **method**: can you really run legacy + Brain side-by-side, keep the legacy authoritative per slice, prove parity, and cut over with zero downtime — across an Express→Fastify, Prisma→Prisma+ClickHouse, Decimal→minor-units, cron→Kafka delta? This persona must adversarially pressure-test the *decomposition itself* (slice boundaries, facade design, dual-write/dual-read, rollback per slice, decommission criteria). If the sequence is wrong, every child inherits the flaw.
- **`india-data-isolation-compliance-officer`** — the dominant *non-engineering* risk is two-headed and both heads are concrete, not hypothetical: (a) **no RLS today** → a cross-brand-leak surface that the migration must close without breaking the 66 app-layer `workspaceId` assumptions; (b) **DPDP/DLT + money integrity** — live customer PII (`ShopifyCustomer`, emails), India data-residency, consent tracking that the legacy schema does not model, and the Decimal→minor-units money conversion which is a financial-correctness/compliance concern (the billing base is *realized* GMV in minor units). This is squarely my own `/escalate` rubric territory (DPDP ambiguity + cost-model/financial integrity) — I want an adversarial compliance read on the *sequencing* before any data moves.
- **Declined `ai-cost-realist`.** The cost/paradigm decisions (LiteLLM gateway, `@paradigm` routing, killing the direct-SDK/Ollama path) are real but they belong to the **AI-engine migration child requirement**, not to the decomposition. Spawning it here would be a 3rd persona for a slice that isn't first — that overshoots. It is explicitly flagged as a required persona on the future AI-engine slice instead.
- **Declined a generic architecture persona.** Slice-boundary correctness is Aryan's binding Stage-2 job on the spike child; the strangler-fig realist already covers the adversarial migration-method angle. Don't duplicate Aryan.

> Per the orchestration rules I do **not** spawn these. They are returned in `needs_personas`; the orchestrator spawns them in parallel and re-invokes me to synthesize. The synthesis decision will still be CHALLENGE-BACK (decompose) — the personas sharpen the *sequence and guardrails*, they cannot turn an EPIC into a single shippable feature.

---

## Decision: CHALLENGE-BACK — decompose into an EPIC

Per the challenge framework (5 fields):

1. **What I'm challenging.** Treating "migrate & transform the entire legacy platform" as one requirement that ADVANCEs into a single build.
2. **Why (evidence).** ~48 models, 7 connectors, ~204 components, a whole AI engine; six absent non-negotiables (RLS, minor-units money, OLTP/OLAP split, metric-registry parity, gateway/paradigm/Decision-Log, Kafka). The Founder's own constraints — zero downtime, phased, no broken workflow, strangler-fig, legacy authoritative until parity — are *only achievable* if the work is sliced. A single run cannot satisfy them.
3. **The cost of doing it as one requirement.** A binding Stage-2 plan would be impossibly large or impossibly vague; no honest QA parity gate could pass "the whole platform"; the blast radius (live tenant data + money) is uncapped. This is the canon's #1 top-risk ("Brain becomes a dashboard" / big-bang) realized as process failure.
4. **The path forward (the decomposition).** An EPIC/meta-tracker with a strangler-fig child sequence (below), first child = the audit+architecture spike.
5. **What I need from the Founder.** Ratify the EPIC framing + the recommended FIRST child, and file that child as a `/requirement` (text provided). That spike's output makes every later slice planable.

### Recommended decomposition (strangler-fig program)

> Exact slice boundaries and ordering are an **output of Child 0 (the spike)** — the strangler-fig persona will pressure-test this draft. This is the *shape*, not the final binding sequence.

- **Child 0 — Audit + Migration Architecture Spike (the FIRST, recommended now).** Aryan + Maya. **No production code moves.** Deliverables: (a) legacy→Brain **capability map** (every model/route/connector/component → target Brain bounded context + the 6 non-negotiable gaps per capability); (b) the **strangler-fig sequence** with a stable **facade/anti-corruption layer** design (how legacy stays authoritative + reachable while slices cut over); (c) per-slice **parity & rollback plan** + decommission criteria; (d) the **dual-run** strategy (dual-write/dual-read, shadow-compare). Output = a binding EPIC plan that spawns Children 1..N. Lane: high-stakes (spike, but it sets contracts that bind everything).
- **Child 1 — Tenancy & auth hardening behind the facade.** Land Supabase-auth alignment + **Postgres RLS on every workspace-scoped table** + the `workspace_id` propagation contract, *without* changing user-facing behavior. Closes the leak surface first; everything downstream depends on it. (Shreya-heavy.)
- **Child 2 — Money representation migration: Decimal/Float → BIGINT minor-units + `currency_code`.** Its own slice with a dedicated TS↔Python parity + rounding-drift proof. Highest financial-correctness risk; do it early so the metric engine lands on honest money.
- **Child 3 — Connector framework migration (one connector at a time).** Map the 7 legacy connectors onto Brain's single `Connector` interface (auth/refresh/sync/webhook/canonicalize/health) + idempotency + late-data windows + the S3-raw / ClickHouse-raw / Kafka / 90-day-mirror fan-out. Start with **one** (Shopify) end-to-end, prove parity, then template the rest.
- **Child 4 — Metric engine + OLTP/OLAP split.** Move app-computed rollups (`*DailyMetrics`, `*DailyAggregate`) into the **metric registry** (one definition, TS↔Python parity, CI-enforced) + ClickHouse materializations. ROAS becomes display-only; CM/CM2 waterfall becomes the decision surface.
- **Child 5 — AI engine migration.** Replace direct `@anthropic-ai/sdk`/Ollama with the **LiteLLM gateway** + `@paradigm` routing + per-workspace caps; route everything through the **Decision Log**; convert "Triple Whale–style insights" to Brain agentic recommendations (Brain-only naming). **`ai-cost-realist` persona required on this child.**
- **Child 6 — Frontend migration.** axios→tRPC, Zustand→Redux Toolkit, ship surfaces on the Brain design system + the Morning Brief as primary; perf/a11y budgets. Largest by file count (204 tsx) → sub-slice by route group.
- **Child N — Decommission.** Cut each legacy module off the facade once its Brain replacement is at parity; track % decommissioned.

### Recommended FIRST `/requirement` (Founder files this)

> **Title:** Deep-audit the legacy platform & produce the binding legacy→Brain migration architecture (strangler-fig sequence)
>
> **Text:** Run a no-production-code audit + architecture spike over `legacy project/`. Produce: a capability map (every Prisma model, backend route/lib, connector, and frontend route-group → its target Brain bounded context, plus which of the 6 non-negotiables — RLS, minor-units money, OLTP/OLAP split, metric-registry parity, gateway/paradigm/Decision-Log, Kafka spine — each capability is missing); a strangler-fig migration sequence with a stable facade / anti-corruption-layer design that keeps the legacy system live and authoritative per slice; a per-slice parity, rollback, and decommission plan; and a dual-run (dual-write/dual-read shadow-compare) strategy. This spike's output is the binding EPIC plan that spawns the per-context migration children. Constraint: zero changes to legacy runtime behavior during the spike.

---

## Domain / canon context check

- **Honest economics:** legacy already has COGS, COD amount, Shiprocket charges, festivals — but treats **ROAS as primary** and lacks the **CM/CM2 waterfall + RTO provision + break-even COD r***. Child 4 must invert this to CM2-first. ✅ flagged.
- **Multi-tenancy:** 66 `workspaceId` refs but **no RLS** → 1 of 4 layers missing. Child 1 priority. ✅ flagged.
- **Money:** `Decimal`/`Float` → must become minor-units. Child 2. ✅ flagged.
- **Decision Log (the moat):** absent from legacy. Children 4/5 must introduce it before any rec/action migrates. ✅ flagged.
- **Compliance:** live PII + India COD/GST data; no consent primitive, no DLT/NCPR modeling in schema. Compliance-officer persona to read the *sequencing* risk; genuine DPDP/residency ambiguity on a specific slice is a future `/escalate` trigger, not a guess now. ✅ flagged.
- **Region adapter:** legacy is implicitly India + Shopify/Woo; Brain needs the RegionAdapter even India-only. Map in Child 0. ✅ flagged.

No `/escalate` fired at intake — the EPIC framing + Founder ratification is the correct first gate, not an escalation. (A specific DPDP/residency ambiguity surfaced inside a future slice would escalate.)

---

## First-pass paradigm

N/A at the umbrella level (no single compute path). Per-child: Children 1–4 are overwhelmingly **SQL** (schema/RLS/money/metrics — deterministic); Child 5 is the only one with `small_llm`/`frontier_llm` paradigm decisions, gated by `ai-cost-realist` and the LiteLLM gateway. The target mix (85% SQL / 12% ML / 2.5% small-LLM / 0.5% frontier) is itself a migration goal: the legacy direct-SDK/Ollama path almost certainly over-uses LLM where SQL/ML should compute.

---

## Stage 1 DoD

- [x] `02-cto-advisor-review.md` filled (no placeholders)
- [x] Lane decision recorded (high-stakes + rationale + 9 trigger surfaces); no tie-break ambiguity
- [x] Persona-count decision recorded (2, within high-stakes cap) — personas requested, synthesis pending orchestrator re-invoke
- [x] Decision recorded: **CHALLENGE-BACK (decompose into EPIC)**
- [x] Decision log + journal updated
- [x] state/active.json updated (other requirement `chore-scaffold-monorepo` preserved)
