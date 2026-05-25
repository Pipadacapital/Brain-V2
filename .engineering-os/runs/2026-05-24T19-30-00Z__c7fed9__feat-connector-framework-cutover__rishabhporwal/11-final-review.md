# Final Review — feat-connector-framework-cutover (Child 3)

> Filled by the CTO Advisor (Rohan) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Independent re-verification, NOT a rubber-stamp. Round-2 Security (Shreya, 09b) + QA (Tanvi, 10b) both PASS after a round-1 bounce on the unwired-seam class.
> Validates against schemas/final-review.schema.json.

| Field | Value |
|-------|-------|
| **req_id** | `feat-connector-framework-cutover` (Child 3 of `chore-migrate-legacy-to-brain`) |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-25T02:40:00Z |
| **Verdict** | **PASS** |
| **Shape** | A (framework + first adapter + LOCAL harness + ceremony runbook; ZERO live flip) |
| **Runtime scope** | OPTION A (LOCAL-only + mandatory real-pooler IT at Stage-8 STEP 0.5) |
| **Named HOLD** | HOLD-AT-CUTOVER (live token transfer / webhook re-reg / legacy-plaintext-delete deferred to Stage-8) |

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | Shipped change still solves the Child-0-derived Child-3 requirement: Brain-native connector framework, workspace-scoped idempotent raw ingest, per-connector single-owner cutover ceremony present + LOCAL-verified, FORCE-unlock timing corrected. No drift from `01-requirement.md`. |
| **Paradigm audit** | PASS | `@paradigm: sql + event-handling` on every new code path (`ingest.py`, `shopify_adapter.py`). ZERO inference path — no `frontier_llm`/`small_llm`/ML snuck in. Cost-routing audit clean (LLM tokens/day = 0). No "smart-route / AI-classify incoming events" Child-5 over-reach. |
| **Architecture quality** | PASS | Single-Primitive held: ONE `ingest_batch` (no per-vendor `ingest_shopify`/`ingest_meta`), ONE adapter (Shopify) behind the `ConnectorAdapter` Protocol, per-connector quirks as config. 3 new primitives (ingest P2, custody-interface P4, IntegrationEvent envelope) + 1 re-expression (session-context P1 = the Child-1 `withWorkspace` contract, Python backing). Matches §A0.5 lock verbatim. |
| **Code quality** | PASS (2 trivial lint notes → retro) | Sampled 6 files. Comments explain WHY (CF-* citations, fail-closed rationale), not WHAT. 2 cosmetic items (below) — neither blocks. |
| **Security review pass-through** | PASS | Shreya 09b — 0 CRITICAL / 0 HIGH; C1 + H1/H2/H3 verified resolved in real code paths (not trusted from report); independently re-ran 183 pass / 14 integration skipped; compliance matrix PASS; traceability VETO lifted. |
| **QA review pass-through** | PASS | Tanvi 10b — all 7 round-1 findings resolved; 183 unit+parity (3x stable); 14 integration correctly guarded; coverage 80%; 3 high-stakes mutants KILLED (PII-gate-removal, session-predicate-inversion, HMAC-hexdigest); proto carries correlation 4-tuple; table names aligned. |
| **Observability complete** | PASS (proportionate to HOLD scope) | `ingest_*` counters (received/upserted/deduped/pii-rejections/cred-read-failures/cursor-lag), Shiprocket attempted-vs-connected alarm, correlation 4-tuple on every log line + Kafka envelope + proto, ingest_batch span. Dashboards/alarms authored in the runbook, armed at Stage-8 (correct — no live runtime this child). |
| **Cost estimate held** | PASS | Planned tokens/day = 0 (sql paradigm). Simulated = 0. Variance 0%. Infra ₹0 net-new this child (Option A — no MSK/Glue/deploy pipeline). Within tolerance trivially. |

---

## Independent re-verification (my own captured output — NOT trusted from the reviewers)

I spot-re-ran the load-bearing gates myself. Captured results:

| # | Gate | My captured result | Matches reviewer? |
|---|---|---|---|
| 1 | **Unit + parity suite** | `183 passed in 0.09s` (`pytest tests/ --ignore=integration`) | YES (Shreya 183 / Tanvi 183) |
| 2 | **Integration gating** | `183 passed, 14 skipped in 0.10s` — 14 integration tests correctly guarded by `INTEGRATION_TEST!=1` | YES |
| 3 | **PII gate live-fire (real `ingest_batch`, not a double)** | Built a real adapter bound to the REAL `SHOPIFY_MANIFEST` (declared fields `['email','first_name','last_name']`) emitting an undeclared `phone`; called live `ingest_batch(...,dry_run=True)`: `PiiManifestViolation` RAISED; `ingest_events_upserted_total=0`; `ingest_pii_manifest_rejections_total=1`. **Negative control:** declared `email` field → gate PASSES (no false-positive). | YES (C1 / F-1) |
| 4 | **Allowlist runtime rejection (real `ingest_batch`)** | Non-allowlisted workspace vs `frozenset({WS_A})` → `WorkspaceNotAllowedError` RAISED; `ingest_events_received_total=0` (rejected before any `fetch()`). | YES (H2 / F-3) |
| 5 | **Shopify HMAC base64 == legacy** | Computed legacy reference (`base64.b64encode(hmac sha256).decode()` per `legacy project/backend/src/lib/shopify/webhooks.ts:37 .digest('base64')`): Brain `verify_shopify_hmac` ACCEPTS legacy base64 sig (True), REJECTS hex sig (False), REJECTS wrong secret (False), REJECTS tampered body (False). Constant-time `compare_digest`. | YES (H3 / F-2) |
| 6 | **Correlation in src + proto** | `ingest.py`: contextvars 4-tuple (request_id/trace_id/workspace_id/actor) + `_set_correlation()` + `IngestResult` carries both IDs. `protos/events/integrations.proto`: fields 10 `request_id`, 11 `trace_id`, 12 `actor` — additive (proto3-backwards-compatible). | YES (H1 / F-7) |
| 7 | **Table names == prod DDL** | All 10 `_RAW_TABLE_MAP` entries are `raw_*` and map 1:1 to `step-a-enable-create.sql` `CREATE TABLE` names. `connector_cursor` carries `window_start`/`window_end TIMESTAMPTZ NOT NULL` matching prod DDL. (The `ad_daily`/`email_performance` grep hits are inner event-type keys, not table names.) | YES (M1 / F-4) |
| 8 | **No money in raw path** | grep for `Decimal(`/`/100`/`*100`/`parseFloat`/`Number(`/`minorUnits` in `src/` (excl. raw col names/comments) → CLEAN. Money stays raw vendor strings (Child-2 converts at ACL). | YES |
| 9 | **No legacy edits** | `git diff HEAD -- "legacy project/"` = 0 lines. | YES (CF-BN-NOLEGACY-1) |
| 10 | **HOLD-AT-CUTOVER intact** | No `kubectl`/`terraform apply`/`MSK`/`access_token=`/`ALTER ROLE…PASSWORD` in src. `FORCE ROW LEVEL SECURITY` confined to runbook-gated `step-b-force.sql`/`down.sql` (HELD), absent from `step-a`. Both custody backings (`aws_secrets_manager_custody.py`, `supabase_column_custody.py`) raise `NotImplementedError` in get/put/seal — escalation (Founder Option A/B) deferred to held Stage-8, config swap only. | YES |
| 11 | **Deps within plan** | `pyproject.toml` deps = psycopg/aiokafka/httpx/pydantic/pydantic-settings + dev pytest/pytest-asyncio/testcontainers — exactly the plan §14 set. Real pinned floors, no invented versions (no `betterproto v0.0.3` class). | — |

**I could replicate every reviewer PASS with my own captured output.** No Stage-5 quality gap. Both reviewers verified against actual code paths and re-ran the suite — they did not trust the bounce-fix report. The integration tests bind the REAL `SHOPIFY_MANIFEST` and call the live `ingest_batch` — genuine integrated path, no per-track doubles (the exact round-1 defect).

---

## Plan-binding confirmation

| Binding | Held? | Evidence |
|---|:---:|---|
| **Shape-A boundary (HOLD-AT-CUTOVER)** | YES | No live token / DDL / deploy / MSK / Glue this child; FORCE held; live flip deferred to Stage-8 ceremony. |
| **Option-A runtime** | YES | LOCAL-only docker-compose harness; no @jatin deploy track; real-pooler IT is a named Stage-8 STEP-0.5 predicate (specified in runbook + QA §9). |
| **Custody stubbed both options** | YES | P4 interface + both backings `NotImplementedError`; Founder Option A/B = config swap; escalation (CF-C3-SECRETS-INTERIM-1) deferred to held Stage-8. |
| **Single-Primitive** | YES | One framework (`ingest_batch`) + N adapters; no bespoke per-connector path. |
| **No money in raw path** | YES | grep clean; connectors land raw; Child-2 converts at ACL. |
| **Legacy untouched** | YES | `git diff -- "legacy project/"` = 0. |
| **No Child-4/5 scope pulled forward** | YES | No ClickHouse materialization, no metric registry, no AI surface; consent columns are the legitimate Child-3/4 *seam* (Maya co-owned), not Child-4 work done early. |
| **CF-C3-FORCE-UNLOCK-SCOPE-1** | YES | Logged in the Child-1 ledger (`apps/core-service/migrations/manual/rls/README.md:21-33`): legacy bare writers (discoverChannels/backfill*) stay LIVE until Shiprocket DECOMMISSION; Child-1 FORCE gated there, NOT on Child-3 shipping; the defective `grep -v` is explicitly flagged. |

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `apps/ingestion-service/src/application/framework/ingest.py` | Clean on substance. **Lint note 1 (trivial, non-blocking):** `_upsert_event` (line 261) takes a `manifest: PiiManifest` param that is never referenced in the body (the PII gate runs upstream in `ingest_batch:444`). Dead parameter — cosmetic. **Lint note 2 (trivial, non-blocking):** `import aiokafka` at line 522 is inside the Kafka-produce branch and IS used by the following `_produce_kafka` call — it carries a `# noqa: PLC0415` (deliberate lazy import for test-time optionality), so it is NOT genuinely dead; at most a style preference. Neither has behavioral/security impact; both sit in HOLD-deferred live paths. → retro cleanup. |
| `apps/ingestion-service/src/domain/framework/pii_manifest.py` | Clean. `check_pii_fields` is the single source of truth (round-1 duplicate `_check_pii_manifest` deleted). Heuristic substring set covers email/phone/address/pincode/name. The F-5 "undeclared" placeholder vendor string is documented; `ingest_batch` wraps with real vendor context in the error log. |
| `apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py` | Clean. base64 HMAC + constant-time compare; matches legacy `digest('base64')`. |
| `apps/ingestion-service/src/bootstrap/startup_gates.py` | Clean. `assert_workspace_allowed` + `assert_residency` + `run_all_gates` composed; fail-closed. |
| `apps/ingestion-service/src/infrastructure/secrets/{aws_secrets_manager,supabase_column}_custody.py` | Clean. Both fully stubbed (`NotImplementedError`), no plaintext credential value, Option A/B as config swap. |
| `protos/events/integrations.proto` | Clean. Additive correlation fields 10/11/12; `workspace_id` partition key; NO money fields. |

---

## Over-engineering audit (MANDATORY — per the durable "No over-engineering" rule)

- **Files staged not in the plan?** NO — every file maps to a §17 track (V1–V13 / M1–M5) and a CF-* constraint.
- **Observability/metrics/tests beyond plan?** NO — counters/alarms map to the parity + reliability + lockout needs the requirement names; nothing speculative.
- **Deps beyond plan?** NO — exactly the §14 set; real pinned floors; no invented versions.
- **New abstractions for "future use" (Single-Primitive violation)?** NO — 3 new + 1 re-expression, all consumed this child or by the bound Stage-8 ceremony. Custody's two backings are required by the live Founder Option A/B decision, not speculative.
- **Plan length proportionate?** YES — high-stakes band; mirrors Child-1/Child-2.
- **30+ line WHAT comments?** NO — comments cite CF-* / WHY.

**Result: CLEAN.** The only findings are the 2 trivial lint notes (cosmetic) — they do NOT rise to over-engineering and do NOT block.

---

## Hard-rule deviation check (Stage-6 step 9)

Scanned all artifacts for: dependency violation · Single-Primitive violation · compliance gap · paradigm escalation beyond plan · gate-skip without codified exception.

**NONE present.**
- Dependency: depends only on Child-1 gate (SATISFIABLE Brain-native); no unshipped-blocker violation. Build-base note (Child-1/2 on feature branch, not yet merged to `development`) is a Founder PR-merge sequencing item, not a hard-rule deviation — and is a Stage-8/commit concern, not a Stage-6 blocker.
- Single-Primitive: held (above).
- Compliance: DPDP minimization gate LIVE + fail-closed; residency assert; Sugandh-Lok allowlist enforced at runtime; ingest-only (no DLT/NCPR/WhatsApp/voice surface). No gap.
- Paradigm: `sql` unchanged end-to-end; no escalation.
- Gate-skip: the real-network smoke + live flip are deferred under the *named, plan-bound* HOLD-AT-CUTOVER state (Founder-ratified discipline, twice) — a codified deferral, not a skip.

Auto-approve under standing delegation is therefore permitted (no hard-rule deviation forces a Founder surface).

---

## Auto-candidate rule detection (Stage-6 step 8a)

**FIRED — rule candidate PROPOSED (human-gated; NOT adopted).**

The "structurally-inert verification / false-GREEN at the gate / tautological test double" root cause now appears in **THREE distinct children**:
1. **Child-1** — CF-SEC-1 probe shipped inert (hardcoded `return 0`; integration test ran as `postgres` BYPASSRLS); 1 bounce. (`feat-tenancy-rls-brain-native/14-retro.md:26`)
2. **Child-2** — RMM re-derivation was a tautology (compared against the same fn it called); dead branch. (`feat-money-minor-units-parity/14-retro.md:15`)
3. **Child-3 (this run)** — PII gate's `_check_pii_manifest` had a logically-impossible condition + a `_PiiManifestWithNullSpec` double that manufactured it; HMAC test built the expected sig with the same broken hexdigest. 1 bounce. (Shreya 09b C1, Tanvi 10b F-1/F-2)

≥3 distinct runs, same root cause → candidate rule written to `.engineering-os/rule-proposals/2026-05-25__verify-the-verifier-mutation-on-gate.md` and surfaced to the Founder via `pending-founder-attention.md`. **DO NOT adopt without `/adopt-rule`.** Child-2's retro already flagged "watch for the 3rd" — this is it.

---

## Risks remaining (all correctly deferred to Stage-8 HOLD-AT-CUTOVER)

- **R-CRED-01 / CF-C3-SECRETS-INTERIM-1** — credential-custody mechanism still undecided (Founder Option A vs B). Build correctly proceeded with both backings stubbed; the decision is a config swap, gated at the Stage-8 ceremony. Surfaced (FIRED escalation, on record).
- **N1 (Stage-8 verify)** — the production entrypoint MUST pass `allowed_workspace_ids` from `run_all_gates()`. When `None`, the allowlist no-ops (LOCAL dry_run mode). No production entrypoint exists this child (correct under HOLD), so this is a Stage-8 cutover-review checklist item, not a defect. The gate fires whenever the frozenset is supplied (verified live above).
- **Real-pooler / live-vendor-auth / live-count-parity** — Stage-8 ceremony steps (STEP 0.5 / STEP 2 / STEP 5), specified in the runbook with a concrete predicate; need live creds + Founder at console.

---

## Production-readiness assessment

Would Jatin's Stage-8 gates pass right now? **For the Shape-A readiness scope: YES.** tsc/pytest/coverage/no-legacy/no-live-token/no-money/HOLD-boundary all GREEN and independently replicated. There is intentionally NO live deploy this child — Stage 8 is a readiness pass (mirrors Child-1/Child-2), and the live single-owner cutover is the Founder-gated Stage-8 ceremony executed one connector at a time, Shiprocket last.

---

## What stays HELD for Stage-8 (HOLD-AT-CUTOVER)

1. Live per-connector token transfer + webhook re-registration (Shopify all-shops-atomic) / legacy-cron-disable (Shiprocket polling-gap days=7).
2. Legacy-plaintext-credential delete/seal — STRICTLY after write→live-auth-test→parity (CF-C3-ROLLBACK-CRED-WINDOW-1; A4 branch sits before delete).
3. Founder credential-custody Option A/B selection (CF-C3-SECRETS-INTERIM-1) — config swap; both backings stubbed.
4. Real-pooler integration test (STEP 0.5), live vendor HTTP auth test (STEP 2), live count-parity (STEP 5).
5. MSK/Glue provisioning + the data-deployable deploy pipeline (graduate with the runtime, not this child).
6. Live RLS DDL (`step-b-force.sql`) — runbook-gated, Stage-8.
7. N1 entrypoint wiring (frozenset from `run_all_gates()`) — verify at Stage-8 cutover review.
8. CF-C3-FORCE-UNLOCK-SCOPE-1: Child-1 FORCE remains HELD until Shiprocket DECOMMISSION + complete bare-write grep ZERO hits + sign-off.

---

## Recommendation to Founder

**APPROVE** (Stage-7 gate signed under standing delegation — see below).

### Founder briefing (60 seconds)

Child 3 (the connector framework — the highest-risk child of the legacy→Brain migration) is built Brain-native and LOCAL-verified: one generic ingest primitive + a Shopify adapter, workspace-scoped under RLS, with a fail-closed PII gate, runtime workspace allowlist (Sugandh-Lok-only), base64 Shopify HMAC matching legacy, correlation 4-tuple end-to-end (incl. proto), and a per-connector cutover runbook. Round 1 bounced on a real class of bug — per-track units passed but the integrated `ingest_batch` had unwired seams and tautological test doubles (the PII gate could never actually fire); Vikram rewired all four gates and replaced the doubles with real integrated tests; Shreya and Tanvi both re-verified PASS against the actual code, and I independently re-ran the load-bearing gates with my own captured output and reproduced every PASS. NOTHING live moved — no token, no DDL, no deploy (HOLD-AT-CUTOVER); the live single-owner cutover is your Stage-8 ceremony, one connector at a time, Shiprocket last, gated on your credential-custody Option A/B decision. One process learning recurs for the 3rd time (inert/tautological verification at the gate) — I have written a human-gated rule candidate for your review, not adopted it.

---

## Decision

| Field | Value |
|---|---|
| **Verdict** | PASS |
| **Recommendation** | APPROVE |
| **Stage-7 gate** | SIGNED on Founder's behalf under standing delegation (`feedback_founder_delegates_to_cto_advisor.md` + directive 2026-05-24 "go ahead with all childs without asking, i will approve at last") |
| **Commit authorization** | NOT GRANTED — feature-branch-only + harness guard; nothing staged/committed until Founder free-text "commit it" (autonomous-run no-commit policy) |
| **Next** | Stage-8 readiness (platform-devops, Jatin) — readiness-only, no live deploy; live cutover ceremony remains HELD |
