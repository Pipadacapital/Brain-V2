# Retro — feat-store-order-fact-layer (Phase 2, slice 1)

## What worked
- **The assembly line ran end-to-end first-try-green on the slice's own surface.** 0-persona intake
  was the right call — every risk dimension was settled by a shipped layer-child; the rigor landed on
  the plan + per-query VETO + parity gate + my Stage-6, not a brainstorm. The epic reframe (breadth
  phase, reuse the A1.2 map) paid off: ~90% plumbing reuse, the build was almost all feature surface.
- **Reusing Child-4's query gateway as the tenant-isolation analogue** meant RLS was free — the
  use-case inherits `UnscopedQueryError` fail-closed; I only had to PROVE it per-query (live cross-ws
  refusal + my own mutation test going RED).
- **The unified `SUGANDH_LOK_CANONICAL` seed** is the clean way to satisfy "dashboard reads the same
  canonical facts" reversibly — `kpiSummary.net_revenue == store.realized_revenue` is now a provable
  invariant (and a regression test), without a risky dashboard rewrite.
- **Per-SKU GST honesty has a real kill-test** (`blended-cannot-reproduce-per-sku`) — the anti-pattern
  is mechanically excluded, not just asserted in prose.

## What didn't / friction
- **The TS↔Python registry asymmetry bit once.** The Python `net_revenue_mu` def has a DIFFERENT
  (2-arg net_sales−tax) signature than the TS (net_net_tax+shipping) shape. I called the Python def
  with TS semantics and a test caught it (4_898_000 vs 5_890_000). Fixed by computing net_revenue
  inline in the use-case and documenting the asymmetry. This is exactly the kind of thing the parity
  gate's structural-only check for shadow_compare does NOT catch — worth watching as more slices add
  cross-language defs.
- **Test-runner friction:** the uv workspace fails to build (`brain-cost-router` missing a
  `tool.uv.sources` entry in intelligence-service), so analytics tests can't run via `uv run`. Worked
  around with an ephemeral venv + brain_metrics installed. This is a toolchain debt that will bite
  every Python slice — flagged.

## What surprised us
- **Pre-existing uncommitted working-tree breakage.** 6 `login-form.test.tsx` tests fail on a
  `login-form.tsx` change that predates this slice (the `useRouter()` addition). This is the 3rd
  occurrence of the "uncommitted working-tree contaminates a stage" family → I proposed a candidate
  rule (human-gated). The autonomous-epic / accumulate-uncommitted posture makes this structural, not
  incidental.
- **The Python registry already had the full ladder head** (gross/discount/tax) while TS only had the
  middle — so the slice was partly "make TS catch up to Python" rather than "build from scratch." The
  asymmetry was invisible until I diffed both registries.

## Carry-forward for slice 2 (pnl/waterfall)
- Reconcile or formally document the TS↔Python `net_revenue_mu` signature asymmetry before more defs
  pile on it (it feeds CM1→CM2→CM3 — slice 2's whole surface).
- Fix the uv-workspace `tool.uv.sources` entry so Python tests run via the standard runner.
- The reversal-fact + per-SKU-tax live wires remain held on Child-3 — slice 2's CM2 def-delta
  (already a DDR row) is the next parity-sensitive surface.
