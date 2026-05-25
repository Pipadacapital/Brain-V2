"""Settings / finance application use-cases (Phase 2, slice 7: feat-finance-settings-goals).

Goal attainment + directional RAG, the resolved cost stack (COGS inputs that feed CM),
the India festival template calendar (display), and the calendar report period grid with
marketing-action overlays — ported Brain-native from legacy routes/workspaces/{goals,costs,
cogs-settings,festivals,calendar-report} + lib/{metrics/goals,cogs,festivals,metrics/calendar-report}
onto the slice-1..6 foundation.

ROHAN STAGE-1 FINDINGS APPLIED:
  1. Goal RAG is DIRECTIONAL (higher-better 0.95/0.80 ; lower-better 1.05/1.20) — NOT flat.
  2. festival_lift is a PHANTOM (no legacy comparand) — NOT built. Festivals carry only a
     stored expected_multiplier template default.
  3. Calendar report = period grid (rev/cm3/spend/mer/amer/cac/aov) with marketing-action
     overlays + per-cell directional RAG — reuses slice-1/2/4 primitives, no new metric.
  4. COGS resolve (override% → product coq → fallback% → 0, then markup) feeds the EXISTING
     CM path — one source of truth, no second COGS compute.
"""
