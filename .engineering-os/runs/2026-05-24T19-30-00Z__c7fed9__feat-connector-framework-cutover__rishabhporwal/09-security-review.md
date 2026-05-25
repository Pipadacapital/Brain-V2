# Security Review (G4) — feat-connector-framework-cutover (Child 3)

> Reviewer: Shreya (security-reviewer) · Stage 4 · **PARALLEL REVIEW MODE** (Shreya || Tanvi)
> Run: `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal`
> Timestamp: 2026-05-24T22:55:00Z
> Verdict returned to orchestrator; stage NOT advanced (orchestrator reconciles with Tanvi).

## VERDICT: BOUNCE -> backend-developer (Vikram)

1 CRITICAL + 3 HIGH (incl. a traceability VETO). All must-fix-now per `docs/finding-severity-rubric.md`.
Track M (Maya) is substantially clean — the failures are in Track V's integration of the primitives and in the wiring of the gates Maya correctly built. Bounce target = **Vikram** (broken/unwired paths are all Track V: `ingest.py`, `shopify_adapter.py`, allowlist wiring, traceability, table map). Maya's `pii_manifest.py` / `cursor.py` are correct but unconsumed.

---

## Change-class scope

Heavy security surface (high-stakes lane): connector framework, OAuth/HMAC auth, PII/DPDP, 4-layer multi-tenancy (Python RLS re-expression), secrets custody, residency, schema/proto. ALWAYS-ON checks (vuln scans, secrets grep, supply-chain, input-validation, no-money-in-raw-path) ran. Surface-specific gates IN scope: multi-tenancy, secrets, PII/DPDP, residency, auth/HMAC, traceability. India-telecom compliance (DLT/NCPR/WhatsApp/voice/calling-hours/recording-consent): **N/A — out of scope (no outbound channel this child; ingest-only)**. DPDP + residency + PII: **IN scope** (first Brain runtime that will write live PII).

---

## Per-CF resolution

| CF | Verdict | Evidence |
|----|---------|----------|
| CF-C3-PY-SESSION-CTX-1 | PASS | `session_context.py`: tx-local `set_config('app.workspace_id', %s, true)` as FIRST stmt in explicit BEGIN/COMMIT; GUC names identical to Child-1; UUIDv4 guard; fail-closed (empty/None raises, fn never run unbound); ROLLBACK scrubs; bind-param (no SET LOCAL interpolation). `with_superadmin` clears workspace GUC + STATIC-GATE doc. Clean. |
| CF-C3-RLS-CONSUME-1 (DDL half) | PASS | Every raw table: ENABLE + `ws_isolation` USING/WITH CHECK `(workspace_id = current_setting('app.workspace_id', true)::uuid)`. No IS NULL / COALESCE / USING(true). FORCE in step-b (HELD). Symmetric down (NO FORCE -> DISABLE -> DROP POLICY -> DROP TABLE, IF EXISTS). Mirrors Child-1. |
| CF-C3-PII-ADAPTER-GATE-1 | **FAIL — C1 (CRITICAL)** | Gate `ingest_batch` actually calls (`ingest.py::_check_pii_manifest`) is INERT: flags only `is_pii(col) AND get_spec(col) is None`, unreachable with any real PiiManifest -> can never reject. Maya's fail-closed `check_pii_fields` never imported by `ingest.py`. Passing test fabricates an impossible `_FakePiiManifest` double. Undeclared PII (e.g. phone, address) writes straight to raw store. DPDP minimization gate open. |
| CF-C3-CONSENT-COLUMN-1 | PASS | step-a DDL: every PII table NON-NULLABLE workspace_id/lawful_basis/purpose_code/ingested_at + CHECK enums; stamped at write (`_upsert_event` 199-206); never backfilled. Proto carries lawful_basis/purpose_code. |
| CF-C3-SECRETS-INTERIM-1 | PASS | `custody.py` Protocol + both stubs raise NotImplementedError (fail-closed); seal() = STEP 6 (LAST, after write->auth-test->parity). NO plaintext credential value in code, logs, or staged diff. No live credential touched (A/B selection held to Stage-8 per escalation). |
| CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1 (HMAC) | **FAIL — H3 (HIGH)** | `verify_shopify_hmac` uses constant-time compare_digest (good) but computes `.hexdigest()`. Shopify X-Shopify-Hmac-SHA256 is base64 (canonical ref `legacy/.../webhooks.ts:34-42` = digest('base64') + base64 timingSafeEqual). hex-vs-base64 -> False for every genuine signature. Test is tautological (hex in/out). Webhook auth primitive broken. |
| CF-C3-RESIDENCY-ASSERT-1 | PASS | `assert_ap_south_1_residency` checks BOTH DATABASE_URL + DIRECT_URL, named ResidencyAssertionError, refuse-to-start, missing-var fails closed. |
| CF-C3-WORKSPACE-ALLOWLIST-1 | **FAIL — H2 (HIGH)** | `assert_workspace_allowed` / `run_all_gates` called nowhere in `src/` (only in a runbook .md). `ingest_batch` reads credential (custody.get) + writes with NO allowlist check, contradicting the function's own docstring. No entrypoint runs the gates. Sugandh-Lok-only boundary (CF-SEC-3) unenforced at runtime. |
| CF-C3-SINGLE-PRIMITIVE-1 | PASS (M2/M3 caveats) | ONE `ingest_batch` via ConnectorAdapter Protocol; quirks are config. Idempotency UPSERT ON CONFLICT (workspace_id, vendor_event_id). |
| CF-C3-ROLLBACK-CRED-WINDOW-1 / DELETE-SEQUENCE-1 | PASS (runbook) | write->live-auth-test->parity->THEN seal; A4 rollback branch before delete; Shiprocket email/password unrecoverable. Stage-8 artifact. |
| CF-C3-SHIPROCKET-POLL-MODEL-1 | PASS (runbook) | Polling-gap, days=7 first poll, sequenced LAST, 72h + >=2-week pre-shadow. |
| CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1 | PASS (runbook) | 48h re-validation; spend-sum not hard trigger within 48h. |
| CF-C3-PARITY-COUNT-1 | PASS | tests/parity/ count + field-spot-check; no numeric shadow. |
| CF-C3-NO-CUTOVER-AT-FESTIVAL-1 | PASS (runbook) | Scheduling constraint present. |
| CF-C3-FORCE-UNLOCK-SCOPE-1 | PASS | Child-1 HOLD-AT-FORCE ledger notes legacy bare writers die at Shiprocket decommission. |
| Kafka envelope (IntegrationEvent) | PARTIAL — H1 | workspace_id required partition key; no money fields; lawful_basis/purpose_code present. Missing correlation/trace field (H1). |
| CF-BN-NOLEGACY-1 | PASS | git diff --cached: zero legacy project diff. |
| CF-C3-HOLD-AT-CUTOVER-1 | PASS | Zero live token moved; no MSK/Glue/deploy; DDL runbook-gated; custody stubs fail-closed. |

---

## Findings

### C1 (CRITICAL) — PII-manifest gate inert in the live ingest path
`ingest.py:116-145,338`. `_check_pii_manifest` flags only `is_pii(col) AND get_spec(col) is None` — unreachable with a real PiiManifest (declared => has spec; undeclared => is_pii False => skipped). Undeclared PII is never refused. Maya's correct fail-closed `pii_manifest.py::check_pii_fields` (heuristic) is not imported by `ingest_batch`. Passing test (`test_ingest_batch.py:108-134`) fabricates an impossible `_FakePiiManifest`. Fix: route `ingest_batch` through `check_pii_fields(adapter.pii_manifest, normalized.columns.keys())`; delete `_check_pii_manifest`; replace the double-based test with a real-adapter undeclared-PII test (e.g. phone on Shopify -> write refused + counter increments).

### H1 (HIGH) — Traceability VETO: no correlation ID end-to-end
Zero request_id/trace_id/correlation/(workspace_id+user_id) propagation in `src/`; `integrations.proto` has no correlation field. CF-SEC-5 requires correlation through the ingest path + Kafka envelope. Reports claim "Correlation context propagated through session_context.py" / "Trace instrument ... Kafka consumer: PASS" — false in code. Fix: thread a correlation context (request_id+trace_id+workspace_id) through ingest_batch -> with_workspace -> log lines; add correlation_id/trace_id to IntegrationEvent; surface request id on error.

### H2 (HIGH) — Workspace allowlist not enforced in runtime path
`assert_workspace_allowed` / `run_all_gates` called nowhere in `src/`. `ingest_batch` does the credential read + write with no allowlist check; no entrypoint runs startup gates. Sugandh-Lok-only boundary (CF-SEC-3) unenforced. Fix: call `assert_workspace_allowed(workspace_id, allowed)` at the top of ingest_batch (before custody.get); add an entrypoint running run_all_gates() at startup; test rejection of a non-allowlisted workspace.

### H3 (HIGH) — Shopify webhook HMAC encoding mismatch
`shopify_adapter.py:92-97` uses `.hexdigest()`; Shopify header + canonical legacy reference use base64. Verification fails on every real signature; test is tautological. Fix: base64(hmac.new(secret, data, sha256).digest()) and compare_digest against the base64 header (mirror webhooks.ts); test with a real base64 signature fixture.

### M1 (MED) — Production write-path table-name mismatch (Stage-8 latent)
`_RAW_TABLE_MAP` writes un-prefixed (shopify_orders ...); Stage-8 DDL creates raw_shopify_orders .... Every live upsert hits a non-existent relation. Masked by the divergent LOCAL pg-init/01-init.sql. No live conn this child -> latent; fix before Stage-8 (align map <-> DDL; derive the integration init from the real DDL).

### M2 (MED) — Cursor seam unwired + contract drift
`ingest.py::_advance_cursor` uses inline SQL omitting window_start/window_end (NOT NULL in prod connector_cursor) instead of Maya's `cursor.upsert_cursor`; prod INSERT would fail the NOT NULL constraint. Also: per-event with_workspace (N txns) + a separate cursor txn contradicts the documented "cursor in the same transaction as the batch" contract (idempotency key prevents corruption -> not HIGH). Fix: consume cursor.get_cursor/upsert_cursor; commit batch + cursor in one with_workspace transaction.

### M3 (MED) — Dead/duplicate PII gate
`_check_pii_manifest` + PiiManifestRejectionError are inert duplicates of Maya's gate. Remove once C1 routes to canonical check_pii_fields (single source of truth).

### L1 (LOW) — SQL column-name interpolation (bandit B608, Low confidence)
`_upsert_event:217` interpolates col_names + table into the INSERT. Currently safe (table from closed _RAW_TABLE_MAP; columns adapter-controlled, not external; VALUES use %s). Defense-in-depth: per-table column allowlist.

---

## Compliance matrix (Brain regime)
- DPDP Act 2023 + Rules 2025: consent columns PASS; minimization FAIL via C1 (inert PII gate admits undeclared PII); erasure scoping pre-shaped (purpose_code) OK. Blocked on C1.
- Data residency (ap-south-1): PASS — startup assert both URLs, refuse-to-start.
- Sugandh-Lok-only boundary (CF-SEC-3): FAIL via H2 — allowlist not enforced at runtime.
- DLT / NCPR / DND / 9am-9pm / 48h cap / WhatsApp / AI-voice / recording consent: N/A — no outbound channel (ingest-only; verified no SMS/voice/WhatsApp/send path).
- Recording consent: N/A — no capture path.

## Traceability
FAIL (VETO) — H1. No correlation ID on the ingest path or the Kafka envelope.

## Scans
- bandit (uvx, 1459 LOC): 0 HIGH, 1 MEDIUM (B608 Low-confidence on _upsert_event — benign; logged L1), 6 LOW (B105 enum false positives + B101 Protocol-assert test pattern). CLEAN on CRITICAL/HIGH.
- Secrets grep (staged diff): no .env/.pem/.key/secret-value files; secrets/*.py are interface/stub only; no credential value in any log statement. CLEAN.
- No-money-in-raw-path: no decimal.js/minor-units//100/*100/Decimal( in src/ or DDL (comment only). CLEAN.
- Legacy diff: ZERO legacy project files staged. CLEAN.
- pip-audit/safety: not installed in env; deps pinned latest-stable (psycopg 3.3.4, aiokafka 0.14.0, httpx 0.28.1, pydantic 2.12.5) — no invented versions. Re-run at CI/Stage-8; no HIGH in dep set by inspection.
- Tests: independently re-ran pytest (160 passed). Real count but masks unwired seams (C1/H2/M2): each track's tests exercise its own code in isolation; no test covers the integrated ingest_batch path against a real manifest/cursor/DDL.

---

## Gate (G4) result
- Zero CRITICAL — FAIL (C1)
- Zero HIGH — FAIL (H1/H2/H3)
- Zero compliance violations — FAIL (DPDP minimization via C1; CF-SEC-3 via H2)
- Zero missing-traceability — FAIL (H1)
- Every connector OAuth-encrypted + webhook-signed — FAIL (HMAC broken, H3)
- PII not in logs — PASS; Vuln scans clean on CRIT/HIGH — PASS; Custody stubs fail-closed, no secret staged — PASS; RLS DDL fail-closed + FORCE held + symmetric down — PASS

BOUNCE. Bounce target: backend-developer (Vikram) — all blocking findings are Track V; Track M is correct but unconsumed. Re-review the integrated ingest_batch path, not the per-track units.
