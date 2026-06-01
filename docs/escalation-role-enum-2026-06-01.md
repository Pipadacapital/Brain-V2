# Escalation → Rohan (CTO Advisor): Workspace role-model reconciliation

**Raised by:** Aryan (Architect), 2026-06-01 · **Decision owner:** Rohan → Founder
**Type:** architecture decision (destructive + contract-breaking + GTM-semantic) —
explicitly outside architect authority. **Do not modify until dispositioned.**

## The conflict (three-way)

The built workspace-role enum diverges from **both** canonical sources:

| Source | Roles |
|--------|-------|
| **As-built** (DB enum + authz layer + ~15 test files) | `OWNER`, `ADMIN`, `MANAGER`, `ANALYST`, `VIEWER` |
| **LLD §1** `workspace_members.role` CHECK | `owner`, `operator`, `analyst`, `agency`, `viewer` |
| **Canon** `requirements/technical-context.md §5` | `viewer(1) → analyst(2) → agency(3, scoped+tagged) → operator(4) → owner(5)` |

Evidence: `apps/core-service/migrations/local-dev/01-schema-onboarding.sql:52` (enum
type), plus the api-gateway role hierarchy (`OWNER=5…VIEWER=1`) and ~15 test files
that assert the built names.

## Why this is not an architect ruling

1. **Destructive** — changing a Postgres enum type + every dependent column.
2. **Contract-breaking** — the entire api-gateway authorization layer (`requireRole`)
   and JWT claim model assert the built names; web/mobile consume them.
3. **GTM-semantic** — the canon's `agency` (scoped + tagged, for agency-reseller
   access) and `operator` are *product/go-to-market* role concepts, not a rename.
   Whether Brain needs first-class `agency`/`operator` roles is a business call.

## Architect recommendation

- **Hold the built enum (`OWNER/ADMIN/MANAGER/ANALYST/VIEWER`) for Phase-0/1.** It is
  load-bearing and internally consistent; no live harm.
- **Schedule a dedicated reconciliation requirement** (its own pipeline run) to decide
  the canonical role model, to land **before any agency-channel GTM work** (the moment
  `agency` scoped access becomes a real feature). That req owns: the role taxonomy
  decision, the enum migration, the authz-layer + test updates, and a canon/LLD update
  so all three sources agree.

## Decision needed from Rohan/Founder

1. Confirm hold-as-built for Phase-0/1? (recommended: yes)
2. Approve scheduling the role-model reconciliation as its own req (gated before
   agency GTM)? Or reconcile now?
3. Target taxonomy: keep `ADMIN/MANAGER`, or move to canon's `operator/agency`, or a
   merged model? (defer to the reconciliation req unless Founder wants to set it now)

Paired with `docs/lld-amendment-2026-06-01.md` (Amendment "Items NOT amended here").
