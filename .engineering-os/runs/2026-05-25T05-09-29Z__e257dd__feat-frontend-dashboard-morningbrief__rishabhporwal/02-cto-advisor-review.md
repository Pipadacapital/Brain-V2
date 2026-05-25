# CTO Advisor Review — Stage 1 (intake / brainstorm)

> Filled by the CTO Advisor agent (Rohan) in Stage 1. Child 6 of EPIC `chore-migrate-legacy-to-brain`.
> Validates against [schemas/cto-advisor-review.schema.json](../schemas/cto-advisor-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `feat-frontend-dashboard-morningbrief` |
| **Stage** | 1  *(intake)* |
| **Timestamp** | 2026-05-25T05:40:00Z |
| **Decision** | **ADVANCE** *(personas requested first; synthesis pending orchestrator re-invoke)* |

---

## Ground truth read (verified, not trusted from memory)

The decisive facts that shape this intake — all verified on disk this session, not inferred from prose:

1. **The api-gateway, web, and mobile apps are BARE DDD scaffolds — `.gitkeep` only, zero implementation.** `apps/api-gateway/src/{bootstrap,application,infrastructure,domain,interfaces}/` are all `.gitkeep`; `package.json` is a stub ("implementation in its own requirement"). **There is no tRPC anywhere in the repo** (`grep -rl trpc apps/api-gateway` = empty). Same for `apps/web` and `apps/mobile`.
2. **There is NO gRPC service surface to call.** `protos/` contains only `brain/health/v1/health.proto` + `events/integrations.proto`. There is **no `MetricsService`, `IntelligenceService`, or `WorkspaceService` proto**. `apps/analytics-service/src/interfaces/` and `apps/intelligence-service/src/interfaces/` are bare `.gitkeep` — the data services have **no network entry-point at all**; they expose Python in-process functions only.
3. **The data plane functions DO exist** (Python, in-process): `analytics-service` `query_metrics(workspace_id: str, definition_id: str, date_range, *, _client) -> list[MetricRow]` (fail-closed `UnscopedQueryError` on falsy `workspace_id`); `lib-metrics/src/registry/` (TS metric registry, the display contract); `intelligence-service` `InsightItem{TypedRecommendation{action:closed-enum, entity_id, rationale:render-only}}` + a gateway-middleware faithfulness validator (numbers are validated server-side, BEFORE the UI ever sees them).
4. **The Child-1 auth contract exists Brain-native:** `core-service/src/domain/auth/brain-claim.ts` + `infrastructure/db/workspace-context.ts` (`withWorkspace`). The 5-role model + JWT claim shape are defined.
5. **The legacy frontend has ~33 `w/[slug]` route groups** (dashboard, pnl, waterfall, cohorts, rto-analytics, cod-prepaid, pincode-intelligence, acquisition, ltv, logistics, inventory, customer-lifecycle, settings/{costs,goals,integrations,festivals,…}, …). This is the long tail that the scope challenge is about.

**Implication (load-bearing):** Child 6 is **not pure frontend rendering**. To render even ONE number end-to-end, this child must build (a) the **api-gateway tRPC BFF + auth/tenancy choke point** (it does not exist), and (b) a **network read surface on analytics-service + intelligence-service** (gRPC handlers in the bare `interfaces/` folders + the `MetricsService`/`IntelligenceService` protos that do not exist), OR the gateway calls the Python services in-process under the Phase-0 `data`-deployable model. **That seam — how the TS gateway reaches the Python data plane — is the single most important Stage-2 decision and is a backend-developer (Vikram) job, not Ananya/Karan.** The requirement's own note ("the tRPC read surface … may need a read surface built/extended this child") understates it: nothing exists; it is built from zero.

---

## Made requirements less dumb first

*The "delete / simplify / defer" pass before anything else.*

**Could delete:**
- **The "10+ pages" framing.** The legacy has ~33 route groups; porting all of them in one child is the canon's #1 anti-pattern (big-bang) wearing a frontend hat. Delete the long tail from THIS child's definition of done; it belongs to 6b.
- **Any UI-side metric computation, rounding, or money math.** Not "minimize" — *delete*. The UI formats minor-units at the edge and renders registry values verbatim. There is exactly zero arithmetic in the presentation layer. This is a hard acceptance gate, not a guideline.

**Could simplify:**
- **The data seam.** Do NOT build a full split-service gRPC mesh for Phase-0. The locked stack says Phase 0–1 runs as a `data` deployable (ingestion+analytics+intelligence in one Python process) and an `edge` deployable (api-gateway+core). The gateway→data-plane call can be the simplest contract that satisfies tenancy + the locked tRPC client contract. Aryan rules the exact mechanism; the constraint is: it must be the *contract* the later split is mechanical against, not the full mesh today.
- **Auth.** Reuse the Child-1 `brain-claim` + 5-role model verbatim — the gateway *consumes* the existing JWT claim and calls `requireRole` on every workspace procedure. No new auth invention; this is wiring, not design.

**Could defer:**
- **i18n/RTL beyond the seam.** Externalize strings (next-intl) so Arabic/RTL is a Phase-4 adapter flip — but do NOT build Arabic translations or RTL layouts now. The seam is in-scope; the GCC activation is not.
- **The full long tail of ~33 route groups → 6b.** Cohort heatmap, COGS bulk editor, festivals, distributions, calendar, the per-channel ad detail pages, etc.
- **Live operator cutover.** Already deferred by the requirement (facade per-route-group flip, HELD). Reaffirmed: this child renders against SEEDED data behind a HOLD; the live-serve flip is Stage-8/Child-7 territory.
- **Mobile beyond the Morning Brief core.** Phase-1 mobile is read-only Morning Brief + push. Defer chat/approvals/biometric (Phase 2+).

---

## Lane decision

| Field | Value |
|-------|-------|
| **feature_class** | **high-stakes** |
| **feature_class_rationale** | Trigger-surface scan fires **≥5 hard surfaces**: `auth` (the gateway IS the auth/tenancy choke point — built here for the first time), `multi-tenancy` (`workspace_id` must flow JWT→gateway→data-plane on every read; a cross-workspace render is a P0 leak), `money` (every KPI is MU rendered as ₹ — wrong formatting/rounding at the edge corrupts the honest number the UI is supposed to show), `schema-proto` (the tRPC client contract + any new gRPC read surface/proto = a new contract source-of-truth), `pii` (customer/order data + RTO/pincode rendered in the UI; PII never in client logs), `india-compliance` (in-region API, ₹ lakh/crore formatting, residency of the read path). Foundational-scaffolding carve-out **inapplicable** — this child ships live presentation logic, auth, multi-tenant data reads, and money display, not empty homes. Conservative tie-break **moot** (multiple hard surfaces force high-stakes outright). |
| **trigger_surfaces_touched** | `auth`, `multi-tenancy`, `money`, `schema-proto`, `pii`, `india-compliance` |
| **Stages that will run** | Full high-stakes lane: 1 (intake +2 personas) → 2 (Aryan binding plan, **Maya consulted on the Morning-Brief content seam only**) → 3 (Ananya web + Karan mobile + **Vikram BFF/gRPC read surface**, parallel) → 4 (Shreya security VETO) → 5 (Tanvi QA VETO) → 6 (Rohan final VETO) → 7 (Founder gate, delegated) → 8 (Jatin deploy/run-harness). |

---

## Persona-count decision

**Count chosen: 2** (high-stakes lane cap; two distinct, non-overlapping risk dimensions intersect).

**Rationale:** The two dominant risk dimensions are orthogonal: (1) **number/money fidelity** — the UI must render registry values verbatim, never compute or round a metric, never let AI narration contradict the rendered number, and every KPI must drill to source; and (2) **the Morning-Brief mobile surface** — the canon's stated highest-quality UI in Brain, the SLO-bearing primary product surface, with its own thumb-first/offline/push/perf/a11y discipline distinct from the dense web workbench. One persona cannot do justice to both; they do not collapse into one (number-correctness is a web-dashboard-and-contract concern, the Morning Brief is a mobile-product-and-perf concern). This is exactly the 2-persona "two distinct dimensions intersect" rule.

**Personas requested (returned to orchestrator to spawn — I do NOT spawn; I have no Agent tool):**

1. **`dashboard-number-fidelity-realist:sonnet`** — reasoning-heavy (multi-step: the render-vs-compute boundary, the MU→₹ edge-format contract, faithfulness between AI narration and deterministic numbers, drill-to-source provenance, the cross-workspace render-leak path). Brief: prove the UI can NEVER compute, round, or restate a metric; prove a money value is formatted from MU at the edge with the right ₹ lakh/crore grouping and zero client-side arithmetic; prove AI narration text can never contradict the rendered registry number (the faithfulness seam — note Child-5 already validates numbers server-side, so the question is whether the UI can *re-introduce* a discrepancy via formatting/caching/stale-read); prove every KPI drills to source rows; name the single most likely path to a cross-workspace data render. Tag `:sonnet` — this is the iron-rule (LLMs-never-produce-a-number) at the presentation boundary, genuine reasoning depth.

2. **`mobile-morning-brief-perf-a11y-realist:sonnet`** — reasoning-heavy (the Morning-Brief SLO surface, the three-signal/≤3-action contract, approve/reject/edit → Decision Log write path from a thumb-first client, push/deep-link wiring, perf budget LCP<2s/INP<200ms, WCAG AA, offline/stale-data degradation, cert-pinning/MASVS). Brief: prove the Morning Brief renders the Child-5 `InsightItem`/`TypedRecommendation` contract faithfully (rationale is render-only — never sent back as an instruction; the action enum is closed); prove the approve/reject/edit path writes the Decision Log through the gateway with tenancy intact (a mobile write is still a Brain action — `requireRole` + Decision Log + idempotency); prove graceful degradation on stale/missing data; name the one mobile surface most likely to miss the perf budget or the a11y bar. Tag `:sonnet` — the canon's highest-quality UI + a Decision-Log-writing mutation path, reasoning-heavy.

**Declined personas (recorded):**
- `frontend-perf-a11y-realist` (web-only) — folded into persona 1's brief as a constraint; a third persona overshoots the cap and the web perf budget is a well-trodden, plan-level concern Aryan binds, not a separate risk dimension.
- `india-compliance-officer` — the compliance surface here is residency (one startup-assertion bind, inherited CF-RES-1) + ₹ formatting + PII-not-in-client-logs; no new channel/consent/telecom surface (this child sends nothing — no WhatsApp/SMS/call/email/ad-audience). Not a reasoning dimension that needs a persona; bound as constraints.
- generic-architecture / data-seam persona — the gateway↔data-plane seam is **Aryan's binding Stage-2 job**, not a Stage-1 adversarial read.

---

## Paradigm recommendation

**Recommended paradigm:** `sql` *(confirmed)*

**Why:** The UI **renders pre-computed values** — it never computes a metric and never calls an LLM to produce a number. KPIs come from the metric registry / `query_metrics` (deterministic SQL/ClickHouse, paradigm 1). AI *content* (Morning-Brief narration, recommendations) is produced upstream in Child 5 (the only place paradigms 3/4 live) and arrives already faithfulness-validated; the UI **renders that text, it does not generate it**. **There is zero inference path in this child.** Hard rule for Stage 6: any `@paradigm("small_llm"|"frontier_llm"|"ml")` decorator, any LLM client, or any metric arithmetic in `apps/web` / `apps/mobile` / the gateway read path is a paradigm violation → BOUNCE. The faithfulness invariant (AI narration never contradicts a rendered number) is enforced *upstream* (Child-5 validator) and *defended* here (the UI must render the same registry value the narration was validated against — no independent re-fetch that could drift).

> Architect (Aryan) may refine in Stage 2 — this is a first-pass read. I do not expect refinement; `sql`/render-only is structural for a presentation child.

---

## India context check

| Lens | Impact |
|------|--------|
| **RTO** | RTO/COD/pincode intelligence pages render RTO-adjusted CM2, RTO rate, break-even r* — all from the registry; UI renders, never recomputes the r* formula. Pincode-reliability map is a render of the Child-4 aggregate. |
| **COD** | COD-vs-prepaid margin views render pre-computed splits. No UI-side payment-method classification (that is the RegionAdapter, upstream). |
| **GST** | Money displayed is post-per-SKU-GST-slab Net Revenue from the registry; the UI **never** applies a tax rate. `formatMoney` formats MU + `currency_code` only. |
| **Festival seasonality** | Sale/Event Mode + festival-lift surfaces are 6b long-tail (deferred); the seam (a higher-cadence config of the same render primitives) is noted, not built. |
| **Pincode reliability** | Rendered from the Child-4 `pincode_reliability` aggregate (≥5 shipments); UI is a map/table render only. |
| **Telecom compliance (DLT / NCPR / DND / calling hours)** | **N/A this child.** Child 6 sends nothing outbound — no WhatsApp/SMS/voice/email/ad-audience. No DLT/NCPR/9am-9pm/WhatsApp-template surface. (Push notifications are transactional app-delivery, not A2P promotional telecom — but the *Morning-Brief push* delivery wiring lives in `notifications-service`/Child-7-adjacent; this child consumes the push token registration via tRPC `registerPushToken`, it does not own the send. Confirm at Stage 2 that the push *send* is out of scope and only token registration + receipt-render is in.) |

**Currency display:** ₹ lakh/crore grouping via the locked `formatMoney`; region-aware so AED/SAR is a Phase-4 adapter flip, not a fork. India in-region API (CF-RES-1 inherited).

---

## Scope ruling — 6a / 6b split (the core challenge)

**Ruling: ONE requirement, split into 6a (the runnable vertical) → 6b (the long tail). NOT a CHALLENGE-BACK; NOT two separate `/requirements`.** Precedent: Child-1 1a/1b, Child-3 3a/3b/3c, Child-4 4a/4b, Child-5 5a/5b — scope refinement *within* ADVANCE. (Collapse-vs-keep-split is confirmable at Stage 2 with a one-line rationale; burden is on collapsing, not on splitting — but here the runnable-app goal makes the split load-bearing, so I expect it held.)

**6a — the runnable vertical slice (ships first; the Founder's "I want to SEE it running" goal):**
- **api-gateway BFF born:** tRPC server + the locked tRPC client contract + auth/tenancy choke point (consume Child-1 `brain-claim` JWT; `requireRole` on every workspace procedure; `workspace_id` propagated to the data plane). **This is the spine — without it nothing renders.** (Vikram.)
- **Data-plane read surface:** the gateway-reachable read path into `analytics-service` `query_metrics` + the Child-5 `InsightItem` contract — the minimal contract Aryan rules (in-process `data`-deployable call vs a thin gRPC handler + proto). (Vikram, Aryan-bound.)
- **Web (Ananya):** **Command Center / Home** (live revenue+profit strip, revenue-quality, Top-3 actions placeholder, integration-health) + **P&L / CM-waterfall (Visx)** + **one drill-to-source drawer** (proves the provenance contract) + **auth/login + workspace switcher** + currency-aware `formatMoney`.
- **Mobile (Karan):** **Morning Brief core** — the three-signal / ≤3-action render of the Child-5 `InsightItem` contract, read-only, with the approve/reject/edit → Decision-Log write path wired through the gateway (the one mutation, fully tenancy + RBAC + idempotency gated). Push *token registration* + deep-link seam.
- **Against SEEDED data**, behind the HOLD (no live operator cutover).
- **A LOCAL runnable harness** (see next section) so the Founder can `pnpm dev` / Expo-run and SEE it.

**6b — the long tail (ships behind 6a):**
- The remaining ~28 web route groups (cohort heatmap, RTO/COD/pincode full pages, MER/aMER/CAC card suite, Goal RAG everywhere, LTV, acquisition, logistics, inventory, customer-lifecycle, all settings sub-pages, distributions, calendar, per-channel ad detail).
- Mobile beyond the Morning Brief core (the broader tab nav, Evening Pulse, etc.).
- i18n translations + RTL layouts (Phase-4 adapter; seam only in 6a).

**Why this slice:** It lands a **runnable, visible, end-to-end-truthful** Brain — login → workspace → see live P&L + CM-waterfall + the Morning Brief, every number from the registry, the one mutation writing the Decision Log — which is exactly the Founder's explicit goal, while keeping the dangerous-first ordering (the auth/tenancy/money-display/contract spine is the risky unit and ships first; the long tail is mechanical repetition behind a proven primitive).

---

## Runnable-UI / seed-harness scope ruling

**Ruling: a LOCAL runnable + seed harness IS in-scope for 6a** (not a separate run pass), because the requirement's success metric — set by the Founder's standing directive — is literally "a runnable app I can see." A child that builds the UI but cannot be run does not satisfy its own acceptance bar (same reasoning as the scaffold child: an unverifiable deliverable fails the metric).

**Bounded so it does not become a deploy project:**
- **In scope:** a local dev harness (e.g. `docker-compose` for Postgres/ClickHouse fixtures + a `pnpm dev` web + Expo mobile run) + **deterministic seed data for ONE workspace (Sugandh Lok)** that exercises the 6a surfaces (P&L, CM-waterfall, a Morning-Brief insight set). The seed feeds the *registry/query-gateway contract*, NOT hand-typed numbers in the UI — the UI must render through the real data path so the render-only invariant is actually exercised.
- **Out of scope (→ Jatin, Stage 8):** any live/staging deploy, MSK/ClickHouse-Cloud provisioning, the live operator cutover, ArgoCD/CI-deploy changes. The harness proves *runnable locally*; *deployable* is Stage-8.
- **Aryan rules at Stage 2** whether the seed lands as a fixture pack consumed by the local data-deployable, and confirms it touches **zero legacy code** and **no live Supabase**.

---

## New-layer decisions — BOUND here (recorded in Child-0, bound in Child 6)

Per Child-0 architecture line 510 ("tRPC + Redux Toolkit decided"; "axios→tRPC, Zustand(`stores/insight-jobs.ts`)→Redux Toolkit") and line 89 ("tRPC procedures: legacy axios→REST migrates to tRPC in Child 6 — recorded decision; not implemented here"). These are now **BOUND** (locked) for the build:

- **`axios → tRPC`** — the web + mobile clients use the tRPC client against the api-gateway tRPC router (same router, mobile additive: `registerPushToken`, `app.minVersion`, `featureFlags`). No REST/axios in Brain client code. (Locked stack; technical-context §10/§12.)
- **`Zustand → Redux Toolkit`** — UI/chat/drill-down state is Redux Toolkit; server state is TanStack Query; URL filters/date is nuqs. The legacy `stores/insight-jobs.ts` Zustand store is NOT ported as Zustand. (Locked stack — Zustand is explicitly banned, technical-context §2/§12.)

No tech-stack-evaluation needed — both are inside the LOCKED stack. Recording them here as binding so Aryan plans against them and Stage 6 can audit drift.

---

## Builders + Maya co-own ruling

- **Ananya (frontend-web)** — `apps/web` (Next.js 16, Visx, tRPC client, Redux Toolkit). 6a web surfaces.
- **Karan (mobile)** — `apps/mobile` (RN+Expo). Morning Brief core + push-token/deep-link seam.
- **Vikram (backend-developer) — REQUIRED, not optional.** The api-gateway tRPC BFF + auth/tenancy choke point + the data-plane read surface (gRPC handler/proto or in-process contract) **do not exist and are backend work.** This is the spine of 6a; Ananya/Karan have nothing to render against until it exists. Flagging this now so Stage 2 staffs it — the requirement's "frontend child" label undersells a real backend dependency.

**Maya co-own: NO — but she is CONSULTED on ONE seam.** Rationale: Child 6 renders; it does not define metrics or AI behavior. The metric definitions are Child-4 (Maya, shipped), the AI/Morning-Brief *content* is Child-5 (Maya, shipped). The UI consumes already-defined, already-validated contracts (`query_metrics`, `InsightItem`/`TypedRecommendation`, the faithfulness validator runs server-side upstream). That is rendering, not metric/AI definition — outside Maya's lane. **The one seam where she is consulted (not co-owner): the Morning-Brief content contract** (`InsightItem`/`TypedRecommendation`) — confirm the UI renders `rationale` as render-only (never echoed back as an instruction; the action enum is closed) and that the approve/reject/edit payload the mobile client sends back matches what the Child-5 Decision-Log write path expects. That is a contract-confirmation consult at Stage 2, not co-ownership. Aryan may upgrade her to co-owner at Stage 2 with a one-line rationale if the content seam proves load-bearing; default is consult.

---

## Escalation (per rubric)

**None at intake.** Walked the triggers: no compliance ambiguity (this child sends nothing outbound; residency is the inherited CF-RES-1 startup-assertion bind, unambiguous; PII-not-in-client-logs is a standard hardening constraint, not an ambiguity); no cost-model threat (`sql`/render-only, zero inference path — it *defends* the %-of-GMV model by keeping the UI off the LLM); no irreversible/high-blast-radius decision (everything behind the HOLD, seeded data, no live cutover, reversible per-route-group facade flip); no moat change. The Founder gate at Stage 7 (delegated to me) is the correct ratification point, not a mid-pipeline `/escalate`.

> One *armed-not-fired* item carried to Stage 2 (not an escalation): confirm the Morning-Brief **push send** is out of scope (token registration + receipt render in; the actual push delivery is `notifications-service`, a later child). If Stage 2 finds the send is implicitly required here, that is a scope-creep bounce, not an escalation.

---

## Binding constraints to Stage 2 (acceptance inputs for Aryan / Shreya / Tanvi)

- **CF-C6-SCOPE-SPLIT-1** — 6a runnable vertical / 6b long tail; collapsible at Stage 2 with one-line rationale; the runnable-app goal makes the split load-bearing (expect held).
- **CF-C6-RENDER-ONLY-1** (CRITICAL) — the UI NEVER computes, rounds, or restates a metric; zero arithmetic in `apps/web`/`apps/mobile`/gateway read path; money is `formatMoney(MU, currency_code)` at the edge only. Stage-5 must prove with a test that a registry value renders byte-faithfully and a mutation (UI re-rounds) is caught.
- **CF-C6-GATEWAY-TENANCY-1** (CRITICAL) — `workspace_id` flows JWT→gateway→data-plane on EVERY read; `requireRole` on every workspace procedure; the gateway is the auth/tenancy choke point (consumes Child-1 `brain-claim`). Stage-5 negative control: a request scoped to ws_A returns ZERO ws_B rows; an unscoped/role-insufficient request is rejected fail-closed.
- **CF-C6-FAITHFULNESS-RENDER-1** (HIGH) — the UI renders the SAME registry value the Child-5 narration was validated against; no independent re-fetch/cache that could drift the displayed number from the narrated number. (The iron rule defended at the presentation edge.)
- **CF-C6-DRILL-TO-SOURCE-1** (HIGH) — every KPI drills to its source rows (provenance contract); at least one drawer proven in 6a.
- **CF-C6-MB-DECISION-LOG-1** (HIGH) — the mobile approve/reject/edit is a Brain action: it writes the Decision Log through the gateway with tenancy + RBAC + idempotency; `rationale` is render-only (never echoed back as instruction); action enum is closed (Child-5 `TypedRecommendation`).
- **CF-C6-DATA-SEAM-1** (CRITICAL, Aryan must-decide) — the gateway↔Python-data-plane mechanism: in-process `data`-deployable call vs thin gRPC handler+proto. No "figure it out during build" path (the Shape-B trap that bit Child 1). Whatever is chosen must be the contract the later service split is *mechanical* against (proto-first if gRPC).
- **CF-C6-RUNNABLE-HARNESS-1** (HIGH) — a LOCAL runnable + deterministic Sugandh-Lok seed for the 6a surfaces, feeding the real data path (not hand-typed UI numbers); zero legacy code, no live Supabase. Defines the "I can see it run" acceptance.
- **CF-C6-NEW-LAYER-1** — axios→tRPC and Zustand→Redux Toolkit BOUND (locked stack); any axios/Zustand in Brain client code = drift bounce.
- **CF-C6-PERF-A11Y-1** (HIGH) — web LCP<2s/INP<200ms/CLS<0.1/route-JS<100KB + WCAG AA; mobile Morning-Brief the highest-quality surface (thumb-first, three-minute flow). Magic UI scoped to login/onboarding/empty-state ONLY — dashboards stay shadcn + Visx/Recharts.
- **CF-C6-I18N-SEAM-1** — strings externalized (next-intl); Arabic/RTL is a Phase-4 adapter flip; no translations/RTL built now.
- **CF-C6-PII-CLIENT-1** (HIGH) — no PII in client logs/Sentry; mobile refresh token in `expo-secure-store`, access token in memory; cert pinning + MASVS L1.
- **CF-C6-HOLD-AT-ROUTE-FLIP** (named hold) — facade serves the legacy frontend; the per-route-group live flip is HELD to Stage-8/Child-7; this child renders against seeded data behind the HOLD; ZERO live operator cutover.
- **Inherited:** CF-BN-NOLEGACY-1 (never edit legacy; reference-only), CF-RES-1 (ap-south-1 read path), Child-1 auth/RLS gate (SATISFIABLE — sufficient for seeded/shadow render), Child-2 MU money representation, Child-4 query-gateway read discipline, Child-5 `InsightItem`/faithfulness contract.

---

## Open questions for Stage 2 (inputs for Aryan, not blockers)

1. **The data seam (CF-C6-DATA-SEAM-1)** — in-process data-deployable call vs gRPC handler+proto. The single biggest Stage-2 decision; drives whether new protos (`MetricsService`/`IntelligenceService`) are authored this child.
2. **6a/6b collapse-vs-split** confirmation (expect held given the runnable-app goal).
3. **Push send scope** — confirm token-registration-in / push-delivery-out (notifications-service is a later child).
4. **Seed harness home** — fixture pack consumed by the local data-deployable; how it stays zero-legacy / no-live-Supabase.
5. **Maya consult vs co-own** on the Morning-Brief content seam (default consult; upgrade with rationale).
6. **Vikram staffing** — confirm the BFF + data-read-surface is staffed as a parallel build track at Stage 3 (it is the 6a spine).

---

## Decision

**ADVANCE** — sound, business-aligned (the visible product surface the Founder explicitly wants), dependency-satisfiable for the BUILD (Child-1 auth + Child-4 query-gateway + Child-5 InsightItem contracts all present; live cutover HELD), and planable. Refined in scope (6a→6b) within ADVANCE, not bounced. Two personas requested; synthesis pending the orchestrator re-invoke.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T05:40:00Z",
  "actor": "cto-advisor",
  "type": "intake-advance",
  "req_id": "feat-frontend-dashboard-morningbrief",
  "stage": 1,
  "decision": "ADVANCE",
  "rationale": "Child-6 frontend: high-stakes (auth/tenancy/money/proto/pii/residency); paradigm sql/render-only confirmed; scope split 6a runnable-vertical (gateway BFF+auth+P&L/CM-waterfall+Morning-Brief core, seeded, behind HOLD) / 6b long tail; local seed-harness in-scope; new-layer axios->tRPC + Zustand->Redux bound; Vikram REQUIRED for the non-existent gateway/data-read spine; Maya consulted (not co-owner) on Morning-Brief content seam; 2 personas requested (dashboard-number-fidelity + mobile-morning-brief-perf-a11y); no escalation."
}
```
