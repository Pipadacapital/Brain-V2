# Requirement: Tenant isolation / RLS / auth-claim — Brain-native (Child 1 rebuild)

> Filled out by `/requirement <text>` automatically. Founder can edit afterward.
> Validates against [schemas/requirement.schema.json](../schemas/requirement.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-rls-brain-native` |
| **Title** | Tenant isolation / RLS / auth-claim — Brain-native (Child 1 rebuild) |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T09:57:25Z |
| **Tier impact** | all (foundational — multi-tenancy underpins every tier) |
| **Region impact** | in (ap-south-1; seam must not block ae/sa later) |

---

## Lane *(set by Rohan at Stage 1 — leave blank at intake)*

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Multiple trigger surfaces fire; no carve-out (foundational-scaffolding carve-out barred by live-data/PII/india-compliance presence). Conservative tie-break forbids downgrade. Set by Rohan, Stage 1. |
| **trigger_surfaces_touched** | auth, multi-tenancy, pii, schema-proto, india-compliance, connectors |

---

## Raw text (from Founder)

> We were migrating old brain legacy system with new brain architecture, that is not completed yet, i do not see anything apart from folder structure creation you did. do complete the migration as per brain architecture standard and give me the working code.
>
> (Scoped via intake: the migration is the binding 7-child strangler-fig epic `chore-migrate-legacy-to-brain`. Founder chose to start with **Child 1 RLS, Brain-native** — the architecture's universal hard gate — and proceed child-by-child. This requirement is that first buildable, child-sized slice.)

---

## Problem statement

The Brain-native monorepo is scaffolding only (empty DDD folders + package manifests; zero implementation). The sole real tenant-isolation work (legacy `feat-tenancy-auth-rls-hardening`, Child 1) was implemented **inside the legacy Express/Prisma backend** and was untracked on 2026-05-24 per the Founder's "legacy = reference-only" directive. Consequently:

1. There is **no Brain-native tenant-isolation primitive** — no RLS, no session-scoped workspace context, no auth/role-claim contract in any Brain service.
2. The live shared Supabase Postgres (ap-south-1) still has **0 RLS across 45 models / 66 `workspaceId` refs** — an OPEN P0 cross-tenant leak (tracked in `pending-founder-attention.md`).
3. Per Child 0's binding architecture, **RLS-live + cron-session-scoped is the universal hard entry gate (C5)** that every later child (money → connectors → metric/OLAP → AI → frontend → decommission) depends on. Nothing else can safely start until this exists Brain-native.

This slice builds that primitive in Brain — properly, modularly, to the new architecture standard — migrating the *logic* proven in the legacy slice (fail-closed policy shapes, FK-scope classification, cron scoping, rollout ceremony) without carrying legacy code.

## Target user

Foundational/internal — protects every Brain workspace (= tenant = brand = billing unit). Direct beneficiary: the anchor brand Sugandh Lok and every future multi-brand tenant. The end-user value is that no brand can ever read another brand's data.

## Success metric

- **0 cross-tenant leaks** — fail-closed RLS verified GREEN (cross-read = 0 AND context-less read = 0) on every workspace-scoped table via a Brain-native probe.
- Brain-native session-context primitive (`SET LOCAL app.workspace_id` equivalent) correct under pgbouncer txn-pool; bind-param (no injection).
- Auth/role-claim contract maps the existing Supabase JWT → Brain 5-level WorkspaceRole; `requireRole` enforced on mutations.
- Cron/background fan-out is per-workspace-session-scoped (no cross-workspace `findMany`).
- TS↔(Python where applicable) parity for any shared primitive; positive AND negative tests per the code-coverage standard.
- The C5 universal hard gate (G1 RLS-live + G2 cron-session-scoped) is satisfiable Brain-native.

## Constraints

- Legacy is **reference-only** — migrate logic, never import/edit/commit legacy code.
- Live shared Postgres is in `ap-south-1`; region must be asserted, never trusted (legacy `.env.bak.singapore` proves a region move happened).
- DPDP lawful-basis: Founder is legal owner of Sugandh Lok (the only in-scope brand); the CF-SEC-3.HARD tripwire **re-arms before any third-party brand PII is processed**.
- Must respect the strangler-fig facade/ACL: legacy stays live + authoritative per slice; this slice is additive + per-slice reversible; no big-bang.
- Money = integer minor units; LLMs never produce metric numbers (not directly in scope here but the seam must not violate it).
- No commit without explicit Founder "commit it"; feature-branch only.

## Non-goals

- Money/minor-units conversion (Child 2), connectors (Child 3), metric engine/OLAP (Child 4), AI agents (Child 5), frontend rewrite (Child 6), legacy decommission (Child 7).
- Applying RLS DDL to the live DB in this run (deploy is Stage 8, runbook-gated, Founder-approved).
- Formal DPA / governance program (deferred to `chore-security-governance-hardening-phase`).

## Linked prior runs

- `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal` (Child 0 — binding architecture)
- `.engineering-os/runs/2026-05-24T07-23-52Z__654a53__feat-tenancy-auth-rls-hardening__rishabhporwal` (Child 1 legacy implementation — withdrawn; RLS design reference)

## Notes

The legacy Child 1 artifacts (RLS policy shapes, FK-scope map of all 45 models, `rls-probe`, cron scoping, rollout runbook) survive on disk under `legacy project/backend/` as migration reference. This rebuild should mine that proven logic and re-express it Brain-native (which Brain service owns the shared DB's RLS + session context — likely core-service — is for Aryan to settle). The architecture's C5 gate, CF-* constraints, and the Definitional-Delta discipline from Child 0 carry forward.
