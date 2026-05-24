# Requirement: Deep-audit the legacy platform & produce the binding legacy→Brain migration architecture (strangler-fig sequence)

> Child 0 of EPIC `chore-migrate-legacy-to-brain`. Filed after Founder ratified the EPIC framing (2026-05-24T00:58:39Z).
> Validates against [schemas/requirement.schema.json](../schemas/requirement.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `spike-legacy-migration-architecture` |
| **Title** | Deep-audit the legacy platform & produce the binding legacy→Brain migration architecture (strangler-fig sequence) |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T00:58:39Z |
| **Parent epic** | `chore-migrate-legacy-to-brain` (epic_child_id: `child-0-audit-migration-architecture-spike`) |
| **Tier impact** | all (the migration architecture governs the whole platform) |
| **Region impact** | in (India-first; multi-region structure preserved) |

---

## Lane *(set by Rohan at Stage 1 — leave blank at intake)*

> Rohan already bound this on the epic: **high-stakes, all 9 trigger surfaces** apply to every child slice. He will confirm/re-state at this child's Stage 1. Note: this child is a **spike that writes NO production code and makes ZERO changes to legacy runtime behavior** — its output is architecture/plan artifacts. The high-stakes lane governs because the *decisions it makes* bind every later code-moving slice.

| Field | Value |
|-------|-------|
| **feature_class** | high-stakes (inherited from epic; Rohan to confirm) |
| **feature_class_rationale** | *(Rohan)* — binding architecture for a migration touching all surfaces |
| **trigger_surfaces_touched** | auth, multi-tenancy, mcp-tools, connectors, outbound-channels, pii, schema-proto, money, india-compliance |

---

## Raw text (from Founder, via CTO-Advisor decomposition)

> [EPIC parent: "deeply analyze the entire legacy codebase and progressively migrate it into the new Brain architecture … production-safe … preserving all existing functionality."]
>
> Child 0, as scoped by Rohan and ratified by the Founder: **Deep-audit the legacy platform and produce the binding legacy→Brain migration architecture** — the capability map, the strangler-fig migration sequence, the facade / anti-corruption-layer design, per-slice parity / rollback / decommission plans, and the dual-run shadow-compare strategy. **No production code moves. Zero changes to legacy runtime behavior.** This output makes every later slice planable.

---

## Problem statement

The Founder's legacy DTC analytics product (`legacy project/`) is functional and stable but architecturally divergent from Brain. Before any code is moved, we need a **binding, evidence-based migration architecture** so the subsequent slices (tenancy/RLS → money minor-units → connector framework → metric engine + OLAP → AI engine → frontend → decommission) can each run as a safe, phased, parity-gated pipeline.

Doing the audit *as* the first slice (instead of inside a later coding slice) is what lets the rest of the program be phased and production-safe rather than a disguised big-bang rewrite.

**Verified legacy ground-truth (from Rohan's Stage-1 scan — to be deepened by this spike):**
- Backend `looqus-backend`: Express 5 + Prisma 5 (1,110-line schema, ~48 models, 66 `workspaceId` refs, **no RLS**), ioredis, `@anthropic-ai/sdk` called directly, Ollama provider, Supabase auth. No Fastify/tRPC/gRPC/buf/Kafka/ClickHouse/LLM-gateway.
- Frontend `shopify-analitcs`: Next.js 16 / React 19 / TanStack Query / shadcn/Recharts (aligned) but **Zustand** (not in locked stack) + axios→REST (Brain uses tRPC). ~204 tsx.
- **Money typed as `Decimal`/`Float`** (must become BIGINT minor-units + currency_code).
- 7 connectors: Shopify, WooCommerce, Meta Ads, Google Ads, Klaviyo, Shiprocket, Unicommerce.
- No Decision Log, no metric-registry TS↔Python parity, no OLTP/OLAP split.
- Naming/paradigm drift: docs call insights "Triple Whale–style"; ROAS treated as primary metric (Brain privileges CM2/CM3; ROAS is display-only).

## Target user

Internal — Aryan (architect), Maya (intelligence), and every downstream builder/reviewer who needs the migration map. Indirectly: every Brain customer whose live functionality the resulting plan must protect.

## Success metric

This spike succeeds when it produces artifacts concrete enough that **each later child requirement can be filed and built without re-deriving the architecture**:
1. **Capability map** — every legacy module/route/model → its Brain target service + bounded context (or "deprecate"), with reuse/refactor/redesign classification.
2. **Strangler-fig sequence** — the ordered slice list with a stable **facade / anti-corruption layer** keeping legacy authoritative until each slice reaches parity.
3. **Per-slice parity + rollback + decommission plan** — what "parity" means per slice and how it's measured.
4. **Dual-run / shadow-compare strategy** — how legacy and Brain run side-by-side and outputs are compared before cutover.
5. **Risk register** mapped to the 6 absent non-negotiables (RLS, minor-units money, OLTP/OLAP, metric parity, gateway/@paradigm/Decision-Log, Kafka).

## Constraints

- **ZERO changes to legacy runtime behavior.** This is a read/analysis + design spike. No production code, no schema migrations, no connector edits.
- Locked Brain stack governs all target-state proposals (`canon/technical-requirements.md`); any proposed new layer needs an explicit tech-stack-evaluation note (the Zustand→? and axios→tRPC decisions belong here).
- Output must respect Brain non-negotiables as the target invariants: 4-layer `workspace_id` isolation, deterministic metric engine (LLMs never produce a number; TS↔Python parity), India compliance (DLT/NCPR/DND/GST), residency (ap-south-1), Decision Log immutability.
- Timebox to a planning spike — depth where it de-risks later slices, not exhaustive line-by-line review.

## Non-goals

- **No** code migration, refactor, or schema change in this child (those are children 1–n).
- **No** new product features.
- **No** final-binding choice on net-new AI agents (AICMO/etc.) — the AI-engine child owns that; this spike only maps the legacy AI/insights surface to a target.

## Linked prior runs

- Parent epic: `.engineering-os/runs/2026-05-24T00-51-31Z__e0edfa__chore-migrate-legacy-to-brain__rishabhporwal`
- Monorepo scaffold this lands into: `.engineering-os/runs/2026-05-23T23-11-01Z__c4f3f4__chore-scaffold-monorepo__rishabhporwal`

## Notes

Rohan named two personas for this child's Stage 1 brainstorm: **`migration-strangler-fig-realist`** (adversarial read on the migration *method* — is the sequence genuinely safe/phased, or a hidden big-bang?) and **`india-data-isolation-compliance-officer`** (the no-RLS leak surface + DPDP/residency/PII handling + the Decimal→minor-units financial-integrity risk). Owners: Aryan (architect) + Maya (intelligence/data-ml). Full decomposition + dependency graph in the parent epic's `02-cto-advisor-review.md`.
