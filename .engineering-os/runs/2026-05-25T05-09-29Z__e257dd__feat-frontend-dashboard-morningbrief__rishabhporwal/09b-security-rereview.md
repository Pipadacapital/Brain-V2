# 09b — Security RE-REVIEW (Stage 4, Round 2) — Child 6 (gateway BFF + web dashboard + mobile Morning Brief)

**Reviewer:** Shreya (security-reviewer)
**Mode:** PARALLEL (∥ Tanvi). Verdict returned to orchestrator; I do NOT advance. Rohan reconciles with Tanvi.
**req_id:** feat-frontend-dashboard-morningbrief (Child 6 of legacy→Brain strangler epic)
**Round:** 2 (re-review of the SEC-C6-H1 bounce + the new server.ts from Tanvi's B1 VETO)
**Verdict:** **PASS** — SEC-C6-H1 RESOLVED; new server.ts introduces no tenancy/secret/spoof hole; 3 integrity gates + tenancy + money-fidelity + mobile MASVS did not regress.

---

## Re-review scope (declared FIRST)

Round-1 BOUNCE was a single HIGH: **SEC-C6-H1** (errorFormatter emitted `shape.data.path` — the procedure name — instead of `ctx.requestId`, breaking CF-SEC-5 error-path traceability across the whole web client). Everything else PASSED round-1 (0 CRITICAL, 3 integrity gates REAL, tenancy choke point enforced, money fidelity, mobile MASVS, DPDP). 

This round verifies:
1. **SEC-C6-H1 RESOLVED** — errorFormatter now reads `ctx.requestId`; killed-mutant present; web renders the correlation id.
2. **NEW: `apps/api-gateway/src/interfaces/server.ts`** (created by Vikram to fix Tanvi's B1 RUNNABLE-HARNESS VETO) — first-time security review of this file: no tenancy bypass, no secret in logs, no token/workspace spoof beyond the accepted Phase-0 header-trust posture, local-stub fallback dev-only.
3. **Regression** — 3 integrity gates (G-BIGINT / G-IDEMPOTENT / G-REGISTRY-ONLY) + tenancy + money fidelity + mobile MASVS unchanged; secrets/banned-layers/legacy clean.
4. **Dispositions** — M1 (dead TenancyInterceptor) honest; L1 (stub cred) closed.

India telecom-compliance section remains **N/A — out of scope (no outbound channel)**: re-confirmed by grep — zero SMS/voice/WhatsApp/email send path; push is REGISTRATION-only (the one "send" hit is a Phase-2 OTLP telemetry comment). DPDP/PII-rendering + residency design IN scope and re-verified clean.

---

## Verdict summary

| Gate | Round 1 | Round 2 |
|---|---|---|
| Zero CRITICAL | PASS (0) | PASS (0) |
| Zero HIGH | **FAIL (1)** SEC-C6-H1 | **PASS (0)** — H1 resolved |
| Compliance (DPDP/telecom/recording) | PASS | PASS (telecom N/A re-confirmed) |
| Traceability (CF-SEC-5) end-to-end | **FAIL** (error path) | **PASS** — error path now carries `ctx.requestId` |
| Every mutation endpoint guarded | PASS | PASS (unchanged) |
| Every connector OAuth/webhook-signed | N/A | N/A (no connector in Child 6) |
| PII not in logs (sampled) | PASS | PASS (re-sampled web + mobile + new server.ts) |
| Vuln scans / secrets / banned layers CLEAN | PASS | PASS |

**0 CRITICAL · 0 HIGH · 1 MED (deferred, honest) · 0 open LOW (L1 closed).** G4 PASS conditions met.

---

## SEC-C6-H1 (HIGH) — RESOLVED. Evidence.

**Root-cause fix (gateway), `apps/api-gateway/src/application/trpc.ts:48-58`:**
```ts
errorFormatter({ shape, ctx }) {
  return { ...shape, data: { ...shape.data, requestId: ctx?.requestId ?? undefined } };
}
```
- `ctx.requestId` is the correlation UUID generated per-request in the context factory (`server.ts:160` — `x-request-id` header or `randomUUID()`), carried on every `WorkspaceContext`, emitted on every success body as `request_id`, and now on every error response as `requestId`. The procedure path (`shape.data.path`) is gone from the error surface. `?? undefined` keeps public/unauthed procedures safe (no throw on absent ctx). **CF-SEC-5 error path satisfied.**

**Web surface (consumer side), confirmed correct binding on all 3 surfaces:**
- `kpi-strip.tsx:52`, `pnl-waterfall-panel.tsx:49`, `drill-drawer.tsx:115` all read `(error as { data?: { requestId?: string } }).data?.requestId` → `ErrorDisplay` renders `Request ID: {requestId}` with `aria-label`. The web client is a faithful pass-through; once the gateway emits the real UUID (it now does), the operator sees the traceable id.

**Killed-mutant evidence (re-ran, not trusted from report):**
- `apps/api-gateway/src/application/trpc.errorformatter.test.ts` — 6/6 GREEN. The mutant assertion proves REAL (`ctx.requestId`) and MUTANT (`shape.data.path`) diverge on the same procedure path (`realId !== mutantId`; mutant matches `/\./` and not `/^req-/`).
- `apps/web/src/test/error-display-request-id.test.tsx` — 7/7 GREEN. MUTANT A renders the procedure-path (proves the wrong value is traceable to the gateway), REAL PATH renders the UUID and asserts `/metrics\./` is NOT present.

**Honest limitation (noted, non-blocking):** the killed-mutant tests assert against a *replica* of the formatter (`buildFormatterOutput`) and the `t._config` pattern, not a live HTTP round-trip through the real `errorFormatter`, because tRPC v11 `createCaller` re-throws without running `errorFormatter`. This is a known tRPC-v11 test-harness limitation, not a coverage gap that hides a bug: (a) the production fix is a verified one-line change in the live `t` instance (read directly, `trpc.ts:48-58`); (b) test #4 drives a real FORBIDDEN through `createBrainRouter().createCaller` and asserts the error message carries `request_id=` (the message-string surface is the live path); (c) the new `server.test.ts` exercises the real Fastify+tRPC HTTP path via `inject()` and the success body carries the real `request_id`. The error-path HTTP-level assertion through `errorFormatter` is a test-improvement opportunity (could be added when a real HTTP error fixture is wired), logged as a LOW test-debt note — it does NOT change the resolution: the production code is correct and verified by direct read. **SEC-C6-H1 RESOLVED.**

---

## NEW FILE — `apps/api-gateway/src/interfaces/server.ts` — first-time security review

This file did not exist in round 1 (Tanvi's B1 VETO: `package.json dev` pointed at a missing entrypoint). It is now the Phase-0 LOCAL boot harness. Reviewed for tenancy/secret/spoof.

### Tenancy — no bypass; the real choke point is unchanged and load-bearing
- The context factory (`server.ts:158-179`) derives `workspaceId` and `userId` from `x-workspace-id` / `x-user-id` headers (fallback to Sugandh-Lok stub). `buildLocalStubContext` (96-117) builds the `claim` from the **same** `workspaceId`, so `workspaceId === claim.workspaceId` by construction.
- The real enforcement — `workspaceMiddleware` in `trpc.ts:86-108` (asserts `ctx.workspaceId === ctx.claim.workspaceId` with FORBIDDEN before any data-plane call) + inline `requireRole` per procedure in `router.ts` — is **untouched** by this bounce-fix. Re-ran the negative control in `gates.test.ts` ("workspace_id mismatch → FORBIDDEN", "VIEWER → submitResponse FORBIDDEN", "ws_A → 0 ws_B rows"): GREEN.
- **Header-trust posture is acceptable Phase-0, NOT a shippable bypass.** The whole of Child 6 ships behind **`CF-C6-HOLD-AT-ROUTE-FLIP`** (architecture-plan §Scope, lines 13/42/148/236/260/354): LOCAL-only, single Sugandh-Lok workspace, deterministic seed, **zero production traffic, zero live operator surface flipped**. The production design (JWT verify + membership lookup → `claim.workspaceId` derived server-side, never from a client header) is documented as the cutover requirement in `server.ts:84-93`, `HARNESS.md:32`, and `brain-claim.ts:24-26`. Because nothing live ships and the HOLD is explicit + binding, the header-trust factory is in-scope-acceptable Phase-0 — not a tenancy VETO. **The production JWT-verification + membership-check wiring MUST land before any route flip; CF-C6-HOLD-AT-ROUTE-FLIP must remain HELD until then.** (Carried as the Phase-2 cutover gate, same disposition as round-1's MED note.)

### Secrets in logs — clean
- `server.ts` logger logs `{ requestId, traceId, workspaceId, userId, url }` per request (172-176) and `{ path, code, message, requestId }` on tRPC error (182-195) — correlation 4-tuple + metadata, **no token, no password, no PII**. `/health` returns only server status metadata. No secret printed at boot (the `brain-local-dev` string is NOT in server.ts — only a `display only` email comment at line 57). Secrets grep across `apps/api-gateway/src` clean.

### Token / workspace spoof — within accepted Phase-0 envelope
- No JWT in Phase-0, so there is no token to spoof; the header-trust is the documented Phase-0 fallback (above). Push token: mobile `registerPushToken` sends `{ user_id, device_id, expo_push_token }` and **does NOT send `workspace_id`** — the server derives it from the asserted claim. No client-controlled cross-tenant push. (Re-verified `push-notifications.ts:99-103` — no `workspace_id` in the mutate payload.)

### Local-stub fallback — dev-only
- The stub claim builder + `LOCAL_DEV_*` constants are clearly labeled Phase-0 LOCAL, gated by the absence of real auth (replaced wholesale at cutover). No production reachability. Acceptable.

**server.test.ts note (test-quality, NOT security-blocking — flag to Tanvi):** the test named `"TENANCY: workspace mismatch in context → FORBIDDEN from workspaceMiddleware"` (server.test.ts:147-175) is **misnamed** — its body sends a *consistent* `x-workspace-id` and asserts `200` (success), and its own comment admits it does not actually exercise a mismatch (because the Phase-0 factory derives both sides from one header, they can't diverge). It is not a false PASS of a security control (the genuine mismatch negative control lives in `gates.test.ts` and is GREEN), but the name overclaims a negative control it never runs. This is a QA/test-clarity finding in Tanvi's lane; I surface it for reconciliation. Not a SEC bounce.

---

## Regression — 3 integrity gates + tenancy + money + MASVS (verify-the-verifier, re-ran)

Re-ran `pnpm --filter @brain/api-gateway run test`: **32/32 GREEN** (22 integrity-gate tests UNCHANGED + 6 H1 + 4 server-boot). TSC `--noEmit` exit 0. Web `vitest run`: **42/42 GREEN**.

- **G-BIGINT** — `gates.test.ts` 2^53+1 paise byte-identical through router→StubDataPlane; mutant `Number()` loses exactly 1n. superjson registration at `trpc.ts:42` untouched. PASS, no regression.
- **G-IDEMPOTENT** — same idempotency_key twice → 1 decision-log row; workspace-scoped Redis key; mutant double-write RED. Untouched. PASS.
- **G-REGISTRY-ONLY** — orphan field / orphan waterfall definition_id throw; static no-arithmetic-on-`_mu` grep clean across web/mobile/gateway src. PASS.
- **Tenancy** — `workspaceMiddleware` ws==claim FORBIDDEN, role `>=` boundary, ws_A→0 ws_B rows: GREEN. PASS.
- **Money fidelity** — `formatMoney` (BigInt FLOOR, subunit-aware, no float) the single money transform; M3 Visx `Number(_mu)` is SVG-pixel-only (documented `< 2^53` invariant, display always uses bigint). No `Number(_mu)` in any display path. PASS.
- **Mobile MASVS L1** — access token in-memory only; refresh token `SecureStore` `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; no AsyncStorage tokens; cert pinning config present; no auto-execute; push = registration only. Unchanged. PASS.

---

## Compliance (DPDP) + scans (re-run)

- **DPDP:** no customer-level PII rendered (brief is SKU/ad-set/aggregate + AI text). PII-in-logs re-sampled: web login form does not log email/password; mobile logs only `workspace_id`/latency/error-`.message`; new `server.ts` logs only the correlation 4-tuple + url. Residency: no live region, no cross-border path (Phase-0 stub). PASS.
- **Telecom (DLT/NCPR/9-9/WhatsApp):** N/A — re-confirmed zero outbound send path. PASS.
- **Secrets grep** (api-gateway/web/mobile src): clean. Only "password" hits = the gated Phase-0 stub credential + normal form plumbing + e2e test usage. No real secret.
- **Banned layers:** zero axios, zero Zustand, zero `dangerouslySetInnerHTML`, zero legacy edits/imports. Clean.

---

## Dispositions

- **SEC-C6-M1 (MED, dead TenancyInterceptor / `buildGrpcMetadata` never wired) — HONEST, deferred.** `server.ts:18-31` + `HARNESS.md §M2` document why: `assertWorkspaceClaim`/`assertRequiredRole` would duplicate `workspaceMiddleware` (the real gate); `buildGrpcMetadata` is the Phase-2 wire (no gRPC network boundary in Phase-0). Enforcement IS present and correct in `trpc.ts`. The disposition matches the actual code state — honest. **MUST be wired into the RemoteDataPlane/gRPC adapter at Phase-2 cutover or it becomes a real traceability/tenancy gap.** Carried to Phase-2 review.
- **SEC-C6-L1 (LOW, stub credential on-screen) — CLOSED.** `login-form.tsx:19,49,130` gates both the stub-auth branch and the on-screen hint behind `IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true'`. Invisible + unreachable in production builds. Resolved.

---

## Findings ledger (round 2)

| ID | Sev | Timing | Status | Location |
|---|---|---|---|---|
| SEC-C6-H1 | HIGH | must-fix-now | **RESOLVED** | trpc.ts:48-58 errorFormatter `ctx.requestId` + 6+7 killed-mutant tests + 3 web surfaces |
| SEC-C6-M1 | MED | defer (Phase-2) | tech-debt (honest) | tenancy.ts dead TenancyInterceptor / buildGrpcMetadata — wire at RemoteDataPlane |
| SEC-C6-L1 | LOW | — | **CLOSED** | login-form.tsx stub cred gated behind NEXT_PUBLIC_BRAIN_LOCAL_HARNESS |
| SEC-C6-L2 (new) | LOW | defer | test-debt | error-path traceability has no live-HTTP-through-errorFormatter assertion (tRPC v11 createCaller limitation); add when an HTTP error fixture is wired |
| (→ Tanvi) | — | — | flag-for-reconcile | server.test.ts:147 "workspace mismatch → FORBIDDEN" test is misnamed (asserts 200, no real mismatch); QA/test-clarity lane |

CRITICAL: 0 · HIGH: 0 · MED: 1 (deferred) · LOW: 2 (1 closed, 1 new test-debt deferred).

---

## Gate (G4) decision

**PASS.** Zero CRITICAL, zero HIGH (SEC-C6-H1 resolved), zero compliance violations (telecom N/A re-confirmed; DPDP clean), zero missing-traceability (CF-SEC-5 error path now carries `ctx.requestId` end-to-end), every mutation guarded, PII not in logs, scans clean on CRITICAL/HIGH. The new `server.ts` introduces no tenancy bypass, no secret leak, no spoofable workspace/token beyond the explicitly-HELD Phase-0 header-trust posture (production JWT path documented, CF-C6-HOLD-AT-ROUTE-FLIP must remain HELD). The 3 integrity gates + tenancy + money fidelity + mobile MASVS did not regress.

MED (M1) carried to Phase-2 cutover review; LOW (L2 test-debt) deferred; L1 closed. One test-clarity item routed to Tanvi for reconciliation (not a SEC bounce).

**PARALLEL MODE: verdict returned to Rohan (orchestrator). I do NOT advance. Rohan reconciles with Tanvi.**
