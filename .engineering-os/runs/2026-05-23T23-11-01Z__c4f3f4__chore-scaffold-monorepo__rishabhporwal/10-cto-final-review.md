# Final Review — chore-scaffold-monorepo

> Filled by Rohan (CTO Advisor) in Stage 6. **VETO authority** — can bounce to any earlier stage.
> Validates against [schemas/final-review.schema.json](../../schemas/final-review.schema.json).

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Actor** | cto-advisor (Rohan) |
| **Timestamp** | 2026-05-24T00:05:00Z |
| **Verdict** | **PASS** |
| **Lane** | high-stakes |

---

## Sub-reviews

| Sub-review | Verdict | Notes |
|------------|:------:|-------|
| **Requirement alignment** | PASS | Shipped scaffold IS the locked option-b: §9.1 tree (9 apps + packages/ + pylibs/ + protos/), §9.2 DDD `.gitkeep` layers in all 7 backends, a working four-tool root toolchain (pnpm/turbo/uv/buf all resolve), day-one-non-negotiable HOMES (not implementations). No drift toward option-a (bare tree) or option-c (service boilerplate). Re-read 01-requirement against the staged tree — every success-metric clause is met. |
| **Paradigm audit** | PASS (n/a) | Declared `n/a` at intake (no compute path), reaffirmed at synthesis, confirmed in plan §3 and §18. No `@paradigm` decorator exists because no code path exists; the decorator's *home* (`docs/conventions/paradigm.md`) is present. No frontier_llm / small_llm / ML / SQL call snuck in (there is no runtime). Nothing to route. Audit clean. |
| **Architecture quality** | PASS | Single-Primitive sweep (plan §7) held — zero per-channel/per-region/per-vendor forks; one home per primitive. The only "new" packages (`proto-ts`/`proto_py`) are the *implementation of* the locked proto-first non-negotiable (Appendix C item 8), not a speculative abstraction. No anti-pattern drift: `find apps -type d \( -name controllers -o -name services -o -name models \)` returns empty (verified by me). 4-layer workspace_id seam has homes + a convention doc. |
| **Code quality** | PASS | Sampled (see spot-checks). Config files are minimal and load-bearing; the one shell script is `set -euo pipefail` + `exit 0` stub; the placeholder proto is service-less and header-commented as scaffold-only. No WHAT-comments, no dead code, no over-build. |
| **Security review pass-through** | PASS | Shreya (08-security-review.md): CRITICAL 0 · HIGH 0 · MED 0 · LOW 2 · INFO 3. Secrets CLEAN, supply-chain CLEAN, Brain-only naming, all day-one seams have homes, traceability PASS. The 2 LOWs are non-blocking tracked tech debt (carried as follow-ups below). |
| **QA review pass-through** | PASS | Tanvi: BOUNCE (09-qa-report.md) → fix → PASS (09b-qa-reverify.md), 14/14 checks. I independently re-ran her gates (below) and replicated her PASS with my own captured output. The bounce was real, caught correctly, and the fix is real (not rubber-stamped). |
| **Observability complete** | PASS (proportionate) | No runtime → no live telemetry, and adding dashboards/alarms now would be over-engineering (plan §9). The in-scope observability deliverable — the metric-parity CI wiring point (`tools/check-metrics-parity.sh` + `check:metrics-parity` turbo root task) — is present and exits 0 (I re-ran it). Convention homes for logs/traces/correlation-ID documented. The acceptance contract IS the scaffold's health check; it fails loud. |
| **Cost estimate held** | PASS | Plan §14: ₹0 runtime cost, 0 LLM tokens/day (no infra provisioned, no compute path). Actual: identical — nothing was deployed, no tokens consumed. Variance 0%. |

---

## Independent verification (MANDATORY — I re-ran ≥3 of Tanvi's gates myself)

> I did not trust the reports. I executed the gates on the live repo and captured output. Tool env: buf 1.69.0, node v22.22.2 (engine-warn only; pin is 24), pnpm 11.0.9, python 3.13.7, uv 0.8.22.

| Gate (mine) | My captured result | Matches Tanvi? |
|------|------|:--:|
| **buf generate** (the bounced gate) | `cd protos && buf generate` → EXIT 0; on disk: `packages/proto-ts/gen/brain/health/v1/health_pb.ts` + `pylibs/proto_py/proto_py/_gen/{__init__.py, brain/__init__.py, brain/health/__init__.py, brain/health/v1.py}` | YES |
| **betterproto pin** (the BLOCKING fix) | `protos/buf.gen.yaml` line 17 = `buf.build/community/danielgtaylor-betterproto:v1.2.5` (v0.0.3 gone) | YES |
| **proto-ts runtime dep** (the MEDIUM fix) | `packages/proto-ts/package.json` line 13 = `"@bufbuild/protobuf": "^2.4.0"` | YES |
| **Structural assertions** | `apps/` = exactly 9 dirs; all 7 backends carry `application bootstrap domain infrastructure interfaces`; forbidden `controllers/services/models` scan = empty | YES |
| **5 toolchain pins** | `.node-version`=24, `.python-version`=3.13, `packageManager`=pnpm@11.0.9, `engines.node`=">=24 <25", `requires-python`=">=3.13,<3.14", uv `required-version`=">=0.8.22", `buf.yaml version: v2` | YES |
| **Staging discipline** | `git diff --cached --numstat` = 105 files; zero `gen/|_gen/` stubs staged; zero `.engineering-os/` staged; HEAD = prior EOS commit (scaffold NOT committed) | YES |

**Result: my own captured output replicates Tanvi's Stage-5 PASS on every spot-checked gate.** The QA bounce + fix cycle is genuine and complete; nothing regressed.

---

## Plan-binding audit

**Built scaffold matches the Stage-2 plan (06-architecture-plan.md).** Verified §17 Groups A–G against the staged tree.

**Vikram's three flagged deviations — all confirmed as within-authority implementation fixes, NOT silent plan changes:**

1. **`uv sync --all-packages`** (vs bare `uv sync`): the plan said "uv sync resolves"; bare `uv sync` resolves the graph but does not install pylibs as editable. The `--all-packages` flag + a `hatchling` build-system on each pylib makes the import smokes pass. This is *how* the plan's stated outcome is achieved, not a change to *what* is built. TOOLCHAIN.md + acceptance item updated. **Acceptable, recorded.**
2. **`check:metrics-parity` script form**: root `package.json` script references `./tools/check-metrics-parity.sh` directly (not `turbo run …`) to avoid recursive turbo invocation; the turbo root task `//#check:metrics-parity` is still wired exactly as the plan specified. Plan outcome ("check:metrics-parity turbo root task exits 0") holds. **Acceptable, recorded.**
3. **buf not installed at Stage 3**: an environment limitation, not a code defect. Files conformed to buf v2 spec; Tanvi ran the deferred buf checks at Stage 5 (and one — `buf generate` — surfaced the real betterproto defect, which is exactly the bounce working as designed). **Acceptable.**

**No deviation silently changed the plan.** Each is an impl-detail fix inside Vikram's authority, documented in the build/fix reports.

---

## 8 Stage-2 binding inputs — delivery audit (8/8 delivered)

| # | Binding input | Delivered? | Evidence (verified on disk) |
|---|---|:--:|---|
| 1 | Python turbo root tasks w/ file-hash inputs | YES | `turbo.json` has `//#docker:build:{ingestion,analytics,intelligence}` with `inputs` globs over `apps/<svc>/**` + `pylibs/**` and `.venv`/`uv.lock`/`*.dist-info` excludes |
| 2 | buf.gen.yaml out-paths → proto-ts / proto_py | YES | `out: ../packages/proto-ts/gen` + `out: ../pylibs/proto_py/proto_py/_gen`; both consumers import named packages |
| 3 | Generated stubs gitignored | YES | root `.gitignore` excludes both gen dirs + per-package `.gitignore` (double-guarded, Shreya S-4); 0 stubs staged (verified) |
| 4 | Dual-workspace excludes | YES | `pnpm-workspace.yaml` enumerated (no `apps/**`, Python dirs absent); turbo/tsconfig excludes for `.venv`/Python dirs |
| 5 | 5 pins | YES | all 5 verified above |
| 6 | Metric-parity CI stub | YES | `tools/check-metrics-parity.sh` (set -euo pipefail, exit 0) + turbo root task; I re-ran it → exit 0 |
| 7 | DECISIONS.md | YES | 5 ADRs (turbo Python tasks, codegen homes, gitignore decision, lifecycle Phase-2, health.proto placeholder) |
| 8 | Tightened acceptance contract | YES | metrics-parity + `import brain_metrics`/`import proto_py` + both-side stub smokes are in §10 and were executed at Stage 5 |

---

## 5 persona concerns (monorepo-toolchain-realist) — resolution audit (5/5 addressed)

| # | Concern | Addressed by |
|---|---|---|
| 1 (HIGH) | Turbo `--affected` blind to Python members | Binding input 1 — explicit `docker:build:*` root tasks with file-hash inputs; graph-vs-file-hash asymmetry documented in DECISIONS.md/TOOLCHAIN.md |
| 2 (HIGH) | Buf codegen landing zone + commit-vs-gitignore | Binding inputs 2+3 — named stub packages, real `out:` paths, stubs gitignored+regen-in-CI; round-trip proven by `buf generate` (I re-ran → exit 0, both trees) |
| 3 (MED) | Dual-workspace coexistence | Binding input 4 — enumerated pnpm members, turbo/tsconfig/gitignore excludes; `pnpm install` discovers 12 projects with no Python-dir error |
| 4 (MED) | 5 pins or one-machine lie | Binding input 5 — all 5 present and verified |
| 5 (LOW) | Metric-parity CI has no home | Binding input 6 — stub + turbo task, exits 0 |

All five were converted to binding Stage-2 constraints, built, and verified at Stage 5. The persona's highest-value finding (Concern 1) is load-bearing in the delivered `turbo.json` — exactly the cheap-now/brutal-later trap a high-stakes persona is for.

---

## Day-one non-negotiables (Appendix C) — homes present + Brain-only naming

Verified `docs/conventions/` holds all 8 home docs (money, multi-tenancy, decision-log, events, region-adapter, paradigm, observability, data-model). Seam homes: 4-layer workspace_id (api-gateway + each service), money minor-units, Decision Log, RegionAdapter (`pylibs/brain_regional`), metric-registry pair (`packages/lib-metrics` ↔ `pylibs/brain_metrics`), OLTP/OLAP (`pylibs/brain_clickhouse`), Morning Brief (`apps/mobile`). Brain-only naming holds — Shreya confirmed no vendor-as-positioning; vendor names appear only as integration-target descriptions (allowed). I cross-checked the convention file list myself.

---

## Code-quality spot-checks

| File | Concern (or "clean") |
|------|---------------------|
| `protos/buf.gen.yaml` | Clean — v2, real `out:` paths to named stub packages, betterproto pinned to a real released version (v1.2.5). Comment explains WHY betterproto (idiomatic dataclasses), not what. |
| `turbo.json` | Clean — graph-aware TS tasks + file-hash Python root tasks; global `inputs` correctly exclude `.venv/**`/`uv.lock`/`*.dist-info`. This is the load-bearing config; it is precise, not bloated. |
| `tools/check-metrics-parity.sh` | Clean — `set -euo pipefail`, no interpolation, no external input, honest `# TODO: implement` + `exit 0`. Correct stub form. |
| `pnpm-workspace.yaml` | Clean — enumerated members with a comment explaining WHY Python dirs are absent (would cause missing-package.json). Comment is a real WHY. |
| `protos/brain/health/v1/health.proto` | Clean — service-less single-message placeholder, header-commented as scaffold-only, correct `brain.health.v1` package. No executable surface. |

---

## Over-engineering audit (MANDATORY)

| Check | Finding |
|------|---------|
| Files staged not in architect's plan? | NO — 105 staged files all map to §17 Groups A–G or the gitignored gen-dir guards. |
| Observability/metrics/tests beyond plan? | NO — only the plan-mandated metric-parity stub; zero dashboards/alarms; zero unit tests (correct — no logic). |
| Deps beyond plan? | NO — root devDep is only `turbo`; app manifests have no runtime deps. The one added dep (`@bufbuild/protobuf` in proto-ts) is required runtime for the generated TS stubs (Tanvi's MEDIUM fix) — implementation of the proto-first non-negotiable, not speculative. |
| New abstractions for "future use" (Single-Primitive)? | NO — `proto-ts`/`proto_py` are the proto-first non-negotiable's implementation; everything else is `.gitkeep` homes mandated by §9.1/Appendix C. Verified: zero non-`.gitkeep` files inside any service DDD folder (no build-ahead). |
| Plan length proportionate? | YES — plan depth is file-level precision (high-stakes + scope-creep-prone band), not volume; one build track. |
| 30+ line WHAT-comments? | NO — comments are short WHYs. |

**Over-engineering audit: CLEAN. No bounce trigger.**

---

## Hard-rule deviation check (Stage 6 step 9)

Scanned all artifacts for: dependency violation, Single-Primitive violation, compliance gap, paradigm escalation beyond plan, gate-skip without codified exception. **NONE present.** No dependency (first product-code req, no blockers); Single-Primitive held; no compliance surface (scaffold, no PII/channel/data); paradigm stayed `n/a`; the buf-skip at Stage 3 was an environment limitation that Stage 5 correctly executed (not an uncodified gate-skip). **No hard-rule deviation → auto-approve under Founder delegation is permissible.**

---

## Cost audit

| Field | Value |
|-------|-------|
| **Planned tokens/day** | 0 (no compute path) |
| **Simulated daily-tick tokens** | 0 (no runtime to tick) |
| **Variance** | 0% |
| **Within ±20% tolerance?** | YES |

---

## Risks remaining (non-blocking follow-ups — tech debt, NOT bounce-worthy for a scaffold)

- **[LOW, Shreya S-2] Pin buf plugin digests at CI**, not just tags. `betterproto:v1.2.5` / `bufbuild/es:v2.4.0` are tag-pinned today; a future plugin bump is a supply-chain entry point. Action lands with Jatin's CI wiring (already noted in ADR-003). Not blocking — no CI exists yet.
- **[INFO, Shreya S-5] Node 22-vs-24 env drift.** Build/test ran on Node v22 (engine warning only; `pnpm install` PASS). CI/dev should align to `.node-version` 24. Cosmetic until a Node-24-only API is used.
- **[housekeeping] `protos/brain/health/v1/health.proto` is a scaffold-only placeholder** to be deleted/replaced by the first real service contract (recorded in DECISIONS.md). The next proto requirement should remove it.

None of these block a scaffold. They are correctly classified as forward tech debt.

---

## Production-readiness assessment

> Would Jatin's pre-deploy gates pass right now?

There is **nothing to deploy** — this is structure + toolchain, no runtime, no infra (deferred to Jatin by design, non-goal). The relevant "readiness" is *does the toolchain cohere on a clean checkout*, and it does: all 14 acceptance checks pass (independently re-verified). The layout does not preclude per-service pipelines (each service is its own workspace member / `docker:build:*` task), so Jatin's future per-service CI→ECR→ArgoCD wiring is mechanical. **Ready to be the foundation the next requirement builds on.**

---

## Recommendation to Founder

**APPROVE**

### Founder briefing (one paragraph)

The Brain monorepo scaffold is correct and complete. It is the smallest *verifiable* foundation: the canonical §9.1 directory tree, DDD layering in all 7 backend services (no `controllers/` anywhere), and a genuinely-coherent four-tool polyglot root (pnpm+Turborepo / uv / buf at Node 24 / Python 3.13) where all 14 acceptance checks pass — I re-ran the critical ones (buf generate, structural, staging, pins) myself and replicated the PASS. The one adversarial persona's highest-value finding (Turborepo is blind to your Python services) is resolved in the shipped `turbo.json`, so per-service deploy works for the Python half from day one. QA caught one real defect (a non-existent betterproto plugin version) and bounced it; the fix is genuine and nothing regressed. Every day-one non-negotiable has a documented home, so they're enforced — not retrofitted. 105 product files are **staged, not committed** — per your standing rule, you commit. Two LOW/INFO items (pin buf plugin digests at CI; align dev to Node 24) are tracked tech debt that belong to Jatin's later CI work, not blockers. **Per your standing delegation I sign the approval-to-proceed on your behalf; per your no-commit carve-out, the pipeline stops here for you to review the diff and commit.**

---

## Decision

**PASS → Founder gate (Stage 7).** State → `awaiting-founder`, stage 7, owner `founder`. The mechanical commit command is in `pending-founder-commit.md`. I do NOT commit or deploy.

---

## Decision log entry (mirrored)

```json
{
  "ts": "2026-05-24T00:05:00Z",
  "actor": "cto-advisor",
  "type": "final-review",
  "req_id": "chore-scaffold-monorepo",
  "stage": 6,
  "verdict": "PASS",
  "recommendation": "APPROVE",
  "plan_binding_ok": true,
  "inputs_delivered": "8/8",
  "persona_concerns_addressed": "5/5",
  "independent_gates_reverified": ["buf-generate", "structural-assertions", "staging-discipline", "5-pins", "betterproto-pin", "proto-ts-dep"],
  "hard_rule_deviation": "none",
  "over_engineering_audit": "clean",
  "followups": ["pin-buf-plugin-digests-at-ci", "align-dev-to-node-24", "replace-health.proto-placeholder-on-first-real-contract"],
  "commits": "none — staged only; Founder commits per standing no-commit rule",
  "next": "founder"
}
```
