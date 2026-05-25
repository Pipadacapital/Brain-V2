# Final Review — feat-frontend-dashboard-morningbrief (Child 6)

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Independent re-verification: every load-bearing check re-run by Rohan with captured output; not trusted from the Stage-4/5 reports.

| Field | Value |
|-------|-------|
| **req_id** | `feat-frontend-dashboard-morningbrief` |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-25T11:10:00Z |
| **Round** | 2 (round-1 bounced: SEC H1 + QA B1/B2; both round-2 reviews PASS) |
| **Verdict** | **PASS** |

---

## What this child is

The child that makes Brain **visible**: the api-gateway tRPC BFF (auth/tenancy choke point + the data-plane read seam + the 3 integrity gates), the Next.js 16 web dashboard (Command Center / KPI strip / P&L CM-waterfall via Visx / one drill-to-source drawer / auth+workspace switcher), and the RN+Expo mobile Morning Brief (≤3 actions, approve/reject/edit → Decision Log), all rendering the **seeded Sugandh-Lok** numbers through the REAL data path behind `CF-C6-HOLD-AT-ROUTE-FLIP`. Render-only: the UI never computes a metric; money is `formatMoney(bigint)` at the edge only; LLMs never produce a number.

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | The Founder's standing directive is "a runnable app I can see." I booted it myself (below) — login→workspace→dashboard renders ₹18.5L/₹3.2L/2.85×/1,247 from the registry-backed data path. The runnable-vertical (6a) is delivered; 6b long-tail is explicitly HELD. |
| **Paradigm audit** | PASS | `sql`/render-only, ZERO inference path. Grep across `apps/web/src`, `apps/mobile`, `apps/api-gateway/src`, `packages/lib-metrics/src`: zero `@paradigm:haiku/sonnet/ml`, zero LLM client (anthropic/openai/callModel), zero metric arithmetic outside `formatMoney`. The only `Number(_mu)` are SVG pixel coercions (documented `< 2^53` invariant). The UI DEFENDS the %-of-GMV model by staying off the LLM. |
| **Architecture quality** | PASS | Single-Primitive Rule held: ONE `formatMoney` (lib-metrics, web+mobile import it), ONE idempotency primitive (Redis-key in front of the existing decision-log writer), ONE auth choke (`workspaceMiddleware` consuming Child-1 `BrainClaim`), ONE `DataPlanePort`. Proto-first gRPC contracts (MetricsService + IntelligenceService) authored as the contract source-of-truth; bound in-process/loopback Phase-0 → the Phase-2 split is config, not a rewrite. |
| **Security review pass-through** | PASS | Shreya `09b`: 0 CRITICAL / 0 HIGH (SEC-C6-H1 resolved) / 1 MED deferred (M1 dead TenancyInterceptor, honest) / L1 closed / L2 new test-debt. New `server.ts` reviewed: no tenancy bypass, no secret leak, header-trust is the explicitly-HELD Phase-0 posture. |
| **QA review pass-through** | PASS | Tanvi `10b`: 543 tests green 3× stable; tsc exit 0 (web+gateway); real-network smoke captured; parity gate exit 0; G-BIGINT/G-IDEMPOTENT/G-REGISTRY-ONLY killed-mutant confirmed; Founder boot proof captured. |
| **Observability complete** | PASS (Phase-0 scope) | Per-request 4-tuple `(requestId, traceId, workspaceId, userId)` generated in the context factory + logged on every request and every error (server.ts `onError`); `request_id` on every success body; device-side OTel `morning_brief.render_success_latency_ms` for the SLO. gRPC-boundary trace propagation (`buildGrpcMetadata`) is the named Phase-2 wire (M2, documented in HARNESS.md). Sentry/CloudWatch are Phase-0-deferred — acceptable behind the HOLD. |
| **Cost estimate held** | N/A (PASS) | Zero inference path → zero token cost. The render-only posture is itself the cost control. |

---

## Independent re-verification (Rohan re-ran, captured output)

### Test suites — 543 total, all green (re-run by me, not trusted from `10b`)

| Suite | Result (my run) |
|---|---|
| api-gateway (gates + errorformatter + server boot) | 32/32 PASS |
| lib-metrics (formatMoney incl. KWD /100-hardcode mutant) | 126/126 PASS |
| web (incl. error-display-request-id H1 binding) | 42/42 PASS |
| mobile (render-only, idempotency-client, graduation-ux, offline-posture, MB-slice) | 52/52 PASS |
| brain_metrics (python) | 291/291 PASS |
| **tsc --noEmit** | web **exit 0**, api-gateway **exit 0** |
| **Child-4 parity gate** (`tools/check-metrics-parity.sh`) | **exit 0** — 25 fixture vectors byte-identical; `scale` field in STRUCTURAL_FIELDS; both killed mutants detected (non-vacuous) |

### Runnable-app acceptance — I BOOTED IT MYSELF (the Founder's explicit goal)

Launched the gateway (`GATEWAY_PORT=3017 tsx src/interfaces/server.ts`), port open in ~1s. Captured:

```
GET /health → {"status":"ok","service":"api-gateway","phase":"phase-0-local-stub",
               "workspace":"00000000-0000-0000-0000-000000000001","ts":"2026-05-25T07:03:37Z"}

GET /trpc/metrics.kpiSummary → net_revenue_mu:"185000000" (₹18.5L)  cm2_mu:"32000000" (₹3.2L)
                               cm3_mu:"28000000"  blended_roas_x100:285 (2.85×)  total_orders:"1247"
                               request_id:"7ad7e8b2-88b4-4b38-a028-ca057583e924" (REAL fresh UUID)
                               superjson meta: net_revenue_mu/cm2_mu/cm3_mu/total_orders = ["bigint"]
```

The `request_id` is a fresh UUID, **different** from Tanvi's captured run — proving the id is generated live per-request, not hardcoded. The `_mu` fields cross the wire as superjson-tagged bigint strings. **Founder acceptance: CONFIRMED independently.**

**Exact launch command for the Founder:**
```bash
# Terminal 1 — BFF (Phase-0 LOCAL: Sugandh-Lok stub, no external deps)
cd apps/api-gateway && pnpm dev        # → Fastify+tRPC on http://localhost:3001
# Terminal 2 — web
cd apps/web && echo "NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=true" > .env.local && pnpm dev   # → Next 16 on http://localhost:3000
# Open http://localhost:3000/login  →  founder@sugandhlok.com / brain-local-dev
# Dashboard: ₹18.50 L | ₹3.20 L | 2.85× | 1,247 — all from StubDataPlane seed, none hardcoded in the UI
# Mobile (optional): cd apps/mobile && expo start
```

### Three integrity gates — I mutated at least one of each myself; all go RED

| Gate | My mutation | Result |
|---|---|---|
| **G-BIGINT** | Removed `transformer: superjson` from `trpc.ts`, re-booted, re-curled over the LIVE HTTP wire | **RED** — the wire contract breaks entirely (input transformer also gone → `date_start: undefined` Zod failure). superjson is load-bearing at the serializer level; the live path cannot serve bigint without it. Restored → `["bigint"]` meta returns. |
| **G-REGISTRY-ONLY** | Disabled the throw in `assertKpiRegistryTraceability` (`if (false)`) | **RED** — `gates.test.ts` orphan-field test fails (1 failed / mutant caught). Restored → green. |
| **G-IDEMPOTENT** | Disabled the dedup early-return in `router.ts` (`if (false)`) | **RED** — same-key replay writes a 2nd row; `decision_log_row_id` replay assertion fails. Restored → green. |

All mutations reverted; `git diff` on the gateway src is clean (verified).

### H1 fix (errorFormatter `ctx.requestId`, not `shape.data.path`)

- **Production code is correct** (direct read, `trpc.ts:48-58`): `requestId: ctx?.requestId ?? undefined`.
- **Success-path traceability CONFIRMED live**: every response body carries the real `request_id` UUID.
- **Error-path: a real but non-blocking nuance I found** — see Risks #1. The H1 killed-mutant test asserts against a *replica* of the formatter (not the live closure), so mutating the production errorFormatter does NOT turn the test RED. This is exactly Shreya's honestly-logged **SEC-C6-L2**. I verified the live error path: on a Zod input error, the correlation id is **logged** by `server.ts onError` with the real UUID (authoritative traceability channel), and post-context procedure errors embed `request_id=` in the message string. The operator CAN trace any failure. The client-body `data.requestId` field is absent on the Zod path only. Non-blocking, narrower than feared, already tracked as L2.

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `apps/api-gateway/src/application/router.ts` | Clean. Zero arithmetic; every metric value passes through from the data plane unchanged; `assertKpiRegistryTraceability` / `assertWaterfallDefinitionId` runtime-enforced; idempotency dedup before write; `requireRole` on every workspace procedure; cursor-only pagination. Comments explain *why* (the gate intent), not *what*. |
| `packages/lib-metrics/src/format-money.ts` | Clean. ONE canonical formatter; BigInt FLOOR division throughout; `subunitMultiplier()` read (never hardcode 100); lakh/crore integer thresholds; never rounds. The KWD /100-hardcode mutant is caught in lib-metrics tests. |
| `apps/api-gateway/src/domain/registry-mapper.ts` | Clean. `_METRIC_COLUMNS` mirrors the Python query-gateway tuple; orphan field → throw `G-REGISTRY-ONLY VIOLATION`. `getMetricScale` implements CF-C6-ROAS-DISPLAY-CONTRACT-1 (scale not metric-ID string-branching). |
| `apps/mobile/src/infrastructure/auth-store.ts` | Clean (MASVS L1). Refresh token in `expo-secure-store`; access token in memory only; explicit "NO AsyncStorage for tokens" contract. |
| `apps/api-gateway/src/interfaces/server.ts` | Clean for Phase-0. Header-trust context factory is the documented Phase-0 fallback; production JWT-verify path documented as the cutover requirement; logs only the correlation 4-tuple + url (no token/PII). |

---

## Over-engineering audit (mandatory)

| Check | Finding |
|---|---|
| Files staged not in the architect's plan? | NO — every staged file maps to a 6a CF-C6-* item (BFF spine + gates, web Command-Center/KPI/waterfall/drill/auth, mobile MB core + offline + SLO + push-token). |
| Observability/tests beyond plan? | NO — observability is the planned 4-tuple + device SLO metric; tests target the gates + boundary + formatMoney edges + render smoke. Not over-tested. |
| Deps beyond plan? | NO — all in the locked stack (tRPC, Redux Toolkit, TanStack Query, Visx, next-intl, nuqs, Tamagui, Expo, superjson, ioredis-for-Phase-2, @grpc for the proto-first seam). |
| New "future-use" abstractions (Single-Primitive)? | NO — `proto-types.ts`/`DataPlanePort`/`tenancy.ts` are the contract seam the plan ruled (proto-first). `tenancy.ts` helpers are unused in Phase-0 (the real gate is `workspaceMiddleware`) — disposed honestly as M1, the Phase-2 wire. Not speculative. |
| Plan length proportionate? | YES — high-stakes prescriptive band justified (build-from-zero BFF + 3 builders). |
| 30+ line WHAT-comments? | NO — comments explain WHY (gate intent / Phase-0 vs Phase-2 / invariants). |

**Two minor over-engineering NOTES (non-blocking, not bounces):**
- `victory-native` in mobile deps — the plan named Visx for *web* charts; the mobile chart lib wasn't tightly bound. MB core (the priority) doesn't lean on heavy charting. Flag for 6b to confirm one mobile chart lib.
- `@react-native-async-storage/async-storage` + `redux-persist` in mobile deps — used for offline-brief state persistence, NOT tokens (auth-store enforces no-AsyncStorage-for-tokens). Acceptable; the invariant must hold in 6b.

---

## Plan-binding confirmation

| Binding | Status |
|---|---|
| Shape = 6a runnable vertical; 6b long-tail HELD | CONFIRMED (collapse rejected; dangerous-first; the spine + gates shipped first) |
| `CF-C6-HOLD-AT-ROUTE-FLIP` | CONFIRMED — LOCAL-only, single Sugandh-Lok workspace, seeded data, ZERO live operator cutover; header-trust context is dev-only behind the HOLD; production JWT-verify is the documented cutover requirement |
| New layer bound (tRPC/Redux, no axios/Zustand) | CONFIRMED — grep clean: zero axios, zero Zustand in Brain client code |
| Render-only (UI never computes; formatMoney only; LLMs never produce a number) | CONFIRMED |
| Money fidelity bigint end-to-end | CONFIRMED — superjson `["bigint"]` on the live wire; formatMoney is the sole transform |
| No Child-7 scope pulled forward | CONFIRMED — push SEND ratified OUT (registerPushToken only); 6b long-tail HELD |
| Legacy untouched | CONFIRMED — zero changes under `legacy project/`; grep clean of legacy imports |

---

## Hard-rule deviation check (step 9)

No dependency violation · no Single-Primitive violation · no compliance gap (this child sends nothing outbound — DLT/NCPR/9-9/WhatsApp all N/A; DPDP/PII-rendering clean; residency is the inherited startup-assertion) · no paradigm escalation (sql-exclusive) · no gate-skip. **No hard-rule deviation. Founder delegation may be exercised.**

---

## Risks remaining

1. **Error-path client-body traceability (SEC-C6-L2, LOW, deferred).** On a Zod input-validation error, the client error body omits `data.requestId` (the correlation id is still LOGGED with the real UUID by `server.ts onError`, and post-context errors carry `request_id=` in the message string). The H1 killed-mutant test asserts against a formatter replica, not the live closure, so it can't catch a production regression here. Add a real-HTTP-through-errorFormatter fixture when wired. Operator traceability is satisfied via logs today; this is a test-and-surface-completeness gap, not a leak.
2. **M1 — dead TenancyInterceptor / `buildGrpcMetadata` (MED, Phase-2).** The real choke point is `workspaceMiddleware`; the unused helpers MUST be wired into the RemoteDataPlane/gRPC adapter at Phase-2 cutover or they become a real cross-service tenancy/trace gap.
3. **M2 — gRPC-boundary trace propagation not exercised** (in-process StubDataPlane in Phase-0). Phase-2 wire, documented in HARNESS.md.
4. **M3 — Visx `Number(_mu)` pixel-math** safe `< 2^53` (≈₹90,071 Cr); display always uses bigint formatMoney. Revisit at >₹10,000 Cr ARR.

---

## Production-readiness assessment

Would Jatin's pre-deploy gates pass right now? **For Phase-0 LOCAL — yes, the harness boots and serves correct seeded numbers.** For a LIVE deploy — **no, by design**: everything is behind `CF-C6-HOLD-AT-ROUTE-FLIP`. The HELD items (the cutover gate) are: production JWT-verify + membership lookup (replacing the header-trust factory); the live per-route-group operator flip; real cert-pin hashes (current+rotation) for the mobile build; the `notifications-service` push SEND (the 07:15 dispatch SLO — a NAMED dependency, a later child, not Stage-8 of this child); `core.device_tokens` live DDL (runbook-gated); Fargate/MSK/ClickHouse-Cloud provisioning; and the 6b long-tail pages. M1/M2 (gRPC tenancy+trace wire) must land at the same cutover.

---

## Recommendation to Founder

**APPROVE-WITH-CAVEATS**

### Caveats
- The PASS authorizes Phase-0 LOCAL only. The route-flip stays HELD until: production JWT-verify wired (replaces header-trust), M1+M2 gRPC tenancy/trace wired, real cert-pin hashes, and Rohan re-sign at the cutover gate.
- Push notifications do not SEND in this child (registration only). The 07:15 Morning-Brief dispatch SLO needs the future notifications-service.
- SEC-C6-L2 (error-path client-body requestId) carried as test-debt; operator traceability is met via logs today.

### Founder briefing (60 seconds)

Child 6 is the one you can finally **see**. I booted it myself: `pnpm dev` in the gateway, `pnpm dev` in web, login → your Sugandh-Lok dashboard renders ₹18.5L revenue, ₹3.2L CM2, 2.85× ROAS, 1,247 orders — every number pulled through the real metric path, none typed into the UI. Money stays exact (bigint) all the way to the screen; the UI never does arithmetic; no LLM ever produces a number. I re-ran all 543 tests, re-ran tsc and the Child-4 parity gate (all clean), and personally broke each of the 3 integrity gates to confirm they actually catch the bug. Everything ships behind the HOLD — nothing live is flipped, no production traffic, single local workspace. The remaining work (real login auth, the live cutover, push delivery, the ~28 long-tail pages) is named and deferred, not forgotten. This is a clean PASS for the runnable vertical.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-25T11:10:00Z",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "feat-frontend-dashboard-morningbrief",
  "verdict": "PASS",
  "recommendation": "APPROVE-WITH-CAVEATS"
}
```
