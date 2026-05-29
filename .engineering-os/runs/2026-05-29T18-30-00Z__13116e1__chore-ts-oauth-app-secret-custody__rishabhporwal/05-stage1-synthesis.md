# 05 — Stage 1 Synthesis — chore-ts-oauth-app-secret-custody

**Rohan (CTO Advisor)** · post-persona synthesis · **2026-05-29T18:30:00Z**

## Persona accepted

`secret-injection-boundary-realist:haiku` — 5 concerns (3 HIGH / 2 MED), none "looks good", all
material and code-grounded. Accepted. None re-opens the ruling; all sharpen the EXECUTION of it.

## Decision (re-affirmed): ADVANCE → Stage 2 (Aryan)

The persona confirmed the injection ruling is correct and shifted the risk from *which mechanism* to
*how it is proven without a running container*. That hardens the contract; it does not change the
verdict, lane, paradigm, or persona count.

## Concerns folded into the binding contract (3 sharpened, all bound for Aryan)

- **C1 → CF-TS-INJECT-SYNTH-1 (NEW, HIGH):** because there is no deployed core-service container, the
  live `secrets:` mapping is HELD-for-Stage-8; the BUILD gate is **CDK synth-level** — the synthesized
  task-def/CloudFormation contains the `secrets:` entry resolving the ap-south-1 SM ARN
  `brain/_app/shopify/hmac_secret` → `SHOPIFY_CLIENT_SECRET`. Tanvi asserts on the synth output, not a
  live container. No "it'll work when deployed" hand-wave.
- **C2 → CF-TS-FAILFAST-1 sharpened:** the presence assert MUST run at **service boot**, not call-time.
  Aryan scopes the minimal boot-time config-validation home in core-service (no config framework, no
  over-build). The existing call-time `requireEnv` does NOT satisfy this.
- **C3 → CF-TS-NO-AWS-CLIENT-1 sharpened to a TEST:** Security/CI greps `apps/core-service` import
  graph + `package.json` for any AWS SDK; presence = hard BOUNCE. One-line plan statement: "the TS
  reader is `process.env`, full stop."
- **C4 → rotation runbook note:** core-service picks up a rotated secret on **task restart**, not live
  (acceptable; Shopify app-secret rotation is rare + Stage-8/Founder-driven). One line added to the
  inherited rotation runbook.
- **C5 → CF-TS-NEVERLOG-1 extended:** the NEW boot assert is a new leak surface; message names the var,
  checks presence/non-empty only, never echoes the value; add a negative test (error string excludes
  the value).

## Final bound CF contract (carried to Stage 2)

CF-HMAC-TS-OWNER-INJECT-1 · CF-TS-NO-AWS-CLIENT-1 · CF-TS-FAILFAST-1 · CF-TS-HMAC-CONST-1 ·
CF-TS-NEVERLOG-1 · CF-TS-RESIDENCY-1 · CF-TS-SAME-KEY-1 · **CF-TS-INJECT-SYNTH-1 (new)**.

## Headline Stage-2 obligations for Aryan

1. State the injection ruling in one line: TS = `process.env` (platform-injected), no AWS SDK; the
   live task-role wiring is HELD for Stage 8.
2. Author the **CDK task-def `secrets:` mapping** (ap-south-1 ARN `brain/_app/shopify/hmac_secret` →
   `SHOPIFY_CLIENT_SECRET`), giving Tanvi a **synth-level** assertion — NOT a `cdk deploy`.
3. Scope the **minimal boot-time presence assert** home in core-service (CF-TS-FAILFAST-1), keeping it
   tiny — no config framework, no new abstraction "for later" (Single-Primitive Rule).
4. Leave `validateShopifyHmac`/`exchangeShopify` HMAC + token-exchange logic **unchanged**
   (constant-time, hex/sorted-query, no duplicate verifier).
5. Bind the AWS-SDK-import grep as a Security/QA test (CF-TS-NO-AWS-CLIENT-1) + the never-log negative
   test (CF-TS-NEVERLOG-1).
6. Mark HELD-for-Stage-8: live task-role injection wiring + rotated secret value; no commit/deploy.

## Escalation

None fired. Trigger armed: a Node AWS SM client proposal at Stage 2/3 re-opens CF-CC-OWNER-1 → route to
Rohan → Founder, do not implement silently.
