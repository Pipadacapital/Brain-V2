# Retro — feat-pnl-cm-waterfall (Phase-2 slice 2)

## What worked
- **Semantic recall at intake paid off directly.** Recall surfaced the Child-4 Shreya H-1 bounce
  ("TS↔Python↔DDR formula divergence; vacuous registry-parity gate") which made me read the actual
  `cm1_mu` formulas on both sides — finding a SHIPPED, GREEN-passing correctness bug (TS cm1 was
  COGS-only). Caught at Stage 1, not at a bounce.
- **Foundation reuse held.** Slice-1's query gateway, DataPlanePort, registry+parity harness, India GST
  adapter, format-money, and the existing chart components were reused wholesale. ~90% plumbing reuse.
- **Single-Primitive re-point.** Instead of a 2nd CM-waterfall path, `metrics.pnlWaterfall` was
  re-pointed to the honest builder; the test proves alias == canonical. No fork.
- **Cross-surface consistency by construction.** Choosing the cost-ladder seed so the honest
  re-derivation yields the EXISTING dashboard KPI cm2/cm3 kept every prior test green AND made /pnl,
  /waterfall, /dashboard show the same CM2/CM3.
- **uv prep fix unblocked Python tests** at the toolchain root (no ephemeral venv this time).
- **Live smoke confirmed honest minor-unit values on the wire** (cm1=97M not 103M; true_cm2 hand-re-derived).

## What didn't (or surprised us)
- **The vacuous-gate failure class struck an ALREADY-SHIPPED production gate.** The `shadow_compare`
  parity gate had been GREEN across multiple slices while silently permitting a TS↔Python `cm1_mu`
  formula divergence — because it compares structural fields + decimal-conversion vectors, never the
  formula text. This is the 8th occurrence of the verify-the-verifier root cause (proposal evidence #8).
  It would NOT have been caught without a reviewer happening to recall the lineage — the danger of an
  inert gate is precisely that it looks green.
- **Two legacy CM ladders disagree** (pnl.ts vs waterfall.ts) — a latent definitional inconsistency in
  the source system. Registered as `_ROW_CM1`; Brain canonicalizes one honest ladder (RTO at CM2, not CM1).
- **Stale dev servers on :3000/:3001** from a prior session served OLD code (pre-slice-2) and had to be
  killed before the smoke would exercise the new procedures. A lesson for the smoke runbook: always
  verify the booted process is on the current build (the `NOT_FOUND` on `pnl.statement` was the tell).

## Root cause of the primary finding
The metric-parity gate's `shadow_compare` path is structural-only; it does not anchor the actual
formula across languages. The same class (vacuous/verify-the-verifier) recurs because the verification
instrument doesn't exercise the property it claims to guard.

## Disposition
- Added as **evidence #8** to the existing human-gated proposal
  `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md`
  (NOT self-adopted — awaits Founder `/adopt-rule`). Surfaced in `pending-founder-attention.md`.
- Slice-2 closed THIS instance with a production-path cross-language formula anchor and re-verified it
  bites at Stage-6.
