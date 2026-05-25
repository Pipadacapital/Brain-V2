# Stage 2 — Architecture Plan (Aryan) — feat-parity-cleanup-pages (SLICE 10, FINAL)

Synthesizing Rohan's S1 + the data-honesty persona (C1-C5). @paradigm sql. Zero new metric registry defs. Additive on the SAME `DataPlanePort` (CF-C6-DATA-SEAM-1). Branch: `feature/feat-store-order-fact-layer`.

## Design principle
9 pages = 2 buckets:
- **Bucket A (4 pages, REUSE-only):** `/analytics`, `/meta-ads`, `/google-ads`, `/shiprocket`, `/settings/ad-campaigns` (5 routes) — wire client components to ALREADY-SHIPPED tRPC. No new BFF/port code. Honest affordance for connector-live tiles.
- **Bucket B (4 routes, thin NET-NEW READ):** `/team`, `/settings`, `/settings/integrations`, `/settings/backfill` — 4 new `DataPlanePort` methods + 1 new `settings.*`/`team.*` tRPC each, workspaceProc/ANALYST READ `.query`, fail-closed tenancy, honest-state seeds.

(Note: ad-campaigns lands in Bucket A as a 5th reuse route; that's why 9 pages map to 5 reuse + 4 net-new.)

## CF gates (load-bearing, from the persona)
- **CF-S10-NO-SCAFFOLD-1** (structural test): no file under `apps/web/src/app/(shell)` imports `ScaffoldPage`. This is the Founder's literal bar; committed test, not a one-time grep (persona C5).
- **CF-S10-HONEST-STATE-1** (per page): connector-live tiles (analytics sessions/conversion, per-campaign ad rows, backfill jobs, non-Shopify connector sync times) render an explicit honest affordance, never a hardcoded number. A snapshot/structural test asserts the honest-state component is present and no fake numeric literal is rendered for those fields (persona C1-C4).
- **CF-S10-TENANCY-1** (per new port method): `workspace_id !== this.workspaceId → UnscopedQueryError`; new tRPC = workspaceProc + requireRole(ANALYST); proven at the wire (foreign-ws → UnscopedQueryError).
- **CF-S10-NO-WRITE-1** (structural): every new procedure is a `.query`; NO `.mutation` (no invite/connect/backfill-trigger/classify-save shipped). Mirrors the slice-8/9 read-only structural assertion.

## Bucket A — reuse wiring (no new BFF code)

### 1. `/analytics` (Store Analytics) — reuse `store.summary` + `pnl.statement`
- New client: `interfaces/components/store/analytics-content.tsx` → `store.summary` (revenue ladder) + `pnl.statement` (CM ladder + true_cm2). Render the deep store breakdown for real.
- **Honest (C1):** a "Storefront engagement" section renders `<ConnectorPending source="Shopify storefront analytics" metric="Sessions / Conversion rate" />` — NO number. Page header notes data-as-of epoch.
- Page: replace ScaffoldPage import with `<AnalyticsContent />`.

### 2. `/meta-ads` & 3. `/google-ads` — reuse `marketing.efficiency` + `marketing.acquisition`
- New clients: `interfaces/components/marketing/meta-ads-content.tsx` + `google-ads-content.tsx`. Render real `meta_spend_mu`/`google_spend_mu` + aMER/CAC platform split (seeded). One shared sub-component `platform-ads-view.tsx` (DRY, single primitive — NOT two copies).
- **Honest (C2):** per-campaign table region renders `<ConnectorPending source="Meta Ads"/Google Ads" detail="Connect to see per-campaign breakdown" />` — no fabricated campaigns. Matches legacy HTTP-200-unconnected behavior.

### 4. `/shiprocket` — reuse `logistics.summary` + `logistics.rto`
- New client: `interfaces/components/logistics/shiprocket-content.tsx` → real shipment/delivery/RTO/courier breakdown (seeded slice-3). Backfill-courier / backfill-pincode triggers rendered as **disabled** buttons with "Available after connector cutover" (deferred write).

### 5. `/settings/ad-campaigns` — reuse `marketing.acquisition`
- New client: `interfaces/components/settings/ad-campaigns-content.tsx` → spend-by-intent (acquisition vs total, from `acquisition_ad_spend_mu`/`total_ad_spend_mu`, both seeded). Classification SAVE deferred (read-only view; "editing classifications available after connector cutover").

## Bucket B — net-new honest READ surfaces

### Port additions (`proto-types.ts` `DataPlanePort` + types)
```
getWorkspaceMembers({workspace_id}) -> { result: WorkspaceMembersResult, data_epoch }
getWorkspaceSettings({workspace_id}) -> { result: WorkspaceSettingsResult, data_epoch }
getIntegrations({workspace_id}) -> { result: IntegrationsResult, data_epoch }
getBackfillStatus({workspace_id}) -> { result: BackfillStatusResult, data_epoch }
```
Types (READ shapes, mirror legacy):
- `WorkspaceMemberRow`: { user_id, full_name, email, role, joined_at } + `pending_invitations` count (no PII beyond legacy team list).
- `WorkspaceSettingsResult`: { workspace_id, name, plan, timezone, region, currency_code, created_at }.
- `IntegrationRow`: { connector, status: 'CONNECTED'|'PENDING_CUTOVER'|'DISCONNECTED'|'ERROR', last_sync_at | null, last_sync_error | null }.
- `BackfillJobRow`: { job_type, status, started_at | null, note } — empty list locally + honest note.

### StubDataPlane seeds (honest — persona C3/C4)
- Members: 3 seeded members for Sugandh-Lok (Owner/Manager/Analyst) + 0 pending. Real shape, real workspace.
- Settings: { name: "Sugandh Lok", plan: "GROWTH", timezone: "Asia/Kolkata", region: "IN", currency_code: "INR" }.
- Integrations: **Shopify CONNECTED** with a fixed last_sync_at = DATA_EPOCH (real backfilled epoch); **Meta / Google / Shiprocket / Klaviyo = PENDING_CUTOVER**, last_sync_at NULL, no fake time. This demonstrates the health UI honestly.
- Backfill: **empty list** + honest note "No backfill jobs — connector cutover pending."

### tRPC (router.ts)
- `team.members` (workspaceProc/ANALYST/.query) → getWorkspaceMembers.
- `settings.workspace` (.query) → getWorkspaceSettings.
- `settings.integrations` (.query) → getIntegrations.
- `settings.backfill` (.query) → getBackfillStatus.
All replicate the requireRole(ANALYST) + fail-closed pattern; all `.query` (CF-S10-NO-WRITE-1).

### Clients
- `interfaces/components/workspace/team-content.tsx` (member table, role badges, deferred invite button disabled).
- `interfaces/components/settings/workspace-settings-content.tsx` (name/plan/timezone/region read display).
- `interfaces/components/settings/integrations-content.tsx` (connector health cards w/ status + last-sync; connect buttons disabled "pending cutover").
- `interfaces/components/settings/backfill-content.tsx` (honest empty-state + disabled trigger).
- Shared `interfaces/components/shared/connector-pending.tsx` (the honest affordance — single primitive reused across all pages).

## Page rewrites (9 files)
Replace `ScaffoldPage` import with the matching content component in: analytics, meta-ads, google-ads, shiprocket, team, settings/page, settings/integrations, settings/ad-campaigns, settings/backfill.

## Tests
- api-gateway: new router tests for team.members + settings.{workspace,integrations,backfill} (happy path + foreign-ws UnscopedQueryError + role-gate FORBIDDEN + CF-S10-NO-WRITE-1 structural).
- web: CF-S10-NO-SCAFFOLD-1 structural test + per-page render tests (real value present; ConnectorPending present where expected; no fake numeric literal on connector-live fields).

## Non-goals (deferred — honest affordances shipped)
Member invite (ADMIN, emails a person); connector OAuth connect/disconnect; backfill triggers (owner-only POST); campaign-classification save; live Shopify sessions/conversion; per-campaign Meta/Google rows. All re-trigger connector-cutover and/or compliance review — OUT of this slice.

## Verification (Stage 5/6)
api-gateway :3001 + web :3000; all 9 routes HTTP 200 with real content; grep zero ScaffoldPage in (shell); foreign-ws rejected on each new proc; typecheck 0; no new metric def added; @paradigm sql.
