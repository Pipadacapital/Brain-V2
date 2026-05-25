# Feature Journal — feat-frontend-dashboard-morningbrief (Child 6)

> Per-feature continuity log. EPIC: `chore-migrate-legacy-to-brain`. Child 6 of 7 (frontend — web dashboard + mobile Morning Brief).
> THE child that makes Brain VISIBLE — the Founder's explicit goal is a runnable app with a UI they can see. The UI RENDERS; it never computes a metric, never calls an LLM, never produces a number. Money is MU formatted at the edge. New-layer decisions bound here: axios→tRPC, Zustand→Redux Toolkit. Live operator cutover HELD (facade per-route-group flip).

---

## Stage 1 — 2026-05-25T05:40:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE (2 personas requested → synthesis pending orchestrator re-invoke). Sound, business-aligned (the visible product surface), dependency-satisfiable for the BUILD, planable. NOT CHALLENGE-BACK (broad surface resolved by an internal 6a/6b split, not a bounce). NOT KILL (the whole point — a runnable, visible Brain).

**Ground truth (verified on disk, not trusted from prose):** api-gateway + web + mobile are BARE `.gitkeep`-only scaffolds — zero tRPC anywhere, zero implementation. NO gRPC service surface exists (only health.proto + integrations.proto; analytics/intelligence `interfaces/` are bare). The data-plane functions DO exist Python-side: `analytics-service.query_metrics(workspace_id, definition_id, date_range)` (fail-closed UnscopedQueryError), `lib-metrics` TS registry, `intelligence-service` `InsightItem{TypedRecommendation{action:closed-enum, entity_id, rationale:render-only}}` + server-side faithfulness validator. Child-1 `brain-claim` + `withWorkspace` auth contract present. Legacy frontend = ~33 `w/[slug]` route groups (the long tail). **Implication: Child 6 is NOT pure frontend — the api-gateway tRPC BFF + auth/tenancy choke point + the data-plane read surface must be BUILT FROM ZERO (Vikram), or Ananya/Karan have nothing to render against.**

**Lane:** high-stakes. Surfaces: auth (gateway IS the choke point, built first time here), multi-tenancy (workspace_id JWT→gateway→data-plane; cross-workspace render = P0), money (every KPI is MU→₹; wrong edge-format corrupts the honest number), schema-proto (tRPC contract + any new gRPC read proto), pii (customer/order/RTO/pincode rendered; never in client logs), india-compliance (in-region API, ₹ lakh/crore, residency). Carve-out inapplicable (live presentation + auth + multi-tenant reads + money display); conservative tie-break moot.

**Paradigm:** `sql` / render-only (confirmed). Zero inference path in this child. KPIs from the registry/query_metrics; AI content produced + faithfulness-validated UPSTREAM in Child 5 — the UI renders that text, never generates it. Any `@paradigm` LLM decorator, LLM client, or metric arithmetic in web/mobile/gateway-read = paradigm violation → BOUNCE at Stage 6.

**Scope ruling (CF-C6-SCOPE-SPLIT-1):** ONE requirement, 6a runnable-vertical → 6b long tail (precedent: 1a/1b, 3a/3b/3c, 4a/4b, 5a/5b). 6a = api-gateway BFF + auth/tenancy + data-read surface (Vikram) + web Command Center + P&L/CM-waterfall (Visx) + one drill-to-source drawer + auth/login + workspace switcher (Ananya) + Morning-Brief core with approve/reject/edit→Decision-Log (Karan), against SEEDED Sugandh-Lok data, behind the HOLD, with a LOCAL runnable harness. 6b = remaining ~28 route groups + mobile beyond MB core + i18n translations/RTL. Dangerous-first ordering: the auth/tenancy/money/contract spine ships first; the long tail is mechanical repetition behind a proven primitive.

**Runnable-UI / seed-harness ruling (CF-C6-RUNNABLE-HARNESS-1):** a LOCAL runnable + deterministic Sugandh-Lok seed IS in-scope for 6a (the success metric is literally "a runnable app I can see"; a UI that can't run fails its own bar). Bounded: local docker-compose fixtures + pnpm dev web + Expo mobile, seed feeds the REAL data path (not hand-typed UI numbers, so render-only is actually exercised). OUT: any live/staging deploy, MSK/ClickHouse-Cloud provisioning, live cutover, ArgoCD/CI changes (→ Jatin Stage 8). Zero legacy code, no live Supabase.

**New-layer decisions BOUND (CF-C6-NEW-LAYER-1):** axios→tRPC (no REST/axios in Brain client); Zustand→Redux Toolkit (Zustand banned; server-state=TanStack Query, URL=nuqs). Inside the locked stack — no tech-stack-evaluation. Any axios/Zustand in Brain client code = drift bounce.

**Builders:** Ananya (web), Karan (mobile), **+ Vikram (backend, REQUIRED)** — the gateway BFF + auth/tenancy + data-read surface do not exist and are the 6a spine. **Maya: NOT co-owner — CONSULTED on ONE seam** (the Morning-Brief content contract `InsightItem`/`TypedRecommendation`: rationale render-only, closed action enum, approve/reject/edit payload matches the Child-5 Decision-Log write path). Child 6 renders; metric/AI definitions are Child-4/5 (shipped). Aryan may upgrade her to co-owner at Stage 2 with a one-line rationale.

**Personas requested (2; high-stakes cap; two orthogonal dimensions):** (1) `dashboard-number-fidelity-realist:sonnet` — UI never computes/rounds/restates a metric; MU→₹ edge-format; AI narration never contradicts the rendered registry number; drill-to-source provenance; name the cross-workspace render-leak path. (2) `mobile-morning-brief-perf-a11y-realist:sonnet` — the canon's highest-quality UI; three-signal/≤3-action render of the Child-5 contract; approve/reject/edit→Decision-Log through the gateway (tenancy+RBAC+idempotency); offline/stale degradation; perf LCP<2s/INP<200ms + WCAG AA; name the surface most likely to miss the budget. Declined: web-only perf persona (folded into #1), india-compliance-officer (no outbound channel; residency is one bind), data-seam persona (Aryan's Stage-2 job).

**Escalation:** none. No compliance ambiguity (sends nothing outbound; residency is the inherited CF-RES-1 startup bind), no cost-model threat (sql/render-only DEFENDS %-of-GMV by keeping the UI off the LLM), no irreversible decision (behind the HOLD, seeded, reversible facade flip), no moat change. Founder gate at Stage 7 (delegated) is the ratification point. One armed-not-fired item: confirm push SEND is out of scope (token-registration in; delivery is notifications-service).

**Binding constraints to Stage 2 (16):** CF-C6-SCOPE-SPLIT-1, -RENDER-ONLY-1 (CRIT), -GATEWAY-TENANCY-1 (CRIT), -FAITHFULNESS-RENDER-1, -DRILL-TO-SOURCE-1, -MB-DECISION-LOG-1, -DATA-SEAM-1 (CRIT, Aryan must-decide: in-process vs gRPC+proto; no "figure it out during build"), -RUNNABLE-HARNESS-1, -NEW-LAYER-1, -PERF-A11Y-1, -I18N-SEAM-1, -PII-CLIENT-1, -HOLD-AT-ROUTE-FLIP; inherited CF-BN-NOLEGACY-1, CF-RES-1, Child-1 auth/RLS gate, Child-2 MU money, Child-4 query-gateway read discipline, Child-5 InsightItem/faithfulness contract.

**Open questions for Stage 2:** (1) the data seam (in-process vs gRPC+proto — biggest Stage-2 decision); (2) 6a/6b collapse-vs-split (expect held); (3) push-send scope; (4) seed-harness home; (5) Maya consult-vs-co-own; (6) Vikram staffed as a parallel build track.

**Next:** orchestrator spawns both personas in parallel (03/04) → re-invokes Rohan for synthesis → Stage 2 Architect (Aryan), Maya consulted on the Morning-Brief content seam, Vikram on the BFF/data-read spine.

---

## Stage 1 (synthesis) — 2026-05-25T07:10:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE → Stage 2 (Architect, Aryan). Synthesis complete. Both personas PASS the quality gate. Escalation to Founder = none.

**Persona quality gate — BOTH PASS:** dashboard-number-fidelity-realist:sonnet (1 CRITICAL + 2 HIGH + 2 MED + 1 LOW; found a real latent bug beyond brief — blended_roas_x100 unit:'bp' vs x100-scale tag divergence) + mobile-morning-brief-perf-a11y-realist:sonnet (1 CRITICAL + 3 HIGH + 2 MED; correctly self-routed its Concern 3 to synthesis). 12 grounded concerns, none rejected, none a looks-good pass.

**CONVERGENCE (headline):** both personas independently named the NOT-YET-BUILT api-gateway BFF/contract-integrity seam as their #1 risk — number-fidelity's BFF month-sum-via-JS-reduce (unregistered + BigInt-truncating + faithfulness-blind) and morning-brief's approve/reject/edit double-write to the append-only Decision Log (no idempotency at the tRPC proc). Same root: the BFF is build-from-zero; the integrity contracts must be specified at the proc layer BEFORE any card/mutation. Hard-confirms CF-C6-DATA-SEAM-1 = THE Stage-2 must-decide + Vikram REQUIRED (the spine + the gates are backend work).

**Escalation RULED (morning-brief Concern 3):** InsightItem proto missing expected_impact{revenue_mu,cm2_mu}+risk → **AMEND the Child-5 contract, NOT scope-down.** Fields are Morning-Brief canon; scope-down amputates the headline surface; on-device compute violates RENDER-ONLY/the iron rule. Safe because the fields are registry-DERIVED deterministic (Tier-A) values, NOT LLM/narration outputs. Lands in the domain contract + proto/intelligence/v1/insight.proto; Maya consults on semantics + deterministic source; Aryan picks the mechanism (ruling fixed). Internal Stage-2 architecture-amendment — not a Founder escalation.

**12 folded constraints (with owners):** CF-C6-BIGINT-JSON-1 (CRIT, Vikram), CF-C6-FORMATMONEY-CANONICAL-1 (HIGH, lib-metrics: Vikram+Maya-consult), CF-C6-AS-OF-STAMP-1 (HIGH, sharpens FAITHFULNESS-RENDER; Vikram+Aryan+Ananya/Karan), CF-C6-ROAS-DISPLAY-CONTRACT-1 (MED, Maya-consult+Vikram+Ananya), CF-C6-REGISTRY-ONLY-BFF-1 (MED, Vikram), CF-C6-NO-UI-FLOAT-1 (LOW, Vikram+Maya-consult), CF-C6-MB-IDEMPOTENCY-1 (CRIT, sharpens MB-DECISION-LOG; Vikram+Karan), CF-C6-MB-GRADUATED-LABEL-1 (HIGH, Vikram+Karan), CF-C6-MB-CONTRACT-COMPLETENESS-1 (HIGH — the ruled escalation; Aryan+Maya-consult+Vikram+Karan), CF-C6-MB-OFFLINE-SLO-1 (HIGH, Karan+Vikram), CF-C6-MB-A11Y-ACTION-1 (MED, Karan), CF-C6-MB-PUSH-TOKEN-1 (MED, resolves armed-not-fired; Vikram+Karan).

**3 integrity gates bound as killed-mutant (6th verify-the-verifier occurrence; NOT self-adopted):** G-BIGINT (>MAX_SAFE_INTEGER round-trip; mutant = bare-JSON-number serializer → RED), G-IDEMPOTENT (double-submit same key → single Decision-Log row; mutant = remove Redis dedup → RED), G-REGISTRY-ONLY (every BFF field traces to definition_id + no arithmetic outside formatMoney; mutant = orphan reduce → RED). + 4 companion negative controls (tenancy isolation, formatMoney /100-mutant parity, graduated-label, offline). Bound in-child under Rohan Stage-6 VETO.

**Confirmed:** 6a/6b split held; runnable harness + Sugandh-Lok seed in 6a (real data path); axios→tRPC + Zustand→Redux bound; builders Ananya+Karan+Vikram (Vikram owns all 3 killed-mutant gates); Maya CONSULT (content contract + amendment semantics); push SEND OUT / token-registration IN.

**Next:** Stage 2 Architect (Aryan) — binding plan; Maya CONSULTED on the Morning-Brief content seam + the amendment field semantics; Vikram on the BFF/data-read spine. Ananya web 6a + Karan mobile MB core parallel at Stage 3 (gated on Vikram's BFF + integrity gates).

---

## Stage 2 — 2026-05-25T08:30:00Z — Aryan (architect)

**Decision:** ADVANCE → Stage 3. Binding plan produced: `06-architecture-plan.md` + prescriptive `07-handoff-to-developer.md`. status → dev-parallel. Paradigm `sql`/render-only AFFIRMED (Rohan Stage-1 sign-off carried; no re-invoke).

**THE DATA-SEAM RULING (CF-C6-DATA-SEAM-1, the must-decide):** proto-first gRPC contracts authored NOW (`protos/brain/metrics/v1/metrics.proto` MetricsService + `protos/brain/intelligence/v1/intelligence.proto` IntelligenceService), bound IN-PROCESS / localhost-loopback in Phase 0-1. Decisive ground truth = `technical-context.md:76` ("Phase 0-1 = the data deployable is one Python process; the 7-service split is mechanical — flip in-process call → network call, not a rewrite, BECAUSE gRPC contracts exist day one") + `:139` (MetricsService + IntelligenceService named; money bigint via superjson). The gateway ALWAYS speaks gRPC via one `DataPlanePort`; thin handlers wrap the existing in-process `query_metrics`/morning-brief fns in the bare analytics/intelligence `interfaces/` folders. **NO second/throwaway code path** → the Phase-2 split is config (loopback→cross-task), not code. REJECTED: pure-in-process (Node→Python impossible without a wire), bespoke HTTP/JSON shim (the throwaway path the canon forbids), full split-mesh+EKS now (over-build, Phase 2).

**The 6a runnable vertical + how it LAUNCHES:** 6a HELD (collapse rejected — runnable-app goal makes the split load-bearing; dangerous-first ordering). The LOCAL run harness IS the "I can SEE it run" acceptance (CF-C6-RUNNABLE-HARNESS-1): `docker-compose` (local Postgres+Redis+ClickHouse fixture) + `pnpm dev` (web+gateway) + Expo; the deterministic Sugandh-Lok seed (a fixture pack consumed by the local data-deployable) feeds the REAL data path (registry/`query_metrics`), NOT hand-typed UI numbers — so render-only is actually exercised. The app LAUNCHES: login → workspace → P&L + CM-waterfall + Morning Brief render, every number from the registry, behind the HOLD. Zero legacy code, no live Supabase.

**3 killed-mutant integrity gates (6th verify-the-verifier occurrence; bound in-child under Rohan Stage-6 VETO; NOT self-adopted; pass-1 acceptance — real code + a mutant captured RED):**
- **G-BIGINT** — transmit 9e18 paise (> MAX_SAFE_INTEGER) through the full tRPC stack; client `bigint` byte-identical. Mutant: superjson → bare JSON number ⇒ RED.
- **G-IDEMPOTENT** — same `idempotency_key` twice ⇒ exactly ONE `ai.decision_log` row, 2nd returns cached 200. Mutant: remove the Redis dedup ⇒ two rows ⇒ RED.
- **G-REGISTRY-ONLY** — every KPI tRPC field traces to a `MetricDefinition.id`/`_METRIC_COLUMNS` mapper + static grep finds no arithmetic outside `formatMoney`. Mutant: orphan `rows.reduce` cross-row sum ⇒ traceability + grep RED.
- + 4 companion negative controls (tenancy isolation ws_A→0 ws_B; formatMoney /100-mutant parity; graduated-label all `logged_as_vote`; offline stale-but-labelled).

**Locked contracts/paths/signatures:** `formatMoney(minorUnits:bigint, currencyCode:string, locale?):string` ONE home `packages/lib-metrics/src/money.ts` (subunit-aware, BigInt division, lakh/crore integer thresholds, no-round); idempotency = Redis `ws:<ws>:idem:<key>` TTL24h in front of the EXISTING `_write_decision_log` (`graduation_middleware.py`); auth choke = ONE `TenancyInterceptor` consuming Child-1 `BrainClaim` (`brain-claim.ts`), asserts `request.workspace_id===claim.workspaceId` (its own forward-note) + `requireRole` (`>=` is a mutation target); Redux store = `ui`/`session` slices (NO tokens — mobile tokens in expo-secure-store/memory; server-state=TanStack Query; filters=nuqs; Zustand banned); data plane = `DataPlanePort` gRPC client + handlers in `apps/{analytics,intelligence}-service/src/interfaces/`; seed harness README = Stage-8 deploy artifact.

**Contract amend mechanism (CF-C6-MB-CONTRACT-COMPLETENESS-1) RULED:** Child-6 ADDITIVE amendment (NOT a separate Child-5 loop) — `intelligence.proto` is the FIRST network contract (InsightItem was a Python domain struct only); `recommendation.py` InsightItem gains `expected_impact{revenue_mu:int64,cm2_mu:int64,impact_label}`+`risk`+`confidence_display_pct` additively (frozen-model-safe), **registry-DERIVED deterministic Tier-A (NOT LLM numbers)**. Maya CONSULTS on semantics + the deterministic source.

**ROAS fix (CF-C6-ROAS-DISPLAY-CONTRACT-1):** add additive `scale:10000|100|1` to BOTH registries (`blended_roas_x100`=`scale:100`; display = `value/scale` → "2.50×" not "2.5%"); chosen over flipping `unit:'bp'→'x100'` (Python `MetricUnit` is `Literal["mu","bp","count"]` — no `x100` → flipping risks the byte-identity parity gate). Parity gate asserts `scale` byte-identity.

**Single-Primitive sweep:** CLEAN — ONE formatMoney + ONE idempotency primitive + ONE auth choke + ONE DataPlanePort; Decision Log + Identity reused/extended at the contract; the two protos implement the proto-first non-negotiable, not speculation. **Over-engineering audit: PASS 7/7.** Flagged: `apps/web/package.json` stub says "Next.js 15" — STALE; locked stack is Next 16 (Ananya pins 16; resolve+pin latest-stable, no invented versions). buf plugins REUSE existing pins (es:v2.4.0 + danielgtaylor-betterproto:v1.2.5 — verified-existing).

**Build tracks + builders:** Track V @vikram (BFF/data-seam spine + 3 gates — V0 protos → V1 tRPC+superjson HANDSHAKE → V2 G-BIGINT → V3 TenancyInterceptor+G-REGISTRY-ONLY+G-IDEMPOTENT → V4 data-plane handlers → V5 as_of+status+push-token → V6 formatMoney → V7 scale → V8 InsightItem amend + LOCAL harness + seed + deploy-README) **[CRITICAL PATH]**; Track A @ananya (web, gated on V1); Track K @karan (mobile, gated on V1 + amended InsightItem); Track Maya CONSULT (no build files); Track J @jatin Stage-8 (no new CI/ArgoCD — edge deployable exists; run-harness README + `core.device_tokens` runbook as artifacts). **build_gated_on:** Vikram's V1 handshake (proto + tRPC contract + generated client types); A+K parallel thereafter.

**Maya consult confirmation:** CONFIRMED CONSULT, NOT co-owner (Child 6 renders; metric/AI definitions shipped Child-4/5; the amendment is registry-derived field semantics she confirms, not authors). Have the Agent tool but did NOT spawn her at Stage 2 — inputs folded as acceptance items into V0/V7/V8; orchestrator may spawn her alongside Vikram at Stage 3 if the content-seam semantics need live confirmation before V8.

**HELD for Stage-8 (Jatin):** live deploy + Fargate/MSK/ClickHouse-Cloud provisioning + `core.device_tokens` live DDL + the per-route-group live operator flip (CF-C6-HOLD-AT-ROUTE-FLIP); push SEND OUT — `notifications-service` push SEND is a NAMED 07:15 SLO dependency (a later child). Guardrails affirmed: NO git commit, NO live cutover, plan/handoff artifacts only — no product code this Stage-2 act.

**Next:** @vikram (backend-developer, Track V — CRITICAL PATH) + @ananya (frontend-web-developer, Track A) + @karan (mobile-developer, Track K) — Stage 3, IN PARALLEL (A+K gated on Vikram's V1 handshake).

---

## Stage 3 (Track A — web) — 2026-05-25T10:25:00Z — Ananya (frontend-web-developer)

**Decision:** COMPLETE → ADVANCE (parallel-review)

**Track A deliverables built:**
- Next 16.2.6 pinned (package.json: bumped from stale "Next 15" stub)
- Stack: React 19, tRPC 11 + superjson, TanStack Query 5, Redux Toolkit 2 (ui+session), nuqs 2, Visx 3, Tailwind 4, next-intl 4, no axios, no Zustand
- auth/login + workspace switcher (LoginForm: stub accepts Sugandh-Lok credentials; WorkspaceSwitcher: tRPC workspace.list + workspace.switch)
- Command Center / KPI strip: metrics.kpiSummary → 8 KPI cards (net_revenue, cm2, cm3, roas, orders, aov, rto_rate, conversion_rate)
- P&L / CM Waterfall: Visx Group+Bar+AxisLeft+AxisBottom; 7 steps from metrics.pnlWaterfall; click-to-drill
- Drill-to-source drawer: Redux-driven; metrics.queryRange; accessible (role=dialog, aria-modal, focus trap, Escape)
- as_of binding: StalenessLabel on every card + waterfall; data_epoch from tRPC response
- ROAS display: formatX100(285) → "2.85×" (CF-C6-ROAS-DISPLAY-CONTRACT-1)
- i18n seam: messages/en.json strings externalized; no translations/RTL (Phase-4)
- Error surfaces: ErrorDisplay component with request_id (CF-SEC-5)
- 35 tests: incl. bigint-coercion negative test, PII-no-log negative test, bigint-in-Redux negative test, Goal RAG band tests

**formatMoney: ONLY money formatter** — every _mu display routes through `formatMoney(bigint, currencyCode)` from `@brain/lib-metrics`. Zero local reimpls. Zero ÷100 on bigint. Grep confirmed.

**CF-C6-BIGINT-JSON-1:** superjson on httpBatchLink; bigint test proves >MAX_SAFE_INTEGER displays correctly via formatMoney and NOT via Number() coercion.

**Test results:** `35 passed, 0 failed` (npx vitest run --reporter=verbose)
**TypeScript:** `npx tsc --noEmit` → exit 0

**Handoff:** ADVANCE → parallel-review → Shreya (security-reviewer) || Tanvi (qa-agent)

## Stage 3 (BOUNCE-FIX round 2) — 2026-05-25T10:55:00Z — Vikram (backend-developer)

**B1 fixed (VETO CF-C6-RUNNABLE-HARNESS-1):** Created `apps/api-gateway/src/interfaces/server.ts` — the missing Fastify + tRPC server bootstrap. `pnpm dev` (`tsx src/interfaces/server.ts`) now boots to :3001. Real-network smoke: `curl http://localhost:3001/health` → `{status:ok}`; GET `/trpc/metrics.kpiSummary` → `net_revenue_mu=185000000` (₹18.5L), `cm2_mu=32000000` (₹3.2L). superjson meta confirms bigint fields. Server bootstrap test suite: 4 tests (health + seed kpiSummary + seed morningBrief.get + tenancy consistency).

**H1 fixed (SEC-C6-H1 HIGH CF-SEC-5):** `apps/api-gateway/src/application/trpc.ts:50` — `errorFormatter({ shape, ctx })` now uses `ctx?.requestId ?? undefined` (the correlation id) instead of `shape.data?.path` (the procedure name). Added 6 killed-mutant tests in `trpc.errorformatter.test.ts`: REAL emits the correlation id; MUTANT shows procedure path differs from correlation id; REAL vs MUTANT diverge; production wiring via createBrainRouter; null ctx safe.

**TenancyInterceptor disposition (SEC-C6-M1):** `assertWorkspaceClaim` / `assertRequiredRole` / `buildGrpcMetadata` in `tenancy.ts` remain exported-but-unrouted in server.ts. Rationale: `workspaceMiddleware` in `trpc.ts` already asserts `workspaceId === claim.workspaceId` on every workspace-tier procedure before any data-plane call — that IS the real enforcement choke point. Adding assertWorkspaceClaim in server.ts would duplicate the same check. `buildGrpcMetadata` is the Phase-2 wire into RemoteDataPlane. Both dispositions documented in `HARNESS.md` and `server.ts` header comments.

**M2/M3 documented:** `HARNESS.md` added — gRPC boundary correlation (Phase-2 wiring requirements) and Visx `Number(_mu)` pixel-math invariant (< 2^53 safe, display unaffected, clamp recipe provided).

**Test counts:** api-gateway 32/32 (22 gates unchanged + 6 H1 + 4 bootstrap); lib-metrics 126/126.
**tsc:** exit 0 (api-gateway, pre and post).
**Gate logic:** NOT modified. B1+H1 are additive (new file + 1-line fix).

**Handoff:** ADVANCE → round-2 parallel-review → Shreya (security-reviewer) ∥ Tanvi (qa-agent)

## Stage 3 (BOUNCE-FIX round 2) — 2026-05-25T10:45:00Z — Ananya (frontend-web-developer)

**B2 fixed (VETO TS1005):** `kpi-strip.tsx` — JSX block comment `{/* ... */}` relocated above the `<KpiCard>` element (was between attribute-value pairs — invalid TSX syntax). Secondary fix: `cm-waterfall-chart.tsx` Visx `Tooltip` aliased as `VisxTooltip` then cast as `React.FC<ComponentProps<typeof VisxTooltip>>` at import site to resolve TS2786 (React 19 / @types/react@18 peer-dep conflict). `tsc --noEmit` exits 0.

**H1 web fix confirmed:** all three error surfaces (`kpi-strip.tsx:52`, `pnl-waterfall-panel.tsx:49`, `drill-drawer.tsx:115`) bind via `(error as { data?: { requestId?: string } }).data?.requestId` — correct. Added `error-display-request-id.test.tsx` (7 tests): ErrorDisplay with UUID, without requestId, procedure-path mutant, real-path post-fix, binding contract positive + negative.

**L1 fixed:** `login-form.tsx` stub auth path and on-screen credential hint gated behind `IS_LOCAL_HARNESS = process.env.NEXT_PUBLIC_BRAIN_LOCAL_HARNESS === 'true'`. Invisible in production.

**M3 documented:** `CF-C6-BIGINT-PIXEL-INVARIANT` comment added in `cm-waterfall-chart.tsx` above `cumulativePx`/`valuePx` pixel-math lines.

**Test counts:** web 42/42 (35 original + 7 H1 error-surface); tsc exit 0.

---

## Stage 5 QA (Round 2) — 2026-05-25T11:00:00Z — Tanvi (qa-agent)

**Verdict:** PASS

**All blocking vetoes resolved and independently verified:**
- B1 (CF-C6-RUNNABLE-HARNESS-1): server.ts exists, boots, serves /health + kpiSummary with Sugandh-Lok seed. Real URL smoke output captured. Founder launch command documented.
- B2 (TS1005 web build): tsc --noEmit exits 0. JSX comment fix + Visx Tooltip cast confirmed.
- H1 (CF-SEC-5 errorFormatter): ctx.requestId confirmed in trpc.ts; 6 killed-mutant tests + 7 web binding tests green.

**543 tests across 5 packages (32 + 126 + 42 + 52 + 291). 3× stable. 0 failures. 0 regressions.**

Parity gate exit 0. Metric registry TS↔Python 25 vectors byte-identical. Scale field intact. Children 2/3/4/5 unaffected.

Parallel review mode: returning QA: PASS verdict to orchestrator. Not advancing.

## Stage 6 — 2026-05-25T11:10:00Z — Rohan (cto-advisor) — FINAL REVIEW PASS (Founder gate signed, delegated)

**Verdict:** PASS · **Recommendation:** APPROVE-WITH-CAVEATS · **Round:** 2 (round-1 bounced on SEC H1 + QA B1/B2; Shreya 09b + Tanvi 10b both PASS).

**Independent re-verification (Rohan re-ran, captured):**
- 543 tests green (32 api-gateway + 126 lib-metrics + 42 web + 52 mobile + 291 brain_metrics); tsc exit 0 (web + gateway); Child-4 parity gate `tools/check-metrics-parity.sh` exit 0 (scale field intact, 2 killed mutants detected).
- **Runnable-app acceptance (Founder's goal):** I booted `apps/api-gateway/src/interfaces/server.ts` myself → `/health` ok → `metrics.kpiSummary` = net_revenue_mu "185000000" (₹18.5L) + cm2_mu "32000000" (₹3.2L) + blended_roas_x100 285 + total_orders "1247", superjson `["bigint"]` meta, live request_id UUID (per-request). Launch: `cd apps/api-gateway && pnpm dev` + `cd apps/web && pnpm dev` → http://localhost:3000/login (founder@sugandhlok.com / brain-local-dev).
- **3 integrity gates mutated by me → RED:** G-BIGINT (remove superjson → live wire contract breaks), G-REGISTRY-ONLY (disable throw → orphan test fails), G-IDEMPOTENT (disable dedup → double-write fails). All reverted byte-identical.
- **H1:** production errorFormatter reads `ctx.requestId` (direct read + live success UUID). Error-path client-body `data.requestId` absent on the Zod path → SEC-C6-L2 (LOW); correlation id still logged with real UUID. NOTE: the H1 killed-mutant test asserts a replica, not the live closure.

**Plan-binding:** 6a runnable vertical (6b HELD); CF-C6-HOLD-AT-ROUTE-FLIP (LOCAL-only, single workspace, zero live cutover, header-trust dev-only behind HOLD); tRPC/Redux (no axios/Zustand); render-only (no UI arithmetic, formatMoney only, LLMs never produce a number); money bigint end-to-end; no Child-7 scope (push SEND OUT); legacy untouched. Single-Primitive clean. Over-eng PASS.

**HELD for Stage-8 cutover:** production JWT-verify + membership lookup (replaces header-trust); live route-flip; real cert-pin hashes; notifications-service push SEND (07:15 SLO, later child); core.device_tokens live DDL; M1 buildGrpcMetadata + M2 gRPC trace; Fargate/MSK/ClickHouse-Cloud; 6b long-tail.

**Founder gate:** SIGNED under standing delegation (no hard-rule deviation, 11-final-review §9). **NO commit** — mechanical Child-6 paths in pending-founder-commit.md (no `git add -A`; 2 stray files flagged for exclusion). **Next:** Jatin Stage-8 readiness (readiness-only).

**Artifacts:** 11-final-review.md · 14-retro.md · 12-founder-decision.json · pending-founder-commit.md.
