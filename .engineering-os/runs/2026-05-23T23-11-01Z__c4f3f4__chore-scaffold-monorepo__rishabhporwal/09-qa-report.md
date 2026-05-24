# 09-qa-report.md — Stage 5 QA Report

| Field | Value |
|-------|-------|
| **req_id** | `chore-scaffold-monorepo` |
| **Reviewer** | Tanvi (qa-agent) |
| **Stage** | 5 |
| **Mode** | PARALLEL REVIEW (Tanvi ∥ Shreya) |
| **Lane** | high-stakes |
| **Timestamp** | 2026-05-23T23:45:03Z |
| **Verdict** | **BOUNCE** |
| **Bounce target** | backend-developer (Vikram) |

---

## Stage 4 Skip Acknowledgment

Stage 4 (security) ran in PARALLEL (Shreya completed it — `08-security-review.md` present, timestamp 2026-05-23T23:42:03Z, verdict PASS). Not technically skipped. Per protocol, I run the mandatory minimal secrets grep independently.

**Staged diff secrets scan:**
```
git -C /Users/rishabhporwal/Desktop/Brain diff --cached | grep -iE 'password|secret|api[_-]?key|bearer|aws_|sk-[a-zA-Z0-9]+|ghp_'
(no output)
Exit: 0
```

**Direct scaffold file scan (untracked files on disk):**
```
grep -rE 'password|secret|api[_-]?key|bearer|aws_[A-Z]|sk-[a-zA-Z0-9]{20,}|ghp_' apps/ packages/ pylibs/ protos/ tools/
(no output)
Exit: 0
```

Result: CLEAN. No credentials or secrets in scaffold files.

---

## Environment Baseline

```
date -u  → Sat May 23 23:41:18 UTC 2026
node -v  → v22.22.2  (env has v22; plan pins v24 — engine warning, not an error)
pnpm -v  → 11.0.9    MATCHES pin
python3  → 3.13.7    MATCHES pin
uv       → 0.8.22    MATCHES pin
buf      → 1.69.0    INSTALLED (Vikram reported MISSING — buf IS available at Stage 5)
```

---

## Acceptance Contract — Independent Verification

### AC-01: pnpm install

```
Command: pnpm install
Exit: 0

Output:
[WARN] Unsupported engine: wanted: {"node":">=24 <25"} (current: {"node":"v22.22.2","pnpm":"11.0.9"})
Scope: all 12 workspace projects
Already up to date
Done in 134ms using pnpm v11.0.9
```

**Result: PASS.** 12 workspace projects (11 TS members + root). Python dirs absent from pnpm-workspace.yaml — no missing-package.json error. Engine warning is informational (env has v22, pin is v24 — not an error, just a warning).

---

### AC-02: pnpm turbo run build --dry-run

```
Command: pnpm turbo run build --dry-run
Exit: 0

Packages in Scope: @brain/api-gateway, @brain/config, @brain/core-service,
@brain/eslint-config, @brain/lib-metrics, @brain/lifecycle-service, @brain/mobile,
@brain/notifications-service, @brain/proto-ts, @brain/ui, @brain/web
Running build in 11 packages

All 11 tasks resolve with correct Resolved Task Definition (inputs exclude .venv/**, uv.lock, *.dist-info)
```

**Result: PASS.** TS task graph resolves for all 11 workspace members. globalDependencies, inputs excludes, and output globs all correct.

---

### AC-03: pnpm turbo run docker:build:ingestion --dry-run (Python root task)

```
Command: pnpm turbo run docker:build:ingestion --dry-run
Exit: 0

//#docker:build:ingestion
  Command = <NONEXISTENT>
  Inputs Files Considered = 19
  Resolved Task Definition = {"inputs":["!**/*.dist-info","!**/__pycache__/**","!**/uv.lock",
    "!.venv/**","apps/ingestion-service/**","pylibs/**"],"cache":true,...}
```

**Result: PASS (with note).** Root task resolves with correct file-hash `inputs` globs. `Command = <NONEXISTENT>` is intentional — the plan and DECISIONS.md explicitly state "These tasks shell out to uv/Docker in CI (Jatin's job)." This is a CI-stub, not a defect. Same confirmed for `docker:build:analytics` and `docker:build:intelligence`. The graph-aware/file-hash-aware asymmetry for Python services is correctly documented in DECISIONS.md ADR-001 and TOOLCHAIN.md.

---

### AC-04: uv sync --all-packages

```
Command: uv sync --all-packages
Exit: 0

Output:
Resolved 9 packages in 4ms
Audited 5 packages in 1ms
```

**Result: PASS.** All 5 pylib packages resolve cleanly (already installed from Vikram's run — `Audited` not `Building` because .venv already exists).

---

### AC-05: buf lint protos

```
Command: buf lint protos
Exit: 0

Output:
WARN: Category DEFAULT referenced in your buf.yaml is deprecated. It has been replaced
by category STANDARD. [...] As with all buf changes, this change is backwards-compatible:
DEFAULT will continue to work.
```

**Result: PASS.** Exit 0, zero lint violations. The WARN about `DEFAULT` being deprecated is a backwards-compatible advisory — `DEFAULT` continues to work. The buf.yaml uses `version: v2` correctly.

---

### AC-06: buf build protos -o /dev/null

```
Command: buf build protos -o /dev/null
Exit: 0
(no output)
```

**Result: PASS.** Valid proto image produced. No errors.

---

### AC-07: buf generate protos — FAIL (BLOCKING)

```
Command: buf generate protos (from repo root)
Exit: 1

Output:
Failure: read buf.gen.yaml: file does not exist

Command: cd protos && buf generate
Exit: 1

Output:
Failure: not_found: plugin version "v0.0.3" was not found for existing plugin
"buf.build/community/danielgtaylor-betterproto" with latest version "v1.2.5"
```

**Result: FAIL — BLOCKING DEFECT.**

The `protos/buf.gen.yaml` references `buf.build/community/danielgtaylor-betterproto:v0.0.3` which does not exist on the Buf Schema Registry. The plugin's current latest version is `v1.2.5`. This makes `buf generate` fail unconditionally for the Python side.

**Root cause:** Wrong plugin version string in `protos/buf.gen.yaml` line:
```
  - remote: buf.build/community/danielgtaylor-betterproto:v0.0.3
```

**Fix required:** Change `v0.0.3` to `v1.2.5` (or pin to another valid released version).

**Verified fix works:** Running buf generate with `v1.2.5` produces both TS stubs (`brain/health/v1/health_pb.ts`) and Python stubs (`brain/health/v1.py`) correctly:
```
buf generate protos --template /tmp/test-buf-gen-full.yaml (with v1.2.5)
Exit: 0
Generated: /tmp/proto-py-test/brain/health/v1.py
Generated: /tmp/proto-ts-test2/brain/health/v1/health_pb.ts
```

**Impact:** The entire proto→Python codegen path is broken. The scaffold acceptance contract item #7 ("buf generate produces TS stubs AND Python stubs") fails. The Python import of `proto_py._gen.*` will always fail until this is fixed. This directly contradicts the plan's Concern-2 resolution ("dedicated workspace-member stub packages; consumers import a named package"). The Python stub package is named correctly but its codegen path is broken.

Note: The TS plugin (`buf.build/bufbuild/es:v2.4.0`) works correctly and produces valid stubs.

---

### AC-08: TS generated-stub import smoke — SKIPPED

```
Context: buf generate fails (AC-07 FAIL), so no stubs exist in packages/proto-ts/gen/.
Additionally, @bufbuild/protobuf is not installed in node_modules (proto-ts/package.json
lists no runtime dependencies).
```

**Result: SKIPPED** (blocked by AC-07 failure; also @bufbuild/protobuf dep missing from proto-ts package.json means the import would fail even with stubs present). Secondary concern — proto-ts package.json should declare `@bufbuild/protobuf` as a dependency for the import smoke to work.

---

### AC-09: Python import smoke

```
Command: uv run python -c "import proto_py; print('proto_py OK')"
Output: proto_py OK

Command: uv run python -c "import brain_metrics; print('brain_metrics OK')"
Output: brain_metrics OK

Also verified:
uv run python -c "import brain_clickhouse; print('brain_clickhouse OK')" → brain_clickhouse OK
uv run python -c "import brain_regional; print('brain_regional OK')" → brain_regional OK
uv run python -c "import brain_cost_router; print('brain_cost_router OK')" → brain_cost_router OK
```

**Result: PASS.** All 5 Python packages import correctly as named packages. Note: `import proto_py` tests the package scaffold only (the `__init__.py`); it does NOT test generated stub content (which requires `buf generate` to succeed first — blocked by AC-07).

---

### AC-10: pnpm turbo run check:metrics-parity

```
Command: pnpm turbo run check:metrics-parity
Exit: 0

Output:
//:check:metrics-parity: cache miss, executing d0639dc5eb1a6197
//:check:metrics-parity: $ ./tools/check-metrics-parity.sh
Tasks: 1 successful, 1 total
Cached: 0 cached, 1 total
Time: 190ms
```

**Result: PASS.** Root task executes, `tools/check-metrics-parity.sh` runs, exits 0. Metric-parity CI wiring point established.

---

### AC-11: Structural Assertions

#### apps/ directories (9 expected)
```
ls apps/
analytics-service  api-gateway  core-service  ingestion-service  intelligence-service
lifecycle-service  mobile  notifications-service  web
```
**Result: PASS. Exactly 9 dirs.**

#### DDD layers per backend service (5 required in each of 7 services)
```
api-gateway/src/:          application bootstrap domain infrastructure interfaces  — PASS
core-service/src/:         application bootstrap domain infrastructure interfaces  — PASS
ingestion-service/src/:    application bootstrap domain infrastructure interfaces  — PASS
analytics-service/src/:    application bootstrap domain infrastructure interfaces  — PASS
intelligence-service/src/: application bootstrap domain infrastructure interfaces  — PASS
lifecycle-service/src/:    application bootstrap domain infrastructure interfaces  — PASS
notifications-service/src/:application bootstrap domain infrastructure interfaces  — PASS
lifecycle-service/python/: application bootstrap domain infrastructure interfaces  — PASS (Phase-2 homes)
```
**Result: PASS. All 7 backend services have all 5 DDD layers.**

#### No controllers/services/models technical-layer dirs
```
find apps -type d -name "controllers" → (empty)
find apps -type d -name "services"    → (empty)
find apps -type d -name "models"      → (empty)
```
**Result: PASS. Zero forbidden technical-layer directories.**

#### 5 toolchain pins
```
.node-version          → "24"           PASS
.python-version        → "3.13"         PASS
package.json           → "pnpm@11.0.9"  PASS (packageManager field)
                       → ">=24 <25"     PASS (engines.node)
pyproject.toml         → ">=3.13,<3.14" PASS (requires-python)
pyproject.toml         → ">=0.8.22"     PASS (tool.uv.required-version)
protos/buf.yaml        → version: v2    PASS
```
**Result: PASS. All 5 pins present and correct.**

#### DECISIONS.md + TOOLCHAIN.md
```
DECISIONS.md:  8190 bytes, 5 ADRs  — PASS
TOOLCHAIN.md:  4976 bytes          — PASS
```
**Result: PASS.**

#### Metric registry pair
```
packages/lib-metrics/: package.json, .gitkeep  — PASS (TS half)
pylibs/brain_metrics/: pyproject.toml, brain_metrics/__init__.py  — PASS (Python half)
```
**Result: PASS.**

---

## Traceability Check

| Artifact | Present | Consistent |
|----------|---------|------------|
| `01-requirement.md` | YES | YES |
| `02-cto-advisor-review.md` | YES | YES |
| `02b-cto-synthesis.md` | YES | YES |
| `03-persona-monorepo-toolchain-realist.md` | YES | YES |
| `06-architecture-plan.md` | YES | YES |
| `07-build-report.md` | YES | YES |
| `08-security-review.md` | YES | YES |
| `feat-chore-scaffold-monorepo.md` (feature journal) | YES | YES — all stages S1-S3 + Shreya S4 logged |
| `decision-log/2026/05/2026-05-23.jsonl` | YES | YES — 6 entries, Stage 1→4 |
| `live.log` | YES | YES — 12 lines, Stage 1→4 (Shreya) |
| `state/active.json` | YES | YES — status=parallel-review, stage=4 |

**Result: PASS.** All required run artifacts present and internally consistent. Pipeline trace is continuous from intake (2026-05-23T23:11:01Z) through Stage 4. No gaps.

Note: `04-qa-report.md` and `05-security-review.md` naming is not used in this pipeline; artifacts are `07-build-report.md`, `08-security-review.md`, and `09-qa-report.md` (this file). Consistent with pipeline convention.

**Trace ID / correlation ID note:** This scaffold has no runtime. There are no request_id / trace_id flows through gRPC/Kafka/LLM to verify end-to-end. The plan explicitly states "None. OTel→X-Ray convention documented; not wired." The VETO condition ("trace IDs not appearing end-to-end in a real-network test run") does not apply to a scaffold with no runtime — this is confirmed correct per plan §9 and §10.

---

## Staging Gap Note

**Finding (non-blocking, process note):** The build report stated "96 files staged." However `git diff --cached --stat` returns empty — scaffold files appear as untracked (`??`) not staged (`A`). The files exist on disk and are ready for staging; they were never `git add`ed.

**Severity:** LOW (process note, not a code defect). Files are correct on disk. Per Founder rules ("No commits without Founder approval — staged only, awaiting review"), the Founder stages and commits. The claim of "96 staged" in the build report is inaccurate — more precisely: "96 files created on disk, ready to be staged." This should be corrected in the build report for accuracy, but it does not block the scaffold's correctness.

---

## High-Stakes DoD Items

| Item | Applicable | Status |
|------|-----------|--------|
| Unit tests (no logic to test) | N/A | N/A — scaffold only |
| Integration tests (toolchain coherence IS the test) | YES | PARTIAL — buf generate FAIL |
| Contract tests (buf lint + build + generate) | YES | FAIL — AC-07 |
| E2E tests | N/A | N/A — no runtime |
| Load tests | N/A | N/A — Phase 3+ |
| Real-network smoke | N/A | N/A — no runtime/network |
| Metric registry TS↔Python parity | PASS | check:metrics-parity exits 0 |
| Trace IDs end-to-end | N/A | N/A — no runtime |
| Operational readiness (health, port, env vars) | N/A | N/A — no service |
| Mutation tests | N/A | N/A — no logic |
| Coverage ≥70% on change set | N/A | N/A — no code |

---

## Summary of Findings

| Severity | Count | Items |
|----------|-------|-------|
| BLOCKING | 1 | buf.gen.yaml betterproto plugin version `v0.0.3` nonexistent; `buf generate` fails |
| MEDIUM | 1 | `packages/proto-ts/package.json` missing `@bufbuild/protobuf` dependency (TS import smoke cannot run) |
| LOW | 1 | Build report inaccurately claims "96 files staged"; files are untracked (on disk, not in git index) |

---

## Verdict: BOUNCE

The scaffold is 95% correct — structure, TS toolchain, Python toolchain, structural assertions, metric-parity CI, and documentation all pass. A single wrong version string in `protos/buf.gen.yaml` (`danielgtaylor-betterproto:v0.0.3` → must be `v1.2.5`) causes the entire Python codegen path to fail. Since the plan's Concern-2 resolution explicitly requires both TS AND Python stubs to be importable from the generated-stub packages, and since buf generate is a gate item in the acceptance contract, this is a BOUNCE.

**Fix is trivial:** one-line change in `protos/buf.gen.yaml` + add `@bufbuild/protobuf` to `packages/proto-ts/package.json`. Vikram re-runs buf generate to confirm both sides produce stubs, then re-stages.
