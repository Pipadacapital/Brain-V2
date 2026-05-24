# Requirement: Scaffold the Brain monorepo folder structure

> Filled out by `/requirement <text>` automatically. Founder can edit afterward.
> Validates against [schemas/requirement.schema.json](../schemas/requirement.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Title** | Scaffold the Brain monorepo folder structure |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-23T23:11:01Z |
| **Tier impact** | all *(foundational — every tier builds on this skeleton)* |
| **Region impact** | in *(India-first; region-adapter seam included, UAE/GCC adapters Phase 4)* |

---

## Lane *(set by Rohan at Stage 1 — leave blank at intake)*

> Rohan assigns the pipeline lane before persona count, per [docs/feature-tiering.md](../docs/feature-tiering.md). Trigger surfaces force `high-stakes` mechanically; `express` requires an empty `trigger_surfaces_touched`.

| Field | Value |
|-------|-------|
| **feature_class** | `high-stakes` |
| **feature_class_rationale** | Establishes the `protos/` + `buf.yaml` proto-contract source of truth (`schema-proto` trigger surface) and the irreversible top-level structure underpinning every day-one non-negotiable; standard/high-stakes doubt resolved upward by the conservative tie-break (Founder rule, 2026-05-20). |
| **trigger_surfaces_touched** | `[schema-proto]` |

---

## Raw text (from Founder)

> I am building a product, all the details of the product are in requirement folder, this will be created with the help of engineering OS, lets start by creating folder structure of the project.

---

## Problem statement

*What is broken or missing? What is the user trying to do today that doesn't work?*

Brain has a complete canon (`requirements/business-context.md`, `requirements/technical-context.md`, `requirements/IMPLEMENTATION-BLUEPRINT.md`) and an initialized Engineering OS, but **no product code repository yet**. There is no monorepo skeleton for the team to build into. Every subsequent feature requires the canonical Turborepo layout (Blueprint §9.1) to exist first: `apps/` (web · mobile · the 7 backend services), `packages/` (TS shared libs), `pylibs/` (Python shared libs), `protos/` (buf-managed gRPC + Avro contracts), plus the root workspace/tooling config that makes Turborepo + pnpm + uv + Buf cohere. Without this scaffold, no day-one non-negotiable (workspace_id discipline, metric registry TS↔Python parity, proto-first contracts, @paradigm decorator, DDD layering) has a home.

## Target user

*Which persona + tier?*

Internal — the Engineering OS build team (Aryan/Vikram/Ananya/Karan/Maya and the review/deploy chain). This is foundational infrastructure that unblocks all product work; no end-customer persona consumes it directly.

## Success metric

*How will we know it worked?*

The repo root holds the canonical Blueprint §9.1 layout with workspace tooling that resolves: `apps/` contains the 9 product directories (web, mobile, api-gateway, core-service, ingestion-service, analytics-service, intelligence-service, lifecycle-service, notifications-service); `packages/`, `pylibs/`, `protos/` exist; each backend service carries the DDD layering (`bootstrap/ domain/ application/ infrastructure/ interfaces/`), never a `controllers/`-style technical-layer folder. The workspace manifests are valid (pnpm install / turbo graph / uv sync / buf lint resolve cleanly). Scope is the **skeleton + working toolchain**, not full service implementations.

## Constraints

*Cost, time, regulatory, technical. List them.*

- **Stack is LOCKED** (technical-context §2): Turborepo + pnpm (TS), uv workspace (Python), Buf (proto→TS+Python), Node 24 LTS, Python 3.13. No Nx, no Terraform, no alternative tooling.
- **Day-one non-negotiables must have a home** (Appendix C): workspace_id seam, integer-minor-units money convention, Decision Log schema location, region-adapter interface, metric registry (TS `packages/lib-metrics` ↔ Python `pylibs/brain_metrics`), `@paradigm` discipline, OLTP/OLAP split, proto-first gRPC, idempotency, mobile Morning Brief.
- **DDD layering mandatory** inside every service; `controllers/`-style folders are a code-review blocker.
- **Brain-only naming** — no vendor names as positioning anywhere in scaffolded code/config.
- **No commits without Founder approval** — scaffold is staged for review, never committed by agents (Blueprint §9.8: Founder commits product code).

## Non-goals

*Explicitly out of scope.*

- Full service implementations / business logic (metrics, connectors, agents, dashboards) — this is the skeleton + toolchain only.
- AWS CDK IaC, CI/CD pipelines, ArgoCD/EAS wiring — infra comes later (Jatin), though the structure must not preclude per-service pipelines.
- Provisioning live infrastructure (Postgres, ClickHouse, MSK, Redis, S3).
- Phase-4 UAE/GCC region adapters (only the India adapter seam + interface).

---

## Linked prior runs

*If this requirement has prior runs, list the run folders here.*

- (none — first product-code requirement)

---

## Notes

*Any extra context, hypotheses Rishabh wants the team to consider.*

Canonical layout source: `requirements/IMPLEMENTATION-BLUEPRINT.md` §9.1 (repo/monorepo structure), §9.2 (DDD folders), §2.2 (the 7 services + 2 clients), Appendix C (day-one non-negotiables). Open scope question for Rohan to resolve at intake: **how deep does "folder structure" go** — bare directory tree with `.gitkeep`s, vs. directories + working root workspace config (package.json / turbo.json / pnpm-workspace.yaml / buf.yaml / pyproject + uv) so the toolchain actually resolves, vs. full per-service boilerplate (Fastify/FastAPI bootstrap, health probes, proto stubs). Recommend the middle option (structure + working toolchain, minimal placeholders) as the smallest scaffold that is verifiable and unblocks the next requirement.
