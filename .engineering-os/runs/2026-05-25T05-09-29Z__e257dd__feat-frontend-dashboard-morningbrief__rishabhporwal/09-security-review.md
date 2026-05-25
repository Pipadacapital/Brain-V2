# 09 — Security Review (Stage 4) — Child 6 (frontend: gateway BFF + web dashboard + mobile Morning Brief)

**Reviewer:** Shreya (security-reviewer)
**Mode:** PARALLEL (∥ Tanvi). Verdict returned to orchestrator; I do NOT advance.
**req_id:** feat-frontend-dashboard-morningbrief (Child 6 of legacy→Brain strangler epic)
**Feature class:** high-stakes (auth, multi-tenancy, money-display, schema-proto/tRPC, PII, india-compliance + mobile MASVS)
**Verdict:** **BOUNCE** → frontend-web-developer (Ananya), backstopped by backend-developer (Vikram) for the gateway errorFormatter fix.

---

## Change-class scope (declared FIRST)

Surface-bearing change touching: auth/session, 4-layer tenancy (the gateway choke point), money transport+display (bigint/superjson), proto/tRPC contract seam, mobile MASVS L1 controls, PII rendering. ALWAYS-ON checks run (vuln scan / secrets grep / supply-chain / input-validation / money minor-units-no-float). India telecom-compliance section is **N/A — out of scope (no outbound channel)**: Child 6 ships zero SMS/voice/WhatsApp/email send path (`registerPushToken` is registration-only; push SEND is explicitly out of scope and absent from the codebase). DPDP/PII-rendering + residency-design ARE in scope and reviewed.

---

## Verdict summary

| Gate | Result |
|---|---|
| Zero CRITICAL | PASS (0) |
| Zero HIGH | **FAIL (1)** — SEC-C6-H1 (CF-SEC-5 error-path traceability) |
| Compliance (DPDP/telecom/recording) | PASS (telecom N/A; DPDP OK) |
| Traceability (CF-SEC-5) end-to-end | **FAIL** — error-path request_id surface is wrong across entire web client |
| Every mutation endpoint guarded | PASS |
| Every connector OAuth/webhook-signed | N/A (no connector in Child 6) |
| PII not in logs (sampled) | PASS |
| Vuln scans CLEAN on CRITICAL/HIGH | PASS (no real secret; no banned layer) |

**One HIGH traceability finding blocks G4.** Everything else (the 3 integrity gates, tenancy choke point, money fidelity, mobile MASVS, render-only, graduation label, idempotency) is verified REAL and PASS.

---

## The 3 integrity gates — verify-the-verifier (re-ran, not trusted from report)

Ran `vitest run` in `apps/api-gateway` myself: **22/22 GREEN**. Ran `lib-metrics/src/format-money.test.ts`: **24/24 GREEN**.

### G-BIGINT (CF-C6-BIGINT-JSON-1) — REAL, killed-mutant valid
- Real path: `gates.test.ts` transmits `9_007_199_254_740_993n` (2^53+1) through `createCaller(...).metrics.kpiSummary` and asserts `typeof === 'bigint'` + byte-identity + `> MAX_SAFE_INTEGER`. Not a synthetic assertion — the value travels the actual router → StubDataPlane → response path.
- Killed mutant: `Number(2^53+1)` round-trip loses exactly `1n` paise; test asserts `precisionLoss === 1n`. Non-vacuous.
- Serializer: `initTRPC.create({ transformer: superjson })` (trpc.ts:42); web + mobile clients both register superjson on `httpBatchLink`. `_mu` typed `bigint` end-to-end. No `Number()` coercion of `_mu` anywhere (confirmed by render-only grep on web + mobile). **PASS.**

### G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) — REAL, killed-mutant valid
- Real path: same `idempotency_key` twice via the router caller → `decisionLog.countByIdempotencyKey === 1`; 2nd call returns cached row with `idempotent_replay: true`. The router's `checkIdempotency` runs BEFORE `dataPlane.submitInsightResponse` (router.ts:271). Redis key is workspace-scoped (`ws:<ws>:idem:<key>`) — cross-tenant collision impossible (asserted).
- Killed mutant: bypassing dedup → 2 rows (RED). Valid.
- Client lifecycle (mobile): `idempotency-client.ts` generates the UUID at action-initiation, REUSES the unsettled key on retry/offline-replay, only mints a new key after a settled (non-error) response. Redux slice mirrors this and does NOT swap the key on retry. Append-only Decision-Log invariant holds. **PASS.**

### G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1 + RENDER-ONLY-1) — REAL, killed-mutant valid
- `assertKpiRegistryTraceability` throws on any field not in `_METRIC_COLUMNS`/`KPI_FIELDS_TO_DEFINITION_ID`; `assertWaterfallDefinitionId` throws on orphan `definition_id`. Both wired into the live `metrics.kpiSummary`/`pnlWaterfall` procedures (router.ts:132, 163-165) — not just unit-tested in isolation.
- Killed mutants: orphan `reduce` field + orphan waterfall `definition_id` both throw `/G-REGISTRY-ONLY VIOLATION/` (RED).
- Static render-only: zero `.reduce` on `_mu`, zero `Number(_mu)`, zero `_mu / literal` in `apps/web/src`, `apps/mobile/src`, `apps/api-gateway/src`. The only display math is `formatBp`/`formatX100` on `number`-typed `_bp`/`x100` (type-guarded, never on bigint) — legitimate display, not metric derivation. `formatMoney` is the single money formatter; zero local reimpls. **PASS.**

---

## Auth / tenancy — the choke point (PASS on enforcement; one structural note)

- **ws == claim assertion:** `workspaceMiddleware` (trpc.ts:81-103) rejects `workspaceId !== claim.workspaceId` with FORBIDDEN before any data-plane call. Proven by the `req ws ≠ claim ws → FORBIDDEN` negative control (re-ran GREEN).
- **requireRole on every mutation:** `submitResponse` → MANAGER; `registerPushToken` → VIEWER; all metrics → ANALYST; `morningBrief.get` → ANALYST. The `>=` boundary is proven by `MANAGER exactly meets threshold` + `VIEWER → FORBIDDEN on MANAGER-only` controls.
- **Data-plane fail-closed:** `StubDataPlane` throws `UnscopedQueryError` on `workspace_id !== this.workspaceId` for every method (mirrors the Python `query_metrics` fail-closed). `ws_A → 0 ws_B rows` control GREEN.
- **Push-token tenancy:** client does NOT send `workspace_id` (cannot be spoofed); server derives `workspace_id: ctx.workspaceId` from the asserted claim inside `workspaceProc`. No cross-tenant push risk. PASS.
- **Token handling:** mobile refresh token in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); access token in-memory module var only; never AsyncStorage. redux-persist whitelists only `brief`+`fetchedAt` (AI recs, no PII, no tokens, no idempotency keys). Bearer token sent in `authorization` header, never URL/logs. PASS.

**Structural note (MED, tracked — not blocking): `apps/api-gateway/src/domain/tenancy.ts` is a partly-vacuous "choke point" file.** Its header advertises "THE ONE auth/tenancy choke point — TenancyInterceptor", but `assertWorkspaceClaim`, `assertRequiredRole`, and `buildGrpcMetadata` are exported and **never called** in the live tRPC path — the real enforcement lives in `trpc.ts` (middleware) + inline `requireRole` in `router.ts`. Enforcement is therefore present and correct, but the named interceptor is dead code and the CF-SEC-5 claim "correlation 4-tuple propagated into gRPC metadata via `buildGrpcMetadata`" is currently **unverified** (the helper is never invoked; Phase-0 data plane is in-process so the metadata isn't needed yet). Acceptable for Phase-0, but the gRPC-metadata propagation MUST be wired when the real cross-task gRPC client (RemoteDataPlane) lands in Phase-2, or it becomes a real tenancy/traceability gap. Logged as tech-debt; revisit at Phase-2 cutover review.

---

## BLOCKING — SEC-C6-H1 (HIGH): CF-SEC-5 error-path request_id is the wrong value across the entire web client

`apps/api-gateway/src/application/trpc.ts:44-53`:
```ts
errorFormatter({ shape }) {
  return { ...shape, data: { ...shape.data, requestId: shape.data?.path ?? undefined } };
}
```
`shape.data.path` is the **tRPC procedure path** (e.g. `"metrics.kpiSummary"`), NOT the correlation `request_id`. The genuine `ctx.requestId` is available as an argument to `errorFormatter` (`{ shape, ctx }`) but is not used.

All three web error surfaces bind to this field and render it to operators as "Request ID":
- `apps/web/src/interfaces/components/kpi/kpi-strip.tsx:52`
- `apps/web/src/interfaces/components/waterfall/pnl-waterfall-panel.tsx:49`
- `apps/web/src/interfaces/components/drill/drill-drawer.tsx:115`
→ via `ErrorDisplay` rendering `Request ID: {requestId}`.

**Impact:** on every web read-path failure, the "Request ID" shown to an operator is the procedure name, not the correlation id. An operator copying it to trace a failure gets a useless value. The error-path correlation surface — the exact thing CF-SEC-5 mandates ("request IDs surface on error responses") — is non-functional across the whole web client. The success-path 4-tuple IS intact (every success body carries `request_id: ctx.requestId`; gRPC-metadata path is Phase-0-deferred per the MED note), and the request_id IS still embedded in the human-readable error `message` string — so this is a wrong/ineffective surface rather than a total absence. Per my mandate ("Missing traceability is a VETO, not a tech-debt note") and the conservative tie-break (any doubt → must-fix-now), a structured error-traceability surface that ships the wrong value on every web error is a **must-fix-now HIGH**.

**Fix (small):** in `errorFormatter`, read `ctx.requestId` (or attach the request_id via the thrown `TRPCError` cause / a custom `shape.data.requestId` set from `ctx`) so the client receives the real correlation id. Add a real-path test: induce a procedure error and assert `error.data.requestId === ctx.requestId` (and `!== path`) — a killed-mutant for this exact regression. Mobile already surfaces the request_id inside `err.message`, so mobile is unaffected; web is the blast radius.

---

## Render-only / faithfulness / graduation (PASS)

- UI computes no metric (web + mobile). `formatMoney` (BigInt FLOOR division, subunit-aware, no round) is the only money transform; `_bp`/`x100` display helpers are type-guarded to `number`.
- AI `rationale` is render-only, `accessibilityRole="text"`, explicitly separated from the button group and NOT placed to prime the Approve action (MorningBriefScreen.tsx:306-326). Not passed to any executor (no executor exists in Child 6).
- Graduation label: Day-1 server returns `LOGGED_AS_VOTE`; CTA reads "Log Approval", never "Approve & Execute"; `QUEUED_FOR_EXECUTION` copy only reachable when the server emits that status. No client-side graduation inference. No auto-execute path. PASS.
- `as_of`/`data_epoch` bound on every KPI card, waterfall, drill drawer, and brief header (staleness label). PASS.

## Mobile MASVS (PASS)

- Cert pinning: iOS `NSPinnedDomains` + Android `network-security-config.xml`, current + rotation pin slots, `cleartextTrafficPermitted=false` on the prod domain (localhost/10.0.2.2 cleartext dev-only). Real SPKI-SHA256 placeholders documented for Stage-8 Jatin + native-bump rotation runbook — acceptable Phase-0 posture.
- No auto-execute (graduation UX). Push = registration only; SEND absent from codebase. Deep-link routes push tap to `/morning-brief?date=` (no privileged action). PASS.

## Compliance (DPDP) + scans

- DPDP: PII rendered = none customer-level (brief is SKU/ad-set/aggregate metrics + AI text; no email/phone/customer rows). No PII in client logs — login form proven not to log email/password; mobile logs only `workspace_id` + request metadata. Residency: in-region by default; Child 6 adds no cross-border path (no live region, no live Supabase/ClickHouse — Phase-0 stub). PASS.
- Secrets grep on staged Child-6 diff (api-gateway/web/mobile/lib-metrics/protos): **clean**. Only "password" hits = the documented Phase-0 LOCAL stub credential `brain-local-dev` (clearly labeled, not a production secret). Tech-debt: remove the stub credential + on-screen display before production auth cutover (LOW; Phase-0 acceptable).
- Banned layers: zero axios (comments only), zero Zustand, zero `dangerouslySetInnerHTML` (no XSS surface in rendered commerce text). Zero legacy edits / legacy imports. PASS.

---

## Findings ledger

| ID | Sev | Timing | Status | Location |
|---|---|---|---|---|
| SEC-C6-H1 | HIGH | must-fix-now | **BLOCKING** | trpc.ts:50 errorFormatter (+ 3 web ErrorDisplay consumers) |
| SEC-C6-M1 | MED | defer (Phase-2) | tech-debt | tenancy.ts — dead TenancyInterceptor + `buildGrpcMetadata` never wired; gRPC-metadata 4-tuple unverified until RemoteDataPlane |
| SEC-C6-L1 | LOW | defer (pre-prod) | tech-debt | login-form.tsx stub credential `brain-local-dev` + on-screen display; remove at auth cutover |

CRITICAL: 0 · HIGH: 1 · MED: 1 · LOW: 1.

---

## Gate (G4) decision

**BOUNCE.** One HIGH traceability finding (SEC-C6-H1) fails the "zero HIGH" and "zero missing-traceability" conditions. Bounce target: **frontend-web-developer (Ananya)** to fix the surface, with **backend-developer (Vikram)** to correct the gateway `errorFormatter` (the root cause is the BFF emitting the wrong field). Re-review scope on return: SEC-C6-H1 only (errorFormatter uses real `ctx.requestId` + a killed-mutant test asserting `error.data.requestId === ctx.requestId !== path`). MED/LOW logged as tech-debt, non-blocking.

Returned to orchestrator for reconciliation with Tanvi (parallel mode). I do not advance the pipeline.
