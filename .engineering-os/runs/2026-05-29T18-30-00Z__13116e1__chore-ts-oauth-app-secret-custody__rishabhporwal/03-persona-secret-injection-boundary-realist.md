# 03 — Persona — secret-injection-boundary-realist (:haiku)

**Spawned by:** Rohan (Stage 1) · **Angle:** secret-injection correctness + CF-CC-OWNER-1
boundary-preservation · **Model tier:** haiku (bounded mechanism/checklist stress-test) ·
**2026-05-29T18:30:00Z**

> Brief: adversarially prove that the proposed platform env-injection actually delivers the secret to
> TS, fails fast on absence, keeps core-service AWS-free, never logs the value, and survives rotation —
> and name the one step most likely to silently re-open CF-CC-OWNER-1 or fail in production.

Each concern is material; this is not a "looks good" pass.

## C1 (HIGH) — "env-injection" is a deploy-time claim with NO buildable runtime artifact today

core-service has **no Dockerfile and no deployed task-def**. So "the task injects the secret" cannot be
demonstrated by a real-network smoke this slice — there is nothing running to inject into. Risk: the
slice ships a CDK `secrets:` mapping that is **never executed** and a TS assert that is **only unit-
tested**, and everyone assumes the live path works. **Demand:** Aryan must explicitly mark the live
mapping HELD-for-Stage-8 AND give Tanvi a *mechanical* verification that does not need a live container
— i.e. the CDK task-def synth contains the `secrets:` entry pointing at the ap-south-1 SM ARN (assert
on the synthesized CloudFormation), and the TS fail-fast assert is unit-proven (boot with var unset →
throws at startup; boot with var set → no throw). Do not let "it'll work when deployed" substitute for
a gate.

## C2 (HIGH) — the fail-fast assert must run at BOOT, not lazily, or it is theatre

If the presence check is added inside `validateShopifyHmac`/`exchangeShopify` (call-time, as
`requireEnv` already is), it changes nothing — a missing secret still surfaces at the first OAuth
callback, exactly the failure mode CF-TS-FAILFAST-1 exists to kill. The assert MUST live in the
service bootstrap/startup path (which **does not exist yet** in core-service — see C1). **Demand:**
Aryan decides where boot-time config validation lives (a `bootstrap/config` module asserted at server
start) and CF-TS-FAILFAST-1 is satisfied THERE, not by the existing call-time `requireEnv`. If
core-service has no real server entrypoint yet, the assert home is itself a small new surface Aryan
must scope (and keep minimal — no config framework).

## C3 (HIGH) — the one step most likely to re-open CF-CC-OWNER-1

The seductive shortcut: a developer reads "TS app-secret reader against the same key" (the parent's
loose phrasing in §3) literally and reaches for `@aws-sdk/client-secrets-manager` to "read it properly
like Python does." That is the exact boundary breach. **Demand:** the plan states in one line that the
TS reader is `process.env`, full stop, and CI/Security greps `apps/core-service` for any AWS SDK import
or `package.json` dep as a hard BOUNCE. Bind it as a test, not a hope.

## C4 (MED) — rotation semantics differ from Python and must be stated

Python reads SM at runtime, so rotation is picked up on the provider's `refresh()`. Env-injection
captures the value at **container start** — a rotated secret is NOT picked up until the task restarts.
This is acceptable (Shopify app secret rotates rarely, and the rotation ceremony is Stage-8/Founder-
driven), but it MUST be documented so nobody assumes hot-rotation. **Demand:** the rotation runbook
note (inherited from the parent's T4) gains one line: "core-service picks up a rotated
`SHOPIFY_CLIENT_SECRET` on task restart, not live."

## C5 (MED) — never-log: the assert/error message is the leak risk

`requireEnv` already avoids logging the value. But a new boot-time assert is a NEW place a value could
leak (e.g. a well-meaning "got X, expected non-empty" debug line, or an error that interpolates the
value). **Demand:** CF-TS-NEVERLOG-1 explicitly covers the new assert — message names the var, asserts
presence/non-empty only, never echoes the value; add a negative test (assert error string does not
contain the value).

## Verdict

Mechanism is correct; **platform env-injection is the right ruling and preserves the boundary.** The
real risks are not the choice but the execution: (a) no runtime to smoke → must be a synth-level +
unit-level gate, (b) the assert must be at boot not call-time, (c) the AWS-SDK-import grep must be a
hard test. Escalate: **No** — none of these are canon ambiguities; all are plan-bindable by Aryan.
