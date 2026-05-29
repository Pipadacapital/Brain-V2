# 09 — Security Review (Stage 4, VETO) — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Stage** | 4 — security review (Shreya, VETO) |
| **Reviewer** | Shreya (security-reviewer) |
| **Timestamp** | 2026-05-29T17:00:00Z (run) |
| **Verdict** | **PASS** |
| **Mode** | Sequential (review folded; advance to Stage 5 Tanvi) |

---

## Change-class scope (declared FIRST)

App-level secret **custody + retrieval seam** for the Shopify Partner-app HMAC secret feeding the
inbound-webhook verifier. Surfaces TOUCHED: **secret handling**, **webhook-auth correctness**,
**residency (DPDP)**, **never-log**, **IAM least-priv (CDK)**. No tenant rows, no outbound channel, no
PII row, no money path, no LLM/agent action, no new endpoint/consumer (the ingress route is HELD —
seam only).

ALWAYS-ON gates run: vuln/secret-leak grep on the diff (CLEAN — no live `shpss_…` literal in source);
supply-chain (no new deps — reuses boto3/moto/pytest/cdk already pinned); input-validation (singleton
name is a fixed constant, no user input composes the path → no namespace-escape vector). Money/no-float
gates: **N/A — no money-derived code**. India telecom (DLT/NCPR/DND/9-9): **N/A — inbound webhook, no
outbound channel**. 4-layer multi-tenancy: **N/A — app-level singleton, no `workspace_id`** (correctly
documented in plan §8; folding into the per-workspace shape is the parent-forbidden anti-pattern and was
NOT done). Traceability correlation-ID-end-to-end: **N/A for this slice** — no endpoint/consumer/agent
invocation exists yet (seam only); the future ingress route (HELD feature) carries the traceability
obligation and must be re-checked then.

---

## Per-CF verdict

| CF | Sev | Verdict | Evidence (file:line) |
|----|-----|---------|----------------------|
| **CF-HMAC-FAILCLOSED-1** | CRIT | **PASS** | `app_secret_provider.py:237–283` SM not-found/error/empty/missing-key all `raise AppSecretUnavailableError`; `EnvAppSecretProvider:335–341` raises on absent/empty/whitespace; `HeldAppSecretProvider:374–375` raises on every access; factory `app_secret_factory.py:86–98` unknown→Held. No fall-open path anywhere. Re-mutation #2 (below) proves the gate is non-vacuous. |
| **CF-HMAC-VERIFY-THE-VERIFIER-1** | CRIT | **PASS** | `test_app_secret_provider.py:483–547` 3-case kill-test (valid→True, tampered→False, unretrievable→raise) + 2 mutation tests with `# MUTATION:` comments. **Both re-mutated by Shreya → RED; reverted → GREEN (byte-identical).** |
| **CF-HMAC-RETRIEVAL-SHAPE-1** | HIGH | **PASS** | Factory matrix `:62–98`: `aws-secrets-manager`→SM; None/""/local→Env; `case _:`→Held. Tested `:73–120`. Env is NOT the prod default; unknown fails closed. |
| **CF-HMAC-TS-VS-PY-OWNER-1** | HIGH | **PASS** | No TS/boto3 client added; only `apps/ingestion-service/**` + `infra/cdk/**` touched (Python + CDK). TS C1/C2 untouched. Owner boundary documented (plan §3). |
| **CF-HMAC-SINGLE-PRIMITIVE-1** | HIGH | **PASS** | `verify_shopify_hmac` UNCHANGED (`shopify_adapter.py:81–107`); no second HMAC routine; provider reuses parent lazy-boto3/residency/never-log discipline (not re-authored). |
| **CF-HMAC-ALGO-DISTINCT-1** | HIGH | **PASS** | C3 base64/raw-body `compare_digest` unchanged; C1 hex/sorted-query untouched. No unification. |
| **CF-HMAC-CONSTTIME-1** | HIGH | **PASS** | `shopify_adapter.py:107` `hmac.compare_digest`. Re-mutation #1 (`compare_digest`→`==`) → RED; reverted → GREEN. |
| **CF-HMAC-HOTPATH-CACHE-1** | MED | **PASS** | `get_shopify_hmac_secret:200–205` cache short-circuit; `_fetch` called once. Spy test `:209–235` asserts ≤1 `get_secret_value` across 5 reads. No per-webhook fetch. |
| **CF-HMAC-ROTATION-MANUAL-1** | MED | **PASS** | Runbook in module docstring `:51–72`; CDK construct has NO rotation schedule + `RemovalPolicy.RETAIN` (`credential-custody-stack.ts` AppShopifyHmacSecret). Auto-rotation structurally absent. |
| **CF-HMAC-RESIDENCY-1** | HIGH | **PASS** | Provider `_client():163–174` hard-codes `region_name="ap-south-1"` + refuse-to-start assert (reuses parent `AwsRegionMismatchError`). Tested `:312–336`. CDK secret CMK-encrypted + ap-south-1 + RETAIN; CDK tests assert all. |
| **CF-HMAC-NEVERLOG-1** | HIGH (VETO) | **PASS** | ids/outcome-only logs throughout; values returned never logged (`:289, :346`); error messages carry only secret_name/error_code, never the value; botocore-DEBUG response-body leak path suppressed (see below). Negative-assertion tests `:344–422` GREEN. Live `shpss_…` absent from source. |
| **CF-HMAC-EXPOSED-VALUE-ROTATE-1** | MED | **PASS** | Runbook `:74–79` flags the `.env:27` value compromised-by-exposure → rotate at Stage-8 STEP 1. `.env` left untouched. |

---

## Shreya re-mutation results (did NOT trust the orchestrator's claim)

**Mutation #1 — CF-HMAC-CONSTTIME-1 (`compare_digest`→`==`):**
Edited `shopify_adapter.py:107` `return hmac.compare_digest(computed, hmac_header)` → `return computed == hmac_header`.
→ `test_mutation_constant_time_compare` **FAILED (RED)** — source assertion `"compare_digest" in src` fired.
Reverted to backup → byte-identical → test **GREEN**. `shopify_adapter.py` confirmed unmodified in working tree.

**Mutation #2 — CF-HMAC-FAILCLOSED-1 (provider not-found `raise`→`return ""`, fall-open):**
Edited `app_secret_provider.py:242` not-found branch to `return ""` instead of raising.
→ **3 tests FAILED (RED)**: `test_mutation_fail_closed_not_fall_open`, `test_case3_unretrievable_secret_fails_closed`,
`test_resource_not_found_raises_unavailable` (`DID NOT RAISE AppSecretUnavailableError`). The mutation test is
corroborated by two independent fail-closed assertions — the gate is non-vacuous and the fall-open is caught
three ways. Reverted → `diff` vs backup empty → full suite **263 passed, 14 skipped (GREEN)**.

Both mutation comments name the exact change that makes them RED; Rohan can re-run at Stage 6.

## NEVERLOG defense-in-depth (independently verified — the flagged provenance item)

The `_fetch()` botocore-suppression (`app_secret_provider.py:226–260`) saves the `botocore` logger level,
sets it to WARNING for just the `get_secret_value` call, and restores it in a `finally`. I independently
proved with a live harness that the level is **restored even through the exception path** (set DEBUG → forced
ResourceNotFound → confirmed level returned to DEBUG 10): **no global side-effect leak**. The suppression is
scoped + restored on both success and error. botocore's DEBUG response-body dump (which contains the
SecretString) therefore cannot leak through this path even if the service runs at DEBUG. The
botocore/urllib3-DEBUG-OFF operational posture remains a correct Stage-8 precondition — this in-code
suppression is sound belt-and-suspenders and is **sufficient** for this slice (no live AWS, no ingress route;
the only GetSecretValue is the boot fetch and it is wrapped). urllib3 is not a separate plaintext vector here
(HTTPS body is TLS-wrapped at the wire logger).

---

## Findings

**CRITICAL:** 0
**HIGH:** 0
**MEDIUM:** 0
**LOW:** 0

### Notes / tech-debt (non-blocking, carry to the HELD ingress-route feature)
- **N1 (carry-forward, not a finding):** when the inbound-webhook **ingress route** is built (separate HELD
  feature), it MUST (a) carry the correlation ID end-to-end (`request_id`+`trace_id`+`workspace_id`+`user_id`
  as applicable to a pre-auth webhook), and (b) implement the seam contract exactly as documented
  (`app_secret_provider.py:37–49`): `except AppSecretUnavailableError: return REJECT` — never 200. Traceability
  is re-checked at that feature's Stage 4. Flagged so it is not lost.
- **N2 (Stage-8 precondition, already owned):** rotate the exposed `.env:27` `shpss_…` value at the Stage-8
  ceremony; ensure botocore/urllib3 are not at DEBUG in the live ingestion-service. Both already documented.

---

## Gate (G4) — PASS conditions

- [x] Zero CRITICAL findings
- [x] Zero HIGH findings
- [x] Zero compliance violations (DPDP residency PASS; telecom N/A; no PII/outbound/recording surface)
- [x] Zero missing-traceability findings (no code path with a correlation-ID obligation exists this slice; ingress route HELD — flagged N1)
- [x] Mutation endpoints guarded — N/A (no endpoint); the fail-closed verifier seam is guarded + mutation-proven
- [x] MCP tools — N/A (none)
- [x] Connector OAuth-encrypted + webhook-signed — webhook HMAC verifier is the subject; secret CMK-encrypted in custody, ap-south-1
- [x] PII not in logs (sampled) — secret/HMAC never logged; negative-assertion tests GREEN; botocore leak path suppressed
- [x] Vulnerability scans CLEAN on CRITICAL/HIGH — no new deps; no live secret literal; legacy diff 0

**Verification captured:**
- `uv run --no-sync pytest apps/ingestion-service/tests/ -q` → **263 passed, 14 skipped**
- `cd infra/cdk && npm test` → **35 passed**
- `git diff --stat -- "legacy project/"` → **empty (0)**
- live `shpss_<REDACTED-compromised-rotate-at-Stage-8>` grep over `apps/ingestion-service/`, `infra/cdk/` → **0 hits**
- Re-mutation #1 RED→revert→GREEN; Re-mutation #2 RED(×3)→revert→GREEN(263)

---

## Decision

**PASS → Stage 5 (Tanvi, QA).** Zero CRITICAL/HIGH, zero compliance violation, both CRITICAL gates
independently re-mutated and proven non-vacuous, NEVERLOG defense-in-depth verified scoped+restored.
No untraceable code path exists this slice (seam only); the ingress-route traceability obligation is
flagged (N1) for the HELD follow-on feature. No commit (awaiting Founder "commit it").
