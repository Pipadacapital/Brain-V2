# Retro — feat-connector-framework-cutover (Child 3)

> Filled by CTO Advisor (Rohan) at the close of Stage 6. Append-only — never edited after write.
> Feeds the lessons-learned registry at `.engineering-os/lessons-learned.md`.

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` |
| **Parent req_id** | `chore-migrate-legacy-to-brain` (Child 3 of 7) |
| **Shipped at** | 2026-05-25T02:40:00Z (Stage-6 PASS; Stage-7 signed under delegation; readiness-only, no commit/no live deploy) |
| **Author** | cto-advisor (Rohan), on Founder's behalf under standing delegation |

---

## What worked (concrete patterns to replicate)

- **Naming HOLD-AT-CUTOVER + Option-A ruling killed the Shape-B trap before it could form.** Aryan's §A0.1 explicitly chose LOCAL-only + a Stage-8 STEP-0.5 real-pooler IT over standing up MSK/Glue/deploy inside the highest-risk child. The result: ZERO new live infra to tear down, `git revert` is the rollback, and the only real pre-cutover fact (can a Python service connect+`set_config`+produce against the real pooler) is surfaced at the console where it matters. Replicate on every irreversible-flip child: bind the contracts + gates, defer all live infra behind a named HOLD, and close the "first-live-connection" gap with one specified runbook step — not a staging deploy.
- **Both reviewers verified against actual code, not the bounce-fix report.** Shreya (09b) read `ingest.py:443-457` / `pii_manifest.py:84-130` / the proto fields directly and independently re-ran `183 passed / 14 skipped`; Tanvi (10b) captured verbatim pytest output + 3 killed mutants. When I re-ran the same gates myself, I reproduced every PASS bit-for-bit. This is the standard: a reviewer who trusts the report is not reviewing.
- **The integration tests bind the REAL `SHOPIFY_MANIFEST` and call the live `ingest_batch`.** The round-1 fix replaced every per-track double with a real-path test. My own live-fire (undeclared `phone` → `PiiManifestViolation`, `upserted=0`, `rejections=1`; declared `email` passes) confirmed the gate fires on the integrated path AND does not false-positive — the negative control mattered.
- **Single-Primitive held under real pressure (7 vendors).** One `ingest_batch`, one adapter, quirks as config. No `ingest_shopify`/`ingest_meta` sprawl. The session-context primitive is a *re-expression* of the Child-1 `withWorkspace` contract (same GUC names, same fail-closed), not a second scoping model.
- **CF-C3-FORCE-UNLOCK-SCOPE-1 timing correction was caught at synthesis, not at cutover.** The original framing ("Child-3 shipping unlocks Child-1 FORCE") was wrong — the legacy bare writers live until Shiprocket *decommission*. Logging that in the Child-1 ledger now prevents a premature FORCE later.

---

## What didn't work (concrete patterns to avoid)

- **Per-track green was a false GREEN — the integrated `ingest_batch` had four unwired seams.** Round 1: the PII gate (`_check_pii_manifest`) had a logically-impossible condition and was never wired to Maya's `check_pii_fields`; the allowlist was defined but never called; the Shopify HMAC used hexdigest where Shopify sends base64; correlation IDs existed nowhere in src or proto. Each track's units passed in isolation. The cross-track integration is exactly where the real bugs lived. This is the headline lesson (see below) and it is now the 3rd occurrence of the same class.
- **The PII gate test was a tautology.** `_PiiManifestWithNullSpec` was a hand-crafted double that manufactured the impossible `is_pii AND get_spec is None` condition — so the test could pass against a gate that could never fire on a real manifest. A test that can only pass against a fake is not a test.
- **Two trivial lint items shipped through to final review** (unused `manifest` param at `ingest.py:261`; a deliberate-but-noqa'd lazy `aiokafka` import at `:522`). Cosmetic, zero behavioral/security impact, but they should have been swept in the builder's self-review. Non-blocking; logged for cleanup.

---

## What surprised us

- **The bug class was identical to Child-1 and Child-2 — the verification instrument itself was inert.** I expected the highest-risk child to bounce on a *cutover/reversibility* concern. Instead it bounced on the same "the check doesn't actually check" pattern that bit the RLS probe (Child-1) and the RMM re-derivation (Child-2). The risk wasn't where the architecture spent its worry budget; it was in test wiring. Crossing the ≥3-occurrence threshold this run is what fired the rule candidate.
- **The negative control was load-bearing.** Re-verifying that declared `email` *passes* the PII gate (not just that undeclared `phone` fails) was necessary — a gate that rejects everything is as broken as one that rejects nothing, and a fail-only test wouldn't catch it.
- **Mutation testing did the heavy lifting on confidence.** The 3 killed mutants (PII-gate-removal, session-predicate-inversion, HMAC-hexdigest) are what distinguish "tests pass" from "tests would catch a regression." This is the cheapest insurance against the exact false-GREEN class above.

---

## Lessons to file in the registry

| # | Lesson (one-line) | Applies to | Evidence |
|---|---|---|---|
| 1 | Per-track unit-green is NOT integrated correctness: the cross-track seam (gate-wired-into-the-primitive) must have a real-path test that calls the actual integrated entrypoint with the real collaborator, never a hand-built double. | `process`, `code`, `agent-discipline` | Child-3 round-1 BOUNCE: 4 unwired seams (PII gate, allowlist, HMAC encoding, correlation) all passed their own track's units; Shreya 09b C1/H1/H2/H3, Tanvi 10b F-1..F-7 |
| 2 | A verification/gate that ships structurally inert (impossible condition, hardcoded pass, tautological double) is worse than none — it gives false GREEN at the exact gate that decides the irreversible act. Every high-stakes gate needs a mutation-style test proving the check can FAIL. | `code`, `security`, `numeric-parity`, `migration` | 3rd occurrence: Child-1 RLS probe `return 0`; Child-2 RMM tautology; Child-3 `_PiiManifestWithNullSpec` double + hexdigest self-verify |
| 3 | When a config decision is deferred to a gated ceremony (Founder Option A/B), build BOTH backings stubbed behind one interface so the decision is a config swap, not a re-architecture — and keep the stubs fully fail-closed (`NotImplementedError`). | `migration`, `single-primitive` | Child-3 P4 `CredentialCustody` + `aws_secrets_manager_custody.py` / `supabase_column_custody.py` both stubbed |

---

## Action items for next child (Child 4 — metric registry / materialization)

- **Make the integrated-entrypoint real-path test an explicit Stage-3 DoD line**, not an emergent round-2 fix. The next intake's "Read lessons registry" step should look for: does every cross-track gate have a test that calls the real integrated function with the real collaborator?
- **If the same inert-verification class recurs a 4th time even after this run, escalate the rule candidate's priority** — but the candidate is already written this run (3rd occurrence threshold met).
- Child-4 consumes the raw event-store schema + consent columns + the `IntegrationEvent` topics verbatim. Confirm at Child-4 intake that `lawful_basis`/`purpose_code` per-purpose scoping is actually used by the metric registry's retention/erasure logic (the reason they were made non-nullable day-one).
- Carry forward F3 (Child-2 MED: gate-also-assert-expected_minor_units) — still open for Child-4.
