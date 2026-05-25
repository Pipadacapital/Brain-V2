# Feature journal — feat-pnl-cm-waterfall (Phase-2 slice 2)

> Honest P&L + CM waterfall → lights up /pnl and /waterfall. Child of epic-phase2-feature-parity. Builds on slice-1 (feat-store-order-fact-layer). @paradigm sql.

## 2026-05-25T14:06:44Z — Stage 1 (intake) — Rohan
**Decision:** ADVANCE → Stage 2. Lane high-stakes (inherited). 0 personas (clear repeat of slice-1 vertical; dominant risks pre-resolved).
**CRITICAL binding finding:** TS cm1_mu = net_revenue − cogs (definitions.ts:147, COGS-only, WRONG). Python cm1_mu = net_revenue − cogs − variable_costs (definitions.py:285, honest). TS has no variable_costs_mu; Python has it (definitions.py:273). The shadow_compare parity gate checks structural fields only — formula divergence passed silently. Same root cause as feat-metric-engine-olap-split Shreya H-1. MUST close: add TS variable_costs_mu (byte-identical structural fields), correct TS cm1_mu, cascade cm2/cm3/true_cm2, make the gate non-vacuous (correctness fixture on the formula).
**Other findings:** two divergent legacy CM ladders (pnl.ts vs waterfall.ts) — register the delta; don't duplicate Child-6 metrics.pnlWaterfall (re-point/deprecate); FX poison not ported; per-SKU GST never blended; RLS fail-closed.
**Prep fix:** uv workspace unblocked (intelligence-service tool.uv.sources brain-cost-router).
