# Persona Review — `mobile-morning-brief-perf-a11y-realist`

> Stage 1 persona review — Child 6 (feat-frontend-dashboard-morningbrief).
> Persona: mobile-morning-brief-perf-a11y-realist
> Focus: Morning Brief mobile surface — Decision-Log mutation path, offline/SLO,
>         perf budget, a11y, push wiring, Child-5 contract faithfulness.
> Timestamp: 2026-05-25T06:30:00Z

---

## Framing

The Morning Brief is explicitly named "the highest-quality UI in Brain" and the
"primary product surface" (technical-context §12). It carries a hard SLO
(delivered by 07:20 IST on >99.5% of days). It is also a write surface — the
approve/reject/edit path writes to `ai.decision_log`, the moat. These two
facts — SLO-bearing read surface + Decision-Log-writing mutation path, in a
thumb-first mobile app built from scratch against a bare scaffold — combine into
the highest-risk UI path in this child.

My attack focuses on the four pathways that are most likely to produce a silent
failure:

1. The approve/reject/edit mutation and its idempotency contract.
2. The approve-button's relationship to the recommendation-only-until-graduated
   gate (does the UI mislead the operator?).
3. The THREE-signal / ≤3-action render against the Child-5 `InsightItem` /
   `TypedRecommendation` closed-enum contract.
4. The SLO/offline/perf/a11y envelope on the highest-quality UI in the product.

Ground truth confirmed before this review:
- `apps/mobile` is a bare scaffold: six `.gitkeep` directories, a stub
  `package.json`. Zero implementation.
- `apps/api-gateway` is identically bare. The tRPC router, the
  `registerPushToken` procedure, and every workspace procedure do not exist.
- The Child-5 `TypedRecommendation{action: RecommendationActionEnum, entity_id,
  rationale}` and `InsightItem` contracts are real, committed code.
- `ai.decision_log` is append-only, RLS-scoped, with an idempotency convention
  on `(workspace_id, agent_id, input_hash)` per the Child-5 architecture plan
  §6 ("re-run with same inputs upserts, does not duplicate").
- `multi-tenancy.md` documents that every write carries an
  `idempotency_key (UUID, caller-generated)` with a 24h Redis TTL — this is
  the cross-cutting idempotency primitive.
- The technical-context canon specifies for mobile: "refresh token in
  expo-secure-store, access token in memory; cert pinning (current + rotation
  pin); MASVS L1 + key L2; Expo Push (APNS+FCM)".
- Morning Brief SLO: delivered by 07:20 IST >99.5% of days.

---

## CONCERN 1 — THE HIGHEST-RISK PATH

**Title:** The approve/reject/edit → Decision-Log write path has no idempotency
contract at the tRPC procedure layer — double-tap, retry, and offline replay
will all double-write the Decision Log.

**Severity: CRITICAL**

**Evidence:**

The Decision Log is append-only (`ai.decision_log`; `docs/conventions/decision-log.md`).
The `multi-tenancy.md` cross-cutting idempotency primitive says: "every write
carries an `idempotency_key (UUID, caller-generated); cache: Redis, TTL 24h`."

The mobile Morning Brief mutation path (approve/reject/edit) originates from
a thumb-first device that:
(a) can send a tap event more than once before the first response returns
    (double-tap on a laggy 4G connection is a normal India DTC use-case);
(b) can be in an offline/flaky network state when the user taps — Expo offline
    queue or RN retry logic may fire the mutation a second time when the
    network recovers;
(c) can be killed mid-flight (app backgrounded, iOS/Android cold-start recovery)
    and a retry dispatched on next launch.

There is **no tRPC procedure** yet (the api-gateway is a bare scaffold). That
means the idempotency contract for this specific mutation — who generates the
`idempotency_key`, how the mobile client attaches it to the tRPC call, how the
gateway deduplicates against Redis before forwarding to the Decision-Log writer
— has ZERO design. It is not named in the CF-C6-MB-DECISION-LOG-1 constraint
as written ("writes the Decision Log through the gateway with tenancy + RBAC +
idempotency"). The word "idempotency" appears but the mechanism is unspecified.

A double-written Decision-Log row means: the operator approved once but the log
shows two "approved" entries for the same recommendation. The Decision Log is the
moat ("decision memory — the moat" per business-context §3); a double-write
corrupts the condition→action→outcome chain, inflates outcome attribution, and
breaks the 7d/30d outcome backfill (the backfill joins on decision rows —
duplicates produce phantom ROI).

The Child-5 architecture plan §6 specifies idempotency for server-side
re-synthesis via `(workspace_id, agent_id, input_hash)`. That covers a
**server-initiated re-run**. It does NOT cover a **client-initiated approve/
reject/edit** originating from a mobile device, because:
- `input_hash` there is derived from the inference input; the mobile operator's
  "I approve recommendation ID abc123" does not have a natural `input_hash`.
- The mobile client must generate its own `idempotency_key` (UUID v4, per the
  cross-cutting primitive) and the tRPC procedure must deduplicate on it in Redis
  before touching `ai.decision_log`.

**Proposed constraint:**

CF-C6-MB-IDEMPOTENCY-1 (CRITICAL, new):
The `morningBrief.submitResponse` tRPC procedure (approve/reject/edit) MUST:
(a) require a caller-generated `idempotency_key: UUID` in the procedure input;
(b) check Redis `ws:<workspace_id>:idem:<idempotency_key>` (TTL 24h) before
    writing to `ai.decision_log`; if present, return the cached response
    (HTTP 200, not 409) to the mobile client — the client must not show an error;
(c) the mobile client generates the idempotency key at the moment the user
    initiates the action (not at send time) and persists it in local storage
    until a successful non-error response is received — so offline queue replay
    reuses the same key;
(d) Stage-5 QA negative control: send the same approve payload twice (same
    idempotency_key) → exactly ONE `ai.decision_log` row, second call returns the
    cached first response.

---

## CONCERN 2 — HIGH

**Title:** The approve button misleads the operator: tapping "Approve" on a
non-graduated action looks like execution but writes only a recommendation row.
There is no visible distinction in the spec between "approved and queued" vs
"approved (but recommendation-only — will not execute)".

**Severity: HIGH**

**Evidence:**

The graduation middleware (VETO Gate 4, `graduation_middleware.py`) is server-side
and fail-closed: if the action is not graduated, `dispatch_tool_call` returns
`DROPPED_NOT_GRADUATED` and writes a `recommendation`-type Decision-Log row.
The executor is never called. This is correct server behavior.

The problem is the mobile UI presentation layer. The Morning Brief requirement
names three buttons: **Approve / Reject / Edit**. In the current spec, the
mobile client sends the approval, the server drops it at graduation middleware,
writes a recommendation row, and returns `DROPPED_NOT_GRADUATED` to the client.
What does the UI show?

If the UI shows a success state ("Approved!") — the operator believes the action
will execute. It won't. The graduation gate prevents execution. The operator
discovers the non-execution only when the expected outcome (ad paused, budget
changed) does not materialize. This is a trust destruction event.

If the UI shows an error state — it is also wrong (the server did the right thing;
it wrote to the Decision Log; nothing failed).

The requirement says "recommendation-only-until-graduated"; CF-C6-MB-DECISION-LOG-1
says `rationale` is render-only. But neither the requirement nor the CTO Advisor
review specifies what the **button label** or the **post-tap state** should be for
an un-graduated action. This is the UI gap.

The canonical signal is: for Phase 1, ALL actions are non-graduated (5a is
recommendation-only; write-tool executor is `NotImplementedError` in production).
So on Day 1, every "Approve" tap in the Morning Brief is a vote into the
Decision Log with the status `recommendation` (a positive signal that Brain is
building evidence for graduation) — NOT an execution. The operator needs to
know this distinction.

Analog from Child-5 plan §A0.5 ("5a: `execute_write_tool` is NOT reached at
runtime; but the contract + caps + killed mutant are BUILT now so graduation
never opens an undefended path"): the principle is sound; the UI implication
was not surfaced.

**Proposed constraint:**

CF-C6-MB-GRADUATED-LABEL-1 (HIGH, new):
The Morning Brief action cards MUST:
(a) display a visible, plain-language state label driven by the gateway response,
    not inferred client-side. The tRPC procedure response MUST include
    `{ decision_log_row_id, status: "queued_for_execution" | "logged_as_vote" }`.
    "queued_for_execution" = the action is graduated and will run.
    "logged_as_vote" = the action is not yet graduated; the approval is logged
    as a positive signal; no execution will occur.
(b) On `logged_as_vote`: show a labelled state ("Your approval has been logged.
    This action will be queued once Brain confirms it is safe to auto-run.") —
    NOT a success checkmark, NOT an error.
(c) The button label itself MUST reflect current graduation state. If the server
    returns that the action is non-graduated, the button reads "Support this
    action" (or "Log approval"), not "Approve & Execute". Client must NOT infer
    graduation state from local data — it must come from the server on each Brief
    load.
(d) Stage-5 QA test: load a Morning Brief whose actions are all non-graduated;
    tap all three CTAs; confirm all three show the `logged_as_vote` label; confirm
    zero executor calls and exactly three `recommendation`-type Decision-Log rows.

---

## CONCERN 3 — HIGH

**Title:** The `InsightItem` / `TypedRecommendation` render contract has a
concrete mismatch risk: the mobile client will receive `confidence: float`
(0.0–1.0) and `severity: str` from the server, but the Morning Brief THREE-signal
rule requires "≤3 ranked actions each with problem/evidence/recommended-action/
expected-impact(revenue+CM2)/risk/confidence" — and the `InsightItem` contract
has no `expected_impact`, no `risk`, no `evidence` field. The UI will reach for
fields that do not exist in the delivered struct.

**Severity: HIGH**

**Evidence:**

The Child-5 `InsightItem` (as committed in
`apps/intelligence-service/src/domain/tools/recommendation.py`):

```python
class InsightItem(BaseModel):
    title: str
    severity: str          # "info" | "warning" | "critical"
    confidence: float      # 0.0-1.0
    summary: str
    detail: str
    recommendation: TypedRecommendation
```

The Morning Brief requirement (requirement §In scope + business-context §7)
mandates each action card shows: **problem / evidence / recommended-action /
expected-impact (revenue + CM2) / risk / confidence**.

The committed `InsightItem` has:
- `title` (maps to problem: partial)
- `summary` (maps to evidence: partial)
- `detail` (maps to recommended-action: partial)
- `confidence: float` (present)
- `recommendation.rationale` (render-only)

It does NOT have:
- `expected_impact.revenue_mu` (BIGINT minor units)
- `expected_impact.cm2_mu` (BIGINT minor units)
- `risk` (str or enum)
- `evidence` as a distinct structured field separate from `summary`

The tRPC proto for `InsightItem` is defined in
`proto/intelligence/v1/insight.proto` per the Child-5 architecture plan §4,
where the proto is: `InsightItem{title, severity (enum), confidence, summary,
detail, recommendation: TypedRecommendation, metrics[]}`. It adds `metrics[]`
but still has no `expected_impact` or `risk`.

The consequence: Karan's mobile build will either (a) render empty/missing cards
where impact and risk should appear, undermining the brain's "every recommendation
carries expected revenue + CM2" promise, or (b) compute impact estimates on-device
— which is a hard violation of CF-C6-RENDER-ONLY-1 and CF-C5-FAITHFULNESS-1
(the UI would be inventing a number that was validated upstream against a different
signal set).

This is not a future concern. The Morning Brief card is the feature. If the card
does not show revenue + CM2 impact, the operator has no basis for making a
decision. The field is load-bearing for the product promise.

The gap needs to be closed in the proto / `InsightItem` schema, not in the UI.
The UI must render what the server sends; it must never compute an impact estimate.

**Proposed constraint:**

CF-C6-MB-CONTRACT-COMPLETENESS-1 (HIGH, new):
Before Stage 3 build, Aryan and Maya must confirm (at Stage 2) that:
(a) `InsightItem` carries `expected_impact: { revenue_mu: int64, cm2_mu: int64,
    impact_label: str }` and `risk: str` as server-computed, registry-derived
    fields — NOT free-text LLM outputs. These fields come from the Tier-A signal
    layer, not from the narration model.
(b) `proto/intelligence/v1/insight.proto` is updated to include these fields
    (the proto is the contract source; the mobile client is generated from it).
(c) The mobile UI renders these fields verbatim from the proto response.
    Any `expected_impact` displayed in the Morning Brief card that is NOT present
    in the server-delivered `InsightItem` is a Stage-5 BOUNCE (the "LLMs never
    produce a number" invariant applies just as hard to the mobile card as to the
    web chart).
(d) `expected_impact.revenue_mu` and `cm2_mu` are BIGINT minor units from the
    registry; the mobile client formats them via `formatMoney(mu, currency_code)`,
    never computes them.

---

## CONCERN 4 — HIGH

**Title:** The offline degradation contract for the Morning Brief is undefined,
and the SLO measurement mechanism does not exist in the current scaffold.

**Severity: HIGH**

**Evidence:**

The canon (technical-context §12) specifies the Morning Brief offline posture:
"online-only Phase 1 → cached reads Phase 2 → optimistic queue Phase 3."

For Phase 1 the mobile app is online-only. In practice this means: if the network
is unavailable at 07:00–07:20 IST (the SLO window), the operator opens the app
and sees... what? A blank screen? An error state? A spinner that never resolves?

The requirement does not define the stale-but-labeled degradation behaviour, and
the CF-C6-PERF-A11Y-1 constraint (LCP<2s, etc.) says nothing about what renders
when the network fetch fails.

This has a concrete failure path in the Indian DTC use-case: operators in Tier-2/3
cities with intermittent 4G open the app during the commute. If the Morning Brief
returns a blank white screen on a failed fetch, the operator experience is broken
exactly at the highest-value moment of the day.

Additionally: the SLO "delivered by 07:20 IST on >99.5% of days" requires
measurement. The SLO is on the `notifications-service` delivery (push arrives
before 07:20), AND on the app rendering the Brief successfully when opened. The
scaffold has no OTel instrumentation, no app-level metric for "Morning Brief
render time from app open to first meaningful content" — so there is no
mechanism to know if the SLO is being met. The CF-C6-PERF-A11Y-1 constraint is
about LCP/INP/CLS, not the Brief-delivery SLO.

**Proposed constraint:**

CF-C6-MB-OFFLINE-SLO-1 (HIGH, new):
(a) STALE-BUT-LABELED posture for Phase 1: if the Morning Brief fetch fails
    (network error / timeout / 5xx), the app MUST show the last successfully-
    fetched Brief (from local storage / secure cache) with a clearly visible
    freshness label ("Showing Brief from [date/time]. You may be offline.").
    A blank screen or an opaque error on network failure is a P1 incident in the
    07:00–09:00 IST window.
(b) The cached Brief is read-only (no approve/reject/edit on stale data — the
    mutation path requires a live connection so idempotency keys are verified
    server-side). The CTAs are disabled with a tooltip ("Connect to internet to
    respond").
(c) An OTel metric `morning_brief.render_success_latency_ms{workspace_id}` MUST
    be emitted at the app level (Sentry + PostHog, not just push-delivery telemetry)
    so the 07:20 SLO can be measured from the user's device perspective. Push
    delivery alone is not sufficient (push can arrive by 07:15 but the app can fail
    to render for an unrelated reason).
(d) Stage-5 QA test: airplane-mode test — load app with a stale Brief cached, go
    offline, open Morning Brief → stale Brief renders with freshness label; CTAs
    disabled.

---

## CONCERN 5 — MEDIUM

**Title:** WCAG AA contrast and thumb-target sizing on the three action buttons
(Approve / Reject / Edit) are not constrained in the current spec, and the
`rationale` render-only field creates a screen-reader disclosure risk.

**Severity: MEDIUM**

**Evidence:**

CF-C6-PERF-A11Y-1 binds WCAG AA at the headline level. But the most
accessibility-critical component in the entire app is the approve/reject/edit
action card — the component that writes to the Decision Log. Getting this wrong
means an operator using accessibility features (screen reader for the visually
impaired; motor-accessibility users who rely on switch control) may:
(a) activate the wrong CTA (Approve vs Reject) if touch targets are under 44px
    (Apple HIG) / 48dp (Material);
(b) have the screen reader announce `rationale` (a free-text field) as an
    instruction rather than a display label, inadvertently treating AI-generated
    persuasion text as a command — this is a soft-injection risk at the UX layer
    even if the server enforces the closed enum.

The `TypedRecommendation.rationale` field is marked "render-only; never executor
input" at the server level (CF-C5-INJECTION-TYPED-REC-6). But VoiceOver/TalkBack
reads text as it appears in the component tree. If `rationale` is placed
immediately before the Approve button in the accessibility tree, a screen-reader
user hears "Pause your ad set because it is underperforming. Approve." This
ordering constructs an implicit instruction sequence. A voiceover user tapping
"double-tap to activate" immediately after hearing the rationale is primed.

Additionally: the three-minute thumb-first flow (07:00–09:00 IST, commute
context) implies the operator is using the phone one-handed. Under-sized touch
targets or buttons placed at the top of the card (outside the natural thumb arc
for a standard 6.1" screen) will increase mis-taps on the most consequential
mutation in the product.

**Proposed constraint:**

CF-C6-MB-A11Y-ACTION-1 (MEDIUM, new):
(a) Approve / Reject / Edit touch targets MUST be at minimum 48dp / 44pt
    (platform-appropriate) with 8dp minimum spacing between them.
(b) Button layout MUST place the three CTAs at the BOTTOM of each action card
    (thumb-reach zone for standard screen sizes), not at the top or mid-card.
(c) Each CTA button MUST carry an `accessibilityRole="button"` and a distinct
    `accessibilityLabel` that describes the action plus the consequence:
    e.g. "Approve: log support for pausing ad set ID 123".
    The label must NOT include the `rationale` text — `rationale` gets
    its own `accessibilityRole="text"` element rendered before the buttons,
    separated from the button group in the accessibility tree.
(d) `rationale` MUST be marked with `importantForAccessibility="yes"` and
    `accessibilityRole="text"` (not "none") so screen readers announce it as
    explanatory context, not as a button or command.
(e) Contrast ratio for approve/reject button states (resting, focused, pressed)
    MUST meet WCAG AA (4.5:1 for text, 3:1 for UI components). Tamagui theme
    tokens must be audited — default Tamagui tokens on a dark background may not
    pass the 3:1 UI-component ratio for the Reject button's destructive red.
(f) Stage-5 QA test: automated a11y scan (e.g. Expo's `jest-native` + custom
    accessibility snapshot) on the action card component. Manual VoiceOver pass
    on the Morning Brief screen is a release gate.

---

## CONCERN 6 — MEDIUM

**Title:** Push token registration is in scope for 6a, but the spec does not
bound the token → delivery chain clearly — specifically, whether the
`registerPushToken` tRPC procedure is the END of Child 6's obligation or whether
the 07:15 push SEND itself is also expected here.

**Severity: MEDIUM**

**Evidence:**

The CTO Advisor review notes (§India context check, Telecom compliance row):
"Confirm at Stage 2 that the push *send* is out of scope and only token
registration + receipt-render is in."

The requirement §In scope says: "push delivery wiring". "Wiring" is ambiguous:
it could mean (a) register the token so the delivery chain can work, or (b)
implement the 07:15 push dispatch from the server side.

The `notifications-service` (bounded context #7: "alerts, Morning Brief assembly
+ delivery, digests, push, exports, outbound webhooks") is the canonical home of
the push SEND. It is not built in this child. If the 07:15 push send is expected
here, it pulls a second service's responsibility into Child 6, which is scoped
to the frontend.

There is also a concrete token management gap: Expo Push tokens rotate. The
`registerPushToken` procedure needs to handle: (a) initial registration on first
app open; (b) token rotation (Expo calls `getExpoPushTokenAsync` and the token
can change on iOS/Android OS events); (c) workspace-scoped token storage (if an
operator manages two workspaces on one device, two tokens or one token associated
with both workspace scopes?). None of this is specified in the requirement.

Token staleness is a real production failure: a stale token silently fails push
delivery. The operator opens the app at 07:25 and finds no Brief, not knowing
the push was never delivered because their token rotated three weeks ago.

**Proposed constraint:**

CF-C6-MB-PUSH-TOKEN-1 (MEDIUM, new):
(a) Confirm at Stage 2 (Aryan ruling): push SEND (the 07:15 dispatch) is NOT in
    scope for Child 6. Child 6 delivers only `registerPushToken` (tRPC procedure,
    workspace-scoped, token stored in `core.device_tokens` with RLS) and the deep-
    link handler that opens the Brief when the push notification is tapped.
(b) `registerPushToken` must handle token rotation: on every app foreground, call
    `getExpoPushTokenAsync()` and upsert the token against `(workspace_id, user_id,
    device_id)`. The upsert must be idempotent (same token, no-op; new token,
    replace old).
(c) The deep-link handler (the Morning Brief route on push tap) must work without
    a logged-in session: the notification payload carries enough context for the
    app to deep-link into the Brief after silent authentication via the refresh
    token in `expo-secure-store`.
(d) The `notifications-service` push SEND is flagged as a named dependency for
    the 07:15 SLO: Child 6 CANNOT meet the SLO without it. Stage 2 must confirm
    that the `notifications-service` stub (or the `data`-deployable Morning-Brief
    dispatch job from Child 5 5b plan) is an explicit dependency — not an implied
    "someone else will handle it".

---

## The one highest-risk path

**CONCERN 1 (CRITICAL) — approve/reject/edit double-write to the Decision Log.**

This is the highest-risk path because:
- The Decision Log is the product moat. A double-write corrupts it in a way that
  is not immediately visible to the operator (they see one action card, they tap
  once, the duplicate row is invisible to them but visible to the outcome
  attribution engine 7d/30d later).
- It is the kind of failure that passes unit tests and even integration tests if
  the idempotency contract is not explicitly tested with a double-submit scenario.
- The gap is structural: the tRPC procedure does not exist yet, so there is a
  clean window to build the idempotency contract correctly from day one.
- The mobile context (4G packet loss, app backgrounding, OS-initiated retries)
  makes double-submission the default failure mode, not an edge case.

Compared to CONCERN 2 (graduated-label mislead), which is a trust/UX issue,
CONCERN 1 is a data-integrity issue in the immutable audit log. CONCERN 2 is
recoverable with a UI hotfix; CONCERN 1's duplicate rows cannot be deleted from
an append-only log without a migration.

**Push SEND scope (CF-C6-MB-PUSH-TOKEN-1):** confirming at Stage 2 that push
SEND is out of scope (token registration only is in). This is an open question,
not a blocking concern, but it must be answered before Karan builds to avoid
scope creep.

---

## Concerns summary table

| # | Title | Severity | Proposed CF |
|---|-------|----------|-------------|
| 1 | Approve/reject/edit double-write to Decision Log — no idempotency contract at tRPC layer | **CRITICAL** | CF-C6-MB-IDEMPOTENCY-1 |
| 2 | Approve button misleads: no visible distinction between "logged as vote" vs "queued for execution" on non-graduated action | **HIGH** | CF-C6-MB-GRADUATED-LABEL-1 |
| 3 | `InsightItem` proto missing `expected_impact{revenue_mu, cm2_mu}` and `risk` — UI will show empty cards or compute on-device (render-only violation) | **HIGH** | CF-C6-MB-CONTRACT-COMPLETENESS-1 |
| 4 | Offline Morning Brief degradation undefined; SLO measurement metric absent from scaffold | **HIGH** | CF-C6-MB-OFFLINE-SLO-1 |
| 5 | A11y: `rationale` placement in accessibility tree primes screen-reader users toward approve; touch-target sizing unbound | **MEDIUM** | CF-C6-MB-A11Y-ACTION-1 |
| 6 | Push send vs token registration scope ambiguity; token rotation handling unspecified | **MEDIUM** | CF-C6-MB-PUSH-TOKEN-1 |

---

## Escalation recommendation

**YES — ONE item escalates to Rohan's synthesis, not to Founder.**

CONCERN 3 (InsightItem contract incompleteness) requires Rohan to rule at
synthesis time: either (a) the Child-5 proto/domain contract is amended before
Stage 3 build begins (Aryan + Maya amendment loop), or (b) the Morning Brief
action card's design is explicitly reduced to match what `InsightItem` actually
carries (`severity`, `confidence`, `summary`, `detail`, `recommendation.rationale`
display) — no `expected_impact` rendered unless the contract is extended.

This is not a Founder escalation (no missing legal instrument, no novel
non-negotiable trade-off). It is an architecture amendment ruling: Aryan must
confirm in Stage 2 whether the proto extension is this child's job or a Child-5
amendment. The two options are equally acceptable; the ruling just needs to happen
before Karan's build track begins.

CONCERNS 1, 4 are CRITICAL/HIGH but fully resolvable by Aryan in the Stage 2
architecture plan — they do not need a Founder decision. They are binding inputs
for the `morningBrief.submitResponse` tRPC procedure design and the offline
caching strategy.

---

## One-liner for CTO Advisor synthesis

CRITICAL double-write risk on approve/reject/edit (no idempotency contract at
the tRPC layer, mobile retry will corrupt the append-only Decision Log);
HIGH misleading approve-button UX on non-graduated actions; HIGH `InsightItem`
proto missing `expected_impact + risk` (UI will blank or compute on-device —
both are failures); HIGH offline-SLO gap; MEDIUM a11y rationale-placement +
touch-targets; MEDIUM push-send scope ambiguity. Escalate CONCERN 3
(proto completeness) to Rohan's Stage-1 synthesis for a pre-Stage-2 ruling.
