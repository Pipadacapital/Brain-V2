# Security Review — feat-marketing-acquisition (Stage 4, Shreya)

@paradigm: sql · slice 4. VETO authority on tenancy/PII/compliance.

## 4-layer multi-tenancy isolation

| Layer | Evidence |
|---|---|
| **Use-case** | Every marketing use-case re-asserts `workspace_id` (fail-closed `UnscopedQueryError` on falsy/whitespace) before any read; `query_metrics(workspace_id, ...)` is the only read path. Tests: `test_*_falsy_workspace_id_fails_closed`, `test_cross_workspace_isolation`. |
| **Gateway query gateway** | All reads go through `query_metrics`; no second DB path; no un-scoped query. |
| **tRPC BFF** | `marketing.*` = `workspaceProc` + `requireRole(ANALYST)`; `ctx.workspaceId === claim.workspaceId` asserted by `workspaceMiddleware`. VIEWER rejected (3 tests). |
| **Wire (proven)** | Live smoke: foreign `x-workspace-id` → `UnscopedQueryError … not authorized` (fail-closed). |

**Findings: 0 CRITICAL · 0 HIGH.**

## PII / compliance

- No PII in the marketing surface (aggregates only — no customer names/emails/phones). New-customer counts/revenue are aggregates.
- No outbound channel (call/WhatsApp/SMS/email/ad-audience) → DLT/NCPR/9am-9pm/WhatsApp policy NOT triggered. Campaign-classification consumed read-only.
- No recording-consent surface. ap-south-1 residency carried.
- No Decision-Log write (read-only analytics; no recommendation/action this slice).

## Money / GST honesty (security-adjacent correctness)

- All money BIGINT minor units; no float in money paths; no FX poison introduced (legacy modules don't use static EXCHANGE_RATES; confirmed none added).
- `new_customer_revenue_mu` uses per-order tax (per-SKU GST upstream) — no blended-tax shortcut; DDR row forbids it.
- aMER denominator = acquisition-classified spend only (the legacy-faithful, conservative semantics).

## Verdict: **PASS** (0 CRITICAL, 0 HIGH) → Tanvi Stage 5.
