# Requirement: Tenancy / auth / RLS hardening (Child 1 of the legacy→Brain migration)

> Child 1 of EPIC `chore-migrate-legacy-to-brain`, the first code-moving slice of the strangler-fig sequence. Filed after Child 0 (`spike-legacy-migration-architecture`) was approved and its A1–A6 architecture became binding.
> Validates against [schemas/requirement.schema.json](../schemas/requirement.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-tenancy-auth-rls-hardening` |
| **Title** | Tenancy / auth / RLS hardening (Child 1 of the legacy→Brain migration) |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-24T07:23:52Z |
| **Parent epic** | `chore-migrate-legacy-to-brain` (epic_child_id: `child-1-tenancy-auth-rls-hardening`) |
| **Depends on** | `spike-legacy-migration-architecture` (done — architecture binding) |
| **Tier impact** | all |
| **Region impact** | in (legacy Supabase confirmed `ap-south-1`) |

---

## Lane *(set by Rohan at Stage 1)*

> Inherited from the epic + Child 0: **high-stakes, all trigger surfaces** — and this slice is the one that touches the live multi-tenant DB directly. Rohan confirms at Stage 1.

| Field | Value |
|-------|-------|
| **feature_class** | high-stakes (Rohan to confirm) |
| **feature_class_rationale** | *(Rohan)* — closes the cross-brand isolation gap on a live shared Supabase DB; auth + RLS + multi-tenancy + pii + india-compliance surfaces |
| **trigger_surfaces_touched** | auth, multi-tenancy, pii, india-compliance (Rohan to finalize; likely also money/connectors via shared tables) |

---

## Raw text (from Founder, via the binding migration architecture)

> Migrate the legacy auth + tenancy model onto Brain's structural isolation contract as the FIRST strangler-fig slice. The legacy system has ~66 `workspaceId` references enforced ONLY at the application layer with **zero Postgres RLS**, plus cron fan-out paths doing cross-workspace `findMany`. This slice closes that cross-brand-leak surface BEFORE any later slice moves data — per the architecture, RLS-live + session-scoped crons is a HARD entry gate for every subsequent child's dual-run. Keep the legacy system live and authoritative throughout; production-safe and reversible.

---

## Problem statement

Per Child 0's binding architecture (`06-architecture-plan.md`, artifacts A1–A6) and Shreya's security review, the legacy platform's tenant isolation is **application-layer only** — there are no Postgres RLS policies on workspace-scoped tables, and the cron fan-out (`syncAllMetaAds` / `syncAllShiprocket` / `syncAllGoogleAds`) issues cross-workspace `findMany` queries with no session scoping. This is a latent cross-brand data-leak surface (DPDP §8(6) reportable if it fires). Brain's non-negotiable is 4-layer `workspace_id` isolation (JWT claim → api-gateway assertion → Postgres RLS via `SET LOCAL app.workspace_id` → ClickHouse query-gateway).

Child 1 is the foundation slice: it must establish RLS + session-scoped tenant context + Brain's auth/role model on the shared Supabase DB **without breaking the live legacy app** (whose queries currently assume no RLS) and **without downtime**. It is the prerequisite gate that unblocks every later slice's dual-run.

## Target user

Internal foundation (every Brain customer is protected by it). No direct end-user-facing change intended — isolation must become structural while existing dashboards/auth/multi-company switching keep working identically.

## Success metric

- **RLS live + verified** on all workspace-scoped tables; a test PROVES Brand A cannot read Brand B under any path (incl. the cron fan-out), with the legacy app still fully functional.
- **Zero downtime / zero broken workflow** during rollout (login, signup, org switching, user switching, dashboards all keep working).
- **Cross-brand leak SLO: 0.** Reversible: RLS rollout must be backward-compatible with legacy queries or shipped behind a safe toggle.
- Brain auth/role model (5 level-ordered roles; JWT claims) mapped onto the existing Supabase Auth without forcing re-login storms.

## Constraints (binding — inherited carry-forward ledger from Child 0)

These are NON-NEGOTIABLE inputs Aryan must plan against and Shreya/Tanvi must gate on:
- **CF-RES-1 (gate-zero):** assert the DB is still `ap-south-1` BEFORE any RLS DDL touches it. (Resolved at approval: confirmed ap-south-1 — this runs as a positive-assertion confirmation, and re-fires `/escalate` only if it ever changes.)
- **CF-SEC-1:** the strangler facade's "RLS-GREEN" gate must be a **fail-closed, auditable predicate derived from an actual RLS probe** (RED-by-default; transitions written to the Decision Log) — not a manually-flipped boolean.
- **CF-SEC-3:** establish the **lawful basis for migration-time PII processing** (DPDP §4) before any PII is touched; `/escalate` if ambiguous at build-time.
- **CF-SEC-5:** correlation-ID **4-tuple end-to-end** through all runtime paths introduced here (missing traceability = Stage-4 VETO).
- **CF-SEC-SECRETS-1:** all legacy credentials (DB, Supabase, Shopify/Meta/Google OAuth, SMTP, Anthropic) provisioned via **AWS Secrets Manager** — never in git; verify rotation before use. (Founder was advised to rotate the credentials exposed in chat.)

## Non-goals

- **Not** migrating connectors (Child 3), money representation (Child 2), metrics/OLAP (Child 4), AI engine (Child 5), or frontend (Child 6) — only auth/tenancy/RLS.
- **Not** a big-bang auth rewrite — keep Supabase Auth; layer Brain's claims/RLS onto it.
- **Not** decommissioning any legacy path (Child n).

## Linked prior runs

- Child 0 (binding architecture): `.engineering-os/runs/2026-05-24T00-58-39Z__a49c05__spike-legacy-migration-architecture__rishabhporwal` (see `06-architecture-plan.md` A1–A6, `13-deploy-report.md §5` carry-forward ledger)
- Parent epic: `.engineering-os/runs/2026-05-24T00-51-31Z__e0edfa__chore-migrate-legacy-to-brain__rishabhporwal`

## Notes

This is the FIRST slice that writes real code against the **live shared Supabase DB** (`pavcgecgciamejdcysjx`, ap-south-1). The architecture mandates legacy stays authoritative; RLS must be introduced backward-compatibly (legacy queries currently assume no RLS). Expect Aryan to plan the RLS rollout as additive + toggle-guarded with a dual-run/shadow verification, and to resolve how Brain's `SET LOCAL app.workspace_id` session context coexists with the legacy app's connection pooling (note the legacy `DATABASE_URL` uses pgbouncer in transaction mode — `SET LOCAL` + transaction pooling interaction is a known footgun to design around). Rohan should scope tightly at Stage 1 and may decompose further if the slice is too large for one safe rollout.
