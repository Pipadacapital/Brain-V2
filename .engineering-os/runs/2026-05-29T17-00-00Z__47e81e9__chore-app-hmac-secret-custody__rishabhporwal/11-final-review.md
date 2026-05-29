# 11 — Final Review (Stage 6, VETO + delegated Founder gate) — chore-app-hmac-secret-custody

| Field | Value |
|-------|-------|
| **req_id** | `chore-app-hmac-secret-custody` |
| **Stage** | 6 — final review (Rohan, CTO Advisor) |
| **Reviewer** | Rohan (cto-advisor) — signing the Founder gate under standing delegation (`feedback_founder_delegates_to_cto_advisor`) |
| **Timestamp** | 2026-05-29T18:45:00Z |
| **Verdict** | **PASS → APPROVE** (delegated Founder gate signed) |
| **feature_class** | high-stakes · **paradigm** `sql` · **cost** ₹0/mo recurring |
| **Parent** | `feat-credential-custody-aws-sm` (Stage-8 readiness-held) · CF-ref `CF-CC-SHOPIFY-HMAC-1` |

---

## 0. Scope of this review

A high-stakes slice that closes the plaintext-secret posture on the Shopify Partner-app HMAC
secret for the **inbound-webhook verifier (C3, Python/ingestion-service)**. It ships a singleton
secret **retrieval seam** (`AppSecretsManagerProvider` + factory + dev/held fallbacks), the
verify-the-verifier kill-test + 2 mutation tests on the existing `verify_shopify_hmac()`, and a
CDK representative-secret delta (authored-not-deployed). The TS OAuth path (C1/C2) stays
`requireEnv`-injected with a named follow-on. The inbound-webhook ingress route and all live AWS
provisioning are HELD for Stage-8.

I reviewed every run-folder artifact (01, 02, 03, 04, 05, 06, 09, 10, pending-founder-commit),
re-read the original requirement for drift, spot-checked the source, and **independently
re-ran the verification gates myself with captured output** (§2).

---

## 1. Drift check (requirement → plan → build)

| Original ask | Delivered | Drift? |
|--------------|-----------|--------|
| Stop the HMAC secret living in plaintext; retrieve it from custody before the webhook gate runs | SM singleton provider + factory feeding the unchanged verifier, fail-closed | **None** |
| "OR a dedicated env var" escape-hatch | Simplified to: SM = prod default; env = DEV-only fallback gated by the same `CONNECTOR_CUSTODY_BACKING` flag; unknown→fail-closed | None — Stage-1 simplification honored |
| Verify before processing | Seam + the verify-the-verifier kill-test; ingress route HELD (correctly out of scope) | None — seam-only boundary respected, confirmed `git status` shows no endpoint files |

**No scope creep, no drift.** The build is byte-faithful to §17/§17b of the plan.

---

## 2. MANDATORY — Stage-6 verify-the-verifier re-mutation (run by me, on disk, captured)

Durable sub-rule 7 (verify-the-verifier) is runnable here (moto, no real AWS), so it was NOT
deferred. I gave **special scrutiny** to these gates because they were authored by the
orchestrator after a transient API-500 interrupted the Python builder — the question is whether
they are genuine or vacuous. They are **genuine**.

**Clean baseline:** `test_app_secret_provider.py` → **37 passed** before any mutation.

### Re-mutation #1 — CF-HMAC-CONSTTIME-1 (`hmac.compare_digest` → `==`)
- Edited `shopify_adapter.py:107` `return hmac.compare_digest(computed, hmac_header)` → `return computed == hmac_header`.
- `test_mutation_constant_time_compare` → **FAILED (RED)** — source assertion `"compare_digest" in src` fired with the exact CF-HMAC-CONSTTIME-1 message.
- Reverted from backup → **diff empty (byte-identical)** → test **GREEN (1 passed)**.

### Re-mutation #2 — CF-HMAC-FAILCLOSED-1 (not-found `raise AppSecretUnavailableError` → `return ""`)
- Edited `app_secret_provider.py` ResourceNotFound branch to `return ""` (fall-open).
- Provider suite → **RED: 4 failed, 33 passed** — the dedicated `test_mutation_fail_closed_not_fall_open`
  PLUS 3 corroborating fail-closed assertions (`test_resource_not_found_raises_unavailable`,
  `test_case3_unretrievable_secret_fails_closed`, `test_secret_never_in_logs_on_error`). The
  fall-open is caught **four independent ways** — this is the opposite of a vacuous self-referential gate.
- Reverted from backup → **diff empty (byte-identical)** → full file suite **37 passed**.

### Independence note (the orchestrator-authored-gate concern)
Mutation #2's strength is that it is corroborated by behavioral assertions written against
*different* code paths (not-found, case-3, never-log), not a single tautological test. Tanvi
also confirmed `TestVerifyTheVerifier` imports and calls the **real** `verify_shopify_hmac`
(no mock/patch). I accept both gates as **non-vacuous**.

### Full-suite + CDK + leak replication (matched Stage-5 PASS with my own captured output)
- `uv run --no-sync pytest apps/ingestion-service/tests/ -q` → **263 passed, 14 skipped** (matches Tanvi exactly).
- `cd infra/cdk && npm test` → **35 passed** (matches exactly).
- `grep shpss_<REDACTED-compromised-rotate-at-Stage-8> apps/ingestion-service/ infra/cdk/` → **0 hits** (NEVERLOG).
- `git diff --stat -- "legacy project/"` → **0** (legacy untouched).

**I spot-re-ran 5 of Tanvi's gates (≥3 required): both mutations, full Python suite, CDK suite,
never-log grep. All PASS replicated. Stage-5 quality confirmed.**

---

## 3. Per-CF final verdict (11-CF acceptance contract, §17b)

| CF | Sev | Verdict | Basis |
|----|-----|---------|-------|
| CF-HMAC-FAILCLOSED-1 | CRIT | **PASS** | All raise paths in source; my re-mutation #2 RED×4 / revert / GREEN. No fall-open anywhere. |
| CF-HMAC-VERIFY-THE-VERIFIER-1 | CRIT | **PASS** | 3-case kill-test on the REAL verifier + 2 mutations; I re-mutated both → non-vacuous. |
| CF-HMAC-RETRIEVAL-SHAPE-1 | HIGH | **PASS** | Factory matrix `app_secret_factory.py:62–98`: aws-sm→SM; None/""/local→Env; `case _:`→Held. Env not the prod default. |
| CF-HMAC-TS-VS-PY-OWNER-1 | HIGH | **PASS** | No TS/boto3 client added (only `apps/ingestion-service/**` + `infra/cdk/**` touched); follow-on named. |
| CF-HMAC-SINGLE-PRIMITIVE-1 | HIGH | **PASS** | `verify_shopify_hmac` UNCHANGED (`shopify_adapter.py:81–107`); no second HMAC routine; parent custody machinery reused not re-authored. |
| CF-HMAC-ALGO-DISTINCT-1 | HIGH | **PASS** | C3 base64/raw-body `compare_digest` unchanged; C1 hex/sorted-query untouched. No unification. |
| CF-HMAC-CONSTTIME-1 | HIGH | **PASS** | `shopify_adapter.py:107` `hmac.compare_digest`; my re-mutation #1 RED / revert / GREEN. |
| CF-HMAC-HOTPATH-CACHE-1 | MED | **PASS** | `get_shopify_hmac_secret` cache short-circuit (`:200–205`); spy test ≤1 `get_secret_value` across 5 reads. |
| CF-HMAC-ROTATION-MANUAL-1 | MED | **PASS** | Runbook in module docstring `:51–79`; CDK construct has NO rotation schedule + RETAIN. Auto-rotation structurally absent. |
| CF-HMAC-RESIDENCY-1 | HIGH | **PASS** | Provider `_client()` hard-codes `region_name="ap-south-1"` + refuse-to-start assert (`:167–174`); CDK CMK+secret ap-south-1 + RETAIN; CDK tests assert all. |
| CF-HMAC-NEVERLOG-1 | HIGH (VETO) | **PASS** | ids/outcome-only logs; botocore-DEBUG suppression scoped + restored in `finally` (`:226–260`); negative-assertion tests GREEN; live `shpss_…` absent (my grep = 0). |
| CF-HMAC-EXPOSED-VALUE-ROTATE-1 | MED | **PASS** | Runbook `:74–79` flags `.env:27` compromised → rotate at Stage-8 STEP 1; `.env` left untouched. |

**11/11 CFs MET. Zero open CRITICAL/HIGH. Shreya's VETO surfaces (NEVERLOG, FAILCLOSED) cleared and re-verified by me.**

---

## 4. Paradigm / cost audit

`@paradigm sql` — deterministic HMAC-SHA256 + one cached AWS GetSecretValue + an in-process
cache. **Zero LLM, zero ML, zero inference** confirmed across all three new files (module
docstrings + class docstrings carry `@paradigm: sql`; no inference import anywhere). Recurring
cost **₹0/mo** — the SM GET + KMS Decrypt are once-per-boot (cached), well under free-tier, and
the secret + CMK are part of the already-HELD provisioning. No paradigm escalation beyond plan.
**PASS — no cost-routing-paradigm breach.**

---

## 5. Multi-tenancy / observability / over-engineering audit

- **4-layer multi-tenancy:** correctly **N/A** — app-level singleton (`brain/_app/...`, no
  `workspace_id`). Folding into the per-workspace shape is the parent-forbidden anti-pattern and
  was NOT done (`_app/` namespace is fixed-constant, no user input composes it → no namespace-escape).
  Residency (the dimension that DOES apply) is enforced. PASS.
- **Observability:** proportionate — structured ids/outcome logs only, no new dashboards/metrics
  infra. Correct for a ₹0 boot-time read. PASS.
- **Over-engineering audit (mandatory):**
  - Files staged not in the plan? **No** — exactly the §17 tracks (3 new Python files + 2 CDK files). `git status` confirms no extras.
  - Observability/metrics/tests beyond plan? **No** — tests target gate/fail-closed/cache/never-log/residency; no trivial-getter tests; no metrics infra.
  - Deps beyond plan? **No** — reuses boto3/moto/pytest/cdk already pinned (Tanvi op-readiness: no new pip deps).
  - New abstractions for "future use"? **No** — singleton provider mirrors the shipped factory pattern; manual `refresh()` kept simple (no TTL-poller).
  - Plan length proportionate? **Yes** — high-stakes band; handoff folded into §17b (justified §0).
  - 30+ line WHAT-comments? **No** — comments are load-bearing CF rationale (IAM-not-widened proof, seam contract, rotation runbook), all WHY/contract, not WHAT.
  - **Verdict: no over-engineering. PASS.**

---

## 6. Hard-rule deviation scan (step 9)

| Hard rule | Present? |
|-----------|----------|
| Dependency violation | No — parent is the only dep; this is its bound child. |
| Single-Primitive violation | No — verifier reused unchanged; custody machinery reused. |
| Compliance gap (DPDP/telecom/PII/money) | No — DPDP residency enforced; telecom/PII/money N/A (inbound webhook, app credential). |
| Paradigm escalation beyond plan | No — `sql`, ₹0. |
| Gate-skip without codified exception | No — all gates ran (S4 sequential, S5, S6); no skips. |

**No hard-rule deviation. The delegated auto-approve path is clear** (no surface-to-Founder block triggered at step 9).

---

## 7. Verdict

**PASS → APPROVE.** Signed on the Founder's behalf under standing delegation
(`feedback_founder_delegates_to_cto_advisor`). This is a clean, reversible, additive closure of a
real plaintext-secret posture on a security-load-bearing auth gate, with both CRITICAL gates
independently re-mutated by me and proven non-vacuous, NEVERLOG re-verified, and zero
CRITICAL/HIGH across S4/S5/S6.

There is no "pass with reservations" — this is a clean PASS. The items below are **HELD-for-Stage-8
ceremony work** (not review findings), and the live-provisioning HOLD + no-commit-without-Founder
rule both remain in force.

### HELD for Stage-8 console ceremony (Founder / Jatin — NOT this build)
1. Real Secrets Manager provisioning of `brain/_app/shopify/hmac_secret` + the app CMK association.
2. Put + **rotate** the live `shpss_…` value (compromised-by-exposure at `apps/api-gateway/.env:27`).
3. IAM role attachment to the ingestion-service task role (the policy itself is already scoped; `brain/*` prefix-covers `brain/_app/*` — no widening).
4. The inbound-webhook **INGRESS ROUTE** — a separate feature (`connector-webhook-intake`); this slice leaves only the seam. Its Stage-4 must re-check traceability (N1) + implement the seam contract (`return REJECT` on `AppSecretUnavailableError`, never 200).
5. Set `botocore`/`urllib3` log level OFF-DEBUG in the live ingestion-service (the in-code suppression is belt-and-suspenders; the operational posture is still a Stage-8 precondition).
6. Festival-safe window for the live rotation (avoid a freeze window).

### Named TS follow-on (bound, not built)
`chore-ts-oauth-app-secret-custody` — move C1/C2 (TS OAuth) off `requireEnv` to a TS app-secret
reader against the SAME `brain/_app/shopify/hmac_secret` key. Tracked in the plan §3 ruling +
per-feature journal. Mechanical extension, not a rework.

---

## 8. Gate (G6) — PASS conditions

- [x] Drift check clean (requirement = plan = build)
- [x] Paradigm audit complete — `sql`, ₹0, zero inference, no escalation
- [x] 4 multi-tenancy layers addressed (N/A app-singleton, documented; residency enforced)
- [x] Observability implemented + proportionate
- [x] Over-engineering audit PASS (no extra files/deps/abstractions/comments)
- [x] ≥3 Stage-5 gates spot-re-run by me with captured output (5 run: 2 mutations + full Python + CDK + grep)
- [x] Verify-the-verifier re-mutated on disk by me — both RED / revert byte-identical / GREEN — non-vacuous
- [x] All sub-reviews PASS (S4 Shreya 0 findings; S5 Tanvi 0 findings; S6 0 findings)
- [x] Hard-rule deviation scan clean → delegated auto-approve permitted
- [x] Recommendation explicit: **APPROVE**
- [x] Mechanical commit command produced for Founder (§ pending-founder-commit.md)

**Decision: PASS → delegated Founder gate APPROVED. Advance to Stage 8 (Jatin), which remains
HELD behind the named live-provisioning ceremony. No commit until Founder types "commit it".**
