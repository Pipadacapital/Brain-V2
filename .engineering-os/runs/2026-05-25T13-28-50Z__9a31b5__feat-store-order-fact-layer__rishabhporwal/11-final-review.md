# Stage 6 — Final Review (Rohan, VETO) — feat-store-order-fact-layer

| Field | Value |
|---|---|
| **req_id** | `feat-store-order-fact-layer` (Phase 2, slice 1 of `epic-phase2-feature-parity`) |
| **Reviewer** | Rohan (cto-advisor) |
| **Verdict** | **PASS** |
| **Recommendation** | **APPROVE** |
| **Founder gate** | SIGNED under standing delegation (no hard-rule deviation — §9) |
| **Committed** | NO (awaits Founder free-text "commit it") |

## §1 Drift check (requirement → plan → build)

The deliverable bar is fully met, no scope creep:

| Deliverable | Status |
|---|---|
| Real, data-backed `/store` page | ✓ HTTP 200, renders the live revenue ladder via `trpc.store.revenueLadder` (post-login) |
| Dashboard reads the SAME canonical facts (not the seed stub) | ✓ `kpiSummary.net_revenue_mu == store.realized_revenue_mu == 185000000` (unified `SUGANDH_LOK_CANONICAL` seed) |
| Legacy revenue logic ported through connector framework + query gateway | ✓ `StoreSummaryQuery` reads via `query_gateway.query_metrics`; no second DB path |
| Revenue-ladder metric defs with TS↔Python parity GREEN | ✓ gross/discount/tax added TS-side; `realized_revenue_mu` both sides; parity exit 0 |
| `store.summary` / `store.revenueLadder` tRPC | ✓ workspaceProc + requireRole(ANALYST), bigint over superjson |
| `/store` wired (Ananya) | ✓ StoreContent + RevenueLadderStrip |
| Money BIGINT minor units | ✓ end-to-end; superjson `meta.values` types every `_mu` as bigint |
| Per-SKU GST 2.0 via RegionAdapter, NEVER blended | ✓ `india_gst` per-SKU SUM; blended-cannot-reproduce test |
| RLS proven on every new query | ✓ fail-closed at gateway + use-case + BFF + data plane; cross-ws live-refused |
| `@paradigm("sql")` | ✓ all new files; zero LLM/ML |
| Real-network smoke PASS | ✓ live boot :3001 + :3000 |
| Def-delta registered, not float-matched | ✓ `realized_revenue_mu` DDR row (parity_gap:true); `total_tax_mu` per-SKU keeps its child-3 DDR row |

## §2 Independent re-verification (I re-ran ≥3 of Tanvi's gates with my own captured output)

1. **Parity gate** — re-ran `./tools/check-metrics-parity.sh` → **exit 0**; 25 vectors byte-identical;
   `realized_revenue_mu` correctness_fixture SQL match + DDR formula_snapshot coverage; 20 shared
   metrics structural-match; 2 mutants killed (gate non-vacuous).
2. **api-gateway store tests** — re-ran `router.store.test.ts` → **8 passed**.
3. **analytics store + GST tests** — re-ran → **20 passed**.
4. **Independent live boot** — booted api-gateway on :3001 myself; `store.revenueLadder` returned
   `[218000000, 206000000, 188000000, 191000000, 185000000]` with bigint meta + fresh request_id UUID.
5. **Verify-the-verifier (my own mutation)** — I disabled the `getStoreSummary` tenancy guard →
   the cross-workspace test went **RED** ("fails closed on a cross-workspace request"); reverted
   byte-identical (0 MUTANT occurrences; 8 tests green; tsc exit 0). The isolation test is NOT vacuous.

## §3 Paradigm audit

`@paradigm: sql` on every new file. Zero LLM/ML import (grep clean). The slice DEFENDS the
%-of-GMV cost model — no inference path added. PASS.

## §4 Four-layer multi-tenancy

- **Layer 1 (query entry):** `query_metrics(workspace_id, ...)` — workspace_id first positional,
  non-optional, fail-closed (`UnscopedQueryError`).
- **Layer 2 (use-case):** `StoreSummaryQuery.execute` re-asserts falsy-workspace before any read.
- **Layer 3 (BFF):** `store.*` are `workspaceProc` (workspaceMiddleware asserts ctx==claim) +
  `requireRole('ANALYST')`; pass `ctx.workspaceId` (JWT-derived), never a client value.
- **Layer 4 (data plane):** `getStoreSummary` fails closed on unauthorized workspace_id.
- LIVE proof: cross-workspace header → tRPC error carrying `UnscopedQueryError ... not authorized`.
PASS.

## §5 Observability

Correlation: every `store.*` response carries `request_id` (fresh per-request UUID, verified live);
the gateway logs request_id+trace_id+workspace_id per request; the frontend surfaces request_id in
an sr-only node + ErrorDisplay. Decision Log correctly N/A (read-only analytics). PASS.

## §6 Money integrity

BIGINT minor units end-to-end; superjson carries bigint on the wire (verified live); `formatMoney`
is the ONLY display conversion; zero float in the GST formula (`// 10_000` FLOOR) or the use-case
(integer SUM); FX poison absent. PASS.

## §7 Over-engineering audit

- **Files staged not in the plan?** No — every changed/created file maps to the plan's file list.
- **Observability/metrics/tests beyond plan?** No — tests are exactly the planned positive+negative
  coverage; the dead `_client_with_orders` helper I caught during build was removed.
- **Dependencies beyond plan?** ZERO. (The `apps/web/package.json` + `pnpm-lock.yaml` churn in the
  working tree is PRE-EXISTING Child-6 frontend — `@tabler/icons-react` etc. — NOT this slice; I
  added no dependency. `git diff HEAD` confirms.)
- **New abstraction for future use?** No — the India GST adapter is a single pure function + slab
  constant (NOT a multi-region framework; UAE/GCC is Phase 4, explicitly not built). `realized_revenue_mu`
  is the only net-new metric.
- **Plan length proportionate?** Yes — a feature-vertical plan for a high-stakes money/tenancy slice.
- **30+ line WHAT-comments?** No — comments explain WHY (the registry asymmetry, the per-SKU GST
  honesty constraint, the held-cutover reversal-fact discipline).
CLEAN.

## §8 Single-Primitive Rule

ONE formatMoney (lib-metrics, imported only); the TS+Python registries are the byte-identity pair
(not a fork); ONE store-read path (the query gateway). I explicitly did NOT add a second `net_of_tax`
id — the existing `net_net_tax_mu` serves the spec's `net_sales_net_tax_mu` concept (documented).
The use-case computes net_revenue inline (not via the divergent-signature Python `net_revenue_mu`
formula) — a documented registry-asymmetry handling, not a new primitive. CLEAN.

## §9 Hard-rule deviation check

Scanned for: dependency violation, Single-Primitive violation, compliance gap, paradigm escalation
beyond plan, gate-skip without codified exception. **NONE present.** Dependency check clean (builds
on committed contracts; no held cutover executed). Delegation is therefore exercisable — I sign the
Founder gate on the Founder's behalf.

## §10 Findings carried (non-blocking)

- **B0 (PRE-EXISTING, OUT OF SLICE):** 6 `login-form.test.tsx` failures ("app router not mounted")
  from a pre-existing uncommitted `login-form.tsx` `useRouter()` change. `feat-store-order-fact-layer`
  touched ZERO `auth/` files (`git diff --name-only HEAD` verified). Recorded as out-of-scope
  test-debt; surfaced to the Founder; does NOT block this slice and is NOT absorbed into its green
  count. → This is the 3rd occurrence of the "uncommitted working-tree contaminates verification"
  root-cause family → CANDIDATE rule proposed (§11), human-gated.
- **L1 (LOW):** reversal facts (cancelled/RTO/refunded) feeding realized revenue are an explicit
  seeded input in Phase-0; live per-reversal connector facts arrive at the held Child-3 cutover.
  Same held-dependency posture as `total_tax_mu` per-SKU data. Mechanism proven; live wire held.

## §11 Auto-candidate rule (v0.8.0 — NOT self-adopted)

Root-cause family "uncommitted working-tree state contaminates a stage's verification/commit set"
now appears in ≥3 distinct runs (Child-1, Child-2 divergent-gate-copy; Child-6 stray staged files;
this slice's pre-existing login-form break). Proposed:
`.engineering-os/rule-proposals/2026-05-25__pre-stage-working-tree-baseline.md`. Founder reviews via
`/adopt-rule` or `/reject-rule`. I did NOT adopt it.

## Verdict

**PASS → Founder gate (Stage 7) SIGNED under delegation → Stage 8 readiness.** APPROVE. No commit.
Per the Founder directive: slice 1 is at Stage-6 PASS — STOP; do not auto-start slice 2.
