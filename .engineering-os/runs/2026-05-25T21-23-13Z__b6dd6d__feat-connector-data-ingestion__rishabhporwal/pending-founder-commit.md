# Pending Founder Commit — Slice E: connector data ingestion

**Status:** Stage 6 PASS (Rohan, under standing delegation). Nothing committed. The Founder runs the
commit below after review (free-text "commit it" per the harness guard).

## Pre-commit safety proof (verified at Stage 6)
- `git check-ignore apps/api-gateway/.env` → **IGNORED**
- `git check-ignore apps/core-service/.env` → **IGNORED**
- `git ls-files apps/**/.env` → **(empty — no real .env tracked)**
- NO secret/token VALUE in any committed file. Token-leak grep gate PASS (no console.* / no token field in
  any log/return/throw across slice-E files).
- Branch: `feature/feat-tenancy-auth-rls-hardening` (current). The Founder may prefer a fresh
  `feature/feat-connector-data-ingestion` branched from development per the branching-flow rule.

## EXACT paths to commit (NO `git add -A`)

```bash
# --- core-service: migrations (local-dev fact tables + RLS + down) ---
git add apps/core-service/migrations/local-dev/05-schema-connector-facts.sql
git add apps/core-service/migrations/local-dev/06-enable-rls-connector-facts.sql
git add apps/core-service/migrations/local-dev/down-connector-facts.sql

# --- core-service: sync + ACL + normalizers + fact-analytics (the slice-E engine) ---
git add apps/core-service/src/application/connectors/sync/acl.ts
git add apps/core-service/src/application/connectors/sync/normalizers.ts
git add apps/core-service/src/application/connectors/sync/provider-fetch.ts
git add apps/core-service/src/application/connectors/sync/sync-use-cases.ts
git add apps/core-service/src/application/connectors/sync/fact-analytics.ts
git add apps/core-service/src/application/connectors/sync/index.ts
git add apps/core-service/src/application/connectors/index.ts          # barrel re-export (edit)

# --- core-service: tests ---
git add apps/core-service/src/__tests__/slice-e-acl-normalizers.test.ts
git add apps/core-service/src/__tests__/integration/slice-e-ingestion-proof.integration.test.ts

# --- api-gateway: read seam (dispatcher + local-db plane + honest empties) + router/server wiring ---
git add apps/api-gateway/src/infrastructure/dispatching-data-plane.ts
git add apps/api-gateway/src/infrastructure/local-db-data-plane.ts
git add apps/api-gateway/src/infrastructure/empty-results.ts
git add apps/api-gateway/src/application/router.ts                     # connectors.sync procedure (edit)
git add apps/api-gateway/src/interfaces/server.ts                     # DispatchingDataPlane wiring (edit)

# --- web: Sync now button + status + test ---
git add apps/web/src/interfaces/components/settings/integrations-content.tsx
git add apps/web/src/test/integrations-content.test.tsx

# --- pipeline audit trail (this run) ---
git add ".engineering-os/runs/2026-05-25T21-23-13Z__b6dd6d__feat-connector-data-ingestion__rishabhporwal"
git add .engineering-os/decision-log/2026/05/2026-05-25.jsonl
git add .engineering-os/memory/agents/cto-advisor.journal.md
git add .engineering-os/memory/features/epic-real-auth-supabase.md
git add .engineering-os/state/active.json

git commit -m "feat(slice-e): connector data ingestion — Shopify/Meta/Google pull → real analytics

Sync now pulls real orders/products + ad spend using the slice-D custody token, normalizes
to canonical minor-units facts (per-SKU GST, COD/Prepaid, opaque customer_ref), idempotently
UPSERTs into local Postgres under FORCE RLS, advances last_sync_at. A DispatchingDataPlane
serves a connected workspace its OWN ingested facts; Sugandh-Lok keeps its seed; non-fed
surfaces show honest empty. READ-only, no LLM, token never logged. Verified by fixtures
(real API shapes) + live local Postgres (P-001..P-007). typecheck 0; 21 unit + 6 integration
+ 225/245/89 suites green; zero new deps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## DO NOT commit (git-ignored — verify they are absent from `git status`)
- `apps/api-gateway/.env`, `apps/core-service/.env` (real secrets — IGNORED, proven above)

## After commit — to test the LIVE pull (Founder steps)
1. **Register the 3 redirect URIs** (from slice D), local-dev:
   - Shopify (Partner dashboard): `http://localhost:3000/api/integrations/shopify/callback`
   - Meta (App dashboard → FB Login): `http://localhost:3000/api/integrations/meta/callback`
   - Google (Cloud Console → OAuth client): `http://localhost:3000/api/integrations/google/callback`
2. Apply the slice-E migrations to the local dev DB (one-time):
   ```bash
   docker exec -i brain-postgres-dev psql -U postgres -d brain_dev < apps/core-service/migrations/local-dev/05-schema-connector-facts.sql
   docker exec -i brain-postgres-dev psql -U postgres -d brain_dev < apps/core-service/migrations/local-dev/06-enable-rls-connector-facts.sql
   ```
3. `pnpm dev` (web :3000 + gateway :3001). Sign in → **Connect** a store/ad account → complete the
   provider **consent** (this mints the real per-account token slice E needs).
4. On `/settings/integrations`, click **"Sync now"** for the connected vendor.
5. Open `/dashboard`, `/store`, `/pnl`, `/marketing` for that workspace → they now render the workspace's
   REAL pulled numbers (not the Sugandh seed).
