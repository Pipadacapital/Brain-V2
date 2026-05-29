# 09 — Security Review (Stage 4, Shreya — VETO)

**Requirement:** connector-webhook-intake (public inbound Shopify webhook, Option C: gateway raw → gRPC → ingestion-service verify + push-intake)
**Reviewer:** Shreya (security-reviewer)
**Verdict:** **PASS**
**Date:** 2026-05-29
**Mode:** sequential (return PASS → Stage 5 Tanvi)

---

## Change-class scope

Public, auth-bearing inbound channel — maximal VETO surface. Surfaces IN scope and reviewed:
- Auth/HMAC (the HMAC gate IS the authentication) — IN
- Multi-tenancy isolation (shop→workspace IS the tenant boundary) — IN
- PII / DPDP residency (Shopify payloads carry PII) — IN
- Never-log (raw body / secret / signature / PII) — IN (hard VETO surface)
- Traceability / correlation 4-tuple — IN
- Supply-chain (new Python deps grpcio + grpcio-health-checking) — IN
- Transport/placement (internal-only gRPC; route exported-not-registered) — IN

ALWAYS-ON gates run: vuln scan (best-effort, see Scans), secrets grep, supply-chain, input/forward-fidelity. India-telecom/outbound-compliance (DLT/NCPR/9-9/WhatsApp/AI-voice): **N/A — out of scope** — this is an INBOUND machine-to-machine intake path; no outbound channel, no audience, no notification. DPDP PII-handling IS in scope and reviewed (residency + manifest gate + never-log).

NO-LIVE posture: live deploy, public webhook registration, real secret rotation, prod shop_map seeding all HELD-Stage-8. Nothing in this slice is wired live.

---

## Per-CF verdict (file:line evidence)

| CF | Sev | Verdict | Evidence |
|----|-----|---------|----------|
| VERIFY-FIRST-1 | CRIT | PASS | `webhook_servicer.py:155-252` — default-deny state machine. Missing/empty hmac → REJECT (156); AppSecretUnavailable/Held/bare Exception → REJECT (187,198,208); `secret is None` belt-guard → REJECT (222); `verify=False` → REJECT (244). No ACCEPT/PARK/IGNORE path reachable before a True `verify_shopify_hmac` at :242. Every branch logs outcome+ids. |
| MAP-AFTER-VERIFY-1 | CRIT | PASS | `webhook_servicer.py:254-267` — shop_domain/topic/webhook_id read ONLY after the verify gate (post-`if not verified`). `self._shop_resolver(shop_domain)` at :267 is the first workspace touch; unmapped → PARKED (:268, no write). No DB/workspace touch above the verify line. Confirmed by mutation-2 kill-test. |
| VERIFY-THE-VERIFIER-1 | CRIT | PASS | 4 disk re-mutations each went RED, reverted clean (see §Re-mutations). |
| SINGLE-PRIMITIVE-1 | HIGH | PASS | Exactly one non-test `verify_shopify_hmac` call (`webhook_servicer.py:242`). Gateway has ZERO HMAC computation (grep: no `createHmac`/`crypto.create`/hmac compute in route or client). Distinct from gateway OAuth `validateShopifyHmac` (different algo) — CF-HMAC-ALGO-DISTINCT-1 honored. |
| FORWARD-FIDELITY-1 | HIGH | PASS | Gateway `parseAs:'buffer'` content-type parsers (`route.webhook-shopify.ts:180-197`) capture raw Buffer pre-parse; proto carries `bytes raw_body=1`. Test asserts byte-identical forwarding (`route.webhook-shopify.test.ts:206`). No JSON round-trip. |
| NEVERLOG-1 | VETO | PASS | grep both sides: no raw_body/raw_payload/secret/hmac-value/payload in any log line. Servicer logs only ids+outcome+shop_domain(non-PII)+topic. Intake logs ids+event_type+webhook_id(delivery UUID, non-PII). Gateway logs ids+topic+shopDomain+bodyLength only. Tests assert hmac value, raw body, `shpss_`/`secret` token all ABSENT from log output (test lines 502-562). Response carries only `{outcome, request_id}`. |
| IDEMPOTENCY-ANCHOR-1 | HIGH | PASS | `webhook_intake.py:153` `vendor_event_id=webhook_id` (X-Shopify-Webhook-Id), NOT a body hash. ON CONFLICT no-op on duplicate. Confirmed by mutation-4 kill-test. |
| REPLAY-NOOP-1 | MED | PASS | Reused `_upsert_event` ON CONFLICT DO UPDATE; duplicate delivery = recorded no-op, no double-produce. |
| CORRELATION-1 | HIGH | PASS | request_id+trace_id gateway→proto(3,4)→servicer→`_set_correlation(request_id, trace_id, workspace_id, actor="system:webhook")` (`webhook_intake.py:119`) — full 4-tuple bound + into Kafka envelope. request_id surfaces on all gateway error responses (429/413/503) + proto response echo. |
| TRANSPORT-1 / PLACEMENT-1 | MED | PASS | gRPC server binds `127.0.0.1` default, never `0.0.0.0` (`webhook_server.py:46,63-65`). Gateway plugin exported but NOT registered in server.ts/index.ts (grep confirms NO-LIVE-1). |
| TOPIC-ALLOWLIST-1 | MED | PASS | `webhook_servicer.py:284` topic checked post-verify; unknown → IGNORED, no write. |
| ABUSE-BOUND-1 | CRIT | PASS | Rate-limit (429) + body-cap 512KB (413) BEFORE gRPC forward (`route.webhook-shopify.ts:212-242`); tests assert pre-forward ordering (test 385,433,456). |
| PUSH-INTAKE-1 | MED | PASS | `webhook_intake.py` reuses normalize+PII gate+`_upsert_event`+`_produce_kafka`; no adapter.fetch, no cursor, no window. ingest_batch signature untouched. |
| PII-RESIDENCY-1 | CRIT | PASS | PII lands via reused `with_workspace`+`_upsert_event` (ap-south-1 RLS path). PII manifest gate `check_pii_fields(SHOPIFY_PII_MANIFEST, ...)` fail-closed at `webhook_intake.py:164`. |
| connector_shop_map RLS-asymmetry | HIGH | PASS | No-RLS is SAFE: table holds only `shop_domain`(public Shopify id)→`workspace_id`(UUID)+vendor — NO PII (migration §NO-PII). Read system-scoped pre-workspace (it PRODUCES the workspace_id). Single-row PK point-lookup `WHERE shop_domain=$1` returns only one workspace_id, no topology enumeration on the verify path. Asymmetry documented + intentional. |

---

## The 4 re-mutation results (VERIFY-THE-VERIFIER-1)

| # | Mutation | Result | Killing test(s) |
|---|----------|--------|-----------------|
| 1 | `verify_shopify_hmac` → always `return True` | **RED** (8 failed) | `test_mutation_1_alwaystrue_verify_rejects_tampered`, `test_tampered_signature_rejected`, +6 |
| 2 | resolve shop→workspace BEFORE verify (map-before-verify) | **RED** (3 failed) | `test_mutation_2_missing_hmac_no_workspace_lookup`, `test_mutation_2_map_before_verify_fires` |
| 3 | default-deny generic `except` → `OUTCOME_ACCEPTED` (fall-open) | **RED** (2 failed) | `test_mutation_3_unexpected_exception_rejects_not_accepts`, `test_unexpected_exception_from_secret_rejected` |
| 4 | idempotency anchor → `sha256(raw_body)` instead of webhook-id | **RED** (1 failed) | `test_receive_webhook_uses_webhook_id_as_anchor` |

All four reverted; `git diff` clean on all touched files; full suite re-green (40/40). The test suite genuinely anchors the CRITICAL invariants — mutations are not silently tolerated.

---

## Scans

- **Python unit (servicer + intake):** 40/40 PASS (`tests/unit/test_webhook_servicer.py`).
- **Gateway route:** 30/30 PASS (`route.webhook-shopify.test.ts`).
- **Secrets grep:** CLEAN — no hardcoded `shpss_`/`shpat_`/api-key/password in staged source. Secret fetched at runtime via provider.
- **Supply-chain (npm):** no package.json/lockfile change in this slice → zero new npm surface. `@grpc/grpc-js@1.14.4` + `@grpc/proto-loader@0.7.15` already declared in api-gateway/package.json + lockfile.
- **Supply-chain (Python):** new deps `grpcio>=1.68.0,<2.0.0` + `grpcio-health-checking>=1.68.0,<2.0.0`. See MED-1 below. pip-audit/safety could not bootstrap in this sandbox (ensurepip SIGABRT); CVE assessed manually.
- **pnpm audit:** 5 HIGH + 2 MOD — ALL in `apps/mobile` Expo transitive `@xmldom/xmldom` (<0.8.13). NOT in this slice's diff (slice touches only api-gateway + ingestion-service, no lockfile change). Out-of-slice; not bounced. Logged below.
- **PII-in-logs sample:** CLEAN both sides.

---

## Findings

### CRITICAL: none
### HIGH: none

### MED-1 — grpcio dependency floor permits a known-DoS version (hardening)
`apps/ingestion-service/pyproject.toml` declares `grpcio>=1.68.0,<2.0.0`. grpcio < 1.70.0 has a known DoS (zero-copy transmission data-corruption flaw; cf. CVE-2023-33953 HPACK class in older lines). The range ALSO admits patched 1.70.0+, and a fresh resolve today selects a version well above 1.70.0, so the realized risk is low — additionally the gRPC server is internal-only (127.0.0.1, not public) and HELD-not-live until Stage 8. **Not blocking.** Recommend raising the floor to `grpcio>=1.70.0` (and matching grpcio-health-checking) before Stage-8 cutover and pinning the resolved version in the lockfile. Tech-debt for builder.

### MED-2 (out-of-slice, do not fix here) — Expo `@xmldom/xmldom` HIGH advisories in apps/mobile
5 HIGH + 2 MOD from `apps/mobile` Expo transitive deps (`@xmldom/xmldom` <0.8.13, GHSA-j759-j44w-7fr8). Not attributable to this slice (no mobile/lockfile change). Logged as standing tech debt; owner: mobile-developer in a dedicated dep-bump.

### LOW-1 — gateway logs attacker-controllable shop_domain pre-verify
`route.webhook-shopify.ts:254-265` logs `shopDomain`/`topic`/`webhookId` before forwarding (i.e. before HMAC verify). These are non-PII routing strings, bounded by the body-cap + rate-limit, and low-cardinality. No leak. Informational — if log-injection hardening is desired later, sanitize newlines in header values at the logger. Non-blocking.

---

## Gate (G4) result

- [x] Zero CRITICAL
- [x] Zero HIGH
- [x] Zero compliance violations (inbound-only; DPDP PII residency + manifest gate verified; no outbound/telecom surface)
- [x] Zero missing-traceability (4-tuple end-to-end; request_id on all error responses)
- [x] Auth gate (HMAC) verify-first / default-deny — every branch traced
- [x] Tenant boundary (shop→workspace) resolved ONLY post-verify
- [x] PII not in logs (sampled both sides)
- [x] Vuln scans CLEAN on CRITICAL/HIGH for this slice's surface

**PASS → Stage 5 (Tanvi / qa-agent).** MED-1, MED-2, LOW-1 logged as tech debt; none blocking.

---

# GENERALIZATION RE-REVIEW (Stage 4, Shreya — VETO) — 2026-05-29

**Trigger:** Founder directive — Shopify-specific shape generalized to a vendor-agnostic, registry-dispatched intake (T-GEN-A @maya / T-GEN-B @vikram). Substantial code change + 2 new CFs ⇒ full re-review of the public auth-bearing channel.
**Verdict:** **PASS** (sequential — return PASS → Stage 5 Tanvi)
**Did the generalization weaken any invariant?** **NO.** Every CRITICAL/HIGH invariant from the prior PASS is preserved and re-proven on the generic code; the registry dispatch is default-deny and adds NO fall-open path.

## Scope re-declared
Same maximal VETO surface as the prior PASS (public inbound machine-to-machine auth-bearing channel). India-telecom/outbound-compliance (DLT/NCPR/9-9/WhatsApp/AI-voice) remains **N/A — out of scope** (inbound m2m intake; no outbound channel/audience). DPDP PII residency + manifest gate + NEVERLOG remain IN scope and re-verified. NO-LIVE posture unchanged (route exported-not-registered; gRPC 127.0.0.1; identity-map seed/DDL HELD-Stage-8).

## Re-mutation results (3 required, executed on disk by Shreya)

| # | Mutation | Result | Killing tests |
|---|----------|--------|---------------|
| 1 | `verify_shopify_hmac` → `return True` (always-accept) | **RED** (8 failed) | `test_mutation_1_invalid_signature_must_reject`, `test_mutation_2_map_before_verify_fires`, `TestVerifyShopifyHmacUnit::test_wrong_body/secret/hex_sig_fails`, +3 |
| 3 | generic `except Exception` → `OUTCOME_ACCEPTED` (fall-open) | **RED** (2 failed) | `test_unexpected_exception_from_secret_rejected`, `test_mutation_3_unexpected_exception_rejects_not_accepts` |
| 5 | `_get_registry` hardcodes `{"shopify": …}` (ignore override → 2nd-vendor matrix) | **RED** (5 failed) | `test_2nd_vendor_accepted/parked/ignored`, `test_mutation_5_hardcode_shopify_spec_breaks_2nd_vendor`, `test_mutation_5_full_genericity_matrix_accepted` — `_test_token` correctly REJECTED as `unknown_vendor` |

All three reverted via `git checkout --` (restores staged index content); full suite re-green **329 passed / 14 skipped**. The test suite genuinely anchors the generalized invariants — the registry override is a real dispatch mechanism, not a stub bypass.

## Suites
- ingestion-service: **329 passed, 14 skipped** (`uv run --no-sync pytest tests/ -q`).
- api-gateway route: **42 passed** (`vitest run route.webhook.test.ts`).
- Legacy diff: `git diff --stat -- "legacy project/"` == **0**.
- (17 pre-existing core-notifications failures are NOT in this slice's suite scope; ingestion suite is fully green.)

## Per-CF re-verdict (all 18)

| CF | Sev | Verdict | Evidence (generalized code) |
|----|-----|---------|------------------------------|
| VERIFY-FIRST-1 | CRIT | PASS | `webhook_servicer.py:124-285` — default-deny chain: unknown vendor→REJECT(166), missing sig→REJECT(183), secret AppSecretUnavailable/Held/bare-Exc→REJECT(216/228/239), `secret is None` belt-guard→REJECT(254), `verify=False`→REJECT(276). No ACCEPT/PARK/IGNORE reachable before `spec.verify_fn`==True at :274. Mutation-1+3 RED confirm. |
| MAP-AFTER-VERIFY-1 | CRIT | PASS | identity/topic/idempotency headers read ONLY post-verify (`:294-296`, after the `if not verified` gate); `self._identity_resolver` first workspace touch at :302. No DB/identity read above the verify line. Mutation-2 RED (in M1 run) confirms. 2nd-vendor `test_2nd_vendor_map_after_verify_enforced` confirms it holds for ALL registered vendors. |
| VERIFY-THE-VERIFIER-1 (5 mut) | CRIT | PASS | Mutations 1/3/5 RE-MUTATED on disk by Shreya → all RED, reverted clean (see table). Mutations 2+4 covered by their dedicated kill-tests (green→present; M1 run incidentally tripped mutation-2 test). |
| VENDOR-REGISTRY-DISPATCH-1 (GEN) | CRIT | PASS | Servicer dispatch is `WEBHOOK_VERIFIERS.get(vendor)` (`:162-164`); `spec is None`→REJECT default-deny (:166). Every per-vendor fact (verify_fn/secret_fn/sig+identity+idempotency+topic headers/allowlist) read from the spec — `webhook_registry.py:97-104`. 2nd-vendor (`_test_token`) full matrix ACCEPTED/PARKED/IGNORED/REJECTED GREEN with zero servicer/route/proto edits (`TestGenericityMatrix`). Mutation-5 RED. **Not weakened — strengthened: a spoofed/unregistered vendor cannot fall open, it is the FIRST REJECT branch.** |
| NO-HARDCODED-VENDOR-1 (GEN) | HIGH | PASS | Live grep-gate run by Shreya over servicer+resolver+intake+route+client: ZERO `vendor == "shopify"` / `=== 'shopify'` / `if vendor … shopify` branches on the dispatch path. All raw `shopify` hits are comments/docstrings or the `_SHOPIFY_*` data maps in intake (Shopify-specific normalize/event-type DATA, not a vendor branch — v1 single-vendor, documented). `TestNoHardcodedVendorGrep` per-module regex green. |
| SINGLE-PRIMITIVE-1 | HIGH | PASS | `verify_shopify_hmac` UNTOUCHED (`shopify_adapter.py:81-107`, base64-HMAC-SHA256 + `compare_digest`); registered ONCE as the Shopify `verify_fn`. `spec.verify_fn` called EXACTLY once per request (`:274`). Gateway computes NO HMAC (no `createHmac`/`crypto.create` in route or client). Distinct from gateway OAuth `validateShopifyHmac`. |
| FORWARD-FIDELITY-1 | HIGH | PASS | Gateway `parseAs:'buffer'` for `application/json` + `*` (`route.webhook.ts:182-198`); `rawBody` Buffer forwarded verbatim as proto `bytes raw_body=2`. No JSON round-trip. Byte-identical asserted in gateway suite. |
| NEVERLOG-1 | VETO | PASS | Live grep both sides: NO raw_body/raw_payload/secret/signature/hmac in any log call (servicer/intake/resolver/registry + gateway route/client). Generic header pass-through `collectVendorHeaders` is forwarded but the gateway log line emits only `{requestId,traceId,route,vendor,bodyLength}` — signature header values never logged. `_test_token_secret` absent from logs (`test_2nd_vendor_secret_not_in_logs`). Response carries only `{outcome,request_id}`. |
| IDEMPOTENCY-ANCHOR-1 | HIGH | PASS | `vendor_event_id = request.headers.get(spec.idempotency_header)` (vendor-DECLARED header, `:296`), flows to `RawEvent.vendor_event_id` (`webhook_intake.py:187`); NOT a body hash. Mutation-4 kill-test present. Anchor is now vendor-parameterized per spec — correct generalization. |
| REPLAY-NOOP-1 | MED | PASS | Reused `_upsert_event` ON CONFLICT; duplicate delivery = no-op. Untouched write path. |
| CORRELATION-1 | HIGH | PASS | 4-tuple gateway(`extractCorrelation`)→proto(`request_id=4`,`trace_id=5`)→servicer→`_set_correlation(request_id,trace_id,workspace_id,actor="system:webhook")` (`webhook_intake.py:150`)→Kafka envelope. `request_id` echoed on proto response + all gateway error responses (429/413/503/proto-echo). |
| TRANSPORT-1 / PLACEMENT-1 | MED | PASS | gRPC binds `127.0.0.1` default, never `0.0.0.0` (`webhook_server.py:52,143`); proto marked INTERNAL-ONLY. Gateway plugin exported but NOT registered in server.ts (NO-LIVE-1). Client insecure channel network-policy-scoped to internal CIDR. |
| TOPIC-ALLOWLIST-1 | MED | PASS | `topic not in spec.topic_allowlist` → IGNORED post-verify (`:321`). Allowlist now per-vendor in the spec (`SHOPIFY_TOPIC_ALLOWLIST` relocated to registry). 2nd-vendor `test_2nd_vendor_ignored_unknown_topic` confirms genericity. |
| ABUSE-BOUND-1 | CRIT | PASS | Rate-limit (429) + 512KB body-cap (413) BEFORE gRPC forward (`route.webhook.ts:222-253`). TokenBucket single primitive. Gateway suite asserts pre-forward ordering. |
| PUSH-INTAKE-1 | MED | PASS | `webhook_intake.py` reuses normalize+PII gate+`_upsert_event`+`_produce_kafka`; NO adapter.fetch / cursor / custody read. ingest_batch signature untouched. |
| PII-RESIDENCY-1 | CRIT | PASS | PII write via reused `_upsert_event`+`with_workspace` (ap-south-1 RLS path). PII manifest gate `check_pii_fields(SHOPIFY_PII_MANIFEST,…)` fail-closed (`webhook_intake.py:199`). Generalization did not touch the residency/RLS write path. |
| connector_identity_map RLS-asymmetry (was connector_shop_map) | HIGH | PASS | Composite-PK `(vendor, external_identity)` system-routing table; **NO PII** (`vendor` system key + `external_identity` = public vendor-assigned id [shop domain/page id] + `workspace_id` UUID; migration §NO-PII). Read system-scoped pre-workspace via `WHERE vendor=$1 AND external_identity=$2` (`identity_resolver.py:107-110`) — single-row point lookup, returns only `workspace_id`, no enumeration. **A spoofed `x-shopify-shop-domain`/identity CANNOT map to another tenant pre-verify**: `external_identity` is read ONLY post-verify (`:294`), so an attacker cannot reach the resolver without a valid HMAC. Composite PK prevents cross-vendor identity collision. Asymmetry intentional + documented (§11). |

## Findings

### CRITICAL: none
### HIGH: none

### MED-1 (carryover) — grpcio floor still `>=1.68.0` (declaration permits known-DoS line)
`apps/ingestion-service/pyproject.toml:17-18` declares `grpcio>=1.68.0,<2.0.0` + matching health-checking, while `webhook_server.py:99` ImportError text already cites the intended `grpcio>=1.70.0,<2.0.0`. The range admits patched 1.70.0+ (a fresh resolve selects well above), the server is internal-only (127.0.0.1) and HELD-not-live until Stage-8. **Not blocking.** Raise the floor to `>=1.70.0` and pin the resolved version in the lockfile before Stage-8 cutover (also resolves the doc/declaration mismatch). Tech-debt → builder (Maya).

### MED-2 — orphaned `shop_resolver.py` is dead code referencing the to-be-dropped `connector_shop_map`
`apps/ingestion-service/src/interfaces/grpc/shop_resolver.py` (`resolve_shop_workspace`, `SELECT … FROM connector_shop_map`) is NOT imported or wired anywhere: the servicer default + `webhook_server.py` both use `identity_resolver.resolve_identity_workspace`. References to it survive only as docstring/provenance comments. It is **not reachable** (no security hole today), but it queries `connector_shop_map`, which the generalization replaces with `connector_identity_map` — leaving a stale module that would error if ever re-wired and muddies the SINGLE-resolver story. **Not blocking** (unreachable, no live path). Delete it before commit, or in a fast follow. Tech-debt → builder (Maya).

### MED-3 (out-of-slice) — Expo `@xmldom/xmldom` HIGH advisories in apps/mobile
Carryover from prior review: 5 HIGH + 2 MOD in `apps/mobile` Expo transitive deps. Not attributable to this slice (no mobile/lockfile change). Standing tech debt; owner: mobile-developer.

### LOW-1 (carryover) — gateway logs attacker-controllable `vendor`/`bodyLength` pre-verify
`route.webhook.ts:271-280` logs `vendor` (path param) + `bodyLength` before forwarding. Non-PII, low-cardinality, bounded by rate-limit + body-cap. The full header map is forwarded but NOT logged (NEVERLOG-safe). If log-injection hardening is desired later, sanitize newlines in the `vendor` path-param at the logger. Informational, non-blocking.

## Gate (G4) result — RE-REVIEW
- [x] Zero CRITICAL
- [x] Zero HIGH
- [x] Zero compliance violations (inbound-only; DPDP PII residency + manifest gate + NEVERLOG verified; no outbound/telecom surface)
- [x] Zero missing-traceability (4-tuple end-to-end on generic dispatch + gateway + intake; request_id on all error responses)
- [x] Verify-first / default-deny INTACT on registry dispatch — unknown/spoofed vendor is the FIRST REJECT branch (mutations 1/3/5 RED on disk)
- [x] MAP-AFTER-VERIFY intact for ALL registered vendors (2nd-vendor matrix proves it)
- [x] NO-HARDCODED-VENDOR grep-gate CLEAN (live-run by Shreya)
- [x] `_test_token` confirmed TEST-ONLY (absent from prod `webhook_registry.py`); its verifier is a real constant-time compare, not a bypass
- [x] Single verifier (`verify_shopify_hmac`) untouched; gateway computes no HMAC
- [x] PII not in logs (sampled both sides, incl. generic header pass-through)
- [x] connector_identity_map no-RLS asymmetry SAFE (no PII; post-verify identity; composite-PK point lookup)
- [x] Legacy diff == 0; vuln-surface = pyproject grpcio only (no npm/lock change)

**PASS → Stage 5 (Tanvi / qa-agent).** MED-1, MED-2, MED-3, LOW-1 logged as tech debt; none blocking. The generalization did NOT weaken any auth/tenancy/NEVERLOG/residency invariant.
