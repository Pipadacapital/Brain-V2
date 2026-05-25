# Final Review — feat-pnl-cm-waterfall (Stage 6, Rohan) — VETO authority

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 6 (final review / drift / paradigm / over-engineering / independent gate re-run) |
| **Verdict** | **PASS** → Founder gate (Stage 7), signed under standing delegation |

## 1. Drift check (requirement → plan → build)

The requirement (honest P&L + CM waterfall lighting up `/pnl` + `/waterfall`, on slice-1's foundation)
is delivered exactly. Every binding finding from my Stage-1 review is satisfied:
- ✅ The CRITICAL TS↔Python `cm1_mu` divergence is CLOSED (TS now `net_revenue − cogs − variable_costs`,
  byte-identical to Python; `variable_costs_mu` added to TS).
- ✅ The parity gate is made NON-VACUOUS (cross-language CM-ladder anchor fixtures that fail the old
  COGS-only formula and pass the honest one).
- ✅ The CM definitional delta is REGISTERED (`_ROW_CM1`), not silently reconciled.
- ✅ No duplicate CM-waterfall path — `metrics.pnlWaterfall` re-pointed to the honest builder (Single-Primitive).
- ✅ FX poison NOT ported; per-SKU GST never blended; RLS fail-closed on every new query.
No scope creep: segment proration + founder-salary rungs were explicit non-goals and were NOT built.

## 2. Paradigm audit

`@paradigm("sql")` on every new file (3 Python use-cases incl. `__init__`, 3 web components). Zero
LLM/ML, zero inference path, zero new runtime. The full CM ladder is deterministic integer arithmetic
over registry formulas. PASS — paradigm mix preserved (~85% SQL epic target intact).

## 3. Multi-tenancy (4 layers) — verified present

(1) `workspaceProc` + `requireRole('ANALYST')` at the router; (2) `ctx.workspaceId` from claim only,
middleware asserts request-ws==claim-ws; (3) fail-closed `workspace_id` re-assert in both use-cases;
(4) `query_metrics` scoped gateway + stub fail-closes. Proven by 8 negative tests AND wire smoke
(foreign `x-workspace-id` → UnscopedQueryError, no leak). Shreya PASS confirmed.

## 4. Observability

`request_id` returned on every new procedure + surfaced sr-only in the P&L table (CF-SEC-5); gateway
logs the correlation 4-tuple per request. Consistent with slice-1.

## 5. Over-engineering audit (MANDATORY — per the durable "No over-engineering" rule)

- Files staged ⊆ the architect's plan file list — **no extra files**. ✅
- No observability/metrics/tests beyond plan. ✅
- No npm/pip/uv dependency added (the `tool.uv.sources` entry is a toolchain repair that unblocks the
  Python parity tests — brief-authorized prep fix, not a dependency add). ✅
- No new abstraction for "future use" — `variable_costs_mu` is a correctness ADD that matches the
  pre-existing Python def; the CM-waterfall use-case WRAPS the statement use-case (no second ladder math). ✅
- Plan length proportionate to a money/multi-tenancy/registry high-stakes change. ✅
- No 30+ line WHAT-comments. ✅
**No over-engineering finding.**

## 6. Independent gate re-run (MANDATORY — I re-ran ≥3 of Tanvi's gates myself; captured output)

| Gate | Tanvi | Rohan (independent) |
|------|-------|---------------------|
| TS↔Python parity gate | PASS | **PASS** (re-ran `check-metrics-parity.sh`: "[parity-gate] PASS"; non-vacuous killed-mutant sub-step PASS) |
| brain_metrics (py) | 291 | **291 passed** |
| analytics-service (py) | 76 | **76 passed** |
| DDR register test (py) | (incl) | **40 passed** (my new `_ROW_CM1` signable, 9 fields) |
| api-gateway pnl router (ts) | (incl 52) | **52 passed** (12 pnl tests verbose-confirmed) |

Plus my own real-network re-smoke of the wire (pnl.statement cm1=97000000 honest; true_cm2=4516440
re-derived by hand = 4516440 ✓; metrics.pnlWaterfall alias == pnl.cmWaterfall). I replicate Tanvi's PASS.

## 7. Hard-rule deviation scan (step 9)

- Dependency violation: NONE (slice-1 shipped/approved; blocker satisfied).
- Single-Primitive Rule: HONORED (one CM-waterfall source; one `variable_costs_mu` def per language).
- Compliance gap: NONE (per-SKU GST preserved; FX poison excluded; no outbound channel).
- Paradigm escalation beyond plan: NONE (SQL throughout).
- Gate-skip without codified exception: NONE.
**No hard-rule deviation.** Auto-approve under standing Founder delegation is permitted.

## 8. Definitional-Delta Register sign-off (Stage-6)

- `cm1_mu` (`_ROW_CM1`, parity_gap:false, no child_dependency): **SIGNED (shadow-compare GREEN)** —
  Brain CM1 = net_revenue − cogs − variable_costs matches the compute-daily canonical path
  (cross-language byte-identity proven; anchor 779000/200000/50000 → 529000 on both sides). The
  waterfall-page RTO-in-CM1 divergence is correctly deferred to True-CM2; not folded into CM1.
- `true_cm2_mu`, `realized_revenue_mu`, `pamer_bp`, `amer_bp`, `ltv_cac_bp` (parity_gap:true): already
  signed as correctness-fixtures in prior slices; reused, re-verified GREEN by the parity gate.
- `total_tax_mu`, `fx_restatement` (child_dependency on Child-3): correctly UNCHANGED and still held —
  not signed (Rule 2), consistent with the held connector cutover.

## Recommendation to Founder

**APPROVE.** Slice 2 is correct, honest, registry-traced, fail-closed, paradigm-clean, and ships two
real data-backed pages. It additionally CLOSED a pre-existing shipped correctness bug (the TS COGS-only
`cm1_mu`) and hardened the parity gate against the formula-divergence class. Nothing committed — the
mechanical commit command + `pending-founder-commit.md` are produced for the Stage-7 gate.

## Commit scope note (for Stage 7)

Slice-scoped paths ONLY (explicit; NO `git add -A`). Excludes unrelated working-tree churn
(`.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts` — Next auto-gen). Phase-1 auth files
(login-form.tsx, next.config.ts) are clean vs HEAD and NOT in this change set. The `uv.lock` +
`intelligence-service/pyproject.toml` ARE included (the brief-authorized uv-workspace prep fix).
