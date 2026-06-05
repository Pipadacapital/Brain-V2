# Stage-6 Final Review — epic-warehouse-medallion-wiring

| Field | Value |
|---|---|
| **req_id** | `epic-warehouse-medallion-wiring` |
| **Stage** | 6 — Final Review (Rohan, CTO Advisor) |
| **Timestamp** | 2026-06-05T00:00:00Z |
| **Verdict** | **PASS-WITH-CAVEATS** |
| **Delegated authority** | Founder standing delegation (per memory/feedback_founder_delegates_to_cto_advisor.md) — Rohan signs this gate on the Founder's behalf |

---

## Verdict rationale

Seven of eleven slices are built-and-verified with no blocking security findings. Two slices (P0-B, P1-C) carry unresolved CRITICAL/HIGH security findings that prevent those slices from being considered genuinely DPDP-cleared. This matters structurally: **the Stage-1 Amendment 1 gate ("P0-B and P0-D clear Stage-4 (Shreya VETO) before any P1 work") was NOT honored** — P1-A through P1-F were built while P0-B carries a CRITICAL unresolved finding. However, the downstream P1 slices are authored-not-live (all behind feature flags), the CRITICAL finding is structural (not currently exploitable in local dev), and the fixes are well-understood. The correct disposition is PASS-WITH-CAVEATS: the code may be committed to a feature branch; nothing goes live (flag-ON or Stage-8 ceremony) until the three MUST-FIX items below are resolved and re-reviewed by Shreya.

The two DPDP gates (P0-B, P0-D) did NOT genuinely clear Shreya per the amendment. P0-B has an unresolved CRITICAL (raw PII on Kafka wire) and an unresolved HIGH (inert DPDP test + KmsVault unwired). P0-D cleared Stage-4 with MEDIUM/LOW findings only — it is the better of the two. P1-C has an unresolved HIGH (no RLS on identity tables) and a second HIGH (workspaceSalt unwired at normalizers.ts call site). These must be fixed before any flag-ON event.

---

## 5 Stage-1 Amendments — Honor Check

### Amendment 1: P0-B and P0-D clear Stage-4 before any P1 work
**STATUS: NOT HONORED**

P0-B has three unresolved findings at CRITICAL and HIGH severity (see below). The P1 slices were built in parallel rather than being held behind the P0-B Stage-4 gate. The P1 slices are all behind `TRANSFORM_GRADUATION_WORKER=false` / `IDENTITY_STITCHER=false` / `BRONZE_RAW_ARCHIVER=false` flags, so no live data reaches them. The structural intent — "do not build P1 until the DPDP chokepoint is clean" — was violated in sequencing but partially mitigated by the flag discipline. This is a process violation that I am recording here; it does not kill the commit but it does mean the flag-ON unlock is conditioned on MUST-FIX resolution.

P0-D: amendment condition is met. P0-D has MEDIUM/LOW findings only; the erasure orchestrator's core logic is sound and Shreya's security review passes the bar for P0-D specifically.

### Amendment 2: P1-B shadow-mode shell starts in parallel with P0-C
**STATUS: HONORED**

`TRANSFORM_GRADUATION_WORKER` feature flag is implemented. The shadow-mode consumer shell (`transform_consumer.py`) is built and the flag-OFF path is confirmed in code. The consumer loop is startable from P0-C forward per the file header. Amendment satisfied.

### Amendment 3: P1-B fail-closed on PG cursor unavailability (no silent gap)
**STATUS: HONORED**

`transform_consumer.py` emits `transform_cursor_stalls_total` on PG cursor table unreachability. Tests `test_stall_when_cursor_table_unreachable` and `test_fail_closed_on_cursor_table_unavailable` both assert stall=1 with no cursor advance. Amendment satisfied.

There is a separate VALIDITY DEFECT in `test_poison_event_routes_to_dlq_cursor_advances` — the cursor-advance assertion is tautological (any cursor with calls, not specifically the advance SQL). This is a must-fix before staging flag-ON (recorded below), but it does not invalidate Amendment 3 itself since separate tests cover the stall behavior.

### Amendment 4: silver_freshness metric + gold-recompute gated on it during replay windows
**STATUS: HONORED**

`silver_freshness.py` exists in the analytics-service. `recompute_daily.py` gates gold recompute on `silver_freshness_log` when `replay_run_id` is non-None. Tests at `test_recompute_daily.py:899` cover the Amendment-4 scenario. Amendment satisfied.

### Amendment 5: P0-C BACKUP cron is a day-zero acceptance criterion
**STATUS: HONORED**

Test `test_raw_archiver_consumer.py` explicitly references Amendment-5 and includes a test asserting the backup cron file exists at the expected path. Tests cover success/failure increment of `bronze_backup_success_total` / `bronze_backup_failure_total`. Amendment satisfied.

---

## Slice Verdicts

### P0-A — ADR triage + full-column drift gate
**Verdict: BUILT-VERIFIED (with recorded non-blocking items)**

Two acceptance deviations recorded (backfill script path is a documentation error in the plan; 11 silver facts vs plan's "13" is a miscounting in the plan). Both are plan errors, not implementation errors. Security has 3 MEDIUMs and 2 LOWs — none are blocking for a local-dev-only migration. The `purge_closed_order_pii` SECURITY DEFINER missing `SET search_path` (MEDIUM) should be fixed before production migration apply.

**Pre-production required:** Fix `SET search_path = pg_catalog, public` on `purge_closed_order_pii`; add `REVOKE EXECUTE ON PROCEDURE run_nightly_pii_purge(INT) FROM PUBLIC`; add workspace-scoped RLS policy on `pii_purge_log`.

### P0-B — PII tokenizer + bronze customer_ref + Woo address removal
**Verdict: BUILT, SECURITY VETO UNRESOLVED — flag must remain OFF**

Three unresolved findings:

**CRITICAL (raw_payload PII leak):** `ShopifyAdapter.normalize()` sets `raw_payload: json.dumps(p)` in `event.columns`. `raw_payload` is not in `SHOPIFY_MANIFEST.pii_fields`. Result: verbatim Shopify JSON containing email/first_name/last_name travels the Kafka wire and lands in the Postgres `raw_payload` JSONB column even with `PII_TOKENIZER=true`. This is a structural DPDP violation. Fix: strip `raw_payload` from `event.columns` before tokenization (route it to a separate S3 sink path per the plan's intent), or declare it as a pii_field and redact it.

**HIGH (inert DPDP gate test):** `test_shopify_order_envelope_no_plaintext_pii_when_tokenizer_on` constructs a hand-crafted `NormalizedEvent` that explicitly omits `raw_payload`. The real `ShopifyAdapter.normalize()` always includes `raw_payload`. The test cannot fail on the actual defect — it is an inert probe. The DPDP gate is not genuinely cleared. Fix: test must call `ShopifyAdapter.normalize()` with a real `RawEvent` payload, run through the full ingest path, and assert no plaintext PII in produced bytes.

**HIGH (KmsVault not wired):** `_live_intake_runner` calls `receive_webhook_fn` with no `pii_workspace_salt`. `receive_webhook` defaults `pii_workspace_salt=b""`. With `PII_TOKENIZER=true` in production, every webhook call raises `ValueError('workspace_salt must not be empty')` — every webhook is a 500. KmsVault is authored but never instantiated or called in any production path. Fix: instantiate KmsVault at webhook_server startup; call `await kms_vault.get_salt(workspace_id)` in `_live_intake_runner` before invoking `receive_webhook_fn`.

**This slice MUST NOT be flag-ON until all three are resolved and Shreya re-reviews.**

### P0-R6 — Vendor ENUM to TEXT+FK
**Verdict: BUILT-VERIFIED**

No open findings. Clean.

### P0-C — Bronze raw-archiver consumer
**Verdict: BUILT-VERIFIED (with Stage-8 holds correctly documented)**

Three Stage-8 holds are appropriate and correctly documented: live S3 write, production CH BACKUP, BronzeStorageStack CDK deploy. Local flag-OFF state is correct.

### P0-D — Erasure orchestrator
**Verdict: BUILT-VERIFIED (with MEDIUM findings requiring pre-production fix)**

Core DPDP §12 logic (notice window, 5-tier erasure ladder, crypto-shred, WORM ledger, COUNT=0 artifact) is sound. Passes Amendment-1 condition for P0-D specifically.

Four findings:
- MEDIUM: `subject_erasure_request` and `key_destruction_ledger` have no RLS. Fix required before production migration apply.
- MEDIUM: `_skipNoticeWindowCheckForTest` on the production `EraseSubjectCommand` interface. Should be moved to a test-injected clock abstraction.
- LOW (2): CH injection allowlist guard; partial-unique-index on active-only statuses.

**These do not block commit; they block production migration apply.**

### P1-A — Fact-schema codegen + MV apply/sunset + FINAL/PREWHERE
**Verdict: BUILT-VERIFIED (with one pre-existing pre-production fix required)**

QA gap F-1 confirmed: `connector_ad_spend_facts` at `recompute_daily.py:224` is queried without `FINAL`. This is a pre-existing issue, not a P1-A regression, but P1-A is the codegen slice that locks the fact schema — the fix must land before CM2 ad-spend is considered billing-correct. Fix: add `FINAL` to `FROM brain.connector_ad_spend_facts` at line 224.

Stage-8 holds (live MSK, BronzeStorageStack CDK) are correctly documented.

### P1-D — BronzeStorageStack CDK + lifecycle + CH TTL + DLQ
**Verdict: BUILT-VERIFIED (with Stage-8 holds correctly documented)**

Six Stage-8 holds are correctly scoped and documented. The 2555-day lifecycle LOW (vs 2557 calendar days for 7 years) is a conservative correctness note — update to 2557 before CDK deploy. Two MEDIUMs (DLQ PII when tokenizer OFF, plaintext Kafka transport) are correctly tracked as pre-MSK-ceremony gaps.

### P1-B — Transform-graduation worker (KEYSTONE)
**Verdict: BUILT-VERIFIED (with one must-fix validity defect)**

**MUST-FIX (validity defect):** `test_poison_event_routes_to_dlq_cursor_advances` at line 277: `advance_calls = [c for c in pg.cursors if c.calls]` is a tautological assertion — it tests whether any cursor has any calls, not whether the advance cursor SQL was specifically called. The probe is proven inert by the dossier. Fix: assert `_ADVANCE_CURSOR_SQL` substring appears in a specific cursor's calls, or use `mock_advance.call_count > 0`.

Three Stage-8 holds correctly documented. Two QA concerns (no integration test for `run_transform_tick` against real PG+CH; real-network smoke with flag-ON tick deferred to staging) are acceptable deferrals with the stated conditions.

### P1-C — Identity: salted hashes + union-find stitcher
**Verdict: BUILT, SECURITY VETO UNRESOLVED — flag must remain OFF**

Two unresolved HIGH findings:

**HIGH (no RLS on identity tables):** `workspace_identity_salt`, `identity_cluster_registry`, and `identity_cluster_edges` are created in `36-identity-hashes.sql` with GRANT statements but no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, no `FORCE ROW LEVEL SECURITY`, and no `CREATE POLICY ws_isolation`. No `36b-enable-rls-identity.sql` migration exists. A bare `rls_app` connection can read all workspace salts, cluster registry entries, and graph edges across every tenant — directly defeating the stated purpose of P1-C. Fix: add migration `36b-enable-rls-identity.sql` mirroring `04-enable-rls-connectors.sql`.

**HIGH (workspaceSalt not wired at production call site):** `normalizers.ts:95` calls `customerRef(node.customer?.id)` with no `workspaceSalt` argument. When `IDENTITY_STITCHER=true`, this falls through to the legacy bare-SHA256 path (no cross-workspace isolation). The fix (`saltedCustomerRef` + `getOrCreateWorkspaceSalt`) exists but is not wired at the live-order processing call site. The 44 unit tests all pass because they inject an explicit salt — the production normalizer path is never tested with the flag ON. Fix: `normalizeShopifyOrder` must accept `workspaceSalt` (sourced from `getOrCreateWorkspaceSalt` before the sync loop) and pass it to `customerRef`.

MEDIUM (erasure does not cover `email_hash`, `phone_hash`, `salt_version`, `identity_cluster_id`): `wipePgPii` nulls `email_ct`, `phone_ct`, `full_name_ct` but the four new columns added by migration 36 are not cleared. DPDP §12 erasure obligation extends to derived pseudonymous identifiers. Fix: add NULL-SET for the four new columns in `wipePgPii`; add DELETE step for erased `customer_ref` from `identity_cluster_edges`.

**This slice MUST NOT be flag-ON until all HIGH findings are resolved and Shreya re-reviews.**

### P1-E — Wire recompute_daily inputs + @paradigm + CH gateway + PII catalog
**Verdict: BUILT-VERIFIED (with two QA concerns requiring staging validation)**

Amendment 4 (`silver_freshness` metric + gold-recompute gate) is confirmed honored. Two QA concerns: CM3 != CM2 path is not smoke-tested on live CH with real `misc_expenses` data (pg_dsn=None during live recompute); mutation testing (`mutmut`) is not installed. The live CM3 validation can be done with a single `recompute_daily --all` run with `DATABASE_URL` set. Mutmut installation is required before the next slice ships on this arithmetic path.

### P1-F — Erasure MV fan-out completion
**Verdict: BUILT-VERIFIED (with Stage-8 holds correctly documented)**

Three Stage-8 holds correctly scoped. Clean slice.

---

## DPDP Gate Assessment (Amendment 1)

| Gate | Slice | Shreya cleared? | Reason |
|---|---|---|---|
| P0-B DPDP gate | PII tokenizer at chokepoint | **NO** | CRITICAL raw_payload leak + HIGH inert test + HIGH KmsVault unwired |
| P0-D DPDP gate | Erasure orchestrator | **YES (MEDIUM only)** | Core erasure logic sound; MEDIUM findings are pre-production, not blocking clearance |

**The P0-B DPDP gate is not genuinely cleared.** The consequence per Amendment 1: all P1 slices that depend on P0-B (P1-B, P1-C, P1-D, P1-E, P1-F) must remain flag-OFF until P0-B's three findings are resolved. They are all authored behind flags, which is the correct state. The flag-ON unlock sequence is:

1. Fix P0-B CRITICAL + 2× HIGH findings
2. Fix P1-C 2× HIGH findings
3. Shreya re-reviews P0-B + P1-C
4. Shreya VETO cleared on both
5. P1 flag-ON sequence may begin (P0-C → P1-D → shadow-parity → flag-ON per B10)

---

## CRITICAL and HIGH Unresolved Findings Summary

| Sev | Slice | Finding | File | Must-fix before |
|---|---|---|---|---|
| CRITICAL | P0-B | raw_payload PII travels Kafka wire and PG JSONB even with PII_TOKENIZER=true | shopify_adapter.py:194 | P0-B flag-ON |
| HIGH | P0-B | Inert DPDP gate test — probe cannot fail on real defect | test_pii_tokenizer.py:529 | P0-B flag-ON |
| HIGH | P0-B | KmsVault unwired — production webhook raises ValueError('workspace_salt must not be empty') with PII_TOKENIZER=true | webhook_servicer.py:507-518 | P0-B flag-ON |
| HIGH | P1-C | No RLS on workspace_identity_salt, identity_cluster_registry, identity_cluster_edges — cross-tenant salt leak | 36-identity-hashes.sql | P1-C flag-ON |
| HIGH | P1-C | workspaceSalt not passed at normalizers.ts:95 — falls through to bare-SHA256 when IDENTITY_STITCHER=true | normalizers.ts:95 | P1-C flag-ON |
| VALIDITY | P1-B | Tautological cursor-advance assertion in test_poison_event_routes_to_dlq_cursor_advances | test_transform_consumer.py:277 | Staging flag-ON |

---

## Slices Ready to Commit

P0-A, P0-R6, P0-C, P0-D, P1-A, P1-D, P1-B, P1-E, P1-F — 9 slices are ready to commit to the feature branch. The commit does not constitute a flag-ON grant.

## Slices With Must-Fix Before Flag-ON

P0-B (3 CRITICAL/HIGH) and P1-C (2 HIGH + 1 MEDIUM) are authored-not-deployable. Commit is acceptable; flag-ON requires the fix + Shreya re-review cycle described above.

---

## Stage-8 Held Console Ceremonies

All held ceremonies are correctly scoped and documented in each slice. The master list:

1. `cdk deploy BronzeStorageStack` (S3 bucket + lifecycle + per-workspace KMS alias) — P1-D scope
2. KMS CMK creation + per-workspace `aws kms create-alias --alias-name brain/bronze/{workspace_id}` — P1-D scope
3. MSK topic creation: `kafka-topics.sh --create --topic integrations.dlq.v1 --partitions 7` — P1-D scope
4. AWS Secrets Manager real secret provisioning at `brain/{workspace_id}/pii_salt/{salt_version}` — P0-B scope
5. CH TTL apply: `ALTER TABLE brain.connector_raw_events MODIFY TTL received_at + INTERVAL 90 DAY DELETE` — P1-D scope (apply only after S3 confirmed live)
6. `S3_BRONZE_BUCKET` env var injection into ingestion-service — P1-D scope
7. BACKUP cron retirement after S3 confirmed live (`bronze_s3_writes_total > 0`) — P0-C scope

None of these require `/escalate`. All are Founder-at-console ceremonies per the plan.

---

## Batched Founder Questions

### Q-A: P0-B CRITICAL fix strategy — which option?
**Context:** `raw_payload` (verbatim vendor JSON with email/name) is included in `NormalizedEvent.columns`, which means it rides the Kafka envelope and lands in the PG JSONB column even with tokenization ON. Three fix options exist: (a) strip `raw_payload` from `event.columns` entirely and route it only to the S3 raw archive sink (cleanest — matches the intended architecture where bronze S3 is the raw archive, not Kafka/PG), (b) declare `raw_payload` as a pii_field and redact it in the tokenizer (simpler but loses the raw archive entirely), (c) produce two events — one tokenized-columns event to Kafka, one raw_payload event to S3. Option (a) is the architecturally intended path per the medallion design.
**Recommended default:** Option (a) — strip `raw_payload` from `event.columns`; the S3 raw archive (P1-D BronzeStorageStack) is the intended home for raw vendor bytes.

### Q-B: P1-C erasure gap — do we fix wipePgPii before or after P1-C flag-ON?
**Context:** `wipePgPii` does not null out the four new columns added by migration 36 (`email_hash`, `phone_hash`, `salt_version`, `identity_cluster_id`) and does not clean up `identity_cluster_edges`. Under DPDP §12 this is an erasure coverage gap for derived pseudonymous identifiers. The gap exists in the codebase today but is not reachable until `IDENTITY_STITCHER=true` — no customer currently has these columns populated on live data.
**Recommended default:** Fix before P1-C flag-ON (the fix is 2-3 hours of work: add NULL-SET for four columns in the existing `wipePgPii` UPDATE, add a DELETE from `identity_cluster_edges` for the erased `customer_ref`). Do not carry a known DPDP erasure gap into staging.

### Q-C: P0-A path discrepancy — move backfill script or update the plan?
**Context:** The implementation plan references `apps/analytics-service/migrations/clickhouse/phase8-ch-backfill.sql` but the file lives at `tools/migrate-legacy/phase8-ch-backfill.sql`. The update was applied to the actual location. The script runs manually and has no functional impact from the path mismatch.
**Recommended default:** Update the plan's path reference only (documentation fix). The script's home in `tools/migrate-legacy/` is more appropriate than `apps/analytics-service/migrations/` since it is a one-time backfill tool, not a repeatable migration.

### Q-D: P0-A "13 connector facts" — was it a miscounting in the plan?
**Context:** The plan says "all 13 connector facts" but the codebase has exactly 11 CH silver fact tables (`connector_raw_events` is bronze, not silver). All 11 are now registered. No 12th or 13th silver table exists or is planned in the current scope.
**Recommended default:** Accept 11 as correct; update the plan to say "all 11 silver fact tables." The acceptance test already uses `>= 11` so no functional change needed.

### Q-E: Mutmut installation — do we require it in this epic or defer to the next arithmetic path?
**Context:** Mutation testing (`mutmut`) is not installed in the analytics-service venv. `recompute_daily.py` and `silver_freshness.py` are high-stakes arithmetic paths (CM ladder subtractions, billing gate). The dossier requires `>= 80% mutation score` before the next slice ships on this path.
**Recommended default:** Install mutmut in this epic (P1-E scope, ~1 hour) and run it before staging flag-ON. The arithmetic correctness of CM2/CM3 is directly tied to the %-of-GMV billing — this is not a deferrable quality gate for a billing-critical path.

### Q-F: LIFECYCLE_DELETE_DAYS = 2555 vs 2557 — update before CDK deploy?
**Context:** `BronzeStorageStack` uses `LIFECYCLE_DELETE_DAYS = 2555` (7 × 365, no leap days). Seven calendar years span approximately 2557 days in a typical leap-year-containing window. DPDP does not specify sub-day precision, so deleting at 2555d is within the 7-year maximum, but deleting 2 days early could be challenged in an audit.
**Recommended default:** Update to 2557 before `cdk deploy`. One-line fix with zero functional risk.

### Q-G: Pre-bronze historical provenance (R12/Q6) — does the Founder accept the billing-provenance gap for 83k anchor-customer orders before Stage-8?
**Context:** This was the non-blocking Founder attention item from Stage-1. The 83k Sugandh Lok orders will carry `provenance='legacy_etl'` and `raw_event_id=NULL` — meaning no individual order is traceable to a bronze raw event. This is the correct Day-1 decision (Option a, Q6) but means the billing-correctness audit trail for the anchor customer's pre-warehouse orders runs through the legacy etl marker, not through bronze idempotency. If a dispute arises over a specific historical order, the bronze record will not exist.
**Recommended default:** Accept the gap with the provenance marker (Q6 Option a, already confirmed). No action required before Stage-8; document the gap's scope in the Stage-8 ceremony checklist so the customer success team knows the pre-warehouse period has different auditability.

---

## Explicit-Path Git Commit Command

The following command is ready to run once the Founder says "commit it." It stages only the files touched by this epic (feature branch: `feat/epic-warehouse-medallion-wiring`), plus the audit trail files.

```bash
git add \
  apps/core-service/migrations/local-dev/30-connector-identity-map.sql \
  apps/core-service/migrations/local-dev/31-status-gated-purge.sql \
  apps/core-service/migrations/local-dev/32-vendor-text-fk.sql \
  apps/core-service/migrations/local-dev/32-down-vendor-text-fk.sql \
  apps/core-service/migrations/local-dev/33-subject-erasure.sql \
  apps/core-service/migrations/local-dev/33-down-subject-erasure.sql \
  apps/core-service/migrations/local-dev/34-p1a-grants-and-multicurrency.sql \
  apps/core-service/migrations/local-dev/34-down-p1a-grants-and-multicurrency.sql \
  apps/core-service/migrations/local-dev/35-silver-raw-event-id.sql \
  apps/core-service/migrations/local-dev/35-down-silver-raw-event-id.sql \
  apps/core-service/migrations/local-dev/36-identity-hashes.sql \
  apps/core-service/migrations/local-dev/36-down-identity-hashes.sql \
  apps/core-service/src/application/contexts/consent/commands/erase-subject.ts \
  apps/core-service/src/application/contexts/connectors/sync/normalizers.ts \
  apps/core-service/src/application/contexts/identity/ \
  apps/ingestion-service/src/application/framework/ingest.py \
  apps/ingestion-service/src/application/use_cases/graduate_raw_event.py \
  apps/ingestion-service/src/domain/framework/pii_manifest.py \
  apps/ingestion-service/src/domain/framework/adapter.py \
  apps/ingestion-service/src/domain/transform/transform_registry.py \
  apps/ingestion-service/src/infrastructure/kafka/dlq_producer.py \
  apps/ingestion-service/src/interfaces/adapters/shopify_adapter.py \
  apps/ingestion-service/src/interfaces/consumers/transform_consumer.py \
  apps/ingestion-service/src/interfaces/grpc/webhook_servicer.py \
  apps/ingestion-service/tests/ \
  apps/analytics-service/migrations/clickhouse/ \
  apps/analytics-service/src/application/contexts/metric_engine/recompute_daily.py \
  apps/analytics-service/src/application/contexts/metric_engine/silver_freshness.py \
  apps/analytics-service/tests/ \
  apps/api-gateway/src/infrastructure/realtime-facts-consumer.ts \
  infra/cdk/lib/bronze-storage-stack.ts \
  tools/migrate-legacy/phase8-ch-backfill.sql \
  docs/data-warehouse-architecture-proposal.md \
  docs/data-warehouse-implementation-plan.md \
  .engineering-os/runs/2026-06-05T00-00-00Z__warehouse-medallion__epic-warehouse-medallion-wiring__rishabhporwal/ \
  .engineering-os/state/active.json
```

**Branch requirement:** This MUST be committed to `feat/epic-warehouse-medallion-wiring` branched from `development`. Do NOT merge to `development` until P0-B and P1-C MUST-FIX items are resolved and Shreya has re-reviewed. The merge PR is a separate gate.

---

## Journal Entry

```markdown
## 2026-06-05T00:00:00Z — Rohan (cto-advisor) — epic-warehouse-medallion-wiring
**Stage:** 6 · **Action:** FINAL REVIEW · **Verdict:** PASS-WITH-CAVEATS
**Amendment 1 honor:** NOT HONORED (P1 built while P0-B CRITICAL unresolved) — mitigated by flag discipline
**Amendment 2-5 honor:** ALL HONORED
**DPDP gates:** P0-D cleared; P0-B NOT cleared (CRITICAL + 2× HIGH unresolved)
**Blocking findings:** 5 CRITICAL/HIGH across P0-B (3) and P1-C (2); 1 VALIDITY defect in P1-B
**Commit:** authorized (feature branch only); flag-ON gated on MUST-FIX resolution + Shreya re-review
**Next:** Builder fixes 6 items → Shreya re-reviews P0-B + P1-C → flag-ON sequence per B10
```

---

## Decision Log Entry

```json
{
  "ts": "2026-06-05T00:00:00Z",
  "actor": "cto-advisor (Rohan) — delegated Founder authority",
  "type": "stage-6-final-review",
  "req_id": "epic-warehouse-medallion-wiring",
  "stage": 6,
  "verdict": "PASS-WITH-CAVEATS",
  "slices_built_verified": ["P0-A", "P0-R6", "P0-C", "P0-D", "P1-A", "P1-D", "P1-B", "P1-E", "P1-F"],
  "slices_flag_blocked": ["P0-B", "P1-C"],
  "dpdp_gate_p0b_cleared": false,
  "dpdp_gate_p0d_cleared": true,
  "amendment_1_honored": false,
  "amendment_1_mitigation": "All P1 slices behind feature flags; no live data path active",
  "amendments_2_to_5_honored": true,
  "must_fix_before_flag_on": [
    "P0-B CRITICAL: raw_payload PII on Kafka wire — strip from event.columns",
    "P0-B HIGH: inert DPDP gate test — fix to use real ShopifyAdapter.normalize() path",
    "P0-B HIGH: KmsVault unwired in _live_intake_runner — wire get_salt(workspace_id)",
    "P1-C HIGH: no RLS on identity tables — add 36b-enable-rls-identity.sql migration",
    "P1-C HIGH: workspaceSalt not passed at normalizers.ts:95 — wire getOrCreateWorkspaceSalt"
  ],
  "must_fix_before_staging": [
    "P1-B VALIDITY: tautological cursor-advance assertion in test_poison_event_routes_to_dlq_cursor_advances"
  ],
  "commit_authorized": "feature branch only — no flag-ON, no merge to development until MUST-FIX resolved",
  "held_stage8_ceremonies": 7,
  "founder_questions_batched": 7,
  "rationale": "9/11 slices clean; 2 carry unresolved CRITICAL/HIGH PII/RLS findings that prevent DPDP clearance; flag discipline prevents live exposure; fixes are well-understood and bounded"
}
```
