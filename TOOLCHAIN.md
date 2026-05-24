# TOOLCHAIN.md — Brain Monorepo Pinned Toolchain & Bootstrap

> Read this first. Every version is pinned. "Works on my machine" is not a success
> metric — `pnpm install`, `uv sync`, `buf lint`, and `turbo run build` must all
> resolve identically on every developer machine and every CI runner.

---

## Pinned Versions

| Tool | Pin | Source of truth |
|------|-----|-----------------|
| **Node.js** | 24.x (`>=24 <25`) | `.node-version` + `package.json` `engines.node` |
| **pnpm** | 11.0.9 (exact patch) | `package.json` `packageManager` field (Corepack) |
| **Python** | 3.13 (`>=3.13,<3.14`) | `.python-version` + `pyproject.toml` `requires-python` |
| **uv** | >=0.8.22 | `pyproject.toml` `[tool.uv] required-version` |
| **Buf** | v2 (CLI + `buf.yaml version: v2`) | `protos/buf.yaml` |

**All five pins must be present.** The acceptance contract (§ below) asserts this.
If you update a version, update ALL five sources of truth simultaneously (the table
above, the file, and `TOOLCHAIN.md`).

---

## Bootstrap Sequence (clean checkout)

Run from repo root:

```bash
# 1. Activate Node 24 via your version manager (nvm, fnm, or mise).
#    .node-version is read automatically by fnm/mise.
node -v  # must print v24.x.x

# 2. Enable Corepack and install the pinned pnpm.
corepack enable
corepack install
pnpm -v  # must print 11.0.9

# 3. Install TypeScript workspace dependencies.
pnpm install

# 4. Install/sync Python workspace (creates .venv/ at root).
# --all-packages installs all workspace members as editable packages
# so `import proto_py`, `import brain_metrics`, etc. all resolve.
uv sync --all-packages

# 5. Generate protobuf stubs (required before any build that imports @brain/proto-ts
#    or proto_py; CI must run this before build steps).
buf generate protos

# 6. Verify the full toolchain coheres.
pnpm turbo run build --dry-run
pnpm turbo run check:metrics-parity
```

---

## Import Smoke Checks

After `buf generate`, verify both sides import correctly:

```bash
# TypeScript — named package import (no relative path across protos/)
pnpm --filter @brain/proto-ts exec node -e "console.log(require('./gen/brain/health/v1/health_pb.js'))"

# Python — named package import
uv run python -c "import proto_py; print('proto_py OK')"
uv run python -c "import brain_metrics; print('brain_metrics OK')"
```

---

## Graph-Aware vs File-Hash-Aware Asymmetry (read before wiring CI)

This monorepo has two affected-detection mechanisms:

**TypeScript services (pnpm members):** `turbo --affected` uses the pnpm dependency
graph. Adding `dependsOn: ["^build"]` in `turbo.json` is sufficient for selective
TS builds.

**Python services (uv members — NOT pnpm members):** `turbo --affected` is
structurally blind to uv workspace members. Python services are wired as explicit
**root tasks** in `turbo.json` with file-hash `inputs` globs:
- `//#docker:build:ingestion` → triggers when `apps/ingestion-service/**` or `pylibs/**` changes
- `//#docker:build:analytics` → triggers when `apps/analytics-service/**` or `pylibs/**` changes
- `//#docker:build:intelligence` → triggers when `apps/intelligence-service/**` or `pylibs/**` changes

In CI, run `turbo run docker:build:ingestion --affected` (not just `turbo run build`)
for selective Python service deploys. See DECISIONS.md ADR-001.

---

## Acceptance Contract (Tanvi / Stage 5 QA)

Run from repo root on a clean checkout after the bootstrap above. ALL must pass:

1. `corepack enable && corepack install` — pnpm 11.0.9 activated.
2. `pnpm install` — resolves cleanly; NO error on Python service dirs.
3. `pnpm turbo run build --dry-run=json` — graph resolves; includes `docker:build:*` root tasks.
4. `uv sync --all-packages` — Python workspace resolves; `.venv/` and `uv.lock` present; all pylib packages installed as editable.
5. `buf lint protos` — 0 violations.
6. `buf build protos -o /dev/null` — valid image, 0 errors.
7. `buf generate protos` — TS stubs in `packages/proto-ts/gen/`; Python stubs in `pylibs/proto_py/proto_py/_gen/`.
8. TS import smoke: `pnpm --filter @brain/proto-ts exec node -e "require('./gen/...')"` resolves.
9. Python import smoke: `uv run python -c "import proto_py"` + `uv run python -c "import brain_metrics"` both resolve.
10. `pnpm turbo run check:metrics-parity` — exits 0.
11. Structural: 9 `apps/` dirs; 5 DDD folders in each backend service; NO `controllers/`; all 5 pins present; `DECISIONS.md` exists.

---

## Per-Service Pipeline Readiness

Each service is an independent workspace member with its own build entry:
- TS services: `package.json` `scripts.build` → `turbo run build --filter=@brain/<svc>`
- Python services: `turbo run docker:build:<svc> --affected`

Wiring each to GitHub Actions → ECR → ArgoCD is mechanical when Jatin provisions CI/CD.
No structural change to this scaffold is needed. Create `.github/workflows/<svc>.yml`
per service, driven by the turbo tasks already defined. See DECISIONS.md ADR-001.
