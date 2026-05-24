# CTO Advisor Review — Stage 1 (intake / brainstorm)

> Filled by Rohan (CTO Advisor) at Stage 1. High-stakes lane → full artifact.
> Validates against [schemas/cto-advisor-review.schema.json](../../schemas/cto-advisor-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Stage** | 1  *(intake)* |
| **Timestamp** | 2026-05-23T23:12:37Z |
| **Decision** | **ADVANCE**  *(personas requested first — synthesis pending re-invoke)* |

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | `high-stakes` |
| **feature_class_rationale** | Establishes the `protos/` tree + working `buf.yaml` — the proto-contract source of truth (`schema-proto` trigger surface) — and sets the irreversible top-level structure on which every day-one non-negotiable is built; genuine standard/high-stakes doubt resolved upward by the conservative tie-break (Founder rule, 2026-05-20). |
| **trigger_surfaces_touched** | `[schema-proto]` |
| **Stages that will run** | 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (full pipeline) |

**Why not `standard`:** A literal read says an empty `.gitkeep` directory "touches" no surface behaviorally — no code reads `workspace_id`, no money math, no concrete `.proto`. That argues standard. Three forces push up: (1) we are standing up the **buf workspace** through which every future proto change flows — getting it wrong is brutal to retrofit; (2) this is the **foundational** artifact — a wrong top-level shape (a stray `controllers/` folder, a misplaced region-adapter seam, wrong workspace boundaries) is the single most expensive mistake to unwind because everything stacks on it; (3) the conservative tie-break forbids downgrading on doubt. High-stakes it is.

**Why not `express`:** Trigger surface present (`schema-proto`) → express is mechanically off the table.

---

## Made requirements less dumb first

**Could delete:**
- Full per-service boilerplate (Fastify/FastAPI bootstrap, health probes, proto service stubs) — deleted from scope. That is real service implementation; it belongs to each service's own requirement with its own Architect plan + tests, not to the skeleton. Pulling it forward = building service internals with no plan (over-engineering / build-ahead violation).

**Could simplify:**
- The scaffold carries the DDD layer folders (`bootstrap/ domain/ application/ infrastructure/ interfaces/`) inside each backend service, but they hold only `.gitkeep` — structure without code. Cheapest possible way to lock the §9.2 layering in and make a future `controllers/` folder an obvious diff anomaly, without crossing into implementation.

**Could defer:**
- AWS CDK IaC, CI/CD pipelines, ArgoCD/EAS wiring (already non-goals — confirmed deferred to Jatin). Note for Architect: the layout must not *preclude* per-service pipelines (Appendix C item 11), but no pipeline files are created now.
- Phase-4 UAE/GCC region adapters — only the India adapter seam + interface location is established now.

---

## Scope resolution (the open question from the requirement Notes)

**Question:** how deep does "folder structure" go — (a) bare tree, (b) directories + working root workspace config so the toolchain resolves, or (c) full per-service boilerplate?

**Decision: (b) — directory tree + a working root workspace toolchain, minimal placeholders. No service implementation.**

Bounded contract for Stage 2/3:
- **Top-level §9.1 layout:** `apps/` (the 9 product dirs: web, mobile, api-gateway, core-service, ingestion-service, analytics-service, intelligence-service, lifecycle-service, notifications-service), `packages/`, `pylibs/`, `protos/`.
- **DDD layering** (§9.2) present in each backend service: `bootstrap/ domain/ application/ infrastructure/ interfaces/` — `.gitkeep` only, no `controllers/`-style folder anywhere.
- **Working root toolchain config** with the locked, pinned versions (technical-context §2): `package.json` + `pnpm-workspace.yaml` + `turbo.json` (Turborepo + pnpm, Node 24 LTS), root `pyproject.toml` + uv workspace (Python 3.13), `buf.yaml`/`buf.gen.yaml` for `protos/`.
- **Day-one non-negotiable *homes* only** (Appendix C): the region-adapter interface location, the metric-registry pair location (`packages/lib-metrics` ↔ `pylibs/brain_metrics`), the Decision-Log schema location — declared as directory homes, not implemented.

**Verifiable success contract (this is what makes (b) the right floor, not (a)):** `pnpm install`, `turbo run` graph resolution, `uv sync`, and `buf lint` all resolve cleanly against the scaffold. An unverifiable bare tree (option a) fails the requirement's own success metric and gives false confidence — the next requirement would discover the toolchain doesn't cohere. (b) is the smallest scaffold that is actually verifiable and unblocks the next requirement.

**Not a CHALLENGE-BACK:** the Founder already pre-recommended the middle option in the Notes; I concur and have tightened the boundary. No Founder decision is needed — I decide and ADVANCE.

---

## Persona-count decision

**Count chosen: 1.**

**Rationale (classifier rule):** high-stakes caps personas at 2, but the cap is a ceiling, not a quota. For a foundational scaffold a **single risk dimension dominates** — *toolchain coherence*: does the locked four-tool workspace (Turborepo+pnpm / uv / Buf with Node 24 + Python 3.13) actually cohere in one repo, and is the §9.1 top-level shape the right shape before it becomes load-bearing for everything? That is the one place an adversarial second opinion adds signal beyond what Aryan produces at Stage 2.

- **Structure-correctness** against §9.1/§9.2/Appendix C is squarely Aryan's binding job at Stage 2 — a second persona pre-litigating the folder tree just duplicates the next stage. Declined.
- **ai-cost-realist:** zero signal — no LLM compute path in a scaffold; `@paradigm` gets only a home, not a call. Declined.
- **india-compliance-officer:** zero signal — no PII, no channels, no data, no telecom/DPDP surface. Declined.

**Persona spawned:** `monorepo-toolchain-realist` (the orchestrator spawns; writes `03-persona-monorepo-toolchain-realist.md`). Charge: stress-test whether the locked, pinned toolchain coheres and whether the §9.1 layout has a retrofit trap, before it becomes irreversible.

**Synthesis:** PENDING — this is the first pass. I am returning `needs_personas` and stopping. The orchestrator spawns the persona, then re-invokes me to read `03-persona-*.md`, confirm it surfaces ≥1 concern, synthesize, and finalize ADVANCE → Architect.

---

## Paradigm recommendation

**Recommended paradigm:** `n/a` *(no compute path — this is structure + toolchain only)*

**Why:** A scaffold executes no metric, no model, no LLM call. The `@paradigm` discipline (Appendix C item 6) gets only a *home* established here. First real `@paradigm` declaration lands with the first compute path (metric engine), a later requirement. Architect should confirm the decorator's home exists; nothing to route now.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | None at scaffold layer. Seam note: the RTO/COD math will live in `analytics-service` over minor-units inputs — its DDD home is created now. |
| **COD** | None now. Home established (analytics/lifecycle). |
| **GST** | None now. Per-SKU 0/5/18/40 slab logic lives in analytics later; minor-units money convention's home is established here (no float/NUMERIC ever). |
| **Festival seasonality** | None — no data path. |
| **Pincode reliability** | None — no data path; ingestion/analytics homes created. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | None — no outbound channel exists; lifecycle-service compliance-engine home is created (Phase-2 build), not implemented. |

No compliance ambiguity → no `/escalate` trigger. The scaffold creates homes for these surfaces but implements none; the high-stakes lane already ensures full-rigor review when they are filled.

---

## Decision

**ADVANCE** — scope resolved to option (b); lane = high-stakes; 1 persona requested (`monorepo-toolchain-realist`). Returning `needs_personas`; synthesis on re-invoke, then hand to Architect (Aryan) for the binding Stage-2 plan.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-23T23:12:37Z",
  "actor": "cto-advisor",
  "type": "intake-decision",
  "req_id": "chore-scaffold-monorepo",
  "stage": 1,
  "decision": "ADVANCE",
  "feature_class": "high-stakes",
  "trigger_surfaces_touched": ["schema-proto"],
  "needs_personas": ["monorepo-toolchain-realist"],
  "scope_decision": "option-b: directory tree + working root toolchain config (pnpm/turbo/uv/buf resolve) + DDD layer folders as gitkeep; no service implementation",
  "rationale": "Foundational scaffold; standard/high-stakes doubt resolved upward by conservative tie-break; smallest verifiable scaffold that unblocks next requirement"
}
```
