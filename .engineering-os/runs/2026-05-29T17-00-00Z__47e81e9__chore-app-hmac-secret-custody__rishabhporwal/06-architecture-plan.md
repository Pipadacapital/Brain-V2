# Architecture Plan — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **CF-ref** | `CF-CC-SHOPIFY-HMAC-1` (parent §17 Track C) |
| **Parent** | `feat-credential-custody-aws-sm` (Stage-8 readiness-held) |
| **Stage** | 2 — binding plan |
| **Author** | Aryan (architect) |
| **Timestamp** | 2026-05-29T17:20:00Z |
| **feature_class** | high-stakes · **paradigm** `sql` · **cost** ₹0/mo recurring |
| **Handoff calibration** | `high-stakes` lane → handoff FOLDED into §17b acceptance contract (justified §0) |

---

## 0. Handoff-depth calibration (justification)

High-stakes lane normally separates `07-handoff-to-developer.md`. I am **folding** the handoff into
§17 Tracks + §17b acceptance contract instead, because: (a) the slice is small and additive — three
named files + one CDK delta + tests, no new service, no schema/proto/event change; (b) every binding
constraint is already a CF with a verifiable artifact, so a separate prose handoff would only restate
§17b; (c) the builders (Maya/Vikram/Jatin) all worked the parent slice last week and the primitives
they reuse are cited file:line below. The §17b CF→artifact→bounce-condition table IS the handoff
contract. This stays inside the high-stakes discipline (every must-fix is a bound, mutation-tested
acceptance item) without ceremony the slice doesn't need.

---

## 1. Context

**Problem.** The Shopify Partner-app HMAC secret (`SHOPIFY_CLIENT_SECRET`, config key
`shopify.app_hmac_secret`) lives in plaintext at `apps/api-gateway/.env:27`
(`shpss_<REDACTED-compromised-rotate-at-Stage-8>`). This is the plaintext-vault posture being closed. It is an
**app-level singleton** (no `workspace_id`) read by **three** consumers, verified in code at intake:

| # | Consumer | File:line | Shape | Workspace ctx |
|---|----------|-----------|-------|---------------|
| **C1** | OAuth-callback HMAC (TS) | `apps/core-service/src/application/connectors/provider-config.ts:153` `validateShopifyHmac()` | **hex** digest of **sorted query string**; `requireEnv('SHOPIFY_CLIENT_SECRET')` (line 156); `timingSafeEqual` (line 166) | **EXISTS** (interactive connect) |
| **C2** | OAuth token exchange (TS) | same file `exchangeShopify()` `:199–225`, secret read at `:210` | secret as `client_secret` in POST `/admin/oauth/access_token` | EXISTS (same flow) |
| **C3** | Inbound-webhook HMAC (Py) | `apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py:81` `verify_shopify_hmac(data, hmac_header, client_secret)` | **base64** digest of **raw body**; `hmac.compare_digest` (line 107); secret is an **injected param** | **NONE** — webhook arrives pre-routing. **No caller / no ingress route yet** (pure function awaiting wiring). |

Canon (technical-context §3) makes **ingestion-service the webhook owner**. C3 is the only context-free,
security-load-bearing inbound path; C1/C2 already work with the env secret inside a workspace context.

**In scope (this slice):** an app-level retrieval seam (boot/cached, fail-closed) that REUSES the
parent's lazy-boto3/residency/never-log machinery as a **singleton** reader (no `workspace_id` path
component); wiring that seam to feed `client_secret` into the EXISTING `verify_shopify_hmac()`; the
verify-the-verifier kill-test + mutation test on C3; the CDK IAM delta (`brain/_app/*` + the singleton
secret resource, authored-not-deployed); rotation policy doc.

**Out of scope / HELD for Stage-8 console (Founder/Jatin):** real Secrets Manager provisioning of
`brain/_app/shopify/hmac_secret` + the app CMK association; putting + **rotating** the live `shpss_…`
value (compromised-by-exposure); IAM role creation; festival-safe window. **Separately HELD: the
inbound-webhook INGRESS ROUTE itself** — this slice leaves the seam + the cached provider; it does NOT
build the webhook endpoint (that is the connector-webhook-intake feature).

---

## 2. Proposed solution

A thin **app-level secret provider** in the Python ingestion-service that:
1. Resolves a backing via the **same factory flag** the parent shipped (`CONNECTOR_CUSTODY_BACKING`):
   `aws-secrets-manager` → read the SM singleton `brain/_app/shopify/hmac_secret`;
   `local`/unset → dev-only env-var fallback (`SHOPIFY_CLIENT_SECRET`); unknown → fail-closed.
2. Fetches the secret **once at boot / on first use and caches it** (no per-webhook SM call).
3. **Fails closed**: if the secret is unretrievable/missing/empty, the provider raises a named error
   and the verifier rejects — never fall-open, never process.
4. **Reuses** the parent's `AwsSecretsManagerCustody` lazy-boto3 client + `_REQUIRED_REGION` residency
   assert + never-log discipline as building blocks — but exposes a **singleton** read (no
   `workspace_id`/`vendor` path), because the per-workspace `_secret_name()` is the wrong shape and the
   parent explicitly FORBADE folding (custody.py:26–31).

The provider's output (the raw secret string) is passed as the existing `client_secret` parameter to
the unchanged `verify_shopify_hmac()`. **No second HMAC routine. No change to C1/C3 crypto.**

### Diagram

```
                         ┌─────────────────────────────────────────────┐
  CONNECTOR_CUSTODY_      │  app_secret_factory.select_app_secret_       │
  BACKING (parent flag)  │  provider()   [NEW, mirrors custody_factory] │
        │                └───────────────┬─────────────────────────────┘
        ▼                                │
  aws-secrets-manager ──► AppSecretsManagerProvider ─► reuses parent lazy boto3 + ap-south-1
        │                  (singleton: brain/_app/shopify/hmac_secret)    residency-assert + never-log
  local/unset        ──► EnvAppSecretProvider (DEV ONLY: SHOPIFY_CLIENT_SECRET)
  unknown            ──► HeldAppSecretProvider (raises → fail-closed)
                                         │
                          get_shopify_hmac_secret() → cached value (boot/first-use, TTL+manual-refresh)
                                         │
                                         ▼
   (FUTURE ingress route — HELD) ──► verify_shopify_hmac(data, hmac_header, client_secret=<provider value>)
                                         │            [EXISTING fn, shopify_adapter.py:81 — UNCHANGED]
                                fail-closed if provider raised  ──► REJECT webhook (never 200)
```

The TS path (C1/C2) is **untouched** this slice — see the §3-adjacent ruling and §16.

---

## 3. Paradigm

**`sql`** — deterministic crypto (HMAC-SHA256) + an AWS Secrets Manager GET + an in-process cache.
Zero ML, zero LLM, zero inference. Identical posture to the parent (`sql`, ₹0/mo). Any `@paradigm`
LLM decorator or new inference runtime in this slice is an immediate paradigm-bypass BOUNCE.

### THE RULING — CF-HMAC-TS-VS-PY-OWNER-1 (retrieval-owner boundary)

**Decision: Python (C3 webhook) reads the Secrets Manager singleton via the new app-secret provider
this slice. TS (C1/C2 OAuth) stays `requireEnv('SHOPIFY_CLIENT_SECRET')`-injected this slice,
with a documented, separately-tracked follow-on.**

One provisioned VALUE (`brain/_app/shopify/hmac_secret`), one retrieval OWNER (Python) for now.

**Why this boundary, not "both read custody" (Single-Primitive max) and not "neither" (status quo):**

1. **Blast radius / need.** C3 is the *only* context-free, security-load-bearing inbound auth gate
   with **no workspace context** and (today) **no caller** — it is precisely the leg the requirement
   exists to harden, and it lives in the runtime (ingestion-service) that already owns
   `AwsSecretsManagerCustody` + the lazy-boto3/residency/never-log primitives (cited §7). Wiring C3 to
   custody reuses the parent machinery in-place with the least new surface.
2. **C1/C2 already work and carry workspace context.** They run inside an interactive connect flow
   that has already crossed auth; the env secret is functional there today. Forcing TS to grow an
   *app-level Secrets Manager client* would mean a SECOND boto3-equivalent retrieval client in a
   SECOND runtime (TS/core-service, which the parent deliberately kept AWS-free — `custody-factory.ts`
   returns `LocalAesGcmCustody`/`HeldProductionCustody`, no AWS, CF-CC-OWNER-1). That **doubles** the
   residency/IAM/never-log audit surface for zero marginal security on a leg that isn't the exposed
   gate. That is scope/blast-radius expansion beyond what the requirement needs.
3. **Single-Primitive is satisfied at the level that matters:** one secret VALUE, one HMAC verifier
   per shape (unchanged), one custody machinery reused. The "single retrieval path" ideal is
   explicitly traded against the cost of a second AWS client in a second language — and the parent's
   own owner-split (CF-CC-OWNER-1: Python owns AWS, TS does not) is the precedent.
4. **Reversible.** When the TS OAuth path is later moved to custody (its own slice), it extends the
   SAME provisioned key + the SAME factory-flag pattern — a mechanical add, not a rework. The boundary
   is bound here so it does not drift into two accidental, undocumented clients.

**Bound follow-on (documented, not built):** `chore-ts-oauth-app-secret-custody` — move C1/C2 off
`requireEnv` to a TS app-secret reader against the same `brain/_app/shopify/hmac_secret` key. Tracked
in the journal + per-feature file; NOT this slice.

---

## 4. API design

No public surface change.

### gRPC protos added or changed
None.

### tRPC procedures added or changed
None.

### MCP tools added or changed
None.

### REST endpoints added or changed
None. (The inbound-webhook ingress route is a SEPARATE, HELD feature — this slice only leaves the
provider seam it will call.)

### Breaking changes
None. C1/C2/C3 signatures and crypto are unchanged. The provider is purely additive.

### Versioning strategy
N/A — no public surface. Internal additive module only.

---

## 5. Data model changes

### Postgres
None.

### ClickHouse
None.

### Migration plan
No DB migration. **Reversibility:** the entire slice is new files + one additive CDK construct +
tests. Revert = delete the new module + revert the CDK delta; C1/C2/C3 behavior is byte-identical to
today (C3 still has no caller). Zero data, zero schema, zero state to unwind.

---

## 6. Event model

No new Kafka topics, no envelope change. C3's webhook leg, when later wired, consumes the inbound
HTTP request (raw body) — not a Kafka event — so there is no envelope/topic impact in this slice.

---

## 7. Single-Primitive sweep

| Candidate to reuse | Verdict | Evidence |
|--------------------|---------|----------|
| Parent `AwsSecretsManagerCustody` lazy-boto3 `_client()` + `_REQUIRED_REGION` residency assert + `AwsRegionMismatchError` | **REUSE** as the singleton read building block | `aws_secrets_manager_custody.py:176–205` (lazy client + ap-south-1 assert), `:80` (`_REQUIRED_REGION`) |
| Parent `custody_factory.select_custody()` flag pattern (`CONNECTOR_CUSTODY_BACKING`; unknown→fail-closed) | **MIRROR** for `select_app_secret_provider()` | `custody_factory.py:44–99` (match-case; `case _:` fails closed, CF-CC-GATE-1) |
| Parent `HeldProductionCustody` fail-closed default | **MIRROR** as `HeldAppSecretProvider` (raises on use) | `held_custody.py:63–88` |
| Never-log ids-only discipline | **REUSE** verbatim (secret never in any log/exc) | `aws_secrets_manager_custody.py:44–49, 283–298` |
| Existing `verify_shopify_hmac()` (base64/raw-body, `compare_digest`) | **REUSE UNCHANGED** — feed it the secret | `shopify_adapter.py:81–107` |
| Existing TS `validateShopifyHmac()` (hex/sorted-query, `timingSafeEqual`) | **LEAVE UNCHANGED** (distinct algorithm; not unified) | `provider-config.ts:153–167` |
| Parent CDK `CredentialCustodyStack` IAM policy + CMK | **EXTEND** (the IAM scope already matches `secret:brain/*` so `brain/_app/*` is covered; add a representative singleton secret + a doc note) | `credential-custody-stack.ts:198` (`secret:brain/*` already covers `brain/_app/*`) |

**Sweep result: all clean — no new primitive authored.** The slice = mirror the factory pattern for a
singleton shape + a thin provider + feed the existing verifier + a CDK doc/representative-secret delta.

**CF-HMAC-SINGLE-PRIMITIVE-1 + CF-HMAC-ALGO-DISTINCT-1 honored:** no second HMAC routine; C3 base64-raw-body
and C1 hex-sorted-query stay separate and individually constant-time.

---

## 8. Multi-tenancy enforcement (4 layers)

This secret is **app-level (singleton, no `workspace_id`)** — it is a Partner-app credential, NOT
tenant data. The 4-layer `workspace_id` model does **not** apply (and MUST NOT be retrofitted — folding
into the per-workspace `brain/{workspace_id}/...` shape is the exact thing the parent forbade,
custody.py:26–31).

| Layer | Applicability |
|-------|---------------|
| JWT → service assertion | N/A — webhook arrives pre-auth; integrity is established by the HMAC gate itself, not a tenant claim. |
| Postgres RLS / CH query-gateway | N/A — no tenant rows read/written. |
| Kafka envelope | N/A — no event emitted this slice. |
| Tenant key namespace | The secret lives under `brain/_app/shopify/hmac_secret` — the `_app/` segment is the explicit "no-workspace, app-level" namespace, deliberately distinct from `brain/{workspace_id}/{vendor}/credential`. The `_validate_id`-style traversal/wildcard guard is not workspace-scoped here, but the singleton name is a fixed constant (no user input composes it), so there is no namespace-escape vector. |

**Residency (does apply): CF-HMAC-RESIDENCY-1** — the singleton secret + its CMK are ap-south-1; the
provider's boto3 client carries the SAME `region_name="ap-south-1"` + refuse-to-start region assert as
the parent (`aws_secrets_manager_custody.py:189–201`).

---

## 9. Observability plan

Proportionate to a ₹0 boot-time secret read — no new dashboards, no new metrics infra (over-engineering
guard). Structured logs only, ids/outcome only (CF-HMAC-NEVERLOG-1):

| Signal | Detail |
|--------|--------|
| Log: provider resolution | `app_secret_factory: backing=%r → <ProviderClass>` (mirrors custody_factory.py:67). Never the value. |
| Log: boot fetch | `app_secret.fetch: source=secrets-manager|env outcome=ok|not_found|error` — **NEVER** the secret, **NEVER** a full signature. |
| Log: cache refresh | `app_secret.refresh: outcome=ok|unchanged` (manual rotation-refresh trigger). |
| Log: verify outcome (future ingress, noted for the wiring feature) | `webhook.verify: vendor=shopify outcome=accepted|rejected reason=bad_sig|missing_header|secret_unavailable` — ids/outcome only, **never the computed or received HMAC in full**. |
| Alarm | None new this slice (no live AWS, no ingress route). The Stage-8 ceremony runbook owns the live-fetch-failure alarm when provisioning happens. |

---

## 10. Test strategy

All tests run with **NO real AWS** (moto `@mock_aws`, mirroring
`tests/unit/test_aws_secrets_manager_custody.py:10,18`) and **never print the live `shpss_…`**.

**Provider (Maya, Python):**
- Factory selection matrix: `aws-secrets-manager`→SM provider; `local`/unset→env provider;
  unknown→`HeldAppSecretProvider` (fail-closed). Mirrors `custody_factory` test matrix.
- moto round-trip: put `brain/_app/shopify/hmac_secret` → provider returns it; cached (second `get`
  does NOT issue a second SM call — assert via spy: ≤1 `get_secret_value`).
- **Cold-start / unretrievable → fail-closed:** SM `ResourceNotFoundException` / empty / missing env
  → provider raises named error (NOT a silent `None`/`""`).
- Residency: wrong-region client → `AwsRegionMismatchError` refuse-to-start (reuse parent assert).
- Never-log negative assertion: capture logs across resolve+fetch+error; assert the secret value and
  any full HMAC string are ABSENT (mirrors parent never-log test).

**Verify-the-verifier on C3 (Maya, Python) — CF-HMAC-VERIFY-THE-VERIFIER-1 (CRITICAL):**
The 3-case kill-test calling `verify_shopify_hmac()` with the provider-fed secret:
- (a) **valid** signature (base64 HMAC of the exact raw body with the right secret) → **True**.
- (b) **tampered body** (body mutated by 1 byte, same header) → **False**.
- (c) **missing/empty HMAC header** AND a **valid HMAC computed with the WRONG secret** → **False**;
  AND **secret unretrievable** (provider raises) → the gate **rejects / fail-closed**, never processes.
- **Mutation test (must go RED):** flip `hmac.compare_digest(computed, hmac_header)` to `==`
  (constant-time→naive), AND separately flip the fail-closed branch to fall-open (treat unretrievable
  secret as "skip verify / return True"). Each carries a `# MUTATION:` comment (convention at
  `test_aws_secrets_manager_custody.py:534,561,611`). The test suite goes RED under each mutation;
  reverting restores GREEN. Rohan re-mutates at Stage 6.

**CDK (Jatin, TS):** extend `infra/cdk/test/credential-custody-stack.test.ts` — assert the IAM policy
resource `secret:brain/*` covers `brain/_app/*` (it does, by prefix); assert the representative
singleton secret resource is CMK-encrypted + ap-south-1 + `RemovalPolicy.RETAIN`; assert `cdk synth`
still passes; assert NO `cdk deploy` (authored-not-deployed).

**Real-network smoke:** N/A this slice — live AWS + the ingress route are HELD. The Stage-8 ceremony
runbook owns the live get-secret-value round-trip smoke.

---

## 11. Security considerations (forwarded to Shreya — VETO)

- **CF-HMAC-NEVERLOG-1 (Shreya VETO):** the secret value and full HMAC signatures are NEVER
  logged/printed/committed/returned. ids+outcome only. Build must not emit the live `shpss_…`.
- **CF-HMAC-FAILCLOSED-1 (CRIT):** unretrievable/missing/empty secret → provider raises → verifier
  rejects. No catch-into-200, no fall-open. Verified by the mutation test.
- **CF-HMAC-CONSTTIME-1:** C3 uses `hmac.compare_digest` (unchanged, line 107); C1 uses
  `timingSafeEqual` (unchanged). The mutation test guards the constant-time property on C3.
- **CF-HMAC-EXPOSED-VALUE-ROTATE-1:** the `shpss_…` at `apps/api-gateway/.env:27` is
  compromised-by-exposure → rotate at the Stage-8 ceremony (HELD console act). Build leaves `.env`
  untouched (dev fallback still functional) but the runbook flags rotation.
- **IAM least-priv (inherited):** the parent policy already scopes to `secret:brain/*` + the CMK only,
  no wildcards — `brain/_app/*` is covered by the existing prefix; no IAM widening needed beyond a
  doc/representative-secret note (§12 CDK delta keeps the enumerated action set unchanged).
- No new outbound channel, no PII row, no money path.

---

## 12. India context

| Lens | Impact |
|------|--------|
| DPDP residency | Secret + CMK ap-south-1 (CF-HMAC-RESIDENCY-1); provider region-asserts refuse-to-start. The secret is app credential, not customer PII, but residency consistency with the parent is bound. |
| RTO / COD / GST | Indirect: a sound webhook gate protects the integrity of inbound order/refund facts that feed RTO/CM2/COD/per-SKU-GST math. No direct logic. |
| Festival seasonality | The Stage-8 live-rotation ceremony should avoid a festival-freeze window — flagged for Jatin/Founder (consistent with parent freeze discipline). |
| Telecom (DLT/NCPR/DND) | N/A — inbound webhook, no outbound channel. |

---

## 13. Region adapter impact

None. This is not a region-varying business concern — it is a single Shopify Partner-app credential
with a fixed ap-south-1 residency. The RegionAdapter interface is untouched. The ap-south-1 pin is a
residency constant, not a region-strategy branch.

---

## 14. Cost estimate

| Item | Tokens/day | ₹/month |
|------|------------|---------|
| Inference | 0 (paradigm `sql`) | ₹0 |
| Secrets Manager GET | ~1 per boot/rotation (cached, NOT per-webhook) | negligible (well under SM free-tier; ~$0.05/10k API calls — effectively ₹0) |
| KMS Decrypt | ~1 per boot (cached) | negligible |
| **Total recurring** | **0 inference** | **₹0/mo** |

The CF-HMAC-HOTPATH-CACHE-1 boot/cache design is what keeps this ₹0 — a per-webhook SM call would add
latency + cost + a new failure mode and is explicitly FORBIDDEN.

---

## 15. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Builder folds the singleton into the per-workspace `_secret_name()` shape | low | high (re-opens the forbidden fold) | Provider is a DISTINCT singleton reader; `brain/_app/...` namespace; §7 + §17b bounce condition. |
| Fall-open on cold-start (secret not yet fetched / unretrievable) | med | CRITICAL (auth bypass) | CF-HMAC-FAILCLOSED-1 named-error + mutation test (b). |
| A second accidental TS AWS client appears (owner drift) | med | med (doubles audit surface) | CF-HMAC-TS-VS-PY-OWNER-1 ruling bound (§3); TS stays `requireEnv`; follow-on slice named. |
| Per-webhook SM call sneaks in | low | med (latency/cost regression) | CF-HMAC-HOTPATH-CACHE-1 cache + spy-asserted ≤1 fetch test. |
| Auto-rotation enabled on the key | low | high (breaks every signature) | CF-HMAC-ROTATION-MANUAL-1 — auto-rotation FORBIDDEN; manual two-place ceremony documented. |
| Live `shpss_…` printed/committed | low | high (Shreya VETO) | CF-HMAC-NEVERLOG-1 never-log; `.env` untouched; rotate-at-ceremony. |
| Slice accidentally builds the ingress route | low | med (scope creep) | Explicitly HELD; §1 + §17b note "seam only, no endpoint." |

---

## 16. Alternatives considered (≥1)

**Alt A — Both TS (C1/C2) and Python (C3) read the SM singleton this slice (max Single-Primitive).**
Rejected: forces a SECOND boto3-equivalent AWS client into TS/core-service, which the parent
deliberately kept AWS-free (CF-CC-OWNER-1; `custody-factory.ts` returns local/held, no AWS). Doubles
the residency/IAM/never-log audit surface for zero marginal security on a leg that (a) already works
with the env secret and (b) carries workspace context. Single-Primitive is satisfied at the value +
verifier + machinery level without this. **The TS move is a named, reversible follow-on, not this slice.**

**Alt B — Keep env var, just document a "custody plan" (status quo+).** Rejected: this is the exact
plaintext-vault posture the requirement exists to close. "Env var with a custody plan" is a euphemism
unless the plan names who injects it from where — which is what the SM singleton + factory flag does.

**Alt C — Build the inbound-webhook ingress route now so C3 has a live caller.** Rejected as
scope-creep: the ingress route is its own feature with its own surface (routing, idempotency, the
48h-retry contract). This slice leaves a clean seam; building the endpoint would balloon the slice and
mix two distinct load-bearing things (retrieval vs the gate's HTTP wiring).

**Chosen:** Python-only custody read this slice + env-injected TS + named follow-on (§3 ruling) — the
smallest, most reversible closure of the exposed leg.

---

## 17. Tracks (work decomposition for Stage 3)

> Branch the custody work onto a fresh feature branch off `development` (e.g.
> `feat/chore-app-hmac-secret-custody`). No commit without Founder "commit it".

### Track 1 — Python app-secret provider + factory  *(owner: @maya — ingestion-service)*

- **T1.1** Add `apps/ingestion-service/src/infrastructure/secrets/app_secret_provider.py`: an
  `AppSecretsManagerProvider` that REUSES the parent's lazy-boto3 `_client()` pattern + `_REQUIRED_REGION`
  ap-south-1 residency assert (mirror `aws_secrets_manager_custody.py:176–205`), but reads the **fixed
  singleton** `brain/_app/shopify/hmac_secret` (no `workspace_id`/`vendor` path). Boot/first-use fetch
  + in-process cache (single cached value; spy-asserted ≤1 `get_secret_value`). ids/outcome-only logs.
  (2–5 min × a few)
- **T1.2** Add `EnvAppSecretProvider` (DEV-only fallback: reads `SHOPIFY_CLIENT_SECRET`; raises named
  error if empty) and `HeldAppSecretProvider` (raises on use — fail-closed default), in the same module
  or a sibling, mirroring `held_custody.py:63–88`.
- **T1.3** Add `app_secret_factory.py` `select_app_secret_provider(backing=None)` mirroring
  `custody_factory.py:44–99`: `aws-secrets-manager`→SM; `None|""|"local"`→Env (dev); `case _:`→Held
  (fail-closed, CF-HMAC-RETRIEVAL-SHAPE-1 / CF-CC-GATE-1). Reuse the SAME `CONNECTOR_CUSTODY_BACKING` flag.
- **T1.4** Add a `get_shopify_hmac_secret()` accessor + a `refresh()` (manual rotation-refresh) on the
  provider; document the cache-learns-of-rotation mechanism (manual `refresh()` call at the ceremony;
  no TTL auto-poll needed for a near-never-changing key — keep it simple).
- **T1.5** Wire the seam intent: a module-level docstring + a `# SEAM:` comment on
  `verify_shopify_hmac()`'s call site contract documenting that the FUTURE ingress route obtains the
  secret via `get_shopify_hmac_secret()` and fails-closed if it raises. **Do NOT build the ingress
  route.** (CF-HMAC-FAILCLOSED-1 seam.)

### Track 2 — Verify-the-verifier tests (C3)  *(owner: @maya — ingestion-service)*

- **T2.1** `apps/ingestion-service/tests/unit/test_app_secret_provider.py`: factory matrix + moto
  round-trip + cache (≤1 fetch) + cold-start/unretrievable fail-closed + residency refuse-to-start +
  never-log negative assertion. No real AWS, no live value.
- **T2.2** `apps/ingestion-service/tests/unit/test_shopify_hmac_verify.py`: the CRITICAL 3-case
  kill-test (valid→True; tampered→False; missing-header / wrong-secret / unretrievable→reject) + the
  TWO mutation tests (`compare_digest`→`==`; fail-closed→fall-open), each with a `# MUTATION:` comment
  (CF-HMAC-VERIFY-THE-VERIFIER-1, CF-HMAC-CONSTTIME-1, CF-HMAC-FAILCLOSED-1, CF-HMAC-ALGO-DISTINCT-1).

### Track 3 — CDK IAM/secret delta (authored-not-deployed)  *(owner: @jatin — platform-devops)*

- **T3.1** `infra/cdk/lib/credential-custody-stack.ts`: add a representative **singleton** secret
  resource for `brain/_app/shopify/hmac_secret` (CMK-encrypted, ap-south-1, `RemovalPolicy.RETAIN`,
  no real `SecretString`) + a doc comment that the existing `secret:brain/*` IAM scope (line 198)
  ALREADY covers `brain/_app/*` (so NO action-set or resource widening). Keep the enumerated
  `SECRETSMANAGER_ACTIONS`/`KMS_ACTIONS` unchanged (CF-CC-IAM-LEASTPRIV-1). Authored, NOT deployed.
- **T3.2** `infra/cdk/test/credential-custody-stack.test.ts`: assertions per §10 CDK (prefix coverage,
  CMK + ap-south-1 + RETAIN on the singleton secret, synth passes, no deploy).

### Track 4 — Docs / rotation runbook  *(owner: @maya, reviewed by @jatin)*

- **T4.1** A short rotation note (in the provider module docstring or
  `apps/ingestion-service/runbooks/`): the MANUAL two-place ceremony (Shopify Partner dashboard set
  new secret → SM `put-secret-value` → provider `refresh()`); **auto-rotation FORBIDDEN**
  (CF-HMAC-ROTATION-MANUAL-1); the exposed `.env` value is compromised → rotate at Stage-8
  (CF-HMAC-EXPOSED-VALUE-ROTATE-1).

**No TS (core-service) track this slice** — per the §3 ruling, C1/C2 stay `requireEnv`-injected; the
TS move is the named follow-on `chore-ts-oauth-app-secret-custody`. (So @vikram has no task here;
named for the follow-on only.)

### Over-engineering self-check

| Item | Verdict |
|------|---------|
| Plan length matches high-stakes band, no padding | PASS |
| Every §17 file is required (4 new files + 2 test files + 1 CDK edit + 1 runbook note) | PASS — no "while we're here" files |
| No new npm/pip/uv deps | PASS — reuses boto3/moto/pytest already present |
| No new abstraction for hypothetical future | PASS — singleton provider mirrors the shipped factory pattern; no TTL-poller (manual refresh kept simple) |
| No observability beyond what's named | PASS — structured logs only, no new dashboards/metrics infra |
| No tests for trivial getters | PASS — tests target the gate + fail-closed + cache behavior |
| Test strategy proportionate to risk | PASS — CRITICAL gate gets the mutation kill-test; the rest is a focused matrix |
| Did NOT build the HELD ingress route or force the TS move | PASS — scope held to the seam |

**Result: PASS (8/8).**

---

## 17b. Acceptance contract — 11 CFs → verifiable artifact → Stage-4/5/6 bounce condition

> This table IS the builder handoff (per §0). Every row is a pass-1 build obligation; the
> `must-fix` rows are shift-left self-review items the builder must clear BEFORE handoff.

| CF | Sev | Verifiable artifact (pass-1) | Bounce condition |
|----|-----|------------------------------|------------------|
| **CF-HMAC-FAILCLOSED-1** | CRIT `must-fix` | Provider raises named error on unretrievable/missing/empty; verifier rejects. Test T2.2 case (c) + mutation #2. | S4/S5/S6 BOUNCE if any path lets an unretrievable secret reach "process"/200, or if mutation #2 (fall-open) leaves the suite GREEN. |
| **CF-HMAC-VERIFY-THE-VERIFIER-1** | CRIT `must-fix` | T2.2: 3-case kill-test + 2 mutation tests with `# MUTATION:` comments; GREEN at HEAD, RED under each mutation. | S6 (Rohan) re-mutates; if either mutation stays GREEN → BOUNCE (vacuous gate). |
| **CF-HMAC-RETRIEVAL-SHAPE-1** | HIGH `must-fix` | `app_secret_factory.select_app_secret_provider`: `aws-secrets-manager`→SM singleton; dev→env; `case _:`→Held. Test T2.1 matrix. | BOUNCE if env is the prod default, or unknown flag does not fail closed. |
| **CF-HMAC-TS-VS-PY-OWNER-1** | HIGH | §3 ruling: Python reads custody; TS stays `requireEnv`; no TS AWS client added; follow-on named. | BOUNCE if a TS Secrets Manager/boto3-equivalent client appears this slice, or the owner boundary is undocumented. |
| **CF-HMAC-SINGLE-PRIMITIVE-1** | HIGH | No second HMAC routine; provider feeds existing `verify_shopify_hmac()`; SM machinery reused not re-authored. §7 sweep. | BOUNCE if a parallel custody class or a duplicate HMAC fn exists. |
| **CF-HMAC-ALGO-DISTINCT-1** | HIGH | C3 base64/raw-body (`compare_digest`) and C1 hex/sorted-query (`timingSafeEqual`) unchanged + individually tested. | BOUNCE if the two algorithms are unified/swapped or either loses constant-time. |
| **CF-HMAC-CONSTTIME-1** | HIGH `must-fix` | C3 keeps `hmac.compare_digest` (line 107). Mutation #1 (`==`) goes RED. | BOUNCE if comparison is non-constant-time or mutation #1 stays GREEN. |
| **CF-HMAC-HOTPATH-CACHE-1** | MED | Boot/first-use fetch + cache; T2.1 spy asserts ≤1 `get_secret_value` across N reads; `refresh()` documented. | BOUNCE if a per-webhook/per-read SM call is issued. |
| **CF-HMAC-ROTATION-MANUAL-1** | MED | T4.1 runbook: manual two-place ceremony; auto-rotation FORBIDDEN. | BOUNCE if SM auto-rotation is configured for this key. |
| **CF-HMAC-RESIDENCY-1** | HIGH | Provider client `region_name="ap-south-1"` + refuse-to-start assert (reused). T2.1 wrong-region kill. CDK CMK+secret ap-south-1. | BOUNCE if any retrieval client lacks the region assert or the CMK/secret is non-ap-south-1. |
| **CF-HMAC-NEVERLOG-1** | HIGH (VETO) `must-fix` | ids/outcome-only logs; T2.1 never-log negative assertion; live `shpss_…` never printed/committed. | Shreya VETO / BOUNCE if the secret or a full HMAC appears in any log/exc/output/commit. |
| **CF-HMAC-EXPOSED-VALUE-ROTATE-1** | MED | T4.1 runbook flags the `.env` value as compromised → rotate at Stage-8. | Non-blocking; missing runbook note → S6 doc bounce. |

**Inherited (unchanged from parent), also bound:** lazy-boto3 (no AWS at import/`__init__`); IAM
least-priv (`brain/*` scope already covers `brain/_app/*`, no widening); CDK authored-not-deployed; no
live AWS in tests (moto); no commit without Founder "commit it".

**HELD for Stage-8 (NOT bounce conditions for this build):** real SM provisioning + CMK association;
put + rotate the live `shpss_…`; IAM role creation; the inbound-webhook ingress route.

---

## 18. CTO Advisor paradigm sign-off

Paradigm `sql` recommended by Rohan at Stage-1 (`02-cto-advisor-review.md:51–55`, mirrored decision-log
`monthly_cost_inr: 0`). Aryan confirms `sql` at Stage 2 — deterministic crypto + an AWS GET + a cache;
zero inference. Recorded in the architect journal. No paradigm escalation.

---

## Sign-off

- [x] All 18 sections filled (no TBD)
- [x] `@paradigm sql` declared + justified (§3)
- [x] CF-HMAC-TS-VS-PY-OWNER-1 ruled + justified (§3)
- [x] Single-Primitive sweep clean — no new primitive (§7)
- [x] Multi-tenancy: app-level singleton, 4-layer N/A documented; residency applies (§8)
- [x] Observability proportionate; never-log (§9)
- [x] Test strategy incl. verify-the-verifier mutation kill-test (§10)
- [x] ≥1 alternative + rejection rationale (§16)
- [x] Cost ₹0/mo recurring (§14)
- [x] Region adapter impact: none (§13)
- [x] Migration reversible (additive; revert = delete) (§5)
- [x] Tracks have 2–5 min tasks with file paths + owners (§17)
- [x] All 11 CFs → artifact → bounce condition (§17b); must-fix folded into pass-1
- [x] No invented versions (reuses present boto3/moto/pytest/cdk; no new pins)
- [x] Over-engineering self-check PASS 8/8 (§17)

**Decision: ADVANCE → Stage 3 (build).** Builders: @maya (ingestion-service Python — provider +
verify-the-verifier tests + runbook) and @jatin (CDK delta). No TS/core-service work this slice
(@vikram named for the follow-on only).
