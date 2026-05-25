# 10 — QA Review (Stage 5) — Child 6 (feat-frontend-dashboard-morningbrief)

**Reviewer:** Tanvi (qa-agent)
**Mode:** PARALLEL (∥ Shreya). Verdict returned to orchestrator; I do NOT advance.
**req_id:** feat-frontend-dashboard-morningbrief (Child 6 of legacy→Brain strangler epic)
**Feature class:** high-stakes (auth, multi-tenancy, money-display, BigInt/superjson, proto/tRPC, MASVS L1, India money-fidelity)
**Verdict:** **BOUNCE** → frontend-web-developer (Ananya) [PRIMARY]; backend-developer (Vikram) [SECONDARY — server bootstrap]

---

## Stage 4 skip acknowledgment

Security was NOT skipped — Shreya ran her own parallel pass (09-security-review.md — BOUNCE). Running the mandatory minimal secrets grep on the staged diff:

```
Command: git diff --cached -- '*.ts' '*.tsx' '*.py' '*.proto' | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
```

Result (output preview): Hits found are:
- `CLICKHOUSE_PASSWORD` / `password=os.environ.get("CLICKHOUSE_PASSWORD", "")` — from previously-committed Child-3 CredentialCustody infrastructure. Environment variable reference, not a plaintext credential.
- `API_KEY = "api_key"` — string enum constant in CredentialCustody, not a secret value.
- `EMAIL_PASSWORD = "email_password"` — string enum key name, not a secret value.
- `aws_` hit in `aws_secrets_manager_custody.py` — service name reference, not a credential.

**Assessment: CLEAN. No plaintext secrets in the staged diff. Child-6-specific files contain no credential hits.**

---

## Test runs — real command output

### api-gateway (22 tests, 3 runs for stability)

**Run 1 (10:31:50):**
```
 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/api-gateway
 ✓ src/domain/gates.test.ts > G-BIGINT (CF-C6-BIGINT-JSON-1) > REAL-PATH: bigint 9e18 paise passes through the tRPC response byte-identical 2ms
 ✓ src/domain/gates.test.ts > G-BIGINT (CF-C6-BIGINT-JSON-1) > KILLED MUTANT: bare Number() loses precision on 2^53+1 (proves superjson is required) 0ms
 ✓ src/domain/gates.test.ts > G-BIGINT (CF-C6-BIGINT-JSON-1) > superjson round-trip preserves bigint type and value 0ms
 ✓ src/domain/gates.test.ts > G-BIGINT (CF-C6-BIGINT-JSON-1) > NEGATIVE: 2^53+1 as a bare JSON number fails byte-identity (the mutant scenario) 0ms
 ✓ src/domain/gates.test.ts > G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) > REAL-PATH: same idempotency_key twice → exactly ONE decision_log row 1ms
 ✓ src/domain/gates.test.ts > G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) > KILLED MUTANT: without Redis dedup, double-submit writes TWO rows (RED) 0ms
 ✓ src/domain/gates.test.ts > G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) > different idempotency_keys each write their own row 0ms
 ✓ src/domain/gates.test.ts > G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) > Redis dedup key is workspace-scoped (cross-workspace key collision impossible) 0ms
 ✓ src/domain/gates.test.ts > G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1) > graduated label is LOGGED_AS_VOTE on Day-1 (CF-C6-MB-GRADUATED-LABEL-1) 0ms
 ✓ src/domain/gates.test.ts > G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1) > REAL-PATH: every KPI summary field traces to a registry definition_id 1ms
 ✓ src/domain/gates.test.ts > G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1) > REAL-PATH: every P&L waterfall step has a registry definition_id 0ms
 ✓ src/domain/gates.test.ts > G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1) > KILLED MUTANT: orphan reduce field in KpiSummaryRow → traceability assertion RED 0ms
 ✓ src/domain/gates.test.ts > G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1) > KILLED MUTANT: orphan waterfall step definition_id → assertion RED 0ms
 ✓ src/domain/gates.test.ts > G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1) > static: no arithmetic operators in api-gateway router.ts outside formatMoney 1ms
 ✓ src/domain/gates.test.ts > Tenancy isolation (CF-C6-GATEWAY-TENANCY-1) > ws_A request → 0 ws_B rows (data plane scoped to ws_A only) 2ms
 ✓ src/domain/gates.test.ts > Tenancy isolation (CF-C6-GATEWAY-TENANCY-1) > workspace_id mismatch (request ws ≠ claim ws) → FORBIDDEN 0ms
 ✓ src/domain/gates.test.ts > Tenancy isolation (CF-C6-GATEWAY-TENANCY-1) > role-insufficient (VIEWER tries submitResponse MANAGER-only) → FORBIDDEN 0ms
 ✓ src/domain/gates.test.ts > Tenancy isolation (CF-C6-GATEWAY-TENANCY-1) > requireRole >= boundary: MANAGER exactly meets threshold 0ms
 ✓ src/domain/gates.test.ts > as_of / data_epoch (CF-C6-AS-OF-STAMP-1) > kpiSummary response carries data_epoch 0ms
 ✓ src/domain/gates.test.ts > as_of / data_epoch (CF-C6-AS-OF-STAMP-1) > morningBrief.get carries data_epoch on each insight item 0ms
 ✓ src/domain/gates.test.ts > InsightItem contract (CF-C6-MB-CONTRACT-COMPLETENESS-1) > InsightItem carries expected_impact{revenue_mu, cm2_mu, impact_label} 0ms
 ✓ src/domain/gates.test.ts > InsightItem contract (CF-C6-MB-CONTRACT-COMPLETENESS-1) > 3 items max (≤3 actions per Morning Brief) 0ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  10:31:50
   Duration  137ms
```

**Run 2 (10:33:15): 22/22 PASS. Run 3 (10:33:28): 22/22 PASS. STABLE.**

---

### lib-metrics (126 tests, 3 runs)

**Run 1 (10:31:53):**
```
 Test Files  3 passed (3)
      Tests  126 passed (126)
   Start at  10:31:53
   Duration  110ms
```
Key results (abbreviated):
```
 ✓ src/format-money.test.ts > formatMoney — INR lakh/crore (CF-C6-FORMATMONEY-CANONICAL-1) > ₹18.5L = 185_000_000 paise → "₹18.50 L" 0ms
 ✓ src/format-money.test.ts > formatMoney — KWD (3-decimal, subunitMultiplier=1000) > KILLED MUTANT: /100-hardcode (replacing subunitMultiplier with 100) gives WRONG result for KWD 0ms
 ✓ src/format-money.test.ts > formatMoney — BigInt above MAX_SAFE_INTEGER > 9_000_000_000_000_000_000n paise (9e18) — handles without precision loss 0ms
```
**Run 2 (10:33:23): 126/126 PASS. Run 3 (10:33:29): 126/126 PASS. STABLE.**

---

### web (35 tests, 1 stable run — vitest passes; TSC FAIL noted separately)

```
 RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/web
 ✓ src/test/redux-store.test.ts > Redux store — slice isolation (CF-C6-NEW-LAYER-1) > store has exactly ui + session keys — no extra slices 1ms
 ✓ src/test/kpi-card.test.tsx > KpiCard > renders INR lakh value via formatMoney — ₹18.50 L 22ms
 ✓ src/test/kpi-card.test.tsx > KpiCard > renders ROAS via scale=100 display (value/100) as "2.85×" 1ms
 ✓ src/test/kpi-card.test.tsx > KpiCard — bigint coercion negative test (CF-C6-BIGINT-JSON-1) > correctly formats a value > Number.MAX_SAFE_INTEGER — proves bigint path 1ms
 ✓ src/test/kpi-card.test.tsx > KpiCard — bigint coercion negative test (CF-C6-BIGINT-JSON-1) > formatMoney is the ONLY money formatter — no Number() on _mu bigint 0ms
 ✓ src/test/login-form.test.tsx > LoginForm — PII client log negative test (CF-C6-PII-CLIENT-1) > does not console.log email or password on submit 78ms
 [console.error] Error: Not implemented: navigation (except hash changes) [jsdom expected noise — not a test failure]
 Test Files  5 passed (5)
      Tests  35 passed (35)
   Start at  10:31:59
   Duration  1.14s
```

**TSC (web) FAIL:**
```
Command: cd apps/web && npx tsc --noEmit
Output:
src/interfaces/components/kpi/kpi-strip.tsx(125,99): error TS1005: '...' expected.
Exit code: 2
```
Root cause: Line 123-126 of `kpi-strip.tsx` places a JSX block comment `{/* ... */}` in the JSX attribute list (between two props), which is invalid TSX syntax — block comments are only valid between elements, not as attribute values. The comment spans lines 123-126 before the `valueMu` prop. This is a syntax error that prevents the Next.js app from compiling.

**TSC (api-gateway) PASS:**
```
Command: pnpm --filter @brain/api-gateway exec tsc --noEmit
Output: (empty — exit 0)
```

---

### mobile (52 tests, 3 runs)

**Run 1 (10:31:xx):**
```
PASS __tests__/offline-posture.test.ts
  ● Console
    [morning_brief.render_success_latency_ms] {"workspace_id":"workspace-1","latency_ms":0,"date":"2026-05-25","online":true}
    [morning_brief.render_success_latency_ms] {"workspace_id":"workspace-1","latency_ms":0,"date":"2026-05-25","online":false}
PASS __tests__/render-only.test.ts
PASS __tests__/morning-brief-slice.test.ts
PASS __tests__/graduation-ux.test.ts
PASS __tests__/idempotency-client.test.ts

Test Suites: 5 passed, 5 total
Tests:       52 passed, 52 total
Time:        1.285 s
```
**Run 2 (0.598s): 52/52 PASS. Run 3: 52/52 PASS. STABLE.**

---

### Python brain_metrics (291 tests)

```
Command: python3 -m pytest pylibs/brain_metrics/ -v --tb=short
Result: 291 passed in 0.10s
```

---

### Metric registry TS↔Python parity gate (scale field)

```
Command: bash tools/check-metrics-parity.sh
...
STRUCTURAL_FIELDS = ["id", "kind", "unit", "scale", "display_only", "parity_class"]  # CF-C6-ROAS-DISPLAY-CONTRACT-1: scale added
...
[parity-gate] PASS: TS↔Python byte-identity confirmed over all golden fixture vectors.
[parity-gate] CF-QA-1.HARD satisfied.
[parity-gate] Checking registry parity (per-metric content equality)...
  16 shared metric(s) verified: structural fields match.
[parity-gate] Killed-mutant sub-step: PASS (both mutants killed — gate is non-vacuous).
[parity-gate] PASS: all checks complete.
```

`scale` field confirmed in `STRUCTURAL_FIELDS`. The V7 Child-4 parity gate extension did not break anything — **exit 0**.

---

## Three integrity gates — per-gate mutation proof

### G-BIGINT (CF-C6-BIGINT-JSON-1)

**REAL-PATH test output (captured):**
```
✓ G-BIGINT > REAL-PATH: bigint 9e18 paise passes through the tRPC response byte-identical 2ms
```
Test value: `9_007_199_254_740_993n` (MAX_SAFE_INTEGER + 1). Asserts:
- `typeof result.summary.net_revenue_mu === 'bigint'` — PASS
- `result.summary.net_revenue_mu === 9_007_199_254_740_993n` — PASS
- `result.summary.net_revenue_mu > BigInt(Number.MAX_SAFE_INTEGER)` — PASS

**KILLED MUTANT output (captured):**
```
✓ G-BIGINT > KILLED MUTANT: bare Number() loses precision on 2^53+1 (proves superjson is required) 0ms
```
Proof: `Number(9_007_199_254_740_993n)` = `9007199254740992` (rounds to 2^53). `BigInt(asNumber) !== asBigint`. Precision loss = `1n` paise exactly. Gate is non-vacuous.

**Verdict: G-BIGINT PASSES. Mutant confirmed RED. Non-vacuous.**

---

### G-IDEMPOTENT (CF-C6-MB-IDEMPOTENCY-1)

**REAL-PATH test output (captured):**
```
✓ G-IDEMPOTENT > REAL-PATH: same idempotency_key twice → exactly ONE decision_log row 1ms
```
Verifies:
- First call: `first.decision_log_row_id` defined; `first.status === 'LOGGED_AS_VOTE'`; `first.idempotent_replay === false`
- Second call: `second.decision_log_row_id === first.decision_log_row_id`; `second.idempotent_replay === true`
- `decisionLog.countByIdempotencyKey(IDEMPOTENCY_KEY) === 1` — exactly ONE row

**KILLED MUTANT output (captured):**
```
✓ G-IDEMPOTENT > KILLED MUTANT: without Redis dedup, double-submit writes TWO rows (RED) 0ms
```
Mutant bypasses the idempotency check (calls `dp.submitInsightResponse` directly twice). `decisionLog.countByIdempotencyKey(IDEMPOTENCY_KEY) === 2` — proves dedup is required.

Note on client-side idempotency lifecycle (Karan's track): `idempotency-client.test.ts` — 14 tests, all PASS. Key: "double-tap reuses same key"; "unsettled initiateResponse keeps the existing key". The Redux slice persists the key until settled. Client does not regenerate on retry. Gate holds end-to-end.

**Verdict: G-IDEMPOTENT PASSES. Mutant confirmed RED. Non-vacuous.**

---

### G-REGISTRY-ONLY (CF-C6-REGISTRY-ONLY-BFF-1 + CF-C6-RENDER-ONLY-1)

**REAL-PATH test output (captured):**
```
✓ G-REGISTRY-ONLY > REAL-PATH: every KPI summary field traces to a registry definition_id 1ms
✓ G-REGISTRY-ONLY > REAL-PATH: every P&L waterfall step has a registry definition_id 0ms
```
Calls `assertKpiRegistryTraceability(result.summary)` — no throw. All 8 KPI fields map to `_METRIC_COLUMNS` or `KPI_FIELDS_TO_DEFINITION_ID`.

**KILLED MUTANT output (captured):**
```
✓ G-REGISTRY-ONLY > KILLED MUTANT: orphan reduce field in KpiSummaryRow → traceability assertion RED 0ms
```
Injects `orphan_monthly_cm2_reduce: 100_000_000` (simulates `rows.reduce((s,r)=>s+r.cm2_mu,0)`). `assertKpiRegistryTraceability()` throws `/G-REGISTRY-ONLY VIOLATION/`. Gate is non-vacuous.

**Static grep verification:**
- `grep -rn 'reduce' apps/api-gateway/src` (non-test files): 0 hits on `_mu` arrays.
- `grep -rn 'reduce' apps/web/src` (non-test files): hits are Redux Toolkit `reducers:` object keys only — NOT `Array.prototype.reduce` on metric values.
- `grep -rn '_mu\s*[*/+-]' apps/web/src`: 0 arithmetic hits on bigint _mu fields.
- `grep -rn 'formatMoney' apps/web/src`: 5 call sites, all import from `@brain/lib-metrics`. Zero local reimplementations.
- `grep -rn '/ 100\|/100' apps/web/src`: 2 hits — both inside `formatBp(bp: number)` and `formatX100(v: number)` which operate on `number` type (not bigint `_mu` fields). Type-guarded; CF-C6-RENDER-ONLY-1 compliant.

**One caveat noted:** `cm-waterfall-chart.tsx` lines 84-85 use `Number(step.cumulative_mu)` and `Number(step.value_mu)` for Visx pixel-coordinate math (SVG positioning only). The comment explicitly marks these as `cumulativePx`/`valuePx` — "NOT for display. Never pass to formatMoney." The actual display path (tooltip, axis labels) uses the retained `bigint` fields via `formatMoney(d.value_mu, ...)` and `formatMoney(BigInt(Math.round(Number(v))), ...)` where `v` is the yScale output (a pixel-domain float), not a stored `_mu` value. This is Visx integration necessity. The display invariant holds. Classified as LOW / context note, not a violation.

**Verdict: G-REGISTRY-ONLY PASSES. Mutant confirmed RED. Non-vacuous.**

---

## Money fidelity

- `formatMoney` is in ONE home: `packages/lib-metrics/src/format-money.ts`, exported from `index.ts`.
- Web imports: 5 call sites in `kpi-card.tsx`, `cm-waterfall-chart.tsx`, `drill-drawer.tsx` — all from `@brain/lib-metrics`.
- Mobile imports: `MorningBriefScreen.tsx` imports `formatMoney` from `@brain/lib-metrics`. `render-only.test.ts` verifies no local reimplementation.
- Zero `/ 100` operations on bigint `_mu` values in either web or mobile.
- `formatMoney` never calls `Number(minorUnits)` before dividing — uses BigInt division throughout.
- `/100`-hardcode mutant: KWD test proves `subunitMultiplier` is required (1000 ≠ 100; wrong output "KWD 1005.00" vs correct "KWD 100.500"). **PASS.**
- Render-only tests: `render-only.test.ts` (mobile) verifies no `Number()` on `_mu`, no `.reduce()` on `_mu`, no `_mu / literal`. **9 tests PASS.**

**PASS — formatMoney canonical confirmed.**

---

## Idempotency end-to-end

Client lifecycle (Karan): `idempotency-client.ts` generates the key at `initiateResponse()` (action-initiation, not send-time). The key persists in Redux until `settleResponse()` (non-error response). Offline replay reuses the same key — confirmed by `morning-brief-slice.test.ts` "unsettled initiateResponse keeps the existing key." **PASS.**

Server lifecycle: Redis dedup in `router.ts` `submitResponse` procedure checks `checkIdempotency()` BEFORE `dataPlane.submitInsightResponse()`. If cached: returns cached response with `idempotent_replay: true`. No second decision-log write. Double-tap test: ONE row confirmed. **PASS.**

---

## Run harness assessment (CF-C6-RUNNABLE-HARNESS-1 — the Founder acceptance gate)

**FINDING B1 (BLOCKING — must-fix-now): api-gateway server bootstrap does not exist.**

The `apps/api-gateway/package.json` declares `"dev": "tsx src/interfaces/server.ts"`. Running `pnpm dev` in `apps/api-gateway` would fail immediately:

```
Error: Cannot find module '/Users/.../apps/api-gateway/src/interfaces/server.ts'
```

Verification:
```
Command: find /Users/rishabhporwal/Desktop/Brain/apps/api-gateway/src -name '*.ts' ! -name '*.test.ts'
Output:
/Users/.../apps/api-gateway/src/application/router.ts
/Users/.../apps/api-gateway/src/application/trpc.ts
/Users/.../apps/api-gateway/src/domain/idempotency.ts
/Users/.../apps/api-gateway/src/domain/proto-types.ts
/Users/.../apps/api-gateway/src/domain/registry-mapper.ts
/Users/.../apps/api-gateway/src/domain/tenancy.ts
/Users/.../apps/api-gateway/src/infrastructure/loopback-data-plane.ts
```

`src/interfaces/server.ts` is absent. The `bootstrap/` and `interfaces/` directories are empty. There is no Fastify server entry point, no `createServer()` call, no port-binding, no tRPC HTTP adapter. The router and domain logic are complete and testable in-process, but the HTTP server that exposes them to the web frontend is not present.

Without the server, `pnpm dev` for the gateway fails → web frontend cannot call any tRPC procedures → the Founder cannot see numbers on screen.

**The Founder's acceptance bar ("a runnable app I can SEE") is not met.**

**Required fix:** Vikram must add `apps/api-gateway/src/interfaces/server.ts` wiring Fastify + `@trpc/server/adapters/fastify` with the `StubDataPlane` and `InMemoryIdempotencyStore`, binding to `:3001`. The boot command documented in the developer report becomes accurate only when this file exists.

---

**Exact boot command (for when F-B1 is fixed):**
```bash
# Terminal 1: api-gateway (requires server.ts fix first)
cd apps/api-gateway && pnpm dev
# → Fastify + tRPC on :3001; StubDataPlane serves Sugandh-Lok seed data

# Terminal 2: web
cd apps/web && pnpm dev
# → Next.js 16 + Turbopack on :3000

# Open: http://localhost:3000/login
# Credentials: founder@sugandhlok.com / brain-local-dev
# Expect: "₹18.50 L" Net Revenue, "₹3.20 L" CM2, "2.85×" ROAS, "1,247" orders
# (All values come from StubDataPlane seed, not hand-typed UI numbers)

# Mobile (requires Expo):
cd apps/mobile && expo start
```

The seed data path is real (StubDataPlane implements the full DataPlanePort contract and returns registry-derived Sugandh-Lok values). The numbers will be correct once the server boots.

---

## Findings — by severity (finding-severity-rubric.md)

### BLOCKING (must-fix-now)

**B1 — Missing api-gateway server bootstrap (CF-C6-RUNNABLE-HARNESS-1 VETO)**
- `apps/api-gateway/src/interfaces/server.ts` does not exist.
- `pnpm dev` in api-gateway fails immediately: "Cannot find module 'src/interfaces/server.ts'".
- The web UI cannot call tRPC procedures. The Founder cannot see any numbers.
- This is the primary Founder acceptance criterion. VETO.
- Owner: **Vikram** (backend-developer).

**B2 — TypeScript compile error in `kpi-strip.tsx` (web app cannot build)**
- File: `apps/web/src/interfaces/components/kpi/kpi-strip.tsx:123-126`
- Error: `TS1005: '...' expected` at position (125, 99).
- Root cause: JSX block comment `{/* ... */}` placed between JSX attribute-value pairs. This is invalid TSX syntax. Block comments are only valid between JSX elements, not as attribute values.
- `tsc --noEmit` exits with code 2. The Next.js build would fail. The web app cannot compile.
- Fix: Remove the inline JSX comment (lines 123-126). Move the comment to a code comment `//` before the prop, or remove it entirely. The `valueMu={summary.aov_mu != null ? BigInt(Math.floor(summary.aov_mu)) : null}` prop itself is valid.
- Owner: **Ananya** (frontend-web-developer).

---

### MEDIUM (must-fix-now — conservative tie-break per rubric)

**M1 — G-REGISTRY-ONLY static grep is test-by-proxy, not actual file grep**
- `gates.test.ts` line 386-413: the "static: no arithmetic operators in api-gateway router.ts outside formatMoney" test verifies the invariant by confirming the data plane value passes through unchanged — it does NOT call `grep` on the source file.
- Comment in the test: "We can't grep the file dynamically in a test, but we assert the invariant by confirming the KPI summary returns the data-plane value unchanged."
- This means the grep half of G-REGISTRY-ONLY (the "static grep finds NO arithmetic") is a proxy assertion, not a literal file scan. A future developer could add arithmetic that doesn't affect the stub values, and the test would still pass.
- The actual static grep run manually by QA confirms zero violations today (no `reduce` on `_mu` arrays; no `_mu` arithmetic). But the gate specification says "a static grep proves NO arithmetic" — the test should perform the grep.
- Severity: MEDIUM (not an immediate correctness failure; today's code is clean; but the gate verifier for this half is weaker than specified).
- Owner: Vikram (api-gateway gates).

**M2 — Trace IDs end-to-end: gRPC boundary not exercised (Phase 0 limitation)**
- Trace IDs (4-tuple: requestId, traceId, workspaceId, userId) propagate through the WorkspaceContext and are encoded into `buildGrpcMetadata()`. They appear on error responses. This is confirmed by code inspection.
- However, the gRPC boundary itself (Python handlers in `analytics-service/src/interfaces/` and `intelligence-service/src/interfaces/`) is deferred — these directories are empty (per architecture plan V4 deferral). The `DataPlanePort` in the tests is `StubDataPlane` (in-process, never crosses a gRPC wire).
- There is no test that starts a real gRPC server and verifies the `x-workspace-id` / `x-request-id` / `x-trace-id` headers arrive in the Python handler.
- The VETO condition "trace IDs not appearing end-to-end in a real-network test run" applies. The Phase 0 architecture explicitly defers this, but the gap is real.
- Classification: MEDIUM (architecture-acknowledged deferral, not a hidden regression; the code is wired correctly and would work when gRPC handlers are added). The harness README must document this gap explicitly so the Founder doesn't try to trace a request across the gRPC boundary before V4 lands.
- Owner: Vikram (V4 gRPC handlers).

**M3 — Visx pixel-math `Number()` on `_mu` fields without BigInt range guard**
- `cm-waterfall-chart.tsx` lines 84-85 convert `step.cumulative_mu` and `step.value_mu` to `Number()` for SVG pixel-coordinate math. Comment: "safe for INR seed values < 2^53."
- The `< 2^53` assumption is a hardcoded constraint: if production values ever exceed ~₹90 crore total pipeline (unlikely for Sugandh-Lok seed, possible for future brands), pixel positioning would be slightly imprecise. The display path (formatMoney) is correct; only the pixel math could drift.
- Not a display-fidelity failure for current seed values, but the assumption is undocumented as a runtime invariant.
- Owner: Ananya (consider wrapping in a `clampToSafeInteger` helper + comment explaining the intentional lossy conversion for pixel math only).

---

### LOW (defer — does not block this child)

**L1 — jsdom navigation warning in web tests (expected noise)**
- `login-form.test.tsx` emits `Error: Not implemented: navigation (except hash changes)` in jsdom.
- This is the expected jsdom behavior when a form triggers `window.location.href = '/dashboard'` in a test environment. All 35 tests pass. Not a real failure.
- Owner: Ananya (suppress with `vi.spyOn(window.location, 'href', 'set')` or switch to `router.push` navigation for testability — minor cleanup, not blocking).

**L2 — Playwright E2E smoke requires harness that is not yet bootable**
- `apps/web/src/test/e2e/dashboard.spec.ts` is wired to `localhost:3000`. It cannot run until B1 (server bootstrap) and B2 (TSC error) are both fixed.
- Once fixed, the E2E smoke is the correct harness validation path for the Founder's acceptance.
- Owner: Stage-8 / Jatin after B1+B2 are resolved.

---

## Operational readiness

| Check | Result |
|---|---|
| Health endpoint | NOT PRESENT — no server.ts (consequence of B1) |
| Port binding | NOT PRESENT — no server.ts |
| Env var documentation | Env vars noted in loopback-data-plane.ts comments (`GRPC_METRICS_ADDR`, `GRPC_INTELLIGENCE_ADDR`) but no `.env.example` file |
| Native deps | api-gateway: pure Node; mobile: cert pin native config present; tsc exit 0 (api-gateway) |
| pnpm workspace | PASS — no workspace.yaml misconfigurations |

---

## CF-C6-* constraint satisfaction summary

| CF | Owner | QA Status | Notes |
|---|---|---|---|
| CF-C6-BIGINT-JSON-1 | Vikram | PASS | G-BIGINT real-path + mutant confirmed; superjson registered |
| CF-C6-FORMATMONEY-CANONICAL-1 | lib-metrics | PASS | ONE home; KWD mutant kills /100 hardcode; web+mobile import from @brain/lib-metrics |
| CF-C6-AS-OF-STAMP-1 | Vikram/Ananya/Karan | PASS | data_epoch in all responses; StalenessLabel + fetchedAt in Redux |
| CF-C6-ROAS-DISPLAY-CONTRACT-1 | Vikram/Ananya | PASS | scale:100 on blended_roas_x100; parity gate extended; web renders value/100 as "2.85×" |
| CF-C6-REGISTRY-ONLY-BFF-1 | Vikram | PASS (with M1) | Real-path + orphan mutant confirmed; static grep is proxy (M1) |
| CF-C6-RENDER-ONLY-1 | All | PASS | Zero _mu arithmetic in web/mobile; formatMoney is the ONLY formatter |
| CF-C6-GATEWAY-TENANCY-1 | Vikram | PASS | ws==claim.ws confirmed; MANAGER≥ boundary confirmed; cross-workspace isolation confirmed |
| CF-C6-MB-IDEMPOTENCY-1 | Vikram+Karan | PASS | G-IDEMPOTENT; client persists key until settled; one row confirmed |
| CF-C6-MB-GRADUATED-LABEL-1 | Vikram+Karan | PASS | LOGGED_AS_VOTE Day-1; "Log Approval" (not "Approve & Execute"); server-driven |
| CF-C6-MB-CONTRACT-COMPLETENESS-1 | Vikram | PASS | expected_impact{revenue_mu,cm2_mu,impact_label}+risk+confidence_display_pct present |
| CF-C6-MB-OFFLINE-SLO-1 | Karan | PASS | offline-posture.test.ts: stale-but-labelled; CTAs disabled; OTel SLO metric emitted |
| CF-C6-MB-A11Y-ACTION-1 | Karan | PASS (untestable in CI) | CTA_MIN_HEIGHT=48dp; rationale separated from button group; WCAG AA contrast values documented |
| CF-C6-MB-PUSH-TOKEN-1 | Vikram+Karan | PASS | SEND absent from codebase; registerPushToken only |
| CF-C6-NO-UI-FLOAT-1 | Vikram+Karan | PASS | confidence_display_pct is int; no multiply in render |
| CF-C6-NEW-LAYER-1 | Ananya+Karan | PASS | zero axios; zero Zustand; grep confirmed |
| CF-C6-PII-CLIENT-1 | Ananya+Karan | PASS | no email/password in logs (negative test); SecureStore for refresh token |
| CF-C6-RUNNABLE-HARNESS-1 | Vikram | **FAIL (B1)** | server.ts missing; harness does not boot |
| CF-C6-PERF-A11Y-1 | Ananya | PARTIAL | Server Components + skip-nav + aria present; Lighthouse requires running harness (blocked by B1) |
| CF-C6-DATA-SEAM-1 | Vikram | PASS (protocol) | Protos authored; DataPlanePort seam; loopback Phase 0 |
| CF-BN-NOLEGACY-1 | All | PASS | grep confirms zero legacy project references in any new file |

---

## Verdict

**QA: BOUNCE**

Two BLOCKING findings prevent the PASS gate:

1. **B1** — `apps/api-gateway/src/interfaces/server.ts` does not exist. The `pnpm dev` command fails. The web app cannot connect to the BFF. The Founder cannot see any numbers. CF-C6-RUNNABLE-HARNESS-1 VETO.

2. **B2** — TypeScript compile error `TS1005` in `kpi-strip.tsx` line 123-126. Invalid JSX comment placement between attribute-value pairs. `tsc --noEmit` exits code 2. The Next.js app cannot build.

Both B1 and B2 must be fixed before re-submission. The three integrity gates (G-BIGINT, G-IDEMPOTENT, G-REGISTRY-ONLY) are confirmed GREEN with killed mutants. Money fidelity (formatMoney canonical) is confirmed. The mobile suite (52 tests, stable), api-gateway suite (22 tests, stable), and lib-metrics suite (126 tests, stable) all pass. The Python suite (291 tests) passes. The parity gate (scale field added) passes. The underlying architecture is sound — these are implementation gaps, not design failures.

**Bounce target: Ananya (frontend-web-developer)** — primary (B2 + M1 static grep note + M3 Visx comment). Vikram as secondary for B1 (server.ts) and M2 (trace ID gRPC gap documentation).

