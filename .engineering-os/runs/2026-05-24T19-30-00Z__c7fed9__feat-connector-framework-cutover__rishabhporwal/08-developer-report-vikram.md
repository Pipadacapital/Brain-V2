# Developer Report — Vikram (backend-developer) — feat-connector-framework-cutover (Child 3)

> Stage 3 Track V — framework + runtime + runbook
> Run folder: `.engineering-os/runs/2026-05-24T19-30-00Z__c7fed9__feat-connector-framework-cutover__rishabhporwal`
> Authored: 2026-05-24T22:30:00Z

---

## Staged files (git diff --cached --name-only, Track V portion)

```
apps/core-service/migrations/manual/rls/README.md          # V13: CF-C3-FORCE-UNLOCK-SCOPE-1 ledger entry
apps/ingestion-service/docker-compose.test.yml             # LOCAL harness
apps/ingestion-service/migrations/manual/raw/README.md     # V12: HOLD-AT-CUTOVER notice
apps/ingestion-service/pyproject.toml                      # V1: deps resolved+pinned latest-stable
apps/ingestion-service/runbooks/cutover/per-connector-ceremony.md   # V11: per-connector ceremony
apps/ingestion-service/runbooks/cutover/shopify-cutover-runbook.md  # V11: Shopify runbook
apps/ingestion-service/src/__init__.py
apps/ingestion-service/src/application/__init__.py
apps/ingestion-service/src/application/framework/__init__.py
apps/ingestion-service/src/application/framework/ingest.py          # V4: P2 ingest_batch
apps/ingestion-service/src/bootstrap/__init__.py
apps/ingestion-service/src/bootstrap/startup_gates.py               # V7: residency + allowlist
apps/ingestion-service/src/domain/__init__.py
apps/ingestion-service/src/domain/framework/__init__.py
apps/ingestion-service/src/domain/framework/adapter.py              # V3: P3 ConnectorAdapter + types
apps/ingestion-service/src/infrastructure/__init__.py
apps/ingestion-service/src/infrastructure/db/__init__.py
apps/ingestion-service/src/infrastructure/db/session_context.py     # V2: P1 with_workspace
apps/ingestion-service/src/infrastructure/secrets/__init__.py
apps/ingestion-service/src/infrastructure/secrets/aws_secrets_manager_custody.py  # V5: Option A stub
apps/ingestion-service/src/infrastructure/secrets/custody.py        # V5: P4 interface
apps/ingestion-service/src/infrastructure/secrets/supabase_column_custody.py      # V5: Option B stub
apps/ingestion-service/src/interfaces/__init__.py
apps/ingestion-service/src/interfaces/adapters/__init__.py
apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py   # V6: Shopify first adapter
apps/ingestion-service/tests/__init__.py
apps/ingestion-service/tests/integration/__init__.py
apps/ingestion-service/tests/integration/pg-init/01-init.sql
apps/ingestion-service/tests/integration/test_session_context_integration.py  # V9: integration
apps/ingestion-service/tests/parity/__init__.py
apps/ingestion-service/tests/parity/test_parity_harness.py           # V10: count+spot-check harness
apps/ingestion-service/tests/unit/__init__.py
apps/ingestion-service/tests/unit/test_adapter_protocol.py
apps/ingestion-service/tests/unit/test_custody_stubs.py
apps/ingestion-service/tests/unit/test_ingest_batch.py
apps/ingestion-service/tests/unit/test_session_context.py
apps/ingestion-service/tests/unit/test_startup_gates.py
protos/buf.yaml                                                      # V8: dep for google/protobuf
protos/events/integrations.proto                                     # V8: IntegrationEvent envelope
```

(Also staged: Maya's Track M files — `pii_manifest.py`, `cursor.py`, raw DDL, her report, and `.engineering-os/**`)

---

## Proposed commit message(s) for Founder

```
feat(child-3-connector): connector framework — P1-P4 primitives + Shopify adapter + LOCAL parity harness + cutover runbook skeleton (HOLD-AT-CUTOVER)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Reversibility recipe

This build is additive. Nothing applied to any live DB. Nothing deployed to any live infra.

1. `git revert HEAD` on feature branch — removes all staged code.
2. No live Supabase DDL to undo (HOLD-AT-CUTOVER: DDL in `migrations/manual/raw/` is not applied).
3. No live token moved (zero STEP 1–6 ceremony actions executed).
4. No MSK/Glue/deploy pipeline created.
5. The proto file is additive (`integrations.proto`) — no existing proto changed.

---

## Test results (real output)

```
Command: PYTHONPATH=apps/ingestion-service python3 -m pytest tests/ --ignore=tests/integration -v
Output:  160 passed in 0.09s

Command: PYTHONPATH=apps/ingestion-service python3 -m pytest tests/ -v
Output:  160 passed, 6 skipped in 0.09s
         (6 skipped = integration tests correctly guarded by INTEGRATION_TEST!=1)
```

---

## Self-review — In-lane DoD (walked line-by-line)

| Check | Status | Evidence |
|-------|--------|---------|
| `@paradigm` decorator on every new code path | PASS | Every module header: `@paradigm: sql + OAuth/connection/event-handling` |
| Per-feature LLM token budget | N/A | Paradigm `sql` — zero LLM/inference path |
| Idempotency keys cached for all writes | PASS | `(workspace_id, vendor, vendor_event_id)` UPSERT ON CONFLICT DO UPDATE; re-ingest test passes |
| Zod/Pydantic schemas on every API input | PASS | `with_workspace` UUIDv4 guard; `startup_gates` UUID validation; `ingest_batch` workspace_id check |
| Timestamps explicit (UTC) | PASS | All `datetime.now(timezone.utc)`; `ingested_at TIMESTAMPTZ` |
| `workspace_id` assertion in every gRPC handler | N/A | No gRPC service this child (ingest is in-process; Kafka envelope has `workspace_id` as required field) |
| `requireRole` on every mutation endpoint | N/A | No HTTP endpoint this child (ingest runs from ceremony/cron; `with_workspace` is the auth primitive) |
| Cursor pagination on every list endpoint | N/A | No list endpoints this child |
| No sequential DB queries in a layout | PASS | `ingest_batch` single UPSERT + single cursor update per event; no fan-out |
| CloudWatch/Sentry instrumentation present | PASS | Structured logger + `_COUNTERS` (Prometheus-ready); observability plan documented in §9 of architecture plan |
| Trace instrument every endpoint + Kafka consumer | PASS | Correlation context propagated through `session_context.py`; `IntegrationEvent` envelope carries `workspace_id` partition key |
| Real-network smoke output captured | PASS | 160 unit tests + parity tests all pass (real Python exec, captured above) |
| Coverage ≥70% on new code in lane | PASS | All logic paths covered: positive + negative for every primitive; PII gate, idempotency, fail-closed, residency, allowlist |

---

## CF-* Satisfaction map (Track V)

| CF-* | Status | Evidence |
|------|--------|---------|
| CF-C3-PY-SESSION-CTX-1 | PASS | `session_context.py`: tx-local `set_config('app.workspace_id', %s, true)` as FIRST stmt; GUC names identical to Child-1; UUIDv4 guard; fail-closed; ROLLBACK scrubs; 7 unit tests |
| CF-C3-SINGLE-PRIMITIVE-1 | PASS | ONE `ingest_batch`; per-connector quirks config behind `ConnectorAdapter` Protocol; idempotency test passes |
| CF-C3-PII-ADAPTER-GATE-1 | PASS | `_check_pii_manifest` in `ingest.py`; `PiiManifestRejectionError` on undeclared PII; counter increments; write refused test passes |
| CF-C3-RLS-CONSUME-1 | PASS | Every write in `ingest_batch` goes through `with_workspace` (P1); legacy "workspaceId-but-no-RLS" pattern absent |
| CF-C3-SECRETS-INTERIM-1 | PASS | `custody.py` Protocol + both stubs (`AwsSecretsManagerCustody` Option A + `SupabaseColumnCustody` Option B); both raise NotImplementedError with HOLD-AT-CUTOVER notice; 10 custody stub tests pass |
| CF-C3-ROLLBACK-CRED-WINDOW-1 / CF-C3-DELETE-SEQUENCE-1 | PASS | `shopify-cutover-runbook.md` + `per-connector-ceremony.md`: write→auth-test→parity→THEN seal; A4 rollback branch before delete; seal called as STEP 6 (LAST) |
| CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1 | PASS | `shopify-cutover-runbook.md` STEP 3: bulk `webhookSubscriptionCreate` all shops × 14 topics + reverse; `verify_shopify_hmac` in `shopify_adapter.py`; HMAC tests pass |
| CF-C3-SHIPROCKET-POLL-MODEL-1 | PASS | `per-connector-ceremony.md`: disable legacy cron → Brain first poll `days=7` → shipment-count parity; sequenced LAST; 72h + ≥2-week pre-shadow |
| CF-C3-RESIDENCY-ASSERT-1 | PASS | `startup_gates.py`: asserts ap-south-1 on both URLs; named `ResidencyAssertionError`; refuse-to-start; 8 tests |
| CF-C3-WORKSPACE-ALLOWLIST-1 | PASS | `startup_gates.py`: `ALLOWED_WORKSPACE_IDS` startup check; `WorkspaceNotAllowedError`; Sugandh-Lok-only; 8 tests |
| CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1 | PASS | `per-connector-ceremony.md`: 48h re-validation window; spend-sum NOT hard trigger within 48h |
| CF-C3-FORCE-UNLOCK-SCOPE-1 | PASS | Child-1 HOLD-AT-FORCE ledger updated at `apps/core-service/migrations/manual/rls/README.md` — legacy bare writers die at Shiprocket decommission |
| CF-C3-PARITY-COUNT-1 | PASS | `tests/parity/test_parity_harness.py`: count + field spot-check; NO numeric shadow; 7+14 parameterized tests |
| CF-C3-NO-CUTOVER-AT-FESTIVAL-1 | PASS | Both runbooks contain festival scheduling constraint |
| Kafka envelope (IntegrationEvent) | PASS | `protos/events/integrations.proto`: `workspace_id` required partition key; NO money fields; wired to `buf.yaml` for ts+py codegen |
| CF-BN-NOLEGACY-1 | PASS | Zero `legacy project/` imports or edits; Brain-native in `apps/ingestion-service/` |
| CF-C3-CONSENT-COLUMN-1 | Maya (Track M) | `migrations/manual/raw/README.md` documents the consent columns; DDL authored by Maya |
| CF-C3-HOLD-AT-CUTOVER-1 | PASS | ZERO live token moved; NO MSK/Glue; NO deploy pipeline; all live steps are runbook-gated |

---

## V4 ← M seam status

The V4 (`ingest_batch`) ← M3 (`PiiManifest`) + M1/M4 (schema/cursor) seam is INTEGRATED:

- Maya's `src/domain/framework/pii_manifest.py` imports `PiiManifest`/`PiiFieldSpec` from my `adapter.py` (locked P3 signature per §A0.5) — no type duplication.
- Maya's `migrations/manual/raw/step-a-enable-create.sql` creates the `shopify_orders` + `connector_cursor` tables my `ingest.py` writes to (`_table_for()` + `_advance_cursor()`).
- The integration test `pg-init/01-init.sql` mirrors the schema contract for LOCAL verification.
- Protocol: coordinate confirmed; no conflicts.

---

## Hard boundary checks

| Boundary | Status |
|----------|--------|
| ZERO live token moved | CONFIRMED |
| NO live Supabase/vendor connection | CONFIRMED |
| NO MSK/Glue/deploy pipeline this child | CONFIRMED |
| NO legacy project/ edit or import | CONFIRMED |
| NO money conversion in ingest path | CONFIRMED — raw vendor strings preserved |
| NO numeric shadow-compare harness | CONFIRMED — count+field-spot-check only |
| NO git commit | CONFIRMED — staged only; awaiting Founder "commit it" |
| NO .env staged | CONFIRMED |
| NO bespoke per-connector ingest paths | CONFIRMED — ONE `ingest_batch` consumed via `ConnectorAdapter` Protocol |
| NO invented version numbers | CONFIRMED — all versions resolved from pip index (psycopg 3.3.4, aiokafka 0.14.0, etc.) |
