# Handoff to Builders — feat-connector-framework-cutover (Child 3)

> Authored by Aryan (Architect), Stage 2. **Prescriptive** depth (high-stakes + 6 trigger surfaces + first-live-Brain-runtime + irreversible per-connector cutover + scope-creep-prone). Binding companion to `06-architecture-plan.md` — every signature/path/§ reference below is verbatim from that plan; this handoff does NOT introduce any new decision.
> Builders: **@vikram (backend-developer)** — Track V (framework/runtime/runbook) + **@maya (intelligence-engineer)** — Track M (raw event-store schema/consent columns/PII manifest, the co-owned seam). Run **in PARALLEL**. **No @jatin deploy-pipeline track this child** (Option A ruling — §A0.1).
> Timestamp: 2026-05-24T20:55:00Z

---

## 0. The one-paragraph mission

Build the **Brain-native connector/ingestion framework** in `apps/ingestion-service` (currently a bare DDD scaffold) as **ONE generic ingest primitive + N adapters (config, not bespoke paths)**, LOCAL-verified against a docker-compose harness (local Postgres + local Kafka), with EVERY live flip deferred behind the named **HOLD-AT-CUTOVER** state. Ship: the Python session-context primitive (P1), the single ingest primitive (P2), the adapter interface (P3) + **Shopify first adapter**, the credential-custody interface (P4) with BOTH backings stubbed, the `IntegrationEvent` Kafka envelope proto, the startup gates (residency + workspace allowlist), the raw event-store schema (Track M, runbook-gated DDL with day-one non-nullable consent columns), the LOCAL parity harness (count-based + field spot-check — NOT a numeric shadow), and the per-connector Stage-8 ceremony runbook. **ZERO live token moved. ZERO live Supabase connection. NO MSK/Glue/deploy pipeline. NO legacy edit. NO money conversion (connectors land raw — Child-2 converts at the ACL).**

---

## 1. Hard boundaries (a violation = drift bounce by Shreya/Tanvi)

1. **ZERO live token moved, ZERO live Supabase/vendor connection, ZERO MSK/Glue provisioned, NO deploy pipeline this child** (Option A, §A0.1 + CF-C3-HOLD-AT-CUTOVER-1). LOCAL docker-compose only. The real-pooler integration test, live HTTP auth test, and live count-parity are **Stage-8 runbook steps**, not Stage-3 tests (§10 DEFERRED block).
2. **`legacy project/` is reference-only** — read for logic, import/edit/commit NOTHING (CF-BN-NOLEGACY-1). The legacy `discoverChannels`/`backfillShiprocketCourierNames`/`backfillShiprocketPincodes` bare writers are NOT edited — the Brain framework IS their replacement; they retire at Shiprocket decommission (CF-C3-FORCE-UNLOCK-SCOPE-1). Any `legacy project/` diff fails Stage 4.
3. **NO money conversion in the ingest path** — connectors land **raw** (vendor-shape money stays as-is); Child-2 `brain_metrics`/`lib-metrics` converts at the ACL (§7 Single-Primitive sweep, "Money conversion → DO NOT touch"). Pulling money in violates the scope carve-out.
4. **NO numeric shadow-compare harness** — Child-3 parity is **count-based + field-spot-check only** (CF-C3-PARITY-COUNT-1, Child-0 carve-out lines 655-669). Building a numeric harness is a drift bounce.
5. **NO bespoke per-connector ingest paths** — per-connector quirks are CONFIG behind `ConnectorAdapter` (P3), not N code paths (CF-C3-SINGLE-PRIMITIVE-1).
6. **NO invented version numbers** — Python deps are pinned at "resolve+pin latest-stable" by the builder (§14). The proto plugins are already real+pinned (`betterproto v1.2.5`, `protoc-gen-es v2.4.0`). Inventing a version = the `betterproto v0.0.3` bounce class.
7. **NO new app-layer scoping model** — `with_workspace` (P1) is a Python-native re-expression of the SAME Child-1 `withWorkspace` contract (identical GUC names, identical fail-closed, tx-local `set_config`), NOT a new model (CF-C3-RLS-CONSUME-1 / CF-C3-PY-SESSION-CTX-1).
8. **No commit without explicit Founder "commit it."** Feature-branch only.

---

## 2. Locked interface signatures + paths (the contract — verbatim §A0.5; any change = a CTOA-gated plan amendment, never a build-time drift)

Both builders code to these. They are the parallel-work contract.

| Primitive | Path | Exported signature (load-bearing) |
|---|---|---|
| **(P1) Python session-context** — CF-C3-PY-SESSION-CTX-1 | `apps/ingestion-service/src/infrastructure/db/session_context.py` | `async def with_workspace(workspace_id: str, fn: Callable[[psycopg.AsyncConnection], Awaitable[T]]) -> T` · `async def with_superadmin(fn) -> T`. Session-mode (`DIRECT_URL :5432`), tx-local `set_config('app.workspace_id', $1, true)` as the FIRST statement inside `BEGIN/COMMIT`; GUC names IDENTICAL to Child-1 (`app.workspace_id`, `app.is_superadmin`); UUIDv4 guard (mirrors Child-1 UUID_REGEX); fail-closed (empty/None raises, never runs `fn` unbound); ROLLBACK scrubs. `with_superadmin` STATIC-GATE: callable only from cron outer-enumeration + DPDP erasure + residency/probe paths (grep before deploy). |
| **(P2) Single ingest primitive** — CF-C3-SINGLE-PRIMITIVE-1 | `apps/ingestion-service/src/application/framework/ingest.py` | `async def ingest_batch(adapter: ConnectorAdapter, workspace_id: str, window: IngestWindow, *, dry_run: bool = False) -> IngestResult`. Path: OAuth/cred read → per-adapter PII-manifest check → idempotent UPSERT under `with_workspace` → Kafka produce `integrations.<vendor>.v1` → cursor persist → raw archive. Idempotency key `(workspace_id, vendor, vendor_event_id)` UPSERT ON CONFLICT DO UPDATE; re-ingest is a no-op on counts. SAME path for live + backfill (bounded vs unbounded window). `dry_run` for the LOCAL harness. |
| **(P3) Adapter interface** — CF-C3-SINGLE-PRIMITIVE-1 + CF-C3-PII-ADAPTER-GATE-1 | `apps/ingestion-service/src/domain/framework/adapter.py` | `class ConnectorAdapter(Protocol)` with `vendor`, `pii_manifest: PiiManifest`, `token_model: TokenModel`, `replay: ReplayCapability`, `async fetch(creds, window) -> AsyncIterator[RawEvent]`, `normalize(raw) -> NormalizedEvent` (NO money conversion — lands raw), `idempotency_key(raw) -> str`. |
| **(P4) Credential-custody interface** — CF-C3-SECRETS-INTERIM-1 | `apps/ingestion-service/src/infrastructure/secrets/custody.py` | `class CredentialCustody(Protocol)` with `async get(workspace_id, vendor) -> Credential`, `async put(...)`, `async seal(...)` (delete/encrypt-in-place at cutover STEP 6). BOTH backings stubbed this child: `secrets/aws_secrets_manager_custody.py` (Option A — IAM-scoped GetSecretValue, ap-south-1) + `secrets/supabase_column_custody.py` (Option B — read over `with_workspace` RLS-session conn; seal = encrypt column). Founder Option A/B is a CONFIG swap, not a re-architecture. App-level `SHOPIFY_CLIENT_SECRET` is a separate custody line (config key `shopify.app_hmac_secret`). |
| **Kafka envelope proto** | `protos/events/integrations.proto` | `IntegrationEvent`: `workspace_id` (partition key), `vendor`, `vendor_event_id` (idempotency), `event_type`, `occurred_at`, `ingested_at`, `payload` (bytes — raw vendor JSON), `lawful_basis`, `purpose_code`. NO money fields. Topic `integrations.<vendor>.v1`; partition key = `workspace_id`. Codegen → `packages/proto-ts/gen` + `pylibs/proto_py/proto_py/_gen`. |

---

## 3. Acceptance contract — REQUIRED build-time items (shift-left; address in PASS 1, not via a review bounce)

Every `must-fix` below is a known risk a reviewer WILL bounce on (the O7 rework class). Fold it in now (system-prompt §11 self-review). Owners as bound in §17 + §5 + §11.

| ID | Sev | Owner | Acceptance criterion (binary) |
|----|-----|-------|-------------------------------|
| **CF-C3-PY-SESSION-CTX-1** | **must-fix (HIGH)** | @vikram | `with_workspace`/`with_superadmin` at the locked path+signature; tx-local `set_config('app.workspace_id', $1, true)` as the FIRST statement in `BEGIN/COMMIT`; GUC names IDENTICAL to Child-1; UUIDv4 guard; fail-closed (empty/None raises); ROLLBACK scrubs context. A LOCAL integration test proves a second workspace's session reads **0** of the first's raw rows. |
| **CF-C3-SINGLE-PRIMITIVE-1** | **must-fix (HIGH)** | @vikram | ONE `ingest_batch` primitive consumed N times; per-connector quirks are config behind `ConnectorAdapter` (P3); NO bespoke per-connector path. Re-ingesting the same batch leaves `events_upserted` unchanged + increments `events_deduped` (idempotency test). |
| **CF-C3-PII-ADAPTER-GATE-1** | **must-fix (HIGH)** | @maya (manifest) + @vikram (gate call) | The ingest primitive **refuses to write** a field flagged personal-data unless the adapter's `PiiManifest` declares its `lawful_basis` + `purpose_code` (fail-closed). A test proves an undeclared-PII field → write refused + `ingest_pii_manifest_rejections_total` increments. |
| **CF-C3-CONSENT-COLUMN-1** | **must-fix (HIGH before Stage-8; MED build)** | @maya | Every PII-bearing raw table carries NON-NULLABLE `workspace_id`/`lawful_basis`/`purpose_code`/`ingested_at` from day one, stamped at ingest-write, never backfilled. `lawful_basis` init `owner_brand_controller`; `purpose_code` enum-checked (`analytics_performance`/`logistics_tracking`/`email_performance`/`catalog_sync`). DDL in `migrations/manual/raw/` (runbook-gated, Stage-8-only). |
| **CF-C3-RLS-CONSUME-1** | **must-fix (HIGH)** | @vikram + @maya | EVERY raw-store write goes through `with_workspace` (P1) → Child-1 fail-closed `ws_isolation` policy shape (ENABLE+CREATE step-a, FORCE step-b, symmetric down.sql). The legacy "workspaceId-but-no-RLS" model is NOT reproduced. |
| **CF-C3-SECRETS-INTERIM-1** | **must-fix (HIGH, build-gating)** | @vikram + Founder (decision) | `CredentialCustody` interface (P4) + BOTH backings stubbed; the selected backing never logs/serializes a credential; `seal()` is the LAST cutover step. **Build is GATED on the Founder Option A/B decision** (see §6) — the interface is built stubbed regardless, but the runbook's truthful custody mechanism + the backing selection wait on it. |
| **CF-C3-ROLLBACK-CRED-WINDOW-1 / CF-C3-DELETE-SEQUENCE-1** | **must-fix (HIGH)** | @vikram (runbook) | Runbook sequence (per connector): write-to-custody → live HTTP auth test → parity confirmed within window N → **THEN** seal/delete legacy plaintext. The A4 rollback branch sits **BEFORE** the delete (`failed auth test = abort, cred still in legacy, no restore needed`). For Shiprocket the life-critical item is the `email/password` pair (unrecoverable — no replay). |
| **CF-C3-SHOPIFY-ENDPOINT-ATOMIC-1** | **must-fix (CRITICAL→bound)** | @vikram (runbook) | Shopify cutover runbook = bulk `webhookSubscriptionCreate` across ALL shops × 14 topics (rate-limited 2/sec/shop) + the same script in reverse for rollback; app-level `SHOPIFY_CLIENT_SECRET` HMAC verification present in Brain BEFORE first webhook; endpoint responsive BEFORE the flip. Reversible via 60-day order-API backfill within the 4h window. |
| **CF-C3-SHIPROCKET-POLL-MODEL-1** | **must-fix (HIGH)** | @vikram (runbook) | Shiprocket runbook models a polling-gap (disable legacy cron → verify no legacy Shiprocket cron scheduled → Brain first poll `days=7` → shipment-count parity). 72h window + ≥2-week pre-shadow; sequenced LAST. |
| **CF-C3-RESIDENCY-ASSERT-1** | **must-fix (MED)** | @vikram | `bootstrap/startup_gates.py` asserts ap-south-1 on BOTH `DATABASE_URL` + `DIRECT_URL`, refuse-to-start on fail, named error. |
| **CF-C3-WORKSPACE-ALLOWLIST-1** | **must-fix (MED)** | @vikram | `ALLOWED_WORKSPACE_IDS` startup check, Sugandh-Lok-only; the runbook names the approved workspace IDs; rejects any other workspace's credential read until its DPDP instrument is on record. |
| **CF-C3-META-GOOGLE-ATTRIBUTION-WINDOW-1** | should-fix (MED) | @vikram (runbook) | Meta/Google parity includes a 48h re-validation window; first Brain cron syncs `days=7`; the 8h window is COUNT parity only; spend-sum is NOT a hard rollback trigger within 48h of cutover. |
| **CF-C3-FORCE-UNLOCK-SCOPE-1** | should-fix (HIGH, cross-child) | @vikram | Document in the Child-1 HOLD-AT-FORCE ledger that the legacy bare writers die at **Shiprocket decommission** — Child-1's FORCE is gated there, NOT on shipping this framework. |
| **CF-C3-PARITY-COUNT-1** | must-fix | @vikram | `tests/parity/` is count-based + field-spot-check (last-N rows, per the M-A5-Q3 windows). NO numeric shadow-compare. |
| **CF-C3-NO-CUTOVER-AT-FESTIVAL-1** | required | @vikram (runbook) | Runbook scheduling constraint: no live cutover during a known festival traffic window. |
| **Kafka envelope (`IntegrationEvent`)** | required | @vikram | Proto bound as v1 (`integrations.<vendor>.v1`); `workspace_id` partition key + required field; NO money fields; wired into `buf.gen.yaml` (ts + py). Adding a vendor is additive. |

---

## 4. Build tracks + parallelization

> Two parallel builders. They share only the §2 locked signatures (a contract, not code). Integration point: Track V4 (`ingest_batch`) consumes Track M3 (`PiiManifest`) + the raw-store schema's idempotency/cursor contract (M1/M4). Coordinate at that seam only.

### Track V — Framework + runtime + runbook *(owner: @vikram)* — parallel
- **V1.** `apps/ingestion-service/pyproject.toml` deps (resolve+pin latest-stable: `psycopg[binary,pool]`, `aiokafka`, `httpx`, `pydantic`, `pydantic-settings`; dev `pytest`, `pytest-asyncio`, `testcontainers`). **No invented versions.**
- **V2.** `src/infrastructure/db/session_context.py` (P1).
- **V3.** `src/domain/framework/adapter.py` (P3) + `PiiManifest`/`TokenModel`/`ReplayCapability`/`IngestWindow`/`RawEvent`/`NormalizedEvent` types.
- **V4.** `src/application/framework/ingest.py` (P2) — `ingest_batch` (`dry_run` for harness).
- **V5.** `src/infrastructure/secrets/custody.py` (P4) + `aws_secrets_manager_custody.py` (stub) + `supabase_column_custody.py` (stub) + Shopify app-HMAC custody config key.
- **V6.** `src/interfaces/adapters/shopify_adapter.py` — first adapter (fetch/normalize/idempotency_key + PII manifest: email/first_name/last_name).
- **V7.** `src/bootstrap/startup_gates.py` — residency assert (both URLs, refuse-to-start) + `ALLOWED_WORKSPACE_IDS`.
- **V8.** `protos/events/integrations.proto` — `IntegrationEvent`; wire into `buf.gen.yaml` (ts + py).
- **V9.** `tests/` — unit (P1 fail-closed, P2 idempotency, PII gate, custody stubs) + LOCAL docker-compose integration (PG + Kafka: cross-workspace read = 0, envelope produced, cursor advanced).
- **V10.** `tests/parity/` — LOCAL count-based + field-spot-check harness (CF-C3-PARITY-COUNT-1), parameterized by the M-A5-Q3 per-connector windows.
- **V11.** `runbooks/cutover/` — per-connector A6 ceremony + A4 rollback tree (Shopify all-shops-atomic bulk + reverse; write→auth-test→parity→seal; Shiprocket polling-gap days=7; Meta/Google 48h; STEP 0.5 real-pooler IT; no-cutover-at-festival; workspace allowlist). **Stage-8 artifact, not executed.**
- **V12.** `migrations/manual/raw/README.md` — mark the DDL tree HOLD-AT-CUTOVER / Stage-8-only.
- **V13.** Document CF-C3-FORCE-UNLOCK-SCOPE-1 in the Child-1 HOLD-AT-FORCE ledger.

### Track M — Raw event-store schema + consent columns + PII manifest *(owner: @maya — co-owned seam)* — parallel
- **M1.** `migrations/manual/raw/step-a-enable-create.sql` — raw landing tables (Child-0 A1 set) + non-nullable `workspace_id`/`lawful_basis`/`purpose_code`/`ingested_at` on every PII-bearing table + `(workspace_id, vendor_event_id)` UNIQUE + Child-1 `ws_isolation` policy shape (ENABLE+CREATE).
- **M2.** `migrations/manual/raw/step-b-force.sql` (FORCE per table, Stage-8) + `down.sql` (symmetric NO FORCE→DISABLE→DROP POLICY→DROP TABLE).
- **M3.** `src/domain/framework/pii_manifest.py` — `PiiManifest` enum sets (lawful_basis, purpose_code) + the per-adapter manifest table (§5) + the fail-closed check `ingest_batch` calls.
- **M4.** `connector_cursor` table DDL + the cursor-persistence contract (consumed by P2).
- **M5.** One-paragraph forward-binding note (in §A-SCHEMA) confirming the consent-column set pre-shapes Child-4 metric fields (per-purpose retention/erasure scoping).

**No @jatin deploy-pipeline track this child** — Option A provisions NO live infra; the deploy pipeline graduates with the data runtime at the Stage-8 ceremony's infra prerequisites (§A0.1 #4), authored as a runbook section (V11), not built here.

---

## 5. The HOLD-AT-CUTOVER boundary (what is GREEN this child vs DEFERRED to Stage 8)

**GREEN at end of this run (Brain code, LOCAL-verified):** P1–P4 + Shopify adapter + `IntegrationEvent` envelope proto + startup gates + raw-schema DDL (runbook-gated) + LOCAL parity harness + the per-connector ceremony runbook present; unit tests + LOCAL docker-compose (PG + Kafka) integration pass.

**DEFERRED to Stage-8 HOLD-AT-CUTOVER (NOT this child, do not attempt):** the real-pooler integration test (STEP 0.5), any live token transfer, the live HTTP vendor auth test (STEP 2), count-parity against live legacy, legacy-plaintext-delete/seal, MSK/Glue provisioning, the deploy pipeline. These run one connector at a time, lowest-risk first, **Shiprocket last**, with the Founder at the console and the A4 rollback tree armed (§A0.2 + §A4-LOCAL). **ZERO live token moves in a normal pipeline run.**

---

## 6. Stage-3 build gates (BOTH must clear before build authorization — §A-GATES)

1. **Founder Secrets Option A/B on record** (CF-C3-SECRETS-INTERIM-1, FIRED escalation). The custody interface (P4) is built stubbed regardless, but the BACKING selection + the runbook's truthful custody mechanism wait on this. **Stage-3 build cannot start until on record.** (Mirrored in `.engineering-os/pending-founder-attention.md`.)
2. **Child-1 RLS primitive merged to `development`** (build-base). `ingestion-service`'s `with_workspace` re-expresses the Child-1 contract; the build base branch needs the merged primitive. Resolve when the Founder merges `feature/feat-tenancy-auth-rls-hardening` → `development`. (Non-blocking for Stage-2 design; blocking for Stage-3 build.)

---

## 7. Definition of Done (both builders, before handoff to Stage 4)

- [ ] All §3 `must-fix` criteria binary-PASS (self-review against §3 done — shift-left; no known must-fix left for Shreya/Tanvi to catch).
- [ ] Unit tests + LOCAL docker-compose (PG + Kafka) integration green; cross-workspace read returns 0; envelope produced with `workspace_id` partition key; cursor advanced; re-ingest is a no-op on counts.
- [ ] PII-manifest gate proven fail-closed (undeclared PII field → write refused).
- [ ] LOCAL parity harness (count + field spot-check) runs against fixtures (no numeric shadow).
- [ ] `git status` shows ONLY `.engineering-os/**`, `apps/ingestion-service/**`, `protos/events/integrations.proto`, the proto-gen output dirs, and the dep manifests; **zero `legacy project/` diff**; zero money-conversion code in the ingest path.
- [ ] ZERO live token moved; no MSK/Glue/deploy pipeline; no live Supabase/vendor connection (HOLD-AT-CUTOVER respected).
- [ ] No invented version numbers (deps resolved+pinned latest-stable).
- [ ] No commit (await Founder "commit it"). Build only after BOTH §6 gates clear.
