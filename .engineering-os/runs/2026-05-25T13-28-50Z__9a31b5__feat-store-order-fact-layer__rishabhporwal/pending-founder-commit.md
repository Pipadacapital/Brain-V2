# Pending Founder Commit — feat-store-order-fact-layer (Phase 2, slice 1)

> NOT committed. The Founder reviews and gives free-text "commit it". This doc lists the EXACT
> slice-scoped product-code paths (NO `git add -A`). Pre-existing Child-6 working-tree churn
> (apps/web/(shell)/, components/ui|shell/, lib/, package.json, pnpm-lock.yaml, login-form.tsx,
> next.config.ts, globals.css, layout.tsx, dashboard-content.tsx) is NOT part of this slice and
> must be EXCLUDED from this commit.

## Mechanical commit command (slice-scoped paths only)

```bash
cd /Users/rishabhporwal/Desktop/Brain
git add \
  packages/lib-metrics/src/registry/definitions.ts \
  pylibs/brain_metrics/brain_metrics/registry/definitions.py \
  pylibs/brain_metrics/brain_metrics/parity/definitional_delta_register.py \
  apps/analytics-service/src/domain/region/__init__.py \
  apps/analytics-service/src/domain/region/india_gst.py \
  apps/analytics-service/src/application/store/__init__.py \
  apps/analytics-service/src/application/store/store_summary_query.py \
  apps/analytics-service/tests/test_india_gst.py \
  apps/analytics-service/tests/test_store_summary_query.py \
  apps/api-gateway/src/domain/proto-types.ts \
  apps/api-gateway/src/domain/registry-mapper.ts \
  apps/api-gateway/src/infrastructure/loopback-data-plane.ts \
  apps/api-gateway/src/application/router.ts \
  apps/api-gateway/src/application/router.store.test.ts \
  apps/web/src/interfaces/components/store/revenue-ladder-strip.tsx \
  apps/web/src/interfaces/components/store/store-content.tsx \
  "apps/web/src/app/(shell)/store/page.tsx"

git commit -m "feat(phase2-slice1): store/order fact layer + revenue ladder (real /store)

- revenue-ladder defs: gross/discount/tax added TS-side (match Python); realized_revenue_mu
  Brain-native (correctness_fixture, parity_gap:true) both registries + DDR row
- india_gst per-SKU GST 2.0 adapter (never blended; fail-closed on invalid slab)
- StoreSummaryQuery use-case (first analytics application-layer occupant; reads via query gateway)
- store.summary + store.revenueLadder tRPC (workspaceProc, ANALYST, bigint over superjson)
- /store page wired to live revenue ladder; dashboard + /store share one canonical seed
- TS<->Py parity exit 0; api-gateway 40 tests; analytics 61 + brain_metrics 291; live smoke green

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## EXCLUDE explicitly (pre-existing Child-6 working-tree churn — NOT this slice)
- `apps/web/package.json`, `pnpm-lock.yaml` (Child-6 deps: @tabler/icons-react, radix-ui, etc.)
- `apps/web/src/interfaces/components/auth/login-form.tsx` (pre-existing useRouter change — also the
  cause of the 6 failing login-form tests; disposition is the Founder's, not this slice's)
- `apps/web/next.config.ts`, `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`,
  `apps/web/src/interfaces/components/dashboard/dashboard-content.tsx`, the rest of `(shell)/`,
  `components/ui/`, `components/shell/`, `lib/`, deleted `app/dashboard/page.tsx`
