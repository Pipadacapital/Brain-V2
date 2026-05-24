# DECISIONS.md — Brain Monorepo Irreversible Architectural Decisions

> ADR-style record of structural decisions that are load-bearing for everything
> stacking on top of the scaffold. Append new ADRs here; do not edit existing ones
> (they are immutable records — supersede with a new numbered entry).
>
> Each decision: context → decision → rationale → reversibility → consequence.

---

## ADR-001: Python services as turbo root tasks (graph-aware/file-hash-aware asymmetry)

**Status:** Accepted (scaffold, 2026-05-23)

**Context:** Turborepo's `--affected` flag is structurally blind to uv/Python workspace
members — it only traverses the pnpm dependency graph. The three Python services
(`ingestion-service`, `analytics-service`, `intelligence-service`) would be silently
excluded from `turbo --affected` in CI, making §9.7 selective-per-service deploy
undeliverable for the highest-churn services. This bug would pass the scaffold
acceptance contract yet break CI.

**Decision:** Python services are wired as explicit **root tasks** in `turbo.json`
(`//#docker:build:ingestion`, `//#docker:build:analytics`, `//#docker:build:intelligence`),
each carrying file-hash `inputs` globs over the service dir and its `pylibs/` deps.
These tasks shell out to `uv`/Docker in CI (Jatin's job). This keeps Python builds
inside the one affected-detection mechanism Jatin's CI will drive (`turbo run
docker:build:ingestion --affected` triggers when `apps/ingestion-service/**` or
`pylibs/**` changes).

**Rationale:** `turbo --affected` (graph-aware, TS-only) vs file-hash `inputs` globs
(Python-only) is the canonical asymmetry for polyglot monorepos; there is no better
mechanism available in the locked stack. A Makefile wrapper was rejected (lives outside
the turbo graph, defeats `--affected`). Documented here so Jatin does not re-discover
this during CI wiring.

**Reversibility:** If a future turbo version natively supports uv workspaces, the root
tasks can be removed and replaced with native turbo members. Until then, this is the
pattern. No rollback risk — the root tasks are additive.

**Consequence:** CI must run `turbo run docker:build:ingestion --affected` (not just
`turbo run build`) for the Python services. Document in `.github/workflows/` comments
when Jatin wires CI.

---

## ADR-002: Generated stub packages — out: paths

**Status:** Accepted (scaffold, 2026-05-23)

**Context:** `buf lint` passing does not mean generated stubs are importable by both
TS and Python consumers. The codegen landing zone must be decided at scaffold time so
all 7 future consumer services import from a stable named package, not from a path
that changes when the layout shifts.

**Decision:** `buf.gen.yaml` targets two dedicated workspace-member stub packages:
- TypeScript stubs → `packages/proto-ts/gen/` (pnpm member `@brain/proto-ts`)
- Python stubs → `pylibs/proto_py/proto_py/_gen/` (uv member `proto_py`)

Consumers import a **named package** (`@brain/proto-ts`, `proto_py`), never a relative
path across the `protos/` boundary.

**Rationale:** Relative path imports across `protos/` break `tsc --paths` resolution
for consumers and couple every service to a specific relative depth. Named workspace
packages are the standard pattern and make service-level imports mechanical. The
`buf.gen.yaml` plugins are pinned by version (see TOOLCHAIN.md) so codegen is
reproducible in CI.

**Reversibility:** If the plugin ecosystem changes (e.g., connect/es superseded),
update `buf.gen.yaml` + `packages/proto-ts/package.json` + `pylibs/proto_py/pyproject.toml`.
The named-package import surface remains stable for consumers; only the internals change.

**Consequence:** Every service that calls a gRPC endpoint imports stubs from
`@brain/proto-ts` (TS) or `proto_py` (Python). No direct `protos/` imports anywhere.

---

## ADR-003: Generated stubs are gitignored and regenerated in CI

**Status:** Accepted (scaffold, 2026-05-23)

**Context:** With 7 consumer packages across TS and Python, committed generated stubs
create merge-conflict noise on every proto change and risk stale/divergent checked-in
code (the stubs could drift from the source `.proto` if `buf generate` is not run after
a proto change).

**Decision:** Generated stubs are **gitignored** (`.gitignore` entries for
`packages/proto-ts/gen/` and `pylibs/proto_py/proto_py/_gen/`) and **regenerated in CI**
before any build that depends on them. `buf generate protos` must run as the first step
of any CI job that compiles TS or Python service code.

**Rationale:** Gitignore + regen-in-CI is the polyglot-monorepo standard. The only cost
(CI must run `buf generate` before build) is explicit and documented. Committing stubs
was rejected: conflict noise + stale-code risk outweigh the marginal convenience of
pre-generated stubs in the repo.

**Reversibility:** To reverse: un-ignore the gen dirs in `.gitignore`, run `buf generate`,
commit the output. This is a mechanical change with no architectural consequence; the
named-package import surface (ADR-002) is unaffected.

**Consequence:** CI (Jatin) must pin buf plugin versions in `buf.gen.yaml` so codegen
is reproducible and not a supply-chain hole. `buf generate` must precede any `pnpm turbo
run build` step that touches `@brain/proto-ts`-dependent packages.

---

## ADR-004: lifecycle-service Python side deferred to Phase 2

**Status:** Accepted (scaffold, 2026-05-23)

**Context:** `lifecycle-service` is canon §2.2 "Node + Python" (orchestration + Python
scoring/compliance engine). However, lifecycle is a Phase-2 build and is NOT a
Phase-0–1 `data` deployable. The Phase-0–1 uv workspace includes only
`ingestion-service`, `analytics-service`, `intelligence-service`.

**Decision:** `apps/lifecycle-service` carries a **Node DDD shell** (pnpm member
`@brain/lifecycle-service`, `src/` DDD `.gitkeep` folders) for the Phase-0–1
orchestration stub. Its Python side is created only as **DDD `.gitkeep` homes**
in `apps/lifecycle-service/python/` — no uv workspace member is created now.

**Rationale:** Creating a uv member now would imply lifecycle ships in the first
`uv sync` deployable set, which it does not. The `.gitkeep` Python homes preserve the
§2.2 "Node + Python" canonical shape without over-creating. Graduating lifecycle's
Python side at Phase 2 is a one-line change: add `"apps/lifecycle-service"` to
`pyproject.toml [tool.uv.workspace] members`.

**Reversibility:** Add `"apps/lifecycle-service"` to `pyproject.toml [tool.uv.workspace]
members` and create the Python `pyproject.toml`. Mechanical, no architectural consequence.

**Consequence:** Phase-0–1 `uv sync` deploys exactly three Python services. lifecycle
Python graduates at Phase 2 under its own Architect plan.

---

## ADR-005: protos/brain/health/v1/health.proto is a scaffold-only placeholder

**Status:** Accepted (scaffold, 2026-05-23)

**Context:** `buf lint`, `buf build`, and `buf generate` need a real `.proto` file to
operate on so the scaffold acceptance contract can prove the codegen round-trip works
end-to-end. Without a file, the buf commands are vacuously true and provide no signal.

**Decision:** A single trivial proto file (`protos/brain/health/v1/health.proto`) is
added with one message (`Health { string status = 1; }`) and **no gRPC service**. It
is marked scaffold-only in both a header comment and this ADR. It models the correct
`brain.<context>.v1` package naming convention.

**Rationale:** Minimum viable verifiable codegen target. A proto with no service
introduces no executable surface (it is a data-shape definition). It must be replaced
or deleted when the first real service contract is defined under its own Architect plan.

**Reversibility:** Delete the file when the first real proto is committed. No downstream
code depends on it (generated stubs are gitignored; no production import exists).

**Consequence:** The first real service contract (e.g., `brain.core.v1`) should replace
this file. `buf breaking` will check the delta against this committed baseline — field
numbers on `Health.status` must not be changed while the file exists.

---

*End of DECISIONS.md — append new ADRs below this line.*
