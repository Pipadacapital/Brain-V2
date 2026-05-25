# Security Review — feat-pnl-cm-waterfall (Stage 4, Shreya)

| Field | Value |
|-------|-------|
| **req_id** | `feat-pnl-cm-waterfall` |
| **Stage** | 4 (security / tenancy / compliance VETO) |
| **Verdict** | **PASS** (no CRITICAL/HIGH; advances to Stage 5) |

## 4-layer multi-tenancy isolation — verified on EVERY new query path

| Layer | Where | Evidence |
|-------|-------|----------|
| **1. Edge auth + role** | `pnl.statement` / `pnl.cmWaterfall` are `workspaceProc` + `requireRole('ANALYST')` before any data-plane call (router.ts) | Negative tests: VIEWER → FORBIDDEN (/ANALYST/) for both procedures. |
| **2. Context scoping** | `ctx.workspaceId` from the claim is the ONLY workspace_id passed to the data plane; `workspaceMiddleware` rejects request-ws ≠ claim-ws | Inherited from the Child-6 trpc layer (gates.test.ts tenancy suite still green). |
| **3. Use-case fail-closed** | `PnlStatementQuery.execute` / `CmWaterfallQuery.execute` re-assert `if not workspace_id or not workspace_id.strip(): raise UnscopedQueryError` BEFORE any read; workspace_id is first positional, non-optional | Negative tests: empty + whitespace workspace_id raise UnscopedQueryError. |
| **4. Gateway predicate** | reads go through `query_metrics(workspace_id, ...)` (the same scoped gateway slice-1 used); stub fail-closes on a non-matching workspace_id | Negative tests: cross-workspace request (claim ws ≠ stub-authorized ws) rejected for both procedures; cross-ws isolation tests prove ws_A never sees ws_B facts (no 3× leak). |

**Cross-workspace isolation: PROVEN.** The 8 negative tests across the two test files exercise
context-less = zero rows, empty/whitespace ws, and ws_A-querying-with-ws_B-seeded all fail closed.

## PII / data-exposure review
- The P&L and CM waterfall surfaces are **aggregate money metrics only** — no customer PII, no
  order-level identifiers, no email/phone. Nothing new in the PII surface.
- request_id is surfaced sr-only (CF-SEC-5) for traceability — not a secret.
- No new logging of raw values; no secrets in code.

## Compliance review (India canon)
- **Per-SKU GST 2.0**: `total_tax_mu` remains the slice-1 per-SKU def (never blended); CM1 consumes
  net_revenue which is already GST-honest upstream. `_ROW_TOTAL_TAX` keeps the Child-3 child_dependency.
  No regression.
- **FX poison**: the legacy `EXCHANGE_RATES` (INR:83.5) in pnl.ts/waterfall.ts/workspace-costs.ts was
  **NOT ported**. Money is primary-currency integer paise. `_ROW_FX` governs the held shadow rate. PASS.
- **RTO honesty**: True-CM2 provisions RTO at CM2 (not double-counted in CM1) — economically correct
  for Indian-D2C. Surfaced as a labeled line.
- **Telecom (DLT/NCPR/calling-hours/WhatsApp)**: NOT triggered — read-only analytics, no outbound
  channel. No `/escalate` condition.
- **Data residency**: ap-south-1 carried (CF-RES-1); no out-of-region read introduced.

## Money-integrity review
- All money is BIGINT minor units end-to-end (proto-types `_mu: bigint`, superjson wire, formatMoney
  at the edge). No float in any new path. The `cm1_mu` correction makes the displayed CM ladder MORE
  honest (it had been overstating CM1 by the variable-cost line on the TS-derived surface).

## Findings
- **CRITICAL:** none.
- **HIGH:** none.
- **MED:** none.
- **LOW (note, non-blocking):** the dashboard KPI cm2/cm3 seed values are now *derived* to match the
  honest ladder rather than hand-set — a strict improvement (cross-surface consistency); the router
  test asserts dashboard-cm2 == statement-cm2.

## Verdict
**PASS.** Tenancy is fail-closed and proven on every new path; no PII expansion; FX poison excluded;
per-SKU GST preserved; no compliance trigger. Advances to Stage 5 (Tanvi).
