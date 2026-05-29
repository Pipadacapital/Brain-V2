# 05 — Stage 1 Synthesis — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Decision** | **ADVANCE → Architect (Aryan), Stage 2** |
| **feature_class** | high-stakes · **paradigm** sql · **cost** ₹0/mo recurring |
| **Personas** | 2/2 — both ACCEPTED (9 concerns; 1 CRITICAL, 5 HIGH, 3 MEDIUM; 0 looks-good, 0 dropped) |
| **Escalation** | NONE fired (see §6) |

---

## 1. The decision and why (not CHALLENGE-BACK, not KILL)

ADVANCE. The requirement is buildable and planable, closes a real plaintext-secret posture
on a security-load-bearing auth gate, and unblocks the parent's bound CF-CC-SHOPIFY-HMAC-1.
It is NOT a CHALLENGE-BACK (the problem, owner, and success bar are clear once the grounding
is corrected) and NOT a KILL (it is the right separate-tracking the parent ruling demanded).

## 2. Grounding correction (Aryan must build on THIS, not the stub/grounding-note)

The stub said the verifier is in **core-service**; the grounding note said **api-gateway**.
**Both are wrong/partial.** Verified in code at intake — there are **three** consumers of one secret:

- **C1 — OAuth-callback HMAC (TS, core-service)** `provider-config.ts:153 validateShopifyHmac()` — hex over sorted query; reads `requireEnv('SHOPIFY_CLIENT_SECRET')`. **Workspace context EXISTS** (interactive connect).
- **C2 — OAuth token exchange (TS, core-service)** `exchangeShopify():210` — same secret as `client_secret`. Workspace context exists.
- **C3 — inbound-webhook HMAC (Python, ingestion-service)** `shopify_adapter.py:81 verify_shopify_hmac(data, hmac_header, client_secret)` — base64 over RAW body; secret INJECTED as a param; **NO workspace context**; **NO caller / no ingress route yet** (pure function awaiting wiring).

The canon (technical-context §3) makes **ingestion-service the webhook owner**. So the
"before any workspace context" premise in the stub is true ONLY of C3, and C3 lives in
Python/ingestion — not api-gateway, not (only) TS core-service. C1/C2 DO have workspace context.

## 3. Bound CF contract (Stage-2 binding inputs for Aryan)

| CF | Sev | Binding |
|----|-----|---------|
| **CF-HMAC-FAILCLOSED-1** | CRITICAL | The webhook verifier (C3) MUST fail-closed on an unretrievable/missing/empty secret — reject the webhook, never process. No catch-into-200. (Shopify retries ~48h → dropping is recoverable; accepting a forgery is not.) |
| **CF-HMAC-VERIFY-THE-VERIFIER-1** | CRITICAL (gate-rule) | Per the 2026-05-26 durable rule: captured kill-tests proving the gate rejects (a) tampered body, (b) missing/empty HMAC header, (c) valid HMAC computed with the WRONG secret; PLUS a mutation test that flips the comparison/gate and proves the test goes RED. Re-mutated by Rohan at Stage 6. |
| **CF-HMAC-ALGO-DISTINCT-1** | HIGH | Keep C3 (base64/raw-body, `hmac.compare_digest`) and C1 (hex/sorted-query, `timingSafeEqual`) as SEPARATE, individually-tested constant-time routines. Do NOT unify/swap algorithms. (Existing H3/F-2 hexdigest scar is the precedent for why.) |
| **CF-HMAC-SINGLE-PRIMITIVE-1** | HIGH | Reuse the parent's `AwsSecretsManagerCustody` lazy-client/residency-assert/never-log/recovery-window primitives for the app-level reader; do NOT author a parallel custody class. The retrieval seam FEEDS `client_secret` into the EXISTING `verify_shopify_hmac()` — no second HMAC routine. |
| **CF-HMAC-RETRIEVAL-SHAPE-1** | HIGH | **Default = Secrets Manager singleton `brain/_app/shopify/hmac_secret`** (ap-south-1, app CMK), read at boot / cached. Dev fallback = env var, gated by the SAME factory flag the parent shipped (local→env; aws-secrets-manager→custody; unknown→fail-closed-to-non-AWS). Aryan names the cold-start fail-closed behavior. The "env var" branch is DEV-ONLY, never the prod posture. |
| **CF-HMAC-TS-VS-PY-OWNER-1** | HIGH | Aryan must RULE explicitly: does TS (C1/C2 OAuth) ALSO read from Secrets Manager, or stay env-injected in prod while only Python (C3 webhook) reads from custody? One secret VALUE, but the retrieval-owner boundary must be decided + bound, not left to drift into two accidental clients. (Default lean: C3/Python reads custody now; C1/C2/TS env-injected with a documented follow-on — but Aryan owns this call.) |
| **CF-HMAC-RESIDENCY-1** | HIGH | Secret + CMK ap-south-1; every new retrieval client carries the region-assert/refuse-to-start guard (inherited from CF-CC-RESIDENCY-1). |
| **CF-HMAC-HOTPATH-CACHE-1** | MEDIUM | Fetch the secret once at boot / cache with TTL + rotation-refresh; NEVER per-webhook Secrets Manager call. Define how the cache learns of a rotated value. |
| **CF-HMAC-ROTATION-MANUAL-1** | MEDIUM | Rotation = a documented MANUAL two-place ceremony (Shopify Partner dashboard set new secret → custody put-secret-value → cache refresh). **FORBID Secrets Manager auto-rotation** (it cannot update Shopify's dashboard → would break every signature). |
| **CF-HMAC-NEVERLOG-1** | HIGH (Shreya VETO) | The secret value is NEVER logged/printed/committed/returned. ids-only errors. Build must not print the live `shpss_…`. |
| **CF-HMAC-EXPOSED-VALUE-ROTATE-1** | MEDIUM | Treat the `shpss_…` value in `apps/api-gateway/.env:27` as COMPROMISED-by-exposure (observed in tooling) → rotate it at the Stage-8 console ceremony regardless of git-ignore. |

**Inherited unchanged from the parent** (`feat-credential-custody-aws-sm`): lazy boto3 (no AWS at import/`__init__`), IAM least-priv (resource-scoped Get/Put/Describe/Create + KMS Decrypt/GenerateDataKey on the CMK only, no wildcards, ap-south-1), recovery-window seal (RecoveryWindowInDays=7; ForceDelete FORBIDDEN), CDK authored-not-deployed, no live AWS in tests (mocked/moto), no commit without Founder "commit it".

## 4. HELD for Stage-8 console ceremony (Founder / Jatin) — NOT this build
- Real Secrets Manager provisioning of `brain/_app/shopify/hmac_secret` + the app CMK.
- Putting the live `shpss_…` value into custody + **rotating** it (the exposed value is compromised).
- IAM role creation, AWS account/creds, festival-safe window choice.
- Building the inbound-webhook INGRESS route that CALLS `verify_shopify_hmac()` (separate feature; this slice leaves the seam).

## 5. Headline Stage-2 obligations for Aryan
1. Build on the corrected 3-consumer grounding (§2), not the stub.
2. RULE CF-HMAC-TS-VS-PY-OWNER-1 (the retrieval-owner boundary) — this is the architectural crux.
3. Bind the retrieval shape (CF-HMAC-RETRIEVAL-SHAPE-1) with an explicit cold-start fail-closed path.
4. Specify the verify-the-verifier kill-test + mutation test on the C3 gate (CRITICAL).
5. Keep the slice additive + reversible; CDK authored-not-deployed; ₹0 recurring; @paradigm sql.
6. Name the boot-time cache + rotation-refresh mechanism.

## 6. Escalation assessment — NONE fired

Checked against the rubric: (a) Option A (Secrets Manager) is already the Founder-decided custody
backing (CF-C3-SECRETS-INTERIM-1) — no relitigation; (b) residency is unambiguous (ap-south-1/DPDP
in-region); (c) no cost-model threat (paradigm sql, ₹0); (d) no moat change; (e) build is additive +
reversible, irreversibles (provisioning, rotation, DELETE) HELD for the console. No compliance
*ambiguity* (DPDP in-region is settled, not ambiguous). Therefore I answer in good conscience from
canon + the parent's ruling; no `/escalate`.

**One non-blocking Founder readiness item** (mirrored to `pending-founder-attention.md`): the live
`shpss_…` value in `apps/api-gateway/.env` has been observed in tooling output → treat as compromised
and rotate at the Stage-8 ceremony (set new in Shopify Partner dashboard → put into custody). Line this
up ahead of cutover; it does not block the build.

## 7. Next
Architect (Aryan) Stage 2 — binding plan per §3/§5. Intake artifacts on branch
`chore/intake-chore-app-hmac-secret-custody` (off development). The custody work itself ships on its
own feature branch when Stage 2 begins. No commit, no code changes this stage.
