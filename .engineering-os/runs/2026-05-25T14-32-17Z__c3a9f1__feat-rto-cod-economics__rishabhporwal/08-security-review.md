# Security Review — feat-rto-cod-economics (Stage 4, Shreya) — VETO authority

| Field | Value |
|-------|-------|
| **req_id** | `feat-rto-cod-economics` |
| **Stage** | 4 (security / multi-tenancy / PII / compliance) |
| **Verdict** | **PASS** (no CRITICAL/HIGH; no VETO) |

## 1. Multi-tenancy — 4 layers verified on every NEW query

The slice adds 4 analytics read paths + 4 tRPC procedures. Each layer confirmed:

| Layer | Mechanism | Evidence |
|---|---|---|
| (1) Router role gate | `requireRole('ANALYST')` before any data-plane call on all 4 procedures | `router.logistics.test.ts` — VIEWER rejected with `/ANALYST/` on rto/codPrepaid/summary/pincode |
| (2) Workspace claim binding | `ctx.workspaceId` sourced from the JWT claim; `workspaceProc` asserts request-ws==claim-ws | inherited slice-1/2 middleware; unchanged |
| (3) Use-case fail-closed re-assert | each use-case raises `UnscopedQueryError` on a falsy `workspace_id` BEFORE any read | `test_*_query.py` — empty + whitespace workspace_id → UnscopedQueryError (4 use-cases) |
| (4) Gateway scoped read | every use-case reads only via `query_metrics(workspace_id, ...)` (bound param; no interpolation) | grep: no use-case opens a second DB path; all call `query_metrics` |

**Cross-workspace isolation:** proven at BOTH levels — unit (ws_A query against a ws_B-seeded client
returns ws_A scope, never ws_B facts) AND wire (foreign `x-workspace-id` against a SUGANDH_LOK-only stub
→ UnscopedQueryError, no leak; `router.logistics.test.ts` "cross-workspace request fails closed").
The shipment-level operational facts arrive as EXPLICIT workspace-scoped use-case inputs (the slice-1/2
honest-input pattern) — they are never read un-scoped.

## 2. PII

- No new PII surfaced. Pincode/city/state are destination geography, not personal identifiers. The
  legacy module used `customer_phone` to compute repeat-customer counts; Brain accepts only the
  AGGREGATE `unique_customers` / `repeat_customers` integers as facts — NO phone numbers, NO customer
  identifiers cross the use-case boundary or the wire. This is a privacy IMPROVEMENT over legacy.
- request_id is surfaced sr-only (CF-SEC-5) for traceability — no PII.

## 3. Compliance (India canon)

- **No outbound channel.** Read-only analytics; no call/WhatsApp/SMS/email send. DLT/NCPR/DND/
  9am–9pm-window NOT triggered. Confirmed: no slice-3 surface initiates a channel send.
- **Per-SKU GST preserved.** `total_tax_mu` unchanged; not blended; `_ROW_TOTAL_TAX` child_dependency intact.
- **No FX poison.** These legacy modules don't use EXCHANGE_RATES; none introduced.
- **Money minor-units.** All RTO/COD/logistics money is BIGINT paise; no float on the money path.
- **DPDP / data residency.** ap-south-1 carried; no PII export; read-only.
- **No Decision-Log write / recommendation / action** this slice — pure analytics read.

## 4. Connector-sourced money is correctly HELD

`rto_cost_mu` / `rto_revenue_lost_mu` are connector-sourced (Shiprocket raw_json). Their DDR row
(`_ROW_RTO_COST_VALUE`) carries `child_dependency: child-3-shopify-connector` and is correctly
UNSIGNABLE until that gate is GREEN (Rule 2). The harness seeds them for the page demo, but the
governance correctly blocks sign-off — no wrong-but-signed money value can ship.

## Verdict

**PASS.** Fail-closed tenancy proven on all 4 new queries (unit + wire); no PII regression (in fact an
improvement); no outbound-channel/compliance trigger; per-SKU GST + minor-units preserved; connector
money correctly held. No CRITICAL/HIGH finding. No VETO.
