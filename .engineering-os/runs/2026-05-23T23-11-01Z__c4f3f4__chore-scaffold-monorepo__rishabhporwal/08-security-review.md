# 08-security-review.md — Stage 4 Security Review

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Reviewer** | Shreya (security-reviewer) |
| **Stage** | 4 |
| **Mode** | PARALLEL REVIEW (Shreya ∥ Tanvi) |
| **Lane** | high-stakes |
| **Timestamp** | 2026-05-23T23:42:03Z |
| **Verdict** | **PASS** |
| **Staged set** | 105 files (96 real + DDD `.gitkeep` homes), product code only; no commit |

---

## Change-class scope (declared FIRST)

This change is a **monorepo skeleton + working root toolchain** — structure and config,
**no running code**: no live endpoints, no PII flows, no connectors, no outbound channels,
no AI/LLM invocation, no money-movement code, no DB. The trigger surface is `schema-proto`
(the `protos/` + `buf` contract source of truth is being established).

**ALWAYS-ON checks (run regardless of class):**
- Secrets / credential grep over the staged set — RUN.
- Supply-chain / dependency-manifest review (root + member manifests, lockfiles) — RUN.
- Input-validation surface (shell scripts, codegen config) — RUN.
- Money-derived-code convention (minor-units / no-float / no-LLM-numbers) — the scaffold
  introduces **no money code**; the *convention home* (`docs/conventions/money.md`) is
  reviewed for correctness instead.

**Surface-specific gates — N/A (out of scope: scaffold has no such surface).** Justified by
the scope declaration above. Marked N/A, **not** fabricated as findings:
- Mutation-endpoint guards (requireRole + requireWorkspaceMember + Zod + workspace_id assert) — **N/A** (no endpoint). *Seam home verified present.*
- MCP-tool / agent-emitted-action audit (blast radius, Decision Log middleware, idempotency, human gate) — **N/A** (no tool/agent). *Decision Log + idempotency homes verified present.*
- Connector OAuth (AES-256-GCM + webhook signature + per-brand KMS) — **N/A** (no connector). *Region/connector homes documented.*
- Outbound-channel compliance gate (DLT / NCPR-DND / 9am–9pm / 48h cap / WhatsApp opt-in+template+window / AI-voice disclosure / recording consent) — **N/A** (no outbound surface). *Telecom-compliance home documented in region-adapter + lifecycle-service.*
- **India-compliance section (DPDP/PDPL/DLT/NCPR/PCI)** — **N/A — out of scope (scaffold-only, no PII / no payment data / no telecom send).** *Seams verified to have homes (see §Seam audit).*

---

## What a scaffold CAN still get wrong — checked

| # | Check | Result |
|---|-------|--------|
| 1 | Secrets / tokens / credentials committed or staged | **CLEAN** — pattern scan over all 105 staged files: zero matches (no AWS keys, private keys, bearer/API/client secrets, GH/Slack/OpenAI tokens). |
| 2 | `.env` with real values staged | **CLEAN** — no `.env*` staged. |
| 3 | Key material (`.pem/.key/.p12/.pfx/.jks`) staged | **CLEAN** — none. |
| 4 | `.gitignore` excludes secrets / `.venv/` / `node_modules/` / generated stubs | **PASS** — `.venv/`, `node_modules/`, `__pycache__/`, `*.egg-info`, `.turbo/`, both generated-stub dirs ignored; lockfiles explicitly NOT ignored (committed, correct). |
| 5 | Generated stubs NOT committed (regen-in-CI per ADR-003) | **PASS** — no `proto-ts/gen/` or `proto_py/_gen/` staged; double-guarded (root `.gitignore` + per-package `.gitignore`). |
| 6 | Brain-only naming; no vendor as positioning | **PASS** — no Kleio/Statlas anywhere; vendor names (Shopify/Unicommerce/MoEngage) appear only as integration-target descriptions, which is the allowed usage. |
| 7 | DDD layering present; no `controllers/`-style folder | **PASS** — all 7 backend services carry `bootstrap/domain/application/infrastructure/interfaces`; `find` for `controllers/` `services/` `models/` `utils/` `helpers/` returns empty. |
| 8 | proto / contract hygiene | **PASS** — `buf.yaml` v2 (DEFAULT lint, FILE breaking); `health.proto` is BUF-DEFAULT-clean, service-less (no executable surface), correct `brain.<ctx>.v1` package. |
| 9 | Supply-chain footgun (unpinned/abandoned deps in manifests) | **PASS** — member manifests declare `dependencies = []` / no third-party deps; only root devDep is `turbo`. buf codegen plugins are **pinned** (`bufbuild/es:v2.4.0`, `community/danielgtaylor-betterproto:v0.0.3`). No KafkaJS/Prisma/Next runtime deps introduced. |
| 10 | Lockfile registry integrity | **PASS** — `pnpm-lock.yaml` uses standard npm-registry SHA-512 integrity (turbo + transitives only); `uv.lock` uses only local `virtual`/`editable` sources, zero external PyPI deps. |
| 11 | Shell script injection surface (`tools/check-metrics-parity.sh`) | **PASS** — `set -euo pipefail`, no interpolation, no external input, `exit 0` stub. |

---

## Seam audit — day-one security/compliance non-negotiables have HOMES (Appendix C)

The point of a scaffold is that the enforcement seams are *placed* so they cannot be
retrofitted/forgotten. Each is documented with a concrete home:

| Seam | Home(s) | Verdict |
|------|---------|---------|
| Multi-tenancy `workspace_id` (4 layers) | `docs/conventions/multi-tenancy.md` — L1 JWT (api-gateway), L2 service assertion + `requireRole`, L3 Postgres RLS, L4 ClickHouse predicate; + Kafka envelope + idempotency cross-cutting | **PRESENT, correct.** This is my top VETO surface; the 4-layer contract is invariant and documented before any code exists. |
| Money = integer minor units | `docs/conventions/money.md` — BIGINT/Int64/`int64`, never float/Decimal/NUMERIC; meters realized GMV | **PRESENT, correct.** |
| Decision Log (append-only, tamper-evident) | `docs/conventions/decision-log.md` — single primitive, `ai.decision_log`, INSERT-only, hashes not values, carries `workspace_id`+`request_id`+`trace_id`+`user_id` | **PRESENT, correct.** Shares `audit-log-immutability` discipline. |
| Correlation ID end-to-end | `docs/conventions/observability.md` — `request_id`+`trace_id`+`workspace_id`+`user_id` via headers→gRPC metadata→Kafka envelope→structured logs; **error responses must surface `request_id`** | **PRESENT, correct.** |
| Event envelope w/ required `workspace_id` | `docs/conventions/events.md` — 10-field envelope, `workspace_id` required + partition key, consumer assertion mandated | **PRESENT, correct.** |
| RegionAdapter (no region forks) | `docs/conventions/region-adapter.md` — `pylibs/brain_regional` + `packages/config`; telecom compliance (DLT/NCPR/DND/9–9 window) home = `apps/lifecycle-service`; data residency `ap-south-1` default | **PRESENT, correct.** Compliance enforcement has a named home before any send code exists. |
| PII-in-logs discipline | `docs/conventions/observability.md` — structured JSON only, no free-form strings (redaction home established) | **PRESENT.** Hash-by-default/redaction enforcement lands with first PII flow. |

**No seam is missing a home. No seam was placed in a wrong layer.**

---

## Traceability (VETO surface) — PASS

Correlation-ID convention is documented end-to-end (header→gRPC→Kafka→log) before any
runtime exists, and error responses are mandated to surface `request_id`. Run-level
artifact chain is complete and internally consistent:
- Decision-log JSONL: intake → intake-decision → persona-synthesis → binding-plan → stage-3-complete (all present, `req_id` consistent).
- `live.log`: START/DONE lines for every stage through Stage 3.
- Journals: architect, backend, cto-advisor + feature journal `feat-chore-scaffold-monorepo.md` all present.
- Artifacts 01 / 02 / 02b / 03 / 06 / 07 all present in the run folder.

No untraceable code path exists (there is no code path yet); the *traceability machinery*
itself has a correct, documented home. **No missing-traceability finding.**

---

## Findings

| ID | Severity | Area | Finding | Required action |
|----|----------|------|---------|-----------------|
| S-1 | **LOW** | Toolchain verification | buf lint/build/generate + TS import smoke (acceptance #5–#8) were SKIPPED (buf not in build env). The proto/buf config is structurally correct but the codegen round-trip is unproven. | Tanvi (Stage 5) MUST install buf and run `buf lint protos`, `buf build protos -o /dev/null`, `buf generate protos` + TS/Python import smokes before G5 PASS. Tracked, non-blocking for G4. |
| S-2 | **LOW** | Supply-chain (forward) | buf codegen plugins are version-pinned today, but there is no enforced lockfile/digest pin for remote buf plugins (`buf.build/...`). Acceptable at scaffold; a future plugin bump is a supply-chain entry point. | When Jatin wires CI, pin buf plugin **digests** (not just tags) and run `buf generate` reproducibly. Already flagged in ADR-003. Tracked. |
| S-3 | **INFO** | Doc consistency | `07-build-report.md` states 96 staged files; `git diff --cached` shows 105 (the delta is the intentional `lifecycle-service/python/` DDD `.gitkeep` homes per ADR-004 + the 8 `docs/conventions/` files). Counting nuance, not a security issue. | None required. Note for report accuracy. |
| S-4 | **INFO** | Defense-in-depth (good) | Generated stubs are gitignored at BOTH root `.gitignore` and per-package `.gitignore` — redundant guard against accidental stub commit. | None — positive observation. |
| S-5 | **INFO** | Env drift | Build ran on Node v22 vs pinned v24 (engine warning only, install PASS). | None — informational; CI/dev should align to `.node-version` 24. |

**Counts: CRITICAL 0 · HIGH 0 · MED 0 · LOW 2 · INFO 3.**

---

## Gate G4 — PASS conditions

- [x] Zero CRITICAL findings
- [x] Zero HIGH findings
- [x] Zero compliance violations (DPDP/PDPL/DLT/NCPR/calling-hours/recording-consent) — N/A surface; seams have correct homes
- [x] Zero missing-traceability findings — artifact chain complete; correlation-ID home placed
- [x] Every mutation endpoint guarded — N/A (no endpoint); guard home documented
- [x] Every MCP tool tenant-checked + Decision Log middleware — N/A (no tool); Decision Log home documented
- [x] Every connector OAuth-encrypted + webhook-signed — N/A (no connector); home documented
- [x] PII not in logs — N/A (no runtime); structured-log + redaction home documented
- [x] Vulnerability scans CLEAN on CRITICAL/HIGH — no exploitable dep surface; manifests empty + lockfiles integrity-pinned

---

## Verdict

**PASS.** A correctly-built scaffold: zero secrets, zero anti-pattern folders, clean
supply-chain surface, Brain-only naming, and — most importantly for a high-stakes
foundational change — **every day-one security/compliance/multi-tenancy/traceability seam
has a correct, documented home so it is enforced, not retrofitted.** The two LOW findings
(buf checks deferred to Stage 5; future buf-plugin digest pinning) are tracked tech debt
and do not block G4.

**Parallel-mode note:** This is my verdict only. I do NOT advance the pipeline. The
orchestrator reconciles with Tanvi's QA review. Tanvi MUST execute the SKIPPED buf
acceptance items (#5–#8) at Stage 5 (re-run gates marked SKIPPED upstream).

