# 11 — Final Review (Stage 6, Rohan / cto-advisor — VETO + delegated Founder gate)

| Field | Value |
|-------|-------|
| **req_id** | `connector-webhook-intake` |
| **Reviewer** | Rohan (cto-advisor) |
| **Timestamp** | 2026-05-29T23:30:00Z |
| **Stage** | 6 — final review + delegated Founder gate (standing delegation) |
| **Verdict** | **PASS** |
| **Recommendation** | **APPROVE** |
| **Founder gate** | **SIGNED under standing delegation** — hard-rule deviation scan CLEAN (§ Hard-rule). |
| **Commit** | **PENDING Founder "commit it"** (free text). NOT committed. Jatin makes the `chore(eos):` audit-trail commit at Stage 8. |

---

## Verdict in one line

Verify-first/default-deny is genuinely test-anchored (all 4 load-bearing CRITICAL invariants go RED under MY OWN re-mutation, reverted byte-clean); the generalization (vendor-dispatched registry) did not weaken a single invariant and is proven generic by the 2nd-test-vendor matrix; the slice is `sql`/₹0; nothing live executed; legacy untouched. **PASS → APPROVE → Founder gate SIGNED.** Commit awaits your "commit it."

---

## 1. Independent re-mutation (verify-the-verifier at S6 — the contract requires Rohan re-mutates)

I re-mutated each load-bearing CRITICAL invariant **myself on disk** (separate from Maya's and Tanvi's runs), captured real output, and reverted each byte-clean. Pre-mutation md5 of `webhook_servicer.py` = `df60d31328395a0e6162d1eed689a26c`; post-all-revert md5 = **identical** (byte-clean reverts, mutation markers absent).

| # | Mutation I applied (on disk) | File | Captured result | Verdict |
|---|------------------------------|------|-----------------|---------|
| **1** | `verified = spec.verify_fn(...)` → `verified = True` (flip verify to always-accept) | `webhook_servicer.py:265` | **9 failed, 57 passed** (`test_tampered_body_rejected`, `test_tampered_signature_rejected`, 2nd-vendor bad-sig + map-after-verify, `test_mutation_1_*`, `test_mutation_2_map_before_verify_fires`, `test_mutation_5_full_genericity_matrix_accepted`) | **RED — kill confirmed** |
| **2** | identity resolver called BEFORE verify (reorder map-before-verify) | `webhook_servicer.py` (inserted pre-verify resolver call) | **2 failed, 64 passed** (`test_2nd_vendor_map_after_verify_enforced`, `test_mutation_2_map_before_verify_fires`) | **RED — kill confirmed** |
| **3** | bare `except Exception:` REJECT → `pass` (the BOUNCE-1 fall-open) | `webhook_servicer.py:254` | **2 failed, 64 passed** — `UnboundLocalError`/`RuntimeError: unexpected` propagates (`test_unexpected_exception_from_secret_rejected`, `test_mutation_3_unexpected_exception_rejects_not_accepts`) | **RED — kill confirmed under MY hand** |
| **5** | `_get_registry()` hardcodes `{"shopify": …}` ignoring `request.vendor`/override (genericity/registry-dispatch) | `webhook_servicer.py:119-122` | **5 failed, 61 passed** — `_test_token` correctly REJECTED as `unknown_vendor` (`test_2nd_vendor_accepted/parked_unmapped_identity/ignored_unknown_topic`, `test_mutation_5_*`) | **RED — kill confirmed** |

> **The BOUNCE-1 fix holds under my hand, not just Tanvi's.** Mutation 3 was the one that survived vacuously in Tanvi's first pass (the `if secret is None` belt-guard absorbed the fall-through, making the kill test tautological). Maya's fix (Option A — remove the structurally-unreachable belt-guard; `secret: str` now declared inside the `try` so a fall-through leaves it unbound) is correct: when I apply `except Exception: pass` on disk, `secret` is never assigned and the next line raises `UnboundLocalError`, which propagates as a coroutine error — NOT a silent `OUTCOME_ACCEPTED`. Both mutation-3 kill tests go RED. The belt-guard removal does NOT weaken VERIFY-FIRST-1 (the bare `except Exception` is exhaustive; the guard was dead code).

> Mutation 4 (idempotency anchor → body hash) lives in `webhook_intake.py`; I did not re-apply it on disk this pass (Tanvi + Shreya both re-mutated it RED and it is structurally sound — the kill test asserts `vendor_event_id == "<spec-header-value>"`, which a body hash cannot satisfy). The four I re-ran are the placement-critical set (flip-verify, map-before-verify, fall-open, genericity-dispatch) named in the Stage-6 brief.

### Full-suite re-run (mine, after all reverts)

```
Python (ingestion-service):  329 passed, 14 skipped in 0.96s
Gateway (route.webhook.test.ts):  Test Files 1 passed (1) | Tests 42 passed (42)
```

Both green post-revert. Suites genuinely anchor the invariants — no mutation is silently tolerated.

---

## 2. Plan-binding confirmation (no drift)

Re-read the original requirement (intake `02`/`05`) and the bound plan (§17 + §0-GEN). Every staged file maps to the bound plan; nothing extraneous:

| Staged file | Plan anchor |
|-------------|-------------|
| `protos/brain/ingestion/v1/ingestion.proto` | §0-GEN G1 (generic `ReceiveWebhook` + `vendor`/`headers`) |
| `apps/ingestion-service/src/application/framework/webhook_registry.py` | §0-GEN G2 (the registry — the core generic mechanism) |
| `apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py` | §0-GEN G2 + §2 (registry-dispatch verify-first state machine) |
| `apps/ingestion-service/src/interfaces/grpc/identity_resolver.py` | §0-GEN G3 (`resolve_identity_workspace(vendor, external_identity)`) |
| `apps/ingestion-service/src/interfaces/grpc/webhook_server.py` | §17 Track 2 step 2 (grpc.aio internal-only server) |
| `apps/ingestion-service/src/application/framework/webhook_intake.py` | §0-GEN G5 + §17 Track 2 step 5 (`receive_webhook` push-intake) |
| `apps/ingestion-service/migrations/manual/shop-map/{step-a-create,down}.sql` | §0-GEN G3 + §5 (`connector_identity_map` composite PK) |
| `apps/ingestion-service/tests/integration/pg-init/01-init.sql` | §5 migration mirror + test seed |
| `apps/ingestion-service/pyproject.toml` | §17 Track 2 step 1 (grpcio + grpcio-health-checking) |
| `apps/api-gateway/src/interfaces/route.webhook.ts` | §0-GEN G4 + §17 Track 1 (generic `POST /webhooks/:vendor`) |
| `apps/api-gateway/src/interfaces/webhook-ingest-client.ts` | §0-GEN G4 (`callReceiveWebhook` + `vendor` field) |
| `apps/api-gateway/src/interfaces/{route.webhook,test}.ts` + `tests/unit/test_webhook_servicer.py` | §10 / §17b test contract |
| `apps/ingestion-service/src/interfaces/grpc/{__init__.py, shop_resolver.py}` | package init + provenance-only (see carried items) |

**Plan-binding: CONFIRMED — no drift.** The slice is the single narrow vertical it was scoped to be (one proto RPC, one gateway route, one servicer + one intake fn + one resolver, one tiny table). The deleted `route.webhook-shopify.{ts,test.ts}` are correctly replaced by the generic forms.

---

## 3. Over-engineering audit (engineering-discipline)

| Check | Result |
|-------|--------|
| Every file requirement-mapped | **PASS** — table above; no "while-we're-here" files. |
| New deps justified + smallest | **PASS** — only `grpcio` + `grpcio-health-checking` (the chosen internal transport; explicitly smaller than the barred Option B's FastAPI+uvicorn). NO new npm/lockfile surface (`@grpc/grpc-js` + `@grpc/proto-loader` already present). Floor is `>=1.68.0,<2.0.0` (MED-1 raise-to-`>=1.70.0` HELD-Stage-8 — see §HELD). |
| No speculative abstraction | **PASS** — the registry is a *selector*, not a premature framework: ZERO live Meta/Stripe specs (commented-out example only); the `VendorWebhookSpec` shape is the single forward-looking surface and it is **required by the Founder directive ("100+ sources")**, not speculative. This is the textbook integration-extensible-schema posture (vendor = string discriminator, generic identity map), not gold-plating. |
| Observability proportionate | **PASS** — four webhook counters reuse the existing in-process `_COUNTERS` mechanism; no new metrics backend; alarms authored-not-wired. |
| Plan length proportionate to risk | **PASS** — prescriptive band, folded handoff (no duplicate 07) justified for a single high-stakes slice. |
| No WHAT-comments / trivial-getter tests | **PASS** — comments are CF-rationale (WHY), not line-narration; tests target the verify-first state machine, fidelity, idempotency, tenant isolation, and the 5-mutation kill-set. |

**Over-engineering audit: CLEAN.** No finding.

---

## 4. Single-Primitive sweep

- **Exactly one inbound HMAC verifier:** `verify_shopify_hmac` (`shopify_adapter.py:81`, base64-HMAC-SHA256 + `hmac.compare_digest`), registered ONCE as the Shopify `verify_fn` and called exactly once per request (`webhook_servicer.py:265`). The gateway computes **zero** HMAC (grep clean: no `createHmac`/`crypto.create` in route or client). The gateway's OAuth `validateShopifyHmac` (hex/sorted-query) is a different algorithm/purpose and is NOT reused — correct (CF-HMAC-ALGO-DISTINCT-1).
- **Registry selects per-vendor verify fns** — it does not fork the path. One `ReceiveWebhook` state machine; one `receive_webhook` push-intake. No forked ingest path; `ingest_batch`'s locked signature is untouched (PUSH-INTAKE-1).
- **`connector_identity_map` is string-vendor-discriminated** (composite PK `(vendor, external_identity)`), NOT per-vendor tables — binds the integration-extensible-schema rule (`feedback_integration_extensible_schema`).

**Single-Primitive: CLEAN.**

---

## 5. Hard-rule deviation scan (gates whether I can self-sign)

| Hard rule | Result |
|-----------|--------|
| **Dependency cleanliness** | **CLEAN** — builds on the committed seam from `chore-app-hmac-secret-custody` (status: approved/seam-left): `verify_shopify_hmac`, `select_app_secret_provider()`/`get_shopify_hmac_secret()`, `ingest_batch` internals. No un-shipped blocker consumed. |
| **NO held cutover executed** | **CLEAN** — no live deploy, no Shopify webhook registration, no secret rotation, no real identity-map seed. |
| **NO-LIVE-1** | **CLEAN** — gateway route exported-not-registered (grep: NOT in `server.ts`/`index.ts`); grpc.aio binds `127.0.0.1` default, never `0.0.0.0` (`webhook_server.py:52`); identity-map DDL + seed HELD. |
| **Single-Primitive** | **CLEAN** (§4). |
| **Legacy reference-only** | **CLEAN** — `git diff --stat -- "legacy project/"` == 0. |
| **Compliance (DPDP residency)** | **CLEAN** — PII (email/first/last) lands in ap-south-1 via the existing `with_workspace` + manifest gate; no new PII surface; NEVERLOG verified both sides. |
| **NO-HARDCODED-VENDOR-1 grep-gate** | **CLEAN** — zero vendor-literal branches on the dispatch path (the only matches are CF-contract docstrings/comments). |

**Hard-rule deviation: NONE.** Standing delegation is exercisable → I sign the Founder gate.

---

## 6. Paradigm audit

`@paradigm sql (+ io/event-handling)` on every new module (servicer, registry, intake). Zero LLM/ML/inference import anywhere on the path (grep clean: no litellm/openai/anthropic/sonnet/haiku/`model=`). The whole path is a constant-time HMAC compare + a single Postgres point-lookup + an idempotent UPSERT + a Kafka produce. **₹0 recurring marginal cost** — defends the %-of-GMV cost model (zero frontier-LLM exposure; the gateway being public adds only the Stage-8 ingress/WAF cost already implied). Confirms my Stage-1 first-pass; no deviation introduced at Stage 2.

**Paradigm: PASS.**

---

## 7. Four multi-tenancy layers (write path)

- **JWT** — N/A for the public webhook (Shopify authenticates by HMAC, not a Supabase JWT). The HMAC gate IS the authentication; route is deliberately OUTSIDE the tRPC/JWT plugin. Documented so it is not mistaken for missing-auth.
- **Service-side** — `workspace_id` derived ONLY from `connector_identity_map[verified (vendor, external_identity)]` POST-verify (MAP-AFTER-VERIFY-1, mutation-2 RED). `assert_workspace_allowed(workspace_id, allowed_workspace_ids)` is the backstop before any write (`webhook_intake.py:156`).
- **DB RLS** — the PII write goes through the existing `with_workspace` (P1 RLS) path inside `_upsert_event`. `connector_identity_map` is a system-scoped pre-resolution lookup (composite-PK point lookup; NO PII; documented asymmetry, Shreya PASS).
- **Kafka envelope** — `_produce_kafka` keys + stamps `workspace_id`; unchanged.

**Four-tenancy: PRESENT.** The one deliberate asymmetry (system-scoped identity lookup that PRODUCES the workspace_id) is surfaced, not hidden, and Shreya confirmed it SAFE (no PII, single-row, identity read only post-verify).

---

## 8. Tanvi's non-blocking note (Shreya line-ref shift)

Tanvi flagged that Shreya's VERIFY-FIRST-1 evidence cited a `'secret is None' belt-guard→REJECT(~254)` line that no longer exists after Maya removed the dead belt-guard. **My call: NO Shreya re-touch required.** Rationale: (a) the belt-guard was structurally unreachable dead code (the bare `except Exception` is exhaustive); (b) both Maya and Tanvi confirmed the VERIFY-FIRST-1 *posture* is unchanged; (c) I independently re-mutated mutation 3 on disk and it goes RED via `UnboundLocalError` — the default-deny is load-bearing on the bare `except Exception: return REJECTED`, now the single source of truth for unexpected exceptions. The evidence line shifted; the invariant did not. This is a documentation line-ref drift in a prior artifact, not a security delta — noted, not bounced.

---

## 9. HELD-Stage-8 list (complete + correct — none delegable, none auto-advanced)

The following stay HELD for the Stage-8 Founder/Jatin-at-console ceremony:

1. **Live gRPC server bind** (internal-only; PLACEMENT-1 / NO-LIVE-1).
2. **Public ingress + WAF + TLS** at the gateway for `POST /webhooks/:vendor`.
3. **Register vendor webhook subscriptions** at the real URL (Shopify subscription).
4. **Rotate the compromised `shpss_…`** secret (two-place ceremony; the value at `apps/api-gateway/.env:27` is compromised-by-exposure).
5. **Seed `connector_identity_map`** with the real Sugandh-Lok `('shopify', <shop_domain>, <workspace_id>)` row.
6. **Raise grpcio floor → `>=1.70.0`** (Shreya MED-1) + pin the resolved version in the lockfile (resolves the known-DoS-line admission + the doc/declaration mismatch).
7. **Real vendor test-event round-trip smoke** (Shopify sends a signed test webhook to the registered URL) — the in-slice substitute is the 42-test gateway `inject()` suite + the 329-test Python servicer suite (real-network smoke legitimately HELD, explicitly documented, not silently waived).
8. **botocore/urllib3 DEBUG-loggers-OFF** in the live service (inherited from the custody slice) + **festival-safe window** for the rotation/registration (no Diwali/Republic-Day/EOSS freeze).

List is complete and correct.

---

## 10. Carried non-blocking items (tech debt — none gate this PASS)

- **MED-1** (Shreya/Tanvi): grpcio floor `>=1.68.0` → raise to `>=1.70.0` before Stage-8 (in HELD list above).
- **MED-2** (Shreya): `apps/ingestion-service/src/interfaces/grpc/shop_resolver.py` is dead code (references the dropped `connector_shop_map`; NOT imported — confirmed by grep, the two `webhook_server.py` references are provenance docstrings only). It was deliberately staged as provenance per the plan. **Recommend Maya delete it in the Stage-8 commit prep or a fast-follow.** Unreachable; no security hole; not a drift-bounce.
- **webhook_intake.py v1 vendor coupling** (Tanvi): `_SHOPIFY_ADAPTER` / `_SHOPIFY_TOPIC_TO_EVENT_TYPE` / `ShopifyAdapter` are imported directly (not yet looked up from `VendorWebhookSpec`). Correctly documented as a v1-single-vendor limitation; the `vendor` parameter, `RawEvent.vendor`, and the Kafka topic are already generic. The 2nd-vendor matrix exercises the SERVICER path; intake-path genericity is the vendor-#2 onboarding task. Acceptable for v1; flagged for vendor #2.
- **LOW-1** (Shreya): gateway logs attacker-controllable `vendor`/`bodyLength` pre-verify. Non-PII, low-cardinality, bounded by rate-limit + body-cap. Informational (newline-sanitize-at-logger if log-injection hardening is later desired).
- **MED-3 (out-of-slice)**: Expo `@xmldom/xmldom` HIGH advisories in `apps/mobile` — not attributable to this slice (no mobile/lockfile change). Standing tech debt; owner mobile-developer.

---

## 11. Gate result

- [x] Independent re-mutation: 4 load-bearing CRITICAL mutations RED (captured), all reverted byte-clean (md5 identical)
- [x] Full Python suite re-run by me: 329 passed / 14 skipped
- [x] Gateway suite re-run by me: 42 passed
- [x] Plan-binding confirmed (no drift)
- [x] Over-engineering audit CLEAN
- [x] Single-Primitive sweep CLEAN
- [x] Hard-rule deviation scan: NONE
- [x] Paradigm audit: sql / ₹0
- [x] Four-tenancy layers PRESENT (asymmetry surfaced + SAFE)
- [x] HELD-Stage-8 list complete + correct
- [x] Legacy diff == 0

**Verdict: PASS. Recommendation: APPROVE. Founder gate: SIGNED under standing delegation (hard-rule scan clean).**

---

## 12. Founder-gate sign line

> **SIGNED — Rohan (cto-advisor), 2026-05-29T23:30:00Z, under standing Founder delegation.** Hard-rule deviation scan CLEAN (§5): dependency-clean, NO held cutover executed, NO-LIVE-1 intact, Single-Primitive intact, legacy untouched, DPDP residency intact. This signs the Stage-7 Founder gate for the **reviewed code only**. It is NOT a commit and NOT a live deploy. The commit requires the Founder's free-text **"commit it"** (AskUserQuestion approval is insufficient; the harness blocks the agent commit without it). All live/irreversible steps remain HELD-Stage-8 per §9.

---

## 13. Commit command (mechanical — for Jatin at Stage 8, AFTER Founder "commit it")

> Explicit product-code paths only — **NO `git add -A`**. The `AM` files (`webhook_servicer.py`, `test_webhook_servicer.py`) carry the BOUNCE-1 delta in the working tree on a stale index; the command re-`git add`s the working-tree versions first so the reviewed (post-fix) code is what gets committed. Full file list + proposed message in `pending-founder-commit.md`.

```
git add \
  protos/brain/ingestion/v1/ingestion.proto \
  apps/ingestion-service/src/application/framework/webhook_registry.py \
  apps/ingestion-service/src/application/framework/webhook_intake.py \
  apps/ingestion-service/src/interfaces/grpc/__init__.py \
  apps/ingestion-service/src/interfaces/grpc/webhook_server.py \
  apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py \
  apps/ingestion-service/src/interfaces/grpc/identity_resolver.py \
  apps/ingestion-service/src/interfaces/grpc/shop_resolver.py \
  apps/ingestion-service/migrations/manual/shop-map/step-a-create.sql \
  apps/ingestion-service/migrations/manual/shop-map/down.sql \
  apps/ingestion-service/tests/integration/pg-init/01-init.sql \
  apps/ingestion-service/tests/unit/test_webhook_servicer.py \
  apps/ingestion-service/pyproject.toml \
  apps/api-gateway/src/interfaces/route.webhook.ts \
  apps/api-gateway/src/interfaces/webhook-ingest-client.ts \
  apps/api-gateway/src/interfaces/route.webhook.test.ts
# (route.webhook-shopify.{ts,test.ts} deletions are already staged)
```
Branch: `feat/connector-webhook-intake` off `development` (feature-branch-only; Founder reviews + merges the PR).
