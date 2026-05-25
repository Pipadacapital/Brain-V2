# Stage 1 — CTO Advisor Review (Rohan) — feat-parity-cleanup-pages (SLICE 10, FINAL)

**Decision: ADVANCE** (full high-stakes pipeline on `feature/feat-store-order-fact-layer`).

## Lane decision
- **feature_class: high-stakes** (inherited from the epic + trigger-surface scan below).
- **feature_class_rationale:** Trigger-surface scan fires on MULTIPLE surfaces: **multi-tenancy** (`workspace_id` on every new read), **connectors/external integrations** (integrations + ad-campaigns + backfill surfaces), **PII** (`/team` exposes member email/name — a real PII surface), and **schema/contract change** (new `DataPlanePort` methods + new tRPC procedures). Any one forces high-stakes; conservative tie-break confirms it. Express/standard are off the table.
- **trigger_surfaces_touched:** `multi-tenancy`, `connectors`, `pii`, `schema-proto` (BFF/proto contract methods).
- **Stages that run:** S1 (me) → S2 Aryan → S3 Maya+Vikram+Ananya → S4 Shreya → S5 Tanvi → S6 me. Gates under standing Founder delegation.

## Persona-count decision
- **Count: 1** — `frontend-data-honesty-realist:haiku` (bounded checklist angle).
- **Rationale (classifier rule):** A single risk dimension dominates this slice — **honest-state discipline under a HELD connector cutover**. The danger is not cost (pure SQL/READ, zero LLM), not numeric parity (these pages mostly REUSE shipped defs — no new metric math), not compliance-send (Shreya already held the slice-8 outbound boundary; nothing here sends). The dominant failure mode is: a developer fabricating a plausible-looking number (sessions, conversion, ad ROAS, member count) for a page whose real data source is a connector that isn't flowing — i.e. a fake-runnable page that LOOKS done but lies. One bounded persona stress-tests exactly that. Two personas would overshoot; this is not a two-dimension intersection.
- **Why `:haiku`:** the angle is a bounded checklist ("for each of the 9 pages, is every rendered value either (a) a real shipped seed value or (b) an explicit honest 'pending cutover' affordance? Flag any invented number"). No multi-step reasoning/migration/parity depth — Haiku handles it at ~6x lower cost.
- **needs_personas: ["frontend-data-honesty-realist:haiku"]** — returned in HANDOFF; orchestrator spawns, then re-invokes me to synthesize.

## "Make the requirement less dumb first" (delete / simplify / defer)
- **DELETE phantom scope:** the slice-table shorthand for `/analytics` says "session, conversion, funnel". Reading the actual legacy (`shopify-analytics.ts`) shows sessions/conversionRate are **explicitly nullable, Shopify-sync-sourced** (`sessions: null, conversionRate: null`). We do NOT build a session/funnel surface from thin air — `/analytics` = the store-level deep revenue/CM breakdown that IS seeded (reuse slices 1-2), with sessions/conversion rendered as honest "pending connector cutover". This is the standing lesson applied pre-emptively.
- **DEFER all WRITE/OAuth surfaces (correct, not laziness):** member invite (ADMIN, sends email), connector connect/OAuth, backfill triggers (owner-only POST), campaign-classification save. Building live OAuth here would (a) cross the connector-cutover HOLD and (b) re-trigger a full compliance review. Ship READ views + disabled "pending cutover" affordances; list every deferred action.
- **SIMPLIFY:** 4 of 9 pages need ZERO new data surface — pure reuse of shipped tRPC. Only 5 pages touch genuinely net-new surfaces (team/settings/integrations/ad-campaigns/backfill), and those are mostly thin honest-state views, not analytics computation.

## Reuse audit (the load-bearing finding — verified against the live tree, not prose)
Confirmed from `apps/api-gateway/src/application/router.ts` + `loopback-data-plane.ts` + `proto-types.ts`:

| Page | Data source | Reuse vs net-new |
|---|---|---|
| `/analytics` | `store.summary` (slice-1 ladder) + `pnl.statement` (slice-2 CM) | **100% REUSE.** Sessions/conversion = honest "pending cutover" (Shopify-sync; nullable in legacy). |
| `/meta-ads` | `marketing.efficiency` (`meta_spend_mu`) + `marketing.acquisition` (meta split) | **REUSE** for seeded per-platform spend/efficiency; per-campaign drilldown = honest "connect Meta to see campaigns" (legacy itself returns this at HTTP 200 when unconnected). |
| `/google-ads` | `marketing.efficiency` (`google_spend_mu`) + `marketing.acquisition` (google split) | **REUSE**; same honest per-campaign affordance. |
| `/shiprocket` | `logistics.summary` (slice-3) + `logistics.rto` | **REUSE.** Legacy `/shiprocket` route is ONLY backfill triggers (WRITE, owner-only) — the VIEW is `logistics.ts`. Backfill actions deferred (honest disabled). |
| `/settings/ad-campaigns` | `marketing.acquisition` (`acquisition_ad_spend_mu` = the slice-4 classification split) | **REUSE.** Spend-by-intent view from shipped data; classification SAVE (write) deferred. |
| `/team` | **NET-NEW** read: workspace members (core-service membership) | New `DataPlanePort.getWorkspaceMembers` + `team.members` tRPC. PII surface → Shreya scrutiny. Invite = deferred write. |
| `/settings` (general) | **NET-NEW** read: workspace name/plan/timezone/region | New `DataPlanePort.getWorkspaceSettings` + `settings.workspace` tRPC. CRUD deferred. |
| `/settings/integrations` | **NET-NEW** read: connector health/status/last-sync | New `DataPlanePort.getIntegrations` + `settings.integrations` tRPC. The honest-state CENTERPIECE: list connectors with status/last-sync/error; all CONNECT actions deferred (connector cutover HELD). |
| `/settings/backfill` | **NET-NEW** read: ads-backfill job status | New `DataPlanePort.getBackfillStatus` + `settings.backfill` tRPC. Connector-dependent → honest "pending cutover"; trigger deferred. |

**Net assessment:** ~55% pure reuse (4 pages, zero new contract), ~45% thin net-new honest-state READ surfaces (5 pages). **ZERO new metric registry defs expected** — these pages either reuse shipped defs or render operational/membership/connector status, which are NOT metric scalars (they don't go through the registry/parity gate). If a developer reaches for a new registry def, that's a red flag to bounce.

## Honest-state ruling (the non-negotiable for this slice)
The HELD Child-3 connector cutover means live connector data is NOT flowing. The rule, per page:
- **Real seed value** where shipped data exists (store ladder, CM, logistics, marketing spend split, acquisition classification) — render it for real.
- **Explicit honest affordance** ("Connector pending cutover" + integration-health/last-sync) where the value is connector-live and not seeded (Shopify sessions/conversion, per-campaign ad drilldown, backfill jobs).
- **NEVER a fabricated number** and **NEVER a "Coming in Phase 2" stub.**
- **Deferred WRITE/OAuth/backfill-trigger:** rendered as disabled affordances with a clear reason, and enumerated in the deferred list.
Aryan must make this a CF-anchored gate (e.g. `CF-S10-HONEST-STATE-1`): a structural/snapshot test asserting (a) zero `ScaffoldPage` import in `(shell)`, (b) no page renders a hardcoded numeric literal for a connector-live field.

## Domain context check (India-D2C business canon)
- **Money minor units:** every new read returns `_mu` bigint paise; format only at the edge. PASS-by-design.
- **Per-SKU GST:** untouched — these pages sit on the slice-1/2 honest base; no blended tax. PASS.
- **Multi-tenancy (4 layers):** every new `DataPlanePort` method MUST replicate the fail-closed guard (`workspace_id !== this.workspaceId → UnscopedQueryError`) and every new tRPC proc MUST be `workspaceProc` + `requireRole(ANALYST)`. Tenancy on the `/team` member read is doubly important (PII). Aryan + Shreya to verify fail-closed at the wire for each new procedure.
- **Compliance (DPDP/PII):** `/team` exposes member email + name — real personal data. READ-only, workspace-scoped, ANALYST-gated. No export, no outbound. Invite (which emails a person) is DEFERRED. Shreya: confirm the member read returns no more PII than the legacy team list (fullName/email/role/joinedAt) and is RLS fail-closed. NOT an `/escalate` trigger — this is in-scope READ of data the role already sees, no ambiguity.
- **No outbound channel touched:** nothing here sends WhatsApp/SMS/email/call. The slice-8 compliance boundary stays held.

## Paradigm (first-pass)
**@paradigm sql** for all 9. Zero LLM, zero ML — these are reads of already-computed facts + operational/membership/connector status. (AI narration is slice-9's job and is page-parameterized for /pnl/store/dashboard only; not in scope here.)

## Single-Primitive Rule guard (for S6)
- Do NOT create a new metric def for any page that can reuse a shipped one. `/analytics` reuses the store ladder + P&L; `/meta-ads`/`/google-ads`/`/ad-campaigns` reuse `meta_spend_mu`/`google_spend_mu`/`acquisition_ad_spend_mu`; `/shiprocket` reuses logistics defs.
- The 5 net-new surfaces add `DataPlanePort` methods (membership/settings/integration/backfill status) — these are NOT registry metrics; they are operational reads. Correct seam = additive methods on the SAME `DataPlanePort` (CF-C6-DATA-SEAM-1), not a second data path.

## Open questions for Aryan / persona
- For the persona: stress-test every one of the 9 pages for a fabricated-number risk; confirm the honest affordance is real (not cosmetic) where the connector isn't flowing.
- For Aryan: confirm whether the local StubDataPlane should seed a small honest "integrations" payload (e.g. Shopify CONNECTED with a last-sync, Meta/Google/Shiprocket "PENDING CUTOVER") so `/settings/integrations` renders a real-but-honest list — vs. an all-pending list. Either is honest; pick the one that best demonstrates the health/status UI. Do NOT seed fake ad-campaign numbers.
- Confirm `/team` member seed mirrors the legacy shape (fullName/email/role/joinedAt) for the anchor workspace, with invite deferred.

## Decision
**ADVANCE** to Stage 2 (Aryan) after the 1-persona round-trip. Lane high-stakes; full pipeline; gates under standing delegation; nothing committed.
