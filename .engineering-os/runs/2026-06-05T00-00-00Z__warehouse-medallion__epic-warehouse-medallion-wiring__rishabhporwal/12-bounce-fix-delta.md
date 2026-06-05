# Bounce-Fix Delta — epic-warehouse-medallion-wiring

**Date:** 2026-06-05 · **Branch:** `feature/epic-warehouse-medallion-wiring` · **Trigger:** Stage-6 PASS-WITH-CAVEATS → the 2 Shreya VETOs (P0-B, P1-C) resolved before commit (Founder choice: "fix vetos, then commit").

## P0-B (PII tokenizer) — VETO → CLEAR
Builder: Maya. Founder fix-strategy: Option (a) — strip `raw_payload` from the Kafka envelope; raw bytes go to S3 only (Stage-8 hold).
- **F1 CRITICAL (raw_payload leak) → RESOLVED.** `shopify_adapter.py` no longer puts `raw_payload` into `NormalizedEvent.columns`; verified the produce path (`ingest.py:_produce_kafka`) emits only tokenized columns.
- **F2 HIGH (inert test) → RESOLVED.** `test_pii_tokenizer.py` now calls real `ShopifyAdapter.normalize()` with real PII + greps the actual envelope bytes; a load-bearing regression test proves the grep can fail (verify-the-verifier). 44/44 pass.
- **F3 HIGH (KmsVault unwired) → RESOLVED.** `webhook_servicer.py:_live_intake_runner` instantiates `KmsVault().get_salt(...)` when `PII_TOKENIZER=true`; local-dev salt via `BRAIN_PII_SALT_LOCAL_DEV`; real AWS SM provisioning is a documented Stage-8 hold.

## P1-C (identity) — VETO → CLEAR
Builder: Vikram.
- **F1 HIGH (no RLS on identity tables) → RESOLVED.** New `37-enable-rls-identity.sql`: ENABLE+FORCE RLS + fail-closed `ws_isolation` policy on `workspace_identity_salt` / `identity_cluster_registry` / `identity_cluster_edges`. Applied to `brain_dev`; live pg_catalog confirms `relrowsecurity=t`/`relforcerowsecurity=t`; context-less `rls_app` read returns 0 rows (real negative control).
- **F2 HIGH (bare-SHA256 fallback) → RESOLVED.** `sync-use-cases.ts` sources `getOrCreateWorkspaceSalt` once and passes it into `normalizeShopifyOrder`→`customerRef` when `IDENTITY_STITCHER=true`; cross-workspace collision closed.
- **F3 MEDIUM (erasure coverage) → RESOLVED.** `erase-subject.ts:wipePgPii` now nulls `email_hash`/`phone_hash`/`salt_version`/`identity_cluster_id` and deletes the subject's `identity_cluster_edges` in one idempotent transaction. 14 integration tests pass.

## Shreya re-review verdict (2026-06-05T12:02Z)
**P0-B: CLEAR. P1-C: CLEAR.** CRIT=0 / HIGH=0 / MED=0 / **LOW=2** (deferred, non-blocking):
1. `raw_payload` still present in `_ALLOWED_COLUMNS` for PII tables (`ingest.py:183,196`) — structural trap, not triggered by current code; recommend removing + a reject-gate. Fast-follow.
2. `workspace-salt-vault.ts:_readActiveSalt` uses `withSuperadmin` (intended bootstrap bypass) — note for Stage-8 KMS review.

## Net state
Both DPDP gates CLEAR for flag-ON eligibility (flags stay OFF until Stage-8). Stage-6 caveats resolved → epic build is GREEN (9/11 verified at Stage-6 + 2 veto'd slices now cleared = 11/11). Nothing committed (awaits Founder "commit it"); nothing live; held Stage-8 console ceremonies unchanged.
