# Feature journal — chore-app-hmac-secret-custody

## Stage 1 (intake + synthesis) — 2026-05-29T17:05:00Z — Rohan (cto-advisor)

**Decision:** ADVANCE → Architect (Aryan), Stage 2. feature_class=high-stakes; paradigm=sql; ₹0/mo.
**Parent:** feat-credential-custody-aws-sm (CF-CC-SHOPIFY-HMAC-1, Track C). Parent at Stage-8 readiness-held.

**Grounding correction:** `SHOPIFY_CLIENT_SECRET` has THREE consumers (not one):
- C1 TS core-service `validateShopifyHmac` — OAuth-callback HMAC, hex/sorted-query, workspace context EXISTS.
- C2 TS core-service `exchangeShopify` — OAuth token exchange client_secret.
- C3 Python ingestion-service `verify_shopify_hmac` — inbound-webhook HMAC, base64/raw-body, secret injected as param, NO workspace context, NO caller yet.
Canon §3 → ingestion-service owns webhooks. The stub (core-service) + grounding-note (api-gateway) were both partial.

**Personas (2/2, both ACCEPTED, 9 concerns, 1 CRIT):** webhook-hmac-verification-correctness-realist:haiku + app-level-secret-custody-residency-realist:sonnet.

**CF contract:** FAILCLOSED-1 (CRIT), VERIFY-THE-VERIFIER-1 (CRIT), ALGO-DISTINCT-1, SINGLE-PRIMITIVE-1, RETRIEVAL-SHAPE-1, TS-VS-PY-OWNER-1, RESIDENCY-1, HOTPATH-CACHE-1, ROTATION-MANUAL-1, NEVERLOG-1, EXPOSED-VALUE-ROTATE-1 + parent inheritance. Full text: run-folder 05-stage1-synthesis.md §3.

**Escalation:** none. Non-blocking Founder readiness item: rotate the exposed `.env` shpss_… value at Stage-8 ceremony.

**Next:** Aryan Stage 2 binding plan; the crux call = the TS-vs-Python retrieval-owner boundary (CF-HMAC-TS-VS-PY-OWNER-1).

## Stage 2 (binding plan) — 2026-05-29T17:20:00Z — Aryan (architect)

**Artifact:** `06-architecture-plan.md` (handoff folded into §17b; no separate 07). Status → dev-parallel / ready-for-Stage-3.

**THE RULING (CF-HMAC-TS-VS-PY-OWNER-1):** Python (C3 webhook) reads the SM singleton `brain/_app/shopify/hmac_secret` via a new app-secret provider this slice; TS (C1/C2 OAuth) stays `requireEnv`-injected. One value, one retrieval owner (Python) now. TS move = named follow-on `chore-ts-oauth-app-secret-custody`. Rationale: C3 is the only context-free auth gate + lives in the runtime that already owns the AWS custody machinery; a second TS AWS client doubles audit surface for zero gain on a leg that already works with workspace context (parent kept TS AWS-free, CF-CC-OWNER-1). Single-Primitive satisfied at value+verifier+machinery level. Reversible.

**Provider design:** `AppSecretsManagerProvider` reuses the parent lazy-boto3 `_client()` + ap-south-1 residency assert + never-log, reads the FIXED singleton (no workspace_id path), boot/first-use fetch + cache (≤1 SM call, CF-HMAC-HOTPATH-CACHE-1), fail-closed on unretrievable. `select_app_secret_provider()` mirrors `custody_factory` on the same `CONNECTOR_CUSTODY_BACKING` flag (unknown→Held fail-closed). Feeds the UNCHANGED `verify_shopify_hmac()` — no 2nd HMAC routine; C3 base64-raw-body / C1 hex-sorted-query stay distinct + constant-time.

**Builder split:** @maya (T1 provider+factory, T2 verify-the-verifier kill+mutation tests, T4 rotation runbook — ingestion Python) + @jatin (T3 CDK representative singleton secret + IAM doc-note, no widening; authored-not-deployed). NO TS track this slice.

**AC headline:** 11 CFs → §17b table (artifact ↔ S4/S5/S6 bounce). CRIT: FAILCLOSED-1 (raise→reject; mutation #2 fall-open RED) + VERIFY-THE-VERIFIER-1 (3-case kill-test + compare_digest→`==` and fail-closed→fall-open mutations RED; Rohan re-mutates S6). NEVERLOG-1 (Shreya VETO) pass-1.

**HELD for Stage-8 console:** real SM provisioning + CMK; put + rotate the live shpss_… (compromised); IAM role creation; the inbound-webhook INGRESS ROUTE (separate feature — this slice leaves the seam only).

**Next:** @maya + @jatin — Stage 3 build, spawned in parallel. No commit.

## Stage 3 CDK track (T3) — 2026-05-29T18:00:00Z — Jatin (platform-devops)

**Status:** AUTHORED, NOT DEPLOYED. `cdk synth` + assertions tests PASS. No `cdk deploy`, no commit.

**Files changed (2):**
- `infra/cdk/lib/credential-custody-stack.ts` — added `appShopifyHmacSecret` (public readonly `secretsmanager.Secret`); construct id `AppShopifyHmacSecret`; secret name `brain/_app/shopify/hmac_secret`; `encryptionKey: this.credentialCmk` (existing CMK, no new key); `removalPolicy: RETAIN`; doc comment block establishing IAM-not-widened proof + auto-rotation FORBIDDEN note; `AppShopifyHmacSecretArn` CfnOutput.
- `infra/cdk/test/credential-custody-stack.test.ts` — updated SM secret count (1→2); added `describe` block "App-level singleton secret (CF-HMAC-RESIDENCY-1, T3)" (8 tests); added `describe` block "IAM NOT widened by T3 (CF-CC-IAM-LEASTPRIV-1 regression)" (5 tests). 35 total tests, all PASS.

**IAM not-widened proof (confirmed):** `BrainSecretsManagerCustody` statement resource remains `arn:aws:secretsmanager:ap-south-1:*:secret:brain/*`. `brain/_app/shopify/hmac_secret` matches this pattern by prefix (`brain/` covers `brain/_app/...`). SECRETSMANAGER_ACTIONS (6) and KMS_ACTIONS (2) are unchanged. Policy still has exactly 2 statements. Mechanically verified in the new regression describe block.

**cdk synth output (relevant resource):** `AppShopifyHmacSecret8772AA04` type `AWS::SecretsManager::Secret`, `Name: brain/_app/shopify/hmac_secret`, `KmsKeyId: Fn::GetAtt: [CredentialCustodyCmk0D701516, Arn]`, `DeletionPolicy: Retain`. No new KMS key (still exactly 1 `AWS::KMS::Key`). Still exactly 1 `AWS::IAM::ManagedPolicy`. 3 CfnOutputs total (CredentialCmkArn, CustodyPolicyArn, AppShopifyHmacSecretArn).

**CF gates cleared this track:** CF-HMAC-RESIDENCY-1 (CMK-encrypted, ap-south-1, RETAIN), CF-CC-IAM-LEASTPRIV-1 (no widening, regression-asserted), CF-CC-NO-LIVE-1 (authored-not-deployed, no real SecretString), CF-HMAC-ROTATION-MANUAL-1 (no rotation schedule; doc comment + description flag FORBIDDEN).

**HELD for Stage-8 console (unchanged):** real SM provisioning of `brain/_app/shopify/hmac_secret`, put + rotate the live `shpss_…`, IAM role attachment, festival-safe window.

**Pending-founder-commit:** `infra/cdk/lib/credential-custody-stack.ts`, `infra/cdk/test/credential-custody-stack.test.ts` (listed in run-folder `pending-founder-commit.md`).

**Next:** @maya Stage 3 Python tracks (T1 provider+factory, T2 verify-the-verifier tests, T4 rotation runbook) complete the slice. No further CDK delta needed.

---

## 2026-05-29 — Stage 3 Python track COMPLETE (Maya track; finished by orchestrator after a transient API-500 interrupted the builder)

**Built (ingestion-service):**
- `src/infrastructure/secrets/app_secret_provider.py` — `AppSecretsManagerProvider` (reuses parent lazy boto3 `_client()` + ap-south-1 residency assert + ids-only never-log), reads the FIXED singleton `brain/_app/shopify/hmac_secret` (no workspace_id), boot/first-use fetch + in-process cache (≤1 SM call), fail-closed `AppSecretUnavailableError` on not-found/empty/missing-key; `EnvAppSecretProvider` (dev fallback); `HeldAppSecretProvider` (fail-closed). `get_shopify_hmac_secret()` feeds the UNCHANGED `verify_shopify_hmac` (shopify_adapter.py:81) — no second HMAC routine.
- `src/infrastructure/secrets/app_secret_factory.py` — `select_app_secret_provider()` mirrors `custody_factory.py` on `CONNECTOR_CUSTODY_BACKING` (aws-secrets-manager→SM; local/unset→env; unknown→Held fail-closed).
- `tests/unit/test_app_secret_provider.py` — factory matrix, held, env, moto round-trip, cache ≤1 call, residency, lazy, import-time-zero-call, never-log, **and `TestVerifyTheVerifier`** (CF-HMAC-VERIFY-THE-VERIFIER-1).

**Two completion fixes by orchestrator after the 500:**
1. **NEVERLOG defense-in-depth** — botocore logs the raw GetSecretValue response body (with the secret) on its own DEBUG logger. `_fetch()` now scopes botocore's logger to WARNING for just the fetch (save/restore), so the value cannot leak via botocore even at app-DEBUG. (botocore/urllib3-DEBUG-OFF stays a Stage-8 operational precondition too.) Fixed the previously-failing `TestNeverLog::test_secret_never_in_logs_on_successful_fetch`.
2. **CF-HMAC-VERIFY-THE-VERIFIER-1 wiring** (the interrupted run never reached it) — added `TestVerifyTheVerifier`: 3-case kill-test (valid→True, tampered body→False, unretrievable secret→fail-closed raise) + 2 mutation tests with `# MUTATION:` comments (const-time: `compare_digest`→`==` via source assertion; fail-closed: provider raise→`return ""`). **Both mutations independently proven RED-and-reverted on disk** (compare_digest→== RED; ResourceNotFound-raise→return"" RED; both byte-identical revert + GREEN).

**Tests:** `uv run --no-sync pytest apps/ingestion-service/tests/ -q` → **263 passed, 14 skipped.** Zero real AWS (moto). Legacy diff 0. No commit. Live `shpss_…` never printed/logged. Seam only — NO webhook ingress route built.

**Rotation:** manual two-place (Secrets Manager value + Shopify Partner dashboard) documented in the provider module docstring; auto-rotation FORBIDDEN.

**Next:** Stage 4 (Shreya) — VETO surfaces NEVERLOG + FAILCLOSED + the verify-the-verifier mutations.

---

## 2026-05-29 — Shreya (security-reviewer) — chore-app-hmac-secret-custody
**Stage:** 4
**Action:** Security review PASS
**Findings (CRITICAL):** 0
**Findings (HIGH):** 0
**Findings (MED):** 0 — none
**Compliance gates (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent):** ALL_PASS (DPDP residency ap-south-1 enforced in provider client-assert + CDK CMK/secret; telecom/recording/PII/outbound surfaces N/A — inbound webhook, app-level singleton, no tenant rows, no money)
**Traceability:** PASS (no code path with a correlation-ID obligation this slice — seam only; ingress route HELD; flagged N1 carry-forward for that feature's Stage 4)
**Bounced to:** NONE
**Rationale:** Re-mutated both CRITICAL gates myself — #1 compare_digest→== RED→revert→GREEN; #2 provider not-found raise→return"" RED(×3)→revert→GREEN(263). NEVERLOG botocore-suppression independently proven scoped+restored even on exception (no global side-effect leak); sufficient for this no-live seam. Live shpss_… absent from source; legacy diff 0; CDK IAM not widened (brain/* prefix-covers brain/_app/*, 6-action set unchanged, single CMK). Verdict PASS → Stage 5 (Tanvi).

## Stage 5 (QA review) — 2026-05-29T18:30:00Z — Tanvi (qa-agent)

**Stage:** 5
**Action:** QA PASS
**Test runs:** 37 unit (263 passed, 14 skipped) / 0 int (N/A) / 35 contract (CDK assertions) / 0 e2e (N/A)
**Real-network smoke:** N/A (declared — no live AWS + no ingress route; HELD Stage-8)
**Metric registry parity (TS↔Python):** N/A (paradigm sql/infra)
**Trace IDs end-to-end:** N/A (seam only, no endpoint; obligation on the HELD ingress-route feature)
**Operational-readiness:** PASS
**Mutation tests on high-stakes:** PASS

**Re-mutation #1 (CF-HMAC-CONSTTIME-1 — compare_digest→==):**
Applied: `sed -i '' 's/return hmac\.compare_digest(computed, hmac_header)/return computed == hmac_header/'` on `shopify_adapter.py:107`. `test_mutation_constant_time_compare` FAILED (RED) — source-level assertion `"compare_digest" in src` fired. Reverted (byte-identical backup). Post-revert: 1 passed. Gate NON-VACUOUS.

**Re-mutation #2 (CF-HMAC-FAILCLOSED-1 — raise→return ""):**
Applied: replaced lines 242–247 (ResourceNotFoundException raise block) with `return ""` in `app_secret_provider.py`. 3 tests FAILED (RED): `test_mutation_fail_closed_not_fall_open`, `test_resource_not_found_raises_unavailable`, `test_case3_unretrievable_secret_fails_closed`. Belt-and-suspenders: empty-key HMAC is forgeable (confirmed `verify_shopify_hmac(body, forged_with_empty_key, "") is True`). Reverted (byte-identical backup). Post-revert: 263 passed, 14 skipped. Gate NON-VACUOUS.

**Coverage:** N/A (no coverage target override; suite is exhaustive on all gate paths)
**Bounced to:** NONE
**Findings:** 0 CRITICAL / 0 HIGH / 0 MED / 0 LOW
**Notes carried forward:** N1 (traceability on HELD ingress route), N2 (rotate shpss_… + botocore/urllib3 not DEBUG in prod)

**Handoff:** PASS → Stage 6, Rohan (CTO Advisor). Rohan must re-mutate ≥1 of the two gate mutations per CF-HMAC-VERIFY-THE-VERIFIER-1 §17b. No commit (awaiting Founder "commit it").

## Stage 6 (final review + delegated Founder gate) — 2026-05-29T18:45:00Z — Rohan (cto-advisor)

**Stage:** 6
**Verdict:** **PASS → APPROVE** (Stage-7 gate signed under standing delegation `feedback_founder_delegates_to_cto_advisor`).

**Re-mutation (mandatory, run by me on disk — NOT deferred; moto, no real AWS):**
- Clean baseline `test_app_secret_provider.py` = 37 passed.
- #1 CF-HMAC-CONSTTIME-1 (`compare_digest`→`==` at shopify_adapter.py:107) → `test_mutation_constant_time_compare` **RED**; revert byte-identical (diff empty) → **GREEN**.
- #2 CF-HMAC-FAILCLOSED-1 (not-found `raise`→`return ""` in app_secret_provider.py) → **RED, 4 fails** (mutation test + 3 corroborating behavioral assertions); revert byte-identical → **37 GREEN**. Corroboration by different code paths = the orchestrator-authored gate is genuinely non-vacuous.
- Special scrutiny applied because the gate tests were orchestrator-authored after the builder API-500; confirmed genuine (real `verify_shopify_hmac`, no mock).

**Stage-5 replication (≥3 required, 5 done with captured output):** full Python 263 passed/14 skipped; CDK 35 passed; `shpss_…` grep 0; legacy diff 0; both mutations. All matched Tanvi's PASS.

**Audits:** paradigm `sql` / ₹0 / zero inference confirmed across all 3 files; multi-tenancy N/A (app-singleton `brain/_app/`, residency enforced); observability proportionate; over-engineering audit PASS (no extra files/deps/abstractions/WHAT-comments); hard-rule deviation scan CLEAN → delegated auto-approve permitted. 11/11 CFs MET. 0 CRITICAL/HIGH at S4/S5/S6.

**Auto-candidate-rule scan (step 8a):** root cause "builder API-500 interruption → orchestrator-completed CRITICAL gate" — NOT found in lessons-learned or decision-log as a prior occurrence. First occurrence ⇒ lesson (captured in 14-retro.md), not a ≥3 pattern ⇒ no candidate rule proposed.

**Founder decision:** `12-founder-decision.json` written on Founder's behalf (decided_by "rishabhporwal (Founder) via Rohan standing delegation"). status→approved, stage 8, owner platform-devops (Jatin) — **Stage 8 HELD behind the named live-provisioning ceremony.**

**HELD for Stage-8 console:** real SM provisioning of `brain/_app/shopify/hmac_secret` + CMK; put + ROTATE the live `shpss_…` (compromised); IAM role attach (no widening — `brain/*` prefix-covers); the inbound-webhook INGRESS ROUTE (separate `connector-webhook-intake` feature); botocore/urllib3 OFF-DEBUG live; festival-safe window.

**Named TS follow-on:** `chore-ts-oauth-app-secret-custody` (C1/C2 off `requireEnv` to the same key) — bound, not built.

**Commit:** NOT yet — awaiting Founder free-text "commit it". Mechanical command in `pending-founder-commit.md` (explicit paths, no `git add -A`).

**Next:** Founder runs `commit it` to commit the reviewed code; Stage 8 (Jatin) stays HELD until the Founder/Jatin console ceremony.
