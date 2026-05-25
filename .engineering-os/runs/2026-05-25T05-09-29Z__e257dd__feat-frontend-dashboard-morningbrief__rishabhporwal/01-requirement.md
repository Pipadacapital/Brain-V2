# Requirement: Frontend — web dashboard + mobile Morning Brief — Brain-native (Child 6)

> Drafted from the binding Child-0 architecture (Child-6 row + the Zustand→Redux-Toolkit / axios→tRPC new-layer decisions + the KPI/dashboard canon + Morning Brief canon). This is the child that renders the UI. Rohan/Founder edit at Stage 1.

| Field | Value |
|-------|-------|
| **req_id** | `feat-frontend-dashboard-morningbrief` |
| **Title** | Frontend — web dashboard + mobile Morning Brief — Brain-native (Child 6) |
| **parent_epic** | `chore-migrate-legacy-to-brain` |
| **epic_child_id** | `child-6-frontend` |
| **Submitted by** | rishabhporwal |
| **Submitted at** | 2026-05-25T05:09:00Z |
| **Tier impact** | all (the dashboard + Morning Brief ARE the product surface the operator sees) |
| **Region impact** | in (₹ lakh/crore formatting; i18n/RTL seam for Phase-4 GCC; ap-south-1 API) |

---

## Lane *(set by Rohan at Stage 1)*

| Field | Value |
|-------|-------|
| **feature_class** | *(set by Rohan)* — expected **high-stakes** (multi-tenant data rendering + auth + money display) |
| **trigger_surfaces_touched (first-pass)** | `multi-tenancy` (workspace-scoped UI/API), `auth` (login/session/role-gated views), `money` (₹ display from MU — never compute in UI), `schema-proto` (tRPC client contract), `pii` (customer/order data rendered), `india-compliance` (residency of API) |
| **paradigm (first-pass)** | `sql` (UI reads pre-computed metrics from the API; LLMs never produce a number; the UI renders, never computes a metric) |
| **builders** | frontend-web (Ananya) + mobile (Karan) |

---

## Raw text (from Founder)

> Complete the application migration as per Brain's Architecture — I want to see an executable application, runnable, everything visible via the UI. (Standing directive: complete all epic children end-to-end; Founder checks at the end.)

---

## Problem statement

Child 6 of the strangler-fig migration — and the child that makes Brain VISIBLE. The legacy frontend is Next/Zustand + axios→REST. Brain's stack is locked: **Next.js 16 web dashboard** (Tamagui/Visx, tRPC client, Redux Toolkit + TanStack Query) + **React Native + Expo mobile** (the Morning Brief is THE primary product surface). The UI **renders** numbers from the metric engine (Child 4) + AI recommendations (Child 5) — it NEVER computes a metric; money displays come from BIGINT minor-units formatted at the edge.

This child builds the operator-facing surfaces: the web **Command Center / Home, Store Analytics, P&L, CM waterfall (Visx), cohort heatmap, MER/aMER/CAC cards, RTO/COD/pincode intelligence, Goal RAG, drill-down drawers**; and the mobile **Morning Brief** (≤3 ranked actions, approve/reject/edit → Decision Log). Every KPI comes ONLY from the metric registry; every metric drills to source rows.

## Scope (from Child-0 architecture — Rohan to confirm/split at Stage 1)

**In scope:**
- **Web dashboard (apps/web, Next.js 16):** Home/Command Center KPI cards, P&L, CM Waterfall (Visx), Cohort heatmap, MER/aMER/paMER/CAC cards, RTO/COD/pincode intelligence map, Goal RAG (green ≥95%/amber 80-95%/red <80%), drill-down drawers to source rows, realized-vs-placed revenue, Decision ROI, integration-health. KPIs ONLY from the metric registry; currency-aware (₹ lakh/crore).
- **Mobile Morning Brief (apps/mobile, RN+Expo):** the THREE-signal rule; ≤3 ranked actions each with problem/evidence/recommended-action/expected-impact(revenue+CM2)/risk/confidence + approve/reject/edit writing to the Decision Log; push delivery wiring; deep links; cert pinning/MASVS.
- **New-layer decisions BOUND here (recorded in Child-0):** Zustand→**Redux Toolkit**; axios→**tRPC** client. The tRPC client contract against the api-gateway.
- **Auth/session:** login + role-gated views (the 5-role model); workspace switcher; multi-tenant (every API call workspace-scoped).
- **i18n/RTL seam** (next-intl; strings externalized; Arabic/RTL activates Phase-4) + accessibility.
- **LLMs never produce a number** in the UI; faithfulness — AI narration never contradicts the rendered deterministic numbers.

**Out of scope (deferred):**
- Legacy frontend decommission (Child 7).
- Live production cutover of the operator surface (HOLD — facade routes; the live serve flip is held until parity + Founder sign-off).

## Dependencies
- Child 1 (gate), Child 2 (money MU display), Child 4 (metric registry/ClickHouse — the data the UI renders), Child 5 (AI recommendations / Morning Brief content) — all committed-on-branch / at readiness.
- api-gateway (tRPC) — the UI's data source; may need a read surface built/extended this child (Rohan/Aryan to scope).

## Constraints carried forward (Rohan to bind)
- `CF-BN-NOLEGACY-1`, money=MU-formatted-at-edge (UI never computes), KPIs-only-from-registry, drill-to-source, multi-tenant workspace-scoped API, faithfulness (AI never contradicts rendered numbers), accessibility, i18n seam, locked stack (Next 16 / Tamagui / Visx / tRPC / Redux Toolkit / RN+Expo).

## Notes for Stage 1 (Rohan)
- **This is the runnable-UI child** — the Founder wants to launch the app and SEE it. Consider scoping a vertical slice that renders end-to-end (e.g. 6a = web Command Center + P&L/CM-waterfall + the tRPC read contract + auth/workspace + Morning Brief core, against seeded data; 6b = the long tail of pages) so a runnable UI lands early.
- Shape boundary: build the surfaces + tRPC client + render against the metric registry; the live production operator-cutover is HELD. A LOCAL runnable stack + seed data is in-scope-adjacent (the "make it run" goal) — Rohan/Aryan decide if the seed/run harness lands here or in a dedicated run pass.
- Persona candidates: a dashboard-correctness/number-fidelity realist (UI must never compute/contradict a metric; drill-to-source) + a frontend-perf/a11y or mobile-Morning-Brief realist.
- Builders: Ananya (web) + Karan (mobile), parallel.
