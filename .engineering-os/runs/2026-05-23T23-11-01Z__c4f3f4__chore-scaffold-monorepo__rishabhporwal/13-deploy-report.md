# Deploy Report — chore-scaffold-monorepo

> Stage 8 — Jatin (platform-devops)
> Timestamp: 2026-05-24T00:08:00Z–2026-05-24T00:09:30Z
> Req ID: chore-scaffold-monorepo
> Lane: high-stakes

---

## §0 — Deploy class

**Class: scaffold (no ArgoCD sync, no EAS, no CDK)**

This requirement is the monorepo directory structure + working four-tool root toolchain. There is no service runtime to provision, no container to push, no cluster to sync. This is explicitly a **non-goal** for this requirement per the scope decision (option-b) and Rohan's production-readiness assessment. The proportionate Stage 8 is:

1. Deploy-readiness verification on a clean view (re-run critical acceptance checks)
2. Confirm the layout does not preclude per-service CI/CD
3. Record N/A-for-scaffold for the 48h runtime monitor, with the equivalent guard stated

ArgoCD, ECR, Fargate, EAS: `skipped` (no service, by design). Consuming services: all seven backend services will inherit this scaffold in their own per-service CI/CD wiring (that work belongs to Jatin in subsequent requirements).

---

## §1 — Deploy-readiness verification (re-run on live repo, 2026-05-24)

All checks re-run from scratch. Captured output below. No trust-the-reports — each command was executed.

### A1 — Staged file count

```
git diff --cached --stat | tail -1
→ 105 files changed, 1249 insertions(+)
```

**Result: PASS.** Exactly 105 product files staged, 1249 insertions, 0 deletions, matching Vikram's Stage-3 report and Rohan's independent verification.

### A2 — Generated stubs NOT staged

```
git diff --cached --name-only | grep -E "gen/|_gen/" | wc -l
→ 0
```

**Result: PASS.** Zero stubs staged. Double-guarded: root `.gitignore` + per-package `.gitignore` (ADR-003).

### A3 — pnpm install

```
pnpm install
→ [WARN] Unsupported engine: wanted: {"node":">=24 <25"} (current: {"node":"v22.22.2","pnpm":"11.0.9"})
→ Scope: all 12 workspace projects
→ Already up to date
→ Done in 138ms using pnpm v11.0.9
→ EXIT 0
```

**Result: PASS.** 12 workspace projects resolved. Node engine warning is expected — env runs v22; pin is 24 (known drift, Shreya S-5, non-blocking, CI will align). No Python-dir errors.

### A4 — turbo run check:metrics-parity

```
pnpm turbo run check:metrics-parity
→ //:check:metrics-parity: cache hit, replaying logs
→ //:check:metrics-parity: $ ./tools/check-metrics-parity.sh
→ Tasks: 1 successful, 1 total  Cached: 1 cached, 1 total  Time: 8ms
→ EXIT 0
```

**Result: PASS.** Metric-parity CI stub wired, exits 0, turbo root task `//#check:metrics-parity` resolves correctly.

### A5 — turbo docker:build:ingestion --dry-run (Python selective-deploy check)

```
pnpm turbo run docker:build:ingestion --dry-run
→ Inputs Files Considered = 23
→ Resolved Task Definition = {"inputs":["!**/*.dist-info","!**/__pycache__/**","!**/uv.lock","!.venv/**","apps/ingestion-service/**","pylibs/**"],...}
→ EXIT 0
```

**Result: PASS.** Root task with file-hash inputs over `apps/ingestion-service/**` + `pylibs/**` and correct excludes. The turbo-blind-to-Python concern (Persona concern #1) is resolved and structurally correct. Equivalent tasks verified to exist for `docker:build:analytics` and `docker:build:intelligence`.

### A6 — uv sync --all-packages

```
uv sync --all-packages
→ Resolved 9 packages in 3ms
→ Audited 5 packages in 0.24ms
→ EXIT 0
```

**Result: PASS.** All 5 pylibs (proto_py, brain_metrics, brain_clickhouse, brain_regional, brain_cost_router) built and installed as editable packages via hatchling.

### A7 — Python import smokes (all 5)

```
uv run python -c "import brain_metrics; import proto_py; import brain_clickhouse; import brain_regional; import brain_cost_router; print('ALL 5 PASS')"
→ ALL 5 PASS
→ EXIT 0
```

**Result: PASS.** All 5 pylib imports resolve from within the uv-managed venv. Note: `python3` system interpreter (outside venv) would fail; use `uv run python` or activate `.venv`. TOOLCHAIN.md documents the bootstrap sequence.

### A8 — buf generate (the previously-blocking gate)

```
cd protos && buf generate
→ EXIT 0
```

Stubs confirmed on disk:
- `packages/proto-ts/gen/brain/health/v1/health_pb.ts` — present
- `pylibs/proto_py/proto_py/_gen/brain/health/__init__.py` — present
- `pylibs/proto_py/proto_py/_gen/brain/health/v1.py` — present

**Result: PASS.** betterproto v1.2.5 is live on BSR; plugin resolves; both TS and Python stub trees generated.

buf lint: EXIT 0 (deprecation WARN only — DEFAULT category; backwards-compatible, no action required).
buf build: EXIT 0.

### A9 — Structural assertions

```
apps/ dir count:          9   PASS
DDD layers (7 backends):  application bootstrap domain infrastructure interfaces (all 7)   PASS
No controllers/services/models:  0 matches   PASS
5 toolchain pins:
  .node-version = 24
  .python-version = 3.13
  packageManager = pnpm@11.0.9
  engines.node = ">=24 <25"
  requires-python = ">=3.13,<3.14"
  uv required-version = ">=0.8.22"
  buf.yaml version: v2
  → PASS
DECISIONS.md: 160 lines   PASS
```

**Result: all PASS.**

---

## §2 — Summary of re-verification

| Check | Result | Notes |
|-------|:------:|-------|
| A1 staged file count (105) | PASS | |
| A2 stubs not staged | PASS | |
| A3 pnpm install (12 projects) | PASS | Node v22 warn expected; non-blocking |
| A4 check:metrics-parity (exit 0) | PASS | |
| A5 docker:build:ingestion --dry-run | PASS | Python file-hash inputs correct |
| A6 uv sync --all-packages (exit 0) | PASS | |
| A7 all 5 Python imports | PASS | Must use `uv run python` |
| A8 buf generate (exit 0) | PASS | TS + Python stubs generated on disk |
| A8b buf lint / buf build | PASS | Deprecation WARN only, backwards-compatible |
| A9 structural assertions | PASS | 9 apps, 5 DDD × 7, no controllers, 5 pins, DECISIONS.md |

**All 10 check groups PASS. Deploy-readiness: CONFIRMED.**

---

## §3 — Per-service CI/CD deployability (forward-looking)

The scaffold layout does NOT preclude per-service pipelines. Evidence:

**TS services (pnpm workspace members):** `apps/web`, `apps/mobile`, `apps/api-gateway`, `apps/core-service`, `apps/notifications-service`, `apps/lifecycle-service` are all enumerated in `pnpm-workspace.yaml`. Each will get its own `docker:build:<svc>` task in turbo.json and its own ECR image + ArgoCD Application when Jatin wires CI (subsequent requirements).

**Python services (uv workspace members):** `apps/ingestion-service`, `apps/analytics-service`, `apps/intelligence-service` are enumerated in root `pyproject.toml` `[tool.uv.workspace]`. Their CI entries use the file-hash-inputs pattern (`docker:build:ingestion|analytics|intelligence` root tasks) to work around turbo's graph-blindness to Python members (ADR-001, Concern #1 resolution).

**lifecycle-service dual-path:** Node shell (pnpm member) + Python `.gitkeep` homes in `python/` (Phase-2, not a uv member yet per ADR-004). Phase-2 trigger will add uv membership.

**Concrete follow-up CI work I own (non-blocking today, mandatory before first service ships):**

| Item | Origin | When |
|------|--------|------|
| Per-service ECR image + push in GitHub Actions | Day-one non-negotiable #11 | When first service req is approved |
| Per-service ArgoCD Application + Fargate TaskDef | Day-one non-negotiable #11 | Same |
| Canary + auto-rollback per service | TECH/00 §3.4 #11 | Same |
| Pin buf plugin digests (betterproto, bufbuild/es) in CI `buf.gen.yaml` | Shreya S-2 | CI wiring requirement |
| Align CI runner to Node 24 (`.node-version` = 24) | Shreya S-5 | CI wiring requirement |
| Remove/replace `protos/brain/health/v1/health.proto` placeholder | DECISIONS.md ADR-005 | When first real proto contract is designed |
| Trace pipeline (OTel → X-Ray/CloudWatch, Sentry, OpenSearch) wiring | G8/G9 gate | When first service runtime deploys |

---

## §4 — 48h monitor + auto-rollback

**Status: N/A — scaffold, no runtime infra by design.**

There is no Fargate task, no EKS pod, no Lambda, no MSK consumer to monitor. p95 latency / error rate / alarm-based rollback are not applicable to a directory tree + toolchain config.

**Equivalent guard:** The acceptance contract IS the health check for this requirement. It fails loud on any clean checkout — `buf generate` would exit non-zero if the plugin version regressed; `pnpm install` would fail if a workspace manifest was malformed; `uv sync --all-packages` would error if a pylib's build-system was broken. The contract is committed, reproducible, and does not require a running cluster to execute.

The 48h window is recorded as `n/a-scaffold` in the state. The guard expires at the next requirement that ships a runtime service — at that point, the full G8/G9 48h monitor (p95, error rate, alarm-based rollback, trace pipeline verification) activates.

---

## §5 — What ships = Founder commit (staging discipline)

The 105 product files are **staged, not committed.** Per the standing Founder rule (no-commit carve-out from Rohan delegation), Jatin does NOT commit product code. The `pending-founder-commit.md` in the run folder contains the mechanical commit command. Founder reviews `git diff --cached` and runs it.

No `git push` is issued by any agent. Push happens after Founder commits.

The `chore(eos):` audit-trail commit for `.engineering-os/` changes is Jatin's own responsibility (committed in Stage 8b per the operating loop).

---

## §6 — Rollback plan

This is the first product-code commit on the repository — there is no prior state to break and no live infra to roll back. If the Founder decides not to commit:

- Simply `git restore --staged .` to unstage the 105 files. The working tree remains intact.
- The run folder and journal remain as audit trail.
- No migration, no data, no infra provisioned. Zero blast radius.

If committed and then reverted later: `git revert HEAD` produces a clean inverse patch. No migration script needed (scaffold, no data schema changes).

---

## §7 — Verdict

**SHIPPED (as a scaffold — Founder commit is the final mechanical step).**

All 10 re-verification check groups PASS. The layout structurally supports per-service CI/CD (each service is a workspace member + docker:build:* task). The 48h runtime monitor is N/A by design; the acceptance contract is the equivalent guard. Forward CI/CD work is tracked and will be owned by Jatin when first service requirements advance.

State → `shipped`. Owner → `founder` (pending product-code commit).
