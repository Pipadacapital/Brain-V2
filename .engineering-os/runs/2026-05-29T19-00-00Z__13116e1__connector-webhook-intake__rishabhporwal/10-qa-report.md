# 10 — QA Report (Stage 5, Tanvi — VETO authority)

**Requirement:** connector-webhook-intake
**Reviewer:** Tanvi (qa-agent)
**Verdict:** BOUNCE
**Date:** 2026-05-29T20:30:00Z
**Mode:** FULL

---

## Summary

BOUNCE on one CRITICAL finding: Mutation 3 (default-deny generic `except Exception` → `pass`) **SURVIVES** when applied on disk — the kill test goes GREEN with the mutation applied, not RED. The mutation is absorbed by the belt-and-suspenders `if secret is None` guard immediately below, making the kill test vacuous for the specific path it claims to prove. All other test coverage, contract checks, and invariants are PASS.

BOUNCE target: **Maya (intelligence-engineer)** — `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` + `apps/ingestion-service/tests/unit/test_webhook_servicer.py`

---

## Test Run Results (fresh, captured this session)

### Gateway TypeScript suite

Command run: `pnpm --filter api-gateway exec vitest run src/interfaces/route.webhook.test.ts`

```
RUN  v4.1.7 /Users/rishabhporwal/Desktop/Brain/apps/api-gateway

 Test Files  1 passed (1)
      Tests  42 passed (42)
   Start at  20:24:43
   Duration  272ms (transform 40ms, setup 0ms, import 134ms, tests 70ms, environment 0ms)
```

**Result: PASS — 42/42**

### TypeScript type check

Command run: `pnpm --filter api-gateway exec tsc --noEmit`

```
(no output, exit 0)
```

**Result: PASS — exit 0**

### Python ingestion-service suite

Command run: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/ -q`

```
ssssssssssssss.......................................................... [ 20%]
........................................................................ [ 41%]
........................................................................ [ 62%]
........................................................................ [ 83%]
.......................................................                  [100%]
329 passed, 14 skipped in 1.05s
```

**Result: PASS — 329/329 passed, 14 skipped (pre-existing unrelated skips)**

### buf build (proto contract)

Command run: `buf build protos`

```
Exit: 0
```

**Result: PASS — proto compiles clean**

---

## Mutation Spot-Checks (Tanvi personally re-mutated on disk)

### Mutation 1: flip verify_fn to always-True

Applied: `verified = spec.verify_fn(...)` → `verified = True`

Suite result with mutation applied:
```
FAILED TestVerifyFirstStateMachine::test_tampered_body_rejected
FAILED TestVerifyFirstStateMachine::test_tampered_signature_rejected
FAILED TestGenericityMatrix::test_2nd_vendor_rejected_bad_signature
FAILED TestGenericityMatrix::test_2nd_vendor_map_after_verify_enforced
FAILED TestGenericityMatrix::test_shopify_request_rejected_as_test_vendor
FAILED TestKillMutations::test_mutation_1_alwaystrue_verify_rejects_tampered
FAILED TestKillMutations::test_mutation_1_invalid_signature_must_reject
FAILED TestKillMutations::test_mutation_2_map_before_verify_fires
FAILED TestKillMutations::test_mutation_5_full_genericity_matrix_accepted
9 failed, 57 passed in 0.07s
```

**Result: RED (9 failures) — KILL CONFIRMED. Reverted clean.**

### Mutation 3: default-deny generic `except Exception` → `pass` (fall-open)

Applied: replaced `return _make_response(OUTCOME_REJECTED, request_id)` in the `except Exception:` handler with `pass`

Suite result with mutation applied:
```
66 passed in 0.07s
```

**Result: GREEN (0 failures) — MUTATION SURVIVES. Kill test is VACUOUS.**

Root cause: The code at `webhook_servicer.py:212` initialises `secret: str | None = None`. When `RuntimeError` is raised and the mutated `except Exception: pass` executes, `secret` remains `None`. The belt-and-suspenders guard at line 245 (`if secret is None: return REJECTED`) fires immediately, producing the correct REJECTED outcome — making the mutation invisible to the kill test.

The security outcome (REJECTED on exception) remains correct because the belt-guard catches it. However, the VERIFY-THE-VERIFIER-1 plan requires all 5 mutations to go RED. Mutation 3's kill test `test_mutation_3_default_deny_catches_bad_signature` and siblings (`test_mutation_3_held_secret_rejects_not_accepts`, `test_mutation_3_unexpected_exception_rejects_not_accepts`) are vacuous: they pass regardless of whether the `except Exception` clause returns REJECTED or falls through.

**Reverted clean. Suite returned to 329 passed.**

---

## Per-CF Verification

| CF | Sev | Verdict | Evidence |
|----|-----|---------|----------|
| VERIFY-FIRST-1 | CRIT | PASS | `webhook_servicer.py:155-285` — default-deny state machine verified by code read. Unknown vendor→REJECT(166), missing sig→REJECT(183-192), secret errors→REJECT(216-250), bad sig→REJECT(276-285). Post-verify line is clear (`#POST-VERIFY ONLY:289`). Mutation 1 confirmed RED (9 kills). |
| MAP-AFTER-VERIFY-1 | CRIT | PASS | `webhook_servicer.py:294-296` — external_identity/topic/vendor_event_id read ONLY after `if not verified:` gate. `_identity_resolver` call at line 302 is post-verify only. Mutation 1 side-kills MAP-AFTER-VERIFY tests (TestKillMutations::test_mutation_2_map_before_verify_fires went RED with M1). |
| VERIFY-THE-VERIFIER-1 (mut 1) | CRIT | PASS | 9 tests RED — confirmed. |
| VERIFY-THE-VERIFIER-1 (mut 2) | CRIT | PASS | Indirectly confirmed: test_mutation_2_map_before_verify_fires went RED under M1; dedicated mutation-2 kill test is present and structurally sound (tracking resolver + assertion on call count before verify). |
| VERIFY-THE-VERIFIER-1 (mut 3) | CRIT | **BOUNCE — VACUOUS** | Kill test GREEN with mutation applied. See §Mutation 3 above. |
| VERIFY-THE-VERIFIER-1 (mut 4) | CRIT | PASS | Kill test `test_mutation_4_anchor_body_hash_loses_update` asserts `vendor_event_id == "vendor-event-id-99999"`. With anchor swapped to body-hash, the received IDs would be `sha256(original_body)` and `sha256(updated_body)` — both different from the expected anchor value — causing the assertion to fail. The kill test is structurally sound. |
| VERIFY-THE-VERIFIER-1 (mut 5) | CRIT | PASS | Confirmed by Shreya's re-mutation on disk (5 failures including TestGenericityMatrix tests). Architecture plan §0-GEN G6 requires this. Structurally confirmed: with hardcoded Shopify spec, `_test_token` → spec is None → REJECTED → `test_mutation_5_hardcode_shopify_spec_breaks_2nd_vendor` assertion `OUTCOME_ACCEPTED == OUTCOME_REJECTED` fails. |
| VENDOR-REGISTRY-DISPATCH-1 | CRIT | PASS | `webhook_servicer.py:164`: `spec = registry.get(vendor)`. Zero `== "shopify"` runtime branches confirmed by live grep (only docstrings/comments matched). TestGenericityMatrix 9-test matrix confirmed via 329/329 green. |
| NO-HARDCODED-VENDOR-1 | HIGH | PASS | Live grep run this session: zero `== "shopify"` / `=== 'shopify'` / `if vendor shopify` on dispatch path files (servicer, intake, identity_resolver, route.webhook.ts, webhook-ingest-client.ts). All grep matches were docstrings/comments. TestNoHardcodedVendorGrep passes (329/329 suite green). |
| SINGLE-PRIMITIVE-1 | HIGH | PASS | `spec.verify_fn` called exactly once at `webhook_servicer.py:274`. No `createHmac`/`crypto.create` in gateway files (grep clean per Shreya + gateway suite). `verify_shopify_hmac` registered as Shopify's `verify_fn` in registry. |
| FORWARD-FIDELITY-1 | HIGH | PASS | `route.webhook.ts:182-198` `parseAs:'buffer'` content-type parser. Gateway test `forwarded Buffer bytes are byte-identical to received bytes` confirmed GREEN (42/42). `buf build protos` exit 0 — `bytes raw_body=2` in proto. |
| IDEMPOTENCY-ANCHOR-1 | HIGH | PASS | `webhook_servicer.py:296`: `vendor_event_id = request.headers.get(spec.idempotency_header, "")`. Flows to `receive_webhook(vendor_event_id=vendor_event_id)` at line 347. `webhook_intake.py:187`: `vendor_event_id=vendor_event_id` in RawEvent. Not a body hash. `test_receive_webhook_uses_vendor_event_id_as_anchor` and mutation-4 kill test structurally sound. |
| REPLAY-NOOP-1 | MED | PASS | Reuses `_upsert_event` ON CONFLICT. No double-write path. |
| CORRELATION-1 | HIGH | PASS | `webhook_intake.py:150`: `_set_correlation(request_id, trace_id, workspace_id, actor="system:webhook")`. `test_correlation_propagated` (green). Gateway test `correlation ids propagated to gRPC call (CORRELATION-1)` green. |
| ABUSE-BOUND-1 | CRIT | PASS | `route.webhook.ts:222-253` rate-limit (429) then body-cap (413), both pre-gRPC. Gateway tests confirm ordering: `rate-limit rejected before body-size check` green. |
| TOPIC-ALLOWLIST-1 | MED | PASS | `webhook_servicer.py:321`: `if topic not in spec.topic_allowlist`. Post-verify only. `test_unknown_topic_ignored_no_write` green. |
| NEVERLOG-1 | VETO | PASS | `TestNeverlogAssertion` 5 tests pass: secret not in logs, sig not in logs, PII email not in logs, response fields clean, 2nd-vendor secret not in logs. Gateway NEVERLOG suite: 5 tests green (sig value absent, PII absent, shpss_ absent, rejected response clean, meta sig absent). |
| PII-RESIDENCY-1 | CRIT | PASS | `webhook_intake.py:199`: `check_pii_fields(SHOPIFY_PII_MANIFEST, ...)` fail-closed. Write via `_upsert_event` uses existing `with_workspace` RLS path (ap-south-1). |
| PLACEMENT-1 / TRANSPORT-1 | MED | PASS | Route exported not registered (grep: no `register(webhookPlugin)` in server.ts). gRPC binds `127.0.0.1` per `webhook_server.py`. |
| NO-LIVE-1 | HIGH | PASS | Plugin not registered. No live gRPC bind. Holds listed in pending-founder-commit.md. |
| connector_identity_map RLS-asymmetry | HIGH | PASS | System-scoped pre-workspace read, composite PK `(vendor, external_identity)`. No PII (shop domain is not PII). Confirmed by Shreya + source read. |

---

## Contract Check

`buf build protos`: exit 0 (captured above).

Proto shape confirmed by file read: `ReceiveWebhook(ReceiveWebhookRequest) returns (ReceiveWebhookResponse)` with `string vendor=1`, `bytes raw_body=2`, `map<string,string> headers=3`, `string request_id=4`, `string trace_id=5`. Matches the servicer's `request.vendor`/`request.raw_body`/`request.headers`/`request.request_id`/`request.trace_id` usage and the gateway client's `callReceiveWebhook` parameters.

`buf lint` has a pre-existing `events/integrations.proto` dir mismatch — pre-existing, out of scope, confirmed not introduced by this slice.

---

## Real-Network Smoke Posture

This slice declares real-network smoke HELD-Stage-8 (pending-founder-commit.md, §10 of architecture plan). The justification is sound: the gRPC server binds `127.0.0.1` (not `0.0.0.0`), the route is exported-not-registered, and no live Shopify webhook subscription exists. A full real-network smoke requires: public ingress + WAF + live webhook subscription + real test-event from Shopify — all HELD-Stage-8 per NO-LIVE-1.

The in-slice substitute is the Fastify `inject()`-based gateway suite (42 tests) and the Python servicer unit suite (329 tests), which together cover the full state machine. These are in-process tests and do not bind real ports. Per the testing-tdd skill, `fastify.inject()` does NOT bind a real port, and a real-network smoke is required for full PASS.

**Determination:** Real-network smoke is legitimately HELD-Stage-8 (explicitly documented, not silently waived). The VETO is not exercised here because: (a) NO-LIVE-1 is the design decision — live deployment is intentionally deferred, (b) the held list is explicit and traceable, (c) the substitute test coverage is substantial. This is noted, not bounced. Stage-8 must capture the real-network smoke before PASS-live.

---

## TS↔Python Metric Parity

This slice is a connector intake path (sql+io paradigm, zero LLM inference, ₹0). There is no metric formula (CM1/CM2/MER/aMER) added in this slice. The parity gate (`tools/check-metrics-parity.py`) is N/A — no metric registry entry added. Explicitly confirmed N/A; not silently waived.

---

## Verification-Validity Assessment

- **Mutation 1** (always-True verify): NOT vacuous — 9 tests went RED. Kill is valid.
- **Mutation 3** (default-deny except → pass): **VACUOUS** — kill test GREEN with mutation applied. The belt-and-suspenders `if secret is None` guard absorbs the fall-through. The `except Exception` REJECT is real defence, but the kill test does not prove it works.
- **Mutation 4** (body-hash anchor): Not personally re-mutated, but structurally sound — the test asserts a string equality that would differ between the spec-header value and the body hash.
- **Mutation 5**: Confirmed by Shreya's re-mutation (5 RED). Structurally sound.
- **NO-HARDCODED-VENDOR-1 grep**: Run live this session — zero dispatch-path violations confirmed.
- **NEVERLOG-1**: Caplog-based assertions (not vacuous — they assert string absence in captured output, which would fail if a secret/PII appeared).

---

## BOUNCE Finding

### BOUNCE-1: Mutation 3 kill test vacuous — `except Exception` REJECT not proven by tests (CRIT)

**File:** `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py:239-250` + `apps/ingestion-service/tests/unit/test_webhook_servicer.py` (TestKillMutations mutation-3 tests)

**Evidence:** Applied mutation (replace `except Exception:` REJECT with `pass`) on disk. Suite ran: 66 passed, 0 failed. Expected: at least 1 failure. The three mutation-3 kill tests (`test_mutation_3_default_deny_catches_bad_signature`, `test_mutation_3_held_secret_rejects_not_accepts`, `test_mutation_3_unexpected_exception_rejects_not_accepts`) all passed because the `if secret is None` guard at line 245 catches the `None` secret left by the fall-through and REJECTs anyway.

**Security impact:** The REJECT outcome for unexpected exceptions is actually still enforced (by the belt-guard), so there is NO security regression. The issue is that the VERIFY-THE-VERIFIER-1 kill-test claim is not validated — we cannot tell from the tests alone whether the `except Exception` return is being exercised, vs. the guard doing the work.

**Required fix (one of two options):**

Option A (preferred): Remove the belt-and-suspenders `if secret is None` guard (lines 252-263) from `webhook_servicer.py`. The guard is redundant IF the except clauses all return early (which they do in production code). Its removal makes mutation 3 truly kill the test. The actual code safety is unaffected because every `except` clause returns REJECTED — `secret` can only be `None` if an exception occurred and was not handled, which is impossible with the belt-guard removed (the bare `except Exception` catches everything). This makes the mutation test valid.

Option B: Keep the belt-guard but add a second mutation test that removes BOTH the `except Exception` return AND the `if secret is None` guard. This tests the deeper fall-open scenario but requires a two-place mutation. The plan's description of mutation 3 does not cover this pattern.

**Bounce target:** Maya (intelligence-engineer)

**Fix scope:** `webhook_servicer.py` lines 239-263 (the `except Exception` block + belt-guard) + the 3 mutation-3 kill tests in `test_webhook_servicer.py`. No other files affected. Full suite must re-run GREEN after fix, and mutation 3 (as described) must go RED.

---

## Standing Tech Debt (not blocking this BOUNCE)

- **MED-1** (Shreya carryover): grpcio floor `>=1.68.0` — raise to `>=1.70.0` before Stage-8.
- **MED-2** (Shreya carryover): `shop_resolver.py` is dead code referencing dropped table. Delete before commit.
- **LOW-1** (Shreya carryover): gateway logs attacker-controllable vendor/bodyLength pre-verify. Non-PII, bounded, low-cardinality. Informational.
- **webhook_intake.py v1 coupling**: `_SHOPIFY_ADAPTER`, `_SHOPIFY_TOPIC_TO_EVENT_TYPE`, `ShopifyAdapter` are directly imported (not parameterized via `VendorWebhookSpec`). This is a documented v1 limitation — "when vendor #2 is onboarded its normalize/manifest will be looked up from VendorWebhookSpec". Not a BOUNCE item (correctly documented), but the 2nd-vendor genericity matrix in `TestGenericityMatrix` exercises the SERVICER path only; it does not exercise the INTAKE path for a non-Shopify vendor (the intake falls back to Shopify's adapter for the 2nd-vendor). This is acceptable for v1-single-vendor. Flag for onboarding vendor #2.

---

## Verdict

**BOUNCE**

Bounce target: Maya (intelligence-engineer)
Bounce finding: BOUNCE-1 — Mutation 3 kill test is vacuous (mutation survives on disk).
Fix: update `webhook_servicer.py` + corresponding `test_webhook_servicer.py` so mutation 3 goes RED.
All other 18 CFs: PASS. All 329 Python tests: PASS. All 42 gateway tests: PASS. buf build: PASS. Real-network smoke: HELD-Stage-8 (explicitly documented).

Return path: After Maya fixes BOUNCE-1 and the mutation goes RED (captured output required), re-submit to Tanvi as DELTA review scoped to: (a) the `except Exception` block + belt-guard in servicer, (b) the mutation-3 kill tests. Tanvi will personally re-apply mutation 3 and confirm RED before PASS.


---

## DELTA RE-REVIEW — 2026-05-29T22:00:00Z (Tanvi, qa-agent) — BOUNCE-1 Fix Verification

**Mode:** DELTA (re-review of BOUNCE-1 only; prior 17 CFs not re-litigated)
**Verdict:** PASS
**Delta scope:** `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` (belt-guard removal) + `apps/ingestion-service/tests/unit/test_webhook_servicer.py` (3 mutation-3 docstrings updated)

---

### 1. Mutation 3 RED proof (Tanvi personally applied on disk, captured fresh)

Applied mutation: replaced `return _make_response(OUTCOME_REJECTED, request_id)` in the bare `except Exception:` block with `pass  # MUTATION-3-APPLIED`.

Captured output:
```
FAILED apps/ingestion-service/tests/unit/test_webhook_servicer.py::TestVerifyFirstStateMachine::test_unexpected_exception_from_secret_rejected
FAILED apps/ingestion-service/tests/unit/test_webhook_servicer.py::TestKillMutations::test_mutation_3_unexpected_exception_rejects_not_accepts

apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py:265: in ReceiveWebhook
    verified = spec.verify_fn(raw_body, signature_header_value, secret)
                                                                ^^^^^^
E   UnboundLocalError: cannot access local variable 'secret' where it is not associated with a value

2 failed, 64 passed in 0.10s
```

Exit code: 1. Mutation GOES RED. Reverted clean (mutation marker absent, return statement confirmed restored).

Kill mechanism confirmed: `secret: str` is declared inside the `try` block (`secret: str = spec.secret_fn(provider)`). When `RuntimeError` fires and `except Exception: pass` fall-through is applied, `secret` is never assigned. The next line (`spec.verify_fn(raw_body, signature_header_value, secret)`) raises `UnboundLocalError` — propagating as a coroutine exception, NOT returning `OUTCOME_REJECTED`. Both kill tests go RED (pytest ERROR). No belt-guard exists to absorb the fall-through.

**BOUNCE-1 RESOLVED.**

---

### 2. All 5 mutations re-run (Tanvi personally applied each, captured, reverted clean)

| # | Mutation applied | File | Failures | Result |
|---|-----------------|------|----------|--------|
| 1 | `verified = spec.verify_fn(...)` → `verified = True` | webhook_servicer.py | 9 failed | RED |
| 2 | identity resolver call moved above verify call | webhook_servicer.py | 2 failed | RED |
| 3 | `except Exception:` REJECT → `pass` | webhook_servicer.py | 2 failed (UnboundLocalError) | RED |
| 4 | `vendor_event_id=vendor_event_id` → body hash | webhook_intake.py | 1 failed | RED |
| 5 | `_get_registry()` → `{"shopify": WEBHOOK_VERIFIERS["shopify"]}` | webhook_servicer.py | 5 failed | RED |

All 5 mutations RED. All reverted clean (confirmed after each revert by assertion that mutation marker is absent).

---

### 3. Full suite green (post-all-reverts)

Command: `uv run --no-sync --project apps/ingestion-service pytest apps/ingestion-service/tests/ -q`

```
ssssssssssssss...................................................... [ 20%]
........................................................................ [ 41%]
........................................................................ [ 62%]
........................................................................ [ 83%]
.......................................................                  [100%]
329 passed, 14 skipped in 0.96s
```

**329 passed / 14 skipped — green.**

---

### 4. Default-deny posture preserved (code inspection, fresh this session)

Confirmed by direct code inspection of the current `webhook_servicer.py`:

- `if secret is None` belt-guard: ABSENT (confirmed by string search)
- `secret: str | None = None` pre-initialization: ABSENT
- `secret: str = spec.secret_fn(provider)` declared inside `try` block: PRESENT
- Bare `except Exception:` block: terminates with `return _make_response(OUTCOME_REJECTED, request_id)` — no `pass`, no fall-through
- All three except clauses (AppSecretUnavailableError / HeldAppSecretError / bare Exception): each `return REJECTED` — exhaustive, no fall-open path

The dead-code removal (option A) does NOT weaken the security posture. The belt-guard was structurally unreachable (bare `except Exception` is exhaustive — every Python exception is caught). Removing it eliminates the mechanism that absorbed mutation 3's fall-through, making the kill test valid without changing production behaviour.

VERIFY-FIRST-1 intact. Default-deny intact. Security posture unchanged.

---

### 5. Scope check (no scope creep)

Maya's delta touched only:
- `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` — belt-guard removed, `secret` annotation tightened, bare except comment updated
- `apps/ingestion-service/tests/unit/test_webhook_servicer.py` — 3 mutation-3 kill test docstrings updated to accurately describe the UnboundLocalError kill mechanism

EOS trail files (`.engineering-os/`) updated by Maya's delta: `intelligence.journal.md`, `pending-founder-commit.md` — expected, not scope creep.

Gateway files (`route.webhook.ts`, `webhook-ingest-client.ts`, `route.webhook.test.ts`) show as new in this branch (T-GEN-B, Vikram's prior session) — NOT touched by Maya's BOUNCE-1 delta. Confirmed by code read and git diff analysis.

---

### 6. Non-blocking note for Rohan (Stage 6)

Shreya's Stage-4 security review (`09-security-review.md`) cited `'secret is None' belt-guard→REJECT(254)` as part of the VERIFY-FIRST-1 evidence. That line no longer exists. The VERIFY-FIRST-1 posture is unchanged — the belt-guard was dead code. The bare `except Exception:` REJECT (now at line ~254) is the single load-bearing default-deny for unexpected exceptions. Rohan should note this line-ref shift when reviewing; it is not a re-review trigger unless Rohan wants one. No security regression.

---

## Final Verdict

**Stage 5 PASS → Stage 6 (Rohan final review)**

- BOUNCE-1 RESOLVED: mutation 3 now goes RED (2 failures, UnboundLocalError — captured fresh this session)
- All 5 mutations RED — captured fresh this session
- 329 passed / 14 skipped — captured fresh this session
- Default-deny posture confirmed intact by code inspection
- No scope creep into gateway or other tracks
- Real-network smoke: HELD-Stage-8 (unchanged — explicitly documented, not silently waived)
- Prior 17 CFs: unchanged PASS (not re-litigated per DELTA mode)

