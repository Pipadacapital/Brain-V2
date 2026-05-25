# Stage 1 Synthesis — Child 6 (`feat-frontend-dashboard-morningbrief`)

> Rohan (cto-advisor), post-persona synthesis. Reached after the orchestrator spawned both
> requested personas (`03-persona-dashboard-number-fidelity-realist.md` +
> `04-persona-mobile-morning-brief-perf-a11y-realist.md`) and re-invoked me. This folds the
> persona findings into the binding CF-C6-* constraint set, rules the one escalation, and
> finalizes the Stage-1 decision into Stage 2.

| Field | Value |
|-------|-------|
| **req_id** | `feat-frontend-dashboard-morningbrief` |
| **Stage** | 1 — synthesis |
| **Timestamp** | 2026-05-25T07:10:00Z |
| **Decision** | **ADVANCE** (synthesis complete) → Stage 2 (Architect) |
| **Personas** | 2 (both PASS the quality gate) |
| **Escalation to Founder** | **none** (the contract-amend is an internal Stage-2 ruling) |

---

## 1. Persona quality gate — both PASS

| Persona | Verdict | Concerns | Quality-gate result |
|---------|---------|----------|---------------------|
| `dashboard-number-fidelity-realist:sonnet` | **PASS** | 1 CRITICAL + 2 HIGH + 2 MEDIUM + 1 LOW (6 total) | Not a "looks good" pass. Every concern grounded in files read on disk (`query_gateway.py`, `definitions.ts/.py`, `money.ts`, `validator.py`, `client.py`, `recommendation.py`, the bare gateway/web/mobile scaffolds). Found a real latent bug — the `blended_roas_x100` `unit:'bp'` vs ×100-scale tag divergence — beyond the brief. |
| `mobile-morning-brief-perf-a11y-realist:sonnet` | **PASS** | 1 CRITICAL + 3 HIGH + 2 MEDIUM (6 total) | Not a "looks good" pass. Grounded in the committed `InsightItem`/`TypedRecommendation` struct, `graduation_middleware.py`, `multi-tenancy.md` idempotency primitive, `decision-log.md`. Correctly escalated ONE concern (contract incompleteness) to my synthesis rather than guessing. |

**The convergence is the headline.** Both personas, attacking from orthogonal angles (web number-fidelity vs mobile product/SLO), independently named **a BFF / contract-integrity issue at the not-yet-built gateway seam as their single highest risk**:
- number-fidelity's #1 path: the BFF month-sum via JS-number `reduce` (unregistered + BigInt-truncating + faithfulness-blind).
- morning-brief's #1 path: the approve/reject/edit double-write to the append-only Decision Log (no idempotency contract at the tRPC procedure).

Both reduce to the same root: **the api-gateway BFF is build-from-zero, and the integrity contracts that protect money-faithfulness and the moat must be specified at the proc layer BEFORE any card or mutation is written** — not discovered at Stage-5 QA. This is exactly the Shape-B "figure-it-out-during-build" trap that bit Child 1, now wearing a BFF hat. It hard-confirms my intake call that **CF-C6-DATA-SEAM-1 is THE Stage-2 must-decide** and that **Vikram is REQUIRED, not optional** — the spine is backend work and it owns the integrity gates.

**Accept/reject each concern:**

| # | number-fidelity concern | Sev | Disposition |
|---|---|---|---|
| 1 | BigInt→JSON-number truncation > 2^53 (~₹90cr paise); `blended_roas_x100` trailing float `/10000` | CRITICAL | **ACCEPT** → CF-C6-BIGINT-JSON-1 |
| 2 | No canonical `formatMoney` anywhere; two divergent impls if web+mobile each roll their own | HIGH | **ACCEPT** → CF-C6-FORMATMONEY-CANONICAL-1 |
| 3 | 6h insight cache vs fresh KPI → contradictory-but-both-"faithful" numbers on screen | HIGH | **ACCEPT** — folds into + sharpens CF-C6-FAITHFULNESS-RENDER-1 (the `as_of` mechanism) |
| 4 | `blended_roas_x100` unit=`bp` but ×100 scale → wrong "2.5%" vs "2.5×" render | MEDIUM | **ACCEPT** → CF-C6-ROAS-DISPLAY-CONTRACT-1 |
| 5 | No registry-traceability guard on BFF response fields (orphan-number anti-pattern) | MEDIUM | **ACCEPT** → CF-C6-REGISTRY-ONLY-BFF-1 |
| 6 | `InsightItem.confidence:float` raw → compute-in-UI pattern spreads | LOW | **ACCEPT** → CF-C6-NO-UI-FLOAT-1 |

| # | morning-brief concern | Sev | Disposition |
|---|---|---|---|
| 1 | approve/reject/edit double-write to append-only Decision Log — no idempotency contract at tRPC layer | CRITICAL | **ACCEPT** → CF-C6-MB-IDEMPOTENCY-1 (sharpens CF-C6-MB-DECISION-LOG-1) |
| 2 | Approve button misleads: "logged as vote" vs "queued for execution" indistinguishable on a non-graduated action | HIGH | **ACCEPT** → CF-C6-MB-GRADUATED-LABEL-1 |
| 3 | `InsightItem` proto missing `expected_impact{revenue_mu,cm2_mu}` + `risk` — UI blanks or computes on-device | HIGH (ESCALATE) | **ACCEPT + RULED** → CF-C6-MB-CONTRACT-COMPLETENESS-1 (see §3) |
| 4 | Offline degradation undefined; no device-side SLO metric | HIGH | **ACCEPT** → CF-C6-MB-OFFLINE-SLO-1 |
| 5 | a11y: `rationale` placement primes screen-reader users toward Approve; touch targets unbound | MEDIUM | **ACCEPT** → CF-C6-MB-A11Y-ACTION-1 |
| 6 | push send vs token-registration scope ambiguity; token rotation unspecified | MEDIUM | **ACCEPT** → CF-C6-MB-PUSH-TOKEN-1 (resolves my armed-not-fired item) |

**No concern rejected.** Every one is grounded and actionable. Severities accepted as the personas tiered them.

---

## 2. Full CF-C6-* constraint set (intake + folded), with OWNERS

> **Owner legend:** **Vikram** = api-gateway tRPC BFF + auth/tenancy choke point + the gateway↔data-plane read surface (the 6a spine). **Ananya** = `apps/web`. **Karan** = `apps/mobile`. **lib-metrics** = whoever owns `packages/lib-metrics` (Vikram primary; Maya consult on the registry-display contract). **Aryan** = Stage-2 binding decision. **Maya (consult)** = Morning-Brief content contract + the registry-display semantics. **Shreya/Tanvi** = VETO gates. **Rohan** = Stage-6 audit.

### Carried from intake (unchanged)

| CF | Sev | Constraint | Owner |
|----|-----|-----------|-------|
| CF-C6-SCOPE-SPLIT-1 | — | 6a runnable-vertical / 6b long tail; collapsible at Stage 2 w/ one-line rationale; runnable-app goal makes the split load-bearing (expect held) | Aryan |
| CF-C6-RENDER-ONLY-1 | CRITICAL | UI NEVER computes/rounds/restates a metric; zero arithmetic in web/mobile/gateway-read; money = `formatMoney(MU, currency_code)` at the edge only | Ananya + Karan + Vikram (BFF) |
| CF-C6-GATEWAY-TENANCY-1 | CRITICAL | `workspace_id` flows JWT→gateway→data-plane on EVERY read; `requireRole` on every workspace procedure; gateway is the auth/tenancy choke point (Child-1 `brain-claim`) | Vikram |
| CF-C6-FAITHFULNESS-RENDER-1 | HIGH | UI renders the SAME registry value the Child-5 narration was validated against; no independent re-fetch/cache that drifts the displayed number from the narrated number. **Sharpened by CF-C6-AS-OF-STAMP-1 below.** | Vikram (transport) + Ananya/Karan (binding) |
| CF-C6-DRILL-TO-SOURCE-1 | HIGH | Every KPI drills to source rows; ≥1 drawer proven in 6a | Ananya (web drawer) + Vikram (provenance in BFF) |
| CF-C6-MB-DECISION-LOG-1 | HIGH | Mobile approve/reject/edit is a Brain action: writes the Decision Log through the gateway w/ tenancy + RBAC + idempotency; `rationale` render-only/never echoed as instruction; action enum closed (Child-5 `TypedRecommendation`). **Sharpened by CF-C6-MB-IDEMPOTENCY-1.** | Vikram (proc) + Karan (client) |
| CF-C6-DATA-SEAM-1 | CRITICAL | gateway↔Python-data-plane mechanism: in-process `data`-deployable call vs thin gRPC handler+proto; **no "figure it out during build"** (Shape-B trap); chosen contract must make the later service split mechanical (proto-first if gRPC). **THE Stage-2 must-decide.** | **Aryan (decides)** → Vikram (builds) |
| CF-C6-RUNNABLE-HARNESS-1 | HIGH | LOCAL runnable + deterministic **Sugandh-Lok** seed feeding the REAL data path (not hand-typed UI numbers); zero legacy code, no live Supabase; defines "I can see it run" | Vikram (harness/seed wiring) + Aryan (seed home) |
| CF-C6-NEW-LAYER-1 | — | axios→tRPC + Zustand→Redux Toolkit BOUND (locked stack); any axios/Zustand in Brain client = drift bounce | Ananya + Karan |
| CF-C6-PERF-A11Y-1 | HIGH | web LCP<2s/INP<200ms/CLS<0.1/route-JS<100KB + WCAG AA; mobile MB = highest-quality surface; Magic UI scoped to login/onboarding/empty-state ONLY | Ananya (web) + Karan (mobile) |
| CF-C6-I18N-SEAM-1 | — | strings externalized (next-intl); Arabic/RTL = Phase-4 adapter flip; no translations/RTL built now | Ananya + Karan |
| CF-C6-PII-CLIENT-1 | HIGH | no PII in client logs/Sentry; mobile refresh token in `expo-secure-store`, access in memory; cert pinning + MASVS L1 | Karan (mobile) + Ananya (web logs) |
| CF-C6-HOLD-AT-ROUTE-FLIP | hold | facade serves legacy frontend; per-route-group live flip HELD to Stage-8/Child-7; render against seeded data; ZERO live operator cutover | Aryan (named hold) |

### Folded from personas (new / sharpening)

| CF | Sev | Constraint | Owner |
|----|-----|-----------|-------|
| **CF-C6-BIGINT-JSON-1** | **CRITICAL** | The BFF MUST serialize all `_mu` (money) and `_bp` (basis-points) fields as **JSON strings or via a BigInt-safe transformer (superjson)** — NEVER as bare JSON numbers; the tRPC client deserializes them as `bigint`. Audited before any `formatMoney` call exists to receive a value. Also: confirm no UI component re-rounds `blended_roas_x100`'s trailing float differently from the canonical integer. | **Vikram** (transport) + Aryan (binds in the tRPC contract) |
| **CF-C6-FORMATMONEY-CANONICAL-1** | **HIGH** | ONE `formatMoney(minorUnits: bigint, currencyCode: string, locale?): string` lands in **`packages/lib-metrics`** BEFORE any KPI card: (1) reads `subunitMultiplier(currencyCode)`, never hardcodes 100; (2) BigInt integer division, never `Number()` before dividing; (3) lakh/crore grouping as an integer threshold (`>=10_000_000`→crore, `>=100_000`→lakh); (4) never rounds — formats the registry integer, does not mutate it. Web + mobile both import it; **zero local reimpls**. | **lib-metrics owner (Vikram primary; Maya consult on registry-display semantics)**; consumed by Ananya + Karan |
| **CF-C6-AS-OF-STAMP-1** | **HIGH** *(sharpens CF-C6-FAITHFULNESS-RENDER-1)* | The gateway insight response carries `as_of` / `data_epoch` (the ClickHouse snapshot the signals were computed from); the BFF propagates it; the UI either (a) fetches KPI cards for the SAME `as_of` epoch as the insight, or (b) shows a staleness indicator when the card's epoch differs beyond a threshold. Stops the cache-vs-fresh "both correct, contradictory on screen" path. | **Vikram** (transport + epoch in contract) + Aryan (binds epoch through tRPC) + Ananya/Karan (bind card to epoch) |
| **CF-C6-ROAS-DISPLAY-CONTRACT-1** | **MEDIUM** | Fix the `blended_roas_x100` divergence: add a `scale` field to `MetricDefinition` (`10000 \| 100 \| 1`) so the display layer reads scale instead of branching on metric-ID strings, OR change the unit tag from `'bp'` to the existing `'x100'` (+ add `'x100'` to the Python `MetricUnit`). Display path is `value/100`, not `/10000`. | **Maya (consult — registry display contract)** + Vikram (lib-metrics edit) + Ananya (web render) |
| **CF-C6-REGISTRY-ONLY-BFF-1** | **MEDIUM** | Every KPI field in a tRPC response carries its `definition_id` from the registry, or is produced by a typed `MetricRow→response` mapper accepting ONLY columns in the canonical `_METRIC_COLUMNS`. The BFF introduces NO field untraceable to a `MetricDefinition.id`. **No ad-hoc cross-row aggregation in the BFF** — any cross-row sum must be a NAMED registry metric obtained via `query_metrics`, never a JS `reduce`. Stage-6 audit greps `apps/api-gateway/src` for arithmetic outside the `formatMoney` path. | **Vikram** |
| **CF-C6-NO-UI-FLOAT-1** | **LOW** | Display-only floats (`InsightItem.confidence`) arrive **pre-formatted server-side** — `confidence_display_pct: int` (e.g. 87) or a formatted string — so the UI renders without arithmetic. Establishes "even display-only numbers arrive pre-formatted." | Vikram (BFF/contract) + Maya (consult — confidence field shape) |
| **CF-C6-MB-IDEMPOTENCY-1** | **CRITICAL** *(sharpens CF-C6-MB-DECISION-LOG-1)* | `morningBrief.submitResponse` MUST: (a) require a caller-generated `idempotency_key: UUID` in the input; (b) check Redis `ws:<workspace_id>:idem:<key>` (TTL 24h) before writing `ai.decision_log`; if present, return the cached response (200, not 409) — client shows no error; (c) the mobile client generates the key at action-initiation (not send-time) and persists it until a non-error response, so offline-queue replay reuses it. Append-only log — a double-write cannot be deleted post-write. | **Vikram** (proc + Redis dedup) + Karan (client key lifecycle) |
| **CF-C6-MB-GRADUATED-LABEL-1** | **HIGH** | The proc response carries `{ decision_log_row_id, status: "queued_for_execution" \| "logged_as_vote" }`, server-driven (client never infers graduation state). On `logged_as_vote`: a labelled state ("approval logged; will queue once Brain confirms it's safe to auto-run") — NOT a success checkmark, NOT an error. Day-1 ALL actions are recommendation-only ⇒ all taps are `logged_as_vote`; button reads "Log approval"/"Support this action", not "Approve & Execute". | Vikram (status in response) + **Karan** (label/state) |
| **CF-C6-MB-CONTRACT-COMPLETENESS-1** | **HIGH** *(the ruled escalation — §3)* | `InsightItem`/proto MUST carry `expected_impact { revenue_mu: int64, cm2_mu: int64, impact_label: str }` + `risk` as **registry-DERIVED deterministic (Tier-A) fields — NOT LLM-produced numbers**; proto `intelligence/v1/insight.proto` updated (the proto is the contract source); the mobile client renders them verbatim and formats the `_mu` via `formatMoney`. Any impact shown but absent from the server struct = Stage-5 BOUNCE. | **Aryan (rules amend-vs-scope)** + **Maya (consult — the impact/risk field semantics, registry-derived)** + Vikram (proto/contract) + Karan (render) |
| **CF-C6-MB-OFFLINE-SLO-1** | **HIGH** | (a) STALE-BUT-LABELED Phase-1 posture: on fetch failure, show the last successfully-fetched Brief with a visible freshness label ("Showing Brief from <time>. You may be offline.") — blank/opaque-error in the 07:00–09:00 IST window is a P1; (b) the cached Brief is read-only — CTAs disabled with a tooltip (mutation needs a live connection for server-side idempotency); (c) device-side OTel `morning_brief.render_success_latency_ms{workspace_id}` so the 07:20 SLO is measured from the device, not just push-delivery. | **Karan** (offline UX + metric) + Vikram (`as_of` for staleness) |
| **CF-C6-MB-A11Y-ACTION-1** | **MEDIUM** | Approve/Reject/Edit targets ≥48dp/44pt, ≥8dp spacing, placed at card BOTTOM (thumb arc). Each CTA `accessibilityRole="button"` + a distinct `accessibilityLabel` (action + consequence) that does NOT include `rationale`. `rationale` is its own `accessibilityRole="text"` element separated from the button group (no screen-reader instruction-priming). WCAG AA contrast (4.5:1 text, 3:1 UI) audited on Tamagui tokens (destructive-red Reject especially). | **Karan** |
| **CF-C6-MB-PUSH-TOKEN-1** | **MEDIUM** *(resolves the intake armed-not-fired item)* | **Push SEND (the 07:15 dispatch) is OUT of scope — confirmed at synthesis, Aryan to ratify.** Child 6 delivers ONLY `registerPushToken` (workspace-scoped, stored `core.device_tokens` w/ RLS, idempotent upsert on `(workspace_id,user_id,device_id)`, handles Expo token rotation on foreground) + the deep-link handler (opens the Brief on push tap, silent re-auth via `expo-secure-store` refresh token). The `notifications-service` push SEND is a NAMED dependency for the 07:15 SLO — Child 6 cannot meet the SLO alone. | Vikram (`registerPushToken` proc + table) + **Karan** (token lifecycle + deep-link) |

### Inherited (unchanged)
CF-BN-NOLEGACY-1 (never edit legacy; reference-only) · CF-RES-1 (ap-south-1 read path) · Child-1 auth/RLS gate (SATISFIABLE for seeded/shadow render) · Child-2 MU money representation · Child-4 query-gateway read discipline · Child-5 `InsightItem`/faithfulness contract.

---

## 3. RULING on the one escalation (morning-brief Concern 3 — `InsightItem` contract incompleteness)

**The persona correctly routed this to my synthesis (not to the Founder), and I rule it here. No Founder escalation: this is an internal Stage-2 architecture-amendment decision, not a compliance/legal/moat/irreversible question.**

**Decision: AMEND the Child-5 contract — do NOT scope the card down.**

**Rationale (precise):**
1. **The fields are canon, not nice-to-have.** The Morning-Brief canon (business-context §7, requirement §In-scope) mandates each action card show problem / evidence / recommended-action / **expected-impact (revenue + CM2)** / **risk** / confidence. `expected_impact(revenue_mu, cm2_mu)` and `risk` are load-bearing for the product promise — "every recommendation carries expected revenue + CM2 impact." A scoped-down card that drops impact/risk leaves the operator with no quantitative basis to approve, which guts the feature. Scoping down trades a one-time contract amendment for permanently amputating the headline surface. Not acceptable.
2. **The "compute it on device" alternative is a hard violation.** If the contract isn't amended, Karan's only path to show impact is to compute it client-side — a direct breach of CF-C6-RENDER-ONLY-1 and the iron rule (LLMs/UI never produce a number). So scope-down doesn't even cleanly avoid the problem; it pushes it into a worse one.
3. **The amendment is cheap and safe BECAUSE of HOW we add the fields.** The fields are **registry-DERIVED deterministic (Tier-A) values — NOT LLM/narration outputs.** `expected_impact.revenue_mu` / `cm2_mu` come from the metric/signal layer (the same deterministic source the faithfulness validator already trusts), as BIGINT minor-units, formatted at the edge via `formatMoney`. `risk` is a derived classification/enum, not free-text persuasion. This keeps the iron rule intact: the number is born deterministic upstream, validated upstream, rendered verbatim downstream. The narration model never produces these numbers.

**Precise binding (CF-C6-MB-CONTRACT-COMPLETENESS-1):**
- The amendment lands in the **Child-5 domain contract + `proto/intelligence/v1/insight.proto`** (the proto is the source of truth the mobile client is generated from). `InsightItem` gains `expected_impact { revenue_mu: int64, cm2_mu: int64, impact_label: string }` and `risk` (enum/string).
- These are **populated from the Tier-A registry/signal layer**, NOT from the narration LLM. This is **Maya's consult seam** — she confirms the field semantics + the deterministic source (it is her Child-5 lane). Aryan rules at Stage 2 whether the proto extension is executed as a Child-6 amendment to the committed Child-5 contract or routed through a formal Child-5 amendment loop; either is acceptable, but **the ruling (amend, not scope-down) is fixed here** and the build cannot start the MB card until the contract carries these fields.
- Subject to CF-C6-BIGINT-JSON-1 (the `_mu` fields cross the JSON seam as strings/bigint) and CF-C6-RENDER-ONLY-1 (rendered verbatim, never computed on device). Stage-5: any `expected_impact` displayed but absent from the server-delivered `InsightItem` = BOUNCE.

This gives Maya the consult seam to confirm the impact/risk source while keeping the contract whole — the right trade for the canon's primary product surface.

---

## 4. Confirmations (unchanged from intake, re-affirmed post-persona)

- **6a / 6b split — HELD.** The runnable-app goal makes the split load-bearing; dangerous-first ordering (the auth/tenancy/money/contract spine is the risky unit and ships first; the long tail is mechanical repetition behind a proven primitive). ONE requirement, not two `/requirements`. Collapsible at Stage 2 only with a one-line rationale (burden on collapsing — expect held).
- **Runnable harness + Sugandh-Lok seed — IN 6a.** Local dev harness (docker-compose PG/ClickHouse fixtures + `pnpm dev` web + Expo run) + deterministic Sugandh-Lok seed feeding the REAL data path (registry/query-gateway), not hand-typed UI numbers — so the render-only invariant is actually exercised. Live/staging deploy + provisioning + ArgoCD = Jatin / Stage-8. Zero legacy code, no live Supabase; Aryan rules the seed home.
- **New-layer BOUND.** axios→tRPC + Zustand→Redux Toolkit (locked stack); any axios/Zustand in Brain client = drift bounce. No tech-stack-evaluation needed.
- **Builders:** **Ananya** (`apps/web` 6a surfaces) + **Karan** (`apps/mobile` MB core + push-token/deep-link) + **Vikram** (api-gateway tRPC BFF + auth/tenancy choke point + the data-plane read surface — the 6a spine; REQUIRED, both personas' top risk lives in his layer). Parallel at Stage 3, but Vikram's BFF + the integrity gates gate what Ananya/Karan have to render against.
- **Maya — CONSULT (not co-owner).** Her seams, now firmer post-persona: (1) the Morning-Brief content contract — `rationale` render-only, action enum closed, the approve/reject/edit payload matches the Child-5 Decision-Log write path; (2) **the CF-C6-MB-CONTRACT-COMPLETENESS-1 amendment** — confirm `expected_impact`/`risk` field semantics + their registry-derived deterministic source; (3) the registry-display semantics behind CF-C6-ROAS-DISPLAY-CONTRACT-1 / CF-C6-NO-UI-FLOAT-1. Aryan may upgrade her to co-owner at Stage 2 with a one-line rationale if the content seam proves load-bearing; default remains consult.
- **CF-C6-DATA-SEAM-1 = THE Stage-2 must-decide.** Both personas independently confirm it: the integrity of money-faithfulness (number-fidelity) AND the moat (morning-brief idempotency) both live at the not-yet-built BFF seam. In-process `data`-deployable call vs thin gRPC handler+proto — Aryan binds it; no "figure it out during build."
- **Escalation to Founder — none.** The contract-amend is an internal Stage-2 ruling (§3). The Founder gate at Stage 7 (delegated to me) is the correct ratification point. The intake armed-not-fired item (push-send scope) is now resolved as a constraint (CF-C6-MB-PUSH-TOKEN-1: send OUT, token registration IN).

---

## 5. The three integrity gates — bound as verify-the-verifier / killed-mutant tests

These three are the **faithfulness-at-render + moat-integrity lineage gates**. Each must be a REAL-path integration test with a **killed mutant** (a deliberately-broken variant the gate catches RED), specified at Stage 2, built at Stage 3, captured-with-output at Stage 5, and independently re-run by me at Stage 6. A "test exists" that passes against a broken implementation is not a gate (the verify-the-verifier recurrence — now 5 prior occurrences across Children 1–4).

| Gate | Real-path test | Killed mutant (must go RED) | Owner |
|------|----------------|------------------------------|-------|
| **G-BIGINT** (CF-C6-BIGINT-JSON-1) | Transmit a money value `> Number.MAX_SAFE_INTEGER` (e.g. 9_000_000_000_000_000_000 paise) through the FULL tRPC stack; assert the client-received `bigint` is byte-identical to the sent value. | Switch the BFF serializer to a bare JSON number (drop the string/superjson transform) → the round-trip assertion goes RED (precision lost). | Vikram (build) + Tanvi (capture) + Rohan (re-run) |
| **G-IDEMPOTENT** (CF-C6-MB-IDEMPOTENCY-1) | Submit the same approve payload twice with the SAME `idempotency_key` → assert exactly ONE `ai.decision_log` row; the second call returns the cached first response (200). | Remove the Redis dedup check before the write → double-submit produces TWO Decision-Log rows → the single-row assertion goes RED. | Vikram (build) + Tanvi (capture) + Rohan (re-run) |
| **G-REGISTRY-ONLY** (CF-C6-REGISTRY-ONLY-BFF-1 + CF-C6-RENDER-ONLY-1) | Assert every field in each KPI tRPC response traces to a `MetricDefinition.id` (or a typed `_METRIC_COLUMNS` mapper); a static grep proves no arithmetic in `apps/api-gateway/src` / `apps/web` / `apps/mobile` outside the `formatMoney` path. | Inject an orphan BFF field (`rows.reduce((s,r)=>s+r.cm2_mu,0)` — unregistered cross-row sum) → the traceability assertion + the arithmetic grep both go RED. | Vikram (build) + Tanvi (capture) + Rohan (re-run) |

Companion proofs Stage-5 must also capture (not killed-mutant but real negative controls): CF-C6-GATEWAY-TENANCY-1 (ws_A request returns ZERO ws_B rows; unscoped/role-insufficient rejected fail-closed) · CF-C6-FORMATMONEY-CANONICAL-1 (a `/100`-hardcoded `formatMoney` mutant fails parity vs the registry value) · CF-C6-MB-GRADUATED-LABEL-1 (non-graduated Brief → all CTAs show `logged_as_vote`, zero executor calls, N `recommendation` rows) · CF-C6-MB-OFFLINE-SLO-1 (airplane-mode → stale labelled Brief, CTAs disabled).

**Note (human-gated, not self-adopted):** this is the **6th occurrence** of the verify-the-verifier-mutation-on-gate pattern (Children 1/2/3/4 + the auth-RLS hardening run). It is bound for THIS child under my Stage-6 VETO authority. The standing rule-proposal remains awaiting `/adopt-rule` — I do NOT self-adopt. (The auto-candidate-rule machinery is a Stage-6 step; recorded here for continuity, the ≥3-occurrence threshold is long met but the proposal already exists.)

---

## 6. Decision

**ADVANCE → Stage 2 (Architect, Aryan).** Both personas passed, both converged on the BFF/contract-integrity seam, every concern folded with an owner, the one escalation ruled (amend the Child-5 contract with registry-derived deterministic fields), no Founder escalation. Sound, business-aligned (the visible product surface the Founder explicitly wants), dependency-satisfiable for the BUILD, and now precisely planable.

---

## 7. What Stage 2 needs from Aryan (+ Vikram / Ananya / Karan / Maya-consult)

**Aryan must decide / bind:**
1. **CF-C6-DATA-SEAM-1 (THE must-decide):** in-process `data`-deployable call vs thin gRPC handler+proto. Drives whether `MetricsService`/`IntelligenceService` protos are authored this child. The contract must make the later service split mechanical. No "figure it out during build."
2. **The `as_of`/`data_epoch` flow** through the tRPC contract (CF-C6-AS-OF-STAMP-1) — how the insight epoch + KPI-card epoch are bound to the same snapshot.
3. **CF-C6-MB-CONTRACT-COMPLETENESS-1 execution path:** Child-6 amendment to the committed Child-5 contract vs a formal Child-5 amendment loop — the *ruling* (amend, registry-derived) is fixed; Aryan picks the mechanism. Proto + domain contract gain `expected_impact{revenue_mu,cm2_mu,impact_label}` + `risk`.
4. **6a/6b collapse-vs-split** confirmation (expect held).
5. **Seed-harness home** — fixture pack consumed by the local data-deployable; zero-legacy / no-live-Supabase guardrail.
6. **Ratify push-send OUT / token-registration IN** (CF-C6-MB-PUSH-TOKEN-1) + the `notifications-service` SEND as a named SLO dependency.
7. **Confirm the three integrity gates** (§5) as real-path + killed-mutant in the plan, and the four companion negative controls.
8. **The over-engineering + Single-Primitive sweep** — one `formatMoney` in lib-metrics (not two), one idempotency primitive (the cross-cutting `idempotency_key`), one auth choke point.

**Vikram (the 6a spine):** the api-gateway tRPC BFF + auth/tenancy choke point (Child-1 `brain-claim` + `requireRole`) + the data-plane read surface; the BigInt-safe transport (CF-C6-BIGINT-JSON-1); the `morningBrief.submitResponse` idempotent mutation (CF-C6-MB-IDEMPOTENCY-1); the registry-traceability mapper (CF-C6-REGISTRY-ONLY-BFF-1); `registerPushToken`; the canonical `formatMoney` in lib-metrics (with Maya consult). He owns all three killed-mutant gates.

**Ananya (web):** Command Center/Home + P&L/CM-waterfall (Visx) + ONE drill-to-source drawer + auth/login + workspace switcher; consumes `formatMoney`; binds cards to the `as_of` epoch; ROAS scale render (CF-C6-ROAS-DISPLAY-CONTRACT-1).

**Karan (mobile):** the Morning-Brief core (three-signal/≤3-action render of the amended `InsightItem`); the graduated-label state (CF-C6-MB-GRADUATED-LABEL-1); the idempotency-key client lifecycle; offline stale-but-labelled + device-side SLO metric (CF-C6-MB-OFFLINE-SLO-1); the a11y action card (CF-C6-MB-A11Y-ACTION-1); the push-token rotation + deep-link.

**Maya (consult):** confirm the Morning-Brief content contract (`rationale` render-only, action enum closed, payload matches the Decision-Log write path); **confirm the CF-C6-MB-CONTRACT-COMPLETENESS-1 amendment** field semantics + registry-derived deterministic source for `expected_impact`/`risk`; the registry-display semantics behind ROAS-scale + confidence-pre-format.

---

## 8. Decision-log entry (mirrored)

```json
{
  "ts": "2026-05-25T07:10:00Z",
  "actor": "cto-advisor",
  "role": "Rohan",
  "type": "intake-synthesis",
  "req_id": "feat-frontend-dashboard-morningbrief",
  "parent_epic": "chore-migrate-legacy-to-brain",
  "epic_child_id": "child-6-frontend",
  "stage": 1,
  "decision": "ADVANCE",
  "personas_synthesized": ["dashboard-number-fidelity-realist:sonnet", "mobile-morning-brief-perf-a11y-realist:sonnet"],
  "persona_quality_gate": "BOTH PASS — number-fidelity (1 CRITICAL+2 HIGH+2 MED+1 LOW) + morning-brief (1 CRITICAL+3 HIGH+2 MED); 12 grounded concerns, none a looks-good pass; both converge on the BFF/contract-integrity seam as #1 risk",
  "escalation_to_founder": "none",
  "escalation_ruled": "morning-brief Concern 3 (InsightItem contract incompleteness) RULED at synthesis = AMEND the Child-5 contract (add expected_impact{revenue_mu,cm2_mu,impact_label}+risk as registry-DERIVED deterministic Tier-A fields, NOT LLM numbers; proto is source of truth; Maya consult on field semantics) — NOT scope-down; internal Stage-2 architecture-amendment, not a Founder escalation",
  "new_folded_constraints": ["CF-C6-BIGINT-JSON-1 (CRITICAL)", "CF-C6-FORMATMONEY-CANONICAL-1 (HIGH)", "CF-C6-AS-OF-STAMP-1 (HIGH, sharpens FAITHFULNESS-RENDER)", "CF-C6-ROAS-DISPLAY-CONTRACT-1 (MED)", "CF-C6-REGISTRY-ONLY-BFF-1 (MED)", "CF-C6-NO-UI-FLOAT-1 (LOW)", "CF-C6-MB-IDEMPOTENCY-1 (CRITICAL, sharpens MB-DECISION-LOG)", "CF-C6-MB-GRADUATED-LABEL-1 (HIGH)", "CF-C6-MB-CONTRACT-COMPLETENESS-1 (HIGH)", "CF-C6-MB-OFFLINE-SLO-1 (HIGH)", "CF-C6-MB-A11Y-ACTION-1 (MED)", "CF-C6-MB-PUSH-TOKEN-1 (MED, resolves armed-not-fired)"],
  "integrity_gates_killed_mutant": ["G-BIGINT (>MAX_SAFE_INTEGER round-trip)", "G-IDEMPOTENT (double-submit -> single Decision-Log row)", "G-REGISTRY-ONLY (orphan/unregistered BFF number caught)"],
  "verify_the_verifier_occurrence": "6th — bound in-child under Rohan VETO; NOT self-adopted (awaiting /adopt-rule)",
  "confirmed": "6a/6b split held; runnable harness + Sugandh-Lok seed in 6a; new-layer axios->tRPC + Zustand->Redux bound; CF-C6-DATA-SEAM-1 = THE Stage-2 must-decide; builders Ananya+Karan+Vikram; Maya consult; push-send OUT / token-registration IN",
  "next_stage_recommendation": "Stage 2 Architect (Aryan); Maya consulted (Morning-Brief content contract + the CF-C6-MB-CONTRACT-COMPLETENESS-1 amendment semantics); Vikram on the BFF/data-read spine (owns all 3 killed-mutant gates)"
}
```
