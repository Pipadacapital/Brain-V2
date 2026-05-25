# Requirement — Slice E: connector data ingestion (epic-real-auth-supabase)

**Submitted by:** rishabhporwal (Founder) · **Date:** 2026-05-25
**Epic:** epic-real-auth-supabase (slices A–D DONE + COMMITTED) · **This:** slice E

## Ask
Once an account is connected (token in custody from slice D), PULL real Shopify orders/products
+ Meta Ads spend + Google Ads spend, normalize them to the canonical facts the slice-1/2/4
analytics read, idempotently UPSERT into the LOCAL dev Postgres, and make a connected workspace's
dashboard/store/pnl/marketing pages render the workspace's REAL pulled data instead of the seed.

## Honest constraint (Founder-stated, design around it)
The legacy `.env` holds only OAuth APP credentials (client id/secret, dev token, app id/secret,
login_customer_id) — NO per-account access/refresh tokens. A LIVE pull requires the Founder to
complete the interactive OAuth consent (slice-D flow) first; account tokens cannot be minted
autonomously. Therefore slice E is VERIFIED MECHANICALLY against provider-response FIXTURES (real
API shapes taken from the legacy code), and the live pull is confirmed by the Founder after consent.
Do NOT fake live data: a workspace with no connected account / no synced data shows the honest
"sync pending / connect a store" empty-state (slice C/D pattern).

## Scope (prioritized)
1. Shopify: orders (+ line items) + products via Admin API → canonical order/line-item facts (slice-1
   store/revenue-ladder + slice-2 P&L). Idempotent UPSERT; cursor/backfill window
   (SHOPIFY_ORDER_BACKFILL_DAYS). Money → BIGINT minor units; per-SKU GST via India adapter.
2. Meta Ads: spend/campaign insights → slice-4 marketing (MER/CAC, acquisition spend).
3. Google Ads: spend/campaign metrics → slice-4 marketing.
4. Sync trigger ("Sync now" on /settings/integrations and/or on connect) + per-connector sync status
   (idle/syncing/last_sync_at/error), reusing slice-D status UI. Idempotent + RLS + workspace-scoped.
5. After sync, the connected workspace's dashboard/store/pnl/marketing pages read REAL pulled data
   (not the seed). Keep the Sugandh-Lok seed workspace for demo.

## Constraints
- high-stakes (connectors, PII, multi-tenancy, secrets, data-residency).
- @paradigm sql/io — NO LLM. READ-only external calls; NO outbound sends (no DLT/NCPR surface).
- RLS fail-closed on all new connector-data tables; idempotent ingestion (re-sync ≠ double-count);
  tokens used from custody, NEVER logged/echoed; PII minimized (pincode/city default per India
  adapter — no full address/phone unless the metric needs it; DPDP).
- data-residency: local dev now, ap-south-1 in prod (note).
- Continue dev-only LOCAL Postgres (slice C/D). Live shared Supabase prod DB stays untouched.
- DO NOT git commit/push — produce a slice-scoped pending-founder-commit.md; real .env excluded +
  check-ignore-proven.

## Verify
Mechanically per connector: fixture provider response + a custody token → ingestion normalizes +
idempotently UPSERTs the right facts (re-run = no dupes), RLS-scoped; a connected workspace's
analytics tRPC then returns the ingested numbers (not the seed). typecheck 0; RLS + idempotency proven.
